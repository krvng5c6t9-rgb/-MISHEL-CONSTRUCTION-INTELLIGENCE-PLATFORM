// NDC-002 remainder (CC-034): compensation-event register, determination / dispute ladder on claims, claim gating.
// Periods come only from confirmed contract rules (TEST FIXTURE values). Reuses contract-signing DOA fixtures (wave1).
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
    must(await api('POST', '/users', admin, { role_id, full_name: `N2 ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const all = await mkRole('N2 All', [['contracts', 'view'], ['contracts', 'create'], ['contracts', 'edit'], ['contracts', 'approve']]);
  const A = await mkUser('n2a', all), B = await mkUser('n2b', all), Cq = await mkUser('n2c', all);
  const client = must(await api('POST', '/clients', admin, { client_name: `N2 Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `N2-${TAG}`, project_name: `N2 ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const contract = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'unit_price', contract_value: 800000, currency_id: 1 }), 'contract').id;
  const ca = must(await api('POST', `/contracts/${contract}/submit-approval`, admin), 'csub').approval;
  must(await api('POST', `/approvals/${ca.id}/actions`, s1, { action: 'approved', comment: 'ok' }), 's1');
  must(await api('POST', `/approvals/${ca.id}/actions`, s2, { action: 'approved', comment: 'ok' }), 's2');
  const rule = async (type, days, cp = false) => { const r = must(await api('POST', `/contract-admin/contracts/${contract}/rules`, A, { clause_ref: `PC-${type}`, obligation_type: type, responsible_party: type === 'response_due' ? 'project_manager' : 'contractor', trigger_description: `${type} (fixture)`, period_value: days, period_unit: 'calendar_days', addressee: 'PM (fixture)', is_condition_precedent: cp, source_reference: 'fixture contract data' }), `rule ${type}`); must(await api('POST', `/contract-admin/rules/${r.id}/confirm`, B), 'confirm'); return r.id; };
  const qRule = await rule('quotation_due', 21), rRule = await rule('response_due', 14), nodRule = await rule('notice_of_dispute', 28), claimRule = await rule('notice_of_claim', 28, true);
  const draftRule = must(await api('POST', `/contract-admin/contracts/${contract}/rules`, A, { clause_ref: 'PC-X', obligation_type: 'quotation_due', responsible_party: 'contractor', trigger_description: 'unconfirmed (fixture)', period_value: 5, period_unit: 'calendar_days', addressee: 'PM', is_condition_precedent: false, source_reference: 'fixture' }), 'draft rule').id;
  const ev = must(await api('POST', `/contract-admin/contracts/${contract}/events`, A, { title: 'Late design info (fixture)', description: 'Employer design info late for Zone D (fixture)', occurred_on: day(-40), became_aware_on: day(-35), rule_ids: [claimRule] }), 'event');

  // --- Compensation events.
  await expectStatus('CE with an unconfirmed period rule refused', () => api('POST', `/contract-admin/contracts/${contract}/compensation-events`, A, { event_id: ev.event.id, ce_no: `CEX-${TAG}`, description: 'unconfirmed rule', notified_on: day(-30), quotation_rule_id: draftRule }), 422);
  await expectStatus('CE notified before awareness of the event refused', () => api('POST', `/contract-admin/contracts/${contract}/compensation-events`, A, { event_id: ev.event.id, ce_no: `CEY-${TAG}`, description: 'too early', notified_on: day(-38) }), 422);
  const ce = await run('CE notified with quotation and reply rules', async () => must(await api('POST', `/contract-admin/contracts/${contract}/compensation-events`, A, { event_id: ev.event.id, ce_no: `CE-1-${TAG}`, description: 'Late design information Zone D (fixture)', notified_on: day(-30), quotation_rule_id: qRule, reply_rule_id: rRule }), 'ce'));
  check('quotation due = notified + 21 days (from confirmed rule)', ce.quotation_due === day(-9), ce.quotation_due);
  const list0 = must(await api('GET', `/contract-admin/contracts/${contract}/compensation-events`, B), 'ce list');
  check('missing quotation past its due date flagged overdue', list0.find(x => x.id === ce.id)?.quotation_overdue === true);
  await expectStatus('acceptance before any quotation refused', () => api('POST', `/contract-admin/compensation-events/${ce.id}/decision`, Cq, { decision: 'accepted', decision_on: day(0), reference: 'PM letter 3 (fixture)' }), 422);
  const q = await run('quotation submitted (45,000 / 12 days)', async () => must(await api('POST', `/contract-admin/compensation-events/${ce.id}/quotation`, B, { amount: 45000, time_days: 12, submitted_on: day(-5) }), 'q'));
  check('PM reply due = quotation + 14 days', q.reply_due === day(9), q.reply_due);
  await expectStatus('quotation preparer cannot record the PM decision (SoD)', () => api('POST', `/contract-admin/compensation-events/${ce.id}/decision`, B, { decision: 'accepted', decision_on: day(0), reference: 'PM letter 3 (fixture)' }), 422);
  await expectStatus('PM assessment without reasons refused', () => api('POST', `/contract-admin/compensation-events/${ce.id}/decision`, Cq, { decision: 'pm_assessed', decision_on: day(0), reference: 'PM letter 3 (fixture)', amount: 30000, time_days: 8 }), 422);
  const dec = await run('PM assessment recorded (30,000 / 8 days) with reasons', async () => must(await api('POST', `/contract-admin/compensation-events/${ce.id}/decision`, Cq, { decision: 'pm_assessed', decision_on: day(0), reference: 'PM letter 3 (fixture)', amount: 30000, time_days: 8, reason: 'Resources overstated in quotation (fixture)' }), 'dec'));
  check('quotation preserved beside the assessment', Number(dec.quotation_amount) === 45000 && Number(dec.decided_amount) === 30000);
  await expectStatus('decided CE cannot be decided again', () => api('POST', `/contract-admin/compensation-events/${ce.id}/decision`, Cq, { decision: 'withdrawn', reason: 'second thoughts' }), 409);

  // --- Claim gating and dispute ladder.
  const notice = ev.notices[0];
  const k = must(await api('POST', '/claims', A, { project_id: project, contract_id: contract, claim_no: `N2-CL-${TAG}`, claim_type: 'combined', title: 'Zone D delay', event_id: ev.event.id, notice_id: notice.id, event_date: day(-40), notice_date: day(-5), claimed_days: 40, claimed_amount: 200000, basis: 'Late employer design information (fixture)' }), 'claim');
  must(await api('POST', `/claims/${k.id}/status`, A, { status: 'notified' }), 'notified');
  await expectStatus('claim cannot be submitted before its notice is issued', () => api('POST', `/claims/${k.id}/status`, A, { status: 'submitted' }), 422);
  must(await api('POST', `/contract-admin/notices/${notice.id}/issue`, A, { delivery_method: 'contract_portal', delivery_reference: 'Portal ref 991 (fixture)' }), 'issue notice');
  await expectStatus('late condition-precedent notice: submission needs a recorded time-bar position', () => api('POST', `/claims/${k.id}/status`, A, { status: 'submitted' }), 422);
  await run('claim submitted with time-bar position recorded', async () => must(await api('POST', `/claims/${k.id}/status`, A, { status: 'submitted', time_bar_position: 'Notice late by 7 days; contractor relies on employer prior knowledge (fixture)' }), 'submit'));
  await expectStatus('NOD before any determination refused', () => api('POST', `/claims/${k.id}/dispute-steps`, B, { step: 'notice_of_dissatisfaction', occurred_on: day(-1), reference: 'NOD 1 (fixture)' }), 422);
  await expectStatus('determination above the claim refused', () => api('POST', `/claims/${k.id}/dispute-steps`, B, { step: 'engineer_determination', occurred_on: day(-40 + 10), reference: 'Det 1', determined_days: 50 }), 422);
  await run('Engineer determination recorded (20 days / 80,000)', async () => must(await api('POST', `/claims/${k.id}/dispute-steps`, B, { step: 'engineer_determination', occurred_on: day(-35), reference: 'Engineer determination D-4 (fixture)', determined_days: 20, determined_amount: 80000 }), 'det'));
  const nod = await run('NOD recorded against the determination', async () => must(await api('POST', `/claims/${k.id}/dispute-steps`, B, { step: 'notice_of_dissatisfaction', occurred_on: day(-2), reference: 'NOD letter 12 (fixture)', rule_id: nodRule }), 'nod'));
  check('NOD deadline from the confirmed rule and lateness flagged (not decided)', nod.deadline === day(-7) && nod.late === true, `${nod.deadline} late=${nod.late}`);
  await expectStatus('arbitration before a DAAB decision refused', () => api('POST', `/claims/${k.id}/dispute-steps`, B, { step: 'arbitration_referral', occurred_on: day(0), reference: 'Arb 1 (fixture)' }), 422);
  must(await api('POST', `/claims/${k.id}/dispute-steps`, B, { step: 'daab_referral', occurred_on: day(0), reference: 'DAAB referral 1 (fixture)' }), 'daab');
  await expectStatus('the same step cannot be recorded twice', () => api('POST', `/claims/${k.id}/dispute-steps`, B, { step: 'daab_referral', occurred_on: day(0), reference: 'dup referral' }), 422);
  const view = must(await api('GET', `/claims/${k.id}`, A), 'view');
  check('claim view shows the dispute ladder in order', view.dispute_steps?.map(x => x.step).join(',') === 'engineer_determination,notice_of_dissatisfaction,daab_referral');

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: dispute steps append-only', `update claim_dispute_steps set determined_amount=1 where claim_id=${k.id}`);
    probe('DB: decided CE immutable', `update compensation_events set decided_amount=45000 where id=${ce.id}`);
    probe('DB: CEs cannot be deleted', `delete from compensation_events where id=${ce.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);
  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot quote on tenant A CE', () => api('POST', `/contract-admin/compensation-events/${ce.id}/quotation`, tb, { amount: 1, time_days: 1, submitted_on: day(0) }), 404);
  await expectStatus('tenant B cannot add dispute steps to tenant A claim', () => api('POST', `/claims/${k.id}/dispute-steps`, tb, { step: 'daab_decision', occurred_on: day(0), reference: 'cross tenant' }), 404);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_ndc002');
