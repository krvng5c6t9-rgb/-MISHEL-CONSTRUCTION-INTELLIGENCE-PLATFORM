// CC-076 / DEC-021 part 1: cost in one currency at the rate of the transaction date (migration 085). A foreign-currency
// cost transaction freezes the latest register rate dated on or before its date and stores its amount in the project
// currency and in the base currency; with no rate it is refused; a later rate never changes it; a reversal uses the
// original's rates; cost reports add project-currency amounts only. All data, including the USD currency and its rates,
// are TEST FIXTURES (not market rates). CC-077 adds the GL: lines in the base currency at the frozen rate, a balanced
// foreign-currency batch to the piastre, and the trial balance in the base currency.
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
  const all = await mkRole('FX All', [['assets', 'view'], ['assets', 'create'], ['assets', 'edit'], ['assets', 'approve'], ['finance', 'view'], ['finance', 'create'], ['finance', 'manage'], ['finance', 'post'], ['approvals', 'view'], ['approvals', 'approve'], ['hr', 'view'], ['hr', 'create'], ['reports', 'view'], ['cost_control', 'view']]);
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

  // CC-077 / DEC-021 part 2a: the GL posting of the USD cost carries the cost transaction's frozen rate.
  if (!must(await api('GET', '/finance/gl-posting-rules', admin), 'rules').some(r => r.source_module === 'cost_transaction' && r.source_subtype === 'equipment' && r.is_active !== false)) {
    const coa = async (code, name, type) => must(await api('POST', '/finance/chart-of-accounts', admin, { account_code: `${code}-${TAG}`, account_name: name, account_type: type }), 'coa').id;
    must(await api('POST', '/finance/gl-posting-rules', admin, { source_module: 'cost_transaction', source_subtype: 'equipment', debit_account_id: await coa('FX5300', 'Plant cost (fixture)', 'expense'), credit_account_id: await coa('FX2300', 'Plant payable (fixture)', 'liability'), notes: 'TEST FIXTURE' }), 'equipment rule');
  }
  await run('USD cost posted to the GL', async () => must(await api('POST', `/finance/cost-transactions/${c1[0]}/post-gl`, P.c), 'post gl'));
  const gl = one(`select count(*), sum(debit), sum(credit), sum(debit_base), sum(credit_base), min(fx_rate_to_base)::numeric(20,4), max(fx_rate_to_base)::numeric(20,4) from general_ledger where source_module = 'cost_transaction' and source_record_id = ${c1[0]}`).split('|');
  check('GL lines of the USD cost: 80.00 USD each side, 3,880.00 EGP each side, at the cost rate 48.5', gl[0] === '2' && gl[1] === '80.00' && gl[2] === '80.00' && gl[3] === '3880.00' && gl[4] === '3880.00' && gl[5] === '48.5000' && gl[6] === '48.5000', gl.join('|'));
  // Rounding within a batch: three USD lines (0.01 + 0.01 = 0.02) at 48.5. Converting each line alone gives debits
  // 0.49 + 0.49 = 0.98 against a credit of 0.97; the running-total allocation gives 0.49 + 0.48 = 0.97. The deferred
  // balance checks are run (SET CONSTRAINTS ALL IMMEDIATE) and the transaction is rolled back.
  const acct = one(`select id from chart_of_accounts where org_id = ${ADMIN.org_id} and is_active order by id limit 1`);
  const round = one(`begin;
    alter table general_ledger disable trigger trg_validate_gl_insert;
    create temp table b on commit drop as select nextval('gl_journal_batch_seq') as id;
    insert into general_ledger(org_id, project_id, account_id, transaction_date, debit, credit, currency_id, source_module, source_table, source_record_id, journal_batch_id, description)
      select ${ADMIN.org_id}, ${project}, ${acct}, '${day(-2)}'::date, x.d, x.c, ${usd}, 'manual_journal', 'manual_journal_entries', 0, b.id, 'rounding probe (fixture)'
        from b, (values (1, 0.01, 0), (2, 0.01, 0), (3, 0, 0.02)) x(n, d, c) order by x.n;
    set constraints all immediate;
    select 'lines', string_agg(g.debit_base::text || '/' || g.credit_base::text, ' ' order by g.id), sum(g.debit_base), sum(g.credit_base) from general_ledger g, b where g.journal_batch_id = b.id;
    rollback;`).split('\n').find(l => l.startsWith('lines|'))?.split('|') ?? [];
  check('a foreign-currency batch stays balanced in EGP to the piastre (0.49 + 0.48 = 0.97, not 0.98)', round[1] === '0.49/0.00 0.48/0.00 0.00/0.97' && round[2] === '0.97' && round[3] === '0.97', round.join('|'));
  const tb = await api('GET', '/finance/trial-balance', admin);
  check('trial balance in the base currency (EGP) balances', tb.status === 200 && tb.body?.meta?.base_currency_code === 'EGP' && tb.body.meta.total_debit === tb.body.meta.total_credit && Number(tb.body.meta.total_debit) > 0, JSON.stringify(tb.body?.meta ?? tb.body));

  // CC-078 / DEC-022: period-end revaluation of monetary items, the company's gain / loss accounts, maximum rate age.
  await expectStatus('revaluation refused until the exchange gain and loss accounts are set', () => api('POST', '/finance/fx-revaluations', P.c, { period_end: day(0) }), 422);
  const coaX = async (code, name, type) => must(await api('POST', '/finance/chart-of-accounts', admin, { account_code: `${code}-${TAG}`, account_name: name, account_type: type }), 'coa').id;
  const gain = await coaX('FX7100', 'Exchange gains (fixture)', 'revenue'), loss = await coaX('FX8100', 'Exchange losses (fixture)', 'expense');
  await expectStatus('a gain account that is not a revenue account is refused', () => api('PATCH', '/finance/fx-settings', P.c, { fx_gain_account_id: loss, fx_loss_account_id: loss, fx_max_rate_age_days: 7 }), 422);
  must(await api('PATCH', '/finance/fx-settings', P.c, { fx_gain_account_id: gain, fx_loss_account_id: loss, fx_max_rate_age_days: 7 }), 'fx settings');
  const payable = Number(must(await api('GET', '/finance/gl-posting-rules', admin), 'rules').find(r => r.source_module === 'cost_transaction' && r.source_subtype === 'equipment').credit_account_id);
  await expectStatus('an expense account cannot be marked as a monetary item', () => api('PATCH', `/finance/chart-of-accounts/${loss}/fx-revalue`, P.c, { fx_revalue: true }), 422);
  must(await api('PATCH', `/finance/chart-of-accounts/${payable}/fx-revalue`, P.c, { fx_revalue: true }), 'mark payable');
  // Maximum rate age: with 0 days, yesterday's rate cannot close today.
  must(await api('PATCH', '/finance/fx-settings', P.c, { fx_gain_account_id: gain, fx_loss_account_id: loss, fx_max_rate_age_days: 0 }), 'age 0');
  await expectStatus('a closing rate older than the maximum rate age is refused', () => api('POST', '/finance/fx-revaluations', P.c, { period_end: day(0) }), 422);
  must(await api('PATCH', '/finance/fx-settings', P.c, { fx_gain_account_id: gain, fx_loss_account_id: loss, fx_max_rate_age_days: 7 }), 'age 7');
  // The plant payable holds 80 USD recorded at 48.5 = 3,880 EGP; at the closing rate 50 it is 4,000: a loss of 120.
  const rv = await run('period-end revaluation posted', async () => must(await api('POST', '/finance/fx-revaluations', P.c, { period_end: day(0) }), 'revaluation'));
  const ln = (rv.lines ?? []).find(l => Number(l.account_id) === payable && Number(l.currency_id) === usd);
  check('payable revalued: -80.00 USD x 50 = -4,000.00 EGP from -3,880.00 - exchange loss 120.00', ln?.foreign_balance === '-80.00' && Number(ln?.closing_rate) === 50 && ln?.base_before === '-3880.00' && ln?.base_target === '-4000.00' && ln?.adjustment === '-120.00', JSON.stringify(ln));
  const rvGl = one(`select string_agg(account_id::text || ':' || debit_base::text || '/' || credit_base::text, ' ' order by debit desc), min(currency_id) from general_ledger where source_module = 'fx_revaluation' and source_record_id = ${rv.id} and journal_batch_id = ${ln?.gl_batch_id ?? 0}`).split('|');
  check('GL: Dr exchange loss 120.00 / Cr plant payable 120.00, in the base currency (EGP)', rvGl[0] === `${loss}:120.00/0.00 ${payable}:0.00/120.00` && rvGl[1] === '1', rvGl.join('|'));
  const after = one(`select sum(debit_base - credit_base) from general_ledger where account_id = ${payable} and (currency_id = ${usd} or fx_revalued_currency_id = ${usd})`);
  check('after revaluation the payable is carried at the closing rate (-4,000.00)', after === '-4000.00', after);
  await expectStatus('a second revaluation for the same period end is refused', () => api('POST', '/finance/fx-revaluations', P.c, { period_end: day(0) }), 409);
  await expectStatus('a revaluation dated before the last one is refused', () => api('POST', '/finance/fx-revaluations', P.c, { period_end: day(-1) }), 409);
  const tb2 = await api('GET', '/finance/trial-balance', admin);
  check('trial balance still balances after the revaluation', tb2.status === 200 && tb2.body.meta.total_debit === tb2.body.meta.total_credit, JSON.stringify(tb2.body?.meta));

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
