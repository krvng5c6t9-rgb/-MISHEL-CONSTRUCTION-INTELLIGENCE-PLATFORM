// Stage 12 / GC-26 + GC-01 step 8: risk & opportunity register - first runtime execution. Users hold every projects
// permission so that only integrity and segregation rules can stop them. Scores, percentages and amounts are TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    const created = must(await api('POST', '/users', admin, { role_id, full_name: `RK ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return { id: Number(created.id), tok: await login(u) };
  };
  const all = await mkRole('Risk All', [['projects', 'view'], ['projects', 'create'], ['projects', 'edit'], ['projects', 'approve']]);
  const R1 = await mkUser('rk1', all), R2 = await mkUser('rk2', all);
  const V = await mkUser('rkv', await mkRole('Risk Viewer', [['projects', 'view']]));
  const tender = must(await api('POST', '/tendering/tenders', admin, { tender_ref: `RKT-${TAG}`, tender_title: 'Risk tender (fixture)' }), 'tender').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `RK-${TAG}`, project_name: `RK ${TAG}`, currency_id: 1 }), 'project').id;
  const base = { cause: 'Ground conditions unknown at bid (fixture)', effect: 'Extra excavation and delay (fixture)', owner_user_id: R1.id };

  // --- Tender-stage assessment (GC-01 step 8).
  await expectStatus('a risk must belong to a tender or a project', () => api('POST', '/risks', R1.tok, { risk_no: `RX-${TAG}`, kind: 'threat', title: 'orphan', ...base, probability_level: 3, impact_level: 3 }), 400);
  await expectStatus('probability level outside 1-5 refused', () => api('POST', '/risks', R1.tok, { risk_no: `RX-${TAG}`, tender_id: tender, kind: 'threat', title: 'bad', ...base, probability_level: 6, impact_level: 3 }), 400);
  await expectStatus('owner must be an active user of this organization', () => api('POST', '/risks', R1.tok, { risk_no: `RX-${TAG}`, tender_id: tender, kind: 'threat', title: 'bad owner', ...base, owner_user_id: 999999, probability_level: 3, impact_level: 3 }), 422);
  await expectStatus('viewer cannot raise a risk', () => api('POST', '/risks', V.tok, { risk_no: `RX-${TAG}`, tender_id: tender, kind: 'threat', title: 'viewer', ...base, probability_level: 3, impact_level: 3 }), 403);
  const t1 = await run('threat raised at tender: P4 x I4, 40% x 100,000', async () => must(await api('POST', '/risks', R1.tok, { risk_no: `R1-${TAG}`, tender_id: tender, kind: 'threat', title: 'Rock in excavation', ...base, probability_level: 4, impact_level: 4, probability_pct: 40, cost_impact: 100000, time_impact_days: 20, review_due: day(14) }), 't1'));
  check('score 16 and expected value 40,000 computed by the database', t1.score === 16 && Number(t1.expected_value) === 40000, `${t1.score}/${t1.expected_value}`);
  const o1 = must(await api('POST', '/risks', R1.tok, { risk_no: `O1-${TAG}`, tender_id: tender, kind: 'opportunity', title: 'Reuse excavated rock as fill', cause: 'Rock suitable as fill (fixture)', effect: 'Saves imported fill (fixture)', owner_user_id: R2.id, probability_level: 3, impact_level: 3, probability_pct: 50, cost_impact: 20000 }), 'o1');
  await expectStatus('duplicate risk number refused', () => api('POST', '/risks', R1.tok, { risk_no: `R1-${TAG}`, tender_id: tender, kind: 'threat', title: 'dup', ...base, probability_level: 1, impact_level: 1 }), 409);
  const sumT = must(await api('GET', `/risks/summary?tender_id=${tender}`, R2.tok), 'summary');
  check('tender summary: threat EV 40,000, opportunity EV 10,000, top risk is the threat', Number(sumT.open_threat_expected_value) === 40000 && Number(sumT.open_opportunity_expected_value) === 10000 && Number(sumT.top_risks[0].id) === Number(t1.id), JSON.stringify(sumT).slice(0, 200));

  // --- Carried to the project at award; reassessment history.
  await run('tender risk carried to the project', async () => must(await api('POST', `/risks/${t1.id}/assign-project`, R1.tok, { project_id: project }), 'assign'));
  await expectStatus('project link cannot be changed once set', () => api('POST', `/risks/${t1.id}/assign-project`, R1.tok, { project_id: project }), 409);
  const re = await run('reassessed after site investigation: P2 x I4, 20%', async () => must(await api('POST', `/risks/${t1.id}/assess`, R2.tok, { probability_level: 2, impact_level: 4, probability_pct: 20, cost_impact: 100000, time_impact_days: 20 }), 'assess'));
  const d1 = must(await api('GET', `/risks/${t1.id}`, R1.tok), 'detail');
  check('assessment history kept by the database (initial + reassessment)', d1.assessments.length === 2 && d1.assessments[0].probability_level === 4 && d1.assessments[1].probability_level === 2 && Number(re.expected_value) === 20000, JSON.stringify(d1.assessments.map(a => [a.probability_level, a.assessed_by])));

  // --- Responses and escalation.
  await expectStatus('opportunity strategy refused on a threat', () => api('POST', `/risks/${t1.id}/responses`, R1.tok, { strategy: 'exploit', action: 'exploit the rock', owner_user_id: R2.id, due_date: day(5) }), 422);
  const rs = await run('mitigation response owned by R2', async () => must(await api('POST', `/risks/${t1.id}/responses`, R1.tok, { strategy: 'mitigate', action: 'Trial pits at grid C before mobilising (fixture)', owner_user_id: R2.id, due_date: day(-1) }), 'resp'));
  const d2 = must(await api('GET', `/risks/${t1.id}`, R1.tok), 'detail2');
  check('response past its due date is flagged overdue', d2.responses[0].overdue === true && d2.overdue_responses === 1);
  await expectStatus('escalation needs a reason', () => api('POST', `/risks/${t1.id}/escalate`, R1.tok, { escalated_to: R2.id }), 400);
  await run('risk escalated to R2 with reason', async () => must(await api('POST', `/risks/${t1.id}/escalate`, R1.tok, { escalated_to: R2.id, reason: 'Exposure above project contingency (fixture)' }), 'esc'));

  // --- Closing: SoD, no open responses, reason + lesson, closure type fits the kind.
  const close = (tok, body) => api('POST', `/risks/${t1.id}/close`, tok, { closure_type: 'mitigated', reason: 'Trial pits found no rock (fixture)', lesson_learned: 'Do trial pits before pricing rock risk (fixture)', ...body });
  await expectStatus('the person who raised the risk cannot close it (SoD)', () => close(R1.tok, {}), 403);
  await expectStatus('a risk with open responses cannot be closed', () => close(R2.tok, {}), 422);
  await expectStatus('finishing a response needs an outcome', () => api('POST', `/risks/responses/${rs.id}/finish`, R2.tok, { status: 'done' }), 400);
  must(await api('POST', `/risks/responses/${rs.id}/finish`, R2.tok, { status: 'done', outcome: 'Six trial pits dug, no rock (fixture)' }), 'finish');
  await expectStatus('closing without a lesson learned refused', () => close(R2.tok, { lesson_learned: 'short' }), 400);
  await expectStatus('opportunity closure type refused on a threat', () => close(R2.tok, { closure_type: 'realised' }), 422);
  await expectStatus('materialised event must be a contract event of the project', () => close(R2.tok, { closure_type: 'occurred', materialised_event_id: 999999 }), 422);
  const cl = await run('R2 closes the threat as mitigated with lesson learned', async () => must(await close(R2.tok, {}), 'close'));
  check('closer and time recorded', Number(cl.closed_by) === R2.id && !!cl.closed_at);
  await expectStatus('closed risk cannot be reassessed', () => api('POST', `/risks/${t1.id}/assess`, R2.tok, { probability_level: 5, impact_level: 5 }), 409);
  await run('opportunity closed as realised by someone other than its raiser', async () => must(await api('POST', `/risks/${o1.id}/close`, R2.tok, { closure_type: 'realised', reason: 'Rock reused as fill (fixture)', lesson_learned: 'Test excavated material early for reuse (fixture)' }), 'o close'));

  // --- Review cadence.
  const late = must(await api('POST', '/risks', R1.tok, { risk_no: `R2-${TAG}`, project_id: project, kind: 'threat', title: 'Late steel delivery', cause: 'Single supplier (fixture)', effect: 'Frame delayed (fixture)', owner_user_id: R2.id, probability_level: 3, impact_level: 2, review_due: day(-1) }), 'late');
  const sumP = must(await api('GET', `/risks/summary?project_id=${project}`, R2.tok), 'summary P');
  check('review past due is flagged; unquantified threats are counted, not guessed', sumP.reviews_overdue === 1 && sumP.threats_not_quantified === 1 && sumP.open_risks === 1, JSON.stringify(sumP).slice(0, 200));

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: closed risk immutable', `update risks set probability_level=5 where id=${t1.id}`);
    probe('DB: risks cannot be deleted', `delete from risks where id=${late.id}`);
    probe('DB: assessment history append-only', `update risk_assessments set probability_level=1 where risk_id=${t1.id}`);
    probe('DB: finished response immutable', `update risk_responses set action='rewritten' where id=${rs.id}`);
    probe('DB: closing by the raiser refused at DB level', `update risks set status='closed',closure_type='mitigated',closure_reason='self close',lesson_learned='self closing attempt',closed_by=created_by,closed_at=now() where id=${late.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  const lB = must(await api('GET', '/risks', tb), 'risks B');
  check('tenant B does not see tenant A risks', !lB.some(x => Number(x.id) === Number(t1.id)));
  await expectStatus('tenant B cannot read a tenant A risk', () => api('GET', `/risks/${late.id}`, tb), 404);
  await expectStatus('tenant B cannot escalate a tenant A risk', () => api('POST', `/risks/${late.id}/escalate`, tb, { escalated_to: 1, reason: 'cross tenant' }), 404);
  await expectStatus('tenant B cannot raise a risk on a tenant A project', () => api('POST', '/risks', tb, { risk_no: `RB-${TAG}`, project_id: project, kind: 'threat', title: 'cross', cause: 'cross tenant', effect: 'cross tenant', owner_user_id: 1, probability_level: 1, impact_level: 1 }), 422);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_risks');
