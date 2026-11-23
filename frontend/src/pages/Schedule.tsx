import { useEffect, useState } from 'react';
import { API_BASE_URL, apiDelete, apiGet, apiPost, apiPut, getToken } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { translateServerMessage } from '../lib/serverMessages';
import { ReferenceSelect } from '../components/ReferenceSelect';
import { Num, type Row } from '../components/RecordTable';

// CC-097 (Stage 68; migration 102): work calendars, the dated critical path schedule of a project, and exchange with
// Primavera P6 (XER) and Microsoft Project (XML). Dates, floats and the critical path come from the server.
const DAYS: MessageKey[] = ['sc.daySun', 'sc.dayMon', 'sc.dayTue', 'sc.dayWed', 'sc.dayThu', 'sc.dayFri', 'sc.daySat'];
const dayNo = (s: string) => Math.round(new Date(`${s}T00:00:00Z`).getTime() / 86400000);

async function raw(path: string, init: RequestInit) {
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(translateServerMessage(j?.error ?? `HTTP ${res.status}`, [])); }
  return res;
}

export function Schedule() {
  const { t } = useI18n();
  const [cals, setCals] = useState<Row[]>([]), [projectId, setProjectId] = useState(''), [settings, setSettings] = useState({ calendar_id: '', data_date: '' });
  const [cal, setCal] = useState({ name: '', work_days: [0, 1, 2, 3, 4] as number[], hours_per_day: '8' }), [hol, setHol] = useState<Record<string, { date: string; desc: string }>>({});
  const [fmt, setFmt] = useState<'xer' | 'mspdi'>('xer'), [file, setFile] = useState<{ name: string; text: string } | null>(null), [preview, setPreview] = useState<any>(null);
  const [sch, setSch] = useState<any>(null), [hist, setHist] = useState<Row[]>([]), [error, setError] = useState(''), [note, setNote] = useState('');
  const loadCals = async () => setCals((await apiGet<any>('/planning/calendars')).data);
  useEffect(() => { loadCals().catch(e => setError(e.message)); }, []);
  async function act(fn: () => Promise<any>) { try { setError(''); setNote(''); await fn(); } catch (e: any) { setError(e.message); } }
  async function loadProject(id: string) {
    setSch(null); setPreview(null); setHist([]);
    if (!id) return;
    const s = (await apiGet<any>(`/planning/projects/${id}/schedule-settings`)).data;
    setSettings({ calendar_id: s ? String(s.calendar_id) : '', data_date: s?.data_date ?? '' });
    setHist((await apiGet<any>(`/planning/projects/${id}/imports`)).data);
    if (s) setSch((await apiGet<any>(`/planning/projects/${id}/schedule`)).data);
  }
  useEffect(() => { act(() => loadProject(projectId)); }, [projectId]);
  const toggleDay = (d: number) => setCal({ ...cal, work_days: cal.work_days.includes(d) ? cal.work_days.filter(x => x !== d) : [...cal.work_days, d].sort() });
  const addCal = () => act(async () => { await apiPost('/planning/calendars', { name: cal.name, work_days: cal.work_days, hours_per_day: Number(cal.hours_per_day) }); setCal({ ...cal, name: '' }); await loadCals(); });
  const addHol = (c: Row) => act(async () => { const h = hol[c.id]; await apiPost(`/planning/calendars/${c.id}/holidays`, { holiday_date: h.date, description: h.desc }); setHol({ ...hol, [c.id]: { date: '', desc: '' } }); await loadCals(); if (projectId) await loadProject(projectId); });
  const delHol = (c: Row, h: Row) => act(async () => { await apiDelete(`/planning/calendars/${c.id}/holidays/${h.id}`); await loadCals(); if (projectId) await loadProject(projectId); });
  const saveSettings = () => act(async () => { await apiPut(`/planning/projects/${projectId}/schedule-settings`, { calendar_id: Number(settings.calendar_id), data_date: settings.data_date }); setNote(t('sc.saved')); await loadProject(projectId); });
  const send = (dry: boolean) => act(async () => {
    if (!file) return;
    const r = await raw(`/planning/projects/${projectId}/import?format=${fmt}&file_name=${encodeURIComponent(file.name)}${dry ? '&dry_run=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: file.text });
    setPreview((await r.json()).data);
    if (!dry) { setNote(t('sc.imported')); setFile(null); await loadProject(projectId); }
  });
  const download = (f: 'xer' | 'mspdi') => act(async () => {
    const r = await raw(`/planning/projects/${projectId}/export?format=${f}`, { method: 'GET' });
    const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? `schedule.${f === 'xer' ? 'xer' : 'xml'}`;
    const url = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  });
  const span = sch?.start ? Math.max(1, dayNo(sch.finish) - dayNo(sch.start) + 1) : 1;

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('sc.eyebrow')}</p><h1>{t('sc.title')}</h1><p>{t('sc.intro')}</p></div></header>
    {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}
    {note && <div className="muted" role="status">{note}</div>}

    <div className="panel" data-section="calendars"><h2>{t('sc.calendars')}</h2>
      <div className="form-grid">
        <label>{t('sc.calName')}<input value={cal.name} onChange={e => setCal({ ...cal, name: e.target.value })} /></label>
        <label>{t('sc.hoursPerDay')}<input value={cal.hours_per_day} dir="ltr" inputMode="decimal" onChange={e => setCal({ ...cal, hours_per_day: e.target.value })} /></label>
        <fieldset><legend>{t('sc.workDays')}</legend>{DAYS.map((k, d) => <label key={k} className="inline"><input type="checkbox" checked={cal.work_days.includes(d)} onChange={() => toggleDay(d)} /> {t(k)}</label>)}</fieldset>
      </div>
      <button onClick={addCal} disabled={cal.name.trim().length < 2 || !cal.work_days.length || !Number(cal.hours_per_day)}>{t('sc.addCalendar')}</button>
      {cals.length ? <div className="table-wrap"><table><thead><tr><th>{t('sc.calName')}</th><th>{t('sc.workDays')}</th><th>{t('sc.hoursPerDay')}</th><th>{t('sc.holidays')}</th></tr></thead>
        <tbody>{cals.map(c => { const h = hol[c.id] ?? { date: '', desc: '' };
          return <tr key={c.id} data-calendar={c.name}><td>{c.name}</td><td>{c.work_days.map((d: number) => t(DAYS[d])).join('، ')}</td><td><Num v={c.hours_per_day} /></td>
            <td>{c.holidays.map((x: Row) => <div key={x.id}><bdi>{x.holiday_date}</bdi> {x.description} <button onClick={() => delHol(c, x)}>{t('sc.remove')}</button></div>)}
              <div className="form-row"><input type="date" aria-label={t('sc.holidayDate')} value={h.date} onChange={e => setHol({ ...hol, [c.id]: { ...h, date: e.target.value } })} />
                <input aria-label={t('sc.holidayDesc')} placeholder={t('sc.holidayDesc')} value={h.desc} onChange={e => setHol({ ...hol, [c.id]: { ...h, desc: e.target.value } })} />
                <button disabled={!h.date || h.desc.trim().length < 2} onClick={() => addHol(c)}>{t('sc.addHoliday')}</button></div></td></tr>; })}</tbody></table></div> : <p>{t('sc.noneYet')}</p>}</div>

    <div className="panel" data-section="project"><h2>{t('sc.settings')}</h2>
      <div className="form-grid">
        <label>{t('sc.project')}<ReferenceSelect kind="projects" value={projectId} onChange={setProjectId} placeholder={t('sc.choose')} /></label>
        <label>{t('sc.calendar')}<select value={settings.calendar_id} disabled={!projectId} onChange={e => setSettings({ ...settings, calendar_id: e.target.value })}><option value="">{t('sc.choose')}</option>{cals.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>{t('sc.dataDate')}<input type="date" value={settings.data_date} disabled={!projectId} onChange={e => setSettings({ ...settings, data_date: e.target.value })} /></label>
      </div>
      <button onClick={saveSettings} disabled={!projectId || !settings.calendar_id || !settings.data_date}>{t('sc.saveSettings')}</button></div>

    {projectId && <div className="panel" data-section="import"><h2>{t('sc.import')}</h2><p className="muted">{t('sc.importNote')}</p>
      <div className="form-grid">
        <label>{t('sc.format')}<select value={fmt} onChange={e => { setFmt(e.target.value as any); setPreview(null); }}><option value="xer">{t('sc.formatXer')}</option><option value="mspdi">{t('sc.formatMspdi')}</option></select></label>
        <label>{t('sc.file')}<input type="file" accept={fmt === 'xer' ? '.xer' : '.xml'} onChange={async e => { const f = e.target.files?.[0]; setPreview(null); setFile(f ? { name: f.name, text: await f.text() } : null); }} /></label>
      </div>
      <button disabled={!file} onClick={() => send(true)}>{t('sc.readFile')}</button> <button disabled={!file || !preview || preview.saved} onClick={() => send(false)}>{t('sc.importNow')}</button>
      {preview && <div data-section="preview"><h3>{t('sc.read')}</h3>
        <p>{t('sc.activities')}: <Num v={preview.activities} /> · {t('sc.relationships')}: <Num v={preview.relationships} /> · {t('sc.milestones')}: <Num v={preview.milestones} /> · {t('sc.fingerprint')}: <bdi>{String(preview.file_sha256).slice(0, 12)}…</bdi></p>
        {preview.warnings.length > 0 && <><h3>{t('sc.warnings')}</h3><ul>{preview.warnings.map((w: string, i: number) => <li key={i}><bdi>{w}</bdi></li>)}</ul></>}</div>}
      {hist.length > 0 && <><h3>{t('sc.history')}</h3><div className="table-wrap"><table><thead><tr><th>{t('sc.colFile')}</th><th>{t('sc.format')}</th><th>{t('sc.activities')}</th><th>{t('sc.relationships')}</th><th>{t('sc.colBy')}</th><th>{t('sc.colWhen')}</th></tr></thead>
        <tbody>{hist.map(h => <tr key={h.id}><td><bdi>{h.file_name}</bdi></td><td>{t(h.format === 'xer' ? 'sc.formatXer' : 'sc.formatMspdi')}</td><td><Num v={h.activities_count} /></td><td><Num v={h.relationships_count} /></td><td>{h.imported_by_name}</td><td><bdi>{String(h.created_at).slice(0, 10)}</bdi></td></tr>)}</tbody></table></div></>}</div>}

    {sch && <div className="panel" data-section="schedule"><h2>{t('sc.schedule')}</h2>
      <div className="form-row"><button onClick={() => act(() => loadProject(projectId))}>{t('sc.calculate')}</button>
        <button disabled={!sch.activities.length} onClick={() => download('xer')}>{t('sc.exportXer')}</button><button disabled={!sch.activities.length} onClick={() => download('mspdi')}>{t('sc.exportMspdi')}</button></div>
      <p>{t('sc.duration')}: <Num v={sch.duration_days} /> · {t('sc.start')}: <bdi>{sch.start ?? '—'}</bdi> · {t('sc.finish')}: <bdi>{sch.finish ?? '—'}</bdi></p>
      {sch.activities.length ? <div className="table-wrap"><table><thead><tr><th>{t('sc.colCode')}</th><th>{t('sc.colName')}</th><th>{t('sc.colWbs')}</th><th>{t('sc.colDur')}</th><th>{t('sc.colEs')}</th><th>{t('sc.colEf')}</th><th>{t('sc.colLs')}</th><th>{t('sc.colLf')}</th><th>{t('sc.colTf')}</th><th>{t('sc.colFf')}</th><th>{t('sc.critical')}</th><th style={{ minWidth: 220 }}>{t('sc.colBar')}</th></tr></thead>
        <tbody>{sch.activities.map((a: Row) => { const off = dayNo(a.early_start) - dayNo(sch.start), len = Math.max(1, dayNo(a.early_finish) - dayNo(a.early_start) + 1);
          return <tr key={a.id} data-activity={a.code} data-critical={a.critical ? 'yes' : 'no'}><td><bdi>{a.code}</bdi></td><td>{a.name}</td><td><bdi>{a.wbs ?? '—'}</bdi></td><td><Num v={a.duration} /></td>
            <td><bdi>{a.early_start}</bdi></td><td><bdi>{a.early_finish}</bdi></td><td><bdi>{a.late_start}</bdi></td><td><bdi>{a.late_finish}</bdi></td><td><Num v={a.total_float} /></td><td><Num v={a.free_float} /></td><td>{t(a.critical ? 'sc.yes' : 'sc.no')}</td>
            <td><div style={{ position: 'relative', height: 14, background: 'var(--surface-2, #eef1f5)', borderRadius: 3 }} aria-hidden="true">
              <div style={{ position: 'absolute', insetInlineStart: `${(off / span) * 100}%`, width: a.type === 'task' ? `${(len / span) * 100}%` : 10, height: '100%', borderRadius: a.type === 'task' ? 3 : 7,
                background: a.critical ? 'var(--danger, #c0392b)' : 'var(--accent, #2f6fb2)' }} /></div></td></tr>; })}</tbody></table></div> : <p>{t('sc.noneYet')}</p>}</div>}
  </section>;
}
