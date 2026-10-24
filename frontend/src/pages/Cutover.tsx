import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '../lib/api';
import { Num, Row, Table, ask, fmt } from '../components/RecordTable';
import { dictionaries, useI18n, type MessageKey, type MessageVars } from '../lib/i18n';

// Stage 36 / F-50 (GC-24, DEC-019): go-live cut-over screen. Each section is loaded by pasting rows copied from Excel or a
// CSV file; columns are mapped to fields (matched by header name), references are resolved by code / name (account code,
// client name, project code, vendor name, subcontract package), and every row is previewed against the server (the same
// checks as the load) before anything is saved. The reconciliation, its approval by a second person and the opening
// retention release follow. Every rule is enforced by the API and the database; this screen only prepares and shows.
// R1.2: every label is translated (messages/cutover.ts); a pasted column name matches a field's key, its English or its
// Arabic label, or an alias. Messages returned by the server are shown as sent.

type Lookups = { accounts: Row[]; clients: Row[]; projects: Row[]; contracts: Row[]; vendors: Row[]; subcontracts: Row[] };
type Field = { key: string; label: MessageKey; required?: boolean; kind: 'text' | 'number' | 'date' | 'account' | 'client' | 'project' | 'contract' | 'vendor' | 'subcontract'; target?: string; aliases?: string[] };
type Section = { path: string; title: MessageKey; fields: Field[]; cols: [string, MessageKey][] };
// A check result: a message key (rendered in the current language when shown) or a message from the server.
type Msg = string | { key: MessageKey; vars?: MessageVars; label?: MessageKey };

