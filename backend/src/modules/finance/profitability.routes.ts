import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

// CC-091 (Stage 62, A-006 / COMPETITOR_SCAN_002): profitability per project and for the company, from the records only.
// Every figure is computed by the database (amounts returned as text); amounts of different currencies are never added.
//  * Recognised position (accounting basis, DEC-009): the latest APPROVED revenue run of each contract of the project -
//    cumulative revenue and the cost to date of the same run (so both are as of the same date), recognised profit =
//    revenue - cost - onerous provision, margin on revenue, contract position (asset = under-billed, liability =
//    over-billed). No approved run -> no recognised figures (nothing is estimated).
//  * Forecast at completion: transaction price of that run (contract value + agreed variations + approved estimates), or
//    the project's current contract value when there is no run, less the estimate at completion = sum of the latest
//    approved cost snapshot per cost code. As in the revenue run, a forecast needs an approved snapshot for EVERY cost code
//    that has cost; otherwise no forecast is shown and the number of cost codes without one is returned (a partial EAC
//    would overstate the profit).
//  * Cost now: actual and committed cost transactions in the project currency (DEC-021, frozen rates).
//  * Cash, per currency: billed (receivables), collected (posted / reconciled receipts), paid (posted / reconciled
//    payments of payables of the project) and net cash = collected - paid.
export const profitabilityRouter = Router();
profitabilityRouter.use(authorize('finance', 'view'));

