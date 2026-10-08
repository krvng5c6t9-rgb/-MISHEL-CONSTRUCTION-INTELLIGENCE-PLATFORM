import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

// Stage 12 (GC-26 / GC-01 step 8, migration 064): risk & opportunity register. Scores rank risks only; rating bands,
// escalation thresholds and contingency policy belong to the company. Expected values are information, not postings.
export const risksRouter = Router();
risksRouter.use(authorize('projects', 'view'));

const pid = (v: string) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, 'Invalid id'); return n; };
const id = z.number().int().positive();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const level = z.number().int().min(1).max(5);
const assessment = {
  probability_level: level, impact_level: level,
  probability_pct: z.number().min(0).max(100).optional(), cost_impact: z.number().nonnegative().optional(), time_impact_days: z.number().int().nonnegative().optional()
};
const money = (v: number | undefined) => (v === undefined ? null : String(v));
const listSql = `select r.*, (r.status <> 'closed' and r.review_due < current_date) as review_overdue,
    (select count(*)::int from risk_responses x where x.risk_id = r.id and x.status = 'open') as open_responses,
    (select count(*)::int from risk_responses x where x.risk_id = r.id and x.status = 'open' and x.due_date < current_date) as overdue_responses
  from risks r`;
async function current(riskId: number, orgId: number) {
  const [r] = await query<any>(`select * from risks where id = $1 and org_id = $2`, [riskId, orgId]);
  if (!r) throw new AppError(404, 'Risk not found');
  return r;
}

