// CC-087 / R1.6 (MP-06 §5): owner portfolio v1. Every figure the API returns is compared with the same figure computed
// here by SQL from the records written by the earlier suites of this gate. An earned-value snapshot has no writer in the
// application yet, so one is inserted by SQL as a TEST FIXTURE and removed at the end. Sections are checked against
// the viewer's permissions, and the other company's projects never appear.
import { ADMIN, ADMIN_B, TAG, api, must, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const one = (text) => { const r = sql(OWNER, text); if (!r.ok) throw new Error(r.out.slice(0, 300)); return r.out; };
const rows = (text) => { const out = one(text); return out ? out.split('\n').map(l => l.split('|')) : []; };
// Numeric equality in the database; an empty psql field and a JSON null both mean no value.
const lit = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${v}'`);
const eq = (a, b) => one(`select ${lit(a)}::numeric is not distinct from ${lit(b)}::numeric`) === 't';
const cleanup = [];
try {
  const admin = await login(ADMIN);
  const mkUser = async (key, perms) => {
    const role = must(await api('POST', '/roles', admin, { role_name: `PF ${key} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), 'role').id;
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    const created = must(await api('POST', '/users', admin, { role_id: role, full_name: `PF ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return { id: Number(created.id), token: await login(u) };
  };
  const pf = async (token) => must(await api('GET', '/dashboards/owner-portfolio', token), 'portfolio');
  const org = ADMIN.org_id;

  // --- EVM fixture: one snapshot for the first project that has none (no writer in the application yet).
  const evmProject = one(`select p.id from projects p where p.org_id = ${org} and not exists (select 1 from evm_snapshots e where e.project_id = p.id) order by p.id limit 1`);
  const before = await pf(admin);
  check('a project without an earned-value snapshot shows none (nothing is estimated)', before.projects.find(p => String(p.id) === evmProject)?.evm === null);
  const evmId = one(`insert into evm_snapshots(org_id, project_id, snapshot_date, planned_value, earned_value, actual_cost, estimate_at_completion, calculation_notes)
    values (${org}, ${evmProject}, current_date, 1000.00, 900.00, 950.00, 10555.00, 'TEST FIXTURE ${TAG}') returning id`).split('\n')[0];
  cleanup.push(`delete from evm_snapshots where id = ${evmId}`);

  const d = await pf(admin);
  check('cut-off time is stated', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/.test(d.as_of), d.as_of);
  check('an administrator holding every permission sees every section', d.withheld.length === 0, JSON.stringify(d.withheld));

  const sc = rows(`select status, count(*) from projects where org_id = ${org} group by status order by status`);
  check('projects by status equal the database counts', JSON.stringify(d.status_counts.map(s => [s.status, String(s.count)])) === JSON.stringify(sc), JSON.stringify(d.status_counts));
  const ids = rows(`select id from projects where org_id = ${org} order by project_code`).map(r => r[0]);
  check('every project of the company is listed, and only those', JSON.stringify(d.projects.map(p => String(p.id))) === JSON.stringify(ids), `${d.projects.length} / ${ids.length}`);

  const ct = rows(`select cur.code, sum(p.current_contract_value), count(*) from projects p join currencies cur on cur.id = p.currency_id where p.org_id = ${org} and p.status not in ('closed', 'cancelled') group by cur.code order by cur.code`);
  check('contract value of active projects per currency equals the database sum', ct.length === d.contract_totals.length && ct.every(([c, v, n], i) => d.contract_totals[i].currency === c && eq(d.contract_totals[i].contract_value, v) && String(d.contract_totals[i].projects) === n),
    JSON.stringify(d.contract_totals));

  const mt = rows(`select cur.code, coalesce((select sum(amount) from accounts_receivable where org_id = ${org} and currency_id = cur.id), 0),
      coalesce((select sum(amount) from payments where org_id = ${org} and payment_type = 'incoming' and status in ('posted', 'reconciled') and currency_id = cur.id), 0),
      coalesce((select sum(withheld_tax_amount) from payments where org_id = ${org} and payment_type = 'incoming' and status in ('posted', 'reconciled') and currency_id = cur.id), 0),
      coalesce((select sum(a.outstanding) from receivable_aging(current_date) a join accounts_receivable ar on ar.id = a.receivable_id where ar.org_id = ${org} and ar.currency_id = cur.id), 0),
      coalesce((select sum(a.outstanding) from receivable_aging(current_date) a join accounts_receivable ar on ar.id = a.receivable_id where ar.org_id = ${org} and ar.currency_id = cur.id and a.aging_basis = 'overdue'), 0)
    from currencies cur where exists (select 1 from accounts_receivable where org_id = ${org} and currency_id = cur.id) or exists (select 1 from payments where org_id = ${org} and payment_type = 'incoming' and currency_id = cur.id and status in ('posted', 'reconciled'))
    order by cur.code`);
  check('company billed / collected / tax withheld / outstanding / overdue per currency equal the database (receivable aging)',
    mt.length === d.money_totals.length && mt.every(([c, b, col, w, o, ov], i) => { const m = d.money_totals[i]; return m.currency === c && eq(m.billed, b) && eq(m.collected, col) && eq(m.withheld, w) && eq(m.outstanding, o) && eq(m.overdue, ov); }),
    JSON.stringify(d.money_totals));
  check('no currency appears twice in the company totals (amounts never added across currencies)', new Set(d.money_totals.map(m => m.currency)).size === d.money_totals.length);

  const withMoney = d.projects.find(p => p.money?.some(m => Number(m.billed) > 0));
  const pm = rows(`select cur.code, sum(ar.amount) from accounts_receivable ar join currencies cur on cur.id = ar.currency_id where ar.project_id = ${withMoney.id} group by cur.code order by cur.code`);
  const po = one(`select coalesce(sum(a.outstanding), 0) from receivable_aging(current_date) a where a.project_id = ${withMoney.id}`);
  check('a project\'s billed per currency and outstanding equal the database', pm.every(([c, b]) => eq(withMoney.money.find(m => m.currency === c)?.billed, b))
    && eq(withMoney.money.reduce((s, m) => s + Number(m.outstanding), 0).toFixed(2), po), `${withMoney.project_code} ${JSON.stringify(withMoney.money)}`);
  const certRow = d.projects.find(p => p.certified);
  check('certified by client equals the sum of client-certified IPC amounts (approved, posted, paid)',
    !!certRow && eq(certRow.certified.certified, one(`select sum(client_certified_amount) from ipcs where project_id = ${certRow.id} and status in ('client_approved', 'posted', 'paid')`)), certRow?.project_code);

  // The indices are computed by the database (generated columns): compared with the stored values.
  const ev = d.projects.find(p => String(p.id) === evmProject)?.evm;
  const [spi, cpi] = one(`select schedule_performance_index, cost_performance_index from evm_snapshots where id = ${evmId}`).split('|');
  check('the latest earned-value snapshot is shown as stored (indices as computed by the database)', !!ev && eq(ev.pv, '1000') && eq(ev.ev, '900') && eq(ev.ac, '950') && ev.spi === spi && ev.cpi === cpi && eq(ev.eac, '10555'), JSON.stringify(ev));

  const fc = rows(`select f.project_id, sum(f.budget), sum(f.eac) from (select distinct on (s.project_id, s.cost_code_id) s.* from cost_forecast_snapshots s
    where s.org_id = ${org} and s.approved_at is not null order by s.project_id, s.cost_code_id, s.as_of desc, s.id desc) f group by f.project_id order by 1`);
  check('approved cost forecast per project (latest per cost code) equals the database', fc.length > 0 && fc.every(([p, b, e]) => { const f = d.projects.find(x => String(x.id) === p)?.forecast; return f && eq(f.budget, b) && eq(f.eac, e); }),
    `${fc.length} projects`);

  const rk = rows(`select distinct on (project_id) project_id, count(*) over (partition by project_id), max(score) over (partition by project_id) from risks
    where org_id = ${org} and project_id is not null and status <> 'closed' order by project_id`);
  check('open risks and the highest score per project equal the register', rk.length > 0 && rk.every(([p, n, s]) => { const r = d.projects.find(x => String(x.id) === p)?.risks; return r && String(r.open_risks) === n && String(r.top_score) === s; }),
    `${rk.length} projects`);
  const nc = rows(`select project_id, count(*) from ncrs where org_id = ${org} and status <> 'closed' group by 1`);
  check('open NCRs per project equal the database', nc.every(([p, n]) => String(d.projects.find(x => String(x.id) === p)?.ncrs?.open_ncrs) === n), `${nc.length} projects`);
  const inc = rows(`select project_id, count(*), count(*) filter (where closed_at is null) from incidents where org_id = ${org} group by 1`);
  check('incidents (total / open) per project equal the database', inc.length > 0 && inc.every(([p, n, o]) => { const x = d.projects.find(y => String(y.id) === p)?.incidents; return x && String(x.incidents) === n && String(x.open_incidents) === o; }),
    `${inc.length} projects`);
  const sa = rows(`select project_id, count(*), count(*) filter (where planned_finish < current_date and coalesce(percent_complete, 0) < 100) from schedule_activities where org_id = ${org} group by 1`);
  check('activities (total / late) per project equal the database', sa.every(([p, n, l]) => { const x = d.projects.find(y => String(y.id) === p)?.schedule; return x && String(x.activities) === n && String(x.late) === l; }), `${sa.length} projects`);
  const td = rows(`select status, count(*) from tenders where org_id = ${org} group by status order by status`);
  check('tender pipeline equals the tender register', JSON.stringify(d.tenders.map(s => [s.status, String(s.count)])) === JSON.stringify(td), JSON.stringify(d.tenders));
  const adminId = one(`select id from users where email = '${ADMIN.email}'`);
  const al = rows(`select alert_code, count(*) from notifications where user_id = ${adminId} and is_read = false and alert_code is not null group by 1 order by 1`);
  check('alerts are the viewer\'s own unread notifications by alert', JSON.stringify(d.alerts.map(a => [a.alert_code, String(a.unread)])) === JSON.stringify(al), JSON.stringify(d.alerts));

  // --- Permissions: sections follow the module of their records.
  const dash = await mkUser('pfdash', [['dashboards', 'view']]);
  const dd = await pf(dash.token);
  check('a viewer with the dashboard permission only: every section is withheld and named with its permission',
    JSON.stringify(dd.withheld.map(w => `${w.section}:${w.permission}`)) === JSON.stringify(['money:finance.view', 'evm:cost_control.view', 'forecast:cost_control.view', 'schedule:planning.view', 'risks:projects.view', 'ncrs:qaqc.view', 'incidents:hse.view', 'tenders:tendering.view']),
    JSON.stringify(dd.withheld));
  check('... and no withheld figure is sent', dd.money_totals === null && dd.tenders === null && dd.projects.every(p => !('money' in p) && !('evm' in p) && !('risks' in p) && !('ncrs' in p) && !('incidents' in p) && !('certified' in p)),
    JSON.stringify(dd.projects[0]));
  const finUser = await mkUser('pffin', [['dashboards', 'view'], ['finance', 'view']]);
  const df = await pf(finUser.token);
  check('with finance.view the commercial figures are sent, the others still withheld', df.money_totals?.length === d.money_totals.length && df.projects.some(p => p.money?.length) && df.withheld.length === 7 && !df.withheld.some(w => w.section === 'money'));
  await expectStatus('the portfolio needs the dashboard permission', async () => api('GET', '/dashboards/owner-portfolio', (await mkUser('pfnone', [['finance', 'view']])).token), 403);

  // --- Tenant isolation.
  const b = await pf(await login(ADMIN_B));
  const bIds = rows(`select id from projects where org_id = ${ADMIN_B.org_id} order by project_code`).map(r => r[0]);
  check('the other company sees only its own projects', JSON.stringify(b.projects.map(p => String(p.id))) === JSON.stringify(bIds) && !b.projects.some(p => ids.includes(String(p.id))), `${b.projects.length} / ${bIds.length}`);
} catch (e) {
  check('suite completed', false, e.message.slice(0, 300));
} finally {
  for (const s of cleanup) sql(OWNER, s);
}
finish('sweep_portfolio');
