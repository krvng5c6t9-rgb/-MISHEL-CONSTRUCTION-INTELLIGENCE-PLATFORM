import { useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { localDate } from '../lib/date';
import { Num } from '../components/RecordTable';

// CC-079 (DEC-021 / DEC-022): exchange-rate register, the company's exchange settings, the monetary accounts revalued
// and period-end revaluation. Figures are the server's (rates frozen per transaction, revaluation computed from the
// ledger); the screen sends only the choices and the period end.
type Notice = { key: MessageKey; vars?: Record<string, string> } | null;
export function Exchange() {
  const { t, tv } = useI18n();
  const [settings, setSettings] = useState<any>({}), [accounts, setAccounts] = useState<any[]>([]), [rates, setRates] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]), [runs, setRuns] = useState<any[]>([]);
  const [form, setForm] = useState({ fx_gain_account_id: '', fx_loss_account_id: '', fx_max_rate_age_days: '7' });
  const [rate, setRate] = useState({ currency_id: '', rate_date: localDate(), rate_to_base: '', source: '' });
  const [periodEnd, setPeriodEnd] = useState(localDate());
  const [error, setError] = useState(''), [notice, setNotice] = useState<Notice>(null);

  async function load() {
    const [s, a, r, ref, v] = await Promise.all([apiGet<any>('/finance/fx-settings'), apiGet<any>('/finance/chart-of-accounts'), apiGet<any>('/finance/exchange-rates'), apiGet<any>('/reference-data'), apiGet<any>('/finance/fx-revaluations')]);
    setSettings(s.data ?? {}); setAccounts(a.data ?? []); setRates(r.data ?? []); setRuns(v.data ?? []);
    setCurrencies((ref.data?.currencies ?? []).filter((c: any) => c.code !== s.data?.base_currency_code));
    setForm({ fx_gain_account_id: String(s.data?.fx_gain_account_id ?? ''), fx_loss_account_id: String(s.data?.fx_loss_account_id ?? ''), fx_max_rate_age_days: String(s.data?.fx_max_rate_age_days ?? 7) });
  }
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  async function act(fn: () => Promise<any>, done: Notice) { try { setError(''); setNotice(null); await fn(); await load(); setNotice(done); } catch (e: any) { setError(e.message); } }

  const saveSettings = () => act(() => apiPatch('/finance/fx-settings', { fx_gain_account_id: Number(form.fx_gain_account_id), fx_loss_account_id: Number(form.fx_loss_account_id), fx_max_rate_age_days: Number(form.fx_max_rate_age_days) }), { key: 'fx.saved' });
  const addRate = () => act(() => apiPost('/finance/exchange-rates', { currency_id: Number(rate.currency_id), rate_date: rate.rate_date, rate_to_base: Number(rate.rate_to_base), source: rate.source || null }), { key: 'fx.rateSaved' });
  const toggle = (a: any) => act(() => apiPatch(`/finance/chart-of-accounts/${a.id}/fx-revalue`, { fx_revalue: !a.fx_revalue }), null);
  const revalue = () => act(() => apiPost('/finance/fx-revaluations', { period_end: periodEnd }), { key: 'fx.runDone', vars: { date: periodEnd } });
  const acctLabel = (a: any) => `${a.account_code} — ${a.account_name}`;
  const of = (type: string) => accounts.filter(a => a.account_type === type && a.is_active !== false);

  return <section className="page-stack">
    <header className="page-header"><div><h1>{t('fx.title')}</h1><p>{t('fx.intro')}</p></div></header>
    {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}
    {notice && <div className="notice" role="status">{t(notice.key, notice.vars)}</div>}

    <div className="panel" data-section="settings"><h2>{t('fx.settings')}</h2>
      {settings.base_currency_code && <p className="muted">{t('fx.baseCurrency', { code: settings.base_currency_code })}</p>}
      <div className="form-row">
        <select aria-label={t('fx.gainAccount')} value={form.fx_gain_account_id} onChange={e => setForm({ ...form, fx_gain_account_id: e.target.value })}><option value="">{t('fx.gainAccount')}</option>{of('revenue').map(a => <option key={a.id} value={a.id}>{acctLabel(a)}</option>)}</select>
        <select aria-label={t('fx.lossAccount')} value={form.fx_loss_account_id} onChange={e => setForm({ ...form, fx_loss_account_id: e.target.value })}><option value="">{t('fx.lossAccount')}</option>{of('expense').map(a => <option key={a.id} value={a.id}>{acctLabel(a)}</option>)}</select>
        <input type="number" min="0" max="366" aria-label={t('fx.maxAge')} placeholder={t('fx.maxAge')} value={form.fx_max_rate_age_days} onChange={e => setForm({ ...form, fx_max_rate_age_days: e.target.value })} />
        <button onClick={saveSettings}>{t('fx.save')}</button>
      </div>
    </div>

    <div className="panel" data-section="rates"><h2>{t('fx.rates')}</h2><p className="muted">{t('fx.ratesNote')}</p>
      <div className="form-row">
        <select aria-label={t('fx.currency')} value={rate.currency_id} onChange={e => setRate({ ...rate, currency_id: e.target.value })}><option value="">{t('fx.currency')}</option>{currencies.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}</select>
        <input type="date" aria-label={t('fx.rateDate')} value={rate.rate_date} onChange={e => setRate({ ...rate, rate_date: e.target.value })} />
        <input type="number" step="0.000001" min="0" aria-label={t('fx.rate')} placeholder={t('fx.rate')} value={rate.rate_to_base} onChange={e => setRate({ ...rate, rate_to_base: e.target.value })} />
        <input aria-label={t('fx.source')} placeholder={t('fx.source')} value={rate.source} onChange={e => setRate({ ...rate, source: e.target.value })} />
        <button onClick={addRate}>{t('fx.addRate')}</button>
      </div>
      {rates.length ? <div className="table-wrap"><table><thead><tr><th>{t('fx.colDate')}</th><th>{t('fx.colCurrency')}</th><th>{t('fx.colRate')}</th><th>{t('fx.colSource')}</th></tr></thead><tbody>
        {rates.slice(0, 30).map(r => <tr key={r.id}><td><Num text={String(r.rate_date).slice(0, 10)} /></td><td>{r.currency_code}</td><td><Num v={r.rate_to_base} /></td><td>{r.source ?? '—'}</td></tr>)}
      </tbody></table></div> : <p className="muted">{t('fx.none')}</p>}
    </div>

    <div className="panel" data-section="monetary"><h2>{t('fx.monetary')}</h2><p className="muted">{t('fx.monetaryNote')}</p>
      {[...of('asset'), ...of('liability')].length ? <div className="table-wrap"><table><thead><tr><th>{t('fx.colAccount')}</th><th>{t('fx.colType')}</th><th>{t('fx.colRevalue')}</th></tr></thead><tbody>
        {[...of('asset'), ...of('liability')].map(a => <tr key={a.id}><td id={`fxacc-${a.id}`}>{acctLabel(a)}</td><td>{tv(a.account_type)}</td><td><input type="checkbox" aria-labelledby={`fxacc-${a.id}`} checked={!!a.fx_revalue} onChange={() => toggle(a)} /></td></tr>)}
      </tbody></table></div> : <p className="muted">{t('fx.none')}</p>}
    </div>

    <div className="panel" data-section="revaluation"><h2>{t('fx.revaluation')}</h2>
      <div className="form-row"><input type="date" aria-label={t('fx.periodEnd')} value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} /><button onClick={revalue}>{t('fx.run')}</button></div>
      <h3>{t('fx.history')}</h3>
      {runs.length ? runs.map(r => <div key={r.id} className="table-wrap"><p><Num text={String(r.period_end).slice(0, 10)} /> · {tv(r.status)} · {t('fx.colLines')}: <Num v={r.lines.length} /></p>
        {r.lines.length > 0 && <table><thead><tr><th>{t('fx.colAccount')}</th><th>{t('fx.colCurrency')}</th><th>{t('fx.colForeign')}</th><th>{t('fx.colClosing')}</th><th>{t('fx.colBefore')}</th><th>{t('fx.colTarget')}</th><th>{t('fx.colAdjustment')}</th></tr></thead><tbody>
          {r.lines.map((l: any) => <tr key={l.id}><td>{l.account_code} — {l.account_name}</td><td>{l.currency_code}</td><td><Num v={l.foreign_balance} /></td><td><Num v={l.closing_rate} /></td><td><Num v={l.base_before} /></td><td><Num v={l.base_target} /></td><td><Num v={l.adjustment} /></td></tr>)}
        </tbody></table>}</div>) : <p className="muted">{t('fx.none')}</p>}
    </div>
  </section>;
}