risksRouter.get('/', asyncHandler(async (req, res) => {
  const q = z.object({ project_id: z.coerce.number().int().positive().optional(), tender_id: z.coerce.number().int().positive().optional(), status: z.enum(['open', 'escalated', 'closed']).optional() }).parse(req.query);
  res.json({ success: true, data: await query(`${listSql} where r.org_id = $1 and ($2::bigint is null or r.project_id = $2) and ($3::bigint is null or r.tender_id = $3) and ($4::varchar is null or r.status = $4::varchar)
     order by r.score desc, r.expected_value desc nulls last, r.id`, [req.user!.org_id, q.project_id ?? null, q.tender_id ?? null, q.status ?? null]) });
}));
risksRouter.get('/summary', asyncHandler(async (req, res) => {
  const q = z.object({ project_id: z.coerce.number().int().positive().optional(), tender_id: z.coerce.number().int().positive().optional() })
    .refine(v => !!v.project_id !== !!v.tender_id, { message: 'Give exactly one of project_id or tender_id' }).parse(req.query);
  const [s] = await query<Record<string, unknown>>(`select count(*) filter (where status <> 'closed')::int as open_risks,
       count(*) filter (where status = 'escalated')::int as escalated,
       count(*) filter (where status <> 'closed' and review_due < current_date)::int as reviews_overdue,
       coalesce(sum(expected_value) filter (where status <> 'closed' and kind = 'threat'), 0)::numeric(18,2) as open_threat_expected_value,
       coalesce(sum(expected_value) filter (where status <> 'closed' and kind = 'opportunity'), 0)::numeric(18,2) as open_opportunity_expected_value,
       count(*) filter (where status <> 'closed' and kind = 'threat' and expected_value is null)::int as threats_not_quantified,
       max(time_impact_days) filter (where status <> 'closed' and kind = 'threat') as largest_open_time_impact_days
     from risks where org_id = $1 and ($2::bigint is null or project_id = $2) and ($3::bigint is null or tender_id = $3)`, [req.user!.org_id, q.project_id ?? null, q.tender_id ?? null]);
  const top = await query(`select id, risk_no, kind, title, score, expected_value, status from risks where org_id = $1 and status <> 'closed' and ($2::bigint is null or project_id = $2) and ($3::bigint is null or tender_id = $3) order by score desc, expected_value desc nulls last, id limit 5`, [req.user!.org_id, q.project_id ?? null, q.tender_id ?? null]);
  res.json({ success: true, data: { ...s, top_risks: top, note: 'Expected values are probability x cost impact for information; contingency policy is the company\'s.' } });
}));
risksRouter.get('/:id', asyncHandler(async (req, res) => {
  const riskId = pid(req.params.id);
  const [r] = await query<any>(`${listSql} where r.id = $1 and r.org_id = $2`, [riskId, req.user!.org_id]);
  if (!r) throw new AppError(404, 'Risk not found');
  res.json({ success: true, data: { ...r,
    assessments: await query(`select * from risk_assessments where risk_id = $1 order by id`, [riskId]),
    responses: await query(`select *, (status = 'open' and due_date < current_date) as overdue from risk_responses where risk_id = $1 order by id`, [riskId]) } });
}));
risksRouter.post('/', authorize('projects', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ risk_no: z.string().trim().min(1).max(30), tender_id: id.optional(), project_id: id.optional(), kind: z.enum(['threat', 'opportunity']),
    title: z.string().trim().min(3).max(200), cause: z.string().trim().min(5), effect: z.string().trim().min(5), category: z.string().trim().max(60).optional(),
    owner_user_id: id, ...assessment, trigger_description: z.string().trim().max(2000).optional(), review_due: isoDate.optional() })
    .refine(v => v.tender_id || v.project_id, { message: 'A risk belongs to a tender or a project', path: ['project_id'] }).parse(req.body);
  const [r] = await query(`insert into risks(org_id,risk_no,tender_id,project_id,kind,title,cause,effect,category,owner_user_id,probability_level,impact_level,probability_pct,cost_impact,time_impact_days,trigger_description,review_due,created_by)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::numeric,$14::numeric,$15,$16,$17::date,$18) returning *`,
    [req.user!.org_id, b.risk_no, b.tender_id ?? null, b.project_id ?? null, b.kind, b.title, b.cause, b.effect, b.category ?? null, b.owner_user_id, b.probability_level, b.impact_level,
      money(b.probability_pct), money(b.cost_impact), b.time_impact_days ?? null, b.trigger_description ?? null, b.review_due ?? null, req.user!.id]);
  res.status(201).json({ success: true, data: r });
}));
risksRouter.post('/:id/assess', authorize('projects', 'edit'), asyncHandler(async (req, res) => {
  const riskId = pid(req.params.id);
  const b = z.object({ ...assessment, review_due: isoDate.optional() }).parse(req.body);
  const cur = await current(riskId, req.user!.org_id);
  if (cur.status === 'closed') throw new AppError(409, 'Risk is closed');
  const [r] = await query(`update risks set probability_level=$2,impact_level=$3,probability_pct=$4::numeric,cost_impact=$5::numeric,time_impact_days=$6,review_due=coalesce($7::date,review_due)
     where id=$1 and status <> 'closed' returning *`, [riskId, b.probability_level, b.impact_level, money(b.probability_pct), money(b.cost_impact), b.time_impact_days ?? null, b.review_due ?? null]);
  res.json({ success: true, data: r });
}));
risksRouter.post('/:id/assign-project', authorize('projects', 'edit'), asyncHandler(async (req, res) => {
  const riskId = pid(req.params.id);
  const b = z.object({ project_id: id }).parse(req.body);
  const cur = await current(riskId, req.user!.org_id);
  if (cur.project_id) throw new AppError(409, 'Risk already belongs to a project');
  const [r] = await query(`update risks set project_id=$2 where id=$1 returning *`, [riskId, b.project_id]);
  res.json({ success: true, data: r });
}));
risksRouter.post('/:id/responses', authorize('projects', 'edit'), asyncHandler(async (req, res) => {
  const riskId = pid(req.params.id);
  const b = z.object({ strategy: z.enum(['avoid', 'mitigate', 'transfer', 'accept', 'exploit', 'enhance', 'share']), action: z.string().trim().min(5), owner_user_id: id, due_date: isoDate }).parse(req.body);
  await current(riskId, req.user!.org_id);
  const [x] = await query(`insert into risk_responses(org_id,risk_id,strategy,action,owner_user_id,due_date,created_by) values($1,$2,$3,$4,$5,$6::date,$7) returning *`,
    [req.user!.org_id, riskId, b.strategy, b.action, b.owner_user_id, b.due_date, req.user!.id]);
  res.status(201).json({ success: true, data: x });
}));
risksRouter.post('/responses/:id/finish', authorize('projects', 'edit'), asyncHandler(async (req, res) => {
  const b = z.object({ status: z.enum(['done', 'cancelled']), outcome: z.string().trim().min(5) }).parse(req.body);
  const [x] = await query(`update risk_responses set status=$2::varchar,outcome=$3,completed_at=now() where id=$1 and org_id=$4 and status='open' returning *`, [pid(req.params.id), b.status, b.outcome, req.user!.org_id]);
  if (!x) {
    const [e] = await query(`select 1 from risk_responses where id=$1 and org_id=$2`, [pid(req.params.id), req.user!.org_id]);
    throw e ? new AppError(409, 'Response is already finished') : new AppError(404, 'Response not found');
  }
  res.json({ success: true, data: x });
}));
risksRouter.post('/:id/escalate', authorize('projects', 'edit'), asyncHandler(async (req, res) => {
  const riskId = pid(req.params.id);
  const b = z.object({ escalated_to: id, reason: z.string().trim().min(5) }).parse(req.body);
  const cur = await current(riskId, req.user!.org_id);
  if (cur.status !== 'open') throw new AppError(409, 'Only an open risk can be escalated');
  const [r] = await query(`update risks set status='escalated',escalated_to=$2,escalation_reason=$3,escalated_at=now() where id=$1 returning *`, [riskId, b.escalated_to, b.reason]);
  res.json({ success: true, data: r });
}));
risksRouter.post('/:id/close', authorize('projects', 'approve'), asyncHandler(async (req, res) => {
  const riskId = pid(req.params.id);
  const b = z.object({ closure_type: z.enum(['expired', 'mitigated', 'occurred', 'realised', 'not_realised']), reason: z.string().trim().min(5),
    lesson_learned: z.string().trim().min(10), materialised_event_id: id.optional() }).parse(req.body);
  const cur = await current(riskId, req.user!.org_id);
  if (cur.status === 'closed') throw new AppError(409, 'Risk is already closed');
  if (Number(cur.created_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: a risk is closed by someone other than the person who raised it');
  const [r] = await query(`update risks set status='closed',closure_type=$2,closure_reason=$3,lesson_learned=$4,materialised_event_id=$5,closed_by=$6,closed_at=now() where id=$1 returning *`,
    [riskId, b.closure_type, b.reason, b.lesson_learned, b.materialised_event_id ?? null, req.user!.id]);
  res.json({ success: true, data: r });
}));