const amountField = (key: string, label: MessageKey): Field => ({ key, label, kind: 'number', aliases: [key, key.replace(/_/g, ' ')] });
const SECTIONS: Section[] = [
  { path: 'tb-lines', title: 'cutover.sectionTb', cols: [['account_id', 'cutover.colAccount'], ['debit', 'cutover.colDebit'], ['credit', 'cutover.colCredit'], ['note', 'cutover.colNote']], fields: [
    { key: 'account', label: 'cutover.fieldAccountCode', required: true, kind: 'account', target: 'account_id', aliases: ['account', 'account code', 'code', 'الحساب'] },
    { key: 'debit', label: 'cutover.fieldDebit', kind: 'number', aliases: ['debit', 'dr', 'مدين'] },
    { key: 'credit', label: 'cutover.fieldCredit', kind: 'number', aliases: ['credit', 'cr', 'دائن'] },
    { key: 'note', label: 'cutover.fieldNote', kind: 'text', aliases: ['note', 'description', 'بيان'] }] },
  { path: 'receivables', title: 'cutover.sectionReceivables', cols: [['reference', 'cutover.colReference'], ['client_id', 'cutover.colClient'], ['project_id', 'cutover.colProject'], ['amount', 'cutover.colAmount'], ['due_date', 'cutover.colDue'], ['gl_account_id', 'cutover.colAccount']], fields: [
    { key: 'client', label: 'cutover.fieldClientName', required: true, kind: 'client', target: 'client_id', aliases: ['client', 'customer', 'العميل'] },
    { key: 'project', label: 'cutover.fieldProjectCode', required: true, kind: 'project', target: 'project_id', aliases: ['project', 'project code', 'المشروع'] },
    { key: 'contract', label: 'cutover.fieldContract', kind: 'contract', target: 'contract_id', aliases: ['contract', 'العقد'] },
    { key: 'reference', label: 'cutover.fieldReference', required: true, kind: 'text', aliases: ['reference', 'invoice', 'ref', 'المرجع'] },
    { key: 'amount', label: 'cutover.fieldAmount', required: true, kind: 'number', aliases: ['amount', 'balance', 'المبلغ'] },
    { key: 'due_date', label: 'cutover.fieldDueDate', kind: 'date', aliases: ['due', 'due date', 'تاريخ الاستحقاق'] },
    { key: 'account', label: 'cutover.fieldControlAccount', required: true, kind: 'account', target: 'gl_account_id', aliases: ['account', 'control account', 'الحساب'] }] },
  { path: 'payables', title: 'cutover.sectionPayables', cols: [['reference', 'cutover.colReference'], ['vendor_id', 'cutover.colVendor'], ['subcontract_id', 'cutover.colSubcontract'], ['amount', 'cutover.colAmount'], ['due_date', 'cutover.colDue'], ['gl_account_id', 'cutover.colAccount']], fields: [
    { key: 'vendor', label: 'cutover.fieldVendorName', required: true, kind: 'vendor', target: 'vendor_id', aliases: ['vendor', 'supplier', 'subcontractor', 'المورد'] },
    { key: 'project', label: 'cutover.fieldProjectCode', kind: 'project', target: 'project_id', aliases: ['project', 'project code', 'المشروع'] },
    { key: 'subcontract', label: 'cutover.fieldSubcontractPackage', kind: 'subcontract', target: 'subcontract_id', aliases: ['subcontract', 'package', 'عقد الباطن'] },
    { key: 'reference', label: 'cutover.fieldReference', required: true, kind: 'text', aliases: ['reference', 'invoice', 'ref', 'المرجع'] },
    { key: 'amount', label: 'cutover.fieldAmount', required: true, kind: 'number', aliases: ['amount', 'balance', 'المبلغ'] },
    { key: 'due_date', label: 'cutover.fieldDueDate', kind: 'date', aliases: ['due', 'due date'] },
    { key: 'account', label: 'cutover.fieldControlAccount', required: true, kind: 'account', target: 'gl_account_id', aliases: ['account', 'control account', 'الحساب'] }] },
  { path: 'contract-positions', title: 'cutover.sectionContracts', cols: [['contract_id', 'cutover.colContract'], ['certified_gross_to_date', 'cutover.colCertifiedGross'], ['retention_held', 'cutover.colRetentionHeld'], ['advances_received', 'cutover.colAdvancesReceived'], ['advance_recovered', 'cutover.colAdvanceRecovered'], ['cost_to_date', 'cutover.colCostToDate'], ['eac', 'cutover.colEac'], ['revenue_recognised_to_date', 'cutover.colRevenueToDate']], fields: [
    { key: 'contract', label: 'cutover.fieldContract', required: true, kind: 'contract', target: 'contract_id', aliases: ['contract', 'project', 'project code', 'العقد'] },
    amountField('certified_gross_to_date', 'cutover.fieldCertifiedGross'), amountField('retention_held', 'cutover.fieldRetentionHeld'),
    amountField('advances_received', 'cutover.fieldAdvancesReceived'), amountField('advance_recovered', 'cutover.fieldAdvanceRecovered'),
    amountField('cost_to_date', 'cutover.fieldCostToDate'), amountField('eac', 'cutover.fieldEac'), amountField('revenue_recognised_to_date', 'cutover.fieldRevenueRecognised'),
    { key: 'source_reference', label: 'cutover.fieldSourceReference', required: true, kind: 'text', aliases: ['source', 'source reference', 'المصدر'] }] },
  { path: 'subcontract-positions', title: 'cutover.sectionSubcontracts', cols: [['subcontract_id', 'cutover.colSubcontract'], ['certified_gross_to_date', 'cutover.colCertifiedGross'], ['retention_held', 'cutover.colRetentionHeld'], ['advance_paid', 'cutover.colAdvancePaid'], ['advance_recovered', 'cutover.colAdvanceRecovered']], fields: [
    { key: 'subcontract', label: 'cutover.fieldSubcontractPackage', required: true, kind: 'subcontract', target: 'subcontract_id', aliases: ['subcontract', 'package', 'عقد الباطن'] },
    amountField('certified_gross_to_date', 'cutover.fieldCertifiedGross'), amountField('retention_held', 'cutover.fieldRetentionHeld'),
    amountField('advance_paid', 'cutover.fieldAdvancePaid'), amountField('advance_recovered', 'cutover.fieldAdvanceRecovered'),
    { key: 'source_reference', label: 'cutover.fieldSourceReference', required: true, kind: 'text', aliases: ['source', 'source reference', 'المصدر'] }] }
];
const CHECKS: Record<string, MessageKey> = {
  trial_balance: 'cutover.checkTrialBalance', receivables: 'cutover.checkReceivables', payables: 'cutover.checkPayables',
  retention_receivable: 'cutover.checkRetentionReceivable', client_advances: 'cutover.checkClientAdvances',
  subcontract_retention: 'cutover.checkSubcontractRetention', subcontract_advances: 'cutover.checkSubcontractAdvances'
};
const STATUSES: Record<string, MessageKey> = { draft: 'cutover.statusDraft', reconciled: 'cutover.statusReconciled', opened: 'cutover.statusOpened', cancelled: 'cutover.statusCancelled' };
const KINDS: Record<string, MessageKey> = { client: 'cutover.kindClient', subcontract: 'cutover.kindSubcontract' };

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
// Pasted text: tab-separated (copied from Excel) or comma-separated with simple quoting; first line is the header.
export function parseTable(text: string): { header: string[]; rows: string[][] } {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
  if (!lines.length) return { header: [], rows: [] };
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const split = (line: string) => {
    if (sep === '\t') return line.split('\t').map(c => c.trim());
    const out: string[] = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  return { header: split(lines[0]), rows: lines.slice(1).map(split) };
}
const num = (v: string) => { const n = Number(v.replace(/[\s,]/g, '')); return Number.isFinite(n) ? n : NaN; };

function Loader({ section, planId, lookups, editable, onLoaded }: { section: Section; planId: number; lookups: Lookups; editable: boolean; onLoaded: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [map, setMap] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<{ cells: string[]; errors: Msg[] }[] | null>(null);
  const [payload, setPayload] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const table = useMemo(() => parseTable(text), [text]);
  const show = (m: Msg) => typeof m === 'string' ? m : t(m.key, { ...m.vars, ...(m.label ? { label: t(m.label) } : {}) });
  useEffect(() => {   // automatic column mapping by header name (either language)
    const m: Record<string, number> = {};
    for (const f of section.fields) {
      const names = [f.key, dictionaries.en[f.label], dictionaries.ar[f.label], ...(f.aliases ?? [])].map(norm);
      const idx = table.header.findIndex(h => names.includes(norm(h)));
      if (idx >= 0) m[f.key] = idx;
    }
    setMap(m); setPreview(null);
  }, [table.header.join('|'), section.path]);

  const resolve = (f: Field, v: string): { value?: unknown; error?: Msg } => {
    if (v === '' || v === undefined) return f.required ? { error: { key: 'cutover.errRequired', label: f.label } } : {};
    const by = (list: Row[], key: string, label: MessageKey): { value?: unknown; error?: Msg } => {
      const hit = list.filter(x => norm(String(x[key] ?? '')) === norm(v));
      return hit.length === 1 ? { value: Number(hit[0].id) } : { error: { key: hit.length ? 'cutover.errAmbiguous' : 'cutover.errNotFound', label, vars: { value: v } } };
    };
    switch (f.kind) {
      case 'number': { const n = num(v); return Number.isNaN(n) ? { error: { key: 'cutover.errNotNumber', label: f.label, vars: { value: v } } } : { value: n }; }
      case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(v) ? { value: v } : { error: { key: 'cutover.errDate', label: f.label, vars: { value: v } } };
      case 'account': return by(lookups.accounts, 'account_code', 'cutover.entityAccount');
      case 'client': return by(lookups.clients, 'client_name', 'cutover.entityClient');
      case 'project': return by(lookups.projects, 'project_code', 'cutover.entityProject');
      case 'vendor': return by(lookups.vendors, 'vendor_name', 'cutover.entityVendor');
      case 'subcontract': return by(lookups.subcontracts, 'package_name', 'cutover.entitySubcontract');
      case 'contract': { const pr = lookups.projects.find(p => norm(String(p.project_code)) === norm(v)); const k = pr && lookups.contracts.filter(c => Number(c.project_id) === Number(pr.id));
        return k?.length === 1 ? { value: Number(k[0].id) } : { error: { key: k?.length ? 'cutover.errContractAmbiguous' : 'cutover.errContractNotFound', vars: { value: v } } }; }
      default: return { value: v };
    }
  };

  async function runPreview() {
    setBusy(true);
    try {
      const built = table.rows.map(cells => {
        const body: Row = {}; const errors: Msg[] = [];
        for (const f of section.fields) {
          const idx = map[f.key];
          const r = resolve(f, idx === undefined ? '' : (cells[idx] ?? ''));
          if (r.error) errors.push(r.error); else if (r.value !== undefined) body[f.target ?? f.key] = r.value;
        }
        return { cells, body, errors };
      });
      const valid = built.filter(b => !b.errors.length);
      const server = valid.length ? (await apiPost<any>(`/finance/cutover-plans/${planId}/${section.path}?dry_run=1`, { rows: valid.map(b => b.body) })).data.rows : [];
      let k = 0;
      setPreview(built.map(b => { const se = b.errors.length ? undefined : server[k++]?.error; return { cells: b.cells, errors: b.errors.length ? b.errors : (se ? [String(se)] : []) }; }));
      setPayload(valid.map(b => b.body));
    } finally { setBusy(false); }
  }
  async function load() { setBusy(true); try { setLoadErr(''); await apiPost(`/finance/cutover-plans/${planId}/${section.path}`, { rows: payload }); setText(''); setPreview(null); onLoaded(); } finally { setBusy(false); } }
  const errors = preview?.filter(p => p.errors.length).length ?? 0;

  if (!editable) return null;
  return (
    <div className="cutover-loader" data-loader={section.path}>
      <label>{t('cutover.pasteRows')}
        <textarea aria-label={t('cutover.pasteAria', { title: t(section.title) })} rows={5} value={text} onChange={e => setText(e.target.value)} dir="auto" /></label>
      {table.header.length > 0 && <div className="form-row" data-section="mapping">
        {section.fields.map(f => <label key={f.key}>{t(f.label)}{f.required ? ' *' : ''}
          <select aria-label={t('cutover.columnFor', { label: t(f.label) })} value={map[f.key] ?? -1} onChange={e => { setMap({ ...map, [f.key]: Number(e.target.value) < 0 ? undefined as any : Number(e.target.value) }); setPreview(null); }}>
            <option value={-1}>{t('cutover.notProvided')}</option>{table.header.map((h, i) => <option key={i} value={i}>{h}</option>)}</select></label>)}
      </div>}
      {table.rows.length > 0 && <button disabled={busy} onClick={() => runPreview().catch(e => setPreview([{ cells: [], errors: [String(e.message)] }]))}>{t('cutover.preview', { n: table.rows.length })}</button>}
      {loadErr && <div className="notice" role="alert">{loadErr}</div>}
      {preview && <div className="table-wrap" data-section="preview"><table><thead><tr><th>#</th>{table.header.map((h, i) => <th key={i}>{h}</th>)}<th>{t('cutover.colCheck')}</th></tr></thead>
        <tbody>{preview.map((p, i) => <tr key={i} className={p.errors.length ? 'row-error' : ''}><td>{i + 1}</td>{p.cells.map((c, j) => <td key={j}>{c}</td>)}<td>{p.errors.length ? p.errors.map(show).join('; ') : t('cutover.rowOk')}</td></tr>)}</tbody></table>
        <p>{errors ? t('cutover.rowsWithErrors', { n: errors }) : t('cutover.allOk', { n: preview.length })}</p>
        <button disabled={busy || errors > 0 || !payload.length} onClick={() => load().catch(e => setLoadErr(e.message))}>{t('cutover.load', { n: payload.length })}</button></div>}
    </div>
  );
}

export function Cutover() {
  const { t } = useI18n();
  const [err, setErr] = useState('');
  const [plans, setPlans] = useState<Row[]>([]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [report, setReport] = useState<Row | null>(null);
  const [retentions, setRetentions] = useState<Row[]>([]);
  const [lookups, setLookups] = useState<Lookups>({ accounts: [], clients: [], projects: [], contracts: [], vendors: [], subcontracts: [] });
  const plan = plans.find(p => p.status !== 'cancelled') ?? null;

  async function load() {
    const list = (await apiGet<any>('/finance/cutover-plans')).data as Row[];
    setPlans(list);
    const live = list.find(p => p.status !== 'cancelled');
    // F-51: one lookup under the cut-over's permission (names shown and pasted names matched); a failure is shown, not swallowed.
    setLookups((await apiGet<any>('/finance/cutover-lookups')).data as Lookups);
    if (live) {
      setDetail((await apiGet<any>(`/finance/cutover-plans/${live.id}`)).data);
      setReport(live.status === 'draft' ? (await apiGet<any>(`/finance/cutover-plans/${live.id}/reconciliation`)).data : live.reconciliation);
      setRetentions(live.status === 'opened' ? (await apiGet<any>('/finance/opening-retentions')).data : []);
    } else { setDetail(null); setReport(null); setRetentions([]); }
  }
  const run = async (fn: () => Promise<unknown>) => { try { setErr(''); await fn(); await load(); } catch (x: any) { setErr(x.message); } };
  useEffect(() => { load().catch(x => setErr(x.message)); }, []);
  const accountCode = (id: unknown) => lookups.accounts.find(a => Number(a.id) === Number(id))?.account_code ?? (id ? `#${id}` : '—');
  const label = (k: string, v: unknown) => {
    if (v === null || v === undefined) return '—';
    const find = (list: Row[], key: string) => list.find(x => Number(x.id) === Number(v))?.[key] ?? `#${v}`;
    if (k === 'account_id' || k === 'gl_account_id') return accountCode(v);
    if (k === 'client_id') return find(lookups.clients, 'client_name');
    if (k === 'project_id') return find(lookups.projects, 'project_code');
    if (k === 'vendor_id') return find(lookups.vendors, 'vendor_name');
    if (k === 'subcontract_id') return find(lookups.subcontracts, 'package_name');
    if (k === 'contract_id') { const c = lookups.contracts.find(x => Number(x.id) === Number(v)); return c ? t('cutover.contractRef', { project: c.project_code ?? '', id: c.id }) : `#${v}`; }
    return fmt(v);
  };
  const named = (map: Record<string, MessageKey>, v: unknown) => (map[String(v)] ? t(map[String(v)]) : fmt(v));
  const cols = (c: [string, MessageKey][]): [string, string][] => c.map(([k, h]) => [k, t(h)]);

  return (
    <section className="page-stack">
      <header className="page-header"><div><p className="eyebrow">{t('cutover.eyebrow')}</p><h1>{t('cutover.title')}</h1>
        <p>{t('cutover.intro')}</p></div></header>
      {err && <div className="notice" role="alert">{err}</div>}

      <div className="panel" data-section="plan"><h2>{t('cutover.plan')}</h2>
        {!plan ? <>
          <p className="muted">{t('cutover.noPlan')}</p>
          <button onClick={() => run(() => apiPost('/finance/cutover-plans', { cutover_date: ask(t('cutover.askDate')) }))}>{t('cutover.createPlan')}</button>
        </> : <>
          <p>{t('cutover.dateLabel')} <strong>{String(plan.cutover_date).slice(0, 10)}</strong> — {t('cutover.statusLabel')} <strong data-status={plan.status}>{named(STATUSES, plan.status)}</strong>{plan.reconciliation_sha256 ? <> — {t('cutover.hashLabel')} <code>{String(plan.reconciliation_sha256).slice(0, 12)}…</code></> : null}</p>
          <div className="form-row">
            {plan.status === 'draft' && <button onClick={() => run(async () => { try { await apiPost(`/finance/cutover-plans/${plan.id}/reconcile`, {}); } catch (x: any) { await load(); throw x; } })}>{t('cutover.reconcile')}</button>}
            {plan.status === 'draft' && <button onClick={() => run(() => apiPost(`/finance/cutover-plans/${plan.id}/cancel`, {}))}>{t('cutover.cancelPlan')}</button>}
            {plan.status === 'reconciled' && <button onClick={() => run(() => apiPost(`/finance/cutover-plans/${plan.id}/reopen`, {}))}>{t('cutover.reopen')}</button>}
            {plan.status === 'reconciled' && <button onClick={() => run(() => apiPost(`/finance/cutover-plans/${plan.id}/approve`, {}))}>{t('cutover.approve')}</button>}
          </div>
        </>}
      </div>

      {plan && report && <div className="panel" data-section="reconciliation"><h2>{t('cutover.reconciliation')}</h2>
        <p>{report.clean ? t('cutover.clean') : t('cutover.differences')}</p>
        <div className="table-wrap"><table><thead><tr><th>{t('cutover.colCheck')}</th><th>{t('cutover.colAccount')}</th><th>{t('cutover.colTrialBalance')}</th><th>{t('cutover.colDetail')}</th><th>{t('cutover.colDifference')}</th><th>{t('cutover.colNote')}</th></tr></thead>
          <tbody>{(report.lines as Row[]).map((l, i) => <tr key={i} className={Number(l.difference) !== 0 ? 'row-error' : ''}><td>{named(CHECKS, l.check)}</td><td>{accountCode(l.account_id)}</td><td><Num v={l.trial_balance} /></td><td><Num v={l.detail} /></td><td><Num v={l.difference} /></td><td>{l.note}</td></tr>)}</tbody></table></div>
      </div>}

      {plan && detail && SECTIONS.map(s => <div className="panel" key={s.path} data-section={s.path}><h2>{t(s.title)}</h2>
        <Table rows={(detail[s.path] as Row[]).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, label(k, v)])))} cols={cols(s.cols)}
          actions={plan.status === 'draft' ? r => <button onClick={() => run(() => apiDelete(`/finance/cutover-plans/${plan.id}/${s.path}/${r.id}`))}>{t('cutover.remove')}</button> : undefined} />
        <Loader section={s} planId={Number(plan.id)} lookups={lookups} editable={plan.status === 'draft'} onLoaded={() => { load().catch(x => setErr(x.message)); }} />
      </div>)}

      {plan?.status === 'opened' && <div className="panel" data-section="opening-retention"><h2>{t('cutover.retention')}</h2>
        <p className="muted">{t('cutover.retentionNote')}</p>
        <Table rows={retentions.map(r => ({ ...r, kindLabel: named(KINDS, r.kind), record: r.kind === 'client' ? label('contract_id', r.record_id) : label('subcontract_id', r.record_id), remaining: (Number(r.retention_held) - Number(r.released)).toFixed(2) }))}
          cols={[['kindLabel', t('cutover.colKind')], ['record', t('cutover.colRecord')], ['retention_held', t('cutover.colHeldAtCutover')], ['released', t('cutover.colReleased')], ['remaining', t('cutover.colRemaining')]]}
          actions={r => Number(r.remaining) > 0 ? <button onClick={() => run(() => apiPost('/finance/opening-retentions/release', { kind: r.kind, position_id: Number(r.position_id), amount: Number(ask(t('cutover.askAmount'))), reason: ask(t('cutover.askReason')), reference: ask(t('cutover.askCertificate')) }))}>{t('cutover.release')}</button> : null} />
      </div>}
    </section>
  );
}
