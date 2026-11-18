import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { createHash } from 'node:crypto';
import { getClient, releaseClient } from '../../db/pool.js';
import { withDbContext } from '../../db/context.js';
import { decryptSecret } from '../../services/mfa.service.js';

// CC-095 (Stage 66, MP-04 AG-04 tender study): one structured request per study, on the company's own provider key
// and model. The model reads the tender documents as submitted and returns a draft analysis; it is told never to
// invent prices, rates or quantities. Every finding carries a verbatim quote from the documents; the server checks
// each quote against the submitted text and marks the finding verified or not. The draft is reviewed by a person
// (not the requester) before anyone may rely on it. AI_PROVIDER_BASE_URL is for a company gateway or the test mock.

const Finding = z.object({ title: z.string(), detail: z.string(), quote: z.string().describe('Exact text copied from the documents that supports this finding') });
export const StudySchema = z.object({
  summary: z.string().describe('What the tender is, its scope and its main conditions, in the language of the documents'),
  boq_items: z.array(z.object({
    item_ref: z.string(), description: z.string(), unit: z.string(), quantity: z.string().describe('As written in the documents, or empty if not given'),
    observation: z.string(), risk_level: z.enum(['high', 'medium', 'low', 'none']), quote: z.string()
  })),
  missing_information: z.array(Finding),
  clarification_questions: z.array(z.object({ question: z.string(), reason: z.string(), quote: z.string() })),
  risks: z.array(z.object({ title: z.string(), severity: z.enum(['high', 'medium', 'low']), description: z.string(), mitigation: z.string(), quote: z.string() })),
  contract_conditions: z.array(Finding),
  pricing_notes: z.array(Finding).describe('What the estimator must price or check; never a price'),
  recommendation: z.object({ decision: z.enum(['go', 'no_go', 'needs_more_information']), reasons: z.array(z.string()) })
});
export type Study = z.infer<typeof StudySchema>;

const SYSTEM = `You are the tender study engineer of a construction contracting company in Egypt and the Gulf.
You read the tender documents you are given (bill of quantities, specifications, conditions, drawings lists) and prepare a
first study for the tendering manager. Your study is a draft that a qualified person reviews before anyone relies on it.

Rules:
- Use only what the documents say. Never invent prices, unit rates, quantities, durations, names or dates. When something
  needed for pricing or planning is not in the documents, list it under missing information or clarification questions.
- Every boq item, finding, question and risk carries "quote": text copied exactly, character for character, from the
  documents (a short phrase or line is enough). If no text supports a point, do not include the point.
- Pricing notes say what the estimator must price, check or ask suppliers about; they never contain a price.
- Assess risks the way an experienced Egyptian contractor would: contract conditions (advance payment, retention, delay
  damages, payment terms, time bars, price adjustment, guarantees), quantity and specification ambiguity, site and
  access constraints, and missing design information.
- The recommendation is go, no_go or needs_more_information, with reasons tied to the documents.
- Write in the language of the documents (Arabic documents: Arabic).`;

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

// Marks each quote verified when it occurs in the submitted documents (whitespace-normalised).
export function checkQuotes(study: Study, input: string) {
  const doc = normalize(input);
  let checked = 0, verified = 0;
  const mark = <T extends { quote: string }>(x: T) => { checked++; const ok = !!normalize(x.quote) && doc.includes(normalize(x.quote)); if (ok) verified++; return { ...x, quote_verified: ok }; };
  const out = {
    ...study,
    boq_items: study.boq_items.map(mark), missing_information: study.missing_information.map(mark),
    clarification_questions: study.clarification_questions.map(mark), risks: study.risks.map(mark),
    contract_conditions: study.contract_conditions.map(mark), pricing_notes: study.pricing_notes.map(mark)
  };
  return { result: out, checked, verified };
}

export const inputHash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

// Runs a queued study in the background, inside the company's database context.
export function runStudyInBackground(orgId: number, userId: number, studyId: number) {
  setImmediate(() => { withDbContext({ orgId, userId }, () => runStudy(studyId)).catch(() => undefined); });
}

