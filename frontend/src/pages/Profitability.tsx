import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Num, type Row } from '../components/RecordTable';

// CC-091 (Stage 62, A-006): is each project making or losing money - recognised (latest approved revenue run), at
// completion (approved cost forecasts covering every cost code with cost), cost now and cash, per currency. Every figure
// comes from GET /finance/profitability (computed by the database); the screen adds nothing up and assumes nothing.
const neg = (v: unknown) => typeof v === 'string' && v.startsWith('-');
const pct = (v: unknown) => (v === null || v === undefined ? '—' : `${v} %`);

export function Profitability() {
  const { t, tv } = useI18n();
  const [d, setD] = useState<any>(null), [error, setError] = useState('');
  useEffect(() => { apiGet<any>('/finance/profitability').then(r => setD(r.data)).catch(e => setError(e.message)); }, []);
  const money = (v: unknown) => <span className={neg(v) ? 'amount-negative' : undefined}><Num v={v} /></span>;
  const project = (p: Row) => <Link to={`/project-controls?project=${p.id}`}><bdi>{p.project_code}</bdi> — {p.project_name}</Link>;

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('pr.eyebrow')}</p><h1>{t('pr.title')}</h1><p>{t('pr.intro')}</p>
      {d && <p className="muted">{t('pr.asOf')}<span dir="ltr">{d.as_of}</span></p>}</div></header>
    {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}
    {d && <>
      <div className="panel" data-section="totals"><h2>{t('pr.totals')}</h2>
        {d.totals.length ? <div className="table-wrap"><table><thead><tr><th>{t('pr.colCurrency')}</th><th>{t('pr.colProjects')}</th><th>{t('pr.colRevenue')}</th><th>{t('pr.colCost')}</th><th>{t('pr.colProfit')}</th><th>{t('pr.colMargin')}</th><th>{t('pr.colPrice')}</th><th>{t('pr.colEac')}</th><th>{t('pr.colForecastProfit')}</th><th>{t('pr.colForecastMargin')}</th><th>{t('pr.colActual')}</th><th>{t('pr.colCommitted')}</th></tr></thead>
          <tbody>{d.totals.map((x: Row) => <tr key={x.currency} data-currency={x.currency}><td><bdi>{x.currency}</bdi></td><td><Num v={x.projects} /></td><td>{money(x.recognised_revenue)}</td><td>{money(x.recognised_cost)}</td><td>{money(x.recognised_profit)}</td><td><Num text={pct(x.recognised_margin_pct)} /></td><td>{money(x.forecast_price)}</td><td>{money(x.eac)}</td><td>{money(x.forecast_profit)}</td><td><Num text={pct(x.forecast_margin_pct)} /></td><td>{money(x.actual_cost)}</td><td>{money(x.committed_cost)}</td></tr>)}</tbody></table></div> : <p>{t('pr.none')}</p>}
        {d.totals.map((x: Row) => <p className="muted" key={x.currency} data-coverage={x.currency}><bdi>{x.currency}</bdi>: {t('pr.coverage', { recognised: x.projects_recognised, forecast: x.projects_forecast, projects: x.projects })}</p>)}
      </div>

      <div className="panel" data-section="projects"><h2>{t('pr.projects')}</h2>
        <div className="table-wrap"><table><thead><tr><th>{t('pr.colProject')}</th><th>{t('pr.colCurrency')}</th><th>{t('pr.colContract')}</th><th>{t('pr.colRevenue')}</th><th>{t('pr.colCost')}</th><th>{t('pr.colProfit')}</th><th>{t('pr.colMargin')}</th><th>{t('pr.colProgress')}</th><th>{t('pr.colPosition')}</th><th>{t('pr.colPrice')}</th><th>{t('pr.colEac')}</th><th>{t('pr.colForecastProfit')}</th><th>{t('pr.colForecastMargin')}</th><th>{t('pr.colActual')}</th><th>{t('pr.colCommitted')}</th></tr></thead>
          <tbody>{d.projects.map((p: Row) => <tr key={p.id} data-project={p.project_code} data-loss={neg(p.recognised_profit) || neg(p.forecast_profit) ? 'yes' : 'no'}>
            <td>{project(p)}<div className="muted">{tv(p.status)}</div></td><td><bdi>{p.currency}</bdi></td><td>{money(p.contract_value)}</td>
            {p.recognised_revenue === null ? <td colSpan={6} className="muted" data-note="no-run">{t('pr.noRun')}</td> : <>
              <td>{money(p.recognised_revenue)}</td><td>{money(p.recognised_cost)}</td><td>{money(p.recognised_profit)}{neg(p.recognised_profit) && <span className="badge-loss"> {t('pr.lossMaking')}</span>}</td>
              <td><Num text={pct(p.recognised_margin_pct)} /></td><td><Num text={pct(p.progress_pct)} /></td><td>{money(p.contract_position)}</td></>}
            {p.eac === null ? <td colSpan={4} className="muted" data-note="no-forecast">{p.forecast_missing_cost_codes > 0 ? t('pr.missingForecast', { count: p.forecast_missing_cost_codes }) : t('pr.noForecast')}</td> : <>
              <td>{money(p.forecast_price)}</td><td>{money(p.eac)}</td><td>{money(p.forecast_profit)}</td><td><Num text={pct(p.forecast_margin_pct)} /></td></>}
            <td>{money(p.actual_cost)}</td><td>{money(p.committed_cost)}</td></tr>)}</tbody></table></div></div>

      <div className="panel" data-section="cash-totals"><h2>{t('pr.cashTotals')}</h2>
        {d.cash_totals.length ? <div className="table-wrap"><table><thead><tr><th>{t('pr.colCurrency')}</th><th>{t('pr.colBilled')}</th><th>{t('pr.colCollected')}</th><th>{t('pr.colPaid')}</th><th>{t('pr.colNet')}</th></tr></thead>
          <tbody>{d.cash_totals.map((x: Row) => <tr key={x.currency}><td><bdi>{x.currency}</bdi></td><td>{money(x.billed)}</td><td>{money(x.collected)}</td><td>{money(x.paid)}</td><td>{money(x.net_cash)}</td></tr>)}</tbody></table></div> : <p>{t('pr.none')}</p>}</div>
      <div className="panel" data-section="cash"><h2>{t('pr.cash')}</h2>
        {d.cash.length ? <div className="table-wrap"><table><thead><tr><th>{t('pr.colProject')}</th><th>{t('pr.colCurrency')}</th><th>{t('pr.colBilled')}</th><th>{t('pr.colCollected')}</th><th>{t('pr.colPaid')}</th><th>{t('pr.colNet')}</th></tr></thead>
          <tbody>{d.cash.map((x: Row) => { const p = d.projects.find((y: Row) => y.id === x.project_id) ?? { id: x.project_id, project_code: `#${x.project_id}`, project_name: '' };
            return <tr key={`${x.project_id}-${x.currency}`}><td>{project(p)}</td><td><bdi>{x.currency}</bdi></td><td>{money(x.billed)}</td><td>{money(x.collected)}</td><td>{money(x.paid)}</td><td>{money(x.net_cash)}</td></tr>; })}</tbody></table></div> : <p>{t('pr.none')}</p>}</div>

      <div className="panel" data-section="basis"><h2>{t('pr.basis')}</h2><ul><li>{t('pr.basisRecognised')}</li><li>{t('pr.basisForecast')}</li><li>{t('pr.basisCash')}</li></ul></div>
    </>}
  </section>;
}
