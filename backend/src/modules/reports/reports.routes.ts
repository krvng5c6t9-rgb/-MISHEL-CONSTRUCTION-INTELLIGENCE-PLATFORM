import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

export const reportsRouter = Router();
reportsRouter.use(authorize('reports', 'view'));

const reportQuery = z.object({ project_id: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) });

reportsRouter.get('/cost-summary', asyncHandler(async (req, res) => {
  const q = reportQuery.parse(req.query);
  const rows = await query(`
    select vcs.*
    from v_cost_control_summary vcs join projects p on p.id=vcs.project_id
    where p.org_id=$1 ${q.project_id ? 'and vcs.project_id=$2' : ''}
    order by vcs.project_id, vcs.code
    limit ${q.limit}
  `, q.project_id ? [req.user!.org_id, q.project_id] : [req.user!.org_id]);
  res.json({ success: true, data: rows });
}));

reportsRouter.get('/boq-vs-actual', asyncHandler(async (req, res) => {
  const q = reportQuery.parse(req.query);
  const rows = await query(`
    select bva.*
    from v_boq_vs_actual bva join projects p on p.id=bva.project_id
    where p.org_id=$1 ${q.project_id ? 'and bva.project_id=$2' : ''}
    order by bva.project_id, bva.item_no
    limit ${q.limit}
  `, q.project_id ? [req.user!.org_id, q.project_id] : [req.user!.org_id]);
  res.json({ success: true, data: rows });
}));

reportsRouter.get('/ar-aging', asyncHandler(async (req, res) => {
  const rows = await query(`
    select a.*, c.client_name, p.project_name
    from v_ar_aging a
    left join clients c on c.id=a.client_id
    left join projects p on p.id=a.project_id
    where p.org_id=$1
    order by a.days_overdue desc
  `, [req.user!.org_id]);
  res.json({ success: true, data: rows });
}));

reportsRouter.get('/ap-aging', asyncHandler(async (req, res) => {
  const rows = await query(`
    select a.*, v.vendor_name, p.project_name
    from v_ap_aging a
    left join vendors_subcontractors v on v.id=a.vendor_id
    left join projects p on p.id=a.project_id
    where p.org_id=$1
    order by a.days_overdue desc
  `, [req.user!.org_id]);
  res.json({ success: true, data: rows });
}));

reportsRouter.get('/procurement-cycle-time', asyncHandler(async (req, res) => {
  const q = reportQuery.parse(req.query);
  const rows = await query(`
    select pct.*
    from v_procurement_cycle_time pct join projects p on p.id=pct.project_id
    where p.org_id=$1 ${q.project_id ? 'and pct.project_id=$2' : ''}
    order by pct.po_date desc nulls last
    limit ${q.limit}
  `, q.project_id ? [req.user!.org_id, q.project_id] : [req.user!.org_id]);
  res.json({ success: true, data: rows });
}));

reportsRouter.get('/daily-status', asyncHandler(async (req, res) => {
  const q = reportQuery.parse(req.query);
  const rows = await query(`
    select sd.*, p.project_name,
           coalesce(dm.manpower_count,0)::int as manpower_count,
           coalesce(de.equipment_count,0)::int as equipment_count
    from site_diary sd
    join projects p on p.id=sd.project_id
    left join (select site_diary_id, sum(count) manpower_count from diary_manpower group by site_diary_id) dm on dm.site_diary_id=sd.id
    left join (select site_diary_id, sum(count) equipment_count from diary_equipment group by site_diary_id) de on de.site_diary_id=sd.id
    where p.org_id=$1 ${q.project_id ? 'and sd.project_id=$2' : ''}
    order by sd.diary_date desc
    limit ${q.limit}
  `, q.project_id ? [req.user!.org_id, q.project_id] : [req.user!.org_id]);
  res.json({ success: true, data: rows });
}));

// Stage 14 fix: pending approvals are counted per project through each approval module's record (before: every
// project showed the organisation-wide total), and a project without an EVM snapshot reports SPI/CPI as null
// (before: 0, which reads as a failing project). Approvals whose records carry no project are reported separately.
const projectApprovalSql = `
  select ai.id, coalesce(c.project_id, eu.project_id, v.project_id, sc.project_id, ip.project_id, vi.project_id, po.project_id, scc.project_id, mr.project_id) as project_id
  from approval_instances ai
  left join contracts c on ai.module = 'contract_signing' and c.id = ai.record_id
  left join equipment_usage eu on ai.module = 'equipment_usage' and eu.id = ai.record_id
  left join variations v on ai.module = 'variation' and v.id = ai.record_id
  left join subcontracts sc on ai.module = 'subcontract_signing' and sc.id = ai.record_id
  left join ipcs ip on ai.module = 'ipc_submission' and ip.id = ai.record_id
  left join vendor_invoices vi on ai.module = 'vendor_invoice' and vi.id = ai.record_id
  left join purchase_orders po on ai.module = 'purchase_order' and po.id = ai.record_id
  left join subcontract_certificates scc on ai.module = 'subcontract_certificate' and scc.id = ai.record_id
  left join material_requisitions mr on ai.module = 'material_requisition' and mr.id = ai.record_id
  where ai.org_id = $1 and ai.status = 'pending'`;
