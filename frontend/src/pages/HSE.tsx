import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ReferenceSelect } from '../components/ReferenceSelect';

const n=(v:any)=>Number(v);

export function HSE() {
  const [incidents,setIncidents]=useState<any[]>([]),[permits,setPermits]=useState<any[]>([]),[talks,setTalks]=useState<any[]>([]),[metrics,setMetrics]=useState<any>({});
  const [error,setError]=useState('');
  const [incident,setIncident]=useState<any>({project_id:'',severity:'near_miss',description:'',injured_party:''});
  const [permit,setPermit]=useState<any>({project_id:'',permit_type:'hot_work',expiry_date:''});
  const [talk,setTalk]=useState<any>({project_id:'',topic:'',attendees_count:''});

  async function load(){const [i,p,t,m]=await Promise.all([api.get('/hse/incidents'),api.get('/hse/permits'),api.get('/hse/toolbox-talks'),api.get('/hse/metrics')]);setIncidents(i.data);setPermits(p.data);setTalks(t.data);setMetrics(m.data||{});}
  useEffect(()=>{load().catch((e:any)=>setError(e.message));},[]);
  async function run(fn:()=>Promise<any>){try{setError('');await fn();await load();}catch(e:any){setError(e.message);}}

  const createIncident=()=>run(()=>api.post('/hse/incidents',{project_id:n(incident.project_id),severity:incident.severity,description:incident.description,injured_party:incident.injured_party||undefined}));
  const createPermit=()=>run(()=>api.post('/hse/permits',{project_id:n(permit.project_id),permit_type:permit.permit_type,expiry_date:permit.expiry_date||undefined}));
  const createTalk=()=>run(()=>api.post('/hse/toolbox-talks',{project_id:n(talk.project_id),topic:talk.topic,attendees_count:talk.attendees_count===''?undefined:n(talk.attendees_count)}));

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">HSE</p><h1>HSE Control</h1><p>Incident investigation, controlled PTW workflow, toolbox talks and independent closure.</p></div></header>
    {error&&<div className="notice">{error}</div>}
    <div className="cards-grid">
      <div className="metric-card"><span>Incidents</span><strong>{metrics.incidents??incidents.length}</strong></div>
      <div className="metric-card"><span>Serious Incidents</span><strong>{metrics.serious_incidents??0}</strong></div>
      <div className="metric-card"><span>Open/Active PTW</span><strong>{metrics.active_permits??0}</strong></div>
      <div className="metric-card"><span>Toolbox Talks</span><strong>{metrics.toolbox_talks??talks.length}</strong></div>
    </div>

    <div className="panel"><h2>Incidents</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={incident.project_id} onChange={v=>setIncident({...incident,project_id:v})} placeholder="Project"/>
      <select value={incident.severity} onChange={e=>setIncident({...incident,severity:e.target.value})}><option value="near_miss">Near miss</option><option value="minor">Minor</option><option value="major">Major</option><option value="fatality">Fatality</option></select>
      <input placeholder="Description" value={incident.description} onChange={e=>setIncident({...incident,description:e.target.value})}/>
      <input placeholder="Injured party (optional)" value={incident.injured_party} onChange={e=>setIncident({...incident,injured_party:e.target.value})}/>
      <button onClick={createIncident}>Report Incident</button>
    </div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Severity</th><th>Description</th><th>Reporter</th><th>Status</th><th>Action</th></tr></thead><tbody>{incidents.map(i=><tr key={i.id}><td>{i.incident_date}</td><td>{i.severity}</td><td>{i.description}</td><td>{i.reported_by_name||i.reported_by}</td><td>{i.investigation_status}</td><td>{i.investigation_status==='open'&&<button onClick={()=>{const corrective_actions=window.prompt('Corrective actions required for independent closure');if(corrective_actions)run(()=>api.patch(`/hse/incidents/${i.id}/close`,{corrective_actions}));}}>Close Investigation</button>}</td></tr>)}</tbody></table></div></div>

    <div className="panel"><h2>Permits to Work</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={permit.project_id} onChange={v=>setPermit({...permit,project_id:v})} placeholder="Project"/>
      <select value={permit.permit_type} onChange={e=>setPermit({...permit,permit_type:e.target.value})}><option value="hot_work">Hot Work</option><option value="confined_space">Confined Space</option><option value="height">Work at Height</option><option value="other">Other</option></select>
      <input type="date" value={permit.expiry_date} onChange={e=>setPermit({...permit,expiry_date:e.target.value})}/>
      <button onClick={createPermit}>Request PTW</button>
    </div><div className="table-wrap"><table><thead><tr><th>Type</th><th>Issue</th><th>Expiry</th><th>Requester</th><th>Status</th><th>Workflow</th></tr></thead><tbody>{permits.map(p=><tr key={p.id}><td>{p.permit_type}</td><td>{p.issue_date}</td><td>{p.expiry_date||'—'}</td><td>{p.requested_by_name||p.requested_by}</td><td>{p.status}</td><td>{p.status==='requested'&&<button onClick={()=>run(()=>api.post(`/hse/permits/${p.id}/approve`,{}))}>Approve</button>}{p.status==='approved'&&<button onClick={()=>run(()=>api.post(`/hse/permits/${p.id}/activate`,{}))}>Activate</button>}{['requested','approved','active'].includes(p.status)&&<button onClick={()=>run(()=>api.post(`/hse/permits/${p.id}/close`,{}))}>Close</button>}{['approved','active'].includes(p.status)&&p.expiry_date&&<button onClick={()=>run(()=>api.post(`/hse/permits/${p.id}/expire`,{}))}>Expire if due</button>}</td></tr>)}</tbody></table></div></div>

    <div className="panel"><h2>Toolbox Talks</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={talk.project_id} onChange={v=>setTalk({...talk,project_id:v})} placeholder="Project"/><input placeholder="Topic" value={talk.topic} onChange={e=>setTalk({...talk,topic:e.target.value})}/><input type="number" placeholder="Attendees" value={talk.attendees_count} onChange={e=>setTalk({...talk,attendees_count:e.target.value})}/><button onClick={createTalk}>Record Talk</button>
    </div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Topic</th><th>Attendees</th><th>Conducted by</th></tr></thead><tbody>{talks.map(t=><tr key={t.id}><td>{t.talk_date}</td><td>{t.topic}</td><td>{t.attendees_count??'—'}</td><td>{t.conducted_by_name||t.conducted_by}</td></tr>)}</tbody></table></div></div>
  </section>;
}
