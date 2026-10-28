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
      select p.id, p.project_code, p.project_name, p.status, p.current_contract_value, pc.code as currency_code,
             coalesce(v.percent_billed,0) as percent_billed,
             v.cost_performance_index, v.schedule_performance_index, v.snapshot_date
      from projects p
      left join v_portfolio_summary v on v.project_id = p.id
      left join currencies pc on pc.id = p.currency_id
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
    // CC-075: one row per project and currency - committed / actual cost and open AR / AP were summed per project
    // across currencies (cost transactions, receivables and payables each carry their own currency).
    query(`
      select p.id as project_id, p.project_code, p.project_name, cur.code as currency_code,
             sum(x.committed) as committed,
             sum(x.actual) as actual,
             sum(x.ar_open) as ar_open,
             sum(x.ap_open) as ap_open
      from projects p
      join (
        select project_id, currency_id,
               case when transaction_type='committed' then amount else 0 end as committed,
               case when transaction_type='actual' then amount else 0 end as actual,
               0::numeric as ar_open, 0::numeric as ap_open
        from cost_transactions
        union all
        select project_id, currency_id, 0, 0, case when status <> 'paid' then amount else 0 end, 0 from accounts_receivable
        union all
        select project_id, currency_id, 0, 0, 0, case when status <> 'paid' then amount else 0 end from accounts_payable
      ) x on x.project_id = p.id
      join currencies cur on cur.id = x.currency_id
      where p.org_id = $1${filter.clause}
      group by p.id, p.project_code, p.project_name, cur.code
      order by p.project_name, cur.code
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

// CC-087 (R1.6, MP-06 §5): owner portfolio v1 from existing data. Every figure is computed by the database from stored
// records (sums as text, never across currencies); a section is returned only to a user holding the view permission of
// the module that owns its records, and the sections withheld are named. Not available yet (no source data / engine):
// PV / EV / AC unless an EVM snapshot exists, cash position and forecast, staffing gap, % planned vs % actual progress,
// red / amber / green (thresholds are company settings not yet built).
const can = (req: any, module: string) => (req.user?.permissions ?? []).some((p: any) => p.module === module && p.action === 'view');
const SECTIONS = { money: 'finance', evm: 'cost_control', forecast: 'cost_control', schedule: 'planning', risks: 'projects', ncrs: 'qaqc', incidents: 'hse', tenders: 'tendering' } as const;
type Section = keyof typeof SECTIONS;

dashboardsRouter.get('/owner-portfolio', asyncHandler(async (req, res) => {
  const org = req.user!.org_id;
  const allowed = Object.fromEntries(Object.entries(SECTIONS).map(([s, m]) => [s, can(req, m)])) as Record<Section, boolean>;
  const when = async <T>(s: Section, fn: () => Promise<T>): Promise<T | null> => (allowed[s] ? fn() : null);
  const byProject = <T extends { project_id: unknown }>(rows: T[] | null) => {
    const m = new Map<string, T[]>(); for (const r of rows ?? []) m.set(String(r.project_id), [...(m.get(String(r.project_id)) ?? []), r]); return m;
  };
  const [asOf, projects, statusCounts, contractTotals, money, moneyTotals, certified, evm, forecast, schedule, risks, ncrs, incidents, tenders, alerts] = await Promise.all([
    query<{ as_of: string; today: string }>(`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') as as_of, current_date::text as today`),
    query<any>(`select p.id, p.project_code, p.project_name, p.status, cur.code as currency, p.current_contract_value::text as contract_value,
        p.start_date::text, p.planned_end_date::text
      from projects p left join currencies cur on cur.id = p.currency_id where p.org_id = $1 order by p.project_code`, [org]),
    query(`select status, count(*)::int as count from projects where org_id = $1 group by status order by status`, [org]),
    query(`select cur.code as currency, sum(p.current_contract_value)::text as contract_value, count(*)::int as projects
      from projects p join currencies cur on cur.id = p.currency_id where p.org_id = $1 and p.status not in ('closed', 'cancelled')
      group by cur.code order by cur.code`, [org]),
    // Billed = receivables raised; collected = cash of posted / reconciled receipts and, apart, the tax the client withheld on
    // them (DEC-017); outstanding / overdue from receivable_aging (billed less cash and tax withheld).
    when('money', () => query<any>(`
      with b as (select ar.project_id, ar.currency_id, sum(ar.amount) as billed from accounts_receivable ar where ar.org_id = $1 group by 1, 2),
           c as (select ar.project_id, y.currency_id, sum(y.amount) as collected, sum(y.withheld_tax_amount) as withheld from payments y join accounts_receivable ar on ar.id = y.related_ar_id
                  where y.org_id = $1 and y.status in ('posted', 'reconciled') group by 1, 2),
           o as (select a.project_id, ar.currency_id, sum(a.outstanding) as outstanding, sum(a.outstanding) filter (where a.aging_basis = 'overdue') as overdue
                  from receivable_aging(current_date) a join accounts_receivable ar on ar.id = a.receivable_id where ar.org_id = $1 group by 1, 2)
      select coalesce(b.project_id, c.project_id, o.project_id) as project_id, cur.code as currency, coalesce(b.billed, 0)::text as billed,
             coalesce(c.collected, 0)::text as collected, coalesce(c.withheld, 0)::text as withheld, coalesce(o.outstanding, 0)::text as outstanding,
             coalesce(o.overdue, 0)::text as overdue
        from b full join c on c.project_id = b.project_id and c.currency_id = b.currency_id
        full join o on o.project_id = coalesce(b.project_id, c.project_id) and o.currency_id = coalesce(b.currency_id, c.currency_id)
        join currencies cur on cur.id = coalesce(b.currency_id, c.currency_id, o.currency_id) order by 1, 2`, [org])),
    when('money', () => query(`
      with b as (select currency_id, sum(amount) as billed from accounts_receivable where org_id = $1 group by 1),
           c as (select y.currency_id, sum(y.amount) as collected, sum(y.withheld_tax_amount) as withheld from payments y where y.org_id = $1 and y.payment_type = 'incoming' and y.status in ('posted', 'reconciled') group by 1),
           o as (select ar.currency_id, sum(a.outstanding) as outstanding, sum(a.outstanding) filter (where a.aging_basis = 'overdue') as overdue
                  from receivable_aging(current_date) a join accounts_receivable ar on ar.id = a.receivable_id where ar.org_id = $1 group by 1)
      select cur.code as currency, coalesce(b.billed, 0)::text as billed, coalesce(c.collected, 0)::text as collected, coalesce(c.withheld, 0)::text as withheld,
             coalesce(o.outstanding, 0)::text as outstanding, coalesce(o.overdue, 0)::text as overdue
        from b full join c on c.currency_id = b.currency_id full join o on o.currency_id = coalesce(b.currency_id, c.currency_id)
        join currencies cur on cur.id = coalesce(b.currency_id, c.currency_id, o.currency_id) order by 1`, [org])),
    when('money', () => query<any>(`select i.project_id, sum(i.client_certified_amount)::text as certified, count(*)::int as ipcs
      from ipcs i where i.org_id = $1 and i.status in ('client_approved', 'posted', 'paid') group by 1`, [org])),
    when('evm', () => query<any>(`select distinct on (e.project_id) e.project_id, e.snapshot_date::text, e.planned_value::text as pv, e.earned_value::text as ev,
        e.actual_cost::text as ac, e.schedule_performance_index::text as spi, e.cost_performance_index::text as cpi, e.estimate_at_completion::text as eac
      from evm_snapshots e where e.org_id = $1 order by e.project_id, e.snapshot_date desc, e.id desc`, [org])),
    // Latest approved cost forecast per project and cost code (the AL-07 source), summed per project.
    when('forecast', () => query<any>(`select f.project_id, max(f.as_of)::text as as_of, sum(f.budget)::text as budget, sum(f.eac)::text as eac, count(*)::int as cost_codes
      from (select distinct on (s.project_id, s.cost_code_id) s.* from cost_forecast_snapshots s where s.org_id = $1 and s.approved_at is not null
             order by s.project_id, s.cost_code_id, s.as_of desc, s.id desc) f group by f.project_id`, [org])),
    when('schedule', () => query<any>(`select project_id, count(*)::int as activities, count(*) filter (where percent_complete >= 100)::int as completed,
        count(*) filter (where planned_finish < current_date and coalesce(percent_complete, 0) < 100)::int as late
      from schedule_activities where org_id = $1 group by project_id`, [org])),
    when('risks', () => query<any>(`select distinct on (project_id) project_id, count(*) over (partition by project_id)::int as open_risks, risk_no as top_risk_no,
        title as top_risk_title, score::int as top_score
      from risks where org_id = $1 and project_id is not null and status <> 'closed' order by project_id, score desc nulls last, id`, [org])),
    when('ncrs', () => query<any>(`select project_id, count(*)::int as open_ncrs from ncrs where org_id = $1 and status <> 'closed' group by project_id`, [org])),
    when('incidents', () => query<any>(`select project_id, count(*)::int as incidents, count(*) filter (where closed_at is null)::int as open_incidents
      from incidents where org_id = $1 group by project_id`, [org])),
    when('tenders', () => query(`select status, count(*)::int as count from tenders where org_id = $1 group by status order by status`, [org])),
    // The viewer's own unread notifications by alert (the alert engine already applies view permissions per record).
    query(`select alert_code, count(*)::int as unread from notifications where user_id = $1 and is_read = false and alert_code is not null group by alert_code order by alert_code`, [req.user!.id])
  ]);
  const M = byProject(money), C = byProject(certified), E = byProject(evm), F = byProject(forecast), S = byProject(schedule), R = byProject(risks),
    N = byProject(ncrs), I = byProject(incidents);
  const one = (m: Map<string, any[]>, id: string, allowedSection: boolean) => (allowedSection ? m.get(id)?.[0] ?? null : undefined);
  res.json({ success: true, data: {
    as_of: asOf[0].as_of, today: asOf[0].today,
    withheld: (Object.keys(SECTIONS) as Section[]).filter(s => !allowed[s]).map(s => ({ section: s, permission: `${SECTIONS[s]}.view` })),
    status_counts: statusCounts, contract_totals: contractTotals, money_totals: moneyTotals, tenders, alerts,
    projects: projects.map(p => { const id = String(p.id); return { ...p,
      money: allowed.money ? M.get(id) ?? [] : undefined, certified: one(C, id, allowed.money), evm: one(E, id, allowed.evm), forecast: one(F, id, allowed.forecast),
      schedule: one(S, id, allowed.schedule), risks: one(R, id, allowed.risks), ncrs: one(N, id, allowed.ncrs), incidents: one(I, id, allowed.incidents) }; })
  } });
}));
