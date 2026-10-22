import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Num, Table } from '../components/RecordTable';

// R1.2: labels from messages/aiPlatform.ts; risk levels, statuses and yes / no through tv(). CC-075: each tab has
// defined, labelled columns (the screen showed the first 8 raw API fields under their database names, and nested
// JSON as text); the cost tile says no currency is recorded (ai_runs.estimated_cost carries none).
type Summary={models:number;agents:number;tools:number;workflows:number;runs:number;failed_runs:number;estimated_cost:number};
type Col=[string,MessageKey];
const TABS:[string,MessageKey][]=[['agents','ai.tabAgents'],['models','ai.tabModels'],['tools','ai.tabTools'],['prompts','ai.tabPrompts'],['workflows','ai.tabWorkflows'],['runs','ai.tabRuns'],['evaluations','ai.tabEvaluations']];
const COLS:Record<string,Col[]>={
 agents:[['agent_key','ai.colKey'],['name','ai.colName'],['risk_level','ai.colRisk'],['status','ai.colStatus'],['human_approval_required','ai.colHumanApproval'],['write_access','ai.colWriteAccess'],['kill_switch','ai.colKillSwitch']],
 models:[['provider','ai.colProvider'],['model_key','ai.colKey'],['display_name','ai.colName'],['use_case','ai.colUseCase'],['data_class','ai.colDataClass'],['cost_class','ai.colCostClass'],['is_approved','ai.colApproved'],['status','ai.colStatus']],
 tools:[['tool_key','ai.colKey'],['name','ai.colName'],['risk_class','ai.colRisk'],['approval_required','ai.colApprovalRequired'],['side_effects','ai.colSideEffects'],['is_enabled','ai.colEnabled']],
 prompts:[['prompt_key','ai.colKey'],['version','ai.colVersion'],['purpose','ai.colPurpose'],['status','ai.colStatus']],
 workflows:[['workflow_key','ai.colKey'],['name','ai.colName'],['trigger_type','ai.colTrigger'],['idempotency_required','ai.colIdempotency'],['is_enabled','ai.colEnabled'],['version','ai.colVersion']],
 runs:[['id','ai.colRun'],['agent_name','ai.colAgent'],['workflow_name','ai.colWorkflow'],['status','ai.colStatus'],['model_key','ai.colModel'],['input_tokens','ai.colTokensIn'],['output_tokens','ai.colTokensOut'],['estimated_cost','ai.colEstCost'],['started_at','ai.colStarted']],
 evaluations:[['evaluation_name','ai.colEvaluation'],['agent_name','ai.colAgent'],['model_name','ai.colModel'],['prompt','ai.colPrompt'],['passed','ai.colPassed'],['evaluated_at','ai.colEvaluated']]
};
const CODED=['risk_level','status','human_approval_required','write_access','kill_switch','is_approved','approval_required','side_effects','is_enabled','idempotency_required','passed'];

export function AIPlatform(){
 const { t, tv } = useI18n();
 const [summary,setSummary]=useState<Summary|null>(null); const [tab,setTab]=useState('agents'); const [rows,setRows]=useState<any[]>([]); const [error,setError]=useState(''); const [failed,setFailed]=useState(false);
 async function load(){try{setError('');setFailed(false);setSummary((await api.get('/ai-platform/summary')).data);const r=await api.get(`/ai-platform/${tab}`);setRows(r.data||[]);}catch(e:any){if(e?.message)setError(e.message);else setFailed(true);}}
 useEffect(()=>{load();},[tab]);
 const view=rows.map(r=>{const v:any={...r};for(const k of CODED)if(k in r&&r[k]!=null&&typeof r[k]!=='object')v[k]=tv(r[k]);if(tab==='evaluations')v.prompt=r.prompt_key?`${r.prompt_key} v${r.prompt_version??''}`:'';return v;});
 return <section className="page-stack"><header className="page-header"><div><h1>{t('ai.title')}</h1><p>{t('ai.intro')}</p></div></header>
 {(error||failed)&&<div className="notice" role="alert">{failed?t('ai.loadFailed'):<bdi>{error}</bdi>}</div>}
 <div className="metric-grid" data-section="kpis">
  <div className="metric-card"><small>{t('ai.agents')}</small><strong><Num v={summary?.agents??0}/></strong></div>
  <div className="metric-card"><small>{t('ai.models')}</small><strong><Num v={summary?.models??0}/></strong></div>
  <div className="metric-card"><small>{t('ai.tools')}</small><strong><Num v={summary?.tools??0}/></strong></div>
  <div className="metric-card"><small>{t('ai.workflows')}</small><strong><Num v={summary?.workflows??0}/></strong></div>
  <div className="metric-card"><small>{t('ai.runs')}</small><strong><Num v={summary?.runs??0}/></strong></div>
  <div className="metric-card"><small>{t('ai.failed')}</small><strong><Num v={summary?.failed_runs??0}/></strong></div>
  <div className="metric-card"><small>{t('ai.cost')}</small><strong><Num text={Number(summary?.estimated_cost||0).toFixed(2)}/></strong></div>
 </div>
 <div className="tabs" role="tablist">{TABS.map(([k,label])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{t(label)}</button>)}</div>
 <div className="panel" data-section="records">{view.length?<Table rows={view} cols={COLS[tab].map(([k,h])=>[k,t(h)] as [string,string])}/>:<p className="muted">{t('ai.noRecords')}</p>}</div>
 </section>
}
