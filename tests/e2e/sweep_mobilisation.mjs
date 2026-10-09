// Stage 17 / GC-02 step 9: mobilisation readiness gate - project-defined readiness items closed with evidence or
// risk-accepted against the risk register, GO only with every mandatory item resolved, decided by someone other than the
// preparer, no-go with reason, one live gate per project. TEST FIXTURES.
import { createHash } from 'node:crypto';
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const sha = (s) => createHash('sha256').update(s).digest('hex');
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    const created = must(await api('POST', '/users', admin, { role_id, full_name: `MB ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return { id: Number(created.id), tok: await login(u) };
  };
  const all = await mkRole('Mobilisation All', [['projects', 'view'], ['projects', 'create'], ['projects', 'edit'], ['projects', 'approve'], ['edms', 'view'], ['edms', 'create'], ['edms', 'edit'], ['edms', 'approve']]);
  const M1 = await mkUser('mb1', all), M2 = await mkUser('mb2', all);
  const mkProject = async (k) => must(await api('POST', '/projects', admin, { project_code: `${k}-${TAG}`, project_name: `${k} ${TAG}`, currency_id: 1 }), 'project').id;
  const P = await mkProject('MB'), Q = await mkProject('MBQ');

  const g = await run('preparer opens the mobilisation gate', async () => must(await api('POST', '/mobilisation/gates', M1.tok, { project_id: P }), 'gate'));
  await expectStatus('one live gate per project', () => api('POST', '/mobilisation/gates', M2.tok, { project_id: P }), 409);
  const add = (gate, body) => api('POST', `/mobilisation/gates/${gate}/items`, M1.tok, body);
  const permit = must(await add(g.id, { category: 'permit', item: 'Excavation permit from municipality', mandatory: true }), 'permit');
  const car = must(await add(g.id, { category: 'insurance', item: 'Contractor all-risks policy', mandatory: true }), 'car');
  const bond = must(await add(g.id, { category: 'bond', item: 'Performance bond issued to employer', mandatory: true }), 'bond');
  const hse = must(await add(g.id, { category: 'staff', item: 'HSE manager on site', mandatory: false }), 'hse');

  // --- Evidence.
  const doc = must(await api('POST', '/edms/documents', M1.tok, { project_id: P, doc_number: `PRM-${TAG}`, file_name: 'permit.pdf', storage_key: `s3://fixture/PRM-${TAG}/1`, revision: 'A', sha256: sha('permit') }), 'doc');
  await expectStatus('a draft document is not evidence', () => api('POST', `/mobilisation/items/${permit.id}/close`, M1.tok, { evidence_document_id: doc.id }), 422);
  must(await api('POST', `/edms/documents/${doc.id}/submit`, M1.tok), 'submit doc');
  must(await api('POST', `/edms/documents/${doc.id}/review`, M2.tok, { action: 'approved', comment: 'Permit verified (fixture)' }), 'approve doc');
  await run('permit closed with the approved permit document', async () => must(await api('POST', `/mobilisation/items/${permit.id}/close`, M1.tok, { evidence_document_id: doc.id }), 'close permit'));
  await expectStatus('closing without evidence or note refused', () => api('POST', `/mobilisation/items/${car.id}/close`, M1.tok, {}), 400);
  await run('CAR policy closed with a note', async () => must(await api('POST', `/mobilisation/items/${car.id}/close`, M1.tok, { note: 'Policy CAR-2026-77 received and filed (fixture)' }), 'close car'));
  await expectStatus('a resolved item cannot be resolved again', () => api('POST', `/mobilisation/items/${car.id}/close`, M1.tok, { note: 'again and again' }), 409);

  // --- Risk acceptance ties to the risk register.
  const riskQ = must(await api('POST', '/risks', M1.tok, { risk_no: `MBQ-R-${TAG}`, project_id: Q, kind: 'threat', title: 'Other project risk', cause: 'Other project (fixture)', effect: 'Other project (fixture)', owner_user_id: M1.id, probability_level: 2, impact_level: 2 }), 'riskQ');
  await expectStatus('risk acceptance needs a risk of the same project', () => api('POST', `/mobilisation/items/${bond.id}/risk-accept`, M2.tok, { risk_id: riskQ.id, note: 'Bond delayed by bank (fixture)' }), 422);
  const risk = must(await api('POST', '/risks', M1.tok, { risk_no: `MB-R-${TAG}`, project_id: P, kind: 'threat', title: 'Bond issued late', cause: 'Bank processing time (fixture)', effect: 'Employer may withhold advance (fixture)', owner_user_id: M2.id, probability_level: 3, impact_level: 3 }), 'risk');
  await expectStatus('optional items are not risk-accepted', () => api('POST', `/mobilisation/items/${hse.id}/risk-accept`, M2.tok, { risk_id: risk.id, note: 'Not needed for optional item' }), 422);
  await expectStatus('risk acceptance needs a reason', () => api('POST', `/mobilisation/items/${bond.id}/risk-accept`, M2.tok, { risk_id: risk.id, note: 'short' }), 400);
  await run('bond risk-accepted against the risk register entry', async () => must(await api('POST', `/mobilisation/items/${bond.id}/risk-accept`, M2.tok, { risk_id: risk.id, note: 'Bank confirmed issue within 7 days; employer informed (fixture)' }), 'accept bond'));

  // --- Submit and decide.
  await expectStatus('only the preparer submits', () => api('POST', `/mobilisation/gates/${g.id}/submit`, M2.tok), 403);
  await run('preparer submits the gate', async () => must(await api('POST', `/mobilisation/gates/${g.id}/submit`, M1.tok), 'submit'));
  await expectStatus('no new items after submission', () => add(g.id, { category: 'other', item: 'Late item', mandatory: true }), 422);
  await expectStatus('preparer cannot decide own gate (SoD)', () => api('POST', `/mobilisation/gates/${g.id}/decision`, M1.tok, { decision: 'go' }), 403);
  const go = await run('second person decides GO (optional HSE item still open)', async () => must(await api('POST', `/mobilisation/gates/${g.id}/decision`, M2.tok, { decision: 'go', note: 'Mobilise; HSE manager joins week 2 (fixture)' }), 'go'));
  check('decision recorded with decider', go.status === 'go' && Number(go.decided_by) === M2.id);
  await expectStatus('items of a decided gate are frozen', () => api('POST', `/mobilisation/items/${hse.id}/close`, M1.tok, { note: 'HSE manager arrived (fixture)' }), 422);

  // --- GO refused with an open mandatory item; no-go needs a reason; a new gate may follow a no-go.
  const g2 = must(await api('POST', '/mobilisation/gates', M1.tok, { project_id: Q }), 'gate Q');
  must(await add(g2.id, { category: 'permit', item: 'Road closure permit', mandatory: true }), 'q item');
  must(await api('POST', `/mobilisation/gates/${g2.id}/submit`, M1.tok), 'submit Q');
  const refused = await api('POST', `/mobilisation/gates/${g2.id}/decision`, M2.tok, { decision: 'go' });
  check('GO refused while a mandatory item is open (count stated)', refused.status === 422 && /1 mandatory item/.test(refused.body?.error ?? ''), `HTTP ${refused.status} ${refused.body?.error}`);
  await expectStatus('no-go needs a reason', () => api('POST', `/mobilisation/gates/${g2.id}/decision`, M2.tok, { decision: 'no_go' }), 400);
  await run('no-go recorded with reason', async () => must(await api('POST', `/mobilisation/gates/${g2.id}/decision`, M2.tok, { decision: 'no_go', note: 'Road closure permit outstanding (fixture)' }), 'no go'));
  const g3 = await run('a new gate can be opened after a no-go', async () => must(await api('POST', '/mobilisation/gates', M1.tok, { project_id: Q }), 'gate Q2'));
  const q3 = must(await add(g3.id, { category: 'permit', item: 'Road closure permit', mandatory: true }), 'q3 item');

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: gates are never deleted', `delete from mobilisation_gates where id=${g.id}`);
    probe('DB: a decided gate is immutable', `update mobilisation_gates set status='no_go', decision_note='second thoughts' where id=${g.id}`);
    probe('DB: risk acceptance without a risk refused', `update mobilisation_gate_items set status='risk_accepted', note='no risk reference given', resolved_by=1, resolved_at=now() where id=${q3.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot read a tenant A gate', () => api('GET', `/mobilisation/gates/${g.id}`, tb), 404);
  await expectStatus('tenant B cannot decide a tenant A gate', () => api('POST', `/mobilisation/gates/${g2.id}/decision`, tb, { decision: 'go' }), 404);
  await expectStatus('tenant B cannot open a gate on a tenant A project', () => api('POST', '/mobilisation/gates', tb, { project_id: P }), 422);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_mobilisation');
