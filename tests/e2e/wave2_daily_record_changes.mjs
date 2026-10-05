// Wave 2 / NDC-014 structured daily record + NDC-002 change paths (GC-07, GC-15 step 1, GC-16 step 2).
// Reuses contract-signing DOA fixtures from wave1_boq_handover (same RUN tag). All data are TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const s1 = await login({ email: `w1s1.${TAG}@test.local`, password: 'Passw0rd!w1s1', org_id: 1 });
  const s2 = await login({ email: `w1s2.${TAG}@test.local`, password: 'Passw0rd!w1s2', org_id: 1 });
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `DR ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  // The engineer also holds site.approve so that only segregation of duties can stop self-signing.
  const eng = await mkUser('dreng', await mkRole('DR Engineer', [['site', 'view'], ['site', 'manage'], ['site', 'approve']]));
  const mgr = await mkUser('drmgr', await mkRole('DR Site Manager', [['site', 'view'], ['site', 'approve']]));
  const cm = await mkUser('drcm', await mkRole('DR Contracts', [['contracts', 'view'], ['contracts', 'create'], ['contracts', 'approve']]));

  const client = must(await api('POST', '/clients', admin, { client_name: `DR Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `DR-${TAG}`, project_name: `DR ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const contract = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 500000, currency_id: 1 }), 'contract').id;
  const ca = must(await api('POST', `/contracts/${contract}/submit-approval`, admin), 'contract submit').approval;
  must(await api('POST', `/approvals/${ca.id}/actions`, s1, { action: 'approved' }), 'sign1');
  must(await api('POST', `/approvals/${ca.id}/actions`, s2, { action: 'approved' }), 'sign2');

  // --- NDC-014 daily record
  await expectStatus('impact flag without description refused', () => api('POST', '/site/diaries', eng, { project_id: project, diary_date: yesterday, weather: 'clear', work_performed: 'x', impact_flag: true }), 422);
  const d = await run('engineer records structured diary with impact flag', async () => must(await api('POST', '/site/diaries', eng, {
    project_id: project, diary_date: today, weather: 'Clear, 31C (fixture)', work_performed: 'Blockwork level 2 (fixture)', work_fronts: 'Zone A, Zone B',
    constraints_noted: 'Zone B access blocked by employer contractor (fixture)', instructions_received: 'None', parties_present: 'Engineer rep (fixture)',
    impact_flag: true, impact_description: 'Zone B access blocked; crew idle 4h (fixture)' }), 'diary'));
  check('diary starts as draft', d.status === 'draft');
  await expectStatus('signing without manpower refused', () => api('POST', `/site/diaries/${d.id}/sign`, mgr), 422);
  must(await api('POST', '/site/diary-manpower', eng, { diary_id: d.id, trade: 'Masons', headcount: 12, hours: 8 }), 'manpower');
  await expectStatus('preparer holding site.approve cannot sign own diary (SoD)', () => api('POST', `/site/diaries/${d.id}/sign`, eng), 403);
  const signed = await run('site manager signs', async () => must(await api('POST', `/site/diaries/${d.id}/sign`, mgr), 'sign'));
  check('impact flag created a contract event linked to the diary', signed.impact?.event?.id && signed.diary.impact_event_id === signed.impact.event.id && signed.impact.event.became_aware_on === today, JSON.stringify(signed.impact).slice(0, 160));
  await expectStatus('signed diary cannot be overwritten by re-posting the day', () => api('POST', '/site/diaries', eng, { project_id: project, diary_date: today, weather: 'changed', work_performed: 'changed' }), 422);
  await expectStatus('manpower cannot be added to a signed diary', () => api('POST', '/site/diary-manpower', eng, { diary_id: d.id, trade: 'Late', headcount: 99 }), 422);
  await expectStatus('signing twice refused', () => api('POST', `/site/diaries/${d.id}/sign`, mgr), 409);
  await run('correction recorded as amendment', async () => must(await api('POST', `/site/diaries/${d.id}/amendments`, eng, { note: 'Headcount for masons was 11, not 12 (fixture)' }), 'amend'));
  const full = must(await api('GET', `/site/diaries/${d.id}`, eng), 'diary full');
  check('diary view shows manpower and amendment, original unchanged', full.manpower.length === 1 && full.manpower[0].headcount === 12 && full.amendments.length === 1);

  // --- NDC-002: the event is the hub; commercial attaches notices and links records.
  const evId = signed.impact.event.id;
  const rule = must(await api('POST', `/contract-admin/contracts/${contract}/rules`, admin, { clause_ref: 'PC-1', obligation_type: 'notice_of_delay', responsible_party: 'contractor', trigger_description: 'delay event (fixture)', period_value: 14, period_unit: 'calendar_days', addressee: 'Engineer (fixture)', is_condition_precedent: false, source_reference: 'fixture conditions' }), 'rule');
  must(await api('POST', `/contract-admin/rules/${rule.id}/confirm`, cm), 'confirm rule');
  const n = await run('commercial attaches a notice obligation to the diary event', async () => must(await api('POST', `/contract-admin/events/${evId}/notices`, cm, { rule_id: rule.id }), 'notice'));
  check('notice deadline = diary date + 14', n.deadline === new Date(Date.parse(today) + 14 * 86400000).toISOString().slice(0, 10), n.deadline);
  const ew = await run('early warning raised', async () => must(await api('POST', `/contract-admin/contracts/${contract}/early-warnings`, cm, { ew_no: `EW-${TAG}`, raised_by_party: 'contractor', raised_on: today, matter: 'Zone B access risk (fixture)', may_increase_price: true, may_delay_completion: true, may_impair_performance: false }), 'ew'));
  await run('early warning linked to the event', async () => must(await api('POST', `/contract-admin/events/${evId}/links`, cm, { link_type: 'early_warning', linked_id: ew.id }), 'link'));
  const other = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 1000, currency_id: 1 }), 'contract2').id;
  const ew2 = must(await api('POST', `/contract-admin/contracts/${other}/early-warnings`, cm, { ew_no: `EW2-${TAG}`, raised_by_party: 'contractor', raised_on: today, matter: 'other contract (fixture)', may_increase_price: false, may_delay_completion: false, may_impair_performance: true }), 'ew2');
  await expectStatus('record from another contract cannot be linked', () => api('POST', `/contract-admin/events/${evId}/links`, cm, { link_type: 'early_warning', linked_id: ew2.id }), 422);
  await expectStatus('early warning dated in the future refused', () => api('POST', `/contract-admin/contracts/${contract}/early-warnings`, cm, { ew_no: `EWF-${TAG}`, raised_by_party: 'contractor', raised_on: '2999-01-01', matter: 'future (fixture)', may_increase_price: false, may_delay_completion: false, may_impair_performance: false }), 422);
  await run('risk reduction meeting recorded', async () => must(await api('PATCH', `/contract-admin/early-warnings/${ew.id}`, cm, { risk_reduction_meeting_on: today, actions_agreed: 'Employer to clear Zone B by Friday (fixture)' }), 'meet'));
  await run('early warning closed with note', async () => must(await api('POST', `/contract-admin/early-warnings/${ew.id}/close`, cm, { closure_note: 'Access restored (fixture)' }), 'close'));
  await expectStatus('closed early warning is immutable', () => api('PATCH', `/contract-admin/early-warnings/${ew.id}`, cm, { actions_agreed: 'rewrite history' }), 422);
  const view = must(await api('GET', `/contract-admin/events/${evId}`, cm), 'event');
  check('event view shows diary + early-warning links and the notice', view.links.length === 2 && view.notices.length === 1, `links=${view.links.map(l => l.link_type)} notices=${view.notices.length}`);

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: signed diary immutable even as owner', `update site_diary set weather='tampered' where id=${d.id}`);
    probe('DB: amendments append-only', `delete from site_diary_amendments where diary_id=${d.id}`);
    probe('DB: event links append-only', `delete from contract_event_links where event_id=${evId}`);
    probe('DB: early warnings cannot be deleted', `delete from early_warnings where id=${ew2.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot read tenant A diary', () => api('GET', `/site/diaries/${d.id}`, tb), 404);
  await expectStatus('tenant B cannot link to tenant A event', () => api('POST', `/contract-admin/events/${evId}/links`, tb, { link_type: 'early_warning', linked_id: ew.id }), 404);
  await expectStatus('tenant B cannot close tenant A early warning', () => api('POST', `/contract-admin/early-warnings/${ew2.id}/close`, tb, { closure_note: 'cross tenant' }), 404);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('wave2_daily_record_changes');
