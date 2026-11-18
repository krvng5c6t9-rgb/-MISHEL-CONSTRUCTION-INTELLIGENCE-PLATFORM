import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Num, type Row } from '../components/RecordTable';

// CC-095 (Stage 66, MP-04 AG-04): the tender study agent. The company's own AI settings (ai_platform.manage), a study
// requested on a tender's documents (tendering.create), the draft result with each quote marked verified or not by
// the server, and the review by a person other than the requester (tendering.approve). Nothing here prices anything.
const STATUS: Record<string, MessageKey> = { queued: 'ts.statusQueued', running: 'ts.statusRunning', completed: 'ts.statusCompleted', failed: 'ts.statusFailed',
  refused: 'ts.statusRefused', approved: 'ts.statusApproved', rejected: 'ts.statusRejected' };
const DECISION: Record<string, MessageKey> = { go: 'ts.decisionGo', no_go: 'ts.decisionNoGo', needs_more_information: 'ts.decisionMore' };

export function TenderStudy() {
  const { t, tv } = useI18n();
  const [cfg, setCfg] = useState<any>(undefined), [models, setModels] = useState<string[]>([]), [form, setForm] = useState<any>({ model: 'claude-opus-5-5', api_key: '', data_processing_accepted: false, enabled: false });
  const [tenders, setTenders] = useState<Row[]>([]), [studies, setStudies] = useState<Row[]>([]), [open, setOpen] = useState<any>(null);
  const [req, setReq] = useState({ tender_id: '', documents: '', instructions: '' }), [note, setNote] = useState(''), [error, setError] = useState(''), [info, setInfo] = useState('');
  const loadStudies = () => apiGet<any>('/ai/tender-studies').then(r => setStudies(r.data));
  useEffect(() => {
    apiGet<any>('/ai/settings').then(r => { setCfg(r.data); setModels(r.models ?? []); if (r.data) setForm({ model: r.data.model, api_key: '', data_processing_accepted: r.data.data_processing_accepted, enabled: r.data.enabled }); }).catch(() => setCfg(null));
    apiGet<any>('/tendering/tenders').then(r => setTenders(r.data)).catch(e => setError(e.message));
    loadStudies().catch(e => setError(e.message));
  }, []);
  const run = async (fn: () => Promise<void>) => { try { setError(''); setInfo(''); await fn(); } catch (e: any) { setError(e.message); } };
  const saveCfg = () => run(async () => { const r = await apiPut<any>('/ai/settings', { provider: 'anthropic', ...form, api_key: form.api_key || undefined }); setCfg(r.data); setForm({ ...form, api_key: '' }); setInfo(t('ts.saved')); });
  const start = () => run(async () => { await apiPost('/ai/tender-studies', { tender_id: Number(req.tender_id), documents: req.documents, instructions: req.instructions || undefined }); setReq({ ...req, documents: '', instructions: '' }); setInfo(t('ts.started')); await loadStudies(); });
  const openStudy = (id: number) => run(async () => setOpen((await apiGet<any>(`/ai/tender-studies/${id}`)).data));
  const review = (decision: 'approved' | 'rejected') => run(async () => { const r = await apiPost<any>(`/ai/tender-studies/${open.id}/review`, { decision, note }); setOpen(r.data); setNote(''); await loadStudies(); });
  const loadFile = async (f?: File) => { if (f) setReq({ ...req, documents: await f.text() }); };
  const quote = (x: Row) => <div className={x.quote_verified ? 'quote-ok' : 'quote-bad'}><bdi>«{x.quote}»</bdi> — {t(x.quote_verified ? 'ts.verified' : 'ts.unverified')}</div>;
  const list = (k: MessageKey, rows: Row[] | undefined, sec: string) => <div data-section={sec}><h3>{t(k)}</h3>{rows?.length ? <ul>{rows.map((x, i) => <li key={i}><strong>{x.title ?? x.question}</strong>{x.severity && <> ({tv(x.severity)})</>}: {x.detail ?? x.description ?? x.reason}{x.mitigation && <> — {x.mitigation}</>}{quote(x)}</li>)}</ul> : <p>—</p>}</div>;
  const r = open?.result;

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('ts.eyebrow')}</p><h1>{t('ts.title')}</h1><p>{t('ts.intro')}</p></div></header>
    {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}
    {info && <div className="notice" role="status">{info}</div>}

    {cfg !== undefined && cfg !== null || models.length ? <div className="panel" data-section="ai-settings"><h2>{t('ts.settings')}</h2><p>{t('ts.settingsNote')}</p>
      {!cfg && <p className="muted">{t('ts.notSetUp')}</p>}
      <div className="form-grid">
        <label>{t('ts.model')}<select value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}>{models.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
        <label>{t('ts.key')}<input type="password" autoComplete="off" dir="ltr" value={form.api_key} placeholder={cfg ? t('ts.keyKept', { last4: cfg.api_key_last4 }) : ''} onChange={e => setForm({ ...form, api_key: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={form.data_processing_accepted} onChange={e => setForm({ ...form, data_processing_accepted: e.target.checked })} />{t('ts.accept')}</label>
        <label className="check"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />{t('ts.enabled')}</label>
      </div><button onClick={saveCfg}>{t('ts.save')}</button></div> : null}

    <div className="panel" data-section="request"><h2>{t('ts.request')}</h2>
      <div className="form-grid">
        <label>{t('ts.tender')}<select value={req.tender_id} onChange={e => setReq({ ...req, tender_id: e.target.value })}><option value="">{t('ts.choose')}</option>{tenders.map(x => <option key={x.id} value={x.id}>{x.tender_title}</option>)}</select></label>
        <label className="file-pick">{t('ts.file')}<input className="file-input" type="file" accept=".txt,.csv,.md,text/plain,text/csv" onChange={e => { loadFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>
      <label className="block-label">{t('ts.documents')}<textarea rows={8} value={req.documents} onChange={e => setReq({ ...req, documents: e.target.value })} /></label>
      <label className="block-label">{t('ts.instructions')}<input value={req.instructions} onChange={e => setReq({ ...req, instructions: e.target.value })} /></label>
      <button onClick={start} disabled={!req.tender_id || req.documents.trim().length < 50}>{t('ts.start')}</button></div>

    <div className="panel" data-section="studies"><h2>{t('ts.studies')}</h2>
      <div className="table-wrap"><table><thead><tr><th>{t('ts.colTender')}</th><th>{t('ts.colStatus')}</th><th>{t('ts.colQuotes')}</th><th>{t('ts.colBy')}</th><th>{t('ts.colDate')}</th><th></th></tr></thead>
        <tbody>{studies.map(s => <tr key={s.id} data-study={s.id}><td>{s.tender_title}</td><td>{t(STATUS[s.status])}</td><td>{s.quotes_checked != null ? <Num text={`${s.quotes_verified} / ${s.quotes_checked}`} /> : '—'}</td><td>{s.requested_by_name}</td><td><Num v={String(s.created_at).slice(0, 10)} /></td><td><button onClick={() => openStudy(s.id)}>{t('ts.open')}</button></td></tr>)}</tbody></table></div></div>

    {open && <div className="panel" data-section="study"><h2>{open.tender_title} — {t(STATUS[open.status])}</h2>
      {open.error && <p className="muted">{t('ts.error', { error: open.error })}</p>}
      {r && <>
        <h3>{t('ts.summary')}</h3><p>{r.summary}</p>
        <h3>{t('ts.recommendation')}</h3><p data-decision={r.recommendation.decision}><strong>{t(DECISION[r.recommendation.decision])}</strong>: {r.recommendation.reasons.join('؛ ')}</p>
        <h3>{t('ts.boq')}</h3><div className="table-wrap"><table><thead><tr><th>{t('ts.colRef')}</th><th>{t('ts.colDescription')}</th><th>{t('ts.colUnit')}</th><th>{t('ts.colQty')}</th><th>{t('ts.colObservation')}</th><th>{t('ts.colRisk')}</th><th>{t('ts.colQuote')}</th></tr></thead>
          <tbody>{r.boq_items.map((b: Row, i: number) => <tr key={i}><td><bdi>{b.item_ref}</bdi></td><td>{b.description}</td><td><bdi>{b.unit}</bdi></td><td><bdi>{b.quantity || '—'}</bdi></td><td>{b.observation}</td><td>{tv(b.risk_level)}</td><td>{quote(b)}</td></tr>)}</tbody></table></div>
        {list('ts.missing', r.missing_information, 'missing')}{list('ts.questions', r.clarification_questions, 'questions')}{list('ts.risks', r.risks, 'risks')}
        {list('ts.conditions', r.contract_conditions, 'conditions')}{list('ts.pricing', r.pricing_notes, 'pricing')}
      </>}
      {open.reviewed_by_name && <p className="muted">{t('ts.reviewedBy', { name: open.reviewed_by_name, note: open.review_note })}</p>}
      {open.status === 'completed' && <div className="form-row"><input aria-label={t('ts.reviewNote')} placeholder={t('ts.reviewNote')} value={note} onChange={e => setNote(e.target.value)} />
        <button disabled={note.trim().length < 5} onClick={() => review('approved')}>{t('ts.approve')}</button><button disabled={note.trim().length < 5} onClick={() => review('rejected')}>{t('ts.reject')}</button></div>}
    </div>}
  </section>;
}
