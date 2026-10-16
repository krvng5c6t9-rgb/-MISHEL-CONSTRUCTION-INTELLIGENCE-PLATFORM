import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { NotLoaded, Num, Row, Table, ask, fmt } from '../components/RecordTable';
import { useI18n, type MessageKey } from '../lib/i18n';

// Stage 23 (F-38): client IPC certification / dispute / resubmission, client advance positions, and subcontract
// advances and back-charges (Stages 20-22). Every limit and separation-of-duties rule is enforced by the API and the
// database; this screen shows the recorded state and offers the permitted actions.
// R1.2: labels from messages/payments.ts, stored codes (status, basis, response) through tv(); server messages as sent.

const money = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const today = () => new Date().toISOString().slice(0, 10);
type Missed = [MessageKey, string];

function Position({ data, labels }: { data: Row | null; labels: [string, MessageKey][] }) {
  const { t } = useI18n();
  if (!data) return null;
  return <div className="kpi-grid">{labels.map(([k, l]) => <div className="kpi" key={k}><span>{t(l)}</span><strong>{typeof data[k] === 'object' && data[k] !== null ? JSON.stringify(data[k]) : <Num text={money(data[k])} />}</strong></div>)}</div>;
}

export function CommercialPayments() {
  const { t, tv } = useI18n();
  const [err, setErr] = useState('');
  const [unloaded, setUnloaded] = useState<Missed[]>([]);
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
    const missed = new Map<MessageKey, string>();
    const settle = async <T,>(p: Promise<T>, fallback: T, section: MessageKey) => { try { return await p; } catch (x: any) { missed.set(section, x.message); return fallback; } };
    setIpcs((await settle(apiGet<any>('/finance/ipcs'), { data: [] }, 'payments.secIpcs')).data.map((i: Row) => ({
      ...i, certification_difference: i.client_certified_amount === null ? null : (Number(i.net_amount_due) - Number(i.client_certified_amount)).toFixed(2) })));
    setSubcontracts((await settle(apiGet<any>('/subcontracts'), { data: [] }, 'payments.secSubcontracts')).data);
    setAging((await settle(apiGet<any>('/finance/receivables/aging'), { data: [] }, 'payments.secAging')).data);
    if (contractId) {
      setAdvances((await settle(apiGet<any>(`/finance/client-advances?contract_id=${contractId}`), { data: [] }, 'payments.secAdvances')).data);
      setAdvPos((await settle(apiGet<any>(`/finance/contracts/${contractId}/advance-position`), { data: null }, 'payments.secAdvancePosition')).data);
      setTerms((await settle(apiGet<any>(`/contract-admin/contracts/${contractId}/payment-terms`), { data: null }, 'payments.secTerms')).data);
    }
    if (scId) {
      setScPos((await settle(apiGet<any>(`/subcontracts/${scId}/deductions-position`), { data: null }, 'payments.secScPosition')).data);
      setScAdvances((await settle(apiGet<any>(`/subcontracts/advances?subcontract_id=${scId}`), { data: [] }, 'payments.secScAdvances')).data);
      setBackcharges((await settle(apiGet<any>(`/subcontracts/backcharges?subcontract_id=${scId}`), { data: [] }, 'payments.secBackcharges')).data);
    }
    setUnloaded([...missed.entries()]);
  }
  const run = async (fn: () => Promise<unknown>) => { try { setErr(''); await fn(); await load(); } catch (x: any) { setErr(x.message); } };
  useEffect(() => { load().catch(x => setErr(x.message)); }, [contractId, scId]);
  const cols = (c: [string, MessageKey][]): [string, string][] => c.map(([k, h]) => [k, t(h)]);
  const withStatus = (rows: Row[]): Row[] => rows.map(r => ({ ...r, status_label: tv(r.status) }));

  const certify = (i: Row) => run(async () => {
    const amount = ask(t('payments.askCertifiedAmount', { net: money(i.net_amount_due) }));
    const body: Row = { certified_amount: Number(amount), client_reference: ask(t('payments.askClientReference')), certified_on: ask(t('payments.askCertifiedOn')) || today() };
    if (Number(amount) !== Number(i.net_amount_due)) body.difference_reason = ask(t('payments.askDifferenceReason'));
    // F-36: the client's breakdown is optional; when given it must be complete and add up to the certified net.
    if (window.confirm(t('payments.confirmBreakdown'))) {
      body.certified_gross = Number(ask(t('payments.askCertifiedGross')));
      body.certified_retention = Number(ask(t('payments.askCertifiedRetention')));
      body.certified_advance_recovery = Number(ask(t('payments.askCertifiedAdvanceRecovery')));
      body.certified_previous = Number(ask(t('payments.askCertifiedPrevious')));
    }
    await apiPost(`/finance/ipcs/${i.id}/client-approve`, body);
  });
  const contracts = [...new Map(ipcs.map(i => [Number(i.contract_id), i.contract_ref + ' — ' + i.project_name])).entries()];

  return (
    <section className="page-stack">
      <header className="page-header"><div><p className="eyebrow">{t('payments.eyebrow')}</p><h1>{t('payments.title')}</h1>
        <p>{t('payments.intro')}</p></div></header>
      {err && <div className="notice" role="alert">{err}</div>}
      {unloaded.length > 0 && <div className="notice muted" data-section="unloaded"><NotLoaded text={t('payments.notLoaded', { list: '' })} items={unloaded.map(([k, m]): [string, string] => [t(k), m])} /></div>}

      <div className="panel" data-section="ipcs"><h2>{t('payments.ipcs')}</h2>
        <Table rows={withStatus(ipcs)} cols={cols([['ipc_no', 'payments.colIpc'], ['project_name', 'payments.colProject'], ['contract_ref', 'payments.colContract'], ['status_label', 'payments.colStatus'], ['net_amount_due', 'payments.colSubmittedNet'],
          ['client_certified_amount', 'payments.colCertified'], ['certification_difference', 'payments.colDifference'], ['client_reference', 'payments.colClientRef'], ['dispute_reason', 'payments.colDispute']])}
          actions={i => <>
            {i.status === 'submitted_to_client' && <button onClick={() => certify(i)}>{t('payments.recordCertification')}</button>}
            {i.status === 'submitted_to_client' && <button onClick={() => run(() => apiPost(`/finance/ipcs/${i.id}/client-dispute`, { reason: ask(t('payments.askDisputeReason')) }))}>{t('payments.dispute')}</button>}
            {i.status === 'disputed' && <button onClick={() => run(() => apiPost(`/finance/ipcs/${i.id}/resubmit-to-client`, { note: ask(t('payments.askResubmitNote')) }))}>{t('payments.resubmit')}</button>}
          </>} />
      </div>

      <div className="panel" data-section="client-advances"><h2>{t('payments.clientAdvances')}</h2>
        <label>{t('payments.contract')} <select aria-label={t('payments.contract')} value={contractId} onChange={e => setContractId(Number(e.target.value))}>
          <option value={0}>{t('payments.selectContract')}</option>{contracts.map(([cid, label]) => <option key={cid} value={cid}>{label}</option>)}</select></label>
        {contractId > 0 && <>
          <Position data={advPos} labels={[['advance_limit', 'payments.kpiLimit'], ['advances_received', 'payments.kpiReceived'], ['advance_recovered', 'payments.kpiRecovered'], ['advance_outstanding', 'payments.kpiOutstanding'], ['net_certified', 'payments.kpiNetCertified']]} />
          <div data-section="payment-terms"><h3>{t('payments.terms')}</h3>
            {terms ? <p>{t('payments.termsLine', { days: terms.days, basis: t(terms.basis === 'after_submission' ? 'payments.basisSubmission' : 'payments.basisCertification'), clause: terms.clause_ref })} — <strong>{tv(terms.status)}</strong></p>
              : <p className="muted">{t('payments.noTerms')}</p>}
            {!terms && <button onClick={() => run(() => apiPost(`/contract-admin/contracts/${contractId}/payment-terms`, { basis: ask(t('payments.askTermsBasis')), days: Number(ask(t('payments.askTermsDays'))), clause_ref: ask(t('payments.askClause')), source_reference: ask(t('payments.askTermsSource')) }))}>{t('payments.enterTerms')}</button>}
            {terms?.status === 'draft' && <button onClick={() => run(() => apiPost(`/contract-admin/payment-terms/${terms.id}/confirm`, {}))}>{t('payments.confirmTerms')}</button>}
          </div>
          <button onClick={() => run(() => apiPost('/finance/client-advances', { contract_id: contractId, amount: Number(ask(t('payments.askAdvanceAmount'))), recovery_percent: Number(ask(t('payments.askClientRecovery'))) || undefined, guarantee_ref: ask(t('payments.askClientGuarantee')) || undefined }))}>{t('payments.recordAdvance')}</button>
          {/* F-48 (Stage 33): since CC-059 an approved advance is received only through Finance receipts against its receivable. */}
          <Table rows={withStatus(advances)} cols={cols([['amount', 'payments.colAmount'], ['recovery_percent', 'payments.colRecoveryPct'], ['guarantee_ref', 'payments.colGuarantee'], ['status_label', 'payments.colStatus'], ['receivable_id', 'payments.colReceivable'], ['receipt_reference', 'payments.colReceipt']])}
            actions={a => <>
              {a.status === 'draft' && <button onClick={() => run(() => apiPost(`/finance/client-advances/${a.id}/approve`, {}))}>{t('payments.approve')}</button>}
              {a.status === 'approved' && <span className="muted">{t('payments.collectThrough', { id: a.receivable_id })}</span>}
            </>} />
        </>}
      </div>

      <div className="panel" data-section="aging"><h2>{t('payments.aging')}</h2>
        <Table rows={aging.map(r => ({ ...r, aging_basis_label: tv(r.aging_basis) }))} cols={cols([['ipc_no', 'payments.colIpc'], ['client_name', 'payments.colClient'], ['project_name', 'payments.colProject'], ['amount', 'payments.colAmount'], ['received', 'payments.colReceived'], ['outstanding', 'payments.colOutstanding'], ['due_date', 'payments.colDue'], ['days_overdue', 'payments.colDaysOverdue'], ['aging_basis_label', 'payments.colBasis']])} />
      </div>

      <div className="panel" data-section="subcontracts"><h2>{t('payments.subcontracts')}</h2>
        <label>{t('payments.subcontract')} <select aria-label={t('payments.subcontract')} value={scId} onChange={e => setScId(Number(e.target.value))}>
          <option value={0}>{t('payments.selectSubcontract')}</option>{subcontracts.map(s => <option key={s.id} value={s.id}>{s.package_name} — {fmt(s.vendor_name)}</option>)}</select></label>
        {scId > 0 && <>
          <Position data={scPos} labels={[['advance_limit', 'payments.kpiAdvanceLimit'], ['advances_paid', 'payments.kpiPaid'], ['advance_recovered', 'payments.kpiRecovered'], ['advance_outstanding', 'payments.kpiOutstanding'], ['backcharges_disputed', 'payments.kpiDisputedBackcharges'], ['net_certified_approved', 'payments.kpiNetCertified']]} />
          <div className="form-row">
            <button onClick={() => run(() => apiPost('/subcontracts/advances', { subcontract_id: scId, amount: Number(ask(t('payments.askAdvanceAmount'))), recovery_percent: Number(ask(t('payments.askScRecovery'))) || undefined, guarantee_ref: ask(t('payments.askScGuarantee')) || undefined }))}>{t('payments.recordAdvance')}</button>
            <button onClick={() => run(() => apiPost('/subcontracts/backcharges', { subcontract_id: scId, reference: ask(t('payments.askBackchargeRef')), cause: ask(t('payments.askCause')), amount: Number(ask(t('payments.askAmount'))), notified_on: ask(t('payments.askNotifiedOn')) || undefined }))}>{t('payments.raiseBackcharge')}</button>
          </div>
          {/* F-48 (Stage 33): since CC-058 an approved advance is paid only through Finance payments against its payable. */}
          <div data-section="sc-advances"><Table rows={withStatus(scAdvances)} cols={cols([['amount', 'payments.colAmount'], ['recovery_percent', 'payments.colRecoveryPct'], ['guarantee_ref', 'payments.colGuarantee'], ['status_label', 'payments.colStatus'], ['payable_id', 'payments.colPayable'], ['payment_reference', 'payments.colPayment']])}
            actions={a => <>
              {a.status === 'draft' && <button onClick={() => run(() => apiPost(`/subcontracts/advances/${a.id}/approve`, {}))}>{t('payments.approve')}</button>}
              {a.status === 'approved' && <span className="muted">{t('payments.payThrough', { id: a.payable_id })}</span>}
            </>} /></div>
          <div data-section="backcharges"><Table rows={withStatus(backcharges).map(b => ({ ...b, response_label: tv(b.subcontractor_response) }))} cols={cols([['reference', 'payments.colRef'], ['cause', 'payments.colCause'], ['amount', 'payments.colAmount'], ['status_label', 'payments.colStatus'], ['notified_on', 'payments.colNotified'], ['response_label', 'payments.colResponse'], ['certificate_id', 'payments.colCertificate']])}
            actions={b => <>
              {b.status === 'raised' && !b.notified_on && <button onClick={() => run(() => apiPost(`/subcontracts/backcharges/${b.id}/notify`, { notified_on: ask(t('payments.askNoticeDate')) || today() }))}>{t('payments.noticeSent')}</button>}
              {b.status === 'raised' && <button onClick={() => run(() => apiPost(`/subcontracts/backcharges/${b.id}/approve`, {}))}>{t('payments.approve')}</button>}
              {b.status === 'approved' && <button onClick={() => run(() => apiPost(`/subcontracts/backcharges/${b.id}/apply`, { certificate_id: Number(ask(t('payments.askCertificateId'))) }))}>{t('payments.apply')}</button>}
              {b.status === 'applied' && <button onClick={() => run(() => apiPost(`/subcontracts/backcharges/${b.id}/detach`, {}))}>{t('payments.detach')}</button>}
              {['raised', 'approved'].includes(b.status) && <button onClick={() => run(() => apiPost(`/subcontracts/backcharges/${b.id}/withdraw`, { reason: ask(t('payments.askWithdrawReason')) }))}>{t('payments.withdraw')}</button>}
              {b.status !== 'withdrawn' && <button onClick={() => run(() => apiPost(`/subcontracts/backcharges/${b.id}/response`, { response: ask(t('payments.askResponse')), note: ask(t('payments.askResponseNote')) }))}>{t('payments.response')}</button>}
            </>} /></div>
        </>}
      </div>
    </section>
  );
}
