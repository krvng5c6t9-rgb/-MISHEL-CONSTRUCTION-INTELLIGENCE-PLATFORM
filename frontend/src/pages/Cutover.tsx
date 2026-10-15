import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '../lib/api';
import { Row, Table, ask, fmt } from '../components/RecordTable';

// Stage 36 / F-50 (GC-24, DEC-019): go-live cut-over screen. Each section is loaded by pasting rows copied from Excel or a
// CSV file; columns are mapped to fields (matched by header name), references are resolved by code / name (account code,
// client name, project code, vendor name, subcontract package), and every row is previewed against the server (the same
// checks as the load) before anything is saved. The reconciliation, its approval by a second person and the opening
// retention release follow. Every rule is enforced by the API and the database; this screen only prepares and shows.

type Lookups = { accounts: Row[]; clients: Row[]; projects: Row[]; contracts: Row[]; vendors: Row[]; subcontracts: Row[] };
type Field = { key: string; label: string; required?: boolean; kind: 'text' | 'number' | 'date' | 'account' | 'client' | 'project' | 'contract' | 'vendor' | 'subcontract'; target?: string; aliases?: string[] };
type Section = { path: string; title: string; fields: Field[]; cols: [string, string][] };

const SECTIONS: Section[] = [
  { path: 'tb-lines', title: 'Opening trial balance', cols: [['account_id', 'Account'], ['debit', 'Debit'], ['credit', 'Credit'], ['note', 'Note']], fields: [
    { key: 'account', label: 'Account code', required: true, kind: 'account', target: 'account_id', aliases: ['account', 'account code', 'code', 'الحساب'] },
    { key: 'debit', label: 'Debit', kind: 'number', aliases: ['debit', 'dr', 'مدين'] },
    { key: 'credit', label: 'Credit', kind: 'number', aliases: ['credit', 'cr', 'دائن'] },
    { key: 'note', label: 'Note', kind: 'text', aliases: ['note', 'description', 'بيان'] }] },
  { path: 'receivables', title: 'Opening receivables', cols: [['reference', 'Reference'], ['client_id', 'Client'], ['project_id', 'Project'], ['amount', 'Amount'], ['due_date', 'Due'], ['gl_account_id', 'Account']], fields: [
    { key: 'client', label: 'Client name', required: true, kind: 'client', target: 'client_id', aliases: ['client', 'customer', 'العميل'] },
    { key: 'project', label: 'Project code', required: true, kind: 'project', target: 'project_id', aliases: ['project', 'project code', 'المشروع'] },
    { key: 'contract', label: 'Contract (project code)', kind: 'contract', target: 'contract_id', aliases: ['contract', 'العقد'] },
    { key: 'reference', label: 'Reference', required: true, kind: 'text', aliases: ['reference', 'invoice', 'ref', 'المرجع'] },
    { key: 'amount', label: 'Amount', required: true, kind: 'number', aliases: ['amount', 'balance', 'المبلغ'] },
    { key: 'due_date', label: 'Due date', kind: 'date', aliases: ['due', 'due date', 'تاريخ الاستحقاق'] },
    { key: 'account', label: 'Control account code', required: true, kind: 'account', target: 'gl_account_id', aliases: ['account', 'control account', 'الحساب'] }] },
  { path: 'payables', title: 'Opening payables', cols: [['reference', 'Reference'], ['vendor_id', 'Vendor'], ['subcontract_id', 'Subcontract'], ['amount', 'Amount'], ['due_date', 'Due'], ['gl_account_id', 'Account']], fields: [
    { key: 'vendor', label: 'Vendor name', required: true, kind: 'vendor', target: 'vendor_id', aliases: ['vendor', 'supplier', 'subcontractor', 'المورد'] },
    { key: 'project', label: 'Project code', kind: 'project', target: 'project_id', aliases: ['project', 'project code', 'المشروع'] },
    { key: 'subcontract', label: 'Subcontract package', kind: 'subcontract', target: 'subcontract_id', aliases: ['subcontract', 'package', 'عقد الباطن'] },
    { key: 'reference', label: 'Reference', required: true, kind: 'text', aliases: ['reference', 'invoice', 'ref', 'المرجع'] },
    { key: 'amount', label: 'Amount', required: true, kind: 'number', aliases: ['amount', 'balance', 'المبلغ'] },
    { key: 'due_date', label: 'Due date', kind: 'date', aliases: ['due', 'due date'] },
    { key: 'account', label: 'Control account code', required: true, kind: 'account', target: 'gl_account_id', aliases: ['account', 'control account', 'الحساب'] }] },
  { path: 'contract-positions', title: 'In-flight client contracts', cols: [['contract_id', 'Contract'], ['certified_gross_to_date', 'Certified gross'], ['retention_held', 'Retention held'], ['advances_received', 'Advances received'], ['advance_recovered', 'Advance recovered'], ['cost_to_date', 'Cost to date'], ['eac', 'EAC'], ['revenue_recognised_to_date', 'Revenue to date']], fields: [
    { key: 'contract', label: 'Contract (project code)', required: true, kind: 'contract', target: 'contract_id', aliases: ['contract', 'project', 'project code', 'العقد'] },
    ...['certified_gross_to_date', 'retention_held', 'advances_received', 'advance_recovered', 'cost_to_date', 'eac', 'revenue_recognised_to_date'].map(k => ({ key: k, label: k.replace(/_/g, ' '), kind: 'number' as const, aliases: [k, k.replace(/_/g, ' ')] })),
    { key: 'source_reference', label: 'Source reference', required: true, kind: 'text', aliases: ['source', 'source reference', 'المصدر'] }] },
  { path: 'subcontract-positions', title: 'In-flight subcontracts', cols: [['subcontract_id', 'Subcontract'], ['certified_gross_to_date', 'Certified gross'], ['retention_held', 'Retention held'], ['advance_paid', 'Advance paid'], ['advance_recovered', 'Advance recovered']], fields: [
    { key: 'subcontract', label: 'Subcontract package', required: true, kind: 'subcontract', target: 'subcontract_id', aliases: ['subcontract', 'package', 'عقد الباطن'] },
    ...['certified_gross_to_date', 'retention_held', 'advance_paid', 'advance_recovered'].map(k => ({ key: k, label: k.replace(/_/g, ' '), kind: 'number' as const, aliases: [k, k.replace(/_/g, ' ')] })),
    { key: 'source_reference', label: 'Source reference', required: true, kind: 'text', aliases: ['source', 'source reference', 'المصدر'] }] }
];

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
  const [text, setText] = useState('');
  const [map, setMap] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<{ cells: string[]; error?: string }[] | null>(null);
  const [payload, setPayload] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const table = useMemo(() => parseTable(text), [text]);
  useEffect(() => {   // automatic column mapping by header name
    const m: Record<string, number> = {};
    for (const f of section.fields) {
      const idx = table.header.findIndex(h => [f.key, f.label, ...(f.aliases ?? [])].map(norm).includes(norm(h)));
      if (idx >= 0) m[f.key] = idx;
    }
    setMap(m); setPreview(null);
  }, [table.header.join('|'), section.path]);

  const resolve = (f: Field, v: string): { value?: unknown; error?: string } => {
    if (v === '' || v === undefined) return f.required ? { error: `${f.label} is required` } : {};
    const by = (list: Row[], key: string, label: string) => { const hit = list.filter(x => norm(String(x[key] ?? '')) === norm(v)); return hit.length === 1 ? { value: Number(hit[0].id) } : { error: hit.length ? `${label} "${v}" is ambiguous` : `${label} "${v}" not found` }; };
    switch (f.kind) {
      case 'number': { const n = num(v); return Number.isNaN(n) ? { error: `${f.label} "${v}" is not a number` } : { value: n }; }
      case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(v) ? { value: v } : { error: `${f.label} "${v}" must be YYYY-MM-DD` };
      case 'account': return by(lookups.accounts, 'account_code', 'Account');
      case 'client': return by(lookups.clients, 'client_name', 'Client');
      case 'project': return by(lookups.projects, 'project_code', 'Project');
      case 'vendor': return by(lookups.vendors, 'vendor_name', 'Vendor');
      case 'subcontract': return by(lookups.subcontracts, 'package_name', 'Subcontract');
      case 'contract': { const pr = lookups.projects.find(p => norm(String(p.project_code)) === norm(v)); const k = pr && lookups.contracts.filter(c => Number(c.project_id) === Number(pr.id));
        return k?.length === 1 ? { value: Number(k[0].id) } : { error: `Contract for project "${v}" ${k?.length ? 'is ambiguous' : 'not found'}` }; }
      default: return { value: v };
    }
  };

  async function runPreview() {
    setBusy(true);
    try {
      const built = table.rows.map(cells => {
        const body: Row = {}; const errors: string[] = [];
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
      setPreview(built.map(b => ({ cells: b.cells, error: b.errors.length ? b.errors.join('; ') : (server[k++]?.error) })));
      setPayload(valid.map(b => b.body));
    } finally { setBusy(false); }
  }
  async function load() { setBusy(true); try { setLoadErr(''); await apiPost(`/finance/cutover-plans/${planId}/${section.path}`, { rows: payload }); setText(''); setPreview(null); onLoaded(); } finally { setBusy(false); } }
  const errors = preview?.filter(p => p.error).length ?? 0;

  if (!editable) return null;
  return (
    <div className="cutover-loader" data-loader={section.path}>
      <label>Paste rows (first line = column names; copied from Excel or CSV)
        <textarea aria-label={`Paste ${section.title}`} rows={5} value={text} onChange={e => setText(e.target.value)} dir="ltr" /></label>
      {table.header.length > 0 && <div className="form-row" data-section="mapping">
        {section.fields.map(f => <label key={f.key}>{f.label}{f.required ? ' *' : ''}
          <select aria-label={`Column for ${f.label}`} value={map[f.key] ?? -1} onChange={e => { setMap({ ...map, [f.key]: Number(e.target.value) < 0 ? undefined as any : Number(e.target.value) }); setPreview(null); }}>
            <option value={-1}>— not provided —</option>{table.header.map((h, i) => <option key={i} value={i}>{h}</option>)}</select></label>)}
      </div>}
      {table.rows.length > 0 && <button disabled={busy} onClick={() => runPreview().catch(e => setPreview([{ cells: [], error: e.message }]))}>Preview {table.rows.length} rows</button>}
      {loadErr && <div className="notice" role="alert">{loadErr}</div>}
      {preview && <div className="table-wrap" data-section="preview"><table><thead><tr><th>#</th>{table.header.map((h, i) => <th key={i}>{h}</th>)}<th>Check</th></tr></thead>
        <tbody>{preview.map((p, i) => <tr key={i} className={p.error ? 'row-error' : ''}><td>{i + 1}</td>{p.cells.map((c, j) => <td key={j}>{c}</td>)}<td>{p.error ?? 'OK'}</td></tr>)}</tbody></table>
        <p>{errors ? `${errors} row(s) with errors — correct the pasted data; nothing is saved until every row is OK.` : `All ${preview.length} rows OK.`}</p>
        <button disabled={busy || errors > 0 || !payload.length} onClick={() => load().catch(e => setLoadErr(e.message))}>Load {payload.length} rows</button></div>}
    </div>
  );
}

export function Cutover() {
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
    const opt = async (path: string) => { try { const d = (await apiGet<any>(path)).data; return Array.isArray(d) ? d : (d?.projects ?? d?.items ?? []); } catch { return []; } };
    setLookups({ accounts: await opt('/finance/chart-of-accounts'), clients: await opt('/clients'), projects: await opt('/projects'), contracts: await opt('/contracts'), vendors: await opt('/vendors'), subcontracts: await opt('/subcontracts') });
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
    if (k === 'contract_id') { const c = lookups.contracts.find(x => Number(x.id) === Number(v)); return c ? `${c.project_code ?? ''} (contract ${c.id})` : `#${v}`; }
    return fmt(v);
  };

  return (
    <section className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Finance</p><h1>Go-live cut-over</h1>
        <p>Bring in the balances at go-live (DEC-019): opening trial balance, receivables, payables and in-flight contracts. The system reconciles every control account to its detail; someone other than the preparer approves, which posts the opening journal.</p></div></header>
      {err && <div className="notice" role="alert">{err}</div>}

      <div className="panel" data-section="plan"><h2>Cut-over plan</h2>
        {!plan ? <>
          <p className="muted">No plan yet. The cut-over date must be the first day of a fiscal period, and opening balances can be loaded only before any posting.</p>
          <button onClick={() => run(() => apiPost('/finance/cutover-plans', { cutover_date: ask('Cut-over date (first day of a fiscal period, YYYY-MM-DD)') }))}>Create plan</button>
        </> : <>
          <p>Cut-over date <strong>{String(plan.cutover_date).slice(0, 10)}</strong> — status <strong data-status={plan.status}>{plan.status}</strong>{plan.reconciliation_sha256 ? <> — report hash <code>{String(plan.reconciliation_sha256).slice(0, 12)}…</code></> : null}</p>
          <div className="form-row">
            {plan.status === 'draft' && <button onClick={() => run(async () => { try { await apiPost(`/finance/cutover-plans/${plan.id}/reconcile`, {}); } catch (x: any) { await load(); throw x; } })}>Reconcile</button>}
            {plan.status === 'draft' && <button onClick={() => run(() => apiPost(`/finance/cutover-plans/${plan.id}/cancel`, {}))}>Cancel plan</button>}
            {plan.status === 'reconciled' && <button onClick={() => run(() => apiPost(`/finance/cutover-plans/${plan.id}/reopen`, {}))}>Reopen to correct</button>}
            {plan.status === 'reconciled' && <button onClick={() => run(() => apiPost(`/finance/cutover-plans/${plan.id}/approve`, {}))}>Approve &amp; post opening journal</button>}
          </div>
        </>}
      </div>

      {plan && report && <div className="panel" data-section="reconciliation"><h2>Reconciliation</h2>
        <p>{report.clean ? 'Every control account agrees with its detail.' : 'Differences must be cleared before the plan can be reconciled.'}</p>
        <div className="table-wrap"><table><thead><tr><th>Check</th><th>Account</th><th>Trial balance</th><th>Detail</th><th>Difference</th><th>Note</th></tr></thead>
          <tbody>{(report.lines as Row[]).map((l, i) => <tr key={i} className={Number(l.difference) !== 0 ? 'row-error' : ''}><td>{l.check}</td><td>{accountCode(l.account_id)}</td><td>{fmt(l.trial_balance)}</td><td>{fmt(l.detail)}</td><td>{fmt(l.difference)}</td><td>{l.note}</td></tr>)}</tbody></table></div>
      </div>}

      {plan && detail && SECTIONS.map(s => <div className="panel" key={s.path} data-section={s.path}><h2>{s.title}</h2>
        <Table rows={(detail[s.path] as Row[]).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, label(k, v)])))} cols={s.cols}
          actions={plan.status === 'draft' ? r => <button onClick={() => run(() => apiDelete(`/finance/cutover-plans/${plan.id}/${s.path}/${r.id}`))}>Remove</button> : undefined} />
        <Loader section={s} planId={Number(plan.id)} lookups={lookups} editable={plan.status === 'draft'} onLoaded={() => { load().catch(x => setErr(x.message)); }} />
      </div>)}

      {plan?.status === 'opened' && <div className="panel" data-section="opening-retention"><h2>Opening retention</h2>
        <p className="muted">Released in parts against the taking-over / defects certificate, by someone other than the cut-over preparer.</p>
        <Table rows={retentions.map(r => ({ ...r, record: r.kind === 'client' ? label('contract_id', r.record_id) : label('subcontract_id', r.record_id), remaining: (Number(r.retention_held) - Number(r.released)).toFixed(2) }))}
          cols={[['kind', 'Kind'], ['record', 'Contract / subcontract'], ['retention_held', 'Held at cut-over'], ['released', 'Released'], ['remaining', 'Remaining']]}
          actions={r => Number(r.remaining) > 0 ? <button onClick={() => run(() => apiPost('/finance/opening-retentions/release', { kind: r.kind, position_id: Number(r.position_id), amount: Number(ask('Amount to release')), reason: ask('Reason for the release'), reference: ask('Taking-over / defects certificate reference') }))}>Release</button> : null} />
      </div>}
    </section>
  );
}
