import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch } from '../lib/api';

// Stage 18: one screen for the project-control capabilities built in Stages 8-17 (time & LD position, risk register,
// mobilisation gate, report packs, commissioning readiness, design-revision impacts). Every rule is enforced by the
// API/database; this page only shows the state and offers the permitted actions. Figures shown are as returned.

import { Row, Table, ask, fmt } from '../components/RecordTable';

export function ProjectControls() {
  const [projects, setProjects] = useState<Row[]>([]);
  const [projectId, setProjectId] = useState(0);
  const [me, setMe] = useState<Row | null>(null);
  const [err, setErr] = useState('');
  const [time, setTime] = useState<Row[]>([]);
  const [risks, setRisks] = useState<Row[]>([]);
  const [riskSummary, setRiskSummary] = useState<Row | null>(null);
  const [gates, setGates] = useState<Row[]>([]);
  const [gate, setGate] = useState<Row | null>(null);
  const [packs, setPacks] = useState<Row[]>([]);
  const [pack, setPack] = useState<Row | null>(null);
  const [systems, setSystems] = useState<Row[]>([]);
  const [impacts, setImpacts] = useState<Row[]>([]);
  const [impact, setImpact] = useState<Row | null>(null);
  const emptyRisk = { risk_no: '', kind: 'threat', title: '', cause: '', effect: '', probability_level: 3, impact_level: 3 };
  const [risk, setRisk] = useState(emptyRisk);
  const [unloaded, setUnloaded] = useState<string[]>([]);

  const run = async (fn: () => Promise<unknown>) => { try { setErr(''); await fn(); await load(projectId); } catch (x: any) { setErr(x.message); } };

  async function load(pid: number) {
    if (!pid) return;
    // A section the user may not read (or that fails) is named on screen instead of showing as an empty table.
    const missed = new Set<string>();
    const settle = async <T,>(p: Promise<T>, fallback: T, section: string) => { try { return await p; } catch (x: any) { missed.add(`${section} (${x.message})`); return fallback; } };
    const contracts = (await settle(apiGet<any>('/contracts'), { data: [] }, 'contracts')).data.filter((c: Row) => Number(c.project_id) === pid && ['signed', 'active'].includes(c.contract_status));
    const positions = await Promise.all(contracts.map(async (c: Row) => ({ contract_id: c.id, ...(await settle(apiGet<any>(`/contract-admin/contracts/${c.id}/time-position`), { data: {} }, 'time position')).data })));
    setTime(positions);
    setRisks((await settle(apiGet<any>(`/risks?project_id=${pid}`), { data: [] }, 'risks')).data);
    setRiskSummary((await settle(apiGet<any>(`/risks/summary?project_id=${pid}`), { data: null }, 'risk summary')).data);
    const g = (await settle(apiGet<any>(`/mobilisation/gates?project_id=${pid}`), { data: [] }, 'mobilisation')).data;
    setGates(g);
    setGate(g[0] ? (await settle(apiGet<any>(`/mobilisation/gates/${g[0].id}`), { data: null }, 'mobilisation gate')).data : null);
    setPacks((await settle(apiGet<any>(`/reports/packs?project_id=${pid}`), { data: [] }, 'report packs')).data);
    setSystems((await settle(apiGet<any>(`/commissioning/systems?project_id=${pid}`), { data: [] }, 'commissioning')).data);
    setImpacts((await settle(apiGet<any>(`/technical-office/design-impacts?project_id=${pid}`), { data: [] }, 'design impacts')).data);
    setUnloaded([...missed]);
  }

  useEffect(() => {
    (async () => {
      try {
        const p = await apiGet<any>('/projects');
        setProjects(Array.isArray(p.data) ? p.data : p.data?.projects ?? []);
        setMe((await apiGet<any>('/auth/me')).data);
      } catch (x: any) { setErr(x.message); }
    })();
  }, []);
  useEffect(() => { setPack(null); setImpact(null); setRisk(emptyRisk); load(projectId).catch(x => setErr(x.message)); }, [projectId]);

  return (
    <section className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Project Controls</p><h1>Project Controls</h1>
        <p>Time for completion and LD exposure, risks, mobilisation readiness, report packs, commissioning and design-revision impacts for one project.</p></div></header>
      {err && <div className="notice" role="alert">{err}</div>}
      {unloaded.length > 0 && <div className="notice muted" data-section="unloaded">Not loaded for this user: {unloaded.join('; ')}</div>}
      <div className="panel"><div className="form-row">
        <label>Project <select aria-label="Project" value={projectId} onChange={e => setProjectId(Number(e.target.value))}>
          <option value={0}>Select a project</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.project_code} — {p.project_name}</option>)}
        </select></label>
      </div></div>

      {projectId > 0 && <>
        <div className="panel" data-section="time"><h2>Time for completion &amp; LD exposure</h2>
          <p className="muted">LD exposure is information only; entitlement is decided by people.</p>
          <Table rows={time} cols={[['contract_id', 'Contract'], ['original_completion', 'Original completion'], ['approved_extension_days', 'Approved EOT (days)'], ['revised_completion', 'Revised completion'],
            ['forecast_completion', 'Forecast'], ['forecast_source', 'Forecast source'], ['days_late', 'Days late'], ['ld_terms_status', 'LD terms'], ['ld_exposure', 'LD exposure'], ['programme_update_outstanding', 'Programme update due']]} />
        </div>

        <div className="panel" data-section="risks"><h2>Risk &amp; opportunity register</h2>
          {riskSummary && <div className="kpi-grid">
            <div className="kpi"><span>Open</span><strong>{fmt(riskSummary.open_risks)}</strong></div>
            <div className="kpi"><span>Escalated</span><strong>{fmt(riskSummary.escalated)}</strong></div>
            <div className="kpi"><span>Reviews overdue</span><strong>{fmt(riskSummary.reviews_overdue)}</strong></div>
            <div className="kpi"><span>Open threat EV</span><strong>{fmt(riskSummary.open_threat_expected_value)}</strong></div>
            <div className="kpi"><span>Threats not quantified</span><strong>{fmt(riskSummary.threats_not_quantified)}</strong></div>
          </div>}
          <div className="form-row">
            <input aria-label="Risk number" placeholder="Risk no." value={risk.risk_no} onChange={e => setRisk({ ...risk, risk_no: e.target.value })} />
            <select aria-label="Kind" value={risk.kind} onChange={e => setRisk({ ...risk, kind: e.target.value })}><option>threat</option><option>opportunity</option></select>
            <input aria-label="Risk title" placeholder="Title" value={risk.title} onChange={e => setRisk({ ...risk, title: e.target.value })} />
            <input aria-label="Cause" placeholder="Cause" value={risk.cause} onChange={e => setRisk({ ...risk, cause: e.target.value })} />
            <input aria-label="Effect" placeholder="Effect" value={risk.effect} onChange={e => setRisk({ ...risk, effect: e.target.value })} />
            <select aria-label="Probability" value={risk.probability_level} onChange={e => setRisk({ ...risk, probability_level: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>P{n}</option>)}</select>
            <select aria-label="Impact" value={risk.impact_level} onChange={e => setRisk({ ...risk, impact_level: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>I{n}</option>)}</select>
            <button onClick={() => run(async () => { await apiPost('/risks', { ...risk, project_id: projectId, owner_user_id: Number(me?.id) }); setRisk(emptyRisk); })}>Raise risk</button>
          </div>
          <Table rows={risks} cols={[['risk_no', 'No.'], ['kind', 'Kind'], ['title', 'Title'], ['score', 'Score'], ['expected_value', 'EV'], ['status', 'Status'], ['review_overdue', 'Review overdue'], ['open_responses', 'Open responses']]}
            actions={r => r.status === 'closed' ? null : <button onClick={() => run(() => apiPost(`/risks/${r.id}/close`, {
              closure_type: r.kind === 'threat' ? (ask('Closure type: expired / mitigated / occurred') || 'mitigated') : (ask('Closure type: expired / realised / not_realised') || 'realised'),
              reason: ask('Closure reason (5+ characters)'), lesson_learned: ask('Lesson learned (10+ characters)') }))}>Close</button>} />
        </div>

        <div className="panel" data-section="mobilisation"><h2>Mobilisation readiness gate</h2>
          {!gates.length || gates[0].status === 'no_go'
            ? <button onClick={() => run(() => apiPost('/mobilisation/gates', { project_id: projectId }))}>Open gate</button>
            : gate && <>
              <p>Gate {gate.id}: <strong>{gate.status}</strong> — open mandatory items: <strong>{gate.open_mandatory}</strong></p>
              {gate.status === 'draft' && <div className="form-row">
                <button onClick={() => run(() => apiPost(`/mobilisation/gates/${gate.id}/items`, { category: ask('Category: permit / insurance / bond / staff / other') || 'other', item: ask('Readiness item'), mandatory: window.confirm('Is this item mandatory?') }))}>Add item</button>
                <button onClick={() => run(() => apiPost(`/mobilisation/gates/${gate.id}/submit`, {}))}>Submit gate</button>
              </div>}
              {gate.status === 'submitted' && <div className="form-row">
                <button onClick={() => run(() => apiPost(`/mobilisation/gates/${gate.id}/decision`, { decision: 'go', note: ask('Decision note (optional)') || undefined }))}>Decide GO</button>
                <button onClick={() => run(() => apiPost(`/mobilisation/gates/${gate.id}/decision`, { decision: 'no_go', note: ask('Reason for no-go') }))}>Decide NO-GO</button>
              </div>}
              <Table rows={gate.items ?? []} cols={[['category', 'Category'], ['item', 'Item'], ['mandatory', 'Mandatory'], ['status', 'Status'], ['note', 'Note / reason']]}
                actions={i => i.status !== 'open' || ['go', 'no_go'].includes(gate.status) ? null : <>
                  <button onClick={() => run(() => apiPost(`/mobilisation/items/${i.id}/close`, { note: ask('Evidence note (5+ characters)') }))}>Close</button>
                  {i.mandatory && <button onClick={() => run(() => apiPost(`/mobilisation/items/${i.id}/risk-accept`, { risk_id: Number(ask('Risk register id of the open threat')), note: ask('Why the risk is accepted (10+ characters)') }))}>Risk-accept</button>}
                </>} />
            </>}
        </div>

        <div className="panel" data-section="report-packs"><h2>Report packs</h2>
          <div className="form-row"><button onClick={() => run(() => apiPost('/reports/packs', { project_id: projectId, period_type: ask('Period type: weekly / monthly') || 'weekly', period_start: ask('Period start (YYYY-MM-DD)'), period_end: ask('Period end / data date (YYYY-MM-DD)') }))}>Freeze pack</button></div>
          <Table rows={packs} cols={[['period_type', 'Type'], ['period_start', 'From'], ['period_end', 'Data date'], ['exception_count', 'Exceptions'], ['status', 'Status']]}
            actions={p => <button onClick={async () => { try { setPack((await apiGet<any>(`/reports/packs/${p.id}`)).data); } catch (x: any) { setErr(x.message); } }}>Open</button>} />
          {pack && <div className="panel" data-section="pack-detail">
            <h3>Pack {pack.id} — {pack.status}</h3>
            <p>Hash valid: <strong>{String(pack.verification?.stored_hash_valid)}</strong> · Data changed since freeze: <strong>{String(pack.verification?.data_changed_since_freeze)}</strong></p>
            <p>Cost (as of data date): budget {fmt(pack.payload?.cost?.budget)} · committed {fmt(pack.payload?.cost?.committed)} · actual {fmt(pack.payload?.cost?.actual)} · accrual {fmt(pack.payload?.cost?.accrual)}</p>
            <Table rows={pack.payload?.exceptions ?? []} cols={[['type', 'Exception'], ['count', 'Count'], ['amount', 'Amount'], ['cost_code_id', 'Cost code']]} />
            <p>Narrative: {fmt(pack.narrative)}</p>
            <div className="form-row">
              {pack.status === 'draft' && <button onClick={() => run(async () => { await apiPatch(`/reports/packs/${pack.id}/narrative`, { narrative: ask('Narrative explaining the exceptions') }); setPack((await apiGet<any>(`/reports/packs/${pack.id}`)).data); })}>Write narrative</button>}
              {pack.status === 'draft' && <button onClick={() => run(async () => { await apiPost(`/reports/packs/${pack.id}/submit`, {}); setPack((await apiGet<any>(`/reports/packs/${pack.id}`)).data); })}>Submit</button>}
              {pack.status === 'submitted' && <button onClick={() => run(async () => { await apiPost(`/reports/packs/${pack.id}/decision`, { decision: 'approved' }); setPack((await apiGet<any>(`/reports/packs/${pack.id}`)).data); })}>Approve</button>}
              {pack.status === 'submitted' && <button onClick={() => run(async () => { await apiPost(`/reports/packs/${pack.id}/decision`, { decision: 'rejected', reason: ask('Reason for rejection') }); setPack((await apiGet<any>(`/reports/packs/${pack.id}`)).data); })}>Reject</button>}
            </div>
          </div>}
        </div>

        <div className="panel" data-section="commissioning"><h2>Commissioning readiness</h2>
          <Table rows={systems} cols={[['system_code', 'System'], ['name', 'Name'], ['packs_accepted', 'Packs accepted'], ['test_packs', 'Packs'], ['open_category_a', 'Open A'], ['open_category_b', 'Open B'],
            ['dossier_satisfied', 'Dossier done'], ['dossier_required', 'Dossier required'], ['ready', 'Ready'], ['handed_over', 'Handed over']]} />
        </div>

        <div className="panel" data-section="design-impacts"><h2>Design-revision impacts</h2>
          <Table rows={impacts} cols={[['drawing_no', 'Drawing'], ['superseded_revision', 'From rev'], ['new_revision', 'To rev'], ['items', 'Objects'], ['pending_items', 'Pending'], ['status', 'Status']]}
            actions={i => <button onClick={async () => { try { setImpact((await apiGet<any>(`/technical-office/design-impacts/${i.id}`)).data); } catch (x: any) { setErr(x.message); } }}>Open</button>} />
          {impact && <div className="panel" data-section="impact-detail">
            <h3>{impact.drawing_no} — {impact.status}</h3>
            <Table rows={impact.items ?? []} cols={[['object_label', 'Object'], ['based_on_revision', 'Based on rev'], ['disposition', 'Disposition'], ['reason', 'Reason']]}
              actions={x => x.disposition !== 'pending' || impact.status === 'closed' ? null : <>
                <button onClick={() => run(async () => { await apiPost(`/technical-office/design-impact-items/${x.id}/disposition`, { disposition: 'no_change', reason: ask('Why no change is needed') }); setImpact((await apiGet<any>(`/technical-office/design-impacts/${impact.id}`)).data); })}>No change</button>
                <button onClick={() => run(async () => { await apiPost(`/technical-office/design-impact-items/${x.id}/disposition`, { disposition: 'change_required', reason: ask('What changes') }); setImpact((await apiGet<any>(`/technical-office/design-impacts/${impact.id}`)).data); })}>Change required</button>
              </>} />
            {impact.status === 'open' && <button onClick={() => run(async () => {
              const ev = ask('Contract event id raised for the change (leave empty to state no entitlement)');
              await apiPost(`/technical-office/design-impacts/${impact.id}/close`, ev ? { contract_event_id: Number(ev) } : { no_entitlement_reason: ask('Why there is no entitlement (empty if no change was required)') || undefined });
              setImpact((await apiGet<any>(`/technical-office/design-impacts/${impact.id}`)).data);
            })}>Close impact</button>}
          </div>}
        </div>
      </>}
    </section>
  );
}
