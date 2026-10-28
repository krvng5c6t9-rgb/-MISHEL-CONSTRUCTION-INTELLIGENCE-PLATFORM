import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { NotLoaded, Num } from '../components/RecordTable';
import { NAME as ALERT_NAME } from './Notifications';

// R1.6 (MP-06 §5, CC-087): the owner portfolio v1. Figures are shown as the API returns them (computed by the database,
// one line per currency, never added across currencies); each value opens the screen holding its records. Sections the
// user may not read are named, not shown empty; what has no source data yet is stated, not estimated.
type Row = Record<string, any>;
const SECTION: Record<string, MessageKey> = { money: 'pf.secMoney', evm: 'pf.secEvm', forecast: 'pf.secForecast', schedule: 'pf.secSchedule',
  risks: 'pf.secRisks', ncrs: 'pf.secNcrs', incidents: 'pf.secIncidents', tenders: 'pf.secTenders' };

export function OwnerPortfolio() {
  const { t, tv } = useI18n();
  const [d, setD] = useState<Row | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { apiGet<{ data: Row }>('/dashboards/owner-portfolio').then(r => setD(r.data)).catch((e: any) => setErr(e.message)); }, []);
  // A value opens its records; an empty value is shown as a plain dash (nothing to open).
  const go = (to: string, v: unknown, text?: string) => (text === undefined && (v === null || v === undefined || v === '—') ? <>—</> : <Link to={to}><Num v={v} text={text} /></Link>);
  const projects: Row[] = d?.projects ?? [];
  const show = (s: string) => !d?.withheld?.some((w: Row) => w.section === s);
  const totals = new Map<string, Row>();
  for (const r of d?.contract_totals ?? []) totals.set(r.currency, { ...r });
  for (const r of d?.money_totals ?? []) totals.set(r.currency, { ...(totals.get(r.currency) ?? { currency: r.currency }), ...r });
  const pc = (p: Row) => `/project-controls?project=${p.id}`;
  const name = (p: Row) => <Link to={pc(p)}><bdi>{p.project_code}</bdi> — {p.project_name}</Link>;

  return (
    <section className="page-stack">
      <header className="page-header"><div><h1>{t('pf.title')}</h1><p>{t('pf.intro')}</p>{d && <p className="muted" data-as-of>{t('pf.asOf')}<span className="num" dir="ltr">{d.as_of}</span></p>}</div></header>
      {err && <div className="notice" role="alert"><bdi>{err}</bdi></div>}
      {d?.withheld?.length > 0 && <div className="notice" data-withheld><NotLoaded text={t('pf.withheld')} items={d!.withheld.map((w: Row) => [t(SECTION[w.section]), w.permission])} /></div>}
      {d && <>
        <div className="cards-grid" data-section="status">
          {d.status_counts.map((s: Row) => <div className="metric-card" key={s.status}><span>{tv(s.status)}</span><strong><Num v={s.count} /></strong></div>)}
        </div>

        <div className="panel" data-section="totals"><h2>{t('pf.totals')}</h2>
          {totals.size ? <div className="table-wrap"><table><thead><tr><th>{t('pf.colCurrency')}</th><th>{t('pf.colProjects')}</th><th>{t('pf.colActiveContract')}</th>
            {show('money') && <><th>{t('pf.colBilled')}</th><th>{t('pf.colCollected')}</th><th>{t('pf.colWithheld')}</th><th>{t('pf.colOutstanding')}</th><th>{t('pf.colOverdue')}</th></>}</tr></thead>
            <tbody>{[...totals.values()].map(r => <tr key={r.currency}><td><bdi>{r.currency}</bdi></td><td><Num v={r.projects ?? '—'} /></td><td>{go('/projects', r.contract_value ?? '—')}</td>
              {show('money') && <><td>{go('/payments-certification', r.billed ?? '—')}</td><td>{go('/finance', r.collected ?? '—')}</td><td>{go('/finance', r.withheld ?? '—')}</td>
                <td>{go('/payments-certification', r.outstanding ?? '—')}</td><td>{go('/payments-certification', r.overdue ?? '—')}</td></>}</tr>)}</tbody></table></div>
            : <p className="muted">{t('pf.none')}</p>}
        </div>

        <div className="panel" data-section="commercial"><h2>{t('pf.commercial')}</h2>
          <div className="table-wrap"><table><thead><tr><th>{t('pf.colProject')}</th><th>{t('pf.colStatus')}</th><th>{t('pf.colContract')}</th>
            {show('money') && <><th>{t('pf.colCertified')}</th><th>{t('pf.colCurrency')}</th><th>{t('pf.colBilled')}</th><th>{t('pf.colCollected')}</th><th>{t('pf.colWithheld')}</th><th>{t('pf.colOutstanding')}</th><th>{t('pf.colOverdue')}</th></>}</tr></thead>
            <tbody>{projects.map(p => {
              const money: Row[] = p.money?.length ? p.money : [null];
              return <Fragment key={p.id}>{money.map((m, i) => <tr key={`${p.id}-${i}`} data-project={p.project_code}>
                <td>{i === 0 && name(p)}</td><td>{i === 0 && tv(p.status)}</td><td>{i === 0 && <><Num v={p.contract_value} /> <bdi>{p.currency}</bdi></>}</td>
                {show('money') && <><td>{i === 0 && (p.certified ? go('/payments-certification', p.certified.certified) : '—')}</td><td><bdi>{m?.currency ?? '—'}</bdi></td>
                  <td>{m ? go('/payments-certification', m.billed) : '—'}</td><td>{m ? go('/finance', m.collected) : '—'}</td><td>{m ? go('/finance', m.withheld) : '—'}</td>
                  <td>{m ? go('/payments-certification', m.outstanding) : '—'}</td><td>{m ? go('/payments-certification', m.overdue) : '—'}</td></>}
              </tr>)}</Fragment>;
            })}</tbody></table></div>
        </div>

        <div className="panel" data-section="delivery"><h2>{t('pf.delivery')}</h2>
          <div className="table-wrap"><table><thead><tr><th>{t('pf.colProject')}</th>
            {show('schedule') && <th>{t('pf.colActivities')}</th>}{show('evm') && <th>{t('pf.colEvm')}</th>}{show('forecast') && <th>{t('pf.colForecast')}</th>}
            {show('risks') && <th>{t('pf.colRisks')}</th>}{show('ncrs') && <th>{t('pf.colNcrs')}</th>}{show('incidents') && <th>{t('pf.colIncidents')}</th>}</tr></thead>
            <tbody>{projects.map(p => <tr key={p.id} data-project={p.project_code}><td>{name(p)}</td>
              {show('schedule') && <td>{p.schedule ? go('/planning', null, `${p.schedule.late} / ${p.schedule.activities}`) : '—'}</td>}
              {show('evm') && <td>{p.evm ? <Link to="/cost-control">{t('pf.evm', { pv: p.evm.pv ?? '—', ev: p.evm.ev ?? '—', ac: p.evm.ac ?? '—', spi: p.evm.spi ?? '—', cpi: p.evm.cpi ?? '—', date: p.evm.snapshot_date })}</Link> : <span className="muted">{t('pf.noSnapshot')}</span>}</td>}
              {show('forecast') && <td>{p.forecast ? <Link to="/cost-control">{t('pf.forecast', { budget: p.forecast.budget, eac: p.forecast.eac, date: p.forecast.as_of })}</Link> : '—'}</td>}
              {show('risks') && <td>{p.risks ? <Link to={pc(p)}>{t('pf.risk', { count: p.risks.open_risks, score: p.risks.top_score ?? '—', title: p.risks.top_risk_title })}</Link> : <Num v={0} />}</td>}
              {show('ncrs') && <td>{go('/qaqc', p.ncrs?.open_ncrs ?? 0)}</td>}
              {show('incidents') && <td>{go('/hse', null, `${p.incidents?.open_incidents ?? 0} / ${p.incidents?.incidents ?? 0}`)}</td>}
            </tr>)}</tbody></table></div>
        </div>

        <div className="panel" data-section="alerts"><h2>{t('pf.alerts')}</h2>
          {d.alerts.length ? <div className="table-wrap"><table><thead><tr><th>{t('pf.colAlert')}</th><th>{t('pf.colUnread')}</th></tr></thead>
            <tbody>{d.alerts.map((a: Row) => <tr key={a.alert_code}><td>{ALERT_NAME[a.alert_code] ? t(ALERT_NAME[a.alert_code]) : <bdi>{a.alert_code}</bdi>}</td><td>{go('/notifications', a.unread)}</td></tr>)}</tbody></table></div>
            : <p className="muted">{t('pf.none')}</p>}
        </div>

        {show('tenders') && <div className="panel" data-section="tenders"><h2>{t('pf.tenders')}</h2>
          {d.tenders?.length ? <div className="table-wrap"><table><thead><tr><th>{t('pf.colStatus')}</th><th>{t('pf.colCount')}</th></tr></thead>
            <tbody>{d.tenders.map((s: Row) => <tr key={s.status}><td>{tv(s.status)}</td><td>{go('/tendering', s.count)}</td></tr>)}</tbody></table></div>
            : <p className="muted">{t('pf.none')}</p>}
        </div>}

        <div className="panel" data-section="not-available"><h2>{t('pf.notAvailable')}</h2><p>{t('pf.notAvailableText')}</p></div>
      </>}
    </section>
  );
}
