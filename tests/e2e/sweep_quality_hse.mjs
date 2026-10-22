// RK-003 sweep / GC-08 QA/QC + GC-09 HSE: first runtime execution. Users holding all relevant permissions
// are used so that only segregation-of-duties rules can stop them. All data are TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, finish } from './harness.mjs';

const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `QH ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const qaAll = await mkRole('QH QA All', [['qaqc', 'view'], ['qaqc', 'create'], ['qaqc', 'edit'], ['qaqc', 'approve']]);
  const hseAll = await mkRole('QH HSE All', [['hse', 'view'], ['hse', 'create'], ['hse', 'approve']]);
  const T = { qa1: await mkUser('qhqa1', qaAll), qa2: await mkUser('qhqa2', qaAll), h1: await mkUser('qhh1', hseAll), h2: await mkUser('qhh2', hseAll) };
  const project = must(await api('POST', '/projects', admin, { project_code: `QH-${TAG}`, project_name: `QH ${TAG}`, currency_id: 1 }), 'project').id;

  // --- QA/QC inspections (SOD15-055: inspection request creation vs acceptance).
  const insp = await run('QA1 requests an inspection', async () => must(await api('POST', '/qaqc/inspections', T.qa1, { project_id: project, checklist_type: 'concrete_pour_slab_L2' }), 'insp'));
  await expectStatus('requester cannot record the result of own inspection (SoD)', () => api('PATCH', `/qaqc/inspections/${insp.id}/status`, T.qa1, { status: 'passed' }), 403);
  await run('independent inspector records PASSED', async () => must(await api('PATCH', `/qaqc/inspections/${insp.id}/status`, T.qa2, { status: 'passed' }), 'pass'));
  await expectStatus('a recorded inspection result cannot be changed (passed -> failed)', () => api('PATCH', `/qaqc/inspections/${insp.id}/status`, T.qa2, { status: 'failed' }), 422);
  await expectStatus('result cannot be reset to pending', () => api('PATCH', `/qaqc/inspections/${insp.id}/status`, T.qa2, { status: 'pending' }), 422);

  // --- NCR lifecycle (SOD15-057).
  const ncr = await run('QA1 raises NCR', async () => must(await api('POST', '/qaqc/ncrs', T.qa1, { project_id: project, ncr_no: `NCR-${TAG}`, description: 'Honeycombing on slab edge (fixture)' }), 'ncr'));
  await expectStatus('NCR raiser cannot close it (SoD)', () => api('PATCH', `/qaqc/ncrs/${ncr.id}/close`, T.qa1, { root_cause: 'vibration', corrective_action: 'repair' }), 409);
  await run('independent QA closes NCR with root cause and action', async () => must(await api('PATCH', `/qaqc/ncrs/${ncr.id}/close`, T.qa2, { root_cause: 'Insufficient vibration (fixture)', corrective_action: 'Repair per method statement (fixture)' }), 'close'));
  await expectStatus('closed NCR cannot be closed again', () => api('PATCH', `/qaqc/ncrs/${ncr.id}/close`, T.qa2, { root_cause: 'x cause', corrective_action: 'x action' }), 409);

  // --- HSE permits to work.
  await expectStatus('permit expiring before it is issued refused', () => api('POST', '/hse/permits', T.h1, { project_id: project, permit_type: 'hot_work', issue_date: day(0), expiry_date: day(-1) }), 422);
  const p1 = await run('H1 requests a hot-work permit valid today', async () => must(await api('POST', '/hse/permits', T.h1, { project_id: project, permit_type: 'hot_work', issue_date: day(0), expiry_date: day(1) }), 'p1'));
  await expectStatus('requester cannot approve own permit (SoD)', () => api('POST', `/hse/permits/${p1.id}/approve`, T.h1), 409);
  await run('H2 approves', async () => must(await api('POST', `/hse/permits/${p1.id}/approve`, T.h2), 'appr'));
  await run('H2 activates', async () => must(await api('POST', `/hse/permits/${p1.id}/activate`, T.h2), 'act'));
  const p2 = must(await api('POST', '/hse/permits', T.h1, { project_id: project, permit_type: 'confined_space', issue_date: day(-5), expiry_date: day(-2) }), 'p2');
  must(await api('POST', `/hse/permits/${p2.id}/approve`, T.h2), 'p2 appr');
  await expectStatus('a permit past its expiry date cannot be activated', () => api('POST', `/hse/permits/${p2.id}/activate`, T.h2), 422);
  await run('expired permit can be marked expired', async () => must(await api('POST', `/hse/permits/${p2.id}/expire`, T.h2), 'expire'));

  // --- Incidents.
  const inc = must(await api('POST', '/hse/incidents', T.h1, { project_id: project, severity: 'minor', description: 'Hand cut (fixture)' }), 'inc');
  await expectStatus('incident reporter cannot close it (SoD)', () => api('PATCH', `/hse/incidents/${inc.id}/close`, T.h1, { corrective_actions: 'gloves' }), 409);
  await run('independent HSE closes incident', async () => must(await api('PATCH', `/hse/incidents/${inc.id}/close`, T.h2, { corrective_actions: 'Cut-resistant gloves issued (fixture)' }), 'iclose'));

  // --- CC-075: a fatality is a serious incident in every report (the weekly executive report and the frozen report
  // pack counted severity 'fatal', which incidents never store, so fatalities were left out).
  for (const severity of ['major', 'fatality']) must(await api('POST', '/hse/incidents', T.h1, { project_id: project, severity, incident_date: day(-1), description: `${severity} incident (fixture)` }), `inc ${severity}`);
  const weekly = must(await api('GET', `/reports/weekly-executive?project_id=${project}`, admin), 'weekly');
  check('weekly executive report counts the major incident and the fatality as serious', Number(weekly[0]?.major_hse_incidents) === 2, JSON.stringify(weekly[0]?.major_hse_incidents));
  const hm = must(await api('GET', `/hse/metrics?project_id=${project}`, admin), 'hse metrics');
  check('HSE metrics agree (major + fatality)', Number(hm.serious_incidents) >= 2, JSON.stringify(hm.serious_incidents));
  const pk = must(await api('POST', '/reports/packs', admin, { project_id: project, period_type: 'weekly', period_start: day(-2), period_end: day(-1) }), 'pack');
  const pkFull = must(await api('GET', `/reports/packs/${pk.id}`, admin), 'pack read');
  check('frozen report pack counts the major incident and the fatality (migration 084)', Number(pkFull.payload?.hse?.major_or_fatal_in_period) === 2, JSON.stringify(pkFull.payload?.hse));
  const exec = must(await api('GET', '/dashboards/executive', admin), 'executive');
  const keys = (exec.financial ?? []).map(r => `${r.project_id}|${r.currency_code}`);
  check('executive dashboard financials are one row per project and currency (never summed across currencies)', Array.isArray(exec.financial) && exec.financial.length > 0 && exec.financial.every(r => /^[A-Z]{3}$/.test(r.currency_code ?? '')) && new Set(keys).size === keys.length, JSON.stringify(exec.financial?.slice(0, 2)));

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot record result on tenant A inspection', () => api('PATCH', `/qaqc/inspections/${insp.id}/status`, tb, { status: 'failed' }), 404);
  await expectStatus('tenant B cannot approve tenant A permit', () => api('POST', `/hse/permits/${p2.id}/approve`, tb), 409);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_quality_hse');
