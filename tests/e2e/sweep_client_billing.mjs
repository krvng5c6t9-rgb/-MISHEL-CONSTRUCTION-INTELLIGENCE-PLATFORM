// Stage 30 / DEC-009 part 1 (GC-13): the client IPC as a billing - receivable (net), retention kept by the client as a
// conditional contract asset, advance recovered against the client advances liability, period billing credited; the
// client advance received through receipts (part receipts keep it approved); client retention released against its
// certificate into its own receivable and collected; contract receivable position. Amounts are TEST FIXTURES.
// Runs after chain (GL rules, bank) and sweep_client_ipc_deductions (finance users).
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const today = new Date().toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const existing = (key) => login({ email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id });
  const fm1 = await existing('cifm1'), fm2 = await existing('cifm2'), fin = await existing('fin'), pm = await existing('pm'), s1 = await existing('w1s1'), s2 = await existing('w1s2');
  const approve = (tok, id) => api('POST', `/approvals/${id}/actions`, tok, { action: 'approved', comment: 'fixture' });
  const coa = must(await api('GET', '/finance/chart-of-accounts', admin), 'coa');
  const acct = (code) => Number(coa.find(a => a.account_code === `${code}-${TAG}`).id);
  const acc = { ar: acct('1200'), ret: acct('1250'), cadv: acct('2200'), rev: acct('4100'), bank: acct('1010') };
  const bank = must(await api('GET', '/finance/bank-accounts', admin), 'banks').find(b => b.account_no === `ACC-${TAG}`).id;

  const client = must(await api('POST', '/clients', admin, { client_name: `CB Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `CB-${TAG}`, project_name: `CB ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const contract = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 410000, currency_id: 1, retention_percent: 5, advance_payment_percent: 10 }), 'contract').id;
  const csa = must(await api('POST', `/contracts/${contract}/submit-approval`, admin), 'sign submit').approval;
  must(await approve(s1, csa.id), 'sign 1'); must(await approve(s2, csa.id), 'sign 2');

  const receipt = async (ar, amount, ref) => {
    const p = must(await api('POST', '/finance/payments', fm1, { payment_type: 'incoming', party_type: 'client', party_id: client, related_ar_id: ar, amount, currency_id: 1, bank_account_id: bank, method: 'transfer', reference_no: ref }), 'receipt');
    must(await approve(fin, must(await api('POST', `/finance/payments/${p.id}/submit-approval`, fm1), 'submit receipt').approval.id), 'approve receipt');
    must(await api('POST', `/finance/payments/${p.id}/post-gl`, fm2), 'post receipt');
    return p;
  };
  const glOf = (table, id, account, col) => sql(OWNER, `select coalesce(sum(${col}),0) from general_ledger where source_table='${table}' and source_record_id=${id} and account_id=${account}`).out.trim();

  // --- Client advance 40,000 received in two receipts.
  const adv = must(await api('POST', '/finance/client-advances', fm1, { contract_id: contract, amount: 40000, recovery_percent: 20, guarantee_ref: `APG-CB-${TAG}` }), 'adv');
  const appr = await run('advance approved: opens its request receivable', async () => must(await api('POST', `/finance/client-advances/${adv.id}/approve`, fm2), 'approve adv'));
  check('advance request receivable: source client_advance, 40,000, no IPC', appr.accounts_receivable?.source_type === 'client_advance' && Number(appr.accounts_receivable.amount) === 40000 && appr.accounts_receivable.ipc_id === null, JSON.stringify(appr.accounts_receivable));
  const advAr = appr.accounts_receivable.id;
  const r1 = await receipt(advAr, 15000, `CBR1-${TAG}`);
  const advMid = must(await api('GET', `/finance/client-advances?contract_id=${contract}`, fm1), 'adv list')[0];
  check('advance part-received (15,000 of 40,000) stays approved - recovery counts only received advances', advMid.status === 'approved', advMid.status);
  await expectStatus('a receipt above the advance outstanding refused (30,000 > 25,000)', () => api('POST', '/finance/payments', fm1, { payment_type: 'incoming', party_type: 'client', party_id: client, related_ar_id: advAr, amount: 30000, currency_id: 1, bank_account_id: bank, method: 'transfer' }), 422);
  const r2 = await receipt(advAr, 25000, `CBR2-${TAG}`);
  const advDone = must(await api('GET', `/finance/client-advances?contract_id=${contract}`, fm1), 'adv list')[0];
  check('advance received when its receivable is settled, evidenced by the last receipt', advDone.status === 'received' && Number(advDone.received_payment_id) === Number(r2.id) && advDone.receipt_reference === `CBR2-${TAG}`, JSON.stringify(advDone));
  if (OWNER) {
    const c = Number(glOf('payments', r1.id, acc.cadv, 'credit')) + Number(glOf('payments', r2.id, acc.cadv, 'credit'));
    const arCr = Number(glOf('payments', r1.id, acc.ar, 'credit')) + Number(glOf('payments', r2.id, acc.ar, 'credit'));
    check('GL: the advance receipts credit advances from clients 40,000 (liability), not receivables', c === 40000 && arCr === 0, `cadv=${c} ar=${arCr}`);
  }

  // --- IPC 1: gross 100,000; retention 5,000; advance recovery 20,000; net 75,000.
  const i1 = must(await api('POST', '/finance/ipcs', fm1, { project_id: project, contract_id: contract, ipc_no: `CB1-${TAG}`, period_from: today, period_to: today, gross_work_done_this_period: 100000, cumulative_gross_work_done: 100000, less_retention: 5000, less_advance_recovery: 20000 }), 'ipc');
  must(await approve(pm, must(await api('POST', `/finance/ipcs/${i1.id}/submit-to-client`, fm1), 'submit').approval.id), 'pm approve');
  must(await api('POST', `/finance/ipcs/${i1.id}/client-approve`, fm2, { certified_amount: 75000, client_reference: `CBC1-${TAG}`, certified_on: today }), 'client approve');
  const posted = await run('IPC posted as a billing', async () => must(await api('POST', `/finance/ipcs/${i1.id}/post-ar-gl`, admin), 'post ipc'));
  check('receivable at the certified net 75,000; billing split returned', Number(posted.accounts_receivable.amount) === 75000 && posted.billing_gl?.length === 2, JSON.stringify({ ar: posted.accounts_receivable?.amount, splits: posted.billing_gl?.length }));
  if (OWNER) {
    check('GL: Dr receivables 75,000 + retention receivable 5,000 + advances from clients 20,000 / Cr billing 100,000',
      glOf('ipcs', i1.id, acc.ar, 'debit') === '75000.00' && glOf('ipcs', i1.id, acc.ret, 'debit') === '5000.00' && glOf('ipcs', i1.id, acc.cadv, 'debit') === '20000.00' && glOf('ipcs', i1.id, acc.rev, 'credit') === '100000.00',
      ['ar', 'ret', 'cadv'].map(k => `${k}=${glOf('ipcs', i1.id, acc[k], 'debit')}`).join(' ') + ` billing=${glOf('ipcs', i1.id, acc.rev, 'credit')}`);
  }
  await receipt(posted.accounts_receivable.id, 75000, `CBR3-${TAG}`);

  // --- Retention release and collection.
  const ret = must(await api('GET', `/finance/retentions?contract_id=${contract}`, fm1), 'retentions')[0];
  check('retention 5,000 held for IPC CB1', ret && Number(ret.retained_amount) === 5000 && ret.release_status === 'held' && ret.ipc_no === `CB1-${TAG}`, JSON.stringify(ret));
  await expectStatus('release needs a reason and the certificate reference', () => api('POST', `/finance/retentions/${ret.id}/release`, fm2, {}), 400);
  await expectStatus('the IPC preparer cannot release its retention (SoD)', () => api('POST', `/finance/retentions/${ret.id}/release`, fm1, { reason: 'Taking-over certificate issued (fixture)', reference: `TOC-CB-${TAG}` }), 403);
  const rel = await run('retention released against the taking-over certificate', async () => must(await api('POST', `/finance/retentions/${ret.id}/release`, fm2, { reason: 'Taking-over certificate issued (fixture)', reference: `TOC-CB-${TAG}` }), 'release'));
  check('released retention becomes its own receivable of 5,000', rel.accounts_receivable.source_type === 'retention_release' && Number(rel.accounts_receivable.amount) === 5000 && rel.retention.release_status === 'released', JSON.stringify(rel.accounts_receivable));
  await expectStatus('retention cannot be released twice', () => api('POST', `/finance/retentions/${ret.id}/release`, fm2, { reason: 'Second release attempt (fixture)', reference: `TOC2-${TAG}` }), 409);
  const arList = must(await api('GET', '/finance/ar', admin), 'ar');
  check('receivables list shows the advance request and the released retention (with its IPC)', arList.some(a => Number(a.id) === Number(advAr)) && arList.some(a => Number(a.id) === Number(rel.accounts_receivable.id) && a.ipc_no === `CB1-${TAG}`));
  const r4 = await receipt(rel.accounts_receivable.id, 5000, `CBR4-${TAG}`);
  if (OWNER) {
    // Stage 31 (080): the release reclassifies the retention to receivables; the receipt then clears receivables.
    check('GL: release reclassifies Dr receivables 5,000 / Cr retention receivable 5,000', glOf('retention_ledger', ret.id, acc.ar, 'debit') === '5000.00' && glOf('retention_ledger', ret.id, acc.ret, 'credit') === '5000.00', `${glOf('retention_ledger', ret.id, acc.ar, 'debit')} / ${glOf('retention_ledger', ret.id, acc.ret, 'credit')}`);
    check('GL: collecting released retention credits receivables 5,000', glOf('payments', r4.id, acc.ar, 'credit') === '5000.00' && glOf('payments', r4.id, acc.ret, 'credit') === '0', glOf('payments', r4.id, acc.ar, 'credit'));
  }

  const pos = must(await api('GET', `/finance/contracts/${contract}/receivable-position`, fm1), 'position');
  check('position: billed 100,000 (net 75,000), collected 80,000, nothing outstanding, retention 5,000 released',
    Number(pos.billed_gross) === 100000 && Number(pos.billed_net) === 75000 && Number(pos.collected) === 80000 && Number(pos.receivables_outstanding) === 0 && Number(pos.retention_held) === 0 && Number(pos.retention_released) === 5000, JSON.stringify(pos));
  check('position: advance 40,000 received, 20,000 recovered, liability 20,000', Number(pos.advances_received) === 40000 && Number(pos.advance_recovered) === 20000 && Number(pos.advance_liability) === 20000 && Number(pos.advance_requests_outstanding) === 0, JSON.stringify(pos));

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: an advance request receivable must equal the advance', `update accounts_receivable set amount = 1 where id = ${advAr}`);
    probe('DB: a released retention is immutable', `update retention_ledger set retained_amount = 1 where id = ${ret.id}`);
    probe('DB: retention records are never deleted', `delete from retention_ledger where id = ${ret.id}`);
    probe('DB: a non-IPC receivable must name its source', `update accounts_receivable set source_record_id = null where id = ${advAr}`);
    const a2 = must(await api('POST', '/finance/client-advances', fm1, { contract_id: contract, amount: 1000, guarantee_ref: `APG-CB2-${TAG}` }), 'adv2');
    must(await api('POST', `/finance/client-advances/${a2.id}/approve`, fm2), 'adv2 approve');
    probe('DB: a client advance cannot be set received without a posted receipt', `update client_advances set status = 'received', received_at = now(), receipt_reference = 'TYPED-REF', received_by = approved_by where id = ${a2.id}`);
    await expectStatus('a client advance cannot be marked received through the old route', () => api('POST', `/finance/client-advances/${a2.id}/received`, fm2, { receipt_reference: 'TYPED-REF' }), 409);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  check('tenant B sees no tenant A retentions', must(await api('GET', `/finance/retentions?contract_id=${contract}`, tb), 'b ret').length === 0);
  await expectStatus('tenant B cannot release a tenant A retention', () => api('POST', `/finance/retentions/${ret.id}/release`, tb, { reason: 'cross tenant attempt here', reference: 'XXX' }), 404);
  await expectStatus('tenant B cannot read a tenant A contract position', () => api('GET', `/finance/contracts/${contract}/receivable-position`, tb), 404);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_client_billing');
