import { useState } from 'react';
import jsQR from 'jsqr';
import { apiPost } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';

// CC-090 (Stage 60, MP-03 §5): verification of a copy of an exported document, by its QR code (text pasted or typed by
// a handheld scanner, or read on this device from a photo), by the export number printed on it, or - for a digital
// copy - by the SHA-256 of the file computed on this device (the file itself is never sent). The server compares with
// the permanent export entry and says whether the record has changed since (POST /documents/verify). The browser's own
// file-picker text follows the browser's language, not the application's, so the native control is hidden and its
// label, in the application's language, is the button.
const DOC_NAME: Record<string, MessageKey> = { ipc: 'admin.docIpc', subcontract_certificate: 'admin.docSubcontractCertificate', purchase_order: 'admin.docPurchaseOrder',
  goods_receipt: 'admin.docGoodsReceipt', payment: 'admin.docPayment', manual_journal: 'admin.docManualJournal', site_diary: 'admin.docSiteDiary' };
const CLASS_NAME: Record<string, MessageKey> = { public: 'admin.classPublic', internal: 'admin.classInternal', confidential: 'admin.classConfidential', restricted: 'admin.classRestricted' };

// Reads a QR code from an image file on this device (large photos are scaled down to at most 1600 px first).
async function readQr(file: File): Promise<string | null> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
  return jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
}
async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function VerifyDocument() {
  const { t, tv } = useI18n();
  const [qr, setQr] = useState(''), [expNo, setExpNo] = useState(''), [error, setError] = useState(''), [res, setRes] = useState<any>(null), [busy, setBusy] = useState(false);

  async function verify(body: Record<string, unknown>) {
    try { setBusy(true); setError(''); setRes(null); setRes((await apiPost<any>('/documents/verify', body)).data); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function fromPhoto(file?: File) {
    if (!file) return;
    try { setError(''); setRes(null); const text = await readQr(file); if (!text) { setError(t('verify.noCode')); return; } setQr(text); await verify({ payload: text }); }
    catch (e: any) { setError(e.message); }
  }
  async function fromFile(file?: File) {
    if (!file) return;
    try { setError(''); setRes(null); await verify({ sha256: await sha256Hex(file) }); } catch (e: any) { setError(e.message); }
  }

  const e = res?.export;
  const genuine = res && (res.method !== 'qr' || res.matches_entry === true);
  const headline = !res ? '' : res.method === 'qr' ? t(res.matches_entry ? 'verify.okQr' : 'verify.badQr', { id: e.id })
    : res.method === 'file' ? t('verify.okFile', { id: e.id }) : t('verify.okNumber', { id: e.id });

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('verify.eyebrow')}</p><h1>{t('verify.title')}</h1><p>{t('verify.intro')}</p></div></header>
    {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}

    <div className="panel" data-section="by-qr"><h2>{t('verify.byQr')}</h2><p>{t('verify.byQrNote')}</p>
      <div className="form-row">
        <input aria-label={t('verify.qrText')} placeholder={t('verify.qrText')} value={qr} dir="ltr" onChange={x => setQr(x.target.value)} onKeyDown={x => { if (x.key === 'Enter' && qr.trim()) verify({ payload: qr.trim() }); }} />
        <button disabled={busy || !qr.trim()} onClick={() => verify({ payload: qr.trim() })}>{t('verify.check')}</button>
        <label className="file-pick">{t('verify.qrPhoto')}<input className="file-input" type="file" accept="image/*" aria-label={t('verify.qrPhoto')} onChange={x => { fromPhoto(x.target.files?.[0]); x.target.value = ''; }} /></label>
      </div></div>

    <div className="panel" data-section="by-number"><h2>{t('verify.byNumber')}</h2><p>{t('verify.byNumberNote')}</p>
      <div className="form-row">
        <input type="number" min="1" aria-label={t('verify.exportNo')} placeholder={t('verify.exportNo')} value={expNo} dir="ltr" onChange={x => setExpNo(x.target.value)} />
        <button disabled={busy || !/^\d+$/.test(expNo)} onClick={() => verify({ export_id: Number(expNo) })}>{t('verify.check')}</button>
      </div></div>

    <div className="panel" data-section="by-file"><h2>{t('verify.byFile')}</h2><p>{t('verify.byFileNote')}</p>
      <div className="form-row"><label className="file-pick">{t('verify.file')}<input className="file-input" type="file" accept=".pdf,.html,application/pdf,text/html" aria-label={t('verify.file')} onChange={x => { fromFile(x.target.files?.[0]); x.target.value = ''; }} /></label></div></div>

    {res && <div className="panel" data-section="result" data-genuine={genuine ? 'yes' : 'no'}><h2>{t('verify.result')}</h2>
      <div className={`verdict ${genuine ? 'ok' : 'bad'}`} role="status" data-verdict>{headline}</div>
      {genuine && <ul className="verdict-notes">
        {e.is_draft && <li>{t('verify.draftCopy')}</li>}
        {!res.record_exists ? <li>{t('verify.noRecord')}</li> : <>
          {res.status_changed && <li data-changed="status">{t('verify.changedStatus', { status: tv(res.current_status) })}</li>}
          {res.amount_changed && <li data-changed="amount">{t('verify.changedAmount')}</li>}
          {!res.status_changed && !res.amount_changed && <li>{t('verify.unchanged')}</li>}</>}
      </ul>}
      <div className="table-wrap"><table className="meta"><tbody>
        <tr><th>{t('verify.rowDocument')}</th><td>{DOC_NAME[e.doc_type] ? t(DOC_NAME[e.doc_type]) : e.doc_type}</td></tr>
        <tr><th>{t('verify.rowRecord')}</th><td><span dir="ltr">#{e.record_id}</span></td></tr>
        <tr><th>{t('verify.rowStatusThen')}</th><td>{tv(e.record_status)}</td></tr>
        <tr><th>{t('verify.rowStatusNow')}</th><td>{res.current_status ? tv(res.current_status) : '—'}</td></tr>
        <tr><th>{t('verify.rowExport')}</th><td><span dir="ltr">#{e.id} · {String(e.exported_at).replace('T', ' ').slice(0, 16)} UTC</span></td></tr>
        <tr><th>{t('verify.rowBy')}</th><td>{e.exported_by_name}</td></tr>
        <tr><th>{t('verify.rowLang')}</th><td>{t(e.lang === 'ar' ? 'verify.langAr' : 'verify.langEn')} / <span dir="ltr">{String(e.format).toUpperCase()}</span></td></tr>
        <tr><th>{t('verify.rowClass')}</th><td>{e.classification && CLASS_NAME[e.classification] ? t(CLASS_NAME[e.classification]) : '—'}</td></tr>
        <tr><th>{t('verify.rowSha')}</th><td><code dir="ltr" className="sha">{e.sha256 ?? '—'}</code></td></tr>
      </tbody></table></div>
    </div>}
  </section>;
}
