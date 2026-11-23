import { useEffect, useState } from 'react';
import { API_BASE_URL, apiGet, getToken } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { translateServerMessage } from '../lib/serverMessages';
import { ReferenceSelect } from '../components/ReferenceSelect';
import { Num, type Row } from '../components/RecordTable';

// CC-098 (Stage 69; migration 103): Excel (.xlsx) template, export and import per record type. The server checks each
// row with the screens' rules; this screen shows what it read and refused before anything is saved.
const NAME: Record<string, MessageKey> = { clients: 'dx.entClients', vendors: 'dx.entVendors', cost_codes: 'dx.entCostCodes', boq: 'dx.entBoq' };
async function raw(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) { const j = await res.json().catch(() => null); const e: any = new Error(translateServerMessage(j?.error ?? `HTTP ${res.status}`, [])); e.details = j?.details; throw e; }
  return res;
}

export function DataExchange() {
  const { t } = useI18n();
  const [ents, setEnts] = useState<Row[]>([]), [hist, setHist] = useState<Row[]>([]), [proj, setProj] = useState(''), [error, setError] = useState('');
  const [files, setFiles] = useState<Record<string, File | null>>({}), [result, setResult] = useState<Record<string, any>>({}), [done, setDone] = useState('');
  const load = async () => { setEnts((await apiGet<any>('/data-exchange/entities')).data); setHist((await apiGet<any>('/data-exchange/imports')).data); };
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  const scope = (e: Row) => (e.scoped ? `project_id=${proj}` : '');
  const q = (e: Row, extra: string) => [scope(e), extra].filter(Boolean).join('&');
  async function download(e: Row, kind: 'template' | 'export') {
    try { setError('');
      const r = await raw(`/data-exchange/${e.entity}/${kind}${kind === 'export' && e.scoped ? `?${scope(e)}` : ''}`);
      const url = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = url; a.download = `${e.entity}-${kind}.xlsx`; a.click(); URL.revokeObjectURL(url);
    } catch (err: any) { setError(err.message); }
  }
  async function send(e: Row, dry: boolean) {
    const f = files[e.entity]; if (!f) return;
    try { setError(''); setDone('');
      const r = await raw(`/data-exchange/${e.entity}/import?${q(e, `file_name=${encodeURIComponent(f.name)}${dry ? '&dry_run=1' : ''}`)}`, { method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: await f.arrayBuffer() });
      setResult({ ...result, [e.entity]: (await r.json()).data });
      if (!dry) { setDone(e.entity); setFiles({ ...files, [e.entity]: null }); await load(); }
    } catch (err: any) { setError(err.message); if (err.details) setResult({ ...result, [e.entity]: err.details }); }
  }

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('dx.eyebrow')}</p><h1>{t('dx.title')}</h1><p>{t('dx.intro')}</p></div></header>
    {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}
    {!ents.length && <p>{t('dx.noAccess')}</p>}
    {ents.map(e => { const r = result[e.entity], needProj = e.scoped && !proj;
      return <div className="panel" key={e.entity} data-entity={e.entity}><h2>{t(NAME[e.entity])}</h2>
        {e.scoped && <div className="form-grid"><label>{t('dx.project')}<ReferenceSelect kind="projects" value={proj} onChange={setProj} placeholder={t('dx.choose')} /></label></div>}
        <div className="form-row"><button onClick={() => download(e, 'template')}>{t('dx.template')}</button>
          {e.can_export && <button disabled={needProj} onClick={() => download(e, 'export')}>{t('dx.export')}</button>}</div>
        {e.can_import && <div className="form-row">
          <label>{t('dx.file')}<input type="file" accept=".xlsx" onChange={ev => { setFiles({ ...files, [e.entity]: ev.target.files?.[0] ?? null }); setResult({ ...result, [e.entity]: null }); }} /></label>
          <button disabled={!files[e.entity] || needProj} onClick={() => send(e, true)}>{t('dx.read')}</button>
          <button disabled={!files[e.entity] || needProj || !r || r.saved || r.errors?.length > 0} onClick={() => send(e, false)}>{t('dx.import')}</button></div>}
        {done === e.entity && <p className="muted" role="status">{t('dx.imported')}</p>}
        {r && <div data-section="result"><p>{t('dx.rows')}: <Num v={r.rows} /> · {t('dx.accepted')}: <Num v={r.accepted} />{r.unknown_columns?.length > 0 && <> · {t('dx.unknown')}: <bdi>{r.unknown_columns.join(', ')}</bdi></>}</p>
          {r.errors?.length > 0 && <><h3>{t('dx.refused')}</h3><div className="table-wrap"><table><thead><tr><th>{t('dx.row')}</th><th>{t('dx.reason')}</th></tr></thead>
            <tbody>{r.errors.map((x: Row) => <tr key={x.row}><td><Num v={x.row} /></td><td><bdi>{x.error}</bdi></td></tr>)}</tbody></table></div></>}</div>}
      </div>; })}
    <div className="panel" data-section="history"><h2>{t('dx.history')}</h2>
      {hist.length ? <div className="table-wrap"><table><thead><tr><th>{t('dx.colType')}</th><th>{t('dx.colFile')}</th><th>{t('dx.rows')}</th><th>{t('dx.colBy')}</th><th>{t('dx.colWhen')}</th></tr></thead>
        <tbody>{hist.map(h => <tr key={h.id}><td>{t(NAME[h.entity])}</td><td><bdi>{h.file_name}</bdi></td><td><Num v={h.rows_count} /></td><td>{h.imported_by_name}</td><td><bdi>{String(h.created_at).slice(0, 10)}</bdi></td></tr>)}</tbody></table></div> : <p>{t('dx.noneYet')}</p>}</div>
  </section>;
}
