import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

export const hseRouter = Router();
hseRouter.use(authorize('hse', 'view'));

const idOf = (value: unknown) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'Invalid id');
  return id;
};

hseRouter.get('/incidents', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select i.*, u.full_name as reported_by_name, cu.full_name as closed_by_name from incidents i join users u on u.id=i.reported_by left join users cu on cu.id=i.closed_by where ($1::bigint=0 or i.project_id=$1) order by i.incident_date desc, i.id desc limit 300`, [projectId]);
  res.json({ success: true, data: rows });
}));

hseRouter.post('/incidents', authorize('hse', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ project_id: z.number().int().positive(), incident_date: z.string().optional(), severity: z.enum(['near_miss','minor','major','fatality']), description: z.string().min(1), injured_party: z.string().max(150).optional(), corrective_actions: z.string().optional() }).parse(req.body);
  const [created] = await query(`insert into incidents (project_id, incident_date, severity, description, injured_party, reported_by, corrective_actions) values ($1,coalesce($2::date,current_date),$3,$4,$5,$6,$7) returning *`, [b.project_id, b.incident_date ?? null, b.severity, b.description, b.injured_party ?? null, req.user!.id, b.corrective_actions ?? null]);
  res.status(201).json({ success: true, data: created });
}));

hseRouter.patch('/incidents/:id/close', authorize('hse', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ corrective_actions: z.string().min(1) }).parse(req.body);
  const [updated] = await query(`update incidents set investigation_status='closed', corrective_actions=$2, closed_by=$3, closed_at=now() where id=$1 and investigation_status='open' and reported_by<>$3 returning *`, [idOf(req.params.id), b.corrective_actions, req.user!.id]);
  if (!updated) throw new AppError(409, 'Incident cannot be closed: it may be missing, already closed, cross-tenant, or reported by the same user');
  res.json({ success: true, data: updated });
}));

hseRouter.get('/toolbox-talks', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select tt.*, u.full_name as conducted_by_name from toolbox_talks tt join users u on u.id=tt.conducted_by where ($1::bigint=0 or tt.project_id=$1) order by tt.talk_date desc, tt.id desc limit 300`, [projectId]);
  res.json({ success: true, data: rows });
}));

hseRouter.post('/toolbox-talks', authorize('hse', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ project_id: z.number().int().positive(), talk_date: z.string().optional(), topic: z.string().min(1).max(200), attendees_count: z.number().int().nonnegative().optional() }).parse(req.body);
  const [created] = await query(`insert into toolbox_talks (project_id, talk_date, topic, attendees_count, conducted_by) values ($1,coalesce($2::date,current_date),$3,$4,$5) returning *`, [b.project_id, b.talk_date ?? null, b.topic, b.attendees_count ?? null, req.user!.id]);
  res.status(201).json({ success: true, data: created });
}));

hseRouter.get('/permits', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select ptw.*, ru.full_name as requested_by_name, au.full_name as approved_by_name, xu.full_name as activated_by_name from permits_to_work ptw left join users ru on ru.id=ptw.requested_by left join users au on au.id=ptw.approved_by left join users xu on xu.id=ptw.activated_by where ($1::bigint=0 or ptw.project_id=$1) order by ptw.issue_date desc, ptw.id desc limit 300`, [projectId]);
  res.json({ success: true, data: rows });
}));

hseRouter.post('/permits', authorize('hse', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ project_id: z.number().int().positive(), permit_type: z.enum(['hot_work','confined_space','height','other']), issue_date: z.string().optional(), expiry_date: z.string().optional() }).parse(req.body);
  const [created] = await query(`insert into permits_to_work (project_id, permit_type, issue_date, expiry_date, issued_by, requested_by, status) values ($1,$2,coalesce($3::date,current_date),$4,$5,$5,'requested') returning *`, [b.project_id, b.permit_type, b.issue_date ?? null, b.expiry_date ?? null, req.user!.id]);
  res.status(201).json({ success: true, data: created });
}));

hseRouter.post('/permits/:id/approve', authorize('hse', 'approve'), asyncHandler(async (req, res) => {
  const [updated] = await query(`update permits_to_work set status='approved', approved_by=$2, approved_at=now() where id=$1 and status='requested' and requested_by<>$2 returning *`, [idOf(req.params.id), req.user!.id]);
  if (!updated) throw new AppError(409, 'PTW cannot be approved: invalid state, missing permit, cross-tenant, or requester is the approver');
  res.json({ success: true, data: updated });
}));

hseRouter.post('/permits/:id/activate', authorize('hse', 'approve'), asyncHandler(async (req, res) => {
  const [updated] = await query(`update permits_to_work set status='active', activated_by=$2, activated_at=now() where id=$1 and status='approved' and requested_by<>$2 returning *`, [idOf(req.params.id), req.user!.id]);
  if (!updated) throw new AppError(409, 'PTW cannot be activated: it must be approved and activation must be independent of the requester');
  res.json({ success: true, data: updated });
}));

hseRouter.post('/permits/:id/close', authorize('hse', 'approve'), asyncHandler(async (req, res) => {
  const [updated] = await query(`update permits_to_work set status='closed', closed_by=$2, closed_at=now() where id=$1 and status in ('requested','approved','active') and requested_by<>$2 returning *`, [idOf(req.params.id), req.user!.id]);
  if (!updated) throw new AppError(409, 'PTW cannot be closed from its current state or by its requester');
  res.json({ success: true, data: updated });
}));

hseRouter.post('/permits/:id/expire', authorize('hse', 'approve'), asyncHandler(async (req, res) => {
  const [updated] = await query(`update permits_to_work set status='expired' where id=$1 and status in ('approved','active') and expiry_date is not null and expiry_date < current_date returning *`, [idOf(req.params.id)]);
  if (!updated) throw new AppError(409, 'PTW is not eligible for expiry');
  res.json({ success: true, data: updated });
}));

hseRouter.get('/metrics', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const [row] = await query(`
    select
      count(distinct i.id)::int as incidents,
      count(distinct i.id) filter (where i.severity in ('major','fatality'))::int as serious_incidents,
      count(distinct i.id) filter (where i.investigation_status='closed')::int as closed_investigations,
      count(distinct ptw.id) filter (where ptw.status in ('requested','approved','active'))::int as active_permits,
      count(distinct tt.id)::int as toolbox_talks
    from projects p
    left join incidents i on i.project_id=p.id
    left join permits_to_work ptw on ptw.project_id=p.id
    left join toolbox_talks tt on tt.project_id=p.id
    where ($1::bigint=0 or p.id=$1)
  `, [projectId]);
  res.json({ success: true, data: row });
}));
