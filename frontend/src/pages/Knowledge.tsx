import { useEffect,useState } from 'react';
import { api } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Num, Table } from '../components/RecordTable';

// R1.2: labels from messages/knowledge.ts; source types, statuses and yes / no through tv(). CC-075: each tab has
// defined, labelled columns (the screen showed the first 9 raw API fields under their database names).
type Col=[string,MessageKey];
const TABS:[string,MessageKey][]=[['sources','kn.tabSources'],['queries','kn.tabQueries']];
const COLS:Record<string,Col[]>={
 sources:[['source_key','kn.colKey'],['title','kn.colTitle'],['source_type','kn.colType'],['authority_level','kn.colAuthority'],['revision','kn.colRevision'],['status','kn.colStatus'],['effective_date','kn.colEffective']],
 queries:[['created_at','kn.colAsked'],['query_text','kn.colQuestion'],['model_key','kn.colModel'],['grounded','kn.colGrounded']]
};
const CODED=['source_type','status','grounded'];
export function Knowledge(){
 const { t, tv } = useI18n();
 const [summary,setSummary]=useState<any>(null);const [tab,setTab]=useState('sources');const [rows,setRows]=useState<any[]>([]);const [error,setError]=useState('');const [failed,setFailed]=useState(false);
 async function load(){try{setError('');setFailed(false);setSummary((await api.get('/knowledge/summary')).data);setRows((await api.get(`/knowledge/${tab}`)).data||[]);}catch(e:any){if(e?.message)setError(e.message);else setFailed(true);}}
 useEffect(()=>{load();},[tab]);
 const view=rows.map(r=>{const v:any={...r};for(const k of CODED)if(k in r&&r[k]!=null)v[k]=tv(r[k]);return v;});
 return <section className="page-stack"><header className="page-header"><div><h1>{t('kn.title')}</h1><p>{t('kn.intro')}</p></div></header>
 {(error||failed)&&<div className="notice" role="alert">{failed?t('kn.loadFailed'):<bdi>{error}</bdi>}</div>}
 <div className="metric-grid" data-section="kpis"><div className="metric-card"><small>{t('kn.sources')}</small><strong><Num v={summary?.sources??0}/></strong></div><div className="metric-card"><small>{t('kn.current')}</small><strong><Num v={summary?.current_sources??0}/></strong></div><div className="metric-card"><small>{t('kn.chunks')}</small><strong><Num v={summary?.chunks??0}/></strong></div><div className="metric-card"><small>{t('kn.queries')}</small><strong><Num v={summary?.queries??0}/></strong></div><div className="metric-card"><small>{t('kn.grounded')}</small><strong><Num v={summary?.grounded_queries??0}/></strong></div></div>
 <div className="tabs" role="tablist">{TABS.map(([k,label])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{t(label)}</button>)}</div>
 <div className="panel" data-section="records">{view.length?<Table rows={view} cols={COLS[tab].map(([k,h])=>[k,t(h)] as [string,string])}/>:<p className="muted">{t('kn.noRecords')}</p>}</div>
 </section>
}
