// Stage 24 / GC-13 steps 5-8 (F-36, F-37): confirmed contract payment terms drive the receivable due date; the client's
// certified breakdown (gross, retention, advance recovery, previous) is validated and then used for the retention
// ledger, the advance outstanding and the "previous certified" cap. Terms, amounts and days are TEST FIXTURES.
// Runs after chain.mjs, sweep_subcontract_deductions and sweep_client_ipc_deductions (reuses their users).
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const existing = (key) => login({ email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id });
  const fm1 = await existing('cifm1'), fm2 = await existing('cifm2'), pm = await existing('pm'), s1 = await existing('w1s1'), s2 = await existing('w1s2');
  const qs = await existing('sdqs'), qs2 = await existing('sdqs2');
  const approve = (tok, id) => api('POST', `/approvals/${id}/actions`, tok, { action: 'approved', comment: 'fixture' });

  const client = must(await api('POST', '/clients', admin, { client_name: `PT Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `PT-${TAG}`, project_name: `PT ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const signed = async (body) => {
    const id = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', currency_id: 1, retention_percent: 5, ...body }), 'contract').id;
    const a = must(await api('POST', `/contracts/${id}/submit-approval`, admin), 'sign').approval;
    must(await approve(s1, a.id), 'sign 1'); must(await approve(s2, a.id), 'sign 2');
    return id;
  };
  const contract = await signed({ contract_value: 800000, advance_payment_percent: 10 });
  const bare = await signed({ contract_value: 300000 });

  // --- Payment terms (F-37).
  await expectStatus('payment terms need a stated basis', () => api('POST', `/contract-admin/contracts/${contract}/payment-terms`, qs, { basis: 'net_30', days: 30, clause_ref: '14.7', source_reference: 'Particular Conditions 14.7 (fixture)' }), 400);
  const terms = await run('payment terms entered from the contract (30 days after client certification, clause 14.7)', async () => must(await api('POST', `/contract-admin/contracts/${contract}/payment-terms`, qs, { basis: 'after_client_certification', days: 30, clause_ref: '14.7', source_reference: 'Particular Conditions 14.7 (fixture)' }), 'terms'));
  await expectStatus('author cannot confirm own payment terms (SoD)', () => api('POST', `/contract-admin/payment-terms/${terms.id}/confirm`, qs), 403);
  await run('second person confirms the payment terms', async () => must(await api('POST', `/contract-admin/payment-terms/${terms.id}/confirm`, qs2), 'confirm'));
  await expectStatus('one set of payment terms per contract', () => api('POST', `/contract-admin/contracts/${contract}/payment-terms`, qs, { basis: 'after_submission', days: 56, clause_ref: '14.7', source_reference: 'second attempt (fixture)' }), 409);

  // --- Client advance received (manual recovery: no rate recorded).
  const adv = must(await api('POST', '/finance/client-advances', fm1, { contract_id: contract, amount: 40000, guarantee_ref: `APG-PT-${TAG}` }), 'adv');
  must(await api('POST', `/finance/client-advances/${adv.id}/approve`, fm2), 'adv approve');
  must(await api('POST', `/finance/client-advances/${adv.id}/received`, fm2, { receipt_reference: `RCP-PT-${TAG}` }), 'adv received');

  let n = 0;
  const submitted = async (contractId, body) => {
    const i = must(await api('POST', '/finance/ipcs', fm1, { project_id: project, contract_id: contractId, ipc_no: `PT${++n}-${TAG}`, period_from: day(-30), period_to: day(-1), ...body }), 'ipc');
    must(await approve(pm, must(await api('POST', `/finance/ipcs/${i.id}/submit-to-client`, fm1), 'submit').approval.id), 'pm approve');
    return i;
  };
  const certify = (id, body) => api('POST', `/finance/ipcs/${id}/client-approve`, fm2, { client_reference: `PTC-${TAG}-${id}`, certified_on: day(0), ...body });

  // --- Client breakdown (F-36): IPC A submitted 100,000 gross / 5,000 retention / 10,000 recovery = 85,000 net.
  const a = await submitted(contract, { gross_work_done_this_period: 100000, cumulative_gross_work_done: 100000, less_retention: 5000, less_advance_recovery: 10000 });
  const reason = 'Client measured less work and recovered less advance this period (fixture)';
  await expectStatus('an incomplete client breakdown is refused', () => certify(a.id, { certified_amount: 84250, certified_gross: 95000, difference_reason: reason }), 422);
  await expectStatus('a client breakdown that does not add up to the certified net is refused', () => certify(a.id, { certified_amount: 84000, certified_gross: 95000, certified_retention: 4750, certified_advance_recovery: 6000, certified_previous: 0, difference_reason: reason }), 422);
  await expectStatus('certified retention above the contract 5% is refused', () => certify(a.id, { certified_amount: 83000, certified_gross: 95000, certified_retention: 6000, certified_advance_recovery: 6000, certified_previous: 0, difference_reason: reason }), 422);
  const ca = await certify(a.id, { certified_amount: 84250, certified_gross: 95000, certified_retention: 4750, certified_advance_recovery: 6000, certified_previous: 0, difference_reason: reason });
  check('client breakdown recorded: 95,000 - 4,750 - 6,000 - 0 = 84,250', ca.status === 200 && Number(ca.body.data.client_certified_gross) === 95000 && Number(ca.body.data.client_certified_amount) === 84250, `HTTP ${ca.status} ${ca.body?.error ?? ''}`);
  const pa = await run('IPC A posted to AR/GL', async () => must(await api('POST', `/finance/ipcs/${a.id}/post-ar-gl`, admin), 'post a'));
  check('receivable due 30 days after the client certification date, from the confirmed terms', String(pa.accounts_receivable.due_date).slice(0, 10) === day(30) && pa.due_date_basis === 'contract_payment_terms' && Number(pa.accounts_receivable.amount) === 84250, `${pa.accounts_receivable.due_date} ${pa.due_date_basis}`);

  const pos = must(await api('GET', `/finance/contracts/${contract}/advance-position`, fm1), 'position');
  check('advance recovered follows the client-certified 6,000 (outstanding 34,000)', Number(pos.advance_recovered) === 6000 && Number(pos.advance_outstanding) === 34000 && Number(pos.net_certified) === 84250, JSON.stringify(pos));
  const ipc = (body) => api('POST', '/finance/ipcs', fm1, { project_id: project, contract_id: contract, ipc_no: `PT${++n}-${TAG}`, period_from: day(-1), period_to: day(-1), ...body });
  const over = await ipc({ gross_work_done_this_period: 200000, cumulative_gross_work_done: 300000, less_advance_recovery: 35000 });
  check('recovery above the certified outstanding 34,000 refused', over.status === 422 && /outstanding received advance 34000/.test(over.body?.error ?? ''), `HTTP ${over.status} ${over.body?.error ?? ''}`);
  const prev = await ipc({ gross_work_done_this_period: 200000, cumulative_gross_work_done: 300000, less_previous_certified: 84300 });
  check('less previous capped at the client-certified 84,250 (not the submitted 85,000)', prev.status === 422 && /84250/.test(prev.body?.error ?? ''), `HTTP ${prev.status} ${prev.body?.error ?? ''}`);

  // --- No confirmed terms: the due date is left empty and said so.
  const b = await submitted(bare, { gross_work_done_this_period: 10000, cumulative_gross_work_done: 10000, less_retention: 500 });
  must(await certify(b.id, { certified_amount: 9500 }), 'certify b');
  const pb = must(await api('POST', `/finance/ipcs/${b.id}/post-ar-gl`, admin), 'post b');
  check('without confirmed payment terms the due date is empty and flagged, not invented', pb.accounts_receivable.due_date === null && pb.due_date_basis === 'no_confirmed_payment_terms', `${pb.accounts_receivable.due_date} ${pb.due_date_basis}`);

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    const rl = sql(OWNER, `select retained_amount from retention_ledger where ipc_id = ${a.id}`);
    check('retention ledger holds the client-certified 4,750', rl.ok && /^4750\.00$/m.test(rl.out), rl.out);
    probe('DB: a receivable due date not following the terms is refused', `update accounts_receivable set due_date = due_date + 1 where ipc_id = ${a.id}`);
    probe('DB: confirmed payment terms are immutable', `update contract_payment_terms set days = 60 where id = ${terms.id}`);
    probe('DB: the certified breakdown is immutable', `update ipcs set client_certified_retention = 0 where id = ${a.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot confirm tenant A payment terms', () => api('POST', `/contract-admin/payment-terms/${terms.id}/confirm`, tb), 404);
  const tbRead = await api('GET', `/contract-admin/contracts/${contract}/payment-terms`, tb);
  check('tenant B reads no tenant A payment terms', tbRead.status === 404 || (tbRead.ok && tbRead.body?.data === null), `HTTP ${tbRead.status}`);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_ipc_terms_breakdown');
