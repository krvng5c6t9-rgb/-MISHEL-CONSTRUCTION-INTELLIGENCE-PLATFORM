import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Num, type Row } from '../components/RecordTable';

// CC-099 (Stage 70; migration 104): dashboards built by users over the analytics data sources. Each widget is a stored
// query run by the server with the viewer's permissions; totals arrive as text from the database and are drawn as SVG
// here (bars, line, pie), shown as a table or as key figures. Money is always split by currency.
type Q = { source: string; measures: string[]; dims: string[]; date_from?: string; date_to?: string };
type W = { title: string; chart: 'bar' | 'line' | 'pie' | 'table' | 'kpi'; query: Q };
const CHARTS: [W['chart'], MessageKey][] = [['bar', 'an.chBar'], ['line', 'an.chLine'], ['pie', 'an.chPie'], ['table', 'an.chTable'], ['kpi', 'an.chKpi']];
const COLORS = ['#2f6fb2', '#c0392b', '#27ae60', '#d68910', '#8e44ad', '#16a085', '#7f8c8d', '#2c3e50'];

function Chart({ w, res, sources }: { w: W; res: any; sources: Row[] }) {
  const { t, lang } = useI18n();
  const s = sources.find(x => x.key === w.query.source), lbl = (o: any) => (lang === 'ar' ? o?.ar : o?.en) ?? '';
  if (!res) return null;
  if (res.error) return <p className="muted">{res.forbidden ? t('an.noAccess') : <bdi>{res.error}</bdi>}</p>;
  if (!res.rows.length) return <p className="muted">{t('an.noData')}</p>;
  const name = (r: any) => [...r.dims.map((d: any) => d ?? '—'), ...(res.by_currency ? [r.currency] : [])].join(' · ') || lbl(s?.measures.find((m: Row) => m.key === w.query.measures[0]));
  const val = (r: any) => Number(r.values[0] ?? 0);
  const head = <tr>{res.dims.map((d: string) => <th key={d}>{lbl(s?.dims.find((x: Row) => x.key === d))}</th>)}{res.by_currency && <th>{t('an.currency')}</th>}
    {res.measures.map((m: Row) => <th key={m.key}>{lbl(s?.measures.find((x: Row) => x.key === m.key))}</th>)}</tr>;
  const table = <div className="table-wrap"><table><thead>{head}</thead><tbody>{res.rows.map((r: any, i: number) => <tr key={i}>{r.dims.map((d: any, j: number) => <td key={j}><bdi>{d ?? '—'}</bdi></td>)}
    {res.by_currency && <td><bdi>{r.currency}</bdi></td>}{r.values.map((v: any, j: number) => <td key={j}><Num v={v} /></td>)}</tr>)}</tbody></table></div>;
  const note = res.truncated ? <p className="muted">{t('an.truncated')}</p> : null;
  if (w.chart === 'table') return <>{table}{note}</>;
  if (w.chart === 'kpi') return <div className="form-row" data-kpi="yes">{res.rows.map((r: any, i: number) => <div key={i} className="panel" style={{ minWidth: 160 }}>
    <div className="muted"><bdi>{name(r)}</bdi></div><div style={{ fontSize: 24, fontWeight: 700 }}><Num v={r.values[0]} /></div></div>)}</div>;
  const rows = res.rows.slice(0, 40), max = Math.max(1e-9, ...rows.map((r: any) => Math.abs(val(r))));
  if (w.chart === 'bar') {
    const h = 22, W = 640, lw = 180;
    return <><svg viewBox={`0 0 ${W} ${rows.length * h + 4}`} width="100%" role="img" aria-label={w.title} style={{ direction: 'ltr' }}>
      {rows.map((r: any, i: number) => { const len = (Math.abs(val(r)) / max) * (W - lw - 110);
        return <g key={i} transform={`translate(0 ${i * h})`}><text x={lw - 6} y={15} textAnchor="end" fontSize="12">{name(r).slice(0, 28)}</text>
          <rect x={lw} y={3} width={Math.max(1, len)} height={h - 6} fill={val(r) < 0 ? COLORS[1] : COLORS[0]} rx={2} />
          <text x={lw + len + 6} y={15} fontSize="12">{r.values[0]}</text></g>; })}</svg>{note}</>;
  }
  if (w.chart === 'line') {
    const W = 640, H = 220, pad = 40, xs = (i: number) => pad + (rows.length > 1 ? (i * (W - 2 * pad)) / (rows.length - 1) : (W - 2 * pad) / 2);
    const min = Math.min(0, ...rows.map(val)), span = Math.max(1e-9, Math.max(0, ...rows.map(val)) - min), ys = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad);
    return <><svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={w.title} style={{ direction: 'ltr' }}>
      <line x1={pad} y1={ys(0)} x2={W - pad} y2={ys(0)} stroke="#999" />
      <polyline fill="none" stroke={COLORS[0]} strokeWidth={2} points={rows.map((r: any, i: number) => `${xs(i)},${ys(val(r))}`).join(' ')} />
      {rows.map((r: any, i: number) => <g key={i}><circle cx={xs(i)} cy={ys(val(r))} r={3} fill={COLORS[0]} /><text x={xs(i)} y={H - 12} fontSize="10" textAnchor="middle">{name(r).slice(0, 12)}</text></g>)}</svg>{note}</>;
  }
  const pos = rows.filter((r: any) => val(r) > 0), total = pos.reduce((a: number, r: any) => a + val(r), 0) || 1; let ang = 0;
  return <><svg viewBox="0 0 640 240" width="100%" role="img" aria-label={w.title} style={{ direction: 'ltr' }}>
    {pos.map((r: any, i: number) => { const a0 = ang, a1 = ang + (val(r) / total) * Math.PI * 2; ang = a1; const big = a1 - a0 > Math.PI ? 1 : 0, cx = 120, cy = 120, R = 100;
      const p = pos.length === 1 ? `M ${cx - R} ${cy} A ${R} ${R} 0 1 1 ${cx + R} ${cy} A ${R} ${R} 0 1 1 ${cx - R} ${cy}` : `M ${cx} ${cy} L ${cx + R * Math.sin(a0)} ${cy - R * Math.cos(a0)} A ${R} ${R} 0 ${big} 1 ${cx + R * Math.sin(a1)} ${cy - R * Math.cos(a1)} Z`;
      return <g key={i}><path d={p} fill={COLORS[i % COLORS.length]} /><rect x={260} y={10 + i * 20} width={12} height={12} fill={COLORS[i % COLORS.length]} />
        <text x={280} y={21 + i * 20} fontSize="12">{name(r).slice(0, 30)} — {r.values[0]}</text></g>; })}</svg>{note}</>;
}

