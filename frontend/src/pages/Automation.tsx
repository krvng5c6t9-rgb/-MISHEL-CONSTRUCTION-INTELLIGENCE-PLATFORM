import { useEffect,useState } from 'react';
import { api } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Num, Table } from '../components/RecordTable';

// R1.2: labels from messages/automation.ts; engines, statuses, connection types and yes / no through tv(). CC-075: each
// tab has defined, labelled columns (the screen showed the first 9 raw API fields under their database names).
type Col=[string,MessageKey];
const TABS:[string,MessageKey][]=[['workflows','au.tabWorkflows'],['executions','au.tabExecutions'],['connections','au.tabConnections']];
const COLS:Record<string,Col[]>={
 workflows:[['workflow_key','au.colKey'],['name','au.colName'],['engine','au.colEngine'],['trigger_type','au.colTrigger'],['status','au.colStatus'],['version','au.colVersion'],['idempotency_required','au.colIdempotency']],
 executions:[['id','au.colExecution'],['workflow_name','au.colWorkflow'],['engine','au.colEngine'],['status','au.colStatus'],['retry_count','au.colRetries'],['error_code','au.colError'],['started_at','au.colStarted'],['completed_at','au.colCompleted']],
 connections:[['connection_key','au.colKey'],['provider','au.colProvider'],['connection_type','au.colType'],['status','au.colStatus'],['last_health_status','au.colHealth'],['last_health_at','au.colHealthAt']]
};
const CODED=['engine','status','connection_type','idempotency_required'];
export function Automation(){
 const { t, tv } = useI18n();
 const [summary,setSummary]=useState<any>(null);const [tab,setTab]=useState('workflows');const [rows,setRows]=useState<any[]>([]);const [error,setError]=useState('');const [failed,setFailed]=useState(false);
 async function load(){try{setError('');setFailed(false);setSummary((await api.get('/automation/summary')).data);setRows((await api.get(`/automation/${tab}`)).data||[]);}catch(e:any){if(e?.message)setError(e.message);else setFailed(true);}}
 useEffect(()=>{load();},[tab]);
 const view=rows.map(r=>{const v:any={...r};for(const k of CODED)if(k in r&&r[k]!=null)v[k]=tv(r[k]);return v;});
 return <section className="page-stack"><header className="page-header"><div><h1>{t('au.title')}</h1><p>{t('au.intro')}</p></div></header>
 {(error||failed)&&<div className="notice" role="alert">{failed?t('au.loadFailed'):<bdi>{error}</bdi>}</div>}
 <div className="metric-grid" data-section="kpis"><div className="metric-card"><small>{t('au.activeWorkflows')}</small><strong><Num v={summary?.active_workflows??0}/></strong></div><div className="metric-card"><small>{t('au.executions')}</small><strong><Num v={summary?.executions??0}/></strong></div><div className="metric-card"><small>{t('au.failed')}</small><strong><Num v={summary?.failed_executions??0}/></strong></div><div className="metric-card"><small>{t('au.connections')}</small><strong><Num v={summary?.active_connections??0}/></strong></div><div className="metric-card"><small>{t('au.webhooks')}</small><strong><Num v={summary?.active_webhooks??0}/></strong></div></div>
 <div className="tabs" role="tablist">{TABS.map(([k,label])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{t(label)}</button>)}</div>
 <div className="panel" data-section="records">{view.length?<Table rows={view} cols={COLS[tab].map(([k,h])=>[k,t(h)] as [string,string])}/>:<p className="muted">{t('au.noRecords')}</p>}</div>
 </section>
}
