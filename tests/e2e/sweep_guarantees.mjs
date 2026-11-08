// CC-092 / Stage 63 (A-006, migration 097): letters of guarantee register. Issued guarantees (bid bond for a tender,
// performance for a project with its client and contract) and a received one (from a subcontractor, with its
// subcontract); recording rules; SoD on activation (also for a user holding every permission); amendments (extension,
// reduction, increase) carrying the current amount / expiry; release, claim and expiry rules; permanence in the
// database; exposure summary; AL-04 expiry alert to finance users only; company isolation. Fixture references are
// picked by SQL from the records of the earlier suites; amounts and banks are TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const one = (text) => { const r = sql(OWNER, text); if (!r.ok) throw new Error(r.out.slice(0, 300)); return r.out; };
const probe = (name, text, re) => { const r = sql(OWNER, text); check(name, !r.ok && re.test(r.out), r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 160)); };
const day = (n) => { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10); };
try {
  const admin = await login(ADMIN);
  const mkUser = async (key, perms) => {
    const roleId = must(await api('POST', '/roles', admin, { role_name: `LG ${key} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), 'role').id;
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id: roleId, full_name: `LG ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return { token: await login(u), roleId };
  };
  const prep = await mkUser('lgprep', [['finance', 'view'], ['finance', 'create']]);
  const appr = await mkUser('lgappr', [['finance', 'view'], ['finance', 'approve'], ['finance', 'create']]);
  const view = await mkUser('lgview', [['finance', 'view']]);
  const site = await mkUser('lgsite', [['site', 'view']]);

  const [projectId, contractId, clientId] = one(`select p.id, k.id, k.client_id from projects p join contracts k on k.project_id = p.id where p.project_code = 'P-${TAG}' order by k.id limit 1`).split('|');
  const tenderId = one(`select id from tenders where org_id = ${ADMIN.org_id} order by id limit 1`);
  const tenderClient = one(`select coalesce(client_id, ${clientId}) from tenders where id = ${tenderId}`);
  const [scId, scProject, vendorId] = one(`select id, project_id, vendor_id from subcontracts where org_id = ${ADMIN.org_id} order by id limit 1`).split('|');
  const otherVendor = one(`select id from vendors_subcontractors where org_id = ${ADMIN.org_id} and id <> ${vendorId} order by id limit 1`);
  const egp = one(`select id from currencies where code = 'EGP'`);
  // A client of another company (company B has none at this point of the gate: one is created through its API).
  let bClient = one(`select id from clients where org_id <> ${ADMIN.org_id} order by id limit 1`);
  if (!bClient) bClient = String(must(await api('POST', '/clients', await login(ADMIN_B), { client_name: `LG other ${TAG}` }), 'B client').id);
  const base = { currency_id: Number(egp), issue_date: day(-10), bank_name: `National Bank ${TAG}` };

  // --- Recording (draft).
  const perf = must(await api('POST', '/finance/guarantees', prep.token, { ...base, direction: 'issued', guarantee_type: 'performance', project_id: Number(projectId), contract_id: Number(contractId),
    client_id: Number(clientId), bank_reference: `PG-${TAG}`, amount: '100000.00', expiry_date: day(20), cash_margin: '25000.00', commission_rate_pct: '0.5' }), 'performance');
  check('an issued performance guarantee is recorded as a draft; current amount and expiry start from the recorded ones',
    perf.status === 'draft' && perf.current_amount === '100000.00' && perf.current_expiry === day(20) && perf.cash_margin === '25000.00' && perf.client_name && perf.project_code === `P-${TAG}`, JSON.stringify(perf).slice(0, 240));
  await expectStatus('recording needs finance.create', () => api('POST', '/finance/guarantees', view.token, { ...base, direction: 'issued', guarantee_type: 'performance', project_id: Number(projectId), client_id: Number(clientId), bank_reference: `X-${TAG}`, amount: '1', expiry_date: day(5) }), 403);
  await expectStatus('the same bank reference at the same bank is refused', () => api('POST', '/finance/guarantees', prep.token, { ...base, direction: 'issued', guarantee_type: 'performance', project_id: Number(projectId), client_id: Number(clientId), bank_reference: `PG-${TAG}`, amount: '5', expiry_date: day(5) }), 409);
  await expectStatus('expiry before issue is refused', () => api('POST', '/finance/guarantees', prep.token, { ...base, direction: 'issued', guarantee_type: 'performance', project_id: Number(projectId), client_id: Number(clientId), bank_reference: `E1-${TAG}`, amount: '5', expiry_date: day(-20) }), 422);
  await expectStatus('an issued guarantee needs its client (beneficiary)', () => api('POST', '/finance/guarantees', prep.token, { ...base, direction: 'issued', guarantee_type: 'performance', project_id: Number(projectId), bank_reference: `E2-${TAG}`, amount: '5', expiry_date: day(5) }), 422);
  await expectStatus('a bid bond needs its tender', () => api('POST', '/finance/guarantees', prep.token, { ...base, direction: 'issued', guarantee_type: 'bid', client_id: Number(clientId), bank_reference: `E3-${TAG}`, amount: '5', expiry_date: day(5) }), 422);
  await expectStatus('a received guarantee cannot be a bid bond', () => api('POST', '/finance/guarantees', prep.token, { ...base, direction: 'received', guarantee_type: 'bid', tender_id: Number(tenderId), vendor_id: Number(vendorId), bank_reference: `E4-${TAG}`, amount: '5', expiry_date: day(5) }), 422);
  await expectStatus('a client of another company is refused', () => api('POST', '/finance/guarantees', prep.token, { ...base, direction: 'issued', guarantee_type: 'performance', project_id: Number(projectId), client_id: Number(bClient), bank_reference: `E5-${TAG}`, amount: '5', expiry_date: day(5) }), 422);
  await expectStatus('a subcontract of another subcontractor is refused', () => api('POST', '/finance/guarantees', prep.token, { ...base, direction: 'received', guarantee_type: 'performance', project_id: Number(scProject), subcontract_id: Number(scId), vendor_id: Number(otherVendor), bank_reference: `E6-${TAG}`, amount: '5', expiry_date: day(5) }), 422);
  const bid = must(await api('POST', '/finance/guarantees', prep.token, { ...base, direction: 'issued', guarantee_type: 'bid', tender_id: Number(tenderId), client_id: Number(tenderClient), bank_reference: `BB-${TAG}`, amount: '20000.00', expiry_date: day(60) }), 'bid');
  const recv = must(await api('POST', '/finance/guarantees', prep.token, { ...base, direction: 'received', guarantee_type: 'advance_payment', project_id: Number(scProject), subcontract_id: Number(scId), vendor_id: Number(vendorId), bank_reference: `RG-${TAG}`, amount: '30000.00', expiry_date: day(90) }), 'received');
  check('a bid bond for a tender and a guarantee received from a subcontractor (with its subcontract) are recorded', bid.tender_title && recv.vendor_name && recv.direction === 'received');
  const edited = must(await api('PATCH', `/finance/guarantees/${bid.id}`, prep.token, { ...base, direction: 'issued', guarantee_type: 'bid', tender_id: Number(tenderId), client_id: Number(tenderClient), bank_reference: `BB-${TAG}`, amount: '25000.00', expiry_date: day(60) }), 'edit draft');
  check('a draft is edited (amount and current amount follow)', edited.amount === '25000.00' && edited.current_amount === '25000.00');

  // --- Activation with segregation of duties.
  await expectStatus('the preparer cannot activate (activation also needs finance.approve)', () => api('POST', `/finance/guarantees/${perf.id}/activate`, prep.token), 403);
  const adminDraft = must(await api('POST', '/finance/guarantees', admin, { ...base, direction: 'issued', guarantee_type: 'maintenance', project_id: Number(projectId), client_id: Number(clientId), bank_reference: `AD-${TAG}`, amount: '1000.00', expiry_date: day(400) }), 'admin draft');
  await expectStatus('SoD: a user holding every permission cannot activate a guarantee they recorded', () => api('POST', `/finance/guarantees/${adminDraft.id}/activate`, admin), 403);
  probe('DB: activation by the preparer is refused by the database too', `update bank_guarantees set status = 'active', activated_by = prepared_by, activated_at = now() where id = ${adminDraft.id}`, /check constraint/);
  for (const g of [perf, bid, recv]) must(await api('POST', `/finance/guarantees/${g.id}/activate`, appr.token), 'activate');
  const act = must(await api('GET', `/finance/guarantees/${perf.id}`, view.token), 'get');
  check('a second person activates; the activation is recorded with who and when', act.status === 'active' && act.activated_by_name === 'LG lgappr' && !!act.activated_at);
  await expectStatus('an active guarantee is not edited directly', () => api('PATCH', `/finance/guarantees/${perf.id}`, prep.token, { ...base, direction: 'issued', guarantee_type: 'performance', project_id: Number(projectId), client_id: Number(clientId), bank_reference: `PG-${TAG}`, amount: '1.00', expiry_date: day(20) }), 409);
  probe('DB: the terms of an active guarantee cannot be changed directly', `update bank_guarantees set amount = 1 where id = ${perf.id}`, /change only by an amendment/);
  probe('DB: the current amount cannot be changed without an amendment', `update bank_guarantees set current_amount = 1 where id = ${perf.id}`, /follow its amendments/);
  await expectStatus('an active guarantee is never deleted', () => api('DELETE', `/finance/guarantees/${perf.id}`, prep.token), 422);

  // --- Amendments.
  await expectStatus('an extension must move the expiry later', () => api('POST', `/finance/guarantees/${perf.id}/amendments`, prep.token, { kind: 'extension', new_expiry: day(10), effective_date: day(0), bank_reference: `PG-${TAG}-A1`, reason: 'Contract period extended by EOT' }), 422);
  const ext = must(await api('POST', `/finance/guarantees/${perf.id}/amendments`, prep.token, { kind: 'extension', new_expiry: day(25), effective_date: day(0), bank_reference: `PG-${TAG}-A1`, reason: 'Contract period extended by EOT' }), 'extend');
  check('an extension moves the current expiry; the recorded expiry stays', ext.current_expiry === day(25) && ext.expiry_date === day(20) && ext.amendments.length === 1);
  await expectStatus('a reduction must lower the amount', () => api('POST', `/finance/guarantees/${perf.id}/amendments`, prep.token, { kind: 'reduction', new_amount: '150000.00', effective_date: day(0), bank_reference: `PG-${TAG}-A2`, reason: 'Reduction after taking over' }), 422);
  const red = must(await api('POST', `/finance/guarantees/${perf.id}/amendments`, prep.token, { kind: 'reduction', new_amount: '60000.00', effective_date: day(0), bank_reference: `PG-${TAG}-A2`, reason: 'Reduction after taking over' }), 'reduce');
  check('a reduction lowers the current amount and keeps the extended expiry', red.current_amount === '60000.00' && red.current_expiry === day(25) && red.amount === '100000.00');
  const inc = must(await api('POST', `/finance/guarantees/${recv.id}/amendments`, prep.token, { kind: 'increase', new_amount: '35000.00', effective_date: day(0), bank_reference: `RG-${TAG}-A1`, reason: 'Advance payment increased by addendum' }), 'increase');
  check('an increase raises the current amount', inc.current_amount === '35000.00');
  await expectStatus('an amendment needs a reason of at least 10 characters', () => api('POST', `/finance/guarantees/${perf.id}/amendments`, prep.token, { kind: 'extension', new_expiry: day(30), effective_date: day(0), bank_reference: 'X1', reason: 'short' }), 400);
  probe('DB: amendments cannot be changed or deleted', `delete from bank_guarantee_amendments where guarantee_id = ${perf.id}`, /permanent/);

  // --- Exposure summary.
  const sum = must(await api('GET', '/finance/guarantees/summary', view.token), 'summary');
  const sp = sum.find(s => s.currency === 'EGP' && s.direction === 'issued' && s.guarantee_type === 'performance');
  const [sAmt, sMargin, s30] = one(`select sum(current_amount)::text, coalesce(sum(cash_margin), 0)::text, coalesce(sum(current_amount) filter (where current_expiry <= current_date + 30), 0)::text
    from bank_guarantees where org_id = ${ADMIN.org_id} and status = 'active' and direction = 'issued' and guarantee_type = 'performance' and currency_id = ${egp}`).split('|');
  check('exposure of active guarantees per currency, direction and type: amount, cash margin and expiring in 30 days are the database sums', sp && sp.amount === sAmt && sp.cash_margin === sMargin && sp.expiring_30 === s30, `${JSON.stringify(sp)} / ${sAmt} ${sMargin} ${s30}`);

  // --- AL-04: expiry within the company's days, to finance users only.
  must(await api('PUT', '/notifications/alert-rules/AL-04', admin, { enabled: true, threshold: 30, recipient_role_ids: [view.roleId, site.roleId] }), 'AL-04 rule');
  must(await api('POST', '/notifications/evaluate', admin), 'evaluate');
  const sent = (roleId) => one(`select count(*) from notifications n join users u on u.id = n.user_id where n.alert_code = 'AL-04' and n.record_id = ${perf.id} and u.role_id = ${roleId}`);
  check('AL-04: a guarantee expiring within 30 days alerts the finance user of the chosen roles', sent(view.roleId) === '1');
  check('AL-04: a chosen role without finance view is not told', sent(site.roleId) === '0');
  check('AL-04: a guarantee expiring after the window is not alerted', one(`select count(*) from notifications where alert_code = 'AL-04' and record_id = ${bid.id}`) === '0');
  must(await api('POST', '/notifications/evaluate', admin), 'evaluate again');
  check('AL-04: evaluated again, the same guarantee and expiry is not repeated', sent(view.roleId) === '1');

  // --- Release, claim, expiry.
  await expectStatus('a release needs the bank letter reference', () => api('POST', `/finance/guarantees/${bid.id}/release`, appr.token, { closed_on: day(0) }), 422);
  await expectStatus('releasing needs finance.approve', () => api('POST', `/finance/guarantees/${bid.id}/release`, prep.token, { closed_on: day(0), reference: 'REL-1' }), 403);
  const rel = must(await api('POST', `/finance/guarantees/${bid.id}/release`, appr.token, { closed_on: day(0), reference: `REL-${TAG}` }), 'release');
  check('a bid bond is released with its letter reference', rel.status === 'released' && rel.close_reference === `REL-${TAG}` && rel.closed_on === day(0));
  probe('DB: a released guarantee is never changed', `update bank_guarantees set notes = 'x' where id = ${bid.id}`, /closed guarantee is never changed/);
  await expectStatus('a claim above the current amount is refused', () => api('POST', `/finance/guarantees/${recv.id}/claim`, appr.token, { closed_on: day(0), claimed_amount: '40000.00', reason: 'Advance not recovered: subcontract terminated' }), 422);
  const cl = must(await api('POST', `/finance/guarantees/${recv.id}/claim`, appr.token, { closed_on: day(0), claimed_amount: '12000.00', reason: 'Advance not recovered: subcontract terminated' }), 'claim');
  check('a received advance-payment guarantee is claimed for the unrecovered amount, with the reason', cl.status === 'claimed' && cl.claimed_amount === '12000.00');
  await expectStatus('a guarantee still valid cannot be marked expired', () => api('POST', `/finance/guarantees/${perf.id}/expire`, appr.token, { closed_on: day(0) }), 422);
  must(await api('DELETE', `/finance/guarantees/${adminDraft.id}`, admin), 'delete draft');
  check('a draft is deleted', one(`select count(*) from bank_guarantees where id = ${adminDraft.id}`) === '0');

  // --- Isolation and audit.
  const adminB = await login(ADMIN_B);
  check('the other company does not see these guarantees', must(await api('GET', '/finance/guarantees', adminB), 'B list').every(g => ![perf.id, bid.id, recv.id].includes(g.id)));
  await expectStatus('the other company cannot read one of them', () => api('GET', `/finance/guarantees/${perf.id}`, adminB), 404);
  check('guarantees and amendments are audited', Number(one(`select count(*) from audit_log where table_name in ('bank_guarantees', 'bank_guarantee_amendments') and org_id = ${ADMIN.org_id}`)) >= 8);
} catch (e) {
  check('suite completed', false, e.message.slice(0, 300));
}
finish('sweep_guarantees');
