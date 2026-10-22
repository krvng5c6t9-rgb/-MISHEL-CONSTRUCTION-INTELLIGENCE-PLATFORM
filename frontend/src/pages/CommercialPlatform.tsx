import { useEffect,useState } from 'react';
import { api } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Num, Table } from '../components/RecordTable';

// R1.2: labels from messages/commercialPlatform.ts; billing periods, statuses, stages and yes / no through tv().
// CC-075: each tab has defined, labelled columns (the screen showed the first 9 raw API fields under their database
// names); a plan's base price is shown with its currency.
type Summary={plans:number;subscriptions:number;onboarding_open:number;usage_events:number;usage_quantity:number;active_connections:number};
type Col=[string,MessageKey];
const TABS:[string,MessageKey][]=[['plans','cp.tabPlans'],['subscriptions','cp.tabSubscriptions'],['usage','cp.tabUsage'],['onboarding','cp.tabOnboarding']];
const COLS:Record<string,Col[]>={
 plans:[['plan_key','cp.colKey'],['name','cp.colName'],['billing_period','cp.colBilling'],['price','cp.colPrice'],['seat_limit','cp.colSeats'],['project_limit','cp.colProjects'],['storage_gb_limit','cp.colStorage'],['ai_credit_limit','cp.colAiCredits'],['is_active','cp.colActive']],
 subscriptions:[['plan_name','cp.colPlan'],['status','cp.colStatus'],['starts_at','cp.colStarts'],['trial_ends_at','cp.colTrialEnds'],['current_period_end','cp.colPeriodEnd'],['seats_purchased','cp.colSeatsBought']],
 usage:[['meter_key','cp.colMeter'],['unit','cp.colUnit'],['events','cp.colEvents'],['quantity','cp.colQuantity'],['last_event','cp.colLastEvent']],
 onboarding:[['stage','cp.colStage'],['migration_status','cp.colMigration'],['integration_status','cp.colIntegration'],['training_status','cp.colTraining'],['go_live_target','cp.colGoLive'],['completed_at','cp.colCompletedAt']]
};
const CODED=['billing_period','status','stage','is_active'];
export function CommercialPlatform(){
 const { t, tv } = useI18n();
 const [summary,setSummary]=useState<Summary|null>(null);const [tab,setTab]=useState('plans');const [rows,setRows]=useState<any[]>([]);const [error,setError]=useState('');const [failed,setFailed]=useState(false);
 async function load(){try{setError('');setFailed(false);setSummary((await api.get('/commercial-platform/summary')).data);const path=tab==='subscriptions'?'subscription':tab;const r=await api.get(`/commercial-platform/${path}`);setRows(r.data||[]);}catch(e:any){if(e?.message)setError(e.message);else setFailed(true);}}
 useEffect(()=>{load();},[tab]);
 const view=rows.map((r,i)=>{const v:any={id:r.id??`${r.meter_key}-${i}`,...r};for(const k of CODED)if(k in r&&r[k]!=null)v[k]=tv(r[k]);if(tab==='plans')v.price=r.base_price!=null?`${r.base_price} ${r.currency??''}`.trim():'';for(const k of ['migration_status','integration_status','training_status'])if(r[k]&&typeof r[k]==='object')v[k]=r[k].status!=null?tv(r[k].status):JSON.stringify(r[k]);return v;});
 return <section className="page-stack"><header className="page-header"><div><h1>{t('cp.title')}</h1><p>{t('cp.intro')}</p></div></header>
 {(error||failed)&&<div className="notice" role="alert">{failed?t('cp.loadFailed'):<bdi>{error}</bdi>}</div>}
 <div className="metric-grid" data-section="kpis"><div className="metric-card"><small>{t('cp.plans')}</small><strong><Num v={summary?.plans??0}/></strong></div><div className="metric-card"><small>{t('cp.subscriptions')}</small><strong><Num v={summary?.subscriptions??0}/></strong></div><div className="metric-card"><small>{t('cp.openOnboarding')}</small><strong><Num v={summary?.onboarding_open??0}/></strong></div><div className="metric-card"><small>{t('cp.usageEvents')}</small><strong><Num v={summary?.usage_events??0}/></strong></div><div className="metric-card"><small>{t('cp.usageQty')}</small><strong><Num v={summary?.usage_quantity??0}/></strong></div><div className="metric-card"><small>{t('cp.connections')}</small><strong><Num v={summary?.active_connections??0}/></strong></div></div>
 <div className="tabs" role="tablist">{TABS.map(([k,label])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{t(label)}</button>)}</div>
 <div className="panel" data-section="records">{view.length?<Table rows={view} cols={COLS[tab].map(([k,h])=>[k,t(h)] as [string,string])}/>:<p className="muted">{t('cp.noRecords')}</p>}</div>
 </section>
}
