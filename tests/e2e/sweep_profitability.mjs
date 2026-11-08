// CC-091 / Stage 62 (A-006): profitability per project and for the company (GET /finance/profitability), checked against
// independent SQL on the records written by the earlier suites of this gate: recognised figures from the latest approved
// revenue run (a loss-making contract from sweep_revenue_recognition), forecast at completion only when every cost code
// with cost has an approved snapshot, actual / committed cost in the project currency, cash per currency, company totals
// per currency, the project filter, finance.view required and company isolation.
import { ADMIN, ADMIN_B, TAG, api, must, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const one = (text) => { const r = sql(OWNER, text); if (!r.ok) throw new Error(r.out.slice(0, 300)); return r.out; };
const nn = (v) => (v === '' ? null : v);
try {
  const admin = await login(ADMIN);
  const mkUser = async (key, perms) => {
    const role = must(await api('POST', '/roles', admin, { role_name: `PR ${key} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), 'role').id;
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id: role, full_name: `PR ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const fin = await mkUser('prfin', [['finance', 'view']]), dash = await mkUser('prdash', [['dashboards', 'view'], ['projects', 'view']]);
  const d = must(await api('GET', '/finance/profitability', fin), 'profitability');
  const byCode = (c) => d.projects.find(p => p.project_code === c);

  // --- Recognised position: the loss-making contract of sweep_revenue_recognition.
  const rv = byCode(`RV-${TAG}`);
  const [rRev, rCost, rProv, rProfit, rPos, rPrice, rAsOf] = one(`select cumulative_revenue::text, cost_to_date::text, loss_provision::text,
      (cumulative_revenue - cost_to_date - coalesce(loss_provision, 0))::text, contract_position::text, transaction_price::text, period_end::text
    from revenue_recognition_runs r join projects p on p.id = r.project_id where p.project_code = 'RV-${TAG}' and r.status = 'approved'
    order by r.period_end desc, r.id desc limit 1`).split('|');
  check('recognised revenue, its cost, onerous provision and contract position are those of the latest approved run',
    rv && rv.recognised_revenue === rRev && rv.recognised_cost === rCost && rv.loss_provision === nn(rProv) && rv.contract_position === rPos && rv.recognised_as_of === rAsOf,
    JSON.stringify(rv).slice(0, 300));
  check('recognised profit = revenue - cost - provision (a loss-making contract recognises its whole expected loss)', rv?.recognised_profit === rProfit && rProfit.startsWith('-'), `${rv?.recognised_profit} / ${rProfit}`);
  const rMargin = one(`select round((${rProfit}) * 100 / ${rRev}, 1)::text`);
  check('recognised margin on revenue, one decimal', rv?.recognised_margin_pct === rMargin, `${rv?.recognised_margin_pct} / ${rMargin}`);
  const [eac, missing] = one(`select coalesce(sum(eac), 0)::text, (select count(distinct t.cost_code_id) from cost_transactions t join projects p on p.id = t.project_id
      where p.project_code = 'RV-${TAG}' and not exists (select 1 from cost_forecast_snapshots s where s.project_id = t.project_id and s.cost_code_id = t.cost_code_id and s.approved_at is not null))
    from (select distinct on (s.cost_code_id) s.eac from cost_forecast_snapshots s join projects p on p.id = s.project_id where p.project_code = 'RV-${TAG}' and s.approved_at is not null
          order by s.cost_code_id, s.as_of desc, s.id desc) x`).split('|');
  check('at completion: price from the run, estimate at completion = latest approved snapshot per cost code, profit = price - EAC',
    missing === '0' && rv?.forecast_price === rPrice && rv?.price_from_run === true && rv?.eac === eac && rv?.forecast_profit === one(`select (${rPrice} - ${eac})::text`), `${rv?.forecast_price} ${rv?.eac} ${rv?.forecast_profit}`);

  // --- Forecast withheld when a cost code with cost has no approved snapshot.
  const gapCode = one(`select p.project_code from projects p where p.org_id = ${ADMIN.org_id} and exists (select 1 from cost_transactions t where t.project_id = p.id and t.cost_code_id is not null
      and not exists (select 1 from cost_forecast_snapshots s where s.project_id = t.project_id and s.cost_code_id = t.cost_code_id and s.approved_at is not null)) order by p.project_code limit 1`);
  const gap = byCode(gapCode);
  const gapCount = one(`select count(distinct t.cost_code_id) from cost_transactions t join projects p on p.id = t.project_id where p.project_code = '${gapCode}'
      and not exists (select 1 from cost_forecast_snapshots s where s.project_id = t.project_id and s.cost_code_id = t.cost_code_id and s.approved_at is not null)`);
  check('a project with cost on a cost code without an approved forecast shows no forecast, and how many cost codes are missing',
    gap && gap.eac === null && gap.forecast_profit === null && gap.forecast_margin_pct === null && String(gap.forecast_missing_cost_codes) === gapCount, `${gapCode}: ${JSON.stringify(gap).slice(0, 200)}`);
  const noRun = byCode(`P-${TAG}`);
  check('a project without an approved revenue run has no recognised figures (nothing estimated)', noRun && noRun.recognised_revenue === null && noRun.recognised_profit === null
    && one(`select count(*) from revenue_recognition_runs r join projects p on p.id = r.project_id where p.project_code = 'P-${TAG}' and r.status = 'approved'`) === '0');

  // --- Cost now, in the project currency.
  const bad = d.projects.filter(p => {
    const [a, c] = one(`select coalesce(sum(project_amount) filter (where transaction_type = 'actual'), 0)::text, coalesce(sum(project_amount) filter (where transaction_type = 'committed'), 0)::text
      from cost_transactions where project_id = ${p.id}`).split('|');
    return p.actual_cost !== a || p.committed_cost !== c;
  });
  check('actual and committed cost of every project = sum of its cost transactions in the project currency', d.projects.length > 5 && bad.length === 0, bad.map(p => p.project_code).join(',') || `${d.projects.length} projects`);
  check('every project of the company is listed, none of another company', d.projects.length === Number(one(`select count(*) from projects where org_id = ${ADMIN.org_id}`)));

  // --- Cash per currency.
  const cashSql = one(`select coalesce(sum(y.amount) filter (where y.payment_type = 'incoming'), 0)::text || '~' || coalesce(sum(y.amount) filter (where y.payment_type = 'outgoing'), 0)::text
    from payments y left join accounts_receivable ar on ar.id = y.related_ar_id left join accounts_payable ap on ap.id = y.related_ap_id
    join projects p on p.id = coalesce(ar.project_id, ap.project_id) where p.project_code = 'P-${TAG}' and y.status in ('posted', 'reconciled')`).split('~');
  const pCash = d.cash.filter(x => x.project_id === noRun.id);
  check('cash of a project: collected and paid from posted / reconciled receipts and payments, net = collected - paid',
    pCash.length >= 1 && pCash[0].collected === cashSql[0] && pCash[0].paid === cashSql[1] && pCash[0].net_cash === one(`select (${cashSql[0]} - ${cashSql[1]})::text`), `${JSON.stringify(pCash)} / ${cashSql}`);
  const billedSql = one(`select coalesce(sum(amount), 0)::text from accounts_receivable where project_id = ${noRun.id}`);
  check('billed of a project = its receivables', pCash[0]?.billed === billedSql, `${pCash[0]?.billed} / ${billedSql}`);

  // --- Company totals per currency.
  const [tRev, tProfit, tActual, tN] = one(`select coalesce(sum(cumulative_revenue), 0)::text, coalesce(sum(cumulative_revenue - cost_to_date - coalesce(loss_provision, 0)), 0)::text,
      (select coalesce(sum(t.project_amount) filter (where t.transaction_type = 'actual'), 0)::text from cost_transactions t join projects p on p.id = t.project_id join currencies c on c.id = p.currency_id where t.org_id = ${ADMIN.org_id} and c.code = 'EGP'),
      count(*)::text
    from (select distinct on (r.contract_id) r.* from revenue_recognition_runs r join projects p on p.id = r.project_id join currencies c on c.id = p.currency_id
          where r.org_id = ${ADMIN.org_id} and r.status = 'approved' and c.code = 'EGP' order by r.contract_id, r.period_end desc, r.id desc) x`).split('|');
  const egp = d.totals.find(x => x.currency === 'EGP');
  check('company totals (EGP): recognised revenue, recognised profit and actual cost are the database sums; projects counted with the figure',
    egp && (egp.recognised_revenue ?? '0') === tRev && (egp.recognised_profit ?? '0') === tProfit && egp.actual_cost === tActual && String(egp.projects_recognised) === tN, `${JSON.stringify(egp).slice(0, 260)} / ${tRev} ${tProfit} ${tActual} ${tN}`);
  check('company totals are per currency (no line adds two currencies)', new Set(d.totals.map(x => x.currency)).size === d.totals.length && d.totals.every(x => /^[A-Z]{3}$/.test(x.currency)));
  const cashEgp = d.cash_totals.find(x => x.currency === 'EGP');
  check('company cash (EGP) = sum of the projects\' cash lines', cashEgp && cashEgp.net_cash === one(`select (${d.cash.filter(x => x.currency === 'EGP').map(x => x.net_cash).join(' + ') || '0'})::text`));

  // --- Filter, permission, isolation.
  const f = must(await api('GET', `/finance/profitability?project_id=${rv.id}`, fin), 'filtered');
  check('project filter returns that project only, with the same figures', f.projects.length === 1 && f.projects[0].recognised_profit === rv.recognised_profit && f.cash.every(x => x.project_id === rv.id));
  await expectStatus('profitability needs finance.view (dashboards and projects are not enough)', () => api('GET', '/finance/profitability', dash), 403);
  const b = must(await api('GET', '/finance/profitability', await login(ADMIN_B)), 'company B');
  check('the other company sees only its own projects', b.projects.every(p => !d.projects.some(q => q.id === p.id)) && b.projects.length === Number(one(`select count(*) from projects where org_id = ${ADMIN_B.org_id}`)));
  const bFilter = must(await api('GET', `/finance/profitability?project_id=${rv.id}`, await login(ADMIN_B)), 'B filter');
  check('the other company asking for this company\'s project gets nothing', bFilter.projects.length === 0 && bFilter.cash.length === 0);
} catch (e) {
  check('suite completed', false, e.message.slice(0, 300));
}
finish('sweep_profitability');
