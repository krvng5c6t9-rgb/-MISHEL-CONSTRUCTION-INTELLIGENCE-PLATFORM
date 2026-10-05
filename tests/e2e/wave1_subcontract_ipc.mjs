// Wave 1 / GC-12: subcontractor certificate (IPC) flow, first runtime execution (T-GC-12-01..08).
// Subcontract value, rates, retention % and DOA bands are TEST FIXTURES.
import { ADMIN, TAG, api, must, run, check, expectStatus, login, finish } from './harness.mjs';

try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `SC ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  // Roles: QS maker (creates certificates), site engineer (verifies), QS lead (certifies), approvers, DOA confirmer.
  const T = {
    maker: await mkUser('scmaker', await mkRole('SC Maker', [['contracts', 'view'], ['contracts', 'create']])),
    site: await mkUser('scsite', await mkRole('SC Site', [['contracts', 'view'], ['site', 'approve']])),
    qs: await mkUser('scqs', await mkRole('SC QS Lead', [['contracts', 'view'], ['contracts', 'approve']])),
    appr: await mkUser('scappr', await mkRole('SC Approver', [['approvals', 'view'], ['approvals', 'approve']])),
    conf: await mkUser('scconf', await mkRole('SC DOA Conf', [['admin', 'view'], ['admin', 'approve']])),
    vend: await mkUser('scvend', await mkRole('SC Vendor Approver', [['vendors', 'view'], ['vendors', 'approve']])),
    // Holds every permission in the chain, so only segregation-of-duties rules can stop it.
    combo: await mkUser('sccombo', await mkRole('SC Combined', [['contracts', 'view'], ['contracts', 'create'], ['contracts', 'approve'], ['site', 'approve'], ['approvals', 'view'], ['approvals', 'approve']]))
  };
  const apprRole = (must(await api('GET', '/roles', admin), 'roles')).find(r => r.role_name === `SC Approver ${TAG}`).id;
  for (const module of ['subcontract_signing', 'subcontract_certificate']) {
    const doa = must(await api('GET', '/approvals/configuration/doa', admin), 'doa').filter(d => d.module === module && d.is_active && d.is_confirmed);
    if (!doa.length) {
      const row = must(await api('POST', '/approvals/configuration/doa', admin, { module, min_amount: 0, approval_level: 1, approver_role_id: apprRole, notes: 'TEST FIXTURE' }), `doa ${module}`);
      must(await api('POST', `/approvals/configuration/doa/${row.id}/confirm`, T.conf), `confirm ${module}`);
    }
  }
  // Any pre-existing confirmed rows (placeholders) for these modules at level >1 would add steps; the fixture uses level 1 only.

  const project = must(await api('POST', '/projects', admin, { project_code: `SC-${TAG}`, project_name: `SC ${TAG}`, currency_id: 1 }), 'project').id;
  const vendor = must(await api('POST', '/vendors', admin, { vendor_name: `SC Sub ${TAG}`, vendor_type: 'subcontractor' }), 'vendor').id;
  must(await api('POST', `/vendors/${vendor}/prequalification`, T.vend, { decision: 'approved', reason: 'fixture prequalification' }), 'preq');
  const sc = await run('create subcontract (100,000, retention 10%)', async () => must(await api('POST', '/subcontracts', admin, { project_id: project, vendor_id: vendor, package_name: `SC pkg ${TAG}`, contract_value: 100000, currency_id: 1, cost_code_id: 2, retention_percent: 10 }), 'sc'));

  // Defect probe 1: certificate against a subcontract that is not yet approved/active.
  const early = await api('POST', '/subcontracts/certificates', T.maker, { subcontract_id: sc.id, project_id: project, certificate_no: `E-${TAG}`, period_from: '2026-10-01', period_to: '2026-10-31', gross_work_done: 1000 });
  check('certificate refused while subcontract is draft', early.status === 422, `HTTP ${early.status} ${JSON.stringify(early.body?.error ?? '')}`);

  const sa = must(await api('POST', `/subcontracts/${sc.id}/submit-approval`, admin), 'sc submit').approval;
  await run('approve subcontract', async () => must(await api('POST', `/approvals/${sa.id}/actions`, T.appr, { action: 'approved', comment: 'sc' }), 'sc appr'));
  const scs = must(await api('GET', '/subcontracts', admin), 'list').find(x => x.id === sc.id);
  check('subcontract active after approval', scs.status === 'active', scs.status);

  // Certificate with lines: 2 lines = 20,000 this period; retention 10% = 2,000.
  const cert = await run('maker creates certificate (gross 20,000, retention 2,000)', async () => must(await api('POST', '/subcontracts/certificates', T.maker, { subcontract_id: sc.id, project_id: project, certificate_no: `C1-${TAG}`, period_from: '2026-10-01', period_to: '2026-10-31', gross_work_done: 20000, less_retention: 2000 }), 'cert'));
  await run('add line A 100 x 150', async () => must(await api('POST', `/subcontracts/certificates/${cert.id}/lines`, T.maker, { description: 'Line A', quantity_this_period: 100, cumulative_quantity: 100, unit_rate: 150 }), 'la'));
  await run('add line B 10 x 500', async () => must(await api('POST', `/subcontracts/certificates/${cert.id}/lines`, T.maker, { description: 'Line B', quantity_this_period: 10, cumulative_quantity: 10, unit_rate: 500 }), 'lb'));

  // Defect probe 2: gross must equal the sum of lines.
  const bad = must(await api('POST', '/subcontracts/certificates', T.maker, { subcontract_id: sc.id, project_id: project, certificate_no: `C2-${TAG}`, period_from: '2026-11-01', period_to: '2026-11-30', gross_work_done: 99999 }), 'bad');
  must(await api('POST', `/subcontracts/certificates/${bad.id}/lines`, T.maker, { description: 'Line', quantity_this_period: 1, cumulative_quantity: 1, unit_rate: 10 }), 'bl');
  const badVerify = await api('POST', `/subcontracts/certificates/${bad.id}/verify`, T.site);
  check('verification refused when gross differs from sum of lines', badVerify.status === 422, `HTTP ${badVerify.status} ${JSON.stringify(badVerify.body?.error ?? '')}`);
  // Defect probe 3: retention above the subcontract percentage.
  const r3 = must(await api('POST', '/subcontracts/certificates', T.maker, { subcontract_id: sc.id, project_id: project, certificate_no: `C3-${TAG}`, period_from: '2026-11-01', period_to: '2026-11-30', gross_work_done: 1000, less_retention: 500 }), 'r3');
  const r3v = await api('POST', `/subcontracts/certificates/${r3.id}/verify`, T.site);
  check('verification refused when retention exceeds subcontract retention %', r3v.status === 422, `HTTP ${r3v.status} ${JSON.stringify(r3v.body?.error ?? '')}`);

  // Segregation of duties along the chain (SOD15-029 measurement vs certification).
  await expectStatus('maker without site.approve cannot verify', () => api('POST', `/subcontracts/certificates/${cert.id}/verify`, T.maker), 403);
  const c4 = must(await api('POST', '/subcontracts/certificates', T.combo, { subcontract_id: sc.id, project_id: project, certificate_no: `C4-${TAG}`, period_from: '2026-12-01', period_to: '2026-12-31', gross_work_done: 1000, less_retention: 100 }), 'c4');
  await expectStatus('SoD: maker holding site.approve cannot verify own certificate', () => api('POST', `/subcontracts/certificates/${c4.id}/verify`, T.combo), 409);
  must(await api('POST', `/subcontracts/certificates/${c4.id}/verify`, T.site), 'c4 verify');
  await expectStatus('SoD: maker holding contracts.approve cannot QS-certify own certificate', () => api('POST', `/subcontracts/certificates/${c4.id}/qs-certify`, T.combo), 409);
  must(await api('POST', `/subcontracts/certificates/${c4.id}/qs-certify`, T.qs), 'c4 qs');
  const c4a = must(await api('POST', `/subcontracts/certificates/${c4.id}/submit-approval`, T.combo), 'c4 submit').approval;
  await expectStatus('SoD: submitter holding approvals.approve cannot approve own submission', () => api('POST', `/approvals/${c4a.id}/actions`, T.combo, { action: 'approved' }), 403);
  await run('site engineer verifies', async () => must(await api('POST', `/subcontracts/certificates/${cert.id}/verify`, T.site), 'verify'));
  // Defect probe 4: lines must be frozen once verified.
  const late = await api('POST', `/subcontracts/certificates/${cert.id}/lines`, T.maker, { description: 'Late line', quantity_this_period: 1000, cumulative_quantity: 1000, unit_rate: 1000 });
  check('lines cannot be added after verification', late.status === 422, `HTTP ${late.status} ${JSON.stringify(late.body?.error ?? '')}`);
  await expectStatus('QS certify before verification refused (C2 draft)', () => api('POST', `/subcontracts/certificates/${bad.id}/qs-certify`, T.qs), 409);
  await run('QS lead certifies', async () => must(await api('POST', `/subcontracts/certificates/${cert.id}/qs-certify`, T.qs), 'qs'));
  const ca = await run('submit certificate for approval', async () => must(await api('POST', `/subcontracts/certificates/${cert.id}/submit-approval`, T.qs), 'csub').approval);
  const done = await run('approver approves certificate', async () => must(await api('POST', `/approvals/${ca.id}/actions`, T.appr, { action: 'approved', comment: 'sc cert' }), 'cappr'));
  const after = must(await api('GET', '/subcontracts/certificates', admin), 'certs').find(x => x.id === cert.id);
  check('certificate posted with a cost transaction', after.status === 'posted' && after.posted_cost_transaction_id, JSON.stringify({ s: after.status, ct: after.posted_cost_transaction_id }));
  const ct = must(await api('GET', '/cost-transactions', admin), 'cts').find(x => Number(x.id) === Number(after.posted_cost_transaction_id));
  // Records the posted basis; DEC-012 (owner) decides gross vs net. Not asserted as right or wrong.
  check('cost transaction recorded (basis per DEC-012)', !!ct, ct ? `amount=${ct.amount} gross=${after.gross_work_done} net=${after.net_amount_due}` : 'not found');
  await expectStatus('approved certificate cannot be re-submitted', () => api('POST', `/subcontracts/certificates/${cert.id}/submit-approval`, T.qs), 409);
  // CC-027: a returned certificate is released with a recorded reason and no cost is posted.
  const c4r = await run('approver returns certificate C4 with a reason', async () => must(await api('POST', `/approvals/${c4a.id}/actions`, T.appr, { action: 'returned', comment: 'Measurement sheet missing (fixture)' }), 'c4 return'));
  check('returned certificate released as rejected with reason, approver and time; no cost posted', c4r.finalization?.record?.status === 'rejected' && /Measurement sheet/.test(c4r.finalization.record.rejection_reason) && Number(c4r.finalization.record.rejected_by) > 0 && !c4r.finalization.record.posted_cost_transaction_id, JSON.stringify(c4r.finalization?.record ?? null).slice(0, 200));
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('wave1_subcontract_ipc');
