// Stage 21 / GC-13 step 3 (F-32): client advance payments received under the contract, recovery on IPCs, retention
// within the contract percentage, "less previous certified" bounded. Contract value, advance %, recovery rate,
// retention and amounts are TEST FIXTURES. Runs after chain.mjs (reuses its signers and IPC approver).
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const today = new Date().toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const existing = (key) => login({ email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id });
  const role = must(await api('POST', '/roles', admin, { role_name: `CI Finance ${TAG}`, permissions: ['view', 'manage', 'approve', 'post'].map(action => ({ module: 'finance', action, scope: 'all' })) }), 'role').id;
  const mkUser = async (key) => {
    must(await api('POST', '/users', admin, { role_id: role, full_name: `CI ${key}`, email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}` }), `user ${key}`);
    return existing(key);
  };
  const fm1 = await mkUser('cifm1'), fm2 = await mkUser('cifm2');
  const pm = await existing('pm'), s1 = await existing('w1s1'), s2 = await existing('w1s2');
  const approve = (tok, id) => api('POST', `/approvals/${id}/actions`, tok, { action: 'approved', comment: 'fixture' });

  const client = must(await api('POST', '/clients', admin, { client_name: `CI Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `CI-${TAG}`, project_name: `CI ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const contract = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 500000, currency_id: 1, retention_percent: 5, advance_payment_percent: 10 }), 'contract').id;
  const csa = must(await api('POST', `/contracts/${contract}/submit-approval`, admin), 'sign submit').approval;
  must(await approve(s1, csa.id), 'sign 1'); must(await approve(s2, csa.id), 'sign 2');

  // --- Advances.
  const chainProject = must(await api('GET', '/projects', admin), 'projects').find(p => p.project_code === `P-${TAG}`);
  const chainContract = must(await api('GET', '/contracts', admin), 'contracts').find(c => Number(c.project_id) === Number(chainProject.id));
  await expectStatus('advance refused where the contract provides none', () => api('POST', '/finance/client-advances', fm1, { contract_id: chainContract.id, amount: 1000 }), 422);
  await expectStatus('advance above the contract advance % refused (60,000 > 10% of 500,000)', () => api('POST', '/finance/client-advances', fm1, { contract_id: contract, amount: 60000 }), 422);
  const adv = await run('advance recorded (50,000, recovery 20% of gross this period, guarantee ref)', async () => must(await api('POST', '/finance/client-advances', fm1, { contract_id: contract, amount: 50000, recovery_percent: 20, guarantee_ref: `APG-${TAG}` }), 'adv'));
  await expectStatus('preparer cannot approve own advance (SoD)', () => api('POST', `/finance/client-advances/${adv.id}/approve`, fm1), 403);
  must(await api('POST', `/finance/client-advances/${adv.id}/approve`, fm2), 'approve');
  await expectStatus('preparer cannot record the advance as received (SoD)', () => api('POST', `/finance/client-advances/${adv.id}/received`, fm1, { receipt_reference: `RCP-${TAG}` }), 403);
  await expectStatus('receipt needs a reference', () => api('POST', `/finance/client-advances/${adv.id}/received`, fm2, {}), 400);
  await run('advance recorded as received with its receipt reference', async () => must(await api('POST', `/finance/client-advances/${adv.id}/received`, fm2, { receipt_reference: `RCP-${TAG}` }), 'received'));

  // --- IPCs.
  let n = 0;
  const ipc = (body) => api('POST', '/finance/ipcs', fm1, { project_id: project, contract_id: contract, ipc_no: `CI${++n}-${TAG}`, period_from: today, period_to: today, ...body });
  const refused = async (name, body, pattern) => { const r = await ipc(body); check(name, r.status === 422 && pattern.test(r.body?.error ?? ''), `HTTP ${r.status} ${r.body?.error ?? ''}`); };
  await refused('recovery different from the recorded rate refused (15,000 vs 20% of 100,000)', { gross_work_done_this_period: 100000, cumulative_gross_work_done: 100000, less_retention: 5000, less_advance_recovery: 15000 }, /recovery due 20000/);
  await refused('retention above the contract 5% refused', { gross_work_done_this_period: 100000, cumulative_gross_work_done: 100000, less_retention: 6000, less_advance_recovery: 20000 }, /Retention 6000/);
  await refused('less previous certified with nothing certified yet refused', { gross_work_done_this_period: 100000, cumulative_gross_work_done: 100000, less_retention: 5000, less_advance_recovery: 20000, less_previous_certified: 1 }, /exceeds the net certified/);
  const i1 = await run('IPC 1 created: retention 5,000, recovery 20,000 at the recorded rate (net 75,000)', async () => must(await ipc({ gross_work_done_this_period: 100000, cumulative_gross_work_done: 100000, less_retention: 5000, less_advance_recovery: 20000 }), 'ipc1'));
  check('IPC 1 net is 75,000', Number(i1.net_amount_due) === 75000, i1.net_amount_due);
  must(await approve(pm, must(await api('POST', `/finance/ipcs/${i1.id}/submit-to-client`, fm1), 'submit').approval.id), 'pm approve');
  await run('client certification recorded for IPC 1', async () => must(await api('POST', `/finance/ipcs/${i1.id}/client-approve`, fm2), 'client approve'));

  await refused('less previous above the 75,000 certified refused', { gross_work_done_this_period: 150000, cumulative_gross_work_done: 250000, less_retention: 7500, less_advance_recovery: 30000, less_previous_certified: 80000 }, /exceeds the net certified/);
  await refused('recovery above the outstanding 30,000 refused', { gross_work_done_this_period: 200000, cumulative_gross_work_done: 300000, less_advance_recovery: 40000 }, /exceeds the outstanding|recovery due 30000/);
  // Race: two drafts each recovering the last 30,000; both pass at creation (drafts), only one may leave draft.
  const a = must(await ipc({ gross_work_done_this_period: 150000, cumulative_gross_work_done: 250000, less_retention: 7500, less_advance_recovery: 30000 }), 'ipc a');
  const b = must(await ipc({ gross_work_done_this_period: 150000, cumulative_gross_work_done: 250000, less_retention: 7500, less_advance_recovery: 30000 }), 'ipc b');
  const sa = must(await api('POST', `/finance/ipcs/${a.id}/submit-to-client`, fm1), 'submit a').approval, sb = must(await api('POST', `/finance/ipcs/${b.id}/submit-to-client`, fm1), 'submit b').approval;
  const race = await Promise.all([approve(pm, sa.id), approve(pm, sb.id)]);
  const st = must(await api('GET', '/finance/ipcs', admin), 'ipcs').filter(x => [a.id, b.id].includes(x.id)).map(x => x.status).sort();
  check('concurrent submissions cannot both recover the last 30,000 (one leaves draft, one refused)', st.join(',') === 'draft,submitted_to_client' && race.map(r => r.status).sort().join(',') === '200,422', `${st.join(',')} | ${race.map(r => `${r.status} ${r.body?.error ?? ''}`).join(' | ')}`);

  const pos = must(await api('GET', `/finance/contracts/${contract}/advance-position`, fm1), 'position');
  check('position: 50,000 received, 50,000 recovered, 0 outstanding, 75,000 certified', Number(pos.advances_received) === 50000 && Number(pos.advance_recovered) === 50000 && Number(pos.advance_outstanding) === 0 && Number(pos.net_certified) === 75000, JSON.stringify(pos));

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: a received advance is immutable', `update client_advances set amount = 1 where id = ${adv.id}`);
    probe('DB: a received advance cannot be deleted', `delete from client_advances where id = ${adv.id}`);
    probe('DB: over-recovery refused even when written directly', `insert into ipcs(org_id, project_id, contract_id, ipc_no, period_from, period_to, gross_work_done_this_period, cumulative_gross_work_done, less_advance_recovery, prepared_by) select org_id, project_id, contract_id, 'CIX-${TAG}', current_date, current_date, 100000, 400000, 1, prepared_by from ipcs where id = ${i1.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  check('tenant B sees no tenant A client advances', must(await api('GET', `/finance/client-advances?contract_id=${contract}`, tb), 'b list').length === 0);
  await expectStatus('tenant B cannot approve a tenant A advance', () => api('POST', `/finance/client-advances/${adv.id}/approve`, tb), 404);
  await expectStatus('tenant B cannot read a tenant A advance position', () => api('GET', `/finance/contracts/${contract}/advance-position`, tb), 404);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_client_ipc_deductions');
