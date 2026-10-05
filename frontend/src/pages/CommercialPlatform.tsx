import { useEffect,useState } from 'react';
import { api } from '../lib/api';

type Summary={plans:number;subscriptions:number;onboarding_open:number;usage_events:number;usage_quantity:number;active_connections:number};
export function CommercialPlatform(){
 const [summary,setSummary]=useState<Summary|null>(null);const [tab,setTab]=useState('plans');const [rows,setRows]=useState<any[]>([]);const [error,setError]=useState('');
 async function load(){try{setError('');setSummary((await api.get('/commercial-platform/summary')).data);const path=tab==='subscriptions'?'subscription':tab;const r=await api.get(`/commercial-platform/${path}`);setRows(r.data||[]);}catch(e:any){setError(e?.message||'Failed to load commercial platform');}}
 useEffect(()=>{load();},[tab]);
 const tabs=['plans','subscriptions','usage','onboarding'];
 return <div className="page"><div className="page-header"><div><h1>Commercial SaaS Control Center</h1><p>Plans, subscriptions, tenant onboarding, usage metering and commercialization readiness.</p></div></div>{error&&<div className="alert error">{error}</div>}
 <div className="metric-grid"><div className="metric-card"><small>Plans</small><strong>{summary?.plans??0}</strong></div><div className="metric-card"><small>Subscriptions</small><strong>{summary?.subscriptions??0}</strong></div><div className="metric-card"><small>Open Onboarding</small><strong>{summary?.onboarding_open??0}</strong></div><div className="metric-card"><small>Usage Events</small><strong>{summary?.usage_events??0}</strong></div><div className="metric-card"><small>Usage Qty</small><strong>{summary?.usage_quantity??0}</strong></div><div className="metric-card"><small>Connections</small><strong>{summary?.active_connections??0}</strong></div></div>
 <div className="tabs">{tabs.map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t}</button>)}</div><DataTable rows={rows}/></div>
}
function DataTable({rows}:{rows:any[]}){const keys=rows[0]?Object.keys(rows[0]).slice(0,9):[];return <div className="panel"><div className="table-wrap"><table><thead><tr>{keys.map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={r.id??i}>{keys.map(k=><td key={k}>{typeof r[k]==='object'?JSON.stringify(r[k]):String(r[k]??'')}</td>)}</tr>)}</tbody></table>{!rows.length&&<p className="muted">No records yet.</p>}</div></div>}
