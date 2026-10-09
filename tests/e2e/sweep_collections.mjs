// Stage 25 / GC-13 step 8: receipts settle the receivable they reference - own client, within the outstanding balance,
// partial receipts leave it partially_paid, the IPC is paid only when fully settled, concurrent approvals cannot
// over-settle; receivable aging against the contractual due date; the payable mirror. Amounts are TEST FIXTURES.
// Runs after chain.mjs and sweep_ipc_terms_breakdown (uses their GL fixtures, users and receivables).
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const existing = (key) => login({ email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id });
  const fm1 = await existing('cifm1'), fm2 = await existing('cifm2'), fin = await existing('fin');
  const coa = must(await api('GET', '/finance/chart-of-accounts', admin), 'coa');
  const acct = (code) => coa.find(a => a.account_code === `${code}-${TAG}`).id;
  must(await api('POST', '/finance/gl-posting-rules', admin, { source_module: 'payment', source_subtype: 'incoming', debit_account_id: acct('1010'), credit_account_id: acct('1200'), notes: 'TEST FIXTURE' }), 'incoming rule');
  const bank = must(await api('GET', '/finance/bank-accounts', admin), 'banks').find(b => b.account_no === `ACC-${TAG}`).id;
  const ars = must(await api('GET', '/finance/ar', admin), 'ar');
  const ar = ars.find(a => a.ipc_no === `PT1-${TAG}`);
  const other = ars.find(a => Number(a.client_id) !== Number(ar.client_id));
  check('receivable for IPC PT1 is open at the client-certified 84,250 with a due date', ar && Number(ar.amount) === 84250 && ar.status === 'open' && !!ar.due_date, JSON.stringify({ amount: ar?.amount, status: ar?.status, due: ar?.due_date }));

  const receipt = (amount, extra = {}) => api('POST', '/finance/payments', fm1, { payment_type: 'incoming', party_type: 'client', party_id: Number(ar.client_id), related_ar_id: ar.id, amount, currency_id: Number(ar.currency_id), bank_account_id: bank, method: 'transfer', reference_no: `RC-${TAG}-${amount}`, payment_date: day(0), ...extra });
  const submit = async (id) => must(await api('POST', `/finance/payments/${id}/submit-approval`, fm1), 'submit').approval;
  const approve = (approvalId) => api('POST', `/approvals/${approvalId}/actions`, fin, { action: 'approved', comment: 'fixture' });
  const arStatus = async () => must(await api('GET', '/finance/ar', admin), 'ar').find(a => a.id === ar.id);

  await expectStatus('a receipt naming another client is refused', () => receipt(1000, { party_id: Number(other.client_id) }), 422);
  await expectStatus('a receipt above the outstanding balance is refused', () => receipt(90000), 422);

  // --- Partial receipt.
  const r1 = await run('receipt of 50,000 recorded', async () => must(await receipt(50000), 'r1'));
  must(await approve((await submit(r1.id)).id), 'approve r1');
  await run('receipt posted to GL', async () => must(await api('POST', `/finance/payments/${r1.id}/post-gl`, fm2), 'post r1'));
  const afterPartial = await arStatus();
  const ipcAfterPartial = must(await api('GET', '/finance/ipcs', admin), 'ipcs').find(i => i.ipc_no === `PT1-${TAG}`);
  check('partial receipt leaves the receivable partially_paid and the IPC posted (not paid)', afterPartial.status === 'partially_paid' && ipcAfterPartial.status === 'posted', `${afterPartial.status} / ${ipcAfterPartial.status}`);
  await expectStatus('a further receipt above the remaining 34,250 is refused', () => receipt(40000), 422);

  // --- Aging against the contractual due date (30 days after certification).
  const aging = async (asOf) => must(await api('GET', `/finance/receivables/aging?as_of=${asOf}`, admin), 'aging').find(a => Number(a.receivable_id) === Number(ar.id));
  const early = await aging(day(10)), late = await aging(day(40));
  check('aging before the due date: 34,250 outstanding, not yet due', early && Number(early.outstanding) === 34250 && early.aging_basis === 'not_yet_due' && early.days_overdue === 0, JSON.stringify(early));
  check('aging 10 days after the due date: 34,250 overdue by 10 days', late && Number(late.outstanding) === 34250 && late.aging_basis === 'overdue' && late.days_overdue === 10, JSON.stringify(late));
  const noTerms = must(await api('GET', `/finance/receivables/aging?as_of=${day(40)}`, admin), 'aging all').find(a => a.project_name === `PT ${TAG}` && a.due_date === null);
  check('a receivable without contractual payment terms is listed as such, not as overdue', noTerms && noTerms.aging_basis === 'no_due_date_recorded' && noTerms.days_overdue === null, JSON.stringify(noTerms));

  // --- Race: two drafts of the remaining 34,250; only one may be approved.
  const a = must(await receipt(34250, { reference_no: `RC-${TAG}-A` }), 'ra'), b = must(await receipt(34250, { reference_no: `RC-${TAG}-B` }), 'rb');
  const [sa, sb] = [await submit(a.id), await submit(b.id)];
  const race = await Promise.all([approve(sa.id), approve(sb.id)]);
  check('concurrent approvals cannot settle the remaining 34,250 twice (one 200, one 422)', race.map(r => r.status).sort().join(',') === '200,422', race.map(r => `${r.status} ${r.body?.error ?? ''}`).join(' | '));
  const winner = race[0].status === 200 ? a : b;
  await run('final receipt posted', async () => must(await api('POST', `/finance/payments/${winner.id}/post-gl`, fm2), 'post final'));
  const settled = await arStatus();
  const ipcPaid = must(await api('GET', '/finance/ipcs', admin), 'ipcs').find(i => i.ipc_no === `PT1-${TAG}`);
  check('fully settled: receivable paid, IPC paid with the receipt date', settled.status === 'paid' && ipcPaid.status === 'paid' && String(ipcPaid.paid_date).slice(0, 10) === day(0), `${settled.status} / ${ipcPaid.status} ${ipcPaid.paid_date}`);
  check('a settled receivable leaves the aging list', !(await aging(day(40))));

  // --- Payable mirror.
  const ap = must(await api('GET', '/finance/ap', admin), 'ap').find(x => x.status === 'paid');
  await expectStatus('a payment against a fully paid payable is refused', () => api('POST', '/finance/payments', fm1, { payment_type: 'outgoing', party_type: 'vendor', party_id: Number(ap.vendor_id), related_ap_id: ap.id, amount: 1, currency_id: Number(ap.currency_id), bank_account_id: bank, method: 'transfer', reference_no: `PAYX-${TAG}` }), 422);

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: over-settlement refused even when written directly', `insert into payments(org_id, payment_type, party_type, party_id, related_ar_id, amount, currency_id, payment_date, bank_account_id, method, created_by) select org_id, 'incoming', 'client', client_id, id, 1, currency_id, current_date, ${bank}, 'transfer', 1 from accounts_receivable where id = ${ar.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  const bAging = must(await api('GET', `/finance/receivables/aging?as_of=${day(40)}`, tb), 'b aging');
  check('tenant B aging shows no tenant A receivables', !bAging.some(x => String(x.ipc_no ?? '').includes(TAG)), `${bAging.length} rows`);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_collections');
