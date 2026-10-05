// Wave 2 / NDC-010 accepted-programme governance + first runtime verification of the CPM engine (GC-11).
// Durations, revisions and periods are TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `PG ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const planner = await mkUser('pgplan', await mkRole('PG Planner', [['planning', 'view'], ['planning', 'manage'], ['contracts', 'view']]));
  const cm = await mkUser('pgcm', await mkRole('PG Contracts', [['contracts', 'view'], ['contracts', 'create'], ['contracts', 'approve']]));
  const client = must(await api('POST', '/clients', admin, { client_name: `PG Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `PG-${TAG}`, project_name: `PG ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const contract = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 100000, currency_id: 1 }), 'contract').id;

  // --- CPM verification on a hand-computed network.
  //  A(3) -FS-> B(2) -FS-> D(1);  A -FS-> C(4) -FS-> D;  C -SS+1-> E(2);  D -FF+0-> F(2)
  //  Expected: finish 8; ES/EF A0/3 B3/5 C3/7 D7/8 E4/6 F6/8; TF A0 B2 C0 D0 E2 F0; critical A,C,D,F.
  const act = async (name, dur) => must(await api('POST', '/planning/activities', planner, { project_id: project, activity_id_ext: name, activity_name: `Act ${name}`, planned_duration_days: dur }), `act ${name}`).id;
  const A = await act('A', 3), B = await act('B', 2), C = await act('C', 4), D = await act('D', 1), E = await act('E', 2), F = await act('F', 2);
  for (const [p, s, t, l] of [[A, B, 'FS', 0], [A, C, 'FS', 0], [B, D, 'FS', 0], [C, D, 'FS', 0], [C, E, 'SS', 1], [D, F, 'FF', 0]]) must(await api('POST', '/planning/relationships', planner, { project_id: project, predecessor_activity_id: p, successor_activity_id: s, relationship_type: t, lag_days: l }), 'rel');
  const cpm = must(await api('GET', `/planning/cpm?project_id=${project}`, planner), 'cpm');
  const by = Object.fromEntries(cpm.activities.map(a => [a.activity_id, a]));
  const exp = { A: [0, 3, 0], B: [3, 5, 2], C: [3, 7, 0], D: [7, 8, 0], E: [4, 6, 2], F: [6, 8, 0] };
  const bad = Object.entries(exp).filter(([k, [es, ef, tf]]) => by[k].early_start_day !== es || by[k].early_finish_day !== ef || by[k].total_float_days !== tf);
  check('CPM early dates and total float match hand calculation (FS/SS+lag/FF)', bad.length === 0 && cpm.project_duration_days === 8, bad.map(([k]) => `${k}:${JSON.stringify(by[k])}`).join(' ') || 'ok');
  check('CPM critical path = A,C,D,F', ['A', 'C', 'D', 'F'].every(k => by[k].is_critical) && !by.B.is_critical && !by.E.is_critical);
  await expectStatus('relationship closing a logic loop (D -> A) is refused', () => api('POST', '/planning/relationships', planner, { project_id: project, predecessor_activity_id: D, successor_activity_id: A, relationship_type: 'FS', lag_days: 0 }), 422);
  check('CPM still computes after refused loop', must(await api('GET', `/planning/cpm?project_id=${project}`, planner), 'cpm2').project_duration_days === 8);

  // --- Response rule (from the contract) and programme submissions.
  const rule = must(await api('POST', `/contract-admin/contracts/${contract}/rules`, admin, { clause_ref: 'PC-8.3', obligation_type: 'response_due', responsible_party: 'engineer', trigger_description: 'Engineer to respond to programme submission (fixture)', period_value: 21, period_unit: 'calendar_days', addressee: 'Contractor (fixture)', is_condition_precedent: false, source_reference: 'fixture conditions' }), 'rule');
  const wrongRule = must(await api('POST', `/contract-admin/contracts/${contract}/rules`, admin, { clause_ref: 'PC-20', obligation_type: 'notice_of_claim', responsible_party: 'contractor', trigger_description: 'claim (fixture)', period_value: 28, period_unit: 'calendar_days', addressee: 'Engineer (fixture)', is_condition_precedent: true, source_reference: 'fixture conditions' }), 'rule2');
  for (const r of [rule, wrongRule]) must(await api('POST', `/contract-admin/rules/${r.id}/confirm`, cm), 'confirm');
  await expectStatus('response rule must be of type response_due', () => api('POST', `/contract-admin/contracts/${contract}/programme-submissions`, planner, { revision_no: 'R0x', data_date: day(-40), submitted_on: day(-30), response_rule_id: wrongRule.id }), 422);
  await expectStatus('data date after submission date refused', () => api('POST', `/contract-admin/contracts/${contract}/programme-submissions`, planner, { revision_no: 'R0y', data_date: day(-1), submitted_on: day(-3) }), 422);
  const r0 = await run('planner submits revision R0 (30 days ago) with snapshot', async () => must(await api('POST', `/contract-admin/contracts/${contract}/programme-submissions`, planner, { revision_no: 'R0', data_date: day(-31), submitted_on: day(-30), response_rule_id: rule.id }), 'r0'));
  check('snapshot sealed with 6 activities; response due = submitted + 21', r0.snapshot_sealed && r0.activity_count === 6 && r0.response_due === day(-9), `${r0.activity_count} ${r0.response_due} vs ${day(-9)}`);
  const list0 = must(await api('GET', `/contract-admin/contracts/${contract}/programme-submissions`, cm), 'list');
  check('unanswered submission past its response date is flagged overdue; no accepted programme yet', list0.accepted === null && list0.submissions[0].response_overdue === true);
  await expectStatus('rejection without reasons refused', () => api('POST', `/contract-admin/programme-submissions/${r0.id}/decision`, cm, { decision: 'rejected', decision_on: day(-5), decision_reference: 'Engineer letter 12 (fixture)' }), 422);
  await expectStatus('decision dated before submission refused', () => api('POST', `/contract-admin/programme-submissions/${r0.id}/decision`, cm, { decision: 'accepted', decision_on: day(-35), decision_reference: 'Engineer letter (fixture)' }), 422);
  await run('Engineer acceptance of R0 recorded', async () => must(await api('POST', `/contract-admin/programme-submissions/${r0.id}/decision`, cm, { decision: 'accepted', decision_on: day(-5), decision_reference: 'Engineer letter 12 (fixture)' }), 'acc'));
  // Live schedule changes after submission must not alter the submitted snapshot.
  must(await api('PATCH', `/planning/activities/${C}`, planner, { planned_duration_days: 10 }), 'change live');
  const snap = must(await api('GET', `/contract-admin/programme-submissions/${r0.id}`, cm), 'snap');
  check('accepted snapshot keeps original duration of C (4) after live change to 10', snap.activities.find(a => a.activity_id_ext === 'C').planned_duration_days === 4 && snap.activities.find(a => a.activity_id_ext === 'D').predecessors.length === 2);
  const r1 = must(await api('POST', `/contract-admin/contracts/${contract}/programme-submissions`, planner, { revision_no: 'R1', data_date: day(-2), submitted_on: day(-1) }), 'r1');
  await run('Engineer rejects R1 with reasons', async () => must(await api('POST', `/contract-admin/programme-submissions/${r1.id}/decision`, cm, { decision: 'rejected', decision_on: day(0), decision_reference: 'Engineer letter 15 (fixture)', rejection_reasons: 'Logic for zone B not shown (fixture)' }), 'rej'));
  check('accepted programme is still R0 after R1 rejection', must(await api('GET', `/contract-admin/contracts/${contract}/programme-submissions`, cm), 'l').accepted?.revision_no === 'R0');
  const r2 = must(await api('POST', `/contract-admin/contracts/${contract}/programme-submissions`, planner, { revision_no: 'R2', data_date: day(-1), submitted_on: day(0) }), 'r2');
  await run('Engineer accepts R2', async () => must(await api('POST', `/contract-admin/programme-submissions/${r2.id}/decision`, cm, { decision: 'accepted', decision_on: day(0), decision_reference: 'Engineer letter 16 (fixture)' }), 'acc2'));
  const final = must(await api('GET', `/contract-admin/contracts/${contract}/programme-submissions`, cm), 'final');
  check('R2 is the single accepted programme; R0 superseded', final.accepted?.revision_no === 'R2' && final.submissions.find(s => s.revision_no === 'R0').status === 'superseded');
  await expectStatus('decided submission cannot be re-decided', () => api('POST', `/contract-admin/programme-submissions/${r1.id}/decision`, cm, { decision: 'accepted', decision_on: day(0), decision_reference: 'x ref' }), 409);
  await expectStatus('duplicate revision number refused', () => api('POST', `/contract-admin/contracts/${contract}/programme-submissions`, planner, { revision_no: 'R2', data_date: day(-1), submitted_on: day(0) }), 409);

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: snapshot rows immutable', `update programme_submission_activities set planned_duration_days=99 where submission_id=${r0.id}`);
    probe('DB: cannot add rows to a sealed snapshot', `insert into programme_submission_activities(org_id,submission_id,activity_id,activity_name) values(1,${r0.id},1,'sneak')`);
    probe('DB: submission content immutable', `update programme_submissions set data_date=data_date-1 where id=${r2.id}`);
    probe('DB: submissions cannot be deleted', `delete from programme_submissions where id=${r1.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot read tenant A submission', () => api('GET', `/contract-admin/programme-submissions/${r2.id}`, tb), 404);
  await expectStatus('tenant B cannot decide tenant A submission', () => api('POST', `/contract-admin/programme-submissions/${r1.id}/decision`, tb, { decision: 'accepted', decision_on: day(0), decision_reference: 'cross tenant' }), 404);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('wave2_programme');
