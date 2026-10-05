import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Summary={models:number;agents:number;tools:number;workflows:number;runs:number;failed_runs:number;estimated_cost:number};
type Row={id:number;[k:string]:any};

export function AIPlatform(){
 const [summary,setSummary]=useState<Summary|null>(null); const [tab,setTab]=useState('agents'); const [rows,setRows]=useState<Row[]>([]); const [error,setError]=useState('');
 async function load(){try{setError('');setSummary((await api.get('/ai-platform/summary')).data);const r=await api.get(`/ai-platform/${tab}`);setRows(r.data||[]);}catch(e:any){setError(e?.message||'Failed to load AI Platform');}}
 useEffect(()=>{load();},[tab]);
 const tabs=['agents','models','tools','prompts','workflows','runs','evaluations'];
 return <div className="page"><div className="page-header"><div><h1>AI Platform Control Center</h1><p>Agents, models, tools, prompts, workflows, runs, evaluations and cost governance.</p></div></div>
 {error&&<div className="alert error">{error}</div>}
 <div className="metric-grid">
  <div className="metric-card"><small>Agents</small><strong>{summary?.agents??0}</strong></div>
  <div className="metric-card"><small>Models</small><strong>{summary?.models??0}</strong></div>
  <div className="metric-card"><small>Tools</small><strong>{summary?.tools??0}</strong></div>
  <div className="metric-card"><small>Workflows</small><strong>{summary?.workflows??0}</strong></div>
  <div className="metric-card"><small>Runs</small><strong>{summary?.runs??0}</strong></div>
  <div className="metric-card"><small>Failed</small><strong>{summary?.failed_runs??0}</strong></div>
  <div className="metric-card"><small>AI Cost</small><strong>{Number(summary?.estimated_cost||0).toFixed(2)}</strong></div>
 </div>
 <div className="tabs">{tabs.map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t}</button>)}</div>
 <div className="panel"><div className="table-wrap"><table><thead><tr>{rows[0]&&Object.keys(rows[0]).slice(0,8).map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.id}>{Object.keys(r).slice(0,8).map(k=><td key={k}>{typeof r[k]==='object'?JSON.stringify(r[k]):String(r[k]??'')}</td>)}</tr>)}</tbody></table>{!rows.length&&<p className="muted">No records yet.</p>}</div></div>
 </div>
}
