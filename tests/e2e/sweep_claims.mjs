// RK-003 sweep / GC-16 Claim / EOT case: first runtime execution. STEP09: event != notice != claim != determination;
// a determination never rewrites the claimed (original) entitlement. Users hold all contract permissions so that only
// integrity and segregation-of-duties rules can stop them. Reuses contract-signing DOA fixtures (wave1). TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const s1 = await login({ email: `w1s1.${TAG}@test.local`, password: 'Passw0rd!w1s1', org_id: 1 });
  const s2 = await login({ email: `w1s2.${TAG}@test.local`, password: 'Passw0rd!w1s2', org_id: 1 });
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `CL ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const all = await mkRole('Claims All', [['contracts', 'view'], ['contracts', 'create'], ['contracts', 'edit'], ['contracts', 'approve']]);
  const C = { a: await mkUser('cla', all), b: await mkUser('clb', all), c: await mkUser('clc', all) };
  const client = must(await api('POST', '/clients', admin, { client_name: `CL Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `CL-${TAG}`, project_name: `CL ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const mkContract = async () => must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 1000000, currency_id: 1, completion_period_days: 365 }), 'contract').id;
  const contract = await mkContract();
  const unsigned = await mkContract();
  const ca = must(await api('POST', `/contracts/${contract}/submit-approval`, admin), 'csub').approval;
  must(await api('POST', `/approvals/${ca.id}/actions`, s1, { action: 'approved', comment: 'ok' }), 's1');
  must(await api('POST', `/approvals/${ca.id}/actions`, s2, { action: 'approved', comment: 'ok' }), 's2');

  // Event and time-barred notice (condition precedent, 28 days, became aware 40 days ago -> issued late).
  const rule = must(await api('POST', `/contract-admin/contracts/${contract}/rules`, admin, { clause_ref: 'PC-20.1', obligation_type: 'notice_of_claim', responsible_party: 'contractor', trigger_description: 'Contractor claim (fixture)', period_value: 28, period_unit: 'calendar_days', addressee: 'Engineer (fixture)', is_condition_precedent: true, source_reference: 'fixture conditions' }), 'rule');
  must(await api('POST', `/contract-admin/rules/${rule.id}/confirm`, C.b), 'rule confirm');
  const ev = must(await api('POST', `/contract-admin/contracts/${contract}/events`, C.a, { title: 'Late access to Zone C (fixture)', description: 'Employer gave access 30 days late (fixture)', occurred_on: day(-45), became_aware_on: day(-40), rule_ids: [rule.id] }), 'event');
  const notice = ev.notices[0];
  must(await api('POST', `/contract-admin/notices/${notice.id}/issue`, C.a, { delivery_method: 'courier', delivery_reference: 'AWB 778 (fixture)' }), 'issue late');
  const ev2 = must(await api('POST', `/contract-admin/contracts/${contract}/events`, C.a, { title: 'Other event (fixture)', description: 'Unrelated event (fixture)', occurred_on: day(-5), became_aware_on: day(-5) }), 'event2').event;

  const claim = (tok, body) => api('POST', '/claims', tok, { project_id: project, contract_id: contract, claim_type: 'combined', title: 'Zone C access delay', ...body });
  // --- Registration.
  await expectStatus('claim without a contract refused', () => api('POST', '/claims', C.a, { project_id: project, claim_no: `CLX-${TAG}`, claim_type: 'eot', title: 'no contract' }), 400);
  await expectStatus('claim on an unsigned contract refused', () => claim(C.a, { contract_id: unsigned, claim_no: `CLU-${TAG}` }), 422);
  await expectStatus('notice dated before the event refused', () => claim(C.a, { claim_no: `CLD-${TAG}`, event_date: day(-45), notice_date: day(-50) }), 422);
  await expectStatus('notice of another event refused', () => claim(C.a, { claim_no: `CLN-${TAG}`, event_id: ev2.id, notice_id: notice.id }), 422);
  const k = await run('claims manager registers claim from the event and its notice', async () => must(await claim(C.a, { claim_no: `CL1-${TAG}`, event_id: ev.event.id, notice_id: notice.id, event_date: day(-45), claimed_days: 30, claimed_amount: 250000, basis: 'Late access to Zone C under PC-2.1 (fixture)' }), 'claim'));
  const detail = must(await api('GET', `/claims/${k.id}`, C.b), 'detail');
  check('claim view exposes the time-bar risk of its late condition-precedent notice', detail.time_bar?.notice_issued_late === true && detail.time_bar?.condition_precedent === true, JSON.stringify(detail.time_bar ?? null));
  await expectStatus('duplicate claim number in the project refused', () => claim(C.a, { claim_no: `CL1-${TAG}` }), 409);

  // --- Lifecycle with content and segregation rules.
  must(await api('POST', `/claims/${k.id}/status`, C.a, { status: 'notified' }), 'notified');
  const thin = must(await claim(C.a, { claim_no: `CL2-${TAG}`, claim_type: 'eot', notice_date: day(-1) }), 'thin');
  must(await api('POST', `/claims/${thin.id}/status`, C.a, { status: 'notified' }), 'thin notified');
  await expectStatus('submission without claimed days and basis refused', () => api('POST', `/claims/${thin.id}/status`, C.a, { status: 'submitted' }), 422);
  await expectStatus('submission refused without a time-bar position on a late condition-precedent notice (CC-034)', () => api('POST', `/claims/${k.id}/status`, C.a, { status: 'submitted' }), 422);
  must(await api('POST', `/claims/${k.id}/status`, C.a, { status: 'submitted', time_bar_position: 'Late notice; relying on PC-20.1 waiver correspondence ref L-77 (fixture)' }), 'submitted');
  await expectStatus('claimed entitlement frozen after submission', () => api('PATCH', `/claims/${k.id}`, C.a, { claimed_amount: 999999 }), 409);
  must(await api('POST', `/claims/${k.id}/status`, C.b, { status: 'under_review' }), 'review');
  await expectStatus('claim creator cannot determine own claim (SoD)', () => api('PATCH', `/claims/${k.id}`, C.a, { approved_days: 20, approved_amount: 100000 }), 403);
  await expectStatus('determination above the claimed amount refused', () => api('PATCH', `/claims/${k.id}`, C.b, { approved_days: 20, approved_amount: 300000 }), 422);
  await run('independent determination: 20 days / 150,000', async () => must(await api('PATCH', `/claims/${k.id}`, C.b, { approved_days: 20, approved_amount: 150000, determination_reason: 'Concurrent delay in Zone B (fixture)' }), 'determine'));
  await expectStatus('full approval refused when determination is below the claim', () => api('POST', `/claims/${k.id}/status`, C.c, { status: 'approved', reason: 'all good' }), 422);
  await expectStatus('final decision without a reason refused', () => api('POST', `/claims/${k.id}/status`, C.c, { status: 'partially_approved' }), 400);
  const fin = await run('third person decides: partially approved', async () => must(await api('POST', `/claims/${k.id}/status`, C.c, { status: 'partially_approved', reason: 'Accepted per determination (fixture)' }), 'final'));
  check('original claimed entitlement preserved beside the determination', Number(fin.claimed_amount) === 250000 && Number(fin.approved_amount) === 150000 && fin.claimed_days === 30 && fin.approved_days === 20);
  const after = must(await api('GET', `/claims/${k.id}`, C.a), 'after');
  check('contract shows approved EOT total (20 days)', Number(after.contract_approved_eot_days) === 20, String(after.contract_approved_eot_days));
  await expectStatus('decided claim cannot be re-determined', () => api('PATCH', `/claims/${k.id}`, C.b, { approved_days: 25 }), 409);
  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: decided claim immutable', `update contract_claims set approved_amount=250000 where id=${k.id}`);
    probe('DB: claims cannot be deleted', `delete from contract_claims where id=${k.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);
  await expectStatus('withdrawal needs a reason', () => api('POST', `/claims/${thin.id}/status`, C.a, { status: 'withdrawn' }), 400);
  await run('withdrawal with reason', async () => must(await api('POST', `/claims/${thin.id}/status`, C.a, { status: 'withdrawn', reason: 'Superseded by CL1 (fixture)' }), 'withdraw'));

  const tb = await login(ADMIN_B);
  const listB = must(await api('GET', '/claims', tb), 'claims B');
  check('tenant B does not see tenant A claims', !listB.some(x => Number(x.id) === Number(k.id)));
  await expectStatus('tenant B cannot read tenant A claim', () => api('GET', `/claims/${k.id}`, tb), 404);
  await expectStatus('tenant B cannot move tenant A claim', () => api('POST', `/claims/${thin.id}/status`, tb, { status: 'withdrawn', reason: 'cross tenant' }), 404);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_claims');