export function Analytics() {
  const { t, lang } = useI18n();
  const [sources, setSources] = useState<Row[]>([]), [boards, setBoards] = useState<Row[]>([]), [error, setError] = useState(''), [note, setNote] = useState('');
  const [cur, setCur] = useState<{ id: number | null; name: string; visibility: 'private' | 'company'; widgets: W[]; mine: boolean }>({ id: null, name: '', visibility: 'private', widgets: [], mine: true });
  const [results, setResults] = useState<any[]>([]), [me, setMe] = useState<number | null>(null);
  const [draft, setDraft] = useState<W>({ title: '', chart: 'bar', query: { source: '', measures: [], dims: [] } }), [prev, setPrev] = useState<any>(null);
  const lbl = (o: any) => (lang === 'ar' ? o?.ar : o?.en) ?? '';
  const run = async (q: Q) => { try { return (await apiPost<any>('/analytics/query', q)).data; } catch (e: any) { return { error: e.message, forbidden: /permission|صلاحية/i.test(e.message) }; } };
  const loadBoards = async () => setBoards((await apiGet<any>('/analytics/dashboards')).data);
  useEffect(() => { (async () => { setSources((await apiGet<any>('/analytics/sources')).data); await loadBoards(); setMe((await apiGet<any>('/auth/me').catch(() => ({ data: null }))).data?.id ?? null); })().catch(e => setError(e.message)); }, []);
  useEffect(() => { Promise.all(cur.widgets.map(w => run(w.query))).then(setResults); }, [cur.widgets]);
  const src = sources.find(s => s.key === draft.query.source);
  const setQ = (q: Partial<Q>) => { setDraft({ ...draft, query: { ...draft.query, ...q } }); setPrev(null); };
  const open = (b: Row) => setCur({ id: b.id, name: b.name, visibility: b.visibility, widgets: b.widgets, mine: me === null || b.owner_id === me });
  async function save() {
    try { setError(''); const body = { name: cur.name, visibility: cur.visibility, widgets: cur.widgets };
      if (cur.id) await apiPut(`/analytics/dashboards/${cur.id}`, body); else { const r = await apiPost<any>('/analytics/dashboards', body); setCur({ ...cur, id: r.data.id }); }
      setNote(t('an.saved')); await loadBoards(); } catch (e: any) { setError(e.message); }
  }
  async function del() { if (!cur.id) return; try { await apiDelete(`/analytics/dashboards/${cur.id}`); setCur({ id: null, name: '', visibility: 'private', widgets: [], mine: true }); await loadBoards(); } catch (e: any) { setError(e.message); } }
  const toggleMeasure = (k: string) => setQ({ measures: draft.query.measures.includes(k) ? draft.query.measures.filter(x => x !== k) : [...draft.query.measures, k].slice(0, 4) });
  const q0 = (): Q => ({ ...draft.query, dims: draft.query.dims.filter(Boolean), ...(draft.query.date_from ? {} : { date_from: undefined }), ...(draft.query.date_to ? {} : { date_to: undefined }) });

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('an.eyebrow')}</p><h1>{t('an.title')}</h1><p>{t('an.intro')}</p></div></header>
    {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}

    <div className="panel" data-section="boards"><h2>{t('an.dashboards')}</h2>
      {boards.length ? <div className="table-wrap"><table><thead><tr><th>{t('an.name')}</th><th>{t('an.visibility')}</th><th>{t('an.owner')}</th><th>{t('an.open')}</th></tr></thead>
        <tbody>{boards.map(b => <tr key={b.id} data-board={b.name}><td>{b.name}</td><td>{t(b.visibility === 'company' ? 'an.company' : 'an.private')}</td><td>{b.owner_name}</td><td><button onClick={() => open(b)}>{t('an.open')}</button></td></tr>)}</tbody></table></div> : <p>{t('an.noneYet')}</p>}
      <button onClick={() => setCur({ id: null, name: '', visibility: 'private', widgets: [], mine: true })}>{t('an.new')}</button></div>

    <div className="panel" data-section="board"><div className="form-grid">
        <label>{t('an.name')}<input value={cur.name} disabled={!cur.mine} onChange={e => setCur({ ...cur, name: e.target.value })} /></label>
        <label>{t('an.visibility')}<select value={cur.visibility} disabled={!cur.mine} onChange={e => setCur({ ...cur, visibility: e.target.value as any })}><option value="private">{t('an.private')}</option><option value="company">{t('an.company')}</option></select></label></div>
      {cur.mine && <div className="form-row"><button disabled={cur.name.trim().length < 2} onClick={save}>{t('an.save')}</button>{cur.id && <button onClick={del}>{t('an.delete')}</button>}{note && <span className="muted" role="status">{note}</span>}</div>}
      <div className="widget-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {cur.widgets.map((w, i) => <div key={i} className="panel" data-widget={w.title}><h3>{w.title}</h3><Chart w={w} res={results[i]} sources={sources} />
          {cur.mine && <button onClick={() => setCur({ ...cur, widgets: cur.widgets.filter((_, j) => j !== i) })}>{t('an.remove')}</button>}</div>)}</div></div>

    {cur.mine && <div className="panel" data-section="builder"><h2>{t('an.builder')}</h2>
      <div className="form-grid">
        <label>{t('an.chartTitle')}<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label>{t('an.source')}<select value={draft.query.source} onChange={e => setQ({ source: e.target.value, measures: [], dims: [] })}><option value="">{t('an.choose')}</option>{sources.map(s => <option key={s.key} value={s.key}>{lbl(s)}</option>)}</select></label>
        <label>{t('an.chart')}<select value={draft.chart} onChange={e => setDraft({ ...draft, chart: e.target.value as W['chart'] })}>{CHARTS.map(([k, m]) => <option key={k} value={k}>{t(m)}</option>)}</select></label>
        {src && <><label>{t('an.groupBy')}<select value={draft.query.dims[0] ?? ''} onChange={e => setQ({ dims: [e.target.value, draft.query.dims[1] ?? ''].filter((x, i) => x || i === 0) })}><option value="">{t('an.none')}</option>{src.dims.map((d: Row) => <option key={d.key} value={d.key}>{lbl(d)}</option>)}</select></label>
          <label>{t('an.thenBy')}<select value={draft.query.dims[1] ?? ''} disabled={!draft.query.dims[0]} onChange={e => setQ({ dims: [draft.query.dims[0], e.target.value].filter(Boolean) })}><option value="">{t('an.none')}</option>{src.dims.filter((d: Row) => d.key !== draft.query.dims[0]).map((d: Row) => <option key={d.key} value={d.key}>{lbl(d)}</option>)}</select></label>
          <label>{t('an.dateFrom')}<input type="date" value={draft.query.date_from ?? ''} onChange={e => setQ({ date_from: e.target.value || undefined })} /></label>
          <label>{t('an.dateTo')}<input type="date" value={draft.query.date_to ?? ''} onChange={e => setQ({ date_to: e.target.value || undefined })} /></label>
          <fieldset><legend>{t('an.measures')}</legend>{src.measures.map((m: Row) => <label key={m.key} className="inline"><input type="checkbox" checked={draft.query.measures.includes(m.key)} onChange={() => toggleMeasure(m.key)} /> {lbl(m)}</label>)}</fieldset></>}
      </div>
      {!src && <p className="muted">{t('an.chooseSource')}</p>}
      <div className="form-row"><button disabled={!src || !draft.query.measures.length} onClick={async () => setPrev(await run(q0()))}>{t('an.preview')}</button>
        <button disabled={!src || !draft.query.measures.length || !draft.title.trim()} onClick={() => { setCur({ ...cur, widgets: [...cur.widgets, { ...draft, query: q0() }] }); setDraft({ title: '', chart: draft.chart, query: { source: draft.query.source, measures: [], dims: [] } }); setPrev(null); }}>{t('an.add')}</button></div>
      {prev && <div data-section="preview"><Chart w={{ ...draft, query: q0() }} res={prev} sources={sources} /></div>}</div>}
  </section>;
}
