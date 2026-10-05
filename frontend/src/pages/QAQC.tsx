import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ReferenceSelect } from '../components/ReferenceSelect';
const n=(v:any)=>Number(v);

export function QAQC() {
  const [inspections,setInspections]=useState<any[]>([]),[ncrs,setNcrs]=useState<any[]>([]),[metrics,setMetrics]=useState<any>({});
  const [error,setError]=useState('');
  const [inspection,setInspection]=useState<any>({project_id:'',checklist_type:''});
  const [ncr,setNcr]=useState<any>({project_id:'',ncr_no:'',description:'',cost_impact:''});
  async function load(){const [i,nc,m]=await Promise.all([api.get('/qaqc/inspections'),api.get('/qaqc/ncrs'),api.get('/qaqc/metrics')]);setInspections(i.data);setNcrs(nc.data);setMetrics(m.data||{});}
  useEffect(()=>{load().catch((e:any)=>setError(e.message));},[]);
  async function run(fn:()=>Promise<any>){try{setError('');await fn();await load();}catch(e:any){setError(e.message);}}

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">QA/QC</p><h1>Quality Control</h1><p>Inspection control and independent NCR closure with traceable root cause and corrective action.</p></div></header>
    {error&&<div className="notice">{error}</div>}
    <div className="cards-grid"><div className="metric-card"><span>Inspections</span><strong>{metrics.total_inspections??inspections.length}</strong></div><div className="metric-card"><span>Passed</span><strong>{metrics.passed_inspections??0}</strong></div><div className="metric-card"><span>Total NCRs</span><strong>{metrics.total_ncrs??ncrs.length}</strong></div><div className="metric-card"><span>Closed NCRs</span><strong>{metrics.closed_ncrs??0}</strong></div></div>

    <div className="panel"><h2>Inspections</h2><div className="form-row"><ReferenceSelect kind="projects" value={inspection.project_id} onChange={v=>setInspection({...inspection,project_id:v})} placeholder="Project"/><input placeholder="Checklist type" value={inspection.checklist_type} onChange={e=>setInspection({...inspection,checklist_type:e.target.value})}/><button onClick={()=>run(()=>api.post('/qaqc/inspections',{project_id:n(inspection.project_id),checklist_type:inspection.checklist_type}))}>Create Inspection</button></div><div className="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Date</th><th>Action</th></tr></thead><tbody>{inspections.map(i=><tr key={i.id}><td>{i.checklist_type}</td><td>{i.status}</td><td>{i.inspection_date||'—'}</td><td>{i.status==='pending'&&<><button onClick={()=>run(()=>api.patch(`/qaqc/inspections/${i.id}/status`,{status:'passed',inspection_date:new Date().toISOString().slice(0,10)}))}>Pass</button><button onClick={()=>run(()=>api.patch(`/qaqc/inspections/${i.id}/status`,{status:'failed',inspection_date:new Date().toISOString().slice(0,10)}))}>Fail</button></>}</td></tr>)}</tbody></table></div></div>

    <div className="panel"><h2>NCRs</h2><div className="form-row"><ReferenceSelect kind="projects" value={ncr.project_id} onChange={v=>setNcr({...ncr,project_id:v})} placeholder="Project"/><input placeholder="NCR No." value={ncr.ncr_no} onChange={e=>setNcr({...ncr,ncr_no:e.target.value})}/><input placeholder="Description" value={ncr.description} onChange={e=>setNcr({...ncr,description:e.target.value})}/><input type="number" step="0.01" placeholder="Cost impact" value={ncr.cost_impact} onChange={e=>setNcr({...ncr,cost_impact:e.target.value})}/><button onClick={()=>run(()=>api.post('/qaqc/ncrs',{project_id:n(ncr.project_id),ncr_no:ncr.ncr_no,description:ncr.description,cost_impact:ncr.cost_impact===''?undefined:n(ncr.cost_impact)}))}>Raise NCR</button></div><div className="table-wrap"><table><thead><tr><th>No.</th><th>Description</th><th>Raised By</th><th>Status</th><th>Cost Impact</th><th>Action</th></tr></thead><tbody>{ncrs.map(x=><tr key={x.id}><td>{x.ncr_no}</td><td>{x.description}</td><td>{x.raised_by_name||x.raised_by}</td><td>{x.status}</td><td>{x.cost_impact||'—'}</td><td>{x.status==='open'&&<button onClick={()=>{const root_cause=window.prompt('Root cause (required)');if(!root_cause)return;const corrective_action=window.prompt('Corrective action (required)');if(corrective_action)run(()=>api.patch(`/qaqc/ncrs/${x.id}/close`,{root_cause,corrective_action}));}}>Independent Close</button>}</td></tr>)}</tbody></table></div></div>
  </section>;
}
