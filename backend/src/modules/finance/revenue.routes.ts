import { Router } from 'express';
import { z } from 'zod';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';
import { postRevenueRunToGl } from '../../services/glPosting.service.js';

// Stage 31 / DEC-009 part 2 (migration 080): revenue recognised over time per contract. Price estimates (unpriced
// variations, claims, expected delay damages) enter the price only with a written basis approved by a second person.
// A run's figures are captured by the database at preparation; approval by someone else posts it to the GL.
export const revenueRouter = Router();
revenueRouter.use(authorize('finance', 'view'));

const pid = (v: string) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, 'Invalid id'); return n; };
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

revenueRouter.post('/revenue-estimates', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ contract_id: z.number().int().positive(), kind: z.enum(['unpriced_variation', 'claim', 'delay_damages']), amount: z.number().refine(v => v !== 0),
    effective_from: isoDate, basis: z.string().trim().min(20), evidence_reference: z.string().trim().min(3).max(200) }).parse(req.body);
  const [r] = await query(`insert into revenue_price_estimates(org_id, contract_id, kind, amount, effective_from, basis, evidence_reference, prepared_by)
    values ($1,$2,$3,$4,$5::date,$6,$7,$8) returning *`, [req.user!.org_id, b.contract_id, b.kind, b.amount, b.effective_from, b.basis, b.evidence_reference, req.user!.id]);
  res.status(201).json({ success: true, data: r });
}));
revenueRouter.get('/revenue-estimates', asyncHandler(async (req, res) => {
  const q = z.object({ contract_id: z.coerce.number().int().positive() }).parse(req.query);
  res.json({ success: true, data: await query(`select * from revenue_price_estimates where org_id = $1 and contract_id = $2 order by id`, [req.user!.org_id, q.contract_id]) });
}));
revenueRouter.post('/revenue-estimates/:id/approve', authorize('finance', 'approve'), asyncHandler(async (req, res) => {
  const [e] = await query<any>(`select id, status, prepared_by from revenue_price_estimates where id = $1 and org_id = $2`, [pid(req.params.id), req.user!.org_id]);
  if (!e) throw new AppError(404, 'Price estimate not found');
  if (e.status !== 'draft') throw new AppError(409, 'Only a draft price estimate can be approved');
  if (Number(e.prepared_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: a price estimate is approved by someone other than its preparer');
  const [r] = await query(`update revenue_price_estimates set status = 'approved', approved_by = $2, approved_at = now() where id = $1 and status = 'draft' returning *`, [e.id, req.user!.id]);
  res.json({ success: true, data: r });
}));
revenueRouter.post('/revenue-estimates/:id/retire', authorize('finance', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ retired_on: isoDate, reason: z.string().trim().min(10) }).parse(req.body);
  const [e] = await query<any>(`select id, status from revenue_price_estimates where id = $1 and org_id = $2`, [pid(req.params.id), req.user!.org_id]);
  if (!e) throw new AppError(404, 'Price estimate not found');
  if (e.status !== 'approved') throw new AppError(409, 'Only an approved price estimate can be retired');
  const [r] = await query(`update revenue_price_estimates set status = 'retired', retired_on = $2::date, retired_reason = $3, retired_by = $4 where id = $1 returning *`, [e.id, b.retired_on, b.reason, req.user!.id]);
  res.json({ success: true, data: r });
}));

revenueRouter.post('/revenue-runs', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ contract_id: z.number().int().positive(), period_start: isoDate, period_end: isoDate }).parse(req.body);
  const [r] = await query(`insert into revenue_recognition_runs(org_id, contract_id, project_id, period_start, period_end, prepared_by)
    select $1, k.id, k.project_id, $3::date, $4::date, $5 from contracts k where k.id = $2 and k.org_id = $1 returning *`,
    [req.user!.org_id, b.contract_id, b.period_start, b.period_end, req.user!.id]);
  if (!r) throw new AppError(404, 'Contract not found');
  res.status(201).json({ success: true, data: r });
}));
revenueRouter.get('/revenue-runs', asyncHandler(async (req, res) => {
  const q = z.object({ contract_id: z.coerce.number().int().positive() }).parse(req.query);
  res.json({ success: true, data: await query(`select * from revenue_recognition_runs where org_id = $1 and contract_id = $2 order by period_end, id`, [req.user!.org_id, q.contract_id]) });
}));
revenueRouter.post('/revenue-runs/:id/approve', authorize('finance', 'approve'), asyncHandler(async (req, res) => {
  const client = await getClient();
  try {
    await client.query('begin');
    const run = (await client.query(`select id, status, prepared_by from revenue_recognition_runs where id = $1 and org_id = $2 for update`, [pid(req.params.id), req.user!.org_id])).rows[0];
    if (!run) throw new AppError(404, 'Revenue run not found');
    if (run.status !== 'prepared') throw new AppError(409, 'Only a prepared revenue run can be approved');
    if (Number(run.prepared_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: the preparer cannot approve the revenue run');
    const gl = await postRevenueRunToGl(client, Number(run.id));
    const [r] = (await client.query(`update revenue_recognition_runs set status = 'approved', approved_by = $2, approved_at = now() where id = $1 returning *`, [run.id, req.user!.id])).rows;
    await client.query('commit');
    res.json({ success: true, data: { run: r, gl } });
  } catch (e) { await client.query('rollback'); throw e; } finally { await releaseClient(client); }
}));
revenueRouter.delete('/revenue-runs/:id', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const rows = await query(`delete from revenue_recognition_runs where id = $1 and org_id = $2 and status = 'prepared' returning id`, [pid(req.params.id), req.user!.org_id]);
  if (!rows[0]) throw new AppError(404, 'Prepared revenue run not found');
  res.json({ success: true, data: rows[0] });
}));
