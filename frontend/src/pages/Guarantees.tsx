import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Num, ask, type Row } from '../components/RecordTable';

// CC-092 (Stage 63, A-006; migration 097): letters of guarantee register. Recording and amending need finance.create;
// activation, release, claim and expiry need finance.approve, and activation is done by someone other than the preparer.
// All amounts and dates come from the server as stored; every rule is enforced by the database.
const TYPE: Record<string, MessageKey> = { bid: 'lg.typeBid', advance_payment: 'lg.typeAdvancePayment', performance: 'lg.typePerformance', retention: 'lg.typeRetention', maintenance: 'lg.typeMaintenance' };
const STATUS: Record<string, MessageKey> = { draft: 'lg.statusDraft', active: 'lg.statusActive', released: 'lg.statusReleased', claimed: 'lg.statusClaimed', expired: 'lg.statusExpired' };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const empty = { direction: 'issued', guarantee_type: 'performance', tender_id: '', project_id: '', contract_id: '', subcontract_id: '', client_id: '', vendor_id: '',
  bank_name: '', bank_reference: '', currency_id: '', amount: '', issue_date: '', expiry_date: '', cash_margin: '', commission_rate_pct: '', notes: '' };

export function Guarantees() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>([]), [sum, setSum] = useState<Row[]>([]), [lk, setLk] = useState<any>(null);
  const [f, setF] = useState<any>(empty), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  async function load() {
    const [a, b] = await Promise.all([apiGet<any>('/finance/guarantees'), apiGet<any>('/finance/guarantees/summary')]);
    setRows(a.data); setSum(b.data);
  }
  useEffect(() => { load().catch(e => setError(e.message)); apiGet<any>('/finance/guarantees/lookups').then(r => setLk(r.data)).catch(e => setError(e.message)); }, []);
  async function act(fn: () => Promise<any>) { try { setError(''); setSaved(false); await fn(); await load(); } catch (e: any) { setError(e.message); } }
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const num = (v: string) => (v === '' ? null : Number(v));
  async function save() {
    await act(async () => {
      const issued = f.direction === 'issued', bid = f.guarantee_type === 'bid';
      await apiPost('/finance/guarantees', { ...f, tender_id: bid ? num(f.tender_id) : null, project_id: bid ? null : num(f.project_id), contract_id: issued && !bid ? num(f.contract_id) : null,
        subcontract_id: issued ? null : num(f.subcontract_id), client_id: issued ? num(f.client_id) : null, vendor_id: issued ? null : num(f.vendor_id), currency_id: num(f.currency_id),
        cash_margin: f.cash_margin || null, commission_rate_pct: f.commission_rate_pct || null, notes: f.notes || null });
      setF(empty); setSaved(true);
    });
  }
  const amend = (g: Row, kind: 'extension' | 'reduction' | 'increase') => act(async () => {
    const v = ask(kind === 'extension' ? t('lg.askNewExpiry') : t('lg.askNewAmount')); if (!v) return;
    const ref = ask(t('lg.askBankRef')); if (!ref) return; const reason = ask(t('lg.askReason')); if (!reason) return;
    await apiPost(`/finance/guarantees/${g.id}/amendments`, { kind, ...(kind === 'extension' ? { new_expiry: v } : { new_amount: v }), effective_date: today(), bank_reference: ref, reason });
  });
  const release = (g: Row) => act(async () => { const ref = ask(t('lg.askBankRef')); if (!ref) return; await apiPost(`/finance/guarantees/${g.id}/release`, { closed_on: today(), reference: ref }); });
  const claim = (g: Row) => act(async () => { const a = ask(t('lg.askClaimAmount')); if (!a) return; const reason = ask(t('lg.askReason')); if (!reason) return;
    await apiPost(`/finance/guarantees/${g.id}/claim`, { closed_on: today(), claimed_amount: a, reason }); });
  const opt = (list: Row[] | undefined, label: (r: Row) => string) => (list ?? []).map(r => <option key={r.id} value={r.id}>{label(r)}</option>);
  const issued = f.direction === 'issued', bid = f.guarantee_type === 'bid';

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('lg.eyebrow')}</p><h1>{t('lg.title')}</h1><p>{t('lg.intro')}</p></div></header>
    {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}

    <div className="panel" data-section="exposure"><h2>{t('lg.exposure')}</h2>
      {sum.length ? <div className="table-wrap"><table><thead><tr><th>{t('lg.currency')}</th><th>{t('lg.direction')}</th><th>{t('lg.type')}</th><th>{t('lg.colCount')}</th><th>{t('lg.colAmount')}</th><th>{t('lg.colMargin')}</th><th>{t('lg.colExpThirty')}</th><th>{t('lg.colExpNinety')}</th><th>{t('lg.colPast')}</th></tr></thead>
        <tbody>{sum.map((s, i) => <tr key={i}><td><bdi>{s.currency}</bdi></td><td>{t(s.direction === 'issued' ? 'lg.issued' : 'lg.received')}</td><td>{t(TYPE[s.guarantee_type])}</td><td><Num v={s.count} /></td><td><Num v={s.amount} /></td><td><Num v={s.cash_margin} /></td><td><Num v={s.expiring_30} /></td><td><Num v={s.expiring_90} /></td><td><Num v={s.past_expiry} /></td></tr>)}</tbody></table></div> : <p>{t('lg.noneYet')}</p>}</div>

    <div className="panel" data-section="new"><h2>{t('lg.new')}</h2><p className="muted">{t('lg.sod')}</p>
      <div className="form-grid">
        <label>{t('lg.direction')}<select value={f.direction} onChange={e => setF({ ...f, direction: e.target.value, guarantee_type: e.target.value === 'received' && f.guarantee_type === 'bid' ? 'performance' : f.guarantee_type })}><option value="issued">{t('lg.issued')}</option><option value="received">{t('lg.received')}</option></select></label>
        <label>{t('lg.type')}<select value={f.guarantee_type} onChange={e => set('guarantee_type', e.target.value)}>{Object.keys(TYPE).filter(k => issued || k !== 'bid').map(k => <option key={k} value={k}>{t(TYPE[k])}</option>)}</select></label>
        {bid ? <label>{t('lg.tender')}<select value={f.tender_id} onChange={e => set('tender_id', e.target.value)}><option value="">{t('lg.choose')}</option>{opt(lk?.tenders, r => r.tender_title)}</select></label>
          : <label>{t('lg.project')}<select value={f.project_id} onChange={e => setF({ ...f, project_id: e.target.value, contract_id: '', subcontract_id: '' })}><option value="">{t('lg.choose')}</option>{opt(lk?.projects, r => `${r.project_code} — ${r.project_name}`)}</select></label>}
        {issued ? <>
          <label>{t('lg.client')}<select value={f.client_id} onChange={e => set('client_id', e.target.value)}><option value="">{t('lg.choose')}</option>{opt(lk?.clients, r => r.client_name)}</select></label>
          {!bid && <label>{t('lg.contract')}<select value={f.contract_id} onChange={e => set('contract_id', e.target.value)}><option value="">{t('lg.choose')}</option>{opt(lk?.contracts?.filter((c: Row) => String(c.project_id) === f.project_id), r => `#${r.id}`)}</select></label>}
        </> : <>
          <label>{t('lg.vendor')}<select value={f.vendor_id} onChange={e => setF({ ...f, vendor_id: e.target.value, subcontract_id: '' })}><option value="">{t('lg.choose')}</option>{opt(lk?.vendors, r => r.vendor_name)}</select></label>
          <label>{t('lg.subcontract')}<select value={f.subcontract_id} onChange={e => set('subcontract_id', e.target.value)}><option value="">{t('lg.choose')}</option>{opt(lk?.subcontracts?.filter((c: Row) => String(c.project_id) === f.project_id && String(c.vendor_id) === f.vendor_id), r => r.package_name ?? `#${r.id}`)}</select></label>
        </>}
        <label>{t('lg.bank')}<input value={f.bank_name} onChange={e => set('bank_name', e.target.value)} /></label>
        <label>{t('lg.bankRef')}<input value={f.bank_reference} dir="ltr" onChange={e => set('bank_reference', e.target.value)} /></label>
        <label>{t('lg.currency')}<select value={f.currency_id} onChange={e => set('currency_id', e.target.value)}><option value="">{t('lg.choose')}</option>{opt(lk?.currencies, r => r.code)}</select></label>
        <label>{t('lg.amount')}<input value={f.amount} dir="ltr" inputMode="decimal" onChange={e => set('amount', e.target.value)} /></label>
        <label>{t('lg.issueDate')}<input type="date" value={f.issue_date} onChange={e => set('issue_date', e.target.value)} /></label>
        <label>{t('lg.expiryDate')}<input type="date" value={f.expiry_date} onChange={e => set('expiry_date', e.target.value)} /></label>
        <label>{t('lg.cashMargin')}<input value={f.cash_margin} dir="ltr" inputMode="decimal" onChange={e => set('cash_margin', e.target.value)} /></label>
        <label>{t('lg.commission')}<input value={f.commission_rate_pct} dir="ltr" inputMode="decimal" onChange={e => set('commission_rate_pct', e.target.value)} /></label>
        <label>{t('lg.notes')}<input value={f.notes} onChange={e => set('notes', e.target.value)} /></label>
      </div>
      <button onClick={save} disabled={!f.bank_name || !f.bank_reference || !f.amount || !f.currency_id || !f.issue_date || !f.expiry_date}>{t('lg.save')}</button>
      {saved && <span className="muted" role="status"> {t('lg.saved')}</span>}</div>

    <div className="panel" data-section="register"><h2>{t('lg.register')}</h2>
      {rows.length ? <div className="table-wrap"><table><thead><tr><th>{t('lg.colRef')}</th><th>{t('lg.direction')}</th><th>{t('lg.type')}</th><th>{t('lg.colParty')}</th><th>{t('lg.colFor')}</th><th>{t('lg.colAmount')}</th><th>{t('lg.colExpiry')}</th><th>{t('lg.colDays')}</th><th>{t('lg.colStatus')}</th><th>{t('lg.colActions')}</th></tr></thead>
        <tbody>{rows.map(g => <tr key={g.id} data-guarantee={g.bank_reference} data-status={g.status}>
          <td>{g.bank_name}<div><bdi>{g.bank_reference}</bdi></div></td><td>{t(g.direction === 'issued' ? 'lg.issued' : 'lg.received')}</td><td>{t(TYPE[g.guarantee_type])}</td>
          <td>{g.client_name ?? g.vendor_name}</td><td>{g.tender_title ?? <><bdi>{g.project_code}</bdi> — {g.project_name}</>}</td>
          <td><Num v={g.current_amount} /> <bdi>{g.currency}</bdi>{g.amendments?.length > 0 && <div className="muted">{t('lg.amendments')}: <Num v={g.amendments.length} /></div>}</td>
          <td><Num v={g.current_expiry} /></td><td className={g.status === 'active' && Number(g.days_to_expiry) <= 30 ? 'amount-negative' : undefined}>{g.status === 'active' ? <Num v={g.days_to_expiry} /> : '—'}</td>
          <td>{t(STATUS[g.status])}</td>
          <td>{g.status === 'draft' && <><button onClick={() => act(() => apiPost(`/finance/guarantees/${g.id}/activate`, {}))}>{t('lg.activate')}</button><button onClick={() => act(() => apiDelete(`/finance/guarantees/${g.id}`))}>{t('lg.delete')}</button></>}
            {g.status === 'active' && <><button onClick={() => amend(g, 'extension')}>{t('lg.extend')}</button><button onClick={() => amend(g, 'reduction')}>{t('lg.reduce')}</button><button onClick={() => amend(g, 'increase')}>{t('lg.increase')}</button>
              <button onClick={() => release(g)}>{t('lg.release')}</button><button onClick={() => claim(g)}>{t('lg.claim')}</button>
              {Number(g.days_to_expiry) < 0 && <button onClick={() => act(() => apiPost(`/finance/guarantees/${g.id}/expire`, { closed_on: today() }))}>{t('lg.markExpired')}</button>}</>}</td>
        </tr>)}</tbody></table></div> : <p>{t('lg.noneYet')}</p>}</div>
  </section>;
}
