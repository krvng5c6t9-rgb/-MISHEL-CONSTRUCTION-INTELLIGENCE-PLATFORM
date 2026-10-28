import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, apiPatch } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';

// Stage 18: one screen for the project-control capabilities built in Stages 8-17 (time & LD position, risk register,
// mobilisation gate, report packs, commissioning readiness, design-revision impacts). Every rule is enforced by the
// API/database; this page only shows the state and offers the permitted actions. Figures shown are as returned.
// R1.2: labels from messages/projectControls.ts; stored codes (statuses, kinds, categories, dispositions, exception
// types, yes / no) through tv() into separate *_label fields, so actions still read the stored code.

import { NotLoaded, Num, Row, Table, ask, fmt } from '../components/RecordTable';

type Missed = [MessageKey, string];

export function ProjectControls() {
  const { t, tv } = useI18n();
  const [projects, setProjects] = useState<Row[]>([]);
  // CC-087: opened from the owner portfolio with ?project=<id>, the screen starts on that project.
  const [params] = useSearchParams();
  const [projectId, setProjectId] = useState(Number(params.get('project')) || 0);
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
  const [unloaded, setUnloaded] = useState<Missed[]>([]);

  const run = async (fn: () => Promise<unknown>) => { try { setErr(''); await fn(); await load(projectId); } catch (x: any) { setErr(x.message); } };

  async function load(pid: number) {
    if (!pid) return;
    // A section the user may not read (or that fails) is named on screen instead of showing as an empty table.
    const missed = new Map<MessageKey, string>();
    const settle = async <T,>(p: Promise<T>, fallback: T, section: MessageKey) => { try { return await p; } catch (x: any) { missed.set(section, x.message); return fallback; } };
    const contracts = (await settle(apiGet<any>('/contracts'), { data: [] }, 'pc.secContracts')).data.filter((c: Row) => Number(c.project_id) === pid && ['signed', 'active'].includes(c.contract_status));
    const positions = await Promise.all(contracts.map(async (c: Row) => ({ contract_id: c.id, ...(await settle(apiGet<any>(`/contract-admin/contracts/${c.id}/time-position`), { data: {} }, 'pc.secTimePosition')).data })));
    setTime(positions);
    setRisks((await settle(apiGet<any>(`/risks?project_id=${pid}`), { data: [] }, 'pc.secRisks')).data);
    setRiskSummary((await settle(apiGet<any>(`/risks/summary?project_id=${pid}`), { data: null }, 'pc.secRiskSummary')).data);
    const g = (await settle(apiGet<any>(`/mobilisation/gates?project_id=${pid}`), { data: [] }, 'pc.secMobilisation')).data;
    setGates(g);
    setGate(g[0] ? (await settle(apiGet<any>(`/mobilisation/gates/${g[0].id}`), { data: null }, 'pc.secMobilisationGate')).data : null);
    setPacks((await settle(apiGet<any>(`/reports/packs?project_id=${pid}`), { data: [] }, 'pc.secReportPacks')).data);
    setSystems((await settle(apiGet<any>(`/commissioning/systems?project_id=${pid}`), { data: [] }, 'pc.secCommissioning')).data);
    setImpacts((await settle(apiGet<any>(`/technical-office/design-impacts?project_id=${pid}`), { data: [] }, 'pc.secDesignImpacts')).data);
    setUnloaded([...missed.entries()]);
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

  const cols = (c: [string, MessageKey][]): [string, string][] => c.map(([k, h]) => [k, t(h)]);
  const coded = (rows: Row[], keys: string[]): Row[] => rows.map(r => ({ ...r, ...Object.fromEntries(keys.map(k => [`${k}_label`, tv(r[k])])) }));

  return (
    <section className="page-stack">
      <header className="page-header"><div><p className="eyebrow">{t('pc.eyebrow')}</p><h1>{t('pc.title')}</h1>
        <p>{t('pc.intro')}</p></div></header>
      {err && <div className="notice" role="alert">{err}</div>}
      {unloaded.length > 0 && <div className="notice muted" data-section="unloaded"><NotLoaded text={t('pc.notLoaded', { list: '' })} items={unloaded.map(([k, m]): [string, string] => [t(k), m])} /></div>}
      <div className="panel"><div className="form-row">
        <label>{t('pc.project')} <select aria-label={t('pc.project')} value={projectId} onChange={e => setProjectId(Number(e.target.value))}>
          <option value={0}>{t('pc.selectProject')}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.project_code} — {p.project_name}</option>)}
        </select></label>
      </div></div>

      {projectId > 0 && <>
        <div className="panel" data-section="time"><h2>{t('pc.time')}</h2>
          <p className="muted">{t('pc.timeNote')}</p>
          <Table rows={coded(time, ['forecast_source', 'ld_terms_status', 'programme_update_outstanding'])} cols={cols([['contract_id', 'pc.colContract'], ['original_completion', 'pc.colOriginalCompletion'], ['approved_extension_days', 'pc.colApprovedEot'], ['revised_completion', 'pc.colRevisedCompletion'],
            ['forecast_completion', 'pc.colForecast'], ['forecast_source_label', 'pc.colForecastSource'], ['days_late', 'pc.colDaysLate'], ['ld_terms_status_label', 'pc.colLdTerms'], ['ld_exposure', 'pc.colLdExposure'], ['programme_update_outstanding_label', 'pc.colProgrammeUpdate']])} />
        </div>

        <div className="panel" data-section="risks"><h2>{t('pc.risks')}</h2>
          {riskSummary && <div className="kpi-grid">
            <div className="kpi"><span>{t('pc.kpiOpen')}</span><strong><Num v={riskSummary.open_risks} /></strong></div>
            <div className="kpi"><span>{t('pc.kpiEscalated')}</span><strong><Num v={riskSummary.escalated} /></strong></div>
            <div className="kpi"><span>{t('pc.kpiReviewsOverdue')}</span><strong><Num v={riskSummary.reviews_overdue} /></strong></div>
            <div className="kpi"><span>{t('pc.kpiOpenThreatEv')}</span><strong><Num v={riskSummary.open_threat_expected_value} /></strong></div>
            <div className="kpi"><span>{t('pc.kpiNotQuantified')}</span><strong><Num v={riskSummary.threats_not_quantified} /></strong></div>
          </div>}
          <div className="form-row">
            <input aria-label={t('pc.riskNumber')} placeholder={t('pc.riskNo')} value={risk.risk_no} onChange={e => setRisk({ ...risk, risk_no: e.target.value })} />
            <select aria-label={t('pc.kind')} value={risk.kind} onChange={e => setRisk({ ...risk, kind: e.target.value })}>{['threat', 'opportunity'].map(k => <option key={k} value={k}>{tv(k)}</option>)}</select>
            <input aria-label={t('pc.riskTitle')} placeholder={t('pc.titlePlaceholder')} value={risk.title} onChange={e => setRisk({ ...risk, title: e.target.value })} />
            <input aria-label={t('pc.cause')} placeholder={t('pc.cause')} value={risk.cause} onChange={e => setRisk({ ...risk, cause: e.target.value })} />
            <input aria-label={t('pc.effect')} placeholder={t('pc.effect')} value={risk.effect} onChange={e => setRisk({ ...risk, effect: e.target.value })} />
            <select aria-label={t('pc.probability')} value={risk.probability_level} onChange={e => setRisk({ ...risk, probability_level: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{t('pc.probabilityOption', { n })}</option>)}</select>
            <select aria-label={t('pc.impact')} value={risk.impact_level} onChange={e => setRisk({ ...risk, impact_level: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{t('pc.impactOption', { n })}</option>)}</select>
            <button onClick={() => run(async () => { await apiPost('/risks', { ...risk, project_id: projectId, owner_user_id: Number(me?.id) }); setRisk(emptyRisk); })}>{t('pc.raiseRisk')}</button>
          </div>
          <Table rows={coded(risks, ['kind', 'status', 'review_overdue'])} cols={cols([['risk_no', 'pc.colNo'], ['kind_label', 'pc.colKind'], ['title', 'pc.colTitle'], ['score', 'pc.colScore'], ['expected_value', 'pc.colEv'], ['status_label', 'pc.colStatus'], ['review_overdue_label', 'pc.colReviewOverdue'], ['open_responses', 'pc.colOpenResponses']])}
            actions={r => r.status === 'closed' ? null : <button onClick={() => run(() => apiPost(`/risks/${r.id}/close`, {
              closure_type: r.kind === 'threat' ? (ask(t('pc.askThreatClosure')) || 'mitigated') : (ask(t('pc.askOpportunityClosure')) || 'realised'),
              reason: ask(t('pc.askClosureReason')), lesson_learned: ask(t('pc.askLesson')) }))}>{t('pc.close')}</button>} />
        </div>

        <div className="panel" data-section="mobilisation"><h2>{t('pc.mobilisation')}</h2>
          {!gates.length || gates[0].status === 'no_go'
            ? <button onClick={() => run(() => apiPost('/mobilisation/gates', { project_id: projectId }))}>{t('pc.openGate')}</button>
            : gate && <>
              <p>{t('pc.gateLabel', { id: gate.id })} <strong data-status={gate.status}>{tv(gate.status)}</strong> {t('pc.openMandatory')} <strong><Num v={gate.open_mandatory} /></strong></p>
              {gate.status === 'draft' && <div className="form-row">
                <button onClick={() => run(() => apiPost(`/mobilisation/gates/${gate.id}/items`, { category: ask(t('pc.askCategory')) || 'other', item: ask(t('pc.askItem')), mandatory: window.confirm(t('pc.confirmMandatory')) }))}>{t('pc.addItem')}</button>
                <button onClick={() => run(() => apiPost(`/mobilisation/gates/${gate.id}/submit`, {}))}>{t('pc.submitGate')}</button>
              </div>}
              {gate.status === 'submitted' && <div className="form-row">
                <button onClick={() => run(() => apiPost(`/mobilisation/gates/${gate.id}/decision`, { decision: 'go', note: ask(t('pc.askDecisionNote')) || undefined }))}>{t('pc.decideGo')}</button>
                <button onClick={() => run(() => apiPost(`/mobilisation/gates/${gate.id}/decision`, { decision: 'no_go', note: ask(t('pc.askNoGoReason')) }))}>{t('pc.decideNoGo')}</button>
              </div>}
              <Table rows={coded(gate.items ?? [], ['category', 'mandatory', 'status'])} cols={cols([['category_label', 'pc.colCategory'], ['item', 'pc.colItem'], ['mandatory_label', 'pc.colMandatory'], ['status_label', 'pc.colStatus'], ['note', 'pc.colNoteReason']])}
                actions={i => i.status !== 'open' || ['go', 'no_go'].includes(gate.status) ? null : <>
                  <button onClick={() => run(() => apiPost(`/mobilisation/items/${i.id}/close`, { note: ask(t('pc.askEvidenceNote')) }))}>{t('pc.close')}</button>
                  {i.mandatory && <button onClick={() => run(() => apiPost(`/mobilisation/items/${i.id}/risk-accept`, { risk_id: Number(ask(t('pc.askRiskId'))), note: ask(t('pc.askRiskAcceptNote')) }))}>{t('pc.riskAccept')}</button>}
                </>} />
            </>}
        </div>

        <div className="panel" data-section="report-packs"><h2>{t('pc.packs')}</h2>
          <div className="form-row"><button onClick={() => run(() => apiPost('/reports/packs', { project_id: projectId, period_type: ask(t('pc.askPeriodType')) || 'weekly', period_start: ask(t('pc.askPeriodStart')), period_end: ask(t('pc.askPeriodEnd')) }))}>{t('pc.freezePack')}</button></div>
          <Table rows={coded(packs, ['period_type', 'status'])} cols={cols([['period_type_label', 'pc.colType'], ['period_start', 'pc.colFrom'], ['period_end', 'pc.colDataDate'], ['exception_count', 'pc.colExceptions'], ['status_label', 'pc.colStatus']])}
            actions={p => <button onClick={async () => { try { setPack((await apiGet<any>(`/reports/packs/${p.id}`)).data); } catch (x: any) { setErr(x.message); } }}>{t('pc.open')}</button>} />
          {pack && <div className="panel" data-section="pack-detail">
            <h3>{t('pc.packHeading', { id: pack.id, status: tv(pack.status) })}</h3>
            <p>{t('pc.hashValid')} <strong>{tv(pack.verification?.stored_hash_valid)}</strong> · {t('pc.dataChanged')} <strong>{tv(pack.verification?.data_changed_since_freeze)}</strong></p>
            <p>{t('pc.costAsOf')} {t('pc.budget')} <Num v={pack.payload?.cost?.budget} /> · {t('pc.committed')} <Num v={pack.payload?.cost?.committed} /> · {t('pc.actual')} <Num v={pack.payload?.cost?.actual} /> · {t('pc.accrual')} <Num v={pack.payload?.cost?.accrual} /></p>
            <Table rows={coded(pack.payload?.exceptions ?? [], ['type'])} cols={cols([['type_label', 'pc.colException'], ['count', 'pc.colCount'], ['amount', 'pc.colAmount'], ['cost_code_id', 'pc.colCostCode']])} />
            <p>{t('pc.narrative')} {fmt(pack.narrative)}</p>
            <div className="form-row">
              {pack.status === 'draft' && <button onClick={() => run(async () => { await apiPatch(`/reports/packs/${pack.id}/narrative`, { narrative: ask(t('pc.askNarrative')) }); setPack((await apiGet<any>(`/reports/packs/${pack.id}`)).data); })}>{t('pc.writeNarrative')}</button>}
              {pack.status === 'draft' && <button onClick={() => run(async () => { await apiPost(`/reports/packs/${pack.id}/submit`, {}); setPack((await apiGet<any>(`/reports/packs/${pack.id}`)).data); })}>{t('pc.submit')}</button>}
              {pack.status === 'submitted' && <button onClick={() => run(async () => { await apiPost(`/reports/packs/${pack.id}/decision`, { decision: 'approved' }); setPack((await apiGet<any>(`/reports/packs/${pack.id}`)).data); })}>{t('pc.approve')}</button>}
              {pack.status === 'submitted' && <button onClick={() => run(async () => { await apiPost(`/reports/packs/${pack.id}/decision`, { decision: 'rejected', reason: ask(t('pc.askRejectReason')) }); setPack((await apiGet<any>(`/reports/packs/${pack.id}`)).data); })}>{t('pc.reject')}</button>}
            </div>
          </div>}
        </div>

        <div className="panel" data-section="commissioning"><h2>{t('pc.commissioning')}</h2>
          <Table rows={coded(systems, ['ready', 'handed_over'])} cols={cols([['system_code', 'pc.colSystem'], ['name', 'pc.colName'], ['packs_accepted', 'pc.colPacksAccepted'], ['test_packs', 'pc.colPacks'], ['open_category_a', 'pc.colOpenA'], ['open_category_b', 'pc.colOpenB'],
            ['dossier_satisfied', 'pc.colDossierDone'], ['dossier_required', 'pc.colDossierRequired'], ['ready_label', 'pc.colReady'], ['handed_over_label', 'pc.colHandedOver']])} />
        </div>

        <div className="panel" data-section="design-impacts"><h2>{t('pc.impacts')}</h2>
          <Table rows={coded(impacts, ['status'])} cols={cols([['drawing_no', 'pc.colDrawing'], ['superseded_revision', 'pc.colFromRev'], ['new_revision', 'pc.colToRev'], ['items', 'pc.colObjects'], ['pending_items', 'pc.colPending'], ['status_label', 'pc.colStatus']])}
            actions={i => <button onClick={async () => { try { setImpact((await apiGet<any>(`/technical-office/design-impacts/${i.id}`)).data); } catch (x: any) { setErr(x.message); } }}>{t('pc.open')}</button>} />
          {impact && <div className="panel" data-section="impact-detail">
            <h3>{impact.drawing_no} — {tv(impact.status)}</h3>
            <Table rows={coded(impact.items ?? [], ['disposition'])} cols={cols([['object_label', 'pc.colObject'], ['based_on_revision', 'pc.colBasedOnRev'], ['disposition_label', 'pc.colDisposition'], ['reason', 'pc.colReason']])}
              actions={x => x.disposition !== 'pending' || impact.status === 'closed' ? null : <>
                <button onClick={() => run(async () => { await apiPost(`/technical-office/design-impact-items/${x.id}/disposition`, { disposition: 'no_change', reason: ask(t('pc.askNoChange')) }); setImpact((await apiGet<any>(`/technical-office/design-impacts/${impact.id}`)).data); })}>{t('pc.noChange')}</button>
                <button onClick={() => run(async () => { await apiPost(`/technical-office/design-impact-items/${x.id}/disposition`, { disposition: 'change_required', reason: ask(t('pc.askWhatChanges')) }); setImpact((await apiGet<any>(`/technical-office/design-impacts/${impact.id}`)).data); })}>{t('pc.changeRequired')}</button>
              </>} />
            {impact.status === 'open' && <button onClick={() => run(async () => {
              const ev = ask(t('pc.askEventId'));
              await apiPost(`/technical-office/design-impacts/${impact.id}/close`, ev ? { contract_event_id: Number(ev) } : { no_entitlement_reason: ask(t('pc.askNoEntitlement')) || undefined });
              setImpact((await apiGet<any>(`/technical-office/design-impacts/${impact.id}`)).data);
            })}>{t('pc.closeImpact')}</button>}
          </div>}
        </div>
      </>}
    </section>
  );
}
