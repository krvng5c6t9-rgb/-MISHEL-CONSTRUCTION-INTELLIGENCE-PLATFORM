// CC-076 / DEC-021 part 1: cost in one currency at the rate of the transaction date (migration 085). A foreign-currency
// cost transaction freezes the latest register rate dated on or before its date and stores its amount in the project
// currency and in the base currency; with no rate it is refused; a later rate never changes it; a reversal uses the
// original's rates; cost reports add project-currency amounts only. All data, including the USD currency and its rates,
// are TEST FIXTURES (not market rates).
import { ADMIN, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
const one = (text) => { const r = sql(OWNER, text); if (!r.ok) throw new Error(r.out.slice(0, 300)); return r.out; };
try {
  const admin = await login(ADMIN);
  const usd = Number(one(`insert into currencies(code, name) select 'USD', 'US Dollar (test fixture)' where not exists (select 1 from currencies where code = 'USD'); select id from currencies where code = 'USD'`).split('\n').pop());
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `FX ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const all = await mkRole('FX All', [['assets', 'view'], ['assets', 'create'], ['assets', 'edit'], ['assets', 'approve'], ['finance', 'view'], ['finance', 'create'], ['finance', 'manage'], ['approvals', 'view'], ['approvals', 'approve'], ['hr', 'view'], ['hr', 'create'], ['reports', 'view'], ['cost_control', 'view']]);
  // The approver holds the role of the active equipment-usage DOA rule (one may already exist; rules cannot overlap).
  let rule = must(await api('GET', '/approvals/configuration/doa', admin), 'doa').find(d => d.module === 'equipment_usage' && d.is_active && d.is_confirmed);
  if (!rule) {
    const conf = await mkUser('fxconf', await mkRole('FX DOA Conf', [['admin', 'view'], ['admin', 'approve']]));
    rule = must(await api('POST', '/approvals/configuration/doa', admin, { module: 'equipment_usage', min_amount: 0, approval_level: 1, approver_role_id: all, notes: 'TEST FIXTURE' }), 'doa');
    must(await api('POST', `/approvals/configuration/doa/${rule.id}/confirm`, conf), 'doa confirm');
  }
  const P = { a: await mkUser('fxa', all), b: await mkUser('fxb', Number(rule.approver_role_id)), c: await mkUser('fxc', all) };
  const project = must(await api('POST', '/projects', admin, { project_code: `FX-${TAG}`, project_name: `FX ${TAG}`, currency_id: 1 }), 'project').id;
  const op = must(await api('POST', '/hr/employees', P.a, { employee_code: `FXOP-${TAG}`, full_name: 'Operator (fixture)', hire_date: '2025-01-01' }), 'operator');
  const ex = must(await api('POST', '/assets/equipment', P.a, { asset_code: `FXEX-${TAG}`, asset_name: 'Imported crane (fixture)', category: 'lifting', ownership_type: 'rented' }), 'asset');
  must(await api('PATCH', `/assets/equipment/${ex.id}/status`, P.a, { status: 'in_use', current_project_id: project }), 'mobilise');
  const usage = async (hours) => {
    const u = must(await api('POST', '/assets/equipment-usage', P.a, { asset_id: ex.id, project_id: project, usage_date: day(-1), hours_used: hours, operator_id: op.id, cost_code_id: 2, currency_id: usd, hourly_rate: 10 }), 'usage');
    const ap = must(await api('PATCH', `/assets/equipment-usage/${u.id}/approve`, P.a), 'submit').approval;
    must(await api('POST', `/approvals/${ap.id}/actions`, P.b, { action: 'approved', comment: 'ok' }), 'approve');
    return u;
  };
  const ctOf = (usageId) => one(`select id, amount, currency_id, project_amount, base_amount, fx_rate_to_base::numeric(20,4), fx_rate_date from cost_transactions where source_table = 'equipment_usage' and source_record_id = ${usageId}`).split('|');

  // No rate recorded for USD: the cost transaction is refused (no rate is assumed).
  const u1 = await usage(8);
  await expectStatus('USD cost with no exchange rate in the register is refused', () => api('POST', `/assets/equipment-usage/${u1.id}/post-cost`, P.c), 422);

  // Rate recorded three days ago: the transaction (dated yesterday) freezes it.
  must(await api('POST', '/finance/exchange-rates', P.c, { currency_id: usd, rate_date: day(-3), rate_to_base: 48.5, source: 'TEST FIXTURE' }), 'rate 1');
  await run('USD cost posted once a rate dated on or before its date exists', async () => must(await api('POST', `/assets/equipment-usage/${u1.id}/post-cost`, P.c), 'post 1'));
  const c1 = ctOf(u1.id);
  check('80 USD at 48.5 = 3,880.00 in the project currency (EGP) and the base currency', c1[1] === '80.00' && Number(c1[2]) === usd && c1[3] === '3880.00' && c1[4] === '3880.00' && c1[5] === '48.5000' && c1[6] === day(-3), c1.join('|'));

  // A later rate (dated yesterday) applies to later transactions only.
  must(await api('POST', '/finance/exchange-rates', P.c, { currency_id: usd, rate_date: day(-1), rate_to_base: 50, source: 'TEST FIXTURE' }), 'rate 2');
  check('a later register rate does not change a recorded transaction', ctOf(u1.id).join('|') === c1.join('|'), ctOf(u1.id).join('|'));
  const u2 = await usage(4);
  must(await api('POST', `/assets/equipment-usage/${u2.id}/post-cost`, P.c), 'post 2');
  const c2 = ctOf(u2.id);
  check('40 USD posted after the newer rate uses it: 2,000.00', c2[3] === '2000.00' && c2[5] === '50.0000' && c2[6] === day(-1), c2.join('|'));

  // Cost reports add project-currency amounts (they added 80 + 40 = 120 "money" before).
  const cs = must(await api('GET', `/reports/cost-summary?project_id=${project}`, admin), 'cost summary');
  const row = cs.find(r => Number(r.cost_code_id) === 2);
  check('cost summary actual = 3,880 + 2,000 = 5,880.00 (EGP), never 120', Number(row?.actual) === 5880, JSON.stringify(row?.actual));

  // Reversal and a project in another currency: the rate rule in isolation (the manual-adjustment approval trigger is
  // switched off inside a transaction that is rolled back - nothing remains).
  const usdProject = must(await api('POST', '/projects', admin, { project_code: `FXU-${TAG}`, project_name: `FX USD ${TAG}`, currency_id: usd }), 'usd project').id;
  const probe = one(`begin;
    alter table cost_transactions disable trigger trg_validate_cost_transaction_insert;
    with r as (insert into cost_transactions(org_id, project_id, cost_code_id, source_module, source_table, source_record_id, transaction_type, amount, currency_id, transaction_date, reversal_of_transaction_id)
      values (${ADMIN.org_id}, ${project}, 2, 'manual_adjustment', 'cost_adjustment_requests', 0, 'actual', -80, ${usd}, '${day(0)}', ${c1[0]}) returning project_amount, base_amount, fx_rate_date)
    select 'rev', project_amount, base_amount, fx_rate_date from r;
    with u as (insert into cost_transactions(org_id, project_id, cost_code_id, source_module, source_table, source_record_id, transaction_type, amount, currency_id, transaction_date)
      values (${ADMIN.org_id}, ${usdProject}, 2, 'equipment', 'equipment_usage', 0, 'actual', 970, 1, '${day(-1)}') returning project_amount, base_amount)
    select 'usdproj', project_amount, base_amount from u;
    rollback;`).split('\n').filter(l => /^(rev|usdproj)\|/.test(l));
  const rev = probe.find(l => l.startsWith('rev|'))?.split('|') ?? [];
  const up = probe.find(l => l.startsWith('usdproj|'))?.split('|') ?? [];
  check('a reversal uses the original rate (48.5, not today\'s 50): -3,880.00 nets the original to zero', rev[1] === '-3880.00' && rev[2] === '-3880.00' && rev[3] === day(-3), rev.join('|'));
  check('EGP cost on a USD project: 970 EGP / 50 = 19.40 USD in the project currency, 970.00 in the base currency', up[1] === '19.40' && up[2] === '970.00', up.join('|'));
  check('the probe left nothing behind', one(`select count(*) from cost_transactions where project_id = ${usdProject} or (project_id = ${project} and source_module = 'manual_adjustment')`) === '0');
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_fx_cost');