reportsRouter.get('/weekly-executive', asyncHandler(async (req, res) => {
  const q = reportQuery.parse(req.query);
  const projectPredicate = q.project_id ? 'and p.id=$2' : '';
  const params = q.project_id ? [req.user!.org_id, q.project_id] : [req.user!.org_id];
  const rows = await query(`
    with pa as (${projectApprovalSql})
    select p.id as project_id, p.project_name, p.status,
           e.schedule_performance_index as spi,
           e.cost_performance_index as cpi,
           (e.project_id is not null) as evm_available,
           (select count(*)::int from pa where pa.project_id = p.id) as pending_approvals,
           (select count(*)::int from ncrs n where n.project_id = p.id and n.status <> 'closed') as open_ncrs,
           (select count(*)::int from punch_lists pl where pl.project_id = p.id and pl.status <> 'closed') as open_snags,
           (select count(*)::int from incidents i where i.project_id = p.id and i.severity in ('major','fatal')) as major_hse_incidents
    from projects p
    left join lateral (select * from evm_snapshots ev where ev.project_id=p.id order by ev.snapshot_date desc limit 1) e on true
    where p.org_id=$1 ${projectPredicate}
    order by p.project_name
  `, params);
  const [unscoped] = await query<{ n: number }>(`with pa as (${projectApprovalSql}) select count(*)::int as n from pa where pa.project_id is null`, [req.user!.org_id]);
  res.json({ success: true, data: rows, meta: { pending_approvals_without_project: unscoped.n } });
}));

// GC-10 (migration 065): frozen, reconciled and approved project report packs. Content is computed by the database;
// the API never accepts figures. Exceptions are listed for people to explain, never auto-corrected.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const packId = (v: string) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, 'Invalid id'); return n; };
async function pack(id: number, orgId: number) {
  const [p] = await query<any>(`select * from project_report_packs where id = $1 and org_id = $2`, [id, orgId]);
  if (!p) throw new AppError(404, 'Report pack not found');
  return p;
}
reportsRouter.post('/packs', authorize('reports', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ project_id: z.number().int().positive(), period_type: z.enum(['weekly', 'monthly']), period_start: isoDate, period_end: isoDate }).parse(req.body);
  const [p] = await query(`insert into project_report_packs(org_id, project_id, period_type, period_start, period_end, payload, payload_sha256, exception_count, prepared_by)
     values ($1, $2, $3, $4::date, $5::date, '{}'::jsonb, repeat('0', 64), 0, $6) returning *`, [req.user!.org_id, b.project_id, b.period_type, b.period_start, b.period_end, req.user!.id]);
  res.status(201).json({ success: true, data: p });
}));
reportsRouter.get('/packs', asyncHandler(async (req, res) => {
  const q = z.object({ project_id: z.coerce.number().int().positive().optional() }).parse(req.query);
  res.json({ success: true, data: await query(`select id, project_id, period_type, period_start, period_end, exception_count, status, prepared_by, captured_at, submitted_at, decided_by, decided_at, payload_sha256
     from project_report_packs where org_id = $1 and ($2::bigint is null or project_id = $2) order by period_end desc, id desc`, [req.user!.org_id, q.project_id ?? null]) });
}));
reportsRouter.get('/packs/:id', asyncHandler(async (req, res) => {
  const p = await pack(packId(req.params.id), req.user!.org_id);
  const [v] = await query<{ stored_hash_valid: boolean; live_hash: string }>(`select encode(sha256(convert_to(payload::text, 'UTF8')), 'hex') = payload_sha256 as stored_hash_valid,
       encode(sha256(convert_to(project_report_snapshot(project_id, period_start, period_end)::text, 'UTF8')), 'hex') as live_hash
     from project_report_packs where id = $1`, [p.id]);
  res.json({ success: true, data: { ...p, verification: { stored_hash_valid: v.stored_hash_valid, data_changed_since_freeze: v.live_hash !== p.payload_sha256 } } });
}));
reportsRouter.patch('/packs/:id/narrative', authorize('reports', 'edit'), asyncHandler(async (req, res) => {
  const b = z.object({ narrative: z.string().trim().min(1).max(20000) }).parse(req.body);
  const p = await pack(packId(req.params.id), req.user!.org_id);
  if (p.status !== 'draft') throw new AppError(409, 'The narrative is frozen once submitted');
  if (Number(p.prepared_by) !== req.user!.id) throw new AppError(403, 'Only the preparer writes the narrative');
  const [u] = await query(`update project_report_packs set narrative = $2 where id = $1 returning *`, [p.id, b.narrative]);
  res.json({ success: true, data: u });
}));
reportsRouter.post('/packs/:id/submit', authorize('reports', 'edit'), asyncHandler(async (req, res) => {
  const p = await pack(packId(req.params.id), req.user!.org_id);
  if (p.status !== 'draft') throw new AppError(409, 'Only a draft pack can be submitted');
  if (Number(p.prepared_by) !== req.user!.id) throw new AppError(403, 'Only the preparer submits the pack');
  if (p.exception_count > 0 && (p.narrative ?? '').trim().length < 20) throw new AppError(422, `Explain the ${p.exception_count} reconciliation exception(s) in the narrative before submitting`);
  const [u] = await query(`update project_report_packs set status = 'submitted', submitted_at = now() where id = $1 and status = 'draft' returning *`, [p.id]);
  res.json({ success: true, data: u });
}));
reportsRouter.post('/packs/:id/decision', authorize('reports', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ decision: z.enum(['approved', 'rejected']), reason: z.string().trim().max(4000).optional() }).parse(req.body);
  const p = await pack(packId(req.params.id), req.user!.org_id);
  if (p.status !== 'submitted') throw new AppError(409, 'Only a submitted pack can be decided');
  if (Number(p.prepared_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: the preparer cannot approve or reject own report pack');
  if (b.decision === 'rejected' && (b.reason ?? '').length < 5) throw new AppError(400, 'A rejected pack needs a reason');
  const [u] = await query(`update project_report_packs set status = $2::varchar, decided_by = $3, decided_at = now(), decision_reason = $4 where id = $1 and status = 'submitted' returning *`,
    [p.id, b.decision, req.user!.id, b.reason ?? null]);
  res.json({ success: true, data: u });
}));
