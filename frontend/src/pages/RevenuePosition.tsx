import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '../lib/api';
import { Num, Row, Table, ask } from '../components/RecordTable';
import { useI18n, type MessageKey } from '../lib/i18n';

// Stage 33 (DEC-009 flows were API-only): revenue recognition runs, price estimates, client retention release and the
// contract receivable position. Every figure of a run is computed by the database; the separation of duties
// (preparer / approver, estimate author / approver, IPC preparer / retention releaser) is enforced by the API.
// R1.2: labels from messages/revenue.ts, stored codes (status, kind) through tv(); server messages are shown as sent.

const money = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const today = () => new Date().toISOString().slice(0, 10);
type Missed = [MessageKey, string];

const KPIS: [string, MessageKey][] = [['billed_gross', 'revenue.kpiBilledGross'], ['billed_net', 'revenue.kpiBilledNet'], ['collected', 'revenue.kpiCollected'], ['receivables_outstanding', 'revenue.kpiOutstanding'],
  ['retention_held', 'revenue.kpiRetentionHeld'], ['retention_released', 'revenue.kpiRetentionReleased'], ['advances_received', 'revenue.kpiAdvancesReceived'], ['advance_recovered', 'revenue.kpiAdvanceRecovered'], ['advance_liability', 'revenue.kpiAdvanceLiability']];

