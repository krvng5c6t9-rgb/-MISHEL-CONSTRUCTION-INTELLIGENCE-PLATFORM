// CC-085 / R1.5 first part (MP-03 §1 / §5, migration 092): printed documents. The client IPC and the subcontractor
// payment certificate are produced as a print view (HTML) and a PDF from records written by the earlier suites of this
// gate (picked by SQL); every figure checked here is read from the database as text. Each export is entered in
// document_exports with the SHA-256 of the returned bytes, and that entry cannot be changed or removed. CC-086 adds the
// purchase order, goods received note, payment / receipt voucher, journal voucher and daily diary; the Arabic print
// views are kept in out/ for review.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
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

  // --- CC-086: purchase order, goods received note, payment / receipt voucher, journal voucher, daily diary.
  const keep = (name, r) => writeFileSync(new URL(`./out/doc_${name}_${TAG}.html`, import.meta.url), r.bytes);
  const entryOf = async (r) => must(await api('GET', `/documents/exports/${r.id}`, admin), 'entry');
  const noMark = (r) => !r.text.includes('class="watermark"');
  const [poId, poRef, poTotal, poLine, poApprover] = one(`select po.id, po.po_ref, po.total_amount::text, (select item_description from po_lines where po_id = po.id order by id limit 1), u.full_name
    from purchase_orders po join approval_actions_log l on l.approval_instance_id = po.approval_instance_id join users u on u.id = l.approver_id
    where po.org_id = ${ADMIN.org_id} and po.status in ('approved', 'issued', 'partially_delivered', 'closed') order by po.id limit 1`).split('|');
  const po = await get(`/documents/purchase-order/${poId}?format=html&lang=ar`, admin); keep('po', po);
  check('purchase order (Arabic): number, total as the database text grouped, a line and the approver from the workflow, no watermark',
    po.status === 200 && po.text.includes('dir="rtl"') && po.text.includes(escHtml(poRef)) && po.text.includes(`>${grouped(poTotal)}<`) && po.text.includes(escHtml(poLine))
      && po.text.includes(escHtml(poApprover)) && po.text.includes('أمر شراء') && noMark(po), `HTTP ${po.status} ${poRef} ${poTotal}`);
  const poPdf = await get(`/documents/purchase-order/${poId}?format=pdf&lang=en`, admin);
  check('purchase order PDF in English', poPdf.status === 200 && poPdf.bytes.subarray(0, 5).toString() === '%PDF-' && poPdf.sha === sha(poPdf.bytes), `HTTP ${poPdf.status}`);
  check('the purchase order export entry is typed purchase_order', (await entryOf(po)).doc_type === 'purchase_order');

  const [grnId, grnNo, grnPo, grnAccepted, grnBy] = one(`select g.id, g.grn_no, po.po_ref, l.quantity_accepted::text, u.full_name from goods_receipt_notes g join purchase_orders po on po.id = g.po_id
    join grn_lines l on l.grn_id = g.id join users u on u.id = g.received_by where g.org_id = ${ADMIN.org_id} and g.status = 'confirmed' order by g.id, l.id limit 1`).split('|');
  const grn = await get(`/documents/goods-receipt/${grnId}?format=html&lang=ar`, admin); keep('grn', grn);
  check('goods received note (confirmed): number, its purchase order, accepted quantity and the receiver, no watermark',
    grn.status === 200 && grn.text.includes(escHtml(grnNo)) && grn.text.includes(escHtml(grnPo)) && grn.text.includes(`>${grouped(grnAccepted)}<`) && grn.text.includes(escHtml(grnBy)) && noMark(grn),
    `HTTP ${grn.status} ${grnNo} ${grnAccepted}`);
  check('the goods received note export entry is typed goods_receipt', (await entryOf(grn)).doc_type === 'goods_receipt');

  const [pvId, pvAmount, pvPayee] = one(`select y.id, y.amount::text, v.vendor_name from payments y join vendors_subcontractors v on v.id = y.party_id
    where y.org_id = ${ADMIN.org_id} and y.payment_type = 'outgoing' and y.status = 'posted' order by y.id limit 1`).split('|');
  const pv = await get(`/documents/payment-voucher/${pvId}?format=html&lang=ar`, fin); keep('pv', pv);
  check('payment voucher (posted, Arabic): titled as a payment voucher, amount as the database text grouped, the payee, no watermark',
    pv.status === 200 && pv.text.includes('سند صرف') && !pv.text.includes('سند قبض') && pv.text.includes(`>${grouped(pvAmount)}<`) && pv.text.includes(escHtml(pvPayee)) && noMark(pv), `HTTP ${pv.status} ${pvAmount}`);
  check('the payment voucher export entry is typed payment', (await entryOf(pv)).doc_type === 'payment');
  const [rvId, rvWithheld, rvCert] = one(`select id, withheld_tax_amount::text, coalesce(withholding_certificate_ref, '') from payments where org_id = ${ADMIN.org_id} and payment_type = 'incoming' and withheld_tax_amount > 0 order by id limit 1`).split('|');
  const rv = await get(`/documents/payment-voucher/${rvId}?format=html&lang=en`, fin); keep('rv', rv);
  check('receipt voucher (English): titled as a receipt voucher, with the tax withheld by the payer and its certificate',
    rv.status === 200 && rv.text.includes('Receipt Voucher') && rv.text.includes('Tax withheld by the payer') && rv.text.includes(`>${grouped(rvWithheld)}<`) && (!rvCert || rv.text.includes(escHtml(rvCert))),
    `HTTP ${rv.status} ${rvWithheld} ${rvCert}`);
  const draftPay = one(`select id from payments where org_id = ${ADMIN.org_id} and status = 'draft' order by id limit 1`);
  const dpv = await get(`/documents/payment-voucher/${draftPay}?format=html&lang=en`, fin);
  check('a payment not yet approved is printed with the DRAFT watermark', dpv.status === 200 && dpv.text.includes('<div class="watermark">DRAFT</div>'), `HTTP ${dpv.status}`);

  const mjPosted = one(`select id from manual_journal_entries where org_id = ${ADMIN.org_id} and status = 'posted' order by id limit 1`);
  const mjLines = one(`select a.account_code || '~' || l.debit::text || '~' || l.credit::text from manual_journal_entry_lines l join chart_of_accounts a on a.id = l.account_id where l.journal_entry_id = ${mjPosted} order by l.id`).split('\n');
  const mjTotals = one(`select sum(debit)::text || '~' || sum(credit)::text from manual_journal_entry_lines where journal_entry_id = ${mjPosted} group by currency_id`).split('\n');
  const jv = await get(`/documents/journal-voucher/${mjPosted}?format=html&lang=ar`, fin); keep('jv', jv);
  check('journal voucher (posted): every line with its account, debit and credit as stored, no watermark',
    jv.status === 200 && jv.text.includes('قيد يومية') && mjLines.every(l => { const [acc, dr, cr] = l.split('~'); return jv.text.includes(escHtml(acc)) && jv.text.includes(`>${grouped(dr)}<`) && jv.text.includes(`>${grouped(cr)}<`); }) && noMark(jv),
    `HTTP ${jv.status} ${mjLines.join(' ')}`);
  check('journal voucher: totals per currency are the database sums of the lines', mjTotals.every(t => { const [dr, cr] = t.split('~'); return jv.text.includes(`<td class="amount"><span class="num" dir="ltr">${grouped(dr)}</span></td><td class="amount"><span class="num" dir="ltr">${grouped(cr)}</span></td></tr>`); }),
    mjTotals.join(' '));
  const mjOpen = one(`select id from manual_journal_entries where org_id = ${ADMIN.org_id} and status in ('draft', 'pending_approval') order by id limit 1`);
  const djv = await get(`/documents/journal-voucher/${mjOpen}?format=html&lang=ar`, fin);
  check('a journal not yet approved is printed with the DRAFT watermark (Arabic)', djv.status === 200 && djv.text.includes('<div class="watermark">مسودة</div>'), `HTTP ${djv.status}`);

  const [dySigned, dySigner, dyNote] = one(`select s.id, u.full_name, coalesce((select note from site_diary_amendments where diary_id = s.id order by id limit 1), '') from site_diary s join users u on u.id = s.signed_by
    where s.org_id = ${ADMIN.org_id} and s.status = 'signed' order by s.id limit 1`).split('|');
  const dy = await get(`/documents/daily-diary/${dySigned}?format=html&lang=ar`, admin); keep('diary', dy);
  check('daily diary (signed): the signer from the record and the amendments after signing, no watermark',
    dy.status === 200 && dy.text.includes('اليومية الموقعية') && dy.text.includes(escHtml(dySigner)) && (!dyNote || dy.text.includes(escHtml(dyNote))) && noMark(dy), `HTTP ${dy.status} ${dySigner}`);
  const dyDate = one(`select diary_date::text from site_diary where id = ${dySigned}`);
  check('the number after a document title is isolated left-to-right (the diary date read reversed in Arabic before)', dy.text.includes(`اليومية الموقعية <span class="num" dir="ltr">${dyDate}</span></h1>`), dyDate);
  const dyDraft = one(`select id from site_diary where org_id = ${ADMIN.org_id} and status = 'draft' order by id limit 1`);
  const ddy = await get(`/documents/daily-diary/${dyDraft}?format=html&lang=en`, admin);
  check('a diary not yet signed is printed with the DRAFT watermark', ddy.status === 200 && ddy.text.includes('<div class="watermark">DRAFT</div>'), `HTTP ${ddy.status}`);

  const scRejected = one(`select id from subcontract_certificates where org_id = ${ADMIN.org_id} and status = 'rejected' order by id limit 1`);
  const rsc = await get(`/documents/subcontract-certificate/${scRejected}?format=html&lang=ar`, admin);
  check('a rejected certificate is marked NOT VALID, not DRAFT (CC-086)', rsc.status === 200 && rsc.text.includes('<div class="watermark">غير سارٍ</div>') && !rsc.text.includes('<div class="watermark">مسودة</div>'), `HTTP ${rsc.status}`);
  await expectStatus('purchase order without procurement.view is refused', async () => { const r = await get(`/documents/purchase-order/${poId}`, fin); return { status: r.status, body: JSON.parse(r.text) }; }, 403);
  await expectStatus('goods received note without procurement.view is refused', async () => { const r = await get(`/documents/goods-receipt/${grnId}`, fin); return { status: r.status, body: JSON.parse(r.text) }; }, 403);
  await expectStatus('daily diary without site.view is refused', async () => { const r = await get(`/documents/daily-diary/${dySigned}`, fin); return { status: r.status, body: JSON.parse(r.text) }; }, 403);
  await expectStatus('journal voucher without finance.view is refused', async () => { const r = await get(`/documents/journal-voucher/${mjPosted}`, none); return { status: r.status, body: JSON.parse(r.text) }; }, 403);

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