async function runStudy(studyId: number) {
  const c = await getClient();
  let runId: number | null = null;
  try {
    const st = (await c.query(`select s.*, t.tender_title from tender_studies s join tenders t on t.id = s.tender_id where s.id = $1`, [studyId])).rows[0];
    if (!st || st.status !== 'queued') return;
    const cfg = (await c.query(`select * from ai_provider_settings where org_id = $1`, [st.org_id])).rows[0];
    if (!cfg?.enabled) { await c.query(`update tender_studies set status = 'failed', error = 'AI is not enabled for this company', completed_at = now() where id = $1`, [studyId]); return; }
    runId = Number((await c.query(`insert into ai_runs (org_id, correlation_id, requested_by, status, input_payload, prompt_version, model_key, started_at)
      values ($1, gen_random_uuid(), $2, 'running', $3, 'AG-04/1', $4, now()) returning id`, [st.org_id, st.requested_by, { tender_study_id: studyId, input_sha256: st.input_sha256 }, cfg.model])).rows[0].id);
    await c.query(`update tender_studies set status = 'running', model = $2, ai_run_id = $3, started_at = now() where id = $1`, [studyId, cfg.model, runId]);

    const client = new Anthropic({ apiKey: decryptSecret(cfg.api_key_enc), baseURL: process.env.AI_PROVIDER_BASE_URL || undefined, maxRetries: 2 });
    const t0 = Date.now();
    const msg = await client.beta.messages.parse({
      model: cfg.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: betaZodOutputFormat(StudySchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Tender: ${st.tender_title}\n${st.instructions ? `Instructions from the tendering manager: ${st.instructions}\n` : ''}\n<documents>\n${st.input_text}\n</documents>` }]
    });
    const usage = { input: msg.usage?.input_tokens ?? null, output: msg.usage?.output_tokens ?? null };
    if (msg.stop_reason === 'refusal' || !msg.parsed_output) {
      const why = msg.stop_reason === 'refusal' ? 'refused' : 'failed';
      await c.query(`update tender_studies set status = $2, stop_reason = $3, served_model = $4, input_tokens = $5, output_tokens = $6, error = $7, completed_at = now() where id = $1`,
        [studyId, why, msg.stop_reason, msg.model, usage.input, usage.output, why === 'refused' ? 'The model declined this request' : `No valid study was returned (${msg.stop_reason})`]);
      await c.query(`update ai_runs set status = 'failed', error_code = $2, completed_at = now(), latency_ms = $3, input_tokens = $4, output_tokens = $5 where id = $1`, [runId, msg.stop_reason, Date.now() - t0, usage.input, usage.output]);
      return;
    }
    const q = checkQuotes(msg.parsed_output as Study, st.input_text);
    await c.query(`update tender_studies set status = 'completed', result = $2, quotes_checked = $3, quotes_verified = $4, stop_reason = $5, served_model = $6,
      input_tokens = $7, output_tokens = $8, completed_at = now() where id = $1`, [studyId, q.result, q.checked, q.verified, msg.stop_reason, msg.model, usage.input, usage.output]);
    await c.query(`update ai_runs set status = 'waiting_approval', output_payload = $2, completed_at = now(), latency_ms = $3, input_tokens = $4, output_tokens = $5 where id = $1`,
      [runId, { tender_study_id: studyId, quotes_checked: q.checked, quotes_verified: q.verified }, Date.now() - t0, usage.input, usage.output]);
  } catch (err: any) {
    const status = err instanceof Anthropic.AuthenticationError ? 'The provider refused the company key' : err instanceof Anthropic.RateLimitError ? 'The provider rate limit was reached; try again later'
      : err instanceof Anthropic.APIError ? `Provider error ${err.status ?? ''}`.trim() : 'The study could not be completed';
    await c.query(`update tender_studies set status = 'failed', error = $2, completed_at = now() where id = $1 and status in ('queued', 'running')`, [studyId, status]).catch(() => undefined);
    if (runId) await c.query(`update ai_runs set status = 'failed', error_message = $2, completed_at = now() where id = $1`, [runId, status]).catch(() => undefined);
  } finally { await releaseClient(c); }
}
