import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Num, type Row } from '../components/RecordTable';

// CC-093 (Stage 64, A-006; migration 098): daily attendance per project (bulk entry, day approval by another person)
// and the labour summary of a period. Every rule (employment on the date, hours, leave, approval) is the database's.
const TYPE: Record<string, MessageKey> = { staff: 'at.typeStaff', labor: 'at.typeLabor', daily_wage: 'at.typeDaily' };
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function SiteAttendance() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<Row[]>([]), [project, setProject] = useState(''), [date, setDate] = useState(localDate());
  const [sheet, setSheet] = useState<Row[]>([]), [edit, setEdit] = useState<Record<string, Row>>({});
  const [from, setFrom] = useState(localDate(new Date(Date.now() - 29 * 86400000))), [to, setTo] = useState(localDate()), [sum, setSum] = useState<any>(null);
  const [error, setError] = useState(''), [note, setNote] = useState('');
  useEffect(() => { apiGet<any>('/hr/attendance/projects').then(r => setProjects(r.data)).catch(e => setError(e.message)); }, []);
  async function loadSheet() {
    if (!project) return;
    const r = await apiGet<any>(`/hr/attendance/sheet?project_id=${project}&date=${date}`);
    setSheet(r.data);
    setEdit(Object.fromEntries(r.data.map((x: Row) => [x.employee_id, { status: x.status === 'overtime' ? 'present' : x.status ?? '', hours_worked: x.hours_worked ?? '', overtime_hours: x.overtime_hours ?? '' }])));
  }
  useEffect(() => { setNote(''); loadSheet().catch(e => setError(e.message)); }, [project, date]);
  const run = async (fn: () => Promise<void>) => { try { setError(''); setNote(''); await fn(); } catch (e: any) { setError(e.message); } };
  const set = (id: number, k: string, v: string) => setEdit({ ...edit, [id]: { ...edit[id], [k]: v } });
  const save = () => run(async () => {
    const rows = sheet.filter(x => !x.approved_at && edit[x.employee_id]?.status).map(x => { const e = edit[x.employee_id];
      return { employee_id: x.employee_id, status: e.status, ...(e.status === 'present' ? { hours_worked: Number(e.hours_worked || 0), overtime_hours: Number(e.overtime_hours || 0) } : {}) }; });
    const r = await apiPost<any>('/hr/attendance/bulk', { project_id: Number(project), date, rows });
    await loadSheet(); setNote(t('at.saved', { count: r.data.length }));
  });
  const approve = () => run(async () => { const r = await apiPost<any>('/hr/attendance/approve', { project_id: Number(project), date }); await loadSheet(); setNote(t('at.approved', { approved: r.data.approved, left: r.data.still_unapproved })); });
  const showSummary = () => run(async () => setSum((await apiGet<any>(`/hr/labour-summary?project_id=${project}&from=${from}&to=${to}`)).data));

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('at.eyebrow')}</p><h1>{t('at.title')}</h1><p>{t('at.intro')}</p></div></header>
    {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}
    {note && <div className="notice" role="status">{note}</div>}
    <div className="panel" data-section="pick"><div className="form-row">
      <label>{t('at.project')} <select value={project} onChange={e => { setProject(e.target.value); setSum(null); }}><option value="">{t('at.choose')}</option>{projects.map(p => <option key={p.id} value={p.id}>{p.project_code} — {p.project_name}</option>)}</select></label>
      <label>{t('at.date')} <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label></div></div>
    {project && <div className="panel" data-section="sheet"><h2>{t('at.sheet')}</h2>
      {sheet.length ? <><div className="table-wrap"><table><thead><tr><th>{t('at.colEmployee')}</th><th>{t('at.colType')}</th><th>{t('at.colStatus')}</th><th>{t('at.colHours')}</th><th>{t('at.colOvertime')}</th><th>{t('at.colRecorded')}</th><th>{t('at.colApproved')}</th></tr></thead>
        <tbody>{sheet.map(x => { const e = edit[x.employee_id] ?? {}; const locked = !!x.approved_at;
          return <tr key={x.employee_id} data-employee={x.employee_code} data-approved={locked ? 'yes' : 'no'}>
            <td><bdi>{x.employee_code}</bdi> — {x.full_name}{x.on_leave && <div className="muted">{t('at.onLeave')}</div>}</td><td>{TYPE[x.employment_type] ? t(TYPE[x.employment_type]) : '—'}</td>
            <td><select aria-label={`${t('at.colStatus')} — ${x.full_name}`} disabled={locked} value={e.status ?? ''} onChange={v => set(x.employee_id, 'status', v.target.value)}><option value="">{t('at.notRecorded')}</option><option value="present">{t('at.present')}</option><option value="absent">{t('at.absent')}</option><option value="leave">{t('at.leave')}</option></select></td>
            <td><input aria-label={`${t('at.colHours')} — ${x.full_name}`} disabled={locked || e.status !== 'present'} dir="ltr" inputMode="decimal" value={e.hours_worked ?? ''} onChange={v => set(x.employee_id, 'hours_worked', v.target.value)} /></td>
            <td><input aria-label={`${t('at.colOvertime')} — ${x.full_name}`} disabled={locked || e.status !== 'present'} dir="ltr" inputMode="decimal" value={e.overtime_hours ?? ''} onChange={v => set(x.employee_id, 'overtime_hours', v.target.value)} /></td>
            <td>{x.recorded_by_name ?? '—'}</td><td>{x.approved_by_name ?? '—'}</td></tr>; })}</tbody></table></div>
        <div className="form-row"><button onClick={save}>{t('at.save')}</button><button onClick={approve}>{t('at.approve')}</button></div></> : <p>{t('at.noEmployees')}</p>}</div>}
    {project && <div className="panel" data-section="summary"><h2>{t('at.summary')}</h2>
      <div className="form-row"><label>{t('at.from')} <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>{t('at.to')} <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label><button onClick={showSummary}>{t('at.show')}</button></div>
      {sum && <><div className="cards-grid">{([['at.daysPresent', sum.days_present], ['at.daysAbsent', sum.days_absent], ['at.daysLeave', sum.days_leave], ['at.workers', sum.workers], ['at.hours', sum.hours], ['at.overtime', sum.overtime_hours],
          ['at.unapproved', sum.unapproved], ['at.timesheetHours', sum.timesheet_hours]] as [MessageKey, unknown][]).map(([k, v]) => <div className="metric-card" key={k} data-metric={k}><span>{t(k)}</span><strong><Num v={v} /></strong></div>)}
          <div className="metric-card" data-metric="at.labourCost"><span>{t('at.labourCost')} (<bdi>{sum.currency}</bdi>)</span><strong><Num v={sum.labour_cost} /></strong></div>
          <div className="metric-card" data-metric="at.costPerDay"><span>{t('at.costPerDay')} (<bdi>{sum.currency}</bdi>)</span><strong><Num v={sum.cost_per_man_day} /></strong></div></div>
        <h3>{t('at.differences')}</h3>
        {sum.differences.length ? <div className="table-wrap"><table><thead><tr><th>{t('at.date')}</th><th>{t('at.colEmployee')}</th><th>{t('at.colAttHours')}</th><th>{t('at.colTsHours')}</th></tr></thead>
          <tbody>{sum.differences.map((d: Row, i: number) => <tr key={i}><td><Num v={d.date} /></td><td>{d.full_name}</td><td><Num v={d.attendance_hours} /></td><td><Num v={d.timesheet_hours} /></td></tr>)}</tbody></table></div> : <p>{t('at.noDifferences')}</p>}</>}</div>}
  </section>;
}
