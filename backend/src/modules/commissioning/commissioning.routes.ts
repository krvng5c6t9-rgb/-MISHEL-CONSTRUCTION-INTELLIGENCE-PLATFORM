import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

// Stage 15 (GC-20, migration 066): systems, staged test packs with verified runs, handover dossier and taking-over.
// Readiness and stage order are enforced by the database; retention release / final account are not automated.
export const commissioningRouter = Router();
commissioningRouter.use(authorize('site', 'view'));

const pid = (v: string) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, 'Invalid id'); return n; };
const id = z.number().int().positive();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const STAGES = ['mechanical_completion', 'pre_commissioning', 'energisation', 'functional', 'integrated', 'performance'] as const;
async function system(systemId: number, orgId: number) {
  const [s] = await query<any>(`select * from commissioning_systems where id = $1 and org_id = $2`, [systemId, orgId]);
  if (!s) throw new AppError(404, 'System not found');
  return s;
}

commissioningRouter.post('/systems', authorize('site', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ project_id: id, system_code: z.string().trim().min(1).max(40), name: z.string().trim().min(2).max(200), description: z.string().max(4000).optional() }).parse(req.body);
  const [s] = await query(`insert into commissioning_systems(org_id, project_id, system_code, name, description, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
    [req.user!.org_id, b.project_id, b.system_code, b.name, b.description ?? null, req.user!.id]);
  res.status(201).json({ success: true, data: s });
}));
commissioningRouter.get('/systems', asyncHandler(async (req, res) => {
  const q = z.object({ project_id: z.coerce.number().int().positive() }).parse(req.query);
  res.json({ success: true, data: await query(`select s.*, r.*, (hc.id is not null) as handed_over from commissioning_systems s cross join lateral commissioning_readiness(s.id) r
     left join handover_certificates hc on hc.system_id = s.id where s.org_id = $1 and s.project_id = $2 order by s.system_code`, [req.user!.org_id, q.project_id]) });
}));
commissioningRouter.get('/systems/:id', asyncHandler(async (req, res) => {
  const s = await system(pid(req.params.id), req.user!.org_id);
  const [readiness] = await query(`select * from commissioning_readiness($1)`, [s.id]);
  const packs = await query(`select p.*, (select row_to_json(r) from commissioning_test_runs r where r.test_pack_id = p.id order by r.id desc limit 1) as latest_run
     from commissioning_test_packs p where p.system_id = $1 order by p.stage_order, p.pack_no`, [s.id]);
  const [certificate] = await query<any>(`select hc.*, (hc.dlp_end_date - current_date) as dlp_days_remaining,
       (select count(*)::int from punch_lists pl where pl.system_id = hc.system_id and pl.status <> 'closed' and pl.created_at > hc.created_at) as dlp_defects_open
     from handover_certificates hc where hc.system_id = $1`, [s.id]);
  res.json({ success: true, data: { ...s, readiness, test_packs: packs,
    punch_items: await query(`select * from punch_lists where system_id = $1 order by category, id`, [s.id]),
    dossier: await query(`select * from handover_dossier_items where system_id = $1 order by id`, [s.id]),
    taking_over: certificate ?? null } });
}));
commissioningRouter.post('/systems/:id/test-packs', authorize('site', 'manage'), asyncHandler(async (req, res) => {
  const s = await system(pid(req.params.id), req.user!.org_id);
  const b = z.object({ pack_no: z.string().trim().min(1).max(40), stage: z.enum(STAGES), acceptance_criteria: z.string().trim().min(10), witness_required: z.boolean().default(false) }).parse(req.body);
  const [p] = await query(`insert into commissioning_test_packs(org_id, system_id, pack_no, stage, acceptance_criteria, witness_required, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [req.user!.org_id, s.id, b.pack_no, b.stage, b.acceptance_criteria, b.witness_required, req.user!.id]);
  res.status(201).json({ success: true, data: p });
}));
commissioningRouter.post('/test-packs/:id/runs', authorize('site', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ result: z.enum(['passed', 'failed']), executed_on: isoDate, results_notes: z.string().trim().min(5), witness_name: z.string().trim().max(200).optional(), witness_reference: z.string().trim().max(200).optional() }).parse(req.body);
  const [p] = await query(`select id from commissioning_test_packs where id = $1 and org_id = $2`, [pid(req.params.id), req.user!.org_id]);
  if (!p) throw new AppError(404, 'Test pack not found');
  const [r] = await query(`insert into commissioning_test_runs(org_id, test_pack_id, result, executed_on, executed_by, results_notes, witness_name, witness_reference) values ($1,$2,$3,$4::date,$5,$6,$7,$8) returning *`,
    [req.user!.org_id, pid(req.params.id), b.result, b.executed_on, req.user!.id, b.results_notes, b.witness_name ?? null, b.witness_reference ?? null]);
  res.status(201).json({ success: true, data: r });
}));
commissioningRouter.post('/test-runs/:id/verify', authorize('site', 'approve'), asyncHandler(async (req, res) => {
  const [cur] = await query<any>(`select * from commissioning_test_runs where id = $1 and org_id = $2`, [pid(req.params.id), req.user!.org_id]);
  if (!cur) throw new AppError(404, 'Test run not found');
  if (cur.result !== 'passed') throw new AppError(409, 'Only a passed run is verified; record a new run after a failure');
  if (cur.verified_by) throw new AppError(409, 'Test run is already verified');
  if (Number(cur.executed_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: a test result is verified by someone other than the person who executed it');
  const [r] = await query(`update commissioning_test_runs set verified_by = $2, verified_at = now() where id = $1 returning *`, [cur.id, req.user!.id]);
  res.json({ success: true, data: r });
}));
commissioningRouter.post('/systems/:id/dossier', authorize('site', 'manage'), asyncHandler(async (req, res) => {
  const s = await system(pid(req.params.id), req.user!.org_id);
  const b = z.object({ requirement: z.string().trim().min(3).max(200) }).parse(req.body);
  const [d] = await query(`insert into handover_dossier_items(org_id, system_id, requirement, created_by) values ($1,$2,$3,$4) returning *`, [req.user!.org_id, s.id, b.requirement, req.user!.id]);
  res.status(201).json({ success: true, data: d });
}));
commissioningRouter.post('/dossier/:id/link', authorize('site', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ document_id: id }).parse(req.body);
  const [cur] = await query<any>(`select * from handover_dossier_items where id = $1 and org_id = $2`, [pid(req.params.id), req.user!.org_id]);
  if (!cur) throw new AppError(404, 'Dossier requirement not found');
  if (cur.document_id) throw new AppError(409, 'Requirement already satisfied');
  const [d] = await query(`update handover_dossier_items set document_id = $2, linked_by = $3, linked_at = now() where id = $1 returning *`, [cur.id, b.document_id, req.user!.id]);
  res.json({ success: true, data: d });
}));
commissioningRouter.post('/systems/:id/taking-over', authorize('site', 'approve'), asyncHandler(async (req, res) => {
  const s = await system(pid(req.params.id), req.user!.org_id);
  const b = z.object({ contract_id: id, certificate_no: z.string().trim().min(1).max(60), taking_over_date: isoDate, client_reference: z.string().trim().min(3).max(500) }).parse(req.body);
  const [c] = await query(`insert into handover_certificates(org_id, system_id, contract_id, certificate_no, taking_over_date, dlp_end_date, client_reference, recorded_by)
     values ($1,$2,$3,$4,$5::date,$5::date,$6,$7) returning *`, [req.user!.org_id, s.id, b.contract_id, b.certificate_no, b.taking_over_date, b.client_reference, req.user!.id]);
  res.status(201).json({ success: true, data: c });
}));
