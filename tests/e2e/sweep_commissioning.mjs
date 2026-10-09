// Stage 15 / GC-20: commissioning-to-handover - systems, staged test packs with verified runs and client witness, punch
// categories (A blocks handover), handover dossier of approved documents, taking-over with DLP end from the contract.
// Users hold every site and EDMS permission so that only integrity and segregation rules can stop them. TEST FIXTURES.
import { createHash } from 'node:crypto';
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
const sha = (s) => createHash('sha256').update(s).digest('hex');
try {
  const admin = await login(ADMIN);
  const s1 = await login({ email: `w1s1.${TAG}@test.local`, password: 'Passw0rd!w1s1', org_id: 1 });
  const s2 = await login({ email: `w1s2.${TAG}@test.local`, password: 'Passw0rd!w1s2', org_id: 1 });
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `CM ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const all = await mkRole('Commissioning All', [['site', 'view'], ['site', 'manage'], ['site', 'approve'], ['edms', 'view'], ['edms', 'create'], ['edms', 'edit'], ['edms', 'approve']]);
  const C1 = await mkUser('cm1', all), C2 = await mkUser('cm2', all);
  const client = must(await api('POST', '/clients', admin, { client_name: `CM Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `CM-${TAG}`, project_name: `CM ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const sign = async (body) => {
    const id = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 800000, currency_id: 1, ...body }), 'contract').id;
    const ca = must(await api('POST', `/contracts/${id}/submit-approval`, admin), 'csub').approval;
    must(await api('POST', `/approvals/${ca.id}/actions`, s1, { action: 'approved', comment: 'ok' }), 's1');
    must(await api('POST', `/approvals/${ca.id}/actions`, s2, { action: 'approved', comment: 'ok' }), 's2');
    return id;
  };
  const contract = await sign({ defects_liability_months: 12 });
  const noDlp = await sign({});

  // --- Systems and staged test packs.
  const sys = await run('HVAC system registered', async () => must(await api('POST', '/commissioning/systems', C1, { project_id: project, system_code: `HVAC-${TAG}`, name: 'HVAC level 1 (fixture)' }), 'system'));
  await expectStatus('duplicate system code refused', () => api('POST', '/commissioning/systems', C1, { project_id: project, system_code: `HVAC-${TAG}`, name: 'dup' }), 409);
  await expectStatus('test pack without acceptance criteria refused', () => api('POST', `/commissioning/systems/${sys.id}/test-packs`, C1, { pack_no: 'TP-0', stage: 'functional', acceptance_criteria: 'ok' }), 400);
  const mc = must(await api('POST', `/commissioning/systems/${sys.id}/test-packs`, C1, { pack_no: 'TP-MC', stage: 'mechanical_completion', acceptance_criteria: 'Installed per IFC drawings; checklist MC-01 complete (fixture)' }), 'mc');
  const fn = must(await api('POST', `/commissioning/systems/${sys.id}/test-packs`, C1, { pack_no: 'TP-FN', stage: 'functional', acceptance_criteria: 'Supply air 18 +/- 1 C at design flow (fixture)', witness_required: true }), 'fn');
  const runOf = (pack, body, tok = C1) => api('POST', `/commissioning/test-packs/${pack.id}/runs`, tok, { result: 'passed', executed_on: day(-3), results_notes: 'Within tolerance (fixture)', ...body });
  await expectStatus('witnessed pack refused without client witness', () => runOf(fn, {}), 422);
  await expectStatus('test run dated in the future refused', () => runOf(mc, { executed_on: day(2) }), 422);
  const rMc = must(await runOf(mc, {}), 'run mc');
  const rFn = must(await runOf(fn, { witness_name: 'Client engineer (fixture)', witness_reference: 'Witness sheet WS-12 (fixture)' }), 'run fn');
  await expectStatus('executor cannot verify own result (SoD)', () => api('POST', `/commissioning/test-runs/${rMc.id}/verify`, C1), 403);
  await expectStatus('functional stage cannot be accepted before mechanical completion', () => api('POST', `/commissioning/test-runs/${rFn.id}/verify`, C2), 422);
  await run('mechanical completion verified by a second person', async () => must(await api('POST', `/commissioning/test-runs/${rMc.id}/verify`, C2), 'verify mc'));
  await run('functional test verified after mechanical completion', async () => must(await api('POST', `/commissioning/test-runs/${rFn.id}/verify`, C2), 'verify fn'));
  // A later failed run withdraws acceptance until a new passed run is verified.
  const rFail = must(await runOf(mc, { result: 'failed', results_notes: 'Vibration above limit after rebalancing (fixture)' }), 'fail');
  await expectStatus('a failed run cannot be verified', () => api('POST', `/commissioning/test-runs/${rFail.id}/verify`, C2), 409);
  const st1 = must(await api('GET', `/commissioning/systems/${sys.id}`, C2), 'status1');
  check('a later failure withdraws acceptance of the pack (1 of 2 accepted)', st1.readiness.packs_accepted === 1 && st1.readiness.test_packs === 2, JSON.stringify(st1.readiness));
  await expectStatus('an already-verified run cannot be verified again', () => api('POST', `/commissioning/test-runs/${rMc.id}/verify`, C2), 409);
  const rMc2 = must(await runOf(mc, { results_notes: 'Vibration within limit after mount replacement (fixture)' }), 'run mc2');
  must(await api('POST', `/commissioning/test-runs/${rMc2.id}/verify`, C2), 'verify mc2');

  // --- Punch list categories.
  const pA = must(await api('POST', '/site/punch-list', C1, { project_id: project, system_id: sys.id, category: 'A', description: 'Fire damper FD-3 not wired to alarm (fixture)' }), 'punch A');
  const pB = must(await api('POST', '/site/punch-list', C1, { project_id: project, system_id: sys.id, category: 'B', description: 'Missing duct labels corridor 2 (fixture)' }), 'punch B');
  must(await api('POST', `/commissioning/systems/${sys.id}/dossier`, C1, { requirement: 'O&M manual' }), 'dossier req');
  const blocked = await api('POST', `/commissioning/systems/${sys.id}/taking-over`, C2, { contract_id: contract, certificate_no: `TOC-${TAG}`, taking_over_date: day(0), client_reference: 'Engineer letter EL-40 (fixture)' });
  check('taking-over refused with an open category-A item and incomplete dossier (reason states both)', blocked.status === 422 && /category-A items 1/.test(blocked.body?.error ?? '') && /dossier 0\/1/.test(blocked.body?.error ?? ''), `HTTP ${blocked.status} ${blocked.body?.error}`);
  await expectStatus('closing needs a resolution note', () => api('PATCH', `/site/punch-list/${pA.id}/close`, C2, {}), 400);
  await expectStatus('category-A item cannot be closed by the person who raised it', () => api('PATCH', `/site/punch-list/${pA.id}/close`, C1, { closure_note: 'Wired and tested (fixture)' }), 422);
  const cA = await run('category-A item closed by another person with resolution', async () => must(await api('PATCH', `/site/punch-list/${pA.id}/close`, C2, { closure_note: 'Damper wired to alarm panel, tested (fixture)' }), 'close A'));
  check('closer and resolution recorded', Number(cA.closed_by) > 0 && /wired/i.test(cA.closure_note));
  await expectStatus('closed item cannot be closed again', () => api('PATCH', `/site/punch-list/${pA.id}/close`, C2, { closure_note: 'again' }), 409);
  await expectStatus('missing punch item is 404 (was 200 with null)', () => api('PATCH', '/site/punch-list/999999999/close', C2, { closure_note: 'nothing here' }), 404);

  // --- Dossier: only approved documents of the project satisfy a requirement.
  const req = (await api('GET', `/commissioning/systems/${sys.id}`, C1)).body.data.dossier[0];
  const doc = must(await api('POST', '/edms/documents', C1, { project_id: project, doc_number: `OM-${TAG}`, file_name: 'om.pdf', storage_key: `s3://fixture/OM-${TAG}/1`, revision: 'A', sha256: sha('om') }), 'doc');
  await expectStatus('a draft document does not satisfy the dossier', () => api('POST', `/commissioning/dossier/${req.id}/link`, C1, { document_id: doc.id }), 422);
  must(await api('POST', `/edms/documents/${doc.id}/submit`, C1), 'submit doc');
  must(await api('POST', `/edms/documents/${doc.id}/review`, C2, { action: 'approved', comment: 'O&M accepted (fixture)' }), 'approve doc');
  await run('approved O&M manual linked to the dossier', async () => must(await api('POST', `/commissioning/dossier/${req.id}/link`, C1, { document_id: doc.id }), 'link'));

  // --- Taking-over and DLP.
  const toc = { certificate_no: `TOC-${TAG}`, taking_over_date: day(0), client_reference: 'Engineer letter EL-40 (fixture)' };
  await expectStatus('taking-over refused when the contract has no defects liability period', () => api('POST', `/commissioning/systems/${sys.id}/taking-over`, C2, { contract_id: noDlp, ...toc }), 422);
  await expectStatus('taking-over cannot be future-dated', () => api('POST', `/commissioning/systems/${sys.id}/taking-over`, C2, { contract_id: contract, ...toc, taking_over_date: day(3) }), 422);
  const cert = await run('taking-over recorded (category-B item may remain open)', async () => must(await api('POST', `/commissioning/systems/${sys.id}/taking-over`, C2, { contract_id: contract, ...toc }), 'toc'));
  const expectDlp = (() => { const d = new Date(); d.setMonth(d.getMonth() + 12); return d.toISOString().slice(0, 10); })();
  check('DLP end = taking-over + 12 months from the contract', cert.dlp_end_date?.slice(0, 10) === expectDlp, `${cert.dlp_end_date} vs ${expectDlp}`);
  await expectStatus('no test runs after taking-over', () => runOf(mc, {}), 422);
  await expectStatus('dossier frozen after taking-over', () => api('POST', `/commissioning/systems/${sys.id}/dossier`, C1, { requirement: 'As-built drawings' }), 422);
  await expectStatus('a system is taken over once', () => api('POST', `/commissioning/systems/${sys.id}/taking-over`, C2, { contract_id: contract, ...toc, certificate_no: `TOC2-${TAG}` }), 409);
  await new Promise(r => setTimeout(r, 1100));
  must(await api('POST', '/site/punch-list', C1, { project_id: project, system_id: sys.id, category: 'B', description: 'Condensate leak at AHU-2 during DLP (fixture)' }), 'dlp defect');
  const st2 = must(await api('GET', `/commissioning/systems/${sys.id}`, C2), 'status2');
  check('DLP register: defects raised after taking-over are tracked with days remaining', st2.taking_over && st2.taking_over.dlp_defects_open === 1 && st2.taking_over.dlp_days_remaining > 300 && st2.punch_items.some(p => Number(p.id) === Number(pB.id) && p.status === 'open'), JSON.stringify(st2.taking_over));

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: test runs append-only (no delete)', `delete from commissioning_test_runs where id=${rFail.id}`);
    probe('DB: a recorded result cannot be rewritten', `update commissioning_test_runs set result='passed' where id=${rFail.id}`);
    probe('DB: taking-over certificate immutable', `update handover_certificates set dlp_end_date = dlp_end_date + 365 where id=${cert.id}`);
    probe('DB: punch items are never deleted', `delete from punch_lists where id=${pB.id}`);
    probe('DB: closing an A item by its raiser refused at DB level', `insert into punch_lists(org_id,project_id,description,raised_by,category,system_id,status,closed_by,closure_note) values(1,${project},'x',1,'A',${sys.id},'open',null,null); update punch_lists set status='closed', closed_by=raised_by, closure_note='self close' where description='x' and project_id=${project}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot read a tenant A system', () => api('GET', `/commissioning/systems/${sys.id}`, tb), 404);
  await expectStatus('tenant B cannot verify a tenant A test run', () => api('POST', `/commissioning/test-runs/${rMc2.id}/verify`, tb), 404);
  await expectStatus('tenant B cannot close a tenant A punch item', () => api('PATCH', `/site/punch-list/${pB.id}/close`, tb, { closure_note: 'cross tenant' }), 404);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_commissioning');
