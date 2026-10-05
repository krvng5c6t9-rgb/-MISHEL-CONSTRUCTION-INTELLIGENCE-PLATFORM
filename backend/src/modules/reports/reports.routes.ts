import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

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

reportsRouter.get('/weekly-executive', asyncHandler(async (req, res) => {
  const q = reportQuery.parse(req.query);
  const projectPredicate = q.project_id ? 'and p.id=$2' : '';
  const params = q.project_id ? [req.user!.org_id, q.project_id] : [req.user!.org_id];
  const rows = await query(`
    select p.id as project_id, p.project_name, p.status,
           coalesce(e.schedule_performance_index,0) as spi,
           coalesce(e.cost_performance_index,0) as cpi,
           count(distinct ai.id) filter (where ai.status='pending')::int as pending_approvals,
           count(distinct n.id) filter (where n.status <> 'closed')::int as open_ncrs,
           count(distinct pl.id) filter (where pl.status <> 'closed')::int as open_snags,
           count(distinct i.id) filter (where i.severity in ('major','fatal'))::int as major_hse_incidents
    from projects p
    left join lateral (select * from evm_snapshots ev where ev.project_id=p.id order by ev.snapshot_date desc limit 1) e on true
    left join approval_instances ai on ai.org_id=p.org_id and ai.status='pending'
    left join ncrs n on n.project_id=p.id
    left join punch_lists pl on pl.project_id=p.id
    left join incidents i on i.project_id=p.id
    where p.org_id=$1 ${projectPredicate}
    group by p.id, p.project_name, p.status, e.schedule_performance_index, e.cost_performance_index
    order by p.project_name
  `, params);
  res.json({ success: true, data: rows });
}));
