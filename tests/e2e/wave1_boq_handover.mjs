// Wave 1 / G-001: estimating BOQ -> execution BOQ handover (GC-02 step 3, test ids T-GC-02-03.*).
// Requires the R0 bootstrap (probe.mjs). OWNER_PSQL_URL enables DB-level trigger probes.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const cur = 1;
try {
  const admin = await login(ADMIN);
  const roles = must(await api('GET', '/roles', admin), 'roles');
  const roleId = n => { const r = roles.find(x => x.role_name === n); if (!r) throw new Error(`role ${n} missing`); return Number(r.id); };

  // TEST FIXTURE roles/users: two contract signatories (DOA levels 1 and 2), a BOQ approver, a BOQ viewer.
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const signer1 = await mkRole('W1 Signatory 1', [['approvals', 'view'], ['approvals', 'approve'], ['contracts', 'view']]);
  const signer2 = await mkRole('W1 Signatory 2', [['approvals', 'view'], ['approvals', 'approve'], ['contracts', 'view']]);
  const boqApprover = await mkRole('W1 BOQ Approver', [['boq', 'view'], ['boq', 'approve']]);
  const boqViewer = await mkRole('W1 BOQ Viewer', [['boq', 'view']]);
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `W1 ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const T = { s1: await mkUser('w1s1', signer1), s2: await mkUser('w1s2', signer2), appr: await mkUser('w1appr', boqApprover), view: await mkUser('w1view', boqViewer) };

  const doa = must(await api('GET', '/approvals/configuration/doa', admin), 'doa');
  for (const [level, role] of [[1, signer1], [2, signer2]]) {
    const row = doa.find(d => d.module === 'contract_signing' && Number(d.approval_level) === level && Number(d.min_amount) === 0);
    if (!row) throw new Error(`contract_signing DOA level ${level} missing`);
    await run(`confirm fixture DOA contract_signing L${level}`, async () => must(await api('PATCH', `/approvals/configuration/doa/${row.id}`, admin, {
      min_amount: 0, max_amount: null, currency_id: null, approval_level: level, approver_role_id: role, is_active: true, notes: `TEST FIXTURE ${TAG}`, confirm: true }), 'doa'));
  }

  const client = must(await api('POST', '/clients', admin, { client_name: `W1 Client ${TAG}`, client_type: 'private' }), 'client').id;
  // Project with BOQ 100 x 150 + 10 x 500 = 20,000 (fixture amounts).
  const mkProject = async (k, contractValue) => {
    const project = must(await api('POST', '/projects', admin, { project_code: `W1${k}-${TAG}`, project_name: `W1 ${k} ${TAG}`, currency_id: cur, client_id: client, original_contract_value: contractValue, current_contract_value: contractValue }), 'project').id;
    const items = [];
    for (const [no, qty, mat, lab] of [['1.1', 100, 100, 50], ['1.2', 10, 500, 0]]) {
      items.push(must(await api('POST', '/boq/master', admin, { project_id: project, item_no: no, description: `W1 item ${no}`, unit_of_measure: 'm2', quantity: qty, unit_rate_material: mat, unit_rate_labor: lab, cost_code_id: 2 }), 'boq').id);
    }
    const contract = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'unit_price', contract_value: contractValue, currency_id: cur }), 'contract').id;
    return { project, contract, items };
  };
  const sign = async (p) => {
    const a = must(await api('POST', `/contracts/${p.contract}/submit-approval`, admin), 'contract submit').approval;
    must(await api('POST', `/approvals/${a.id}/actions`, T.s1, { action: 'approved', comment: 'w1' }), 'sign L1');
    must(await api('POST', `/approvals/${a.id}/actions`, T.s2, { action: 'approved', comment: 'w1' }), 'sign L2');
    const c = must(await api('GET', `/contracts/${p.contract}`, admin), 'contract');
    return (c.contract ?? c).contract_status;
  };

  // --- Case 1: zero difference completes immediately
  const p1 = await run('create project P1 with estimating BOQ (20,000) and contract 20,000', () => mkProject('A', 20000));
  await expectStatus('handover refused while contract is draft', () => api('POST', `/boq/project/${p1.project}/handover`, admin, { contract_id: p1.contract }), 409);
  check('contract signed through 2-level DOA', (await run('sign contract P1', () => sign(p1))) === 'signed');
  await expectStatus('user without boq.create cannot hand over', () => api('POST', `/boq/project/${p1.project}/handover`, T.view, { contract_id: p1.contract }), 403);
  const h1 = await run('hand over P1 (zero difference)', async () => must(await api('POST', `/boq/project/${p1.project}/handover`, admin, { contract_id: p1.contract }), 'handover'));
  check('P1 handover completed with 2 items', h1.handover.status === 'completed' && h1.items_created === 2, JSON.stringify(h1.handover).slice(0, 200));
  const pb1 = must(await api('GET', `/boq/project/${p1.project}`, admin), 'project boq');
  const total1 = pb1.reduce((s, r) => s + Number(r.contract_amount), 0);
  check('execution BOQ total equals contract value', pb1.length === 2 && total1 === 20000 && pb1.every(r => r.is_locked), `items=${pb1.length} total=${total1}`);
  check('execution rate = estimating total rate (1.1 = 150.00)', String(pb1.find(r => r.item_no === '1.1')?.contract_unit_rate) === '150.00');
  await expectStatus('second handover of same project refused', () => api('POST', `/boq/project/${p1.project}/handover`, admin, { contract_id: p1.contract }), 409);
  await expectStatus('estimating BOQ item frozen after handover (edit)', () => api('PATCH', `/boq/master/${p1.items[0]}`, admin, { quantity: 1 }), 422);
  await expectStatus('estimating BOQ item frozen after handover (delete)', () => api('DELETE', `/boq/master/${p1.items[0]}`, admin), 422);
  await expectStatus('rate build-up frozen after handover', () => api('POST', `/boq/master/${p1.items[0]}/rate-buildup`, admin, { resource_type: 'material', quantity_per_unit: 1, unit_cost: 1 }), 422);
  if (OWNER) {
    const id = pb1[0].id;
    const probe = (name, text, expectOk) => { const r = sql(OWNER, text); check(name, r.ok === expectOk, r.out.split('\n').find(l => /ERROR|UPDATE|DELETE/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: locked execution BOQ rate cannot change (even as owner role)', `update project_boq set contract_unit_rate=1 where id=${id}`, false);
    probe('DB: locked execution BOQ item cannot be deleted', `delete from project_boq where id=${id}`, false);
    probe('DB: revised quantity (variation path) may change', `update project_boq set revised_quantity=contract_quantity where id=${id}`, true);
    probe('DB: completed handover record cannot be altered', `update boq_handovers set boq_total=0 where id=${h1.handover.id}`, false);
  } else check('DB probes (OWNER_PSQL_URL not set)', false, 'OWNER_PSQL_URL required');

  // --- Case 2: difference needs acceptance by a different approver with a reason
  const p2 = await run('create project P2 with BOQ 20,000 and contract 25,000', () => mkProject('B', 25000));
  await run('sign contract P2', () => sign(p2));
  const h2 = await run('hand over P2 (difference 5,000)', async () => must(await api('POST', `/boq/project/${p2.project}/handover`, admin, { contract_id: p2.contract }), 'handover'));
  check('P2 handover pending acceptance, no items created', h2.handover.status === 'pending_acceptance' && h2.items_created === 0 && Number(h2.handover.difference) === 5000, JSON.stringify(h2.handover).slice(0, 200));
  check('no execution BOQ while pending', must(await api('GET', `/boq/project/${p2.project}`, admin), 'pb').length === 0);
  await expectStatus('preparer cannot accept own handover (SoD)', () => api('POST', `/boq/handovers/${h2.handover.id}/accept`, admin, { difference_reason: 'negotiated lump-sum adjustment' }), 403);
  await expectStatus('user without boq.approve cannot accept', () => api('POST', `/boq/handovers/${h2.handover.id}/accept`, T.view, { difference_reason: 'negotiated lump-sum adjustment' }), 403);
  await expectStatus('acceptance without reason refused', () => api('POST', `/boq/handovers/${h2.handover.id}/accept`, T.appr, {}), 422);
  const a2 = await run('independent approver accepts with reason', async () => must(await api('POST', `/boq/handovers/${h2.handover.id}/accept`, T.appr, { difference_reason: 'Fixture: awarded value includes provisional sums not in BOQ' }), 'accept'));
  check('P2 completed with 2 items, accepted_by != prepared_by', a2.handover.status === 'completed' && a2.items_created === 2 && a2.handover.accepted_by !== a2.handover.prepared_by);
  await expectStatus('accepting an already completed handover refused', () => api('POST', `/boq/handovers/${h2.handover.id}/accept`, T.appr, { difference_reason: 'again again again' }), 409);

  // --- Case 3: rejection releases the project for a new handover
  const p3 = await run('create project P3 (difference)', () => mkProject('C', 30000));
  await run('sign contract P3', () => sign(p3));
  const h3 = must(await api('POST', `/boq/project/${p3.project}/handover`, admin, { contract_id: p3.contract }), 'h3');
  await expectStatus('estimating BOQ frozen while handover pending', () => api('PATCH', `/boq/master/${p3.items[1]}`, admin, { quantity: 20 }), 422);
  const r3 = await run('approver rejects P3 handover', async () => must(await api('POST', `/boq/handovers/${h3.handover.id}/reject`, T.appr, {}), 'reject'));
  check('P3 rejected', r3.handover.status === 'rejected');
  await run('estimating BOQ editable again after rejection (qty 1.2 -> 20)', async () => must(await api('PATCH', `/boq/master/${p3.items[1]}`, admin, { quantity: 20 }), 'edit'));
  const h3b = await run('new handover after correction', async () => must(await api('POST', `/boq/project/${p3.project}/handover`, admin, { contract_id: p3.contract }), 'h3b'));
  check('corrected BOQ (25,000 vs 30,000) pending again; history keeps both records', h3b.handover.status === 'pending_acceptance' && must(await api('GET', `/boq/project/${p3.project}/handovers`, admin), 'list').length === 2);

  // --- Tenant isolation
  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot hand over tenant A project', () => api('POST', `/boq/project/${p1.project}/handover`, tb, { contract_id: p1.contract }), 404);
  await expectStatus('tenant B cannot accept tenant A handover', () => api('POST', `/boq/handovers/${h3b.handover.id}/accept`, tb, { difference_reason: 'cross tenant attempt' }), 404);
  check('tenant B sees no tenant A handovers', must(await api('GET', `/boq/project/${p1.project}/handovers`, tb), 'list').length === 0);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('wave1_boq_handover');
