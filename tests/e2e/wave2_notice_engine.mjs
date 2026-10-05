// Wave 2 / NDC-001: Contract Data Pack obligation rules + notice / time-bar engine (GC-15 step 2, GC-16 step 1).
// Clause numbers and periods below are TEST FIXTURES entered "from a contract"; the product never defaults them.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (offset, base = new Date()) => { const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate())); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `NE ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const T = {
    cm: await mkUser('necm', await mkRole('NE Contracts Mgr', [['contracts', 'view'], ['contracts', 'create'], ['contracts', 'approve']])),
    legal: await mkUser('nelegal', await mkRole('NE Legal', [['contracts', 'view'], ['contracts', 'approve']])),
    site: await mkUser('nesite', await mkRole('NE Site', [['contracts', 'view'], ['contracts', 'create']])),
    view: await mkUser('neview', await mkRole('NE Viewer', [['contracts', 'view']]))
  };
  const client = must(await api('POST', '/clients', admin, { client_name: `NE Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `NE-${TAG}`, project_name: `NE ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const contract = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_form: 'fidic_red', contract_value: 1000000, currency_id: 1 }), 'contract').id;

  const ruleBase = { responsible_party: 'contractor', trigger_description: 'Contractor considers itself entitled to additional time or payment (fixture)', addressee: 'The Engineer (fixture)', is_condition_precedent: true };
  await expectStatus('rule without source reference refused', () => api('POST', `/contract-admin/contracts/${contract}/rules`, T.cm, { ...ruleBase, clause_ref: '20.1', obligation_type: 'notice_of_claim', period_value: 28, period_unit: 'calendar_days' }), 400);
  await expectStatus('viewer cannot create rules', () => api('POST', `/contract-admin/contracts/${contract}/rules`, T.view, { ...ruleBase, clause_ref: '20.1', obligation_type: 'notice_of_claim', period_value: 28, period_unit: 'calendar_days', source_reference: 'x ref' }), 403);
  const rDays = await run('author enters 28-day notice-of-claim rule from contract (fixture)', async () => must(await api('POST', `/contract-admin/contracts/${contract}/rules`, T.cm, { ...ruleBase, clause_ref: '20.1', obligation_type: 'notice_of_claim', period_value: 28, period_unit: 'calendar_days', source_reference: 'Conditions of Contract cl. 20.1 (fixture page 1)' }), 'r1'));
  const rWeeks = must(await api('POST', `/contract-admin/contracts/${contract}/rules`, T.cm, { ...ruleBase, clause_ref: 'PC-8.3', obligation_type: 'notice_of_delay', period_value: 2, period_unit: 'weeks', is_condition_precedent: false, source_reference: 'Particular Conditions 8.3 (fixture)' }), 'r2');
  const rMonths = must(await api('POST', `/contract-admin/contracts/${contract}/rules`, T.cm, { ...ruleBase, clause_ref: 'PC-20.2', obligation_type: 'particulars_due', period_value: 1, period_unit: 'months', source_reference: 'Particular Conditions 20.2 (fixture)' }), 'r3');
  const rDraft = must(await api('POST', `/contract-admin/contracts/${contract}/rules`, T.cm, { ...ruleBase, clause_ref: 'X-1', obligation_type: 'other', period_value: 5, period_unit: 'calendar_days', source_reference: 'unconfirmed fixture' }), 'r4');
  await expectStatus('author cannot confirm own rule (SoD)', () => api('POST', `/contract-admin/rules/${rDays.id}/confirm`, T.cm), 403);
  for (const r of [rDays, rWeeks, rMonths]) must(await api('POST', `/contract-admin/rules/${r.id}/confirm`, T.legal), 'confirm');
  await expectStatus('confirmed rule period cannot be edited', () => api('PATCH', `/contract-admin/rules/${rDays.id}`, T.cm, { period_value: 56 }), 422);
  await run('draft rule can still be edited', async () => must(await api('PATCH', `/contract-admin/rules/${rDraft.id}`, T.cm, { period_value: 7 }), 'edit draft'));

  // Event aware 30 days ago -> 28-day notice deadline 2 days ago (overdue); weeks rule -> 16 days ago.
  const ev = await run('site records event aware 30 days ago with two applicable rules', async () => must(await api('POST', `/contract-admin/contracts/${contract}/events`, T.site, {
    title: 'Late access to work area (fixture)', description: 'Employer did not give access to zone B (fixture)', occurred_on: day(-35), became_aware_on: day(-30), source_type: 'site_diary', source_reference: 'Diary entry (fixture)', rule_ids: [rDays.id, rWeeks.id] }), 'ev'));
  const nDays = ev.notices.find(n => n.rule_id === rDays.id), nWeeks = ev.notices.find(n => n.rule_id === rWeeks.id);
  check('28-day deadline computed by DB = aware + 28', nDays.deadline === day(-2), `${nDays.deadline} vs ${day(-2)}`);
  check('2-week deadline = aware + 14', nWeeks.deadline === day(-16), `${nWeeks.deadline} vs ${day(-16)}`);
  const evM = must(await api('POST', `/contract-admin/contracts/${contract}/events`, T.site, { title: 'Month-end event (fixture)', description: 'month arithmetic check', occurred_on: '2026-01-30', became_aware_on: '2026-01-31', rule_ids: [rMonths.id] }), 'evM');
  check('1-month deadline from 31 Jan = 28 Feb (calendar month arithmetic)', evM.notices[0].deadline === '2026-02-28', evM.notices[0].deadline);
  await expectStatus('unconfirmed rule cannot generate a notice', () => api('POST', `/contract-admin/events/${ev.event.id}/notices`, T.site, { rule_id: rDraft.id }), 422);
  await expectStatus('same rule twice for one event refused', () => api('POST', `/contract-admin/events/${ev.event.id}/notices`, T.site, { rule_id: rDays.id }), 409);
  await expectStatus('awareness date in the future refused', () => api('POST', `/contract-admin/contracts/${contract}/events`, T.site, { title: 'future', description: 'future event', occurred_on: day(0), became_aware_on: day(3) }), 422);
  await expectStatus('awareness before occurrence refused', () => api('POST', `/contract-admin/contracts/${contract}/events`, T.site, { title: 'bad dates', description: 'aware before occurred', occurred_on: day(-1), became_aware_on: day(-5) }), 422);

  // Register: open first, most urgent first; overdue flagged; window filter.
  const reg = must(await api('GET', '/contract-admin/notices?status=open', T.view), 'register').filter(n => n.contract_id === contract);
  check('register ordered by deadline with overdue flags', reg[0].id === evM.notices[0].id && reg.every(n => /^\d{4}-\d{2}-\d{2}$/.test(n.deadline) && n.overdue === (n.deadline < day(0))), reg.map(n => `${n.id}:${n.deadline.slice(0, 10)}:${n.overdue}:${n.days_remaining}`).join(' '));
  const soon = must(await api('GET', '/contract-admin/notices?status=open&due_within_days=0', T.view), 'soon').filter(n => n.contract_id === contract);
  check('due_within_days=0 returns all deadlines up to today', soon.length === 3);

  // Issue: proof required; lateness recorded truthfully; no internal approval step.
  await expectStatus('issue without delivery proof refused', () => api('POST', `/contract-admin/notices/${nWeeks.id}/issue`, T.site, { delivery_method: 'email' }), 400);
  await expectStatus('issue time in the future refused', () => api('POST', `/contract-admin/notices/${nWeeks.id}/issue`, T.site, { delivery_method: 'email', delivery_reference: 'msg-id fixture', issued_at: new Date(Date.now() + 86400000).toISOString() }), 422);
  const onTime = await run('notice issued with proof dated 20 days ago (deadline 16 days ago)', async () => must(await api('POST', `/contract-admin/notices/${nWeeks.id}/issue`, T.site, { delivery_method: 'registered_mail', delivery_reference: 'RM-123 (fixture)', issued_at: new Date(Date.now() - 20 * 86400000).toISOString() }), 'issue'));
  check('notice issued before its deadline is not late', onTime.issued_late === false, `issued_at=${onTime.issued_at} deadline=${onTime.deadline}`);
  const late = await run('overdue notice issued today', async () => must(await api('POST', `/contract-admin/notices/${nDays.id}/issue`, T.site, { delivery_method: 'contract_portal', delivery_reference: 'portal ref (fixture)' }), 'issue2'));
  check('overdue notice recorded as issued_late=true (consequence is a human legal judgement)', late.issued_late === true);
  await expectStatus('issued notice cannot be issued again', () => api('POST', `/contract-admin/notices/${nDays.id}/issue`, T.site, { delivery_method: 'email', delivery_reference: 'again again' }), 409);
  await run('acknowledgement recorded', async () => must(await api('POST', `/contract-admin/notices/${nDays.id}/acknowledge`, T.site, { acknowledgement_reference: 'Engineer letter (fixture)' }), 'ack'));
  await expectStatus('marking not-required needs contracts.approve', () => api('POST', `/contract-admin/notices/${evM.notices[0].id}/not-required`, T.site, { reason: 'particulars included in original notice (fixture)' }), 403);
  await run('approver marks month-end notice not required with reason', async () => must(await api('POST', `/contract-admin/notices/${evM.notices[0].id}/not-required`, T.legal, { reason: 'particulars included in original notice (fixture)' }), 'nr'));
  await run('confirmed rule can be retired', async () => must(await api('POST', `/contract-admin/rules/${rMonths.id}/retire`, T.legal), 'retire'));

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: notice deadline immutable (owner role)', `update contract_notices set deadline=deadline+30 where id=${nWeeks.id}`);
    probe('DB: issued notice details immutable', `update contract_notices set delivery_reference='changed' where id=${nDays.id}`);
    probe('DB: notices cannot be deleted', `delete from contract_notices where id=${nWeeks.id}`);
    probe('DB: contract events are append-only', `update contract_events set became_aware_on=current_date where id=${ev.event.id}`);
    probe('DB: confirmed rule cannot be deleted', `delete from contract_obligation_rules where id=${rDays.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  check('tenant B sees no tenant A notices', must(await api('GET', '/contract-admin/notices', tb), 'b').every(n => n.contract_id !== contract));
  await expectStatus('tenant B cannot issue tenant A notice', () => api('POST', `/contract-admin/notices/${nWeeks.id}/issue`, tb, { delivery_method: 'email', delivery_reference: 'cross tenant' }), 404);
  await expectStatus('tenant B cannot add rules to tenant A contract', () => api('POST', `/contract-admin/contracts/${contract}/rules`, tb, { ...ruleBase, clause_ref: 'B', obligation_type: 'other', period_value: 1, period_unit: 'calendar_days', source_reference: 'cross tenant' }), 422);
  await expectStatus('tenant B cannot record events on tenant A contract', () => api('POST', `/contract-admin/contracts/${contract}/events`, tb, { title: 'cross', description: 'cross tenant', occurred_on: day(-1), became_aware_on: day(-1) }), 422);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('wave2_notice_engine');
