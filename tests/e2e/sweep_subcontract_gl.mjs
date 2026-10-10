// Stage 28 / DEC-012: subcontract certificates under cumulative valuation; cost at gross; payable at net; retention
// held as a liability and released into its own payable; GL split (payable, retention, advance recovered, back-charges
// recovered); the subcontractor paid through the payments flow (F-42). Amounts are TEST FIXTURES.
// Runs after wave1_subcontract_ipc, chain.mjs, sweep_subcontract_deductions, sweep_client_ipc_deductions.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const existing = (key) => login({ email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id });
  const maker = await existing('sdmaker'), site = await existing('sdsite'), qs = await existing('sdqs'), qs2 = await existing('sdqs2');
  const appr = await existing('scappr'), vend = await existing('scvend'), fm1 = await existing('cifm1'), fm2 = await existing('cifm2'), fin = await existing('fin');
  const approve = (tok, id) => api('POST', `/approvals/${id}/actions`, tok, { action: 'approved', comment: 'fixture' });
  const coa = async (code, name, type) => must(await api('POST', '/finance/chart-of-accounts', admin, { account_code: `${code}-${TAG}`, account_name: name, account_type: type }), 'coa').id;
  const acc = { cost: await coa('5300', 'Subcontract cost (fixture)', 'expense'), ap: await coa('2110', 'Subcontractors payable (fixture)', 'liability'),
    ret: await coa('2120', 'Retention payable to subcontractors (fixture)', 'liability'), adv: await coa('1150', 'Advances to subcontractors (fixture)', 'asset'),
    bc: await coa('5390', 'Back-charges recovered (fixture)', 'expense') };
  const rule = (subtype, credit) => api('POST', '/finance/gl-posting-rules', admin, { source_module: 'cost_transaction', source_subtype: subtype, debit_account_id: acc.cost, credit_account_id: credit, notes: 'TEST FIXTURE' });
  must(await rule('subcontract', acc.ap), 'rule subcontract');

  const project = must(await api('POST', '/projects', admin, { project_code: `SG-${TAG}`, project_name: `SG ${TAG}`, currency_id: 1 }), 'project').id;
  const vendor = must(await api('POST', '/vendors', admin, { vendor_name: `SG Sub ${TAG}`, vendor_type: 'subcontractor' }), 'vendor').id;
  must(await api('POST', `/vendors/${vendor}/prequalification`, vend, { decision: 'approved', reason: 'fixture prequalification' }), 'preq');
  const sc = must(await api('POST', '/subcontracts', admin, { project_id: project, vendor_id: vendor, package_name: `SG pkg ${TAG}`, contract_value: 200000, currency_id: 1, cost_code_id: 2, retention_percent: 10, advance_payment_percent: 10 }), 'sc');
  must(await approve(appr, must(await api('POST', `/subcontracts/${sc.id}/submit-approval`, admin), 'sc submit').approval.id), 'sc approve');
  const adv = must(await api('POST', '/subcontracts/advances', maker, { subcontract_id: sc.id, amount: 20000, recovery_percent: 25, guarantee_ref: `APG-SG-${TAG}` }), 'adv');
  must(await api('POST', `/subcontracts/advances/${adv.id}/approve`, qs), 'adv approve');
  must(await api('POST', `/subcontracts/advances/${adv.id}/paid`, qs2, { payment_reference: `PAY-SG-${TAG}` }), 'adv paid');
  const bc = must(await api('POST', '/subcontracts/backcharges', maker, { subcontract_id: sc.id, reference: `SGBC-${TAG}`, cause: 'Temporary works removed by main contractor (fixture)', amount: 1000, notified_on: day(-1) }), 'bc');
  must(await api('POST', `/subcontracts/backcharges/${bc.id}/approve`, qs), 'bc approve');

  let n = 0;
  const cert = async (body, lines) => {
    const c = must(await api('POST', '/subcontracts/certificates', maker, { subcontract_id: sc.id, project_id: project, certificate_no: `SG${++n}-${TAG}`, period_from: day(-30), period_to: day(-1), ...body }), 'cert');
    for (const l of lines) must(await api('POST', `/subcontracts/certificates/${c.id}/lines`, maker, l), 'line');
    return c.id;
  };
  const verify = (id) => api('POST', `/subcontracts/certificates/${id}/verify`, site);

  // --- Certificate 1: 20,000 gross measured cumulatively; retention 2,000; advance 5,000; back-charge 1,000; net 12,000.
  const c1 = await cert({ gross_work_done: 20000, less_retention: 2000, less_advance_recovery: 5000, penalties_deductions: 1000 },
    [{ description: 'Blockwork m2', quantity_this_period: 100, cumulative_quantity: 100, unit_rate: 150 }, { description: 'Lintels nr', quantity_this_period: 10, cumulative_quantity: 10, unit_rate: 500 }]);
  must(await api('POST', `/subcontracts/backcharges/${bc.id}/apply`, maker, { certificate_id: c1 }), 'apply bc');
  const v1 = await verify(c1);
  check('certificate 1 verified with cumulative 0 -> 20,000', v1.status === 200 && Number(v1.body.data.previous_cumulative_gross) === 0 && Number(v1.body.data.cumulative_gross_to_date) === 20000, `HTTP ${v1.status} ${v1.body?.error ?? ''}`);
  must(await api('POST', `/subcontracts/certificates/${c1}/qs-certify`, qs), 'qs');
  const fz = (await approve(appr, must(await api('POST', `/subcontracts/certificates/${c1}/submit-approval`, qs), 'submit').approval.id)).body.data.finalization;
  check('approval posts cost at GROSS 20,000 (not net 12,000)', Number(fz.cost_transaction.amount) === 20000, String(fz.cost_transaction?.amount));
  check('approval creates the subcontractor payable at net 12,000 (F-42)', fz.accounts_payable && Number(fz.accounts_payable.amount) === 12000 && fz.accounts_payable.source_type === 'subcontract_certificate', JSON.stringify(fz.accounts_payable));
  check('approval holds retention 2,000 as a liability', fz.retention && Number(fz.retention.amount) === 2000 && fz.retention.status === 'held');

  // --- GL split.
  await expectStatus('GL posting needs a rule for every non-zero component (retention rule missing)', () => api('POST', `/finance/cost-transactions/${fz.cost_transaction.id}/post-gl`, admin), 422);
  must(await rule('subcontract_retention', acc.ret), 'rule ret'); must(await rule('subcontract_advance', acc.adv), 'rule adv'); must(await rule('subcontract_backcharge', acc.bc), 'rule bc');
  await run('certificate cost posted to GL', async () => must(await api('POST', `/finance/cost-transactions/${fz.cost_transaction.id}/post-gl`, admin), 'post gl'));
  if (OWNER) {
    const sum = (a, col) => sql(OWNER, `select coalesce(sum(${col}),0) from general_ledger where source_table='cost_transactions' and source_record_id=${fz.cost_transaction.id} and account_id=${a}`).out.trim();
    check('GL: Dr cost 20,000 / Cr payable 12,000, retention 2,000, advance 5,000, back-charges 1,000',
      sum(acc.cost, 'debit') === '20000.00' && sum(acc.ap, 'credit') === '12000.00' && sum(acc.ret, 'credit') === '2000.00' && sum(acc.adv, 'credit') === '5000.00' && sum(acc.bc, 'credit') === '1000.00',
      ['cost', 'ap', 'ret', 'adv', 'bc'].map(k => `${k}=${sum(acc[k], k === 'cost' ? 'debit' : 'credit')}`).join(' '));
  }

  // --- Certificate 2: cumulative 27,500 (blockwork 150 m2); period gross 7,500.
  await expectVerify2();
  async function expectVerify2() {
    const bad = await cert({ gross_work_done: 7500, less_retention: 750, less_advance_recovery: 1875, less_previous_paid: 20000 },
      [{ description: 'Blockwork m2', quantity_this_period: 50, cumulative_quantity: 150, unit_rate: 150 }, { description: 'Lintels nr', quantity_this_period: 0, cumulative_quantity: 10, unit_rate: 500 }]);
    const r = await verify(bad);
    check('a "less previous" deduction is refused: previous is implicit under cumulative valuation', r.status === 422, `HTTP ${r.status} ${r.body?.error ?? ''}`);
  }
  const c2 = await cert({ gross_work_done: 7500, less_retention: 750, less_advance_recovery: 1875 },
    [{ description: 'Blockwork m2', quantity_this_period: 50, cumulative_quantity: 150, unit_rate: 150 }, { description: 'Lintels nr', quantity_this_period: 0, cumulative_quantity: 10, unit_rate: 500 }]);
  const v2 = await verify(c2);
  check('certificate 2: cumulative 27,500 less previous 20,000 = period gross 7,500', v2.status === 200 && Number(v2.body.data.previous_cumulative_gross) === 20000 && Number(v2.body.data.cumulative_gross_to_date) === 27500, `HTTP ${v2.status} ${v2.body?.error ?? ''}`);
  const c3 = await cert({ gross_work_done: 1500, less_retention: 150, less_advance_recovery: 375 },
    [{ description: 'Blockwork m2', quantity_this_period: 10, cumulative_quantity: 140, unit_rate: 150 }, { description: 'Lintels nr', quantity_this_period: 0, cumulative_quantity: 10, unit_rate: 500 }]);
  const v3 = await verify(c3);
  check('inconsistent cumulative measure refused (26,000 - 27,500 is not the period gross 1,500)', v3.status === 422 && /does not equal the period gross/.test(v3.body?.error ?? ''), `HTTP ${v3.status} ${v3.body?.error ?? ''}`);

  // --- Retention release into its own payable.
  const ret = must(await api('GET', `/subcontracts/retentions?subcontract_id=${sc.id}`, qs), 'retentions')[0];
  await expectStatus('retention release needs a reason and the taking-over reference', () => api('POST', `/subcontracts/retentions/${ret.id}/release`, qs, {}), 400);
  const rel = await run('retention released against the taking-over certificate reference', async () => must(await api('POST', `/subcontracts/retentions/${ret.id}/release`, qs, { reason: 'Taking-over certificate issued for the blockwork section (fixture)', reference: `TOC-${TAG}` }), 'release'));
  check('released retention becomes its own payable of 2,000', rel.accounts_payable.source_type === 'subcontract_retention' && Number(rel.accounts_payable.amount) === 2000 && rel.retention.status === 'released');
  await expectStatus('retention cannot be released twice', () => api('POST', `/subcontracts/retentions/${ret.id}/release`, qs, { reason: 'Second release attempt (fixture)', reference: `TOC2-${TAG}` }), 409);

  // --- The subcontractor is paid through payments against the certificate payable (F-42).
  const bank = must(await api('GET', '/finance/bank-accounts', admin), 'banks').find(b => b.account_no === `ACC-${TAG}`).id;
  const pay = await run('payment of the 12,000 certificate payable recorded', async () => must(await api('POST', '/finance/payments', fm1, { payment_type: 'outgoing', party_type: 'vendor', party_id: vendor, related_ap_id: fz.accounts_payable.id, amount: 12000, currency_id: 1, bank_account_id: bank, method: 'transfer', reference_no: `SGP-${TAG}` }), 'pay'));
  must(await approve(fin, must(await api('POST', `/finance/payments/${pay.id}/submit-approval`, fm1), 'submit pay').approval.id), 'approve pay');
  must(await api('POST', `/finance/payments/${pay.id}/post-gl`, fm2), 'post pay');
  const apRow = must(await api('GET', '/finance/ap', admin), 'ap').find(x => Number(x.id) === Number(fz.accounts_payable.id));
  check('certificate payable settled: paid', apRow?.status === 'paid', apRow?.status);

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: retention records are never deleted', `delete from subcontract_retentions where id = ${ret.id}`);
    probe('DB: a released retention is immutable', `update subcontract_retentions set amount = 1 where id = ${ret.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  check('tenant B sees no tenant A retentions', must(await api('GET', `/subcontracts/retentions?subcontract_id=${sc.id}`, tb), 'b ret').length === 0);
  await expectStatus('tenant B cannot release a tenant A retention', () => api('POST', `/subcontracts/retentions/${ret.id}/release`, tb, { reason: 'cross tenant attempt here', reference: 'XXX' }), 404);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_subcontract_gl');