profitabilityRouter.get('/profitability', asyncHandler(async (req, res) => {
  const { project_id } = z.object({ project_id: z.coerce.number().int().positive().optional() }).parse(req.query);
  const org = Number(req.user!.org_id);
  const params: unknown[] = [org];
  if (project_id) params.push(project_id);
  const onlyProject = project_id ? 'and p.id = $2' : '';

  const projects = await query<any>(`
    with runs as (
      select distinct on (r.contract_id) r.* from revenue_recognition_runs r
       where r.org_id = $1 and r.status = 'approved' order by r.contract_id, r.period_end desc, r.id desc),
    rec as (
      select project_id, max(period_end) as as_of, count(*)::int as contracts, sum(transaction_price) as price, sum(cumulative_revenue) as revenue,
             sum(cost_to_date) as cost, sum(loss_provision) as provision, sum(contract_position) as position, avg(progress) as progress
        from runs group by project_id),
    fca as (
      select project_id, max(as_of) as as_of, sum(budget) as budget, sum(eac) as eac, count(*)::int as cost_codes
        from (select distinct on (s.project_id, s.cost_code_id) s.* from cost_forecast_snapshots s
               where s.org_id = $1 and s.approved_at is not null order by s.project_id, s.cost_code_id, s.as_of desc, s.id desc) x
       group by project_id),
    gaps as (
      select t.project_id, count(distinct t.cost_code_id)::int as missing from cost_transactions t
       where t.org_id = $1 and t.cost_code_id is not null and not exists (select 1 from cost_forecast_snapshots s
             where s.org_id = $1 and s.project_id = t.project_id and s.cost_code_id = t.cost_code_id and s.approved_at is not null)
       group by t.project_id),
    fc as (
      select fa.* from fca fa left join gaps g on g.project_id = fa.project_id where coalesce(g.missing, 0) = 0),
    cost as (
      select project_id, sum(project_amount) filter (where transaction_type = 'actual') as actual,
             sum(project_amount) filter (where transaction_type = 'committed') as committed
        from cost_transactions where org_id = $1 group by project_id)
    select p.id, p.project_code, p.project_name, p.status, cur.code as currency, p.current_contract_value::text as contract_value,
           rec.as_of::text as recognised_as_of, rec.contracts as recognised_contracts,
           rec.revenue::text as recognised_revenue, rec.cost::text as recognised_cost, rec.provision::text as loss_provision,
           (rec.revenue - rec.cost - coalesce(rec.provision, 0))::text as recognised_profit,
           case when rec.revenue > 0 then round((rec.revenue - rec.cost - coalesce(rec.provision, 0)) * 100 / rec.revenue, 1)::text end as recognised_margin_pct,
           round(rec.progress * 100, 1)::text as progress_pct, rec.position::text as contract_position,
           coalesce(rec.price, p.current_contract_value)::text as forecast_price, (rec.price is not null) as price_from_run,
           fc.as_of::text as forecast_as_of, fc.budget::text as budget, fc.eac::text as eac,
           (coalesce(rec.price, p.current_contract_value) - fc.eac)::text as forecast_profit,
           case when coalesce(rec.price, p.current_contract_value) > 0 and fc.eac is not null
                then round((coalesce(rec.price, p.current_contract_value) - fc.eac) * 100 / coalesce(rec.price, p.current_contract_value), 1)::text end as forecast_margin_pct,
           (fc.budget - fc.eac)::text as cost_variance,
           coalesce(gaps.missing, 0) as forecast_missing_cost_codes,
           coalesce(cost.actual, 0)::text as actual_cost, coalesce(cost.committed, 0)::text as committed_cost
      from projects p join currencies cur on cur.id = p.currency_id
      left join rec on rec.project_id = p.id left join fc on fc.project_id = p.id left join gaps on gaps.project_id = p.id left join cost on cost.project_id = p.id
     where p.org_id = $1 ${onlyProject}
     order by p.project_code`, params);

  const cash = await query<any>(`
    with b as (select ar.project_id, ar.currency_id, sum(ar.amount) as billed from accounts_receivable ar where ar.org_id = $1 group by 1, 2),
         c as (select ar.project_id, y.currency_id, sum(y.amount) as collected from payments y join accounts_receivable ar on ar.id = y.related_ar_id
                where y.org_id = $1 and y.payment_type = 'incoming' and y.status in ('posted', 'reconciled') group by 1, 2),
         d as (select ap.project_id, y.currency_id, sum(y.amount) as paid from payments y join accounts_payable ap on ap.id = y.related_ap_id
                where y.org_id = $1 and y.payment_type = 'outgoing' and y.status in ('posted', 'reconciled') group by 1, 2),
         k as (select project_id, currency_id from b union select project_id, currency_id from c union select project_id, currency_id from d)
    select k.project_id, cur.code as currency, coalesce(b.billed, 0)::text as billed, coalesce(c.collected, 0)::text as collected,
           coalesce(d.paid, 0)::text as paid, (coalesce(c.collected, 0) - coalesce(d.paid, 0))::text as net_cash
      from k join currencies cur on cur.id = k.currency_id join projects p on p.id = k.project_id and p.org_id = $1 ${onlyProject}
      left join b on b.project_id = k.project_id and b.currency_id = k.currency_id
      left join c on c.project_id = k.project_id and c.currency_id = k.currency_id
      left join d on d.project_id = k.project_id and d.currency_id = k.currency_id
     where k.project_id is not null
     order by k.project_id, cur.code`, params);

  // Company totals per currency (project currency for the project figures, payment currency for cash). A total covers
  // only the projects that have the figure; the count says how many.
  const totals = await query<any>(`
    with x as (select * from json_to_recordset($1::json) as t(currency text, contract_value numeric, recognised_revenue numeric, recognised_cost numeric,
                 recognised_profit numeric, forecast_price numeric, eac numeric, forecast_profit numeric, actual_cost numeric, committed_cost numeric))
    select currency, count(*)::int as projects, sum(contract_value)::text as contract_value,
           count(recognised_revenue)::int as projects_recognised, sum(recognised_revenue)::text as recognised_revenue, sum(recognised_cost)::text as recognised_cost,
           sum(recognised_profit)::text as recognised_profit,
           case when sum(recognised_revenue) > 0 then round(sum(recognised_profit) * 100 / sum(recognised_revenue), 1)::text end as recognised_margin_pct,
           count(eac)::int as projects_forecast, sum(forecast_price) filter (where eac is not null)::text as forecast_price, sum(eac)::text as eac,
           sum(forecast_profit)::text as forecast_profit,
           case when sum(forecast_price) filter (where eac is not null) > 0 then round(sum(forecast_profit) * 100 / sum(forecast_price) filter (where eac is not null), 1)::text end as forecast_margin_pct,
           sum(actual_cost)::text as actual_cost, sum(committed_cost)::text as committed_cost
      from x group by currency order by currency`, [JSON.stringify(projects)]);
  const cashTotals = await query<any>(`
    select currency, sum(billed)::text as billed, sum(collected)::text as collected, sum(paid)::text as paid, sum(net_cash)::text as net_cash
      from json_to_recordset($1::json) as t(currency text, billed numeric, collected numeric, paid numeric, net_cash numeric)
     group by currency order by currency`, [JSON.stringify(cash)]);

  const [cut] = await query<any>(`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') as at`);
  res.json({ success: true, data: { as_of: cut.at, projects, cash, totals, cash_totals: cashTotals } });
}));
