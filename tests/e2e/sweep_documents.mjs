// CC-085 / R1.5 first part (MP-03 §1 / §5, migration 092): printed documents. The client IPC and the subcontractor
// payment certificate are produced as a print view (HTML) and a PDF from records written by the earlier suites of this
// gate (picked by SQL); every figure checked here is read from the database as text. Each export is entered in
// document_exports with the SHA-256 of the returned bytes, and that entry cannot be changed or removed.
import { createHash } from 'node:crypto';
import { ADMIN, TAG, api, must, check, expectStatus, login, sql, finish } from './harness.mjs';
import { BASE } from './lib.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const one = (text) => { const r = sql(OWNER, text); if (!r.ok) throw new Error(r.out.slice(0, 300)); return r.out; };
const get = async (path, token) => {
  const res = await fetch(BASE + path, { headers: { authorization: `Bearer ${token}` } });
  const bytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get('content-type') ?? '', id: Number(res.headers.get('x-export-id')), sha: res.headers.get('x-export-sha256'), bytes, text: bytes.toString('utf8') };
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const grouped = (v) => v.replace(/^(-?)(\d+)/, (_, s, d) => s + d.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
const escHtml = (v) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, perms) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id: await mkRole(`DOC ${key}`, perms), full_name: `DOC ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const fin = await mkUser('docfin', [['finance', 'view']]), none = await mkUser('docnone', [['projects', 'view']]);

  // --- Client IPC: a final one (with recorded approval actions) and a draft one, from this gate's records.
  const [finalId, net, approverName] = one(`select i.id, i.net_amount_due::text, u.full_name from ipcs i join approval_actions_log l on l.approval_instance_id = i.approval_instance_id
    join users u on u.id = l.approver_id where i.org_id = ${ADMIN.org_id} and i.status <> 'draft' order by i.id limit 1`).split('|');
  const [draftId, draftNo] = one(`select id, ipc_no from ipcs where org_id = ${ADMIN.org_id} and status = 'draft' order by id limit 1`).split('|');
  const ipcNo = one(`select ipc_no from ipcs where id = ${finalId}`);
  const ar = await get(`/documents/ipc/${finalId}?format=html&lang=ar`, fin);
  check('IPC print view in Arabic: right-to-left page with the IPC number', ar.status === 200 && ar.type.startsWith('text/html') && ar.text.includes('<html lang="ar" dir="rtl">') && ar.text.includes(escHtml(ipcNo)),
    `HTTP ${ar.status} ${ar.type}`);
  check('IPC: the net amount due is the database value, grouped by thousands only', ar.text.includes(`>${grouped(net)}<`), `${net} -> ${grouped(net)}`);
  check('IPC: the approval block names the approver recorded by the workflow', ar.text.includes(escHtml(approverName)), approverName);
  check('IPC: a final IPC carries no DRAFT watermark', !ar.text.includes('class="watermark"'));
  const dr = await get(`/documents/ipc/${draftId}?format=html&lang=en`, fin);
  check('IPC: a draft IPC carries the DRAFT watermark and the draft note', dr.status === 200 && dr.text.includes('<div class="watermark">DRAFT</div>') && dr.text.includes('Draft - not approved') && dr.text.includes(escHtml(draftNo)),
    `HTTP ${dr.status}`);
  check('the export number printed on the document is the one returned', ar.text.includes(`<span class="num" dir="ltr">${ar.id}</span>`), String(ar.id));

  // --- The export entry: the SHA-256 of the exact bytes returned.
  check('X-Export-SHA256 is the SHA-256 of the returned bytes', ar.sha === sha(ar.bytes), `${ar.sha}`);
  const entry = must(await api('GET', `/documents/exports/${ar.id}`, fin), 'export entry');
  check('the export entry records the record, its status, language, format, size, hash and user',
    entry.doc_type === 'ipc' && Number(entry.record_id) === Number(finalId) && entry.is_draft === false && entry.lang === 'ar' && entry.format === 'html'
      && entry.sha256 === sha(ar.bytes) && Number(entry.size_bytes) === ar.bytes.length && entry.exported_by_name === `DOC docfin`, JSON.stringify(entry).slice(0, 300));
  const dEntry = must(await api('GET', `/documents/exports/${dr.id}`, fin), 'draft entry');
  check('the export entry of a draft is marked as a draft', dEntry.is_draft === true && dEntry.record_status === 'draft', JSON.stringify(dEntry).slice(0, 200));

  const pdf = await get(`/documents/ipc/${finalId}?format=pdf&lang=en`, fin);
  check('IPC PDF in English: a PDF file', pdf.status === 200 && pdf.type === 'application/pdf' && pdf.bytes.subarray(0, 5).toString() === '%PDF-', `HTTP ${pdf.status} ${pdf.type} ${pdf.bytes.length} bytes`);
  const pEntry = must(await api('GET', `/documents/exports/${pdf.id}`, fin), 'pdf entry');
  check('the PDF export entry holds the hash of the PDF bytes', pEntry.format === 'pdf' && pEntry.lang === 'en' && pEntry.sha256 === sha(pdf.bytes) && pdf.sha === pEntry.sha256);
  const list = must(await api('GET', `/documents/exports?type=ipc&record_id=${finalId}`, fin), 'list');
  check('the exports of a record are listed, newest first', list.length >= 2 && Number(list[0].id) === pdf.id && list.some(e => Number(e.id) === ar.id), list.map(e => e.id).join(','));

  // --- Subcontractor payment certificate.
  const [scFinal, scNo, scNet] = one(`select id, certificate_no, net_amount_due::text from subcontract_certificates where org_id = ${ADMIN.org_id} and status in ('approved', 'posted', 'paid') order by id limit 1`).split('|');
  const [scDraft] = one(`select id from subcontract_certificates where org_id = ${ADMIN.org_id} and status not in ('approved', 'posted', 'paid') order by id limit 1`).split('|');
  const sc = await get(`/documents/subcontract-certificate/${scFinal}?format=html&lang=ar`, admin);
  check('subcontract certificate (approved): number and net amount from the database, no watermark',
    sc.status === 200 && sc.text.includes(escHtml(scNo)) && sc.text.includes(`>${grouped(scNet)}<`) && !sc.text.includes('class="watermark"'), `HTTP ${sc.status} ${scNo} ${scNet}`);
  const scd = await get(`/documents/subcontract-certificate/${scDraft}?format=html&lang=ar`, admin);
  check('subcontract certificate not yet approved: DRAFT watermark (in Arabic)', scd.status === 200 && scd.text.includes('<div class="watermark">مسودة</div>'), `HTTP ${scd.status}`);

  // --- Refusals.
  await expectStatus('IPC document without finance.view is refused', async () => { const r = await get(`/documents/ipc/${finalId}`, none); return { status: r.status, body: JSON.parse(r.text) }; }, 403);
  await expectStatus('certificate document without contracts.view is refused (finance.view is not enough)', async () => { const r = await get(`/documents/subcontract-certificate/${scFinal}`, fin); return { status: r.status, body: JSON.parse(r.text) }; }, 403);
  await expectStatus('export list without the permission of the document is refused', () => api('GET', `/documents/exports?type=ipc&record_id=${finalId}`, none), 403);
  await expectStatus('verifying an export without the permission of its document is refused', () => api('GET', `/documents/exports/${ar.id}`, none), 403);
  const otherIpc = one(`select id from ipcs where org_id <> ${ADMIN.org_id} order by id limit 1`);
  await expectStatus('an IPC of another company is not found', async () => { const r = await get(`/documents/ipc/${otherIpc}`, admin); return { status: r.status, body: JSON.parse(r.text) }; }, 404);
  await expectStatus('an unknown document type is not found', async () => { const r = await get(`/documents/purchase-order/${finalId}`, admin); return { status: r.status, body: JSON.parse(r.text) }; }, 404);
  await expectStatus('an unknown language is refused', async () => { const r = await get(`/documents/ipc/${finalId}?lang=fr`, admin); return { status: r.status, body: JSON.parse(r.text) }; }, 400);
  check('a refused request leaves no export entry', Number(one(`select count(*) from document_exports where exported_by = (select id from users where email = 'docnone.${TAG}@test.local')`)) === 0);

  // --- Permanence (database rule, also for the table owner).
  const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok && /permanent|Only the hash/.test(r.out), r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 160)); };
  probe('DB: an export entry cannot be deleted', `delete from document_exports where id = ${ar.id}`);
  probe('DB: the hash of an export entry cannot be replaced', `update document_exports set sha256 = repeat('0', 64) where id = ${ar.id}`);
  probe('DB: the record of an export entry cannot be changed', `update document_exports set record_id = record_id + 1 where id = ${ar.id}`);
  check('DB: the entry is unchanged after the refused writes', one(`select sha256 from document_exports where id = ${ar.id}`) === sha(ar.bytes));
} catch (e) {
  check('suite completed', false, e.message.slice(0, 300));
}
finish('sweep_documents');
