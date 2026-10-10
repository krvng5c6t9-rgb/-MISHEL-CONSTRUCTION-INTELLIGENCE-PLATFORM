// Stage 31 / DEC-009 part 2 (GC-13): revenue over time by cost-to-cost progress in a periodic run per contract -
// price = contract value + approved price estimates; progress from approved cost snapshots inside the period; period
// revenue = cumulative - previous (a reversal when EAC rises); onerous provision for the whole expected loss; contract
// asset/liability vs billings; prepared by one, approved and posted by another; frozen and hashed; runs move forward.
// Costs come from approved equipment usage (usage date = cost date). Amounts are TEST FIXTURES.
// Runs after sweep_assets (plant users and DOA), sweep_cost_eac (cost-control users), sweep_client_ipc_deductions.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const Y = day(-1), T = day(0);
try {
  const admin = await login(ADMIN);
  const existing = (key, pw = `Passw0rd!${key}`) => login({ email: `${key}.${TAG}@test.local`, password: pw, org_id: ADMIN.org_id });
  const fm1 = await existing('cifm1'), fm2 = await existing('cifm2'), pm = await existing('pm'), s1 = await existing('w1s1'), s2 = await existing('w1s2');
  const asa = await existing('asa'), asb = await existing('asb'), coqs = await existing('coqs'), cocm = await existing('cocm');
  const approve = (tok, id) => api('POST', `/approvals/${id}/actions`, tok, { action: 'approved', comment: 'fixture' });
  const coa = async (code, name, type) => must(await api('POST', '/finance/chart-of-accounts', admin, { account_code: `${code}-${TAG}`, account_name: name, account_type: type }), 'coa').id;
  const accounts = must(await api('GET', '/finance/chart-of-accounts', admin), 'coa list');
  const acc = { billings: Number(accounts.find(a => a.account_code === `4100-${TAG}`).id), revenue: await coa('4110', 'Contract revenue recognised (fixture)', 'revenue'),
    loss: await coa('5900', 'Onerous contract loss (fixture)', 'expense'), provision: await coa('2900', 'Onerous contract provision (fixture)', 'liability') };
  const ym = Y.slice(0, 7).split('-').map(Number);
  await api('POST', '/finance/fiscal-periods', admin, { fiscal_year: ym[0], period_no: ym[1], start_date: `${Y.slice(0, 7)}-01`, end_date: new Date(Date.UTC(ym[0], ym[1], 0)).toISOString().slice(0, 10) });

  const client = must(await api('POST', '/clients', admin, { client_name: `RV Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `RV-${TAG}`, project_name: `RV ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const contract = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 1000000, currency_id: 1, retention_percent: 5 }), 'contract').id;
  const csa = must(await api('POST', `/contracts/${contract}/submit-approval`, admin), 'sign').approval;
  must(await approve(s1, csa.id), 'sign 1'); must(await approve(s2, csa.id), 'sign 2');

  // --- Cost history: approved equipment usage yesterday 200,000 and today 100,000.
  const op = must(await api('POST', '/hr/employees', asa, { employee_code: `RVOP-${TAG}`, full_name: 'RV operator (fixture)', hire_date: '2025-01-01' }), 'operator');
  const ex = must(await api('POST', '/assets/equipment', asa, { asset_code: `RVEX-${TAG}`, asset_name: 'RV crane (fixture)', category: 'lifting', ownership_type: 'owned' }), 'asset');
  must(await api('PATCH', `/assets/equipment/${ex.id}/status`, asa, { status: 'in_use', current_project_id: project }), 'mobilise');
  const cost = async (date, hours) => {
    const u = must(await api('POST', '/assets/equipment-usage', asa, { asset_id: ex.id, project_id: project, usage_date: date, hours_used: hours, operator_id: op.id, cost_code_id: 2, currency_id: 1, hourly_rate: 25000 }), 'usage');
    must(await approve(asb, must(await api('PATCH', `/assets/equipment-usage/${u.id}/approve`, asa), 'usage submit').approval.id), 'usage approve');
    must(await api('POST', `/assets/equipment-usage/${u.id}/post-cost`, asb), 'usage post');
  };
  await cost(Y, 8);

  // --- Billing: IPC gross 300,000 certified today (a certification cannot precede its submission).
  const ipc = must(await api('POST', '/finance/ipcs', fm1, { project_id: project, contract_id: contract, ipc_no: `RV1-${TAG}`, period_from: Y, period_to: Y, gross_work_done_this_period: 300000, cumulative_gross_work_done: 300000, less_retention: 15000 }), 'ipc');
  must(await approve(pm, must(await api('POST', `/finance/ipcs/${ipc.id}/submit-to-client`, fm1), 'submit').approval.id), 'pm approve');
  must(await api('POST', `/finance/ipcs/${ipc.id}/client-approve`, fm2, { certified_amount: 285000, client_reference: `RVC1-${TAG}`, certified_on: T }), 'client approve');
  must(await api('POST', `/finance/ipcs/${ipc.id}/post-ar-gl`, admin), 'post ipc');

  // --- Price estimates.
  const est = (body) => api('POST', '/finance/revenue-estimates', fm1, { contract_id: contract, evidence_reference: `CLM-${TAG}`, ...body });
  await expectStatus('an estimate needs a written basis', () => est({ kind: 'claim', amount: 40000, effective_from: Y, basis: 'short' }), 400);
  await expectStatus('expected delay damages must reduce the price', () => est({ kind: 'delay_damages', amount: 20000, effective_from: T, basis: 'Delay damages expected under clause 8.8 (fixture basis)' }), 422);
  const claim = must(await est({ kind: 'claim', amount: 40000, effective_from: Y, basis: 'Engineer determination issued; client acceptance letter on file - reversal highly improbable (fixture)' }), 'claim');
  await expectStatus('the estimate preparer cannot approve it (SoD)', () => api('POST', `/finance/revenue-estimates/${claim.id}/approve`, fm1), 403);
  must(await api('POST', `/finance/revenue-estimates/${claim.id}/approve`, fm2), 'approve claim');

  // --- Run 1 (yesterday).
  const prep = (start, end, tok = fm1) => api('POST', '/finance/revenue-runs', tok, { contract_id: contract, period_start: start, period_end: end });
  const r0 = await prep(Y, Y);
  check('a run without an approved cost snapshot inside the period is refused', r0.status === 422 && /No approved cost snapshot/.test(r0.body?.error ?? ''), `HTTP ${r0.status} ${r0.body?.error ?? ''}`);
  const snap = async (asOf, etc) => { const s = must(await api('POST', '/cost-transactions/snapshots', coqs, { project_id: project, cost_code_id: 2, as_of: asOf, etc_method: 'manual', etc_amount: etc, etc_basis: 'Remaining crane and works programme (fixture)' }), 'snapshot'); must(await api('POST', `/cost-transactions/snapshots/${s.id}/approve`, cocm), 'approve snapshot'); return s; };
  await snap(Y, 600000);
  const run1 = await run('run 1 prepared: figures captured by the database', async () => must(await prep(Y, Y), 'run 1'));
  check('run 1: price 1,040,000 (1,000,000 + approved claim 40,000); progress 200,000 / 800,000 = 0.25; revenue 260,000',
    Number(run1.transaction_price) === 1040000 && Number(run1.cost_to_date) === 200000 && Number(run1.eac) === 800000 && Number(run1.progress) === 0.25 && Number(run1.cumulative_revenue) === 260000 && Number(run1.period_revenue) === 260000,
    JSON.stringify({ p: run1.transaction_price, c: run1.cost_to_date, e: run1.eac, g: run1.progress, r: run1.cumulative_revenue }));
  check('run 1: nothing billed by its period end - revenue 260,000 is a contract asset; no loss', Number(run1.billings_to_date) === 0 && Number(run1.contract_position) === 260000 && Number(run1.loss_provision) === 0, `${run1.billings_to_date} ${run1.contract_position}`);
  check('run 1 payload frozen with a SHA-256', /^[0-9a-f]{64}$/.test(run1.payload_sha256 ?? ''), run1.payload_sha256);
  await expectStatus('one prepared run per contract at a time', () => prep(T, T), 422);
  await expectStatus('the run preparer cannot approve it (SoD)', () => api('POST', `/finance/revenue-runs/${run1.id}/approve`, fm1), 403);
  await expectStatus('approval needs the revenue recognition rule', () => api('POST', `/finance/revenue-runs/${run1.id}/approve`, fm2), 422);
  must(await api('POST', '/finance/gl-posting-rules', admin, { source_module: 'revenue_recognition', debit_account_id: acc.billings, credit_account_id: acc.revenue, notes: 'TEST FIXTURE' }), 'rule revenue');
  const a1 = await run('run 1 approved and posted by a second person', async () => must(await api('POST', `/finance/revenue-runs/${run1.id}/approve`, fm2), 'approve run 1'));
  const gl = (runId, account, col) => sql(OWNER, `select coalesce(sum(${col}),0) from general_ledger where source_module='revenue_recognition' and source_record_id=${runId} and account_id=${account}`).out.trim();
  if (OWNER) check('GL run 1: Dr billings 260,000 / Cr revenue 260,000 on the period end', gl(run1.id, acc.billings, 'debit') === '260000.00' && gl(run1.id, acc.revenue, 'credit') === '260000.00' && a1.gl?.[0]?.lines?.[0]?.transaction_date?.slice(0, 10) === Y, `${gl(run1.id, acc.billings, 'debit')} / ${gl(run1.id, acc.revenue, 'credit')} ${a1.gl?.[0]?.lines?.[0]?.transaction_date}`);
  await expectStatus('runs move forward only (period overlapping the approved run refused)', () => prep(Y, T), 422);

  // --- Run 2 (today): cost +100,000, EAC rises to 1,200,000, expected delay damages -20,000 -> onerous.
  await cost(T, 4);
  const ld = must(await est({ kind: 'delay_damages', amount: -20000, effective_from: T, basis: 'Completion forecast beyond the time for completion; damages expected under the contract (fixture)' }), 'ld');
  must(await api('POST', `/finance/revenue-estimates/${ld.id}/approve`, fm2), 'approve ld');
  await snap(T, 900000);
  const run2 = must(await prep(T, T), 'run 2');
  check('run 2: price 1,020,000; progress 300,000 / 1,200,000 = 0.25; cumulative 255,000; period revenue -5,000 (reversal)',
    Number(run2.transaction_price) === 1020000 && Number(run2.progress) === 0.25 && Number(run2.cumulative_revenue) === 255000 && Number(run2.previous_revenue) === 260000 && Number(run2.period_revenue) === -5000,
    JSON.stringify({ p: run2.transaction_price, g: run2.progress, r: run2.cumulative_revenue, d: run2.period_revenue }));
  check('run 2: expected loss 180,000; provision 135,000 so the whole loss is recognised now (margin -45,000 + provision)',
    Number(run2.expected_loss) === 180000 && Number(run2.loss_provision) === 135000 && Number(run2.period_loss_provision) === 135000 && Number(run2.cumulative_revenue) - Number(run2.cost_to_date) - Number(run2.loss_provision) === -180000,
    `${run2.expected_loss} ${run2.loss_provision}`);
  check('run 2: contract liability 45,000 (billed 300,000, revenue 255,000)', Number(run2.contract_position) === -45000, run2.contract_position);
  await expectStatus('approval needs the onerous provision rule', () => api('POST', `/finance/revenue-runs/${run2.id}/approve`, fm2), 422);
  must(await api('POST', '/finance/gl-posting-rules', admin, { source_module: 'revenue_recognition', source_subtype: 'onerous_provision', debit_account_id: acc.loss, credit_account_id: acc.provision, notes: 'TEST FIXTURE' }), 'rule onerous');
  must(await api('POST', `/finance/revenue-runs/${run2.id}/approve`, fm2), 'approve run 2');
  if (OWNER) {
    check('GL run 2: revenue reversal Dr revenue 5,000 / Cr billings 5,000', gl(run2.id, acc.revenue, 'debit') === '5000.00' && gl(run2.id, acc.billings, 'credit') === '5000.00', `${gl(run2.id, acc.revenue, 'debit')} / ${gl(run2.id, acc.billings, 'credit')}`);
    check('GL run 2: Dr onerous loss 135,000 / Cr provision 135,000', gl(run2.id, acc.loss, 'debit') === '135000.00' && gl(run2.id, acc.provision, 'credit') === '135000.00', `${gl(run2.id, acc.loss, 'debit')} / ${gl(run2.id, acc.provision, 'credit')}`);
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: an approved revenue run is immutable', `update revenue_recognition_runs set cumulative_revenue = 1 where id = ${run1.id}`);
    probe('DB: an approved revenue run is never deleted', `delete from revenue_recognition_runs where id = ${run1.id}`);
    probe('DB: an approved price estimate changes only by being retired', `update revenue_price_estimates set amount = 99999 where id = ${claim.id}`);
    probe('DB: a revenue run cannot be posted twice', `insert into general_ledger(org_id, project_id, account_id, transaction_date, debit, credit, currency_id, source_module, source_table, source_record_id, journal_batch_id, description) values (1, ${project}, ${acc.billings}, '${T}', 1, 0, 1, 'revenue_recognition', 'revenue_recognition_runs', ${run2.id}, nextval('gl_journal_batch_seq'), 'replay')`);
    const h = sql(OWNER, `select payload_sha256 = encode(sha256(convert_to(payload::text, 'UTF8')), 'hex') from revenue_recognition_runs where id = ${run1.id}`).out.trim();
    check('DB: the stored hash matches the frozen payload', /^t$/m.test(h), h);
  } else check('DB probes (OWNER_PSQL_URL required)', false);
  const list = must(await api('GET', `/finance/revenue-runs?contract_id=${contract}`, fm1), 'runs');
  check('run history: two approved runs in period order', list.length === 2 && list.every(x => x.status === 'approved') && list[0].id === run1.id, list.map(x => `${x.id}:${x.status}`).join(','));

  const tb = await login(ADMIN_B);
  check('tenant B sees no tenant A revenue runs', must(await api('GET', `/finance/revenue-runs?contract_id=${contract}`, tb), 'b runs').length === 0);
  await expectStatus('tenant B cannot prepare a run on a tenant A contract', () => api('POST', '/finance/revenue-runs', tb, { contract_id: contract, period_start: T, period_end: T }), 404);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_revenue_recognition');
