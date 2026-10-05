// RK-003 sweep / GC-03 EDMS: controlled documents, revisions, review and transmittals - first runtime execution.
// Users hold all EDMS permissions so that only integrity and segregation-of-duties rules can stop them. TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const sha = (c) => c.repeat(64);
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `ED ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const all = await mkRole('EDMS All', [['edms', 'view'], ['edms', 'create'], ['edms', 'edit'], ['edms', 'approve']]);
  const D = { a: await mkUser('eda', all), b: await mkUser('edb', all) };
  const project = must(await api('POST', '/projects', admin, { project_code: `ED-${TAG}`, project_name: `ED ${TAG}`, currency_id: 1 }), 'project').id;
  const doc = (tok, no, extra = {}) => api('POST', '/edms/documents', tok, { project_id: project, doc_number: no, file_name: `${no}.pdf`, storage_key: `s3://fixture/${no}/1`, revision: 'A', sha256: sha('a'), ...extra });

  // --- Register and numbering.
  const d1 = await run('engineer A registers drawing DWG-001 rev A', async () => must(await doc(D.a, `DWG-001-${TAG}`), 'd1'));
  await expectStatus('duplicate document number in the same project refused', () => doc(D.a, `DWG-001-${TAG}`), 409);

  // --- Review: maker/checker, reason on rejection, reviewer recorded on the version.
  await expectStatus('review of a document not submitted refused', () => api('POST', `/edms/documents/${d1.id}/review`, D.b, { action: 'approved' }), 409);
  must(await api('POST', `/edms/documents/${d1.id}/submit`, D.a), 'submit');
  await expectStatus('revision while under review refused', () => api('POST', `/edms/documents/${d1.id}/versions`, D.a, { file_name: 'x.pdf', storage_key: 's3://fixture/x', revision: 'B' }), 409);
  await expectStatus('maker cannot approve own document (SoD)', () => api('POST', `/edms/documents/${d1.id}/review`, D.a, { action: 'approved' }), 403);
  await expectStatus('rejection without a reason refused', () => api('POST', `/edms/documents/${d1.id}/review`, D.b, { action: 'rejected' }), 400);
  const rev = await run('reviewer B approves rev A', async () => must(await api('POST', `/edms/documents/${d1.id}/review`, D.b, { action: 'approved', comment: 'Approved for construction (fixture)' }), 'approve'));
  check('document approved', rev.status === 'approved');
  const vers = must(await api('GET', `/edms/documents/${d1.id}/versions`, D.a), 'versions');
  check('approval recorded on version 1 with reviewer and time', vers[0]?.review_status === 'approved' && Number(vers[0]?.reviewed_by) > 0 && !!vers[0]?.reviewed_at, JSON.stringify(vers[0] ?? null).slice(0, 200));
  await expectStatus('missing document returns 404 (not 500)', () => api('POST', '/edms/documents/999999999/versions', D.a, { file_name: 'x.pdf', storage_key: 's3://fixture/x' }), 404);

  // --- Transmittals: approved, current versions only for construction.
  const t1 = must(await api('POST', '/edms/transmittals', D.a, { project_id: project, transmittal_no: `TR-1-${TAG}`, to_party: 'Site (fixture)', purpose: 'for_construction' }), 't1');
  must(await api('POST', `/edms/transmittals/${t1.id}/lines`, D.a, { document_id: d1.id }), 'line');
  await expectStatus('maker cannot issue own transmittal (SoD)', () => api('POST', `/edms/transmittals/${t1.id}/issue`, D.a), 403);
  // Rev B uploaded (not yet approved) after the line was added: the line still points at approved rev A, which is no longer current.
  must(await api('POST', `/edms/documents/${d1.id}/versions`, D.a, { file_name: 'DWG-001-B.pdf', storage_key: `s3://fixture/DWG-001-${TAG}/2`, revision: 'B', sha256: sha('b') }), 'rev B');
  await expectStatus('superseded revision cannot be issued for construction', () => api('POST', `/edms/transmittals/${t1.id}/issue`, D.b), 422);
  const d2 = must(await doc(D.a, `DWG-002-${TAG}`), 'd2');
  const t2 = must(await api('POST', '/edms/transmittals', D.a, { project_id: project, transmittal_no: `TR-2-${TAG}`, to_party: 'Site (fixture)', purpose: 'for_construction' }), 't2');
  must(await api('POST', `/edms/transmittals/${t2.id}/lines`, D.a, { document_id: d2.id }), 't2 line');
  await expectStatus('unapproved drawing cannot be issued for construction', () => api('POST', `/edms/transmittals/${t2.id}/issue`, D.b), 422);
  const t3 = must(await api('POST', '/edms/transmittals', D.a, { project_id: project, transmittal_no: `TR-3-${TAG}`, to_party: 'Engineer (fixture)', purpose: 'for_approval' }), 't3');
  must(await api('POST', `/edms/transmittals/${t3.id}/lines`, D.a, { document_id: d2.id }), 't3 line');
  const iss = await run('unapproved drawing may be issued FOR APPROVAL', async () => must(await api('POST', `/edms/transmittals/${t3.id}/issue`, D.b), 'issue t3'));
  check('issued transmittal records issuer', iss.status === 'issued' && Number(iss.issued_by) > 0);
  await expectStatus('empty transmittal cannot be issued', async () => api('POST', `/edms/transmittals/${must(await api('POST', '/edms/transmittals', D.a, { project_id: project, transmittal_no: `TR-4-${TAG}`, purpose: 'for_information' }), 't4').id}/issue`, D.b), 422);
  await expectStatus('lines cannot be added to an issued transmittal', () => api('POST', `/edms/transmittals/${t3.id}/lines`, D.a, { document_id: d1.id }), 422);

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: approved version file cannot be swapped', `update document_versions set storage_key='s3://evil/replaced', sha256='${sha('e')}' where document_id=${d1.id} and version_no=1`);
    probe('DB: document versions cannot be deleted', `delete from document_versions where document_id=${d1.id} and version_no=1`);
    probe('DB: review decision on a version cannot be rewritten', `update document_versions set review_status='rejected' where document_id=${d1.id} and version_no=1`);
    probe('DB: issued transmittal header immutable', `update document_transmittals set to_party='someone else', issue_date=issue_date-30 where id=${t3.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot review tenant A document', () => api('POST', `/edms/documents/${d2.id}/review`, tb, { action: 'approved' }), 404);
  await expectStatus('tenant B cannot add a version to tenant A document', () => api('POST', `/edms/documents/${d1.id}/versions`, tb, { file_name: 'x.pdf', storage_key: 's3://x' }), 404);
  const listB = must(await api('GET', '/edms/documents', tb), 'docs B');
  check('tenant B does not see tenant A documents', !listB.some(x => Number(x.id) === Number(d1.id)));
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_edms');
