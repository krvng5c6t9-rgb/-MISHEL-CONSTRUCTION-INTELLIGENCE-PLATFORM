import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Num, type Row } from '../components/RecordTable';

// CC-107 (Stage 71; migrations 105-106): MARC supplier directory - search by trade (group or trade), country, city and
// text; every record shows its source and verification status; "add to my vendors" creates the company's own vendor.
const COUNTRY: Record<string, MessageKey> = { EG: 'dr.egypt', SA: 'dr.saudi', AE: 'dr.uae' };
const PAGE_SIZE = 25;

export function SupplierDirectory() {
  const { t, lang } = useI18n();
  const [trades, setTrades] = useState<Row[]>([]), [stats, setStats] = useState<Row[]>([]), [res, setRes] = useState<any>(null);
  const [f, setF] = useState({ trade: '', country: '', city: '', q: '' }), [page, setPage] = useState(1), [error, setError] = useState(''), [note, setNote] = useState('');
  const name = (code: string) => { const x = trades.find(tr => tr.code === code); return x ? (lang === 'ar' ? x.name_ar : x.name_en) : code; };
  useEffect(() => { (async () => { setTrades((await apiGet<any>('/directory/trades')).data); setStats((await apiGet<any>('/directory/stats')).data); })().catch(e => setError(e.message)); }, []);
  async function search(p = 1) {
    try { setError(''); setNote('');
      const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page: String(p), page_size: String(PAGE_SIZE) });
      setRes((await apiGet<any>(`/directory/suppliers?${qs}`)).data); setPage(p);
    } catch (e: any) { setError(e.message); }
  }
  async function adopt(r: Row) {
    try { setError(''); await apiPost(`/directory/suppliers/${r.id}/adopt`, { vendor_type: 'supplier' }); setNote(t('dr.added')); await search(page); } catch (e: any) { setError(e.message); }
  }
  const groups = trades.filter(x => !x.parent_code), pages = res ? Math.max(1, Math.ceil(res.total / PAGE_SIZE)) : 1;

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('dr.eyebrow')}</p><h1>{t('dr.title')}</h1><p>{t('dr.intro')}</p></div></header>
    {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}
    {note && <div className="muted" role="status">{note}</div>}
    {stats.length > 0 && <div className="panel" data-section="stats"><h2>{t('dr.stats')}</h2><div className="form-row">{stats.map(s => <div key={s.country} className="panel" style={{ minWidth: 180 }}>
      <div className="muted">{t(COUNTRY[s.country])}</div><div><Num v={s.suppliers} /> {t('dr.suppliers')}</div><div className="muted"><Num v={s.with_phone} /> {t('dr.withPhone')}</div></div>)}</div></div>}

    <div className="panel" data-section="search"><div className="form-grid">
        <label>{t('dr.trade')}<select value={f.trade} onChange={e => setF({ ...f, trade: e.target.value })}><option value="">{t('dr.allTrades')}</option>
          {groups.map(g => <optgroup key={g.code} label={lang === 'ar' ? g.name_ar : g.name_en}><option value={g.code}>{lang === 'ar' ? g.name_ar : g.name_en} ({g.suppliers})</option>
            {trades.filter(x => x.parent_code === g.code).map(x => <option key={x.code} value={x.code}>{lang === 'ar' ? x.name_ar : x.name_en} ({x.suppliers})</option>)}</optgroup>)}</select></label>
        <label>{t('dr.country')}<select value={f.country} onChange={e => setF({ ...f, country: e.target.value })}><option value="">{t('dr.allCountries')}</option>
          {Object.entries(COUNTRY).map(([k, m]) => <option key={k} value={k}>{t(m)}</option>)}</select></label>
        <label>{t('dr.city')}<input value={f.city} onChange={e => setF({ ...f, city: e.target.value })} /></label>
        <label>{t('dr.search')}<input value={f.q} onChange={e => setF({ ...f, q: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') search(1); }} /></label>
      </div><button onClick={() => search(1)}>{t('dr.find')}</button></div>

    {res && <div className="panel" data-section="results"><h2>{t('dr.results')}: <Num v={res.total} /></h2>
      {res.rows.length ? <div className="table-wrap"><table><thead><tr><th>{t('dr.colName')}</th><th>{t('dr.colTrades')}</th><th>{t('dr.colPlace')}</th><th>{t('dr.colPhones')}</th><th>{t('dr.colSource')}</th><th>{t('dr.colStatus')}</th><th>{t('dr.colActions')}</th></tr></thead>
        <tbody>{res.rows.map((r: Row) => <tr key={r.id} data-supplier={r.id}>
          <td><bdi>{r.name}</bdi>{r.description && <div className="muted"><bdi>{r.description}</bdi></div>}</td>
          <td>{r.trades.map((c: string) => name(c)).join('، ')}</td>
          <td>{t(COUNTRY[r.country])}{r.city && <> — <bdi>{r.city}</bdi></>}{r.address && <div className="muted"><bdi>{r.address}</bdi></div>}</td>
          <td>{r.phones.map((p: string) => <div key={p}><a href={`tel:${p.replace(/[^+\d]/g, '')}`} dir="ltr">{p}</a></div>)}{r.email && <div><a href={`mailto:${r.email}`} dir="ltr">{r.email}</a></div>}</td>
          <td><a href={r.source_url} target="_blank" rel="noreferrer noopener" title={t('dr.open')}><bdi>{r.source}</bdi></a></td>
          <td>{t(r.verification_status === 'verified' ? 'dr.verified' : 'dr.unverified')}</td>
          <td>{r.my_vendor_id ? t('dr.myVendor') : <button onClick={() => adopt(r)}>{t('dr.addVendor')}</button>}</td></tr>)}</tbody></table></div> : <p>{t('dr.noneFound')}</p>}
      <div className="form-row"><button disabled={page <= 1} onClick={() => search(page - 1)}>{t('dr.previous')}</button><span>{t('dr.page')} <Num v={page} /> {t('dr.of')} <Num v={pages} /></span>
        <button disabled={page >= pages} onClick={() => search(page + 1)}>{t('dr.next')}</button></div></div>}
  </section>;
}
