import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { Row, Table, ask, fmt } from '../components/RecordTable';

// Stage 23 (F-38): client IPC certification / dispute / resubmission, client advance positions, and subcontract
// advances and back-charges (Stages 20-22). Every limit and separation-of-duties rule is enforced by the API and the
// database; this screen shows the recorded state and offers the permitted actions.

const money = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const today = () => new Date().toISOString().slice(0, 10);

function Position({ data, labels }: { data: Row | null; labels: [string, string][] }) {
  if (!data) return null;
  return <div className="kpi-grid">{labels.map(([k, l]) => <div className="kpi" key={k}><span>{l}</span><strong>{typeof data[k] === 'object' && data[k] !== null ? JSON.stringify(data[k]) : money(data[k])}</strong></div>)}</div>;
}

export function CommercialPayments() {
  const [err, setErr] = useState('');
  const [unloaded, setUnloaded] = useState<string[]>([]);
  const [ipcs, setIpcs] = useState<Row[]>([]);
  const [contractId, setContractId] = useState(0);
  const [advances, setAdvances] = useState<Row[]>([]);
  const [advPos, setAdvPos] = useState<Row | null>(null);
  const [subcontracts, setSubcontracts] = useState<Row[]>([]);
  const [scId, setScId] = useState(0);
  const [scPos, setScPos] = useState<Row | null>(null);
  const [scAdvances, setScAdvances] = useState<Row[]>([]);
  const [backcharges, setBackcharges] = useState<Row[]>([]);
  const [terms, setTerms] = useState<Row | null>(null);
  const [aging, setAging] = useState<Row[]>([]);

  async function load() {
    const missed = new Set<string>();
    const settle = async <T,>(p: Promise<T>, fallback: T, section: string) => { try { return await p; } catch (x: any) { missed.add(`${section} (${x.message})`); return fallback; } };
    setIpcs((await settle(apiGet<any>('/finance/ipcs'), { data: [] }, 'client IPCs')).data.map((i: Row) => ({
      ...i, certification_difference: i.client_certified_amount === null ? null : (Number(i.net_amount_due) - Number(i.client_certified_amount)).toFixed(2) })));
    setSubcontracts((await settle(apiGet<any>('/subcontracts'), { data: [] }, 'subcontracts')).data);
    setAging((await settle(apiGet<any>('/finance/receivables/aging'), { data: [] }, 'receivable aging')).data);
    if (contractId) {
      setAdvances((await settle(apiGet<any>(`/finance/client-advances?contract_id=${contractId}`), { data: [] }, 'client advances')).data);
      setAdvPos((await settle(apiGet<any>(`/finance/contracts/${contractId}/advance-position`), { data: null }, 'client advance position')).data);
      setTerms((await settle(apiGet<any>(`/contract-admin/contracts/${contractId}/payment-terms`), { data: null }, 'payment terms')).data);
    }
    if (scId) {
      setScPos((await settle(apiGet<any>(`/subcontracts/${scId}/deductions-position`), { data: null }, 'subcontract position')).data);
      setScAdvances((await settle(apiGet<any>(`/subcontracts/advances?subcontract_id=${scId}`), { data: [] }, 'subcontract advances')).data);
      setBackcharges((await settle(apiGet<any>(`/subcontracts/backcharges?subcontract_id=${scId}`), { data: [] }, 'back-charges')).data);
    }
    setUnloaded([...missed]);
  }
  const run = async (fn: () => Promise<unknown>) => { try { setErr(''); await fn(); await load(); } catch (x: any) { setErr(x.message); } };
  useEffect(() => { load().catch(x => setErr(x.message)); }, [contractId, scId]);

  const certify = (i: Row) => run(async () => {
    const amount = ask(`Amount certified by the client (submitted net ${money(i.net_amount_due)})`);
    const body: Row = { certified_amount: Number(amount), client_reference: ask('Client certificate reference'), certified_on: ask('Certification date (YYYY-MM-DD)') || today() };
    if (Number(amount) !== Number(i.net_amount_due)) body.difference_reason = ask('Reason for the difference to the submitted net');
    // F-36: the client's breakdown is optional; when given it must be complete and add up to the certified net.
    if (window.confirm('Record the client breakdown (gross, retention, advance recovery, previous)?')) {
      body.certified_gross = Number(ask('Certified gross'));
      body.certified_retention = Number(ask('Certified retention'));
      body.certified_advance_recovery = Number(ask('Certified advance recovery'));
      body.certified_previous = Number(ask('Previously certified (deducted by the client)'));
    }
    await apiPost(`/finance/ipcs/${i.id}/client-approve`, body);
  });
  const contracts = [...new Map(ipcs.map(i => [Number(i.contract_id), i.contract_ref + ' — ' + i.project_name])).entries()];

  return (
    <section className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Commercial</p><h1>Payments &amp; Certification</h1>
        <p>Client certification of IPCs (amount, reference, date, differences, disputes), client advance positions, and subcontract advances and back-charges.</p></div></header>
      {err && <div className="notice" role="alert">{err}</div>}
      {unloaded.length > 0 && <div className="notice muted" data-section="unloaded">Not loaded for this user: {unloaded.join('; ')}</div>}

      <div className="panel" data-section="ipcs"><h2>Client IPCs</h2>
        <Table rows={ipcs} cols={[['ipc_no', 'IPC'], ['project_name', 'Project'], ['contract_ref', 'Contract'], ['status', 'Status'], ['net_amount_due', 'Submitted net'],
          ['client_certified_amount', 'Certified'], ['certification_difference', 'Difference'], ['client_reference', 'Client ref'], ['dispute_reason', 'Dispute']]}
          actions={i => <>
            {i.status === 'submitted_to_client' && <button onClick={() => certify(i)}>Record certification</button>}
            {i.status === 'submitted_to_client' && <button onClick={() => run(() => apiPost(`/finance/ipcs/${i.id}/client-dispute`, { reason: ask('Client reason for the dispute') }))}>Dispute</button>}
            {i.status === 'disputed' && <button onClick={() => run(() => apiPost(`/finance/ipcs/${i.id}/resubmit-to-client`, { note: ask('What was resolved before resubmission') }))}>Resubmit</button>}
          </>} />
      </div>

      <div className="panel" data-section="client-advances"><h2>Client advance position</h2>
        <label>Contract <select aria-label="Contract" value={contractId} onChange={e => setContractId(Number(e.target.value))}>
          <option value={0}>Select a contract</option>{contracts.map(([cid, label]) => <option key={cid} value={cid}>{label}</option>)}</select></label>
        {contractId > 0 && <>
          <Position data={advPos} labels={[['advance_limit', 'Limit'], ['advances_received', 'Received'], ['advance_recovered', 'Recovered'], ['advance_outstanding', 'Outstanding'], ['net_certified', 'Net certified']]} />
          <div data-section="payment-terms"><h3>Payment terms</h3>
            {terms ? <p>{terms.days} days {terms.basis === 'after_submission' ? 'after submission' : 'after client certification'} — clause {terms.clause_ref} — <strong>{terms.status}</strong></p>
              : <p className="muted">No payment terms recorded: receivable due dates stay empty until terms are entered and confirmed.</p>}
            {!terms && <button onClick={() => run(() => apiPost(`/contract-admin/contracts/${contractId}/payment-terms`, { basis: ask('Basis: after_submission / after_client_certification'), days: Number(ask('Days stated in the contract')), clause_ref: ask('Clause reference'), source_reference: ask('Source (document and page)') }))}>Enter payment terms</button>}
            {terms?.status === 'draft' && <button onClick={() => run(() => apiPost(`/contract-admin/payment-terms/${terms.id}/confirm`, {}))}>Confirm terms</button>}
          </div>
          <button onClick={() => run(() => apiPost('/finance/client-advances', { contract_id: contractId, amount: Number(ask('Advance amount')), recovery_percent: Number(ask('Recovery % of gross per IPC from the contract (empty if none)')) || undefined, guarantee_ref: ask('Advance payment guarantee reference') || undefined }))}>Record advance</button>
          <Table rows={advances} cols={[['amount', 'Amount'], ['recovery_percent', 'Recovery %'], ['guarantee_ref', 'Guarantee'], ['status', 'Status'], ['receipt_reference', 'Receipt']]}
            actions={a => <>
              {a.status === 'draft' && <button onClick={() => run(() => apiPost(`/finance/client-advances/${a.id}/approve`, {}))}>Approve</button>}
              {a.status === 'approved' && <button onClick={() => run(() => apiPost(`/finance/client-advances/${a.id}/received`, { receipt_reference: ask('Receipt reference') }))}>Received</button>}
            </>} />
        </>}
      </div>

      <div className="panel" data-section="aging"><h2>Receivables outstanding</h2>
        <Table rows={aging} cols={[['ipc_no', 'IPC'], ['client_name', 'Client'], ['project_name', 'Project'], ['amount', 'Amount'], ['received', 'Received'], ['outstanding', 'Outstanding'], ['due_date', 'Due'], ['days_overdue', 'Days overdue'], ['aging_basis', 'Basis']]} />
      </div>

      <div className="panel" data-section="subcontracts"><h2>Subcontract advances &amp; back-charges</h2>
        <label>Subcontract <select aria-label="Subcontract" value={scId} onChange={e => setScId(Number(e.target.value))}>
          <option value={0}>Select a subcontract</option>{subcontracts.map(s => <option key={s.id} value={s.id}>{s.package_name} — {fmt(s.vendor_name)}</option>)}</select></label>
        {scId > 0 && <>
          <Position data={scPos} labels={[['advance_limit', 'Advance limit'], ['advances_paid', 'Paid'], ['advance_recovered', 'Recovered'], ['advance_outstanding', 'Outstanding'], ['backcharges_disputed', 'Disputed back-charges'], ['net_certified_approved', 'Net certified']]} />
          <div className="form-row">
            <button onClick={() => run(() => apiPost('/subcontracts/advances', { subcontract_id: scId, amount: Number(ask('Advance amount')), recovery_percent: Number(ask('Recovery % of gross per certificate from the subcontract (empty if none)')) || undefined, guarantee_ref: ask('Guarantee reference') || undefined }))}>Record advance</button>
            <button onClick={() => run(() => apiPost('/subcontracts/backcharges', { subcontract_id: scId, reference: ask('Back-charge reference'), cause: ask('Cause (what was done at the subcontractor\'s cost)'), amount: Number(ask('Amount')), notified_on: ask('Date the subcontractor was notified (YYYY-MM-DD, empty if not yet)') || undefined }))}>Raise back-charge</button>
          </div>
          <div data-section="sc-advances"><Table rows={scAdvances} cols={[['amount', 'Amount'], ['recovery_percent', 'Recovery %'], ['guarantee_ref', 'Guarantee'], ['status', 'Status'], ['payment_reference', 'Payment']]}
            actions={a => <>
              {a.status === 'draft' && <button onClick={() => run(() => apiPost(`/subcontracts/advances/${a.id}/approve`, {}))}>Approve</button>}
              {a.status === 'approved' && <button onClick={() => run(() => apiPost(`/subcontracts/advances/${a.id}/paid`, { payment_reference: ask('Payment reference') }))}>Paid</button>}
            </>} /></div>
          <div data-section="backcharges"><Table rows={backcharges} cols={[['reference', 'Ref'], ['cause', 'Cause'], ['amount', 'Amount'], ['status', 'Status'], ['notified_on', 'Notified'], ['subcontractor_response', 'Response'], ['certificate_id', 'Certificate']]}
            actions={b => <>
              {b.status === 'raised' && !b.notified_on && <button onClick={() => run(() => apiPost(`/subcontracts/backcharges/${b.id}/notify`, { notified_on: ask('Notice date (YYYY-MM-DD)') || today() }))}>Notice sent</button>}
              {b.status === 'raised' && <button onClick={() => run(() => apiPost(`/subcontracts/backcharges/${b.id}/approve`, {}))}>Approve</button>}
              {b.status === 'approved' && <button onClick={() => run(() => apiPost(`/subcontracts/backcharges/${b.id}/apply`, { certificate_id: Number(ask('Draft certificate id')) }))}>Apply</button>}
              {b.status === 'applied' && <button onClick={() => run(() => apiPost(`/subcontracts/backcharges/${b.id}/detach`, {}))}>Detach</button>}
              {['raised', 'approved'].includes(b.status) && <button onClick={() => run(() => apiPost(`/subcontracts/backcharges/${b.id}/withdraw`, { reason: ask('Reason for withdrawal') }))}>Withdraw</button>}
              {b.status !== 'withdrawn' && <button onClick={() => run(() => apiPost(`/subcontracts/backcharges/${b.id}/response`, { response: ask('Subcontractor response: accepted / disputed'), note: ask('Note of the response') }))}>Response</button>}
            </>} /></div>
        </>}
      </div>
    </section>
  );
}
