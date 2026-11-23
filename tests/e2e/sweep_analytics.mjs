// CC-099 / Stage 70 (migration 104): analytics - semantic data sources, queries and dashboards built by users. Every
// total is compared with an independent SQL computation over the same gate data (owner connection).
import { ADMIN, ADMIN_B, TAG, api, must, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const one = (text) => { const r = sql(OWNER, text); if (!r.ok) throw new Error(r.out.slice(0, 300)); return r.out; };
const lines = (text) => { const o = one(text); return o ? o.split('\n') : []; };
const q = (token, body) => api('POST', '/analytics/query', token, body);
const asLines = (res) => res.rows.map(r => [...r.dims, ...(res.by_currency ? [r.currency] : []), ...r.values].join('|')).sort();

try {
  const admin = await login(ADMIN);
  const mk = async (key, perms) => {
    const roleId = must(await api('POST', '/roles', admin, { role_name: `AN ${key} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), 'role').id;
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id: roleId, full_name: `AN ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const costUser = await mk('ancost', [['cost_control', 'view']]);
  const finUser = await mk('anfin', [['finance', 'view'], ['cost_control', 'view'], ['hr', 'view'], ['procurement', 'view']]);
  const org = ADMIN.org_id;

  // --- Sources by permission; refused keys.
  const src = must(await api('GET', '/analytics/sources', costUser), 'sources');
  check('only the data sources the user may see are offered, without SQL', src.length === 1 && src[0].key === 'cost' && src[0].money && !JSON.stringify(src).includes('sum('), JSON.stringify(src.map(s => s.key)));
  await expectStatus('a source of another module is refused', () => q(costUser, { source: 'attendance', measures: ['hours'] }), 403);
  await expectStatus('an unknown source is refused', () => q(costUser, { source: 'users', measures: ['count'] }), 404);
  await expectStatus('an unknown dimension is refused (no SQL from the user)', () => q(costUser, { source: 'cost', measures: ['amount'], dims: ['project; drop table projects'] }), 400);
  await expectStatus('an unknown measure is refused', () => q(costUser, { source: 'cost', measures: ['sum(amount)'] }), 400);
  const inj = must(await q(costUser, { source: 'cost', measures: ['count'], filters: [{ dim: 'project', values: [`x' or '1'='1`] }] }), 'bound filter');
  check('filter values are bound parameters (a quote injection matches nothing)', inj.rows.length === 1 && inj.rows[0].values[0] === '0');

  // --- Cost by project: money grouped by currency, equal to SQL.
  const r1 = must(await q(costUser, { source: 'cost', measures: ['amount', 'count'], dims: ['project'] }), 'cost by project');
  const e1 = lines(`select p.project_code || '|' || cur.code || '|' || sum(t.amount)::text || '|' || count(*) from cost_transactions t join projects p on p.id = t.project_id
    join currencies cur on cur.id = t.currency_id where t.org_id = ${org} group by p.project_code, cur.code`).sort();
  check('cost by project equals the database: amounts per currency, never added across currencies', r1.by_currency && r1.rows.every(r => r.currency) && JSON.stringify(asLines(r1)) === JSON.stringify(e1) && e1.length > 0,
    `${asLines(r1).slice(0, 3)} vs ${e1.slice(0, 3)}`);
  const r2 = must(await q(costUser, { source: 'cost', measures: ['count'] }), 'count');
  check('a count alone is not grouped by currency', !r2.by_currency && r2.rows.length === 1 && r2.rows[0].values[0] === one(`select count(*) from cost_transactions where org_id = ${org}`));

  // --- Two dimensions, filters and dates.
  const pc = one(`select p.project_code from cost_transactions t join projects p on p.id = t.project_id where t.org_id = ${org} group by 1 order by count(*) desc limit 1`);
  const r3 = must(await q(costUser, { source: 'cost', measures: ['amount'], dims: ['cost_type', 'month'], filters: [{ dim: 'project', values: [pc] }] }), 'two dims');
  const e3 = lines(`select coalesce(cc.cost_type, '-') || '|' || to_char(t.transaction_date, 'YYYY-MM') || '|' || cur.code || '|' || sum(t.amount)::text from cost_transactions t
    join projects p on p.id = t.project_id left join cost_codes cc on cc.id = t.cost_code_id join currencies cur on cur.id = t.currency_id
    where t.org_id = ${org} and p.project_code = '${pc}' group by coalesce(cc.cost_type, '-'), to_char(t.transaction_date, 'YYYY-MM'), cur.code`).sort();
  check('cost type by month for one project equals the database', JSON.stringify(asLines(r3)) === JSON.stringify(e3), `${asLines(r3).slice(0, 2)} vs ${e3.slice(0, 2)}`);
  const d0 = one(`select min(transaction_date) from cost_transactions where org_id = ${org}`);
  const r4 = must(await q(costUser, { source: 'cost', measures: ['count'], date_from: d0, date_to: d0 }), 'dates');
  check('a date range limits the rows', r4.rows[0].values[0] === one(`select count(*) from cost_transactions where org_id = ${org} and transaction_date = '${d0}'`));
  const groups = Number(one(`select count(distinct (project_id, currency_id)) from cost_transactions where org_id = ${org}`));
  const r5 = must(await q(costUser, { source: 'cost', measures: ['amount'], dims: ['project'], limit: 1 }), 'limit');
  check('a limit returns that many rows and says the result was cut', r5.rows.length === 1 && r5.truncated === (groups > 1));

  // --- Other sources equal to SQL.
  const ri = must(await q(finUser, { source: 'ipcs', measures: ['net_due', 'count'], dims: ['status'] }), 'ipcs');
  const ei = lines(`select i.status || '|' || cur.code || '|' || coalesce(sum(i.net_amount_due)::text, '') || '|' || count(*) from ipcs i join projects p on p.id = i.project_id
    join currencies cur on cur.id = p.currency_id where i.org_id = ${org} group by i.status, cur.code`).sort();
  check('certificates by status equal the database (in the project currency)', JSON.stringify(asLines(ri).map(x => x.replace('|null|', '||'))) === JSON.stringify(ei), `${asLines(ri).slice(0, 2)} vs ${ei.slice(0, 2)}`);
  const ra = must(await q(finUser, { source: 'attendance', measures: ['hours', 'employees'], dims: ['status'] }), 'attendance');
  const ea = lines(`select status || '|' || coalesce(sum(hours_worked)::text, '') || '|' || count(distinct employee_id) from attendance where org_id = ${org} group by status`).sort();
  check('attendance hours and employees by status equal the database (no currency)', !ra.by_currency && JSON.stringify(asLines(ra).map(x => x.replace(/\|null\|/, '||'))) === JSON.stringify(ea), `${asLines(ra)} vs ${ea}`);
  const rp = must(await q(finUser, { source: 'purchase_orders', measures: ['total'], dims: ['status'] }), 'pos');
  const ep = lines(`select o.status || '|' || cur.code || '|' || sum(o.total_amount)::text from purchase_orders o join currencies cur on cur.id = o.currency_id where o.org_id = ${org} group by o.status, cur.code`).sort();
  check('purchase orders by status equal the database', JSON.stringify(asLines(rp)) === JSON.stringify(ep), `${asLines(rp).slice(0, 2)} vs ${ep.slice(0, 2)}`);

  // --- Isolation.
  const adminB = await login(ADMIN_B);
  const rb = must(await q(adminB, { source: 'cost', measures: ['count'] }), 'B');
  check('another company counts only its own records', rb.rows[0].values[0] === one(`select count(*) from cost_transactions where org_id = 2`));

  // --- Dashboards.
  const widgets = [{ title: 'Cost by project', chart: 'bar', query: { source: 'cost', measures: ['amount'], dims: ['project'] } },
    { title: 'Hours', chart: 'kpi', query: { source: 'attendance', measures: ['hours'] } }];
  const dPriv = must(await api('POST', '/analytics/dashboards', finUser, { name: `Mine ${TAG}`, visibility: 'private', widgets }), 'private');
  const dShared = must(await api('POST', '/analytics/dashboards', finUser, { name: `Shared ${TAG}`, visibility: 'company', widgets }), 'shared');
  await expectStatus('a widget with an unknown source is refused', () => api('POST', '/analytics/dashboards', finUser, { name: `Bad ${TAG}`, visibility: 'private', widgets: [{ title: 'x', chart: 'bar', query: { source: 'nope', measures: ['x'] } }] }), 400);
  await expectStatus('the same dashboard name twice for one owner is refused', () => api('POST', '/analytics/dashboards', finUser, { name: `Mine ${TAG}`, visibility: 'private', widgets: [] }), 409);
  const seen = must(await api('GET', '/analytics/dashboards', costUser), 'list other');
  check('another user sees the shared dashboard and not the private one', seen.some(d => d.id === dShared.id && d.owner_name === 'AN anfin') && !seen.some(d => d.id === dPriv.id));
  await expectStatus('only the owner changes a dashboard', () => api('PUT', `/analytics/dashboards/${dShared.id}`, costUser, { name: 'Taken', visibility: 'company', widgets: [] }), 404);
  await expectStatus('only the owner deletes a dashboard', () => api('DELETE', `/analytics/dashboards/${dShared.id}`, costUser), 404);
  const shared = seen.find(d => d.id === dShared.id);
  await expectStatus('a shared widget runs with the viewer\'s permissions (attendance refused to a cost-only user)', () => q(costUser, shared.widgets[1].query), 403);
  must(await api('PUT', `/analytics/dashboards/${dShared.id}`, finUser, { name: `Shared ${TAG} v2`, visibility: 'company', widgets: [widgets[0]] }), 'update');
  check('the owner updates the dashboard', one(`select name || '|' || jsonb_array_length(widgets) from analytics_dashboards where id = ${dShared.id}`) === `Shared ${TAG} v2|1`);
  check('another company sees none of these dashboards', !must(await api('GET', '/analytics/dashboards', adminB), 'B list').some(d => d.id === dShared.id));
  must(await api('DELETE', `/analytics/dashboards/${dPriv.id}`, finUser), 'delete');
  check('the owner deletes a dashboard', one(`select count(*) from analytics_dashboards where id = ${dPriv.id}`) === '0');
  const own = sql(OWNER, `update analytics_dashboards set owner_id = (select id from users where org_id = ${org} and id <> owner_id limit 1) where id = ${dShared.id}`);
  check('a dashboard keeps its owner (database)', !own.ok && /keeps its owner/.test(own.out), own.out.slice(0, 120));
  check('dashboards are audited', Number(one(`select count(*) from audit_log where table_name = 'analytics_dashboards' and org_id = ${org}`)) >= 4);
} catch (e) {
  check('suite completed', false, e.message.slice(0, 300));
}
finish('sweep_analytics');
