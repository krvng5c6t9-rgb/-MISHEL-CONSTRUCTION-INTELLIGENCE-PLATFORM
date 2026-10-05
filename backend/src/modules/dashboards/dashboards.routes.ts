import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

export const dashboardsRouter = Router();
dashboardsRouter.use(authorize('dashboards', 'view'));

const projectFilterSchema = z.object({
  project_id: z.coerce.number().int().positive().optional()
});

function projectWhere(projectId?: number, alias = 'p') {
  return projectId ? { clause: ` and ${alias}.id = $2`, params: [projectId] } : { clause: '', params: [] as number[] };
}

dashboardsRouter.get('/executive', asyncHandler(async (req, res) => {
  const { project_id } = projectFilterSchema.parse(req.query);
  const filter = projectWhere(project_id);
  const params = [req.user!.org_id, ...filter.params];

  const [portfolio, approvals, financial, quality, hse, schedule] = await Promise.all([
    query(`
      select p.id, p.project_code, p.project_name, p.status, p.current_contract_value,
             coalesce(v.percent_billed,0) as percent_billed,
             v.cost_performance_index, v.schedule_performance_index, v.snapshot_date
      from projects p
      left join v_portfolio_summary v on v.project_id = p.id
      where p.org_id = $1${filter.clause}
      order by p.project_name
    `, params),
    query(`
      select status, count(*)::int as count
      from approval_instances
      where org_id = $1 ${project_id ? 'and record_id is not null' : ''}
      group by status
      order by status
    `, [req.user!.org_id]),
    query(`
      select p.id as project_id, p.project_name,
             coalesce(ct.committed,0) as committed,
             coalesce(ct.actual,0) as actual,
             coalesce(ar.ar_open,0) as ar_open,
             coalesce(ap.ap_open,0) as ap_open
      from projects p
      left join lateral (
        select coalesce(sum(amount) filter (where transaction_type='committed'),0) as committed,
               coalesce(sum(amount) filter (where transaction_type='actual'),0) as actual
        from cost_transactions where project_id=p.id
      ) ct on true
      left join lateral (
        select coalesce(sum(amount) filter (where status <> 'paid'),0) as ar_open
        from accounts_receivable where project_id=p.id
      ) ar on true
      left join lateral (
        select coalesce(sum(amount) filter (where status <> 'paid'),0) as ap_open
        from accounts_payable where project_id=p.id
      ) ap on true
      where p.org_id = $1${filter.clause}
      order by p.project_name
    `, params),
    query(`
      select p.id as project_id, p.project_name,
             count(distinct ic.id)::int as inspections,
             count(distinct ic.id) filter (where ic.status='passed')::int as inspections_passed,
             count(distinct n.id) filter (where n.status <> 'closed')::int as open_ncrs
      from projects p
      left join inspection_checklists ic on ic.project_id=p.id
      left join ncrs n on n.project_id=p.id
      where p.org_id = $1${filter.clause}
      group by p.id, p.project_name
      order by p.project_name
    `, params),
    query(`
      select p.id as project_id, p.project_name,
             count(distinct i.id) filter (where i.severity in ('major','fatality'))::int as major_incidents,
             count(distinct ptw.id) filter (where ptw.status in ('requested','approved','active'))::int as active_ptw,
             count(distinct tt.id)::int as toolbox_talks
      from projects p
      left join incidents i on i.project_id=p.id
      left join permits_to_work ptw on ptw.project_id=p.id
      left join toolbox_talks tt on tt.project_id=p.id
      where p.org_id = $1${filter.clause}
      group by p.id, p.project_name
      order by p.project_name
    `, params),
    query(`
      select p.id as project_id, p.project_name,
             count(sa.id)::int as activities,
             count(sa.id) filter (where sa.percent_complete >= 100)::int as completed_activities,
             count(sa.id) filter (where sa.planned_finish < current_date and sa.percent_complete < 100)::int as delayed_activities
      from projects p
      left join schedule_activities sa on sa.project_id=p.id
      where p.org_id = $1${filter.clause}
      group by p.id, p.project_name
      order by p.project_name
    `, params)
  ]);

  res.json({ success: true, data: { portfolio, approvals, financial, quality, hse, schedule } });
}));

dashboardsRouter.get('/cost-control', asyncHandler(async (req, res) => {
  const { project_id } = projectFilterSchema.parse(req.query);
  const rows = await query(`
    select vcs.*
    from v_cost_control_summary vcs
    join projects p on p.id = vcs.project_id
    where p.org_id=$1 ${project_id ? 'and vcs.project_id=$2' : ''}
    order by vcs.project_id, vcs.code
  `, project_id ? [req.user!.org_id, project_id] : [req.user!.org_id]);
  res.json({ success: true, data: rows });
}));

dashboardsRouter.get('/portfolio', asyncHandler(async (req, res) => {
  const rows = await query(`
    select v.*
    from v_portfolio_summary v
    join projects p on p.id=v.project_id
    where p.org_id=$1
    order by p.project_name
  `, [req.user!.org_id]);
  res.json({ success: true, data: rows });
}));
