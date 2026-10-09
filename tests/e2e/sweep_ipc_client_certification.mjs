// Stage 22 / GC-13 steps 5-6 (F-35): client certification of IPCs recorded as evidence (amount, reference, date,
// recorder other than the preparer, reason for any difference), dispute and resubmission, AR raised at the certified
// amount. Amounts are TEST FIXTURES. Runs after chain.mjs and sweep_client_ipc_deductions (reuses their users).
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const existing = (key) => login({ email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id });
  const fm1 = await existing('cifm1'), fm2 = await existing('cifm2'), pm = await existing('pm'), s1 = await existing('w1s1'), s2 = await existing('w1s2');
  const approve = (tok, id) => api('POST', `/approvals/${id}/actions`, tok, { action: 'approved', comment: 'fixture' });

  const client = must(await api('POST', '/clients', admin, { client_name: `CC Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `CC-${TAG}`, project_name: `CC ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const contract = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 800000, currency_id: 1, retention_percent: 5 }), 'contract').id;
  const csa = must(await api('POST', `/contracts/${contract}/submit-approval`, admin), 'sign').approval;
  must(await approve(s1, csa.id), 'sign 1'); must(await approve(s2, csa.id), 'sign 2');

  let n = 0;
  const submitted = async (gross) => {
    const i = must(await api('POST', '/finance/ipcs', fm1, { project_id: project, contract_id: contract, ipc_no: `CC${++n}-${TAG}`, period_from: day(-30), period_to: day(-1), gross_work_done_this_period: gross, cumulative_gross_work_done: gross, less_retention: gross * 0.05 }), 'ipc');
    must(await approve(pm, must(await api('POST', `/finance/ipcs/${i.id}/submit-to-client`, fm1), 'submit').approval.id), 'pm approve');
    return i;
  };
  const certify = (tok, id, body) => api('POST', `/finance/ipcs/${id}/client-approve`, tok, body);

  const draft = must(await api('POST', '/finance/ipcs', fm1, { project_id: project, contract_id: contract, ipc_no: `CC0-${TAG}`, period_from: day(-30), period_to: day(-1), gross_work_done_this_period: 1000, cumulative_gross_work_done: 1000, less_retention: 50 }), 'draft');
  await expectStatus('a draft IPC cannot be certified', () => certify(fm2, draft.id, { certified_amount: 950, client_reference: `CCX-${TAG}`, certified_on: day(0) }), 409);

  const a = await submitted(100000);
  const aRow = must(await api('GET', '/finance/ipcs', admin), 'ipcs').find(x => x.id === a.id);
  check('IPC A submitted to the client with a submission date', aRow.status === 'submitted_to_client' && !!aRow.submitted_date, `${aRow.status} ${aRow.submitted_date}`);
  await expectStatus('the IPC preparer cannot record the client certification (SoD)', () => certify(fm1, a.id, { certified_amount: 95000, client_reference: `CCA-${TAG}`, certified_on: day(0) }), 403);
  await expectStatus('certification without amount and reference refused', () => certify(fm2, a.id, {}), 400);
  await expectStatus('certification dated in the future refused', () => certify(fm2, a.id, { certified_amount: 95000, client_reference: `CCA-${TAG}`, certified_on: day(2) }), 422);
  await expectStatus('certification dated before submission refused', () => certify(fm2, a.id, { certified_amount: 95000, client_reference: `CCA-${TAG}`, certified_on: day(-5) }), 422);
  await expectStatus('a certified amount different from the submitted net needs a reason', () => certify(fm2, a.id, { certified_amount: 90000, client_reference: `CCA-${TAG}`, certified_on: day(0) }), 422);
  const ca = await certify(fm2, a.id, { certified_amount: 90000, client_reference: `CCA-${TAG}`, certified_on: day(0), difference_reason: 'Client measured 50 m3 less concrete in zone C (fixture)' });
  check('client certification recorded: 90,000 certified against 95,000 submitted, difference 5,000 visible', ca.status === 200 && Number(ca.body.data.client_certified_amount) === 90000 && Number(ca.body.data.certification_difference) === 5000, `HTTP ${ca.status} ${JSON.stringify(ca.body?.data ?? ca.body?.error ?? '').slice(0, 200)}`);
  await expectStatus('certification cannot be recorded twice', () => certify(fm2, a.id, { certified_amount: 95000, client_reference: `CCA2-${TAG}`, certified_on: day(0) }), 409);
  const posted = await run('IPC A posted to AR/GL', async () => must(await api('POST', `/finance/ipcs/${a.id}/post-ar-gl`, admin), 'post'));
  check('receivable raised at the client-certified 90,000 (not the submitted 95,000)', Number(posted.accounts_receivable.amount) === 90000 && posted.basis === 'client_certified', `${posted.accounts_receivable.amount} ${posted.basis}`);

  // --- Dispute and resubmission.
  const b = await submitted(200000);
  await expectStatus('a dispute needs the client reason', () => api('POST', `/finance/ipcs/${b.id}/client-dispute`, fm2, {}), 400);
  await run('client dispute recorded with its reason', async () => must(await api('POST', `/finance/ipcs/${b.id}/client-dispute`, fm2, { reason: 'Client rejects valuation of variation items (fixture)' }), 'dispute'));
  await expectStatus('a disputed IPC cannot be certified', () => certify(fm2, b.id, { certified_amount: 190000, client_reference: `CCB-${TAG}`, certified_on: day(0) }), 409);
  await expectStatus('resubmission needs a note', () => api('POST', `/finance/ipcs/${b.id}/resubmit-to-client`, fm1, {}), 400);
  await run('resubmitted after the dispute with a note', async () => must(await api('POST', `/finance/ipcs/${b.id}/resubmit-to-client`, fm1, { note: 'Variation items re-measured jointly; agreed (fixture)' }), 'resubmit'));
  const cb = await certify(fm2, b.id, { certified_amount: 190000, client_reference: `CCB-${TAG}`, certified_on: day(0) });
  check('certification equal to the submitted net needs no reason', cb.status === 200 && Number(cb.body.data.certification_difference) === 0, `HTTP ${cb.status} ${cb.body?.error ?? ''}`);

  const c = await submitted(50000);
  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: recorded certification is immutable', `update ipcs set client_certified_amount = 95000 where id = ${a.id}`);
    probe('DB: a receivable different from the certified amount is refused', `update accounts_receivable set amount = 95000 where ipc_id = ${a.id}`);
    probe('DB: approval without certification evidence refused', `update ipcs set status = 'client_approved', client_approved_date = current_date where id = ${c.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot certify a tenant A IPC', () => certify(tb, b.id, { certified_amount: 1, client_reference: 'XXX', certified_on: day(0) }), 404);
  await expectStatus('tenant B cannot dispute a tenant A IPC', () => api('POST', `/finance/ipcs/${draft.id}/client-dispute`, tb, { reason: 'cross tenant attempt here' }), 409);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_ipc_client_certification');
