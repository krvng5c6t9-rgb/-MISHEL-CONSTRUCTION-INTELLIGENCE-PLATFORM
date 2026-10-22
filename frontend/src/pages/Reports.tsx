import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Table } from '../components/RecordTable';

// R1.2: labels from messages/reports.ts; statuses through tv(). CC-075: the two reports were shown as raw JSON dumps;
// they are now labelled tables. The weekly report counts fatalities as serious incidents (the API counted the code
// 'fatal', which incidents never store).
type ApiResponse<T> = { success: boolean; data: T; meta?: { pending_approvals_without_project?: number } };

export function Reports() {
  const { t, tv } = useI18n();
  const [cost, setCost] = useState<any[]>([]);
  const [weekly, setWeekly] = useState<any[]>([]);
  const [unscoped, setUnscoped] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      apiGet<ApiResponse<any[]>>('/reports/cost-summary'),
      apiGet<ApiResponse<any[]>>('/reports/weekly-executive')
    ]).then(([a, b]) => { setCost(a.data); setWeekly(b.data); setUnscoped(b.meta?.pending_approvals_without_project ?? null); }).catch((err) => setError(err.message));
  }, []);
  const idx = (v: any, ok: boolean) => (ok && v != null ? v : t('rp.noEvm'));
  return (
    <section className="page-stack">
      <header className="page-header"><div><h1>{t('rp.title')}</h1></div></header>
      {error && <div className="notice" role="alert">{t('rp.apiError')} <bdi>{error}</bdi></div>}
      <div className="panel" data-section="weekly"><h2>{t('rp.weekly')}</h2>
        <Table rows={weekly.map(r => ({ ...r, id: r.project_id, status: tv(r.status), spi: idx(r.spi, r.evm_available), cpi: idx(r.cpi, r.evm_available) }))}
          cols={[['project_name', t('rp.colProject')], ['status', t('rp.colStatus')], ['spi', t('rp.colSpi')], ['cpi', t('rp.colCpi')], ['pending_approvals', t('rp.colPendingApprovals')], ['open_ncrs', t('rp.colOpenNcrs')], ['open_snags', t('rp.colOpenSnags')], ['major_hse_incidents', t('rp.colSeriousIncidents')]]} />
        {unscoped != null && <p className="muted">{t('rp.unscoped', { n: unscoped })}</p>}
      </div>
      <div className="panel" data-section="cost"><h2>{t('rp.costSummary')}</h2>
        <p className="muted">{t('rp.costNote')}</p>
        <Table rows={cost.map(r => ({ ...r, id: `${r.project_id}-${r.cost_code_id}` }))}
          cols={[['project_id', t('rp.colProjectId')], ['code', t('rp.colCode')], ['description', t('rp.colDescription')], ['budget', t('rp.colBudget')], ['committed', t('rp.colCommitted')], ['actual', t('rp.colActual')], ['estimate_at_completion', t('rp.colEac')], ['variance_at_completion', t('rp.colVac')]]} />
      </div>
    </section>
  );
}
