import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Num, Table } from '../components/RecordTable';

// R1.2: labels from messages/executive.ts; statuses through tv(). CC-075 defects fixed: committed and actual cost were
// added across currencies (the API now returns one row per project and currency, and the tiles are per currency);
// the portfolio was shown as a raw JSON dump and the quality, HSE, schedule and approval data were loaded but never
// shown (now labelled tables); development badges ("Phase 6", "Live API") removed.
type ApiResponse<T> = { success: boolean; data: T };
type ExecutiveData = { portfolio: any[]; approvals: any[]; financial: any[]; quality: any[]; hse: any[]; schedule: any[] };

export function ExecutiveDashboard() {
  const { t, tv } = useI18n();
  const [data, setData] = useState<ExecutiveData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ApiResponse<ExecutiveData>>('/dashboards/executive')
      .then((res) => setData(res.data))
      .catch((err) => setError(err.message));
  }, []);

  const projects = data?.portfolio?.length ?? 0;
  const pendingApprovals = data?.approvals?.find((x) => x.status === 'pending')?.count ?? 0;
  const totals = new Map<string, { committed: number; actual: number }>();
  for (const r of data?.financial ?? []) {
    const x = totals.get(r.currency_code) ?? { committed: 0, actual: 0 };
    x.committed += Number(r.committed ?? 0); x.actual += Number(r.actual ?? 0);
    totals.set(r.currency_code, x);
  }
  const money = (v: number) => v.toLocaleString('en-US');
  const project = (r: any) => r.project_code ? `${r.project_code} — ${r.project_name}` : r.project_name;

  return (
    <section className="page-stack">
      <header className="page-header"><div><h1>{t('ex.title')}</h1></div></header>
      {error && <div className="notice" role="alert">{t('ex.apiError')} <bdi>{error}</bdi></div>}
      <div className="kpi-grid" data-section="kpis">
        <article className="kpi-card"><small>{t('ex.projects')}</small><strong><Num v={projects} /></strong></article>
        <article className="kpi-card"><small>{t('ex.pendingApprovals')}</small><strong><Num v={pendingApprovals} /></strong></article>
        {[...totals].map(([currency, x]) => <article className="kpi-card" key={`c${currency}`}><small>{t('ex.committedCost', { currency })}</small><strong><Num text={money(x.committed)} /></strong></article>)}
        {[...totals].map(([currency, x]) => <article className="kpi-card" key={`a${currency}`}><small>{t('ex.actualCost', { currency })}</small><strong><Num text={money(x.actual)} /></strong></article>)}
      </div>
      {data && !totals.size && <p className="muted">{t('ex.noCost')}</p>}
      <div className="panel" data-section="portfolio"><h2>{t('ex.portfolio')}</h2>
        <Table rows={(data?.portfolio ?? []).map(r => ({ ...r, project: project(r), status: tv(r.status), percent_billed: `${Number(r.percent_billed ?? 0).toFixed(2)} %` }))}
          cols={[['project', t('ex.colProject')], ['status', t('ex.colStatus')], ['current_contract_value', t('ex.colContractValue')], ['currency_code', t('ex.colCurrency')], ['percent_billed', t('ex.colBilled')], ['cost_performance_index', t('ex.colCpi')], ['schedule_performance_index', t('ex.colSpi')], ['snapshot_date', t('ex.colSnapshot')]]} />
      </div>
      <div className="panel" data-section="financial"><h2>{t('ex.financial')}</h2>
        <Table rows={(data?.financial ?? []).map(r => ({ ...r, id: `${r.project_id}-${r.currency_code}`, project: project(r) }))}
          cols={[['project', t('ex.colProject')], ['currency_code', t('ex.colCurrency')], ['committed', t('ex.colCommitted')], ['actual', t('ex.colActual')], ['ar_open', t('ex.colArOpen')], ['ap_open', t('ex.colApOpen')]]} />
      </div>
      <div className="panel" data-section="quality"><h2>{t('ex.quality')}</h2>
        <Table rows={(data?.quality ?? []).map(r => ({ ...r, id: r.project_id }))} cols={[['project_name', t('ex.colProject')], ['inspections', t('ex.colInspections')], ['inspections_passed', t('ex.colPassed')], ['open_ncrs', t('ex.colOpenNcrs')]]} />
      </div>
      <div className="panel" data-section="hse"><h2>{t('ex.hse')}</h2>
        <Table rows={(data?.hse ?? []).map(r => ({ ...r, id: r.project_id }))} cols={[['project_name', t('ex.colProject')], ['major_incidents', t('ex.colSeriousIncidents')], ['active_ptw', t('ex.colActivePtw')], ['toolbox_talks', t('ex.colToolboxTalks')]]} />
      </div>
      <div className="panel" data-section="schedule"><h2>{t('ex.schedule')}</h2>
        <Table rows={(data?.schedule ?? []).map(r => ({ ...r, id: r.project_id }))} cols={[['project_name', t('ex.colProject')], ['activities', t('ex.colActivities')], ['completed_activities', t('ex.colCompleted')], ['delayed_activities', t('ex.colDelayed')]]} />
      </div>
      <div className="panel" data-section="approvals"><h2>{t('ex.approvals')}</h2>
        <Table rows={(data?.approvals ?? []).map(r => ({ id: r.status, status: tv(r.status), count: r.count }))} cols={[['status', t('ex.colStatus')], ['count', t('ex.colCount')]]} />
      </div>
    </section>
  );
}
