// Wave 1 / G-002: governed vendor master (GC-06 step 2). Requires probe.mjs bootstrap.
// APP_PSQL_URL (app role) and OWNER_PSQL_URL enable DB-level tamper probes.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const APP = process.env.APP_PSQL_URL, OWNER = process.env.OWNER_PSQL_URL;
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `VM ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  // TEST FIXTURE roles: clerk (create/edit), two approvers, viewer.
  const T = {
    clerk: await mkUser('vmclerk', await mkRole('VM Clerk', [['vendors', 'view'], ['vendors', 'create'], ['vendors', 'edit']])),
    a1: await mkUser('vma1', await mkRole('VM Approver 1', [['vendors', 'view'], ['vendors', 'create'], ['vendors', 'edit'], ['vendors', 'approve']])),
    a2: await mkUser('vma2', await mkRole('VM Approver 2', [['vendors', 'view'], ['vendors', 'approve']])),
    view: await mkUser('vmview', await mkRole('VM Viewer', [['vendors', 'view']]))
  };
  const project = must(await api('POST', '/projects', admin, { project_code: `VM-${TAG}`, project_name: `VM ${TAG}`, currency_id: 1 }), 'project').id;

  await expectStatus('viewer cannot create vendor', () => api('POST', '/vendors', T.view, { vendor_name: 'x vendor' }), 403);
  await expectStatus('invalid email rejected', () => api('POST', '/vendors', T.clerk, { vendor_name: 'bad vendor', email: 'nope' }), 400);
  const v1 = await run('clerk creates vendor V1 (pending prequalification)', async () => must(await api('POST', '/vendors', T.clerk, { vendor_name: `VM Supplier ${TAG}`, vendor_type: 'subcontractor', tax_id: `TX-${TAG}` }), 'v1'));
  check('new vendor is pending, active, not blacklisted, no bank', v1.prequalification_status === 'pending' && v1.is_active && !v1.is_blacklisted && v1.bank_account_no === null);
  await expectStatus('duplicate tax id in same tenant refused', () => api('POST', '/vendors', T.clerk, { vendor_name: `VM Dup ${TAG}`, tax_id: `TX-${TAG}` }), 409);

  // Eligibility enforced in the database for every engagement path.
  await expectStatus('RFQ with unqualified vendor refused', () => api('POST', '/procurement/rfqs', admin, { project_id: project, rfq_ref: `VMR1-${TAG}`, vendor_ids: [v1.id] }), 422);
  await expectStatus('PO with unqualified vendor refused', () => api('POST', '/procurement/purchase-orders', admin, { project_id: project, vendor_id: v1.id, cost_code_id: 2, po_ref: `VMPO1-${TAG}`, currency_id: 1, lines: [{ item_description: 'vm item', unit_of_measure: 'm2', quantity: 1, unit_rate: 1 }] }), 422);
  await expectStatus('subcontract with unqualified vendor refused', () => api('POST', '/subcontracts', admin, { project_id: project, vendor_id: v1.id, package_name: 'VM package', contract_value: 1000, currency_id: 1 }), 422);

  // Prequalification SoD.
  const v2 = must(await api('POST', '/vendors', T.a1, { vendor_name: `VM Self ${TAG}` }), 'v2'); // created by an approver
  await expectStatus('creator cannot prequalify own vendor (SoD)', () => api('POST', `/vendors/${v2.id}/prequalification`, T.a1, { decision: 'approved', reason: 'self approval attempt' }), 403);
  await expectStatus('clerk without vendors.approve cannot prequalify', () => api('POST', `/vendors/${v1.id}/prequalification`, T.clerk, { decision: 'approved', reason: 'no permission' }), 403);
  await expectStatus('prequalification needs a reason', () => api('POST', `/vendors/${v1.id}/prequalification`, T.a1, { decision: 'approved' }), 400);
  await run('approver prequalifies V1', async () => must(await api('POST', `/vendors/${v1.id}/prequalification`, T.a1, { decision: 'approved', reason: 'documents verified (fixture)' }), 'preq'));
  const rfq = await run('RFQ with prequalified vendor accepted', async () => must(await api('POST', '/procurement/rfqs', admin, { project_id: project, rfq_ref: `VMR2-${TAG}`, vendor_ids: [v1.id] }), 'rfq'));

  // Blacklist blocks new engagements; lifting needs a different approver.
  await run('approver A1 blacklists V1', async () => must(await api('POST', `/vendors/${v1.id}/blacklist`, T.a1, { reason: 'fixture: integrity concern' }), 'bl'));
  await expectStatus('quotation from blacklisted vendor refused', () => api('POST', `/procurement/rfqs/${rfq.id}/vendor-quotations`, admin, { vendor_id: v1.id, total_amount: 10, currency_id: 1 }), 422);
  await expectStatus('blacklisted vendor cannot be prequalified', () => api('POST', `/vendors/${v1.id}/prequalification`, T.a2, { decision: 'approved', reason: 'try while blacklisted' }), 409);
  await expectStatus('same approver cannot lift own blacklist (SoD)', () => api('POST', `/vendors/${v1.id}/unblacklist`, T.a1, { reason: 'self lift attempt' }), 403);
  await run('second approver lifts blacklist', async () => must(await api('POST', `/vendors/${v1.id}/unblacklist`, T.a2, { reason: 'fixture: concern resolved' }), 'ubl'));
  await run('quotation accepted after lift', async () => must(await api('POST', `/procurement/rfqs/${rfq.id}/vendor-quotations`, admin, { vendor_id: v1.id, total_amount: 10, currency_id: 1 }), 'vq'));

  // Bank details: request -> independent verified approval; masking; duplicate-account control.
  await expectStatus('bank details cannot be set through edit', () => api('PATCH', `/vendors/${v1.id}`, T.clerk, { bank_account_no: '123' }), 400);
  const br = await run('clerk requests bank change', async () => must(await api('POST', `/vendors/${v1.id}/bank-change-requests`, T.clerk, { new_bank_name: 'Fixture Bank', new_bank_account_no: `EG00${TAG}0001`, reason: 'vendor letter received' }), 'br'));
  await expectStatus('second pending request refused', () => api('POST', `/vendors/${v1.id}/bank-change-requests`, T.clerk, { new_bank_name: 'Other', new_bank_account_no: `EG00${TAG}0002`, reason: 'another letter' }), 409);
  await expectStatus('approval without verification refused', () => api('POST', `/vendors/bank-change-requests/${br.id}/approve`, T.a1, {}), 400);
  await run('approver verifies by callback and approves', async () => must(await api('POST', `/vendors/bank-change-requests/${br.id}/approve`, T.a1, { verification_method: 'callback_to_known_contact', verification_reference: 'fixture call log #1' }), 'bra'));
  const seenByViewer = must(await api('GET', `/vendors/${v1.id}`, T.view), 'vview');
  const seenByApprover = must(await api('GET', `/vendors/${v1.id}`, T.a2), 'vappr');
  check('viewer sees masked account, approver sees full', seenByViewer.bank_account_no === `****${`EG00${TAG}0001`.slice(-4)}` && seenByApprover.bank_account_no === `EG00${TAG}0001`, `${seenByViewer.bank_account_no} / ${seenByApprover.bank_account_no}`);
  const v3 = must(await api('POST', '/vendors', T.clerk, { vendor_name: `VM Second ${TAG}` }), 'v3');
  const br3 = must(await api('POST', `/vendors/${v3.id}/bank-change-requests`, T.a1, { new_bank_name: 'Fixture Bank', new_bank_account_no: `EG00${TAG}0001`, reason: 'same account as V1' }), 'br3');
  await expectStatus('requester cannot approve own bank change (SoD)', () => api('POST', `/vendors/bank-change-requests/${br3.id}/approve`, T.a1, { verification_method: 'callback_to_known_contact', verification_reference: 'self-approval attempt' }), 403);
  await expectStatus('account already used by another vendor refused', () => api('POST', `/vendors/bank-change-requests/${br3.id}/approve`, T.a2, { verification_method: 'callback_to_known_contact', verification_reference: 'fixture call log #2' }), 409);
  await run('duplicate-account request rejected with note', async () => must(await api('POST', `/vendors/bank-change-requests/${br3.id}/reject`, T.a2, { decision_note: 'account belongs to another vendor' }), 'brr'));

  const ev = must(await api('GET', `/vendors/${v1.id}`, T.a2), 'v1').events.map(e => e.event).join(',');
  check('event trail complete', ev === 'created,prequalification_approved,blacklisted,unblacklisted,bank_details_changed', ev);

  // Database tamper probes.
  if (APP && OWNER) {
    const probe = (name, url, text, expectOk) => { const r = sql(url, text); check(name, r.ok === expectOk, r.out.split('\n').find(l => /ERROR|UPDATE|INSERT|DELETE/.test(l)) ?? r.out.slice(0, 120)); };
    const ctx = `select set_config('app.org_id','${ADMIN.org_id}',false);`;
    probe('DB: app role cannot unblacklist/requalify directly', APP, `${ctx} update vendors_subcontractors set prequalification_status='approved' where id=${v3.id}`, false);
    probe('DB: app role cannot change bank account directly', APP, `${ctx} update vendors_subcontractors set bank_account_no='X1' where id=${v1.id}`, false);
    probe('DB: app role cannot insert pre-approved vendor', APP, `${ctx} insert into vendors_subcontractors(org_id,vendor_name,prequalification_status) values(${ADMIN.org_id},'sneak','approved')`, false);
    probe('DB: vendor cannot be deleted (owner role)', OWNER, `delete from vendors_subcontractors where id=${v3.id}`, false);
    probe('DB: vendor event log is append-only (owner role)', OWNER, `delete from vendor_status_events where vendor_id=${v1.id}`, false);
    probe('DB: decided bank change cannot be edited (owner role)', OWNER, `update vendor_bank_change_requests set new_bank_account_no='X' where id=${br.id}`, false);
    probe('DB: contact details still editable directly', APP, `${ctx} update vendors_subcontractors set phone='0100' where id=${v3.id}`, true);
  } else check('DB probes (APP_PSQL_URL and OWNER_PSQL_URL required)', false);

  // Tenant isolation.
  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot read tenant A vendor', () => api('GET', `/vendors/${v1.id}`, tb), 404);
  await expectStatus('tenant B cannot prequalify tenant A vendor', () => api('POST', `/vendors/${v3.id}/prequalification`, tb, { decision: 'approved', reason: 'cross tenant' }), 404);
  await expectStatus('tenant B cannot decide tenant A bank change', () => api('POST', `/vendors/bank-change-requests/${br.id}/reject`, tb, { decision_note: 'cross tenant' }), 404);
  check('tenant B vendor list has no tenant A vendors', !must(await api('GET', '/vendors', tb), 'list').some(v => String(v.vendor_name).includes(TAG)));
  await expectStatus('tenant B cannot put tenant A vendor on its PO', async () => {
    const pb = must(await api('POST', '/projects', tb, { project_code: `VMB-${TAG}`, project_name: 'b', currency_id: 1 }), 'pb').id;
    return api('POST', '/procurement/purchase-orders', tb, { project_id: pb, vendor_id: v1.id, cost_code_id: 2, po_ref: `VMB-${TAG}`, currency_id: 1, lines: [{ item_description: 'vm item', unit_of_measure: 'm2', quantity: 1, unit_rate: 1 }] });
  }, 422);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('wave1_vendor_master');