export function RevenuePosition() {
  const { t, tv } = useI18n();
  const [err, setErr] = useState('');
  const [unloaded, setUnloaded] = useState<Missed[]>([]);
  const [contracts, setContracts] = useState<[number, string][]>([]);
  const [contractId, setContractId] = useState(0);
  const [position, setPosition] = useState<Row | null>(null);
  const [runs, setRuns] = useState<Row[]>([]);
  const [estimates, setEstimates] = useState<Row[]>([]);
  const [retentions, setRetentions] = useState<Row[]>([]);

  async function load() {
    const missed = new Map<MessageKey, string>();
    const settle = async <T,>(p: Promise<T>, fallback: T, section: MessageKey) => { try { return await p; } catch (x: any) { missed.set(section, x.message); return fallback; } };
    // Contracts the user may see: the contract register if permitted, otherwise the contracts behind client IPCs.
    const listed = new Map<number, string>();
    for (const c of (await settle(apiGet<any>('/contracts'), { data: [] }, 'revenue.secContracts')).data) listed.set(Number(c.id), `${c.project_code} — ${c.project_name} (${c.client_name})`);
    for (const i of (await settle(apiGet<any>('/finance/ipcs'), { data: [] }, 'revenue.secIpcs')).data) if (!listed.has(Number(i.contract_id))) listed.set(Number(i.contract_id), `${i.contract_ref ?? i.contract_id} — ${i.project_name}`);
    setContracts([...listed.entries()]);
    if (contractId) {
      setPosition((await settle(apiGet<any>(`/finance/contracts/${contractId}/receivable-position`), { data: null }, 'revenue.secPosition')).data);
      setRuns((await settle(apiGet<any>(`/finance/revenue-runs?contract_id=${contractId}`), { data: [] }, 'revenue.secRuns')).data.map((r: Row) => ({
        ...r, period: `${String(r.period_start).slice(0, 10)} → ${String(r.period_end).slice(0, 10)}`,
        progress_pct: r.progress === null ? null : (Number(r.progress) * 100).toFixed(2) + ' %',
        position_kind: Number(r.contract_position) > 0 ? 'asset' : Number(r.contract_position) < 0 ? 'liability' : null })));
      setEstimates((await settle(apiGet<any>(`/finance/revenue-estimates?contract_id=${contractId}`), { data: [] }, 'revenue.secEstimates')).data);
      setRetentions((await settle(apiGet<any>(`/finance/retentions?contract_id=${contractId}`), { data: [] }, 'revenue.secRetentions')).data);
    }
    setUnloaded([...missed.entries()]);
  }
  const run = async (fn: () => Promise<unknown>) => { try { setErr(''); await fn(); await load(); } catch (x: any) { setErr(x.message); } };
  useEffect(() => { load().catch(x => setErr(x.message)); }, [contractId]);
  const cols = (c: [string, MessageKey][]): [string, string][] => c.map(([k, h]) => [k, t(h)]);

  return (
    <section className="page-stack">
      <header className="page-header"><div><p className="eyebrow">{t('revenue.eyebrow')}</p><h1>{t('revenue.title')}</h1>
        <p>{t('revenue.intro')}</p></div></header>
      {err && <div className="notice" role="alert">{err}</div>}
      {unloaded.length > 0 && <div className="notice muted" data-section="unloaded">{t('revenue.notLoaded', { list: unloaded.map(([k, m]) => `${t(k)} (${m})`).join('; ') })}</div>}

      <div className="panel">
        <label>{t('revenue.contract')} <select aria-label={t('revenue.contract')} value={contractId} onChange={e => setContractId(Number(e.target.value))}>
          <option value={0}>{t('revenue.selectContract')}</option>{contracts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      </div>

      {contractId > 0 && <>
        <div className="panel" data-section="position"><h2>{t('revenue.position')}</h2>
          {position && <div className="kpi-grid">{KPIS.map(([k, l]) => <div className="kpi" key={k}><span>{t(l)}</span><strong><Num text={money(position[k])} /></strong></div>)}</div>}
        </div>

        <div className="panel" data-section="revenue-runs"><h2>{t('revenue.runs')}</h2>
          <p className="muted">{t('revenue.runsNote')}</p>
          <button onClick={() => run(() => apiPost('/finance/revenue-runs', { contract_id: contractId, period_start: ask(t('revenue.askPeriodStart')), period_end: ask(t('revenue.askPeriodEnd')) || today() }))}>{t('revenue.prepareRun')}</button>
          <Table rows={runs.map(r => ({ ...r, status_label: tv(r.status), position_kind_label: tv(r.position_kind) }))} cols={cols([['period', 'revenue.colPeriod'], ['status_label', 'revenue.colStatus'], ['transaction_price', 'revenue.colPrice'], ['cost_to_date', 'revenue.colCostToDate'], ['eac', 'revenue.colEac'], ['progress_pct', 'revenue.colProgress'],
            ['cumulative_revenue', 'revenue.colRevenueToDate'], ['period_revenue', 'revenue.colPeriodRevenue'], ['loss_provision', 'revenue.colOnerous'], ['billings_to_date', 'revenue.colBilled'], ['contract_position', 'revenue.colPosition'], ['position_kind_label', 'revenue.colAssetLiability']])}
            actions={r => r.status === 'prepared' ? <>
              <button onClick={() => run(() => apiPost(`/finance/revenue-runs/${r.id}/approve`, {}))}>{t('revenue.approvePost')}</button>
              <button onClick={() => run(() => apiDelete(`/finance/revenue-runs/${r.id}`))}>{t('revenue.discard')}</button>
            </> : null} />
        </div>

        <div className="panel" data-section="price-estimates"><h2>{t('revenue.estimates')}</h2>
          <p className="muted">{t('revenue.estimatesNote')}</p>
          <button onClick={() => run(() => apiPost('/finance/revenue-estimates', { contract_id: contractId, kind: ask(t('revenue.askKind')), amount: Number(ask(t('revenue.askAmount'))),
            effective_from: ask(t('revenue.askEffectiveFrom')) || today(), basis: ask(t('revenue.askBasis')), evidence_reference: ask(t('revenue.askEvidence')) }))}>{t('revenue.addEstimate')}</button>
          <Table rows={estimates.map(e => ({ ...e, kind_label: tv(e.kind), status_label: tv(e.status) }))} cols={cols([['kind_label', 'revenue.colKind'], ['amount', 'revenue.colAmount'], ['effective_from', 'revenue.colFrom'], ['status_label', 'revenue.colStatus'], ['basis', 'revenue.colBasis'], ['evidence_reference', 'revenue.colEvidence'], ['retired_on', 'revenue.colRetiredOn']])}
            actions={e => <>
              {e.status === 'draft' && <button onClick={() => run(() => apiPost(`/finance/revenue-estimates/${e.id}/approve`, {}))}>{t('revenue.approve')}</button>}
              {e.status === 'approved' && <button onClick={() => run(() => apiPost(`/finance/revenue-estimates/${e.id}/retire`, { retired_on: ask(t('revenue.askRetiredOn')) || today(), reason: ask(t('revenue.askRetireReason')) }))}>{t('revenue.retire')}</button>}
            </>} />
        </div>

        <div className="panel" data-section="retentions"><h2>{t('revenue.retention')}</h2>
          <p className="muted">{t('revenue.retentionNote')}</p>
          <Table rows={retentions.map(r => ({ ...r, release_status_label: tv(r.release_status) }))} cols={cols([['ipc_no', 'revenue.colIpc'], ['retained_amount', 'revenue.colAmount'], ['release_status_label', 'revenue.colStatus'], ['release_reference', 'revenue.colCertificate'], ['release_reason', 'revenue.colReason'], ['release_receivable_id', 'revenue.colReceivable']])}
            actions={r => r.release_status === 'held' ? <button onClick={() => run(() => apiPost(`/finance/retentions/${r.id}/release`, { reason: ask(t('revenue.askReleaseReason')), reference: ask(t('revenue.askCertificate')) }))}>{t('revenue.release')}</button> : null} />
        </div>
      </>}
    </section>
  );
}
