// RK-003 sweep / GC-15: variations - first runtime execution. Encodes STEP09: instruction != internal approval
// != client-agreed valuation; only an agreed valuation changes the execution BOQ / contract value.
// All quantities, rates and DOA bands are TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, finish } from './harness.mjs';

const today = new Date().toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const s1 = await login({ email: `w1s1.${TAG}@test.local`, password: 'Passw0rd!w1s1', org_id: 1 });
  const s2 = await login({ email: `w1s2.${TAG}@test.local`, password: 'Passw0rd!w1s2', org_id: 1 });
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `VA ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const qs = await mkUser('vaqs', await mkRole('VA QS', [['contracts', 'view'], ['contracts', 'create'], ['contracts', 'approve'], ['approvals', 'view'], ['approvals', 'approve']]));
  const apprRole = await mkRole('VA Approver', [['approvals', 'view'], ['approvals', 'approve'], ['contracts', 'view'], ['contracts', 'create'], ['contracts', 'approve']]);
  const appr = await mkUser('vaappr', apprRole);
  const conf = await mkUser('vaconf', await mkRole('VA DOA Conf', [['admin', 'view'], ['admin', 'approve']]));
  if (!must(await api('GET', '/approvals/configuration/doa', admin), 'doa').some(d => d.module === 'variation' && d.is_active && d.is_confirmed)) {
    const d = must(await api('POST', '/approvals/configuration/doa', admin, { module: 'variation', min_amount: 0, approval_level: 1, approver_role_id: apprRole, notes: 'TEST FIXTURE' }), 'doa');
    must(await api('POST', `/approvals/configuration/doa/${d.id}/confirm`, conf), 'doa confirm');
  }
  // Project with execution BOQ: item 1.1 = 100 m2 x 150 = 15,000; contract 15,000.
  const client = must(await api('POST', '/clients', admin, { client_name: `VA Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `VA-${TAG}`, project_name: `VA ${TAG}`, currency_id: 1, client_id: client, original_contract_value: 15000, current_contract_value: 15000 }), 'project').id;
  must(await api('POST', '/boq/master', admin, { project_id: project, item_no: '1.1', description: 'VA item', unit_of_measure: 'm2', quantity: 100, unit_rate_material: 150, cost_code_id: 2 }), 'boq');
  const contract = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'unit_price', contract_value: 15000, currency_id: 1 }), 'contract').id;
  await expectStatus('variation on an unsigned contract refused', () => api('POST', '/contracts/variations', qs, { project_id: project, contract_id: contract, variation_no: `VX-${TAG}`, description: 'too early', cost_impact: 1 }), 422);
  const ca = must(await api('POST', `/contracts/${contract}/submit-approval`, admin), 'csub').approval;
  must(await api('POST', `/approvals/${ca.id}/actions`, s1, { action: 'approved' }), 's1'); must(await api('POST', `/approvals/${ca.id}/actions`, s2, { action: 'approved' }), 's2');
  must(await api('POST', `/boq/project/${project}/handover`, admin, { contract_id: contract }), 'handover');
  const item = must(await api('GET', `/boq/project/${project}`, admin), 'pb')[0];

  // V1: amend +20 m2 @150 = 3,000 and a new item 10 x 50 = 500 -> 3,500.
  const v1 = await run('QS raises variation V1 (cost impact 3,500)', async () => must(await api('POST', '/contracts/variations', qs, { project_id: project, contract_id: contract, variation_no: `V1-${TAG}`, description: 'Extra area (fixture)', reason: 'client_request', cost_impact: 3500, time_impact_days: 5 }), 'v1'));
  must(await api('POST', `/contracts/variations/${v1.id}/lines`, qs, { project_boq_item_id: item.id, description: 'More 1.1', unit_of_measure: 'm2', quantity: 20, unit_rate: 150, action: 'amend' }), 'l1');
  must(await api('POST', `/contracts/variations/${v1.id}/lines`, qs, { description: 'New item: handrail', unit_of_measure: 'm', quantity: 10, unit_rate: 50, action: 'add' }), 'l2');
  const bad = must(await api('POST', '/contracts/variations', qs, { project_id: project, contract_id: contract, variation_no: `V2-${TAG}`, description: 'mismatch (fixture)', cost_impact: 9999 }), 'bad');
  must(await api('POST', `/contracts/variations/${bad.id}/lines`, qs, { project_boq_item_id: item.id, description: 'mismatch line', unit_of_measure: 'm2', quantity: 1, unit_rate: 150, action: 'amend' }), 'bl');
  await expectStatus('submission refused when cost impact differs from lines', () => api('POST', `/contracts/variations/${bad.id}/submit-approval`, qs), 422);
  const om = must(await api('POST', '/contracts/variations', qs, { project_id: project, contract_id: contract, variation_no: `V3-${TAG}`, description: 'over-omit (fixture)', cost_impact: -30000 }), 'om');
  must(await api('POST', `/contracts/variations/${om.id}/lines`, qs, { project_boq_item_id: item.id, description: 'omit too much', unit_of_measure: 'm2', quantity: 200, unit_rate: 150, action: 'omit' }), 'oml');
  const omr = await api('POST', `/contracts/variations/${om.id}/submit-approval`, qs);
  check('omitting more than the item quantity refused (not a DOA failure)', omr.status === 422 && /negative/.test(JSON.stringify(omr.body?.error)), `HTTP ${omr.status} ${JSON.stringify(omr.body?.error)}`);
  const omOk = must(await api('POST', '/contracts/variations', qs, { project_id: project, contract_id: contract, variation_no: `V5-${TAG}`, description: 'valid omission (fixture)', cost_impact: -1500 }), 'omok');
  must(await api('POST', `/contracts/variations/${omOk.id}/lines`, qs, { project_boq_item_id: item.id, description: 'omit 10 m2', unit_of_measure: 'm2', quantity: 10, unit_rate: 150, action: 'omit' }), 'omokl');
  await run('omission variation (negative value) routes through DOA', async () => must(await api('POST', `/contracts/variations/${omOk.id}/submit-approval`, qs), 'omok submit'));

  const va = await run('submit V1 for internal approval', async () => must(await api('POST', `/contracts/variations/${v1.id}/submit-approval`, qs), 'vsub').approval);
  await expectStatus('lines cannot be added after submission', () => api('POST', `/contracts/variations/${v1.id}/lines`, qs, { description: 'late', unit_of_measure: 'm', quantity: 1, unit_rate: 1, action: 'add' }), 422);
  const own = must(await api('POST', '/contracts/variations', appr, { project_id: project, contract_id: contract, variation_no: `V4-${TAG}`, description: 'self-approval attempt (fixture)', cost_impact: 100 }), 'own');
  const ownA = must(await api('POST', `/contracts/variations/${own.id}/submit-approval`, appr), 'own submit').approval;
  await expectStatus('approver who submitted a variation cannot approve it (SoD)', () => api('POST', `/approvals/${ownA.id}/actions`, appr, { action: 'approved' }), 403);
  await run('approver approves V1 internally', async () => must(await api('POST', `/approvals/${va.id}/actions`, appr, { action: 'approved' }), 'vappr'));
  const after1 = must(await api('GET', `/boq/project/${project}`, admin), 'pb1');
  check('internal approval does NOT change the execution BOQ (not yet agreed)', after1.length === 1 && after1[0].revised_quantity === null, JSON.stringify(after1.map(r => [r.item_no, r.revised_quantity])));
  await expectStatus('client agreement before submission to client refused', () => api('POST', `/contracts/variations/${v1.id}/client-decision`, qs, { decision: 'agreed', decided_on: today, reference: 'Engineer VO-7 (fixture)', agreed_amount: 3500 }), 409);
  await run('variation submitted to client', async () => must(await api('POST', `/contracts/variations/${v1.id}/client-submission`, qs, { submitted_on: today, reference: 'Letter C-21 (fixture)' }), 'csubm'));
  await expectStatus('agreed amount different from lines refused (revise lines first)', () => api('POST', `/contracts/variations/${v1.id}/client-decision`, qs, { decision: 'agreed', decided_on: today, reference: 'Engineer VO-7 (fixture)', agreed_amount: 3000 }), 422);
  await run('client agreement recorded (3,500, +5 days)', async () => must(await api('POST', `/contracts/variations/${v1.id}/client-decision`, qs, { decision: 'agreed', decided_on: today, reference: 'Engineer VO-7 (fixture)', agreed_amount: 3500, agreed_time_days: 5 }), 'agree'));
  const after2 = must(await api('GET', `/boq/project/${project}`, admin), 'pb2');
  const tfc = must(await api('GET', `/contract-admin/contracts/${contract}/time-revisions`, qs), 'tfc');
  check('agreed +5 days creates one Time for Completion revision from the variation (NDC-029)', tfc.length === 1 && tfc[0].source_type === 'variation' && Number(tfc[0].source_id) === Number(v1.id) && tfc[0].days === 5, JSON.stringify(tfc));
  const i11 = after2.find(r => r.item_no === '1.1'), newItem = after2.find(r => r.item_no !== '1.1');
  check('agreed variation revises item 1.1 to 120 m2 / 18,000', Number(i11.revised_quantity) === 120 && Number(i11.revised_amount) === 18000, JSON.stringify(i11));
  check('agreed new item added to execution BOQ (10 m x 50)', newItem && Number(newItem.revised_quantity) === 10 && Number(newItem.revised_amount) === 500 && Number(newItem.contract_quantity) === 0, JSON.stringify(newItem));
  const proj = must(await api('GET', `/projects/${project}`, admin), 'proj');
  check('project current contract value = 15,000 + 3,500', Number((proj.project ?? proj).current_contract_value) === 18500, String((proj.project ?? proj).current_contract_value));
  await expectStatus('agreed variation cannot be decided again', () => api('POST', `/contracts/variations/${v1.id}/client-decision`, qs, { decision: 'rejected', decided_on: today, reference: 'again' }), 409);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot read tenant A variation', () => api('GET', `/contracts/variations/${v1.id}`, tb), 404);
  await expectStatus('tenant B cannot decide tenant A variation', () => api('POST', `/contracts/variations/${v1.id}/client-decision`, tb, { decision: 'rejected', decided_on: today, reference: 'cross' }), 404);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_variations');
