import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '../lib/api';
import { Row, Table, ask } from '../components/RecordTable';

// Stage 33 (DEC-009 flows were API-only): revenue recognition runs, price estimates, client retention release and the
// contract receivable position. Every figure of a run is computed by the database; the separation of duties
// (preparer / approver, estimate author / approver, IPC preparer / retention releaser) is enforced by the API.

const money = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const today = () => new Date().toISOString().slice(0, 10);

export function RevenuePosition() {
  const [err, setErr] = useState('');
  const [unloaded, setUnloaded] = useState<string[]>([]);
  const [contracts, setContracts] = useState<[number, string][]>([]);
  const [contractId, setContractId] = useState(0);
  const [position, setPosition] = useState<Row | null>(null);
  const [runs, setRuns] = useState<Row[]>([]);
  const [estimates, setEstimates] = useState<Row[]>([]);
  const [retentions, setRetentions] = useState<Row[]>([]);

  async function load() {
    const missed = new Set<string>();
    const settle = async <T,>(p: Promise<T>, fallback: T, section: string) => { try { return await p; } catch (x: any) { missed.add(`${section} (${x.message})`); return fallback; } };
    // Contracts the user may see: the contract register if permitted, otherwise the contracts behind client IPCs.
    const listed = new Map<number, string>();
    for (const c of (await settle(apiGet<any>('/contracts'), { data: [] }, 'contract register')).data) listed.set(Number(c.id), `${c.project_code} — ${c.project_name} (${c.client_name})`);
    for (const i of (await settle(apiGet<any>('/finance/ipcs'), { data: [] }, 'client IPCs')).data) if (!listed.has(Number(i.contract_id))) listed.set(Number(i.contract_id), `${i.contract_ref ?? i.contract_id} — ${i.project_name}`);
    setContracts([...listed.entries()]);
    if (contractId) {
      setPosition((await settle(apiGet<any>(`/finance/contracts/${contractId}/receivable-position`), { data: null }, 'contract position')).data);
      setRuns((await settle(apiGet<any>(`/finance/revenue-runs?contract_id=${contractId}`), { data: [] }, 'revenue runs')).data.map((r: Row) => ({
        ...r, period: `${String(r.period_start).slice(0, 10)} → ${String(r.period_end).slice(0, 10)}`,
        progress_pct: r.progress === null ? null : (Number(r.progress) * 100).toFixed(2) + ' %',
        position_kind: Number(r.contract_position) > 0 ? 'asset' : Number(r.contract_position) < 0 ? 'liability' : '—' })));
      setEstimates((await settle(apiGet<any>(`/finance/revenue-estimates?contract_id=${contractId}`), { data: [] }, 'price estimates')).data);
      setRetentions((await settle(apiGet<any>(`/finance/retentions?contract_id=${contractId}`), { data: [] }, 'retentions')).data);
    }
    setUnloaded([...missed]);
  }
  const run = async (fn: () => Promise<unknown>) => { try { setErr(''); await fn(); await load(); } catch (x: any) { setErr(x.message); } };
  useEffect(() => { load().catch(x => setErr(x.message)); }, [contractId]);

  const kpis: [string, string][] = [['billed_gross', 'Billed (gross)'], ['billed_net', 'Billed (net)'], ['collected', 'Collected'], ['receivables_outstanding', 'Receivables outstanding'],
    ['retention_held', 'Retention held'], ['retention_released', 'Retention released'], ['advances_received', 'Advances received'], ['advance_recovered', 'Advance recovered'], ['advance_liability', 'Advance liability']];

  return (
    <section className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Finance</p><h1>Revenue &amp; Contract Position</h1>
        <p>Revenue recognised over time (cost-to-cost, DEC-009), price estimates approved by a second person, client retention release, and what each contract has billed, collected and holds.</p></div></header>
      {err && <div className="notice" role="alert">{err}</div>}
      {unloaded.length > 0 && <div className="notice muted" data-section="unloaded">Not loaded for this user: {unloaded.join('; ')}</div>}

      <div className="panel">
        <label>Contract <select aria-label="Contract" value={contractId} onChange={e => setContractId(Number(e.target.value))}>
          <option value={0}>Select a contract</option>{contracts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      </div>

      {contractId > 0 && <>
        <div className="panel" data-section="position"><h2>Contract receivable position</h2>
          {position && <div className="kpi-grid">{kpis.map(([k, l]) => <div className="kpi" key={k}><span>{l}</span><strong>{money(position[k])}</strong></div>)}</div>}
        </div>

        <div className="panel" data-section="revenue-runs"><h2>Revenue recognition runs</h2>
          <p className="muted">Prepared by one person, approved and posted by another. Price, progress (cost to date ÷ EAC from approved cost snapshots inside the period), revenue, onerous provision and contract asset/liability are computed by the database and frozen with a hash.</p>
          <button onClick={() => run(() => apiPost('/finance/revenue-runs', { contract_id: contractId, period_start: ask('Period start (YYYY-MM-DD)'), period_end: ask('Period end (YYYY-MM-DD)') || today() }))}>Prepare run</button>
          <Table rows={runs} cols={[['period', 'Period'], ['status', 'Status'], ['transaction_price', 'Price'], ['cost_to_date', 'Cost to date'], ['eac', 'EAC'], ['progress_pct', 'Progress'],
            ['cumulative_revenue', 'Revenue to date'], ['period_revenue', 'Period revenue'], ['loss_provision', 'Onerous provision'], ['billings_to_date', 'Billed'], ['contract_position', 'Position'], ['position_kind', 'Asset / liability']]}
            actions={r => r.status === 'prepared' ? <>
              <button onClick={() => run(() => apiPost(`/finance/revenue-runs/${r.id}/approve`, {}))}>Approve &amp; post</button>
              <button onClick={() => run(() => apiDelete(`/finance/revenue-runs/${r.id}`))}>Discard</button>
            </> : null} />
        </div>

        <div className="panel" data-section="price-estimates"><h2>Price estimates (unpriced variations, claims, expected delay damages)</h2>
          <p className="muted">Included in the transaction price only when approved by a second person, with a written basis that a significant reversal is highly improbable. Delay damages are entered as negative amounts.</p>
          <button onClick={() => run(() => apiPost('/finance/revenue-estimates', { contract_id: contractId, kind: ask('Kind: unpriced_variation / claim / delay_damages'), amount: Number(ask('Amount (negative for delay damages)')),
            effective_from: ask('Effective from (YYYY-MM-DD)') || today(), basis: ask('Basis (why a significant reversal is highly improbable)'), evidence_reference: ask('Evidence reference') }))}>Add estimate</button>
          <Table rows={estimates} cols={[['kind', 'Kind'], ['amount', 'Amount'], ['effective_from', 'From'], ['status', 'Status'], ['basis', 'Basis'], ['evidence_reference', 'Evidence'], ['retired_on', 'Retired on']]}
            actions={e => <>
              {e.status === 'draft' && <button onClick={() => run(() => apiPost(`/finance/revenue-estimates/${e.id}/approve`, {}))}>Approve</button>}
              {e.status === 'approved' && <button onClick={() => run(() => apiPost(`/finance/revenue-estimates/${e.id}/retire`, { retired_on: ask('Retired on (YYYY-MM-DD)') || today(), reason: ask('Reason for retiring the estimate') }))}>Retire</button>}
            </>} />
        </div>

        <div className="panel" data-section="retentions"><h2>Client retention</h2>
          <p className="muted">Released once against the taking-over or defects certificate, by someone other than the IPC preparer; the release becomes a receivable collected through Finance receipts.</p>
          <Table rows={retentions} cols={[['ipc_no', 'IPC'], ['retained_amount', 'Amount'], ['release_status', 'Status'], ['release_reference', 'Certificate'], ['release_reason', 'Reason'], ['release_receivable_id', 'Receivable']]}
            actions={r => r.release_status === 'held' ? <button onClick={() => run(() => apiPost(`/finance/retentions/${r.id}/release`, { reason: ask('Reason for the release'), reference: ask('Taking-over / defects certificate reference') }))}>Release</button> : null} />
        </div>
      </>}
    </section>
  );
}
