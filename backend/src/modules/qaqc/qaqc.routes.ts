import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

export const qaqcRouter = Router();
qaqcRouter.use(authorize('qaqc', 'view'));

qaqcRouter.get('/inspections', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select ic.*, sa.activity_id_ext as activity_code from inspection_checklists ic left join schedule_activities sa on sa.id=ic.activity_ref where ($1::bigint=0 or ic.project_id=$1) order by ic.created_at desc limit 300`, [projectId]);
  res.json({ success: true, data: rows });
}));

qaqcRouter.post('/inspections', authorize('qaqc', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ project_id: z.number().int().positive(), checklist_type: z.string().min(1).max(100), activity_ref: z.number().int().positive().optional(), inspection_date: z.string().optional() }).parse(req.body);
  const [created] = await query(`insert into inspection_checklists (project_id, checklist_type, activity_ref, inspected_by, inspection_date) values ($1,$2,$3,$4,$5) returning *`, [b.project_id, b.checklist_type, b.activity_ref ?? null, req.user!.id, b.inspection_date ?? null]);
  res.status(201).json({ success: true, data: created });
}));

qaqcRouter.patch('/inspections/:id/status', authorize('qaqc', 'edit'), asyncHandler(async (req, res) => {
  const b = z.object({ status: z.enum(['pending','passed','failed']), inspection_date: z.string().optional() }).parse(req.body);
  const [updated] = await query(`update inspection_checklists set status=$2, inspection_date=coalesce($3::date, inspection_date) where id=$1 returning *`, [Number(req.params.id), b.status, b.inspection_date ?? null]);
  res.json({ success: true, data: updated ?? null });
}));

qaqcRouter.get('/ncrs', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select n.*, u.full_name as raised_by_name from ncrs n join users u on u.id=n.raised_by where ($1::bigint=0 or n.project_id=$1) order by n.raised_date desc, n.id desc limit 300`, [projectId]);
  res.json({ success: true, data: rows });
}));

qaqcRouter.post('/ncrs', authorize('qaqc', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ project_id: z.number().int().positive(), ncr_no: z.string().min(1).max(30), description: z.string().min(1), root_cause: z.string().optional(), corrective_action: z.string().optional(), cost_impact: z.number().nonnegative().optional() }).parse(req.body);
  const [created] = await query(`insert into ncrs (project_id, ncr_no, description, raised_by, root_cause, corrective_action, cost_impact) values ($1,$2,$3,$4,$5,$6,$7) returning *`, [b.project_id, b.ncr_no, b.description, req.user!.id, b.root_cause ?? null, b.corrective_action ?? null, b.cost_impact ?? null]);
  res.status(201).json({ success: true, data: created });
}));

qaqcRouter.patch('/ncrs/:id/close', authorize('qaqc', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ root_cause: z.string().min(1), corrective_action: z.string().min(1) }).parse(req.body);
  const [updated] = await query(`update ncrs set status='closed', closed_date=current_date, root_cause=$2, corrective_action=$3, closed_by=$4 where id=$1 and status='open' and raised_by<>$4 returning *`, [Number(req.params.id), b.root_cause, b.corrective_action, req.user!.id]);
  if (!updated) throw new AppError(409, 'NCR cannot be closed: it may be missing, already closed, cross-tenant, or raised by the same user');
  res.json({ success: true, data: updated });
}));

qaqcRouter.get('/metrics', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`
    select
      count(distinct ic.id)::int as total_inspections,
      count(distinct ic.id) filter (where ic.status='passed')::int as passed_inspections,
      count(distinct n.id)::int as total_ncrs,
      count(distinct n.id) filter (where n.status='closed')::int as closed_ncrs
    from projects p
    left join inspection_checklists ic on ic.project_id=p.id
    left join ncrs n on n.project_id=p.id
    where ($1::bigint=0 or p.id=$1)
  `, [projectId]);
  res.json({ success: true, data: rows[0] });
}));
