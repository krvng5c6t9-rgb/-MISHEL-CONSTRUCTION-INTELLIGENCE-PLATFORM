import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';
import { encryptSecret } from '../../services/mfa.service.js';
import { inputHash, runStudyInBackground } from './tenderStudy.service.js';

// CC-095 (Stage 66): the company's AI provider settings (ai_platform.manage; the key is stored encrypted and never
// returned - only its last four characters) and tender studies (tendering.view / create; review by tendering.approve,
// never by the requester).
export const aiRouter = Router();

// Models offered for the company to choose from (current Claude models); the company decides.
export const AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'] as const;

aiRouter.get('/settings', authorize('ai_platform', 'view'), asyncHandler(async (req, res) => {
  const [s] = await query<any>(`select s.provider, s.model, s.api_key_last4, s.data_processing_accepted, s.enabled, s.updated_at, u.full_name as updated_by_name
    from ai_provider_settings s join users u on u.id = s.updated_by where s.org_id = $1`, [req.user!.org_id]);
  res.json({ success: true, data: s ?? null, models: AI_MODELS });
}));

aiRouter.put('/settings', authorize('ai_platform', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ provider: z.literal('anthropic'), model: z.enum(AI_MODELS), api_key: z.string().trim().min(20).max(300).optional(),
    data_processing_accepted: z.boolean(), enabled: z.boolean() }).parse(req.body);
  if (b.enabled && !b.data_processing_accepted) throw new AppError(422, 'Accept that submitted documents are sent to the provider before enabling AI');
  const [cur] = await query<any>(`select 1 from ai_provider_settings where org_id = $1`, [req.user!.org_id]);
  if (!cur && !b.api_key) throw new AppError(422, 'Enter the company provider key');
  if (b.api_key) {
    await query(`insert into ai_provider_settings (org_id, provider, model, api_key_enc, api_key_last4, data_processing_accepted, enabled, updated_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (org_id) do update set provider = excluded.provider, model = excluded.model, api_key_enc = excluded.api_key_enc,
      api_key_last4 = excluded.api_key_last4, data_processing_accepted = excluded.data_processing_accepted, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()`,
      [req.user!.org_id, b.provider, b.model, encryptSecret(b.api_key), b.api_key.slice(-4), b.data_processing_accepted, b.enabled, req.user!.id]);
  } else {
    await query(`update ai_provider_settings set provider = $2, model = $3, data_processing_accepted = $4, enabled = $5, updated_by = $6, updated_at = now() where org_id = $1`,
      [req.user!.org_id, b.provider, b.model, b.data_processing_accepted, b.enabled, req.user!.id]);
  }
  const [s] = await query(`select provider, model, api_key_last4, data_processing_accepted, enabled, updated_at from ai_provider_settings where org_id = $1`, [req.user!.org_id]);
  res.json({ success: true, data: s });
}));

const studyCols = `s.id, s.tender_id, t.tender_title, s.status, s.input_sha256, length(s.input_text) as input_chars, s.instructions, s.model, s.served_model, s.result,
  s.quotes_checked, s.quotes_verified, s.stop_reason, s.input_tokens, s.output_tokens, s.error, s.ai_run_id, s.started_at, s.completed_at,
  s.requested_by, ur.full_name as requested_by_name, s.reviewed_by, uv.full_name as reviewed_by_name, s.reviewed_at, s.review_note, s.created_at`;
const studyFrom = `from tender_studies s join tenders t on t.id = s.tender_id join users ur on ur.id = s.requested_by left join users uv on uv.id = s.reviewed_by`;

aiRouter.get('/tender-studies', authorize('tendering', 'view'), asyncHandler(async (req, res) => {
  const q = z.object({ tender_id: z.coerce.number().int().positive().optional() }).parse(req.query);
  res.json({ success: true, data: await query(`select ${studyCols} ${studyFrom} where s.org_id = $1 and ($2::bigint is null or s.tender_id = $2) order by s.id desc limit 200`,
    [req.user!.org_id, q.tender_id ?? null]) });
}));

aiRouter.get('/tender-studies/:id', authorize('tendering', 'view'), asyncHandler(async (req, res) => {
  const [s] = await query(`select ${studyCols} ${studyFrom} where s.org_id = $1 and s.id = $2`, [req.user!.org_id, z.coerce.number().int().positive().parse(req.params.id)]);
  if (!s) throw new AppError(404, 'Tender study not found');
  res.json({ success: true, data: s });
}));

aiRouter.post('/tender-studies', authorize('tendering', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ tender_id: z.number().int().positive(), documents: z.string().min(50).max(2000000), instructions: z.string().max(4000).optional() }).parse(req.body);
  const [cfg] = await query<any>(`select enabled from ai_provider_settings where org_id = $1`, [req.user!.org_id]);
  if (!cfg?.enabled) throw new AppError(422, 'AI is not enabled for this company: enter the provider key and accept data processing in the AI settings');
  const [s] = await query<any>(`insert into tender_studies (org_id, tender_id, input_text, input_sha256, instructions, requested_by) values ($1, $2, $3, $4, $5, $6) returning id`,
    [req.user!.org_id, b.tender_id, b.documents, inputHash(b.documents), b.instructions ?? null, req.user!.id]);
  runStudyInBackground(Number(req.user!.org_id), Number(req.user!.id), Number(s.id));
  res.status(202).json({ success: true, data: { id: s.id, status: 'queued' } });
}));

aiRouter.post('/tender-studies/:id/review', authorize('tendering', 'approve'), asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const b = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().min(5).max(4000) }).parse(req.body);
  const [s] = await query<any>(`select status, requested_by, ai_run_id from tender_studies where org_id = $1 and id = $2`, [req.user!.org_id, id]);
  if (!s) throw new AppError(404, 'Tender study not found');
  if (Number(s.requested_by) === Number(req.user!.id)) throw new AppError(403, 'The person who requested a study cannot review it');
  if (s.status !== 'completed') throw new AppError(409, 'Only a completed study is reviewed');
  await query(`update tender_studies set status = $3, reviewed_by = $4, reviewed_at = now(), review_note = $5 where org_id = $1 and id = $2`, [req.user!.org_id, id, b.decision, req.user!.id, b.note]);
  if (s.ai_run_id) await query(`update ai_runs set status = $2 where id = $1`, [s.ai_run_id, b.decision === 'approved' ? 'succeeded' : 'cancelled']);
  const [out] = await query(`select ${studyCols} ${studyFrom} where s.org_id = $1 and s.id = $2`, [req.user!.org_id, id]);
  res.json({ success: true, data: out });
}));
