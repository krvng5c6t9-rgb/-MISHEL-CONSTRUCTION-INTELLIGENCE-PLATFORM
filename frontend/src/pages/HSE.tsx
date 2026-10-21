import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { ReferenceSelect } from '../components/ReferenceSelect';
import { Num } from '../components/RecordTable';

const n=(v:any)=>Number(v);

// R1.2: labels from messages/hse.ts; severities, permit types and statuses through tv().
export function HSE() {
  const { t, tv } = useI18n();
  const [incidents,setIncidents]=useState<any[]>([]),[permits,setPermits]=useState<any[]>([]),[talks,setTalks]=useState<any[]>([]),[metrics,setMetrics]=useState<any>({});
  const [error,setError]=useState('');
  const [incident,setIncident]=useState<any>({project_id:'',severity:'near_miss',description:'',injured_party:''});
  const [permit,setPermit]=useState<any>({project_id:'',permit_type:'hot_work',expiry_date:''});
  const [talk,setTalk]=useState<any>({project_id:'',topic:'',attendees_count:''});

  async function load(){const [i,p,tk,m]=await Promise.all([api.get('/hse/incidents'),api.get('/hse/permits'),api.get('/hse/toolbox-talks'),api.get('/hse/metrics')]);setIncidents(i.data);setPermits(p.data);setTalks(tk.data);setMetrics(m.data||{});}
  useEffect(()=>{load().catch((e:any)=>setError(e.message));},[]);
  async function run(fn:()=>Promise<any>){try{setError('');await fn();await load();}catch(e:any){setError(e.message);}}

  const createIncident=()=>run(()=>api.post('/hse/incidents',{project_id:n(incident.project_id),severity:incident.severity,description:incident.description,injured_party:incident.injured_party||undefined}));
  const createPermit=()=>run(()=>api.post('/hse/permits',{project_id:n(permit.project_id),permit_type:permit.permit_type,expiry_date:permit.expiry_date||undefined}));
  const createTalk=()=>run(()=>api.post('/hse/toolbox-talks',{project_id:n(talk.project_id),topic:talk.topic,attendees_count:talk.attendees_count===''?undefined:n(talk.attendees_count)}));
  const permitAction=(path:string)=>run(()=>api.post(path,{}));

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('hse.eyebrow')}</p><h1>{t('hse.title')}</h1><p>{t('hse.intro')}</p></div></header>
    {error&&<div className="notice" role="alert"><bdi>{error}</bdi></div>}
    <div className="cards-grid">
      <div className="metric-card"><span>{t('hse.incidentsKpi')}</span><strong><Num v={metrics.incidents??incidents.length}/></strong></div>
      <div className="metric-card"><span>{t('hse.seriousIncidents')}</span><strong><Num v={metrics.serious_incidents??0}/></strong></div>
      <div className="metric-card"><span>{t('hse.activePermits')}</span><strong><Num v={metrics.active_permits??0}/></strong></div>
      <div className="metric-card"><span>{t('hse.toolboxTalksKpi')}</span><strong><Num v={metrics.toolbox_talks??talks.length}/></strong></div>
    </div>

    <div className="panel" data-section="incidents"><h2>{t('hse.incidents')}</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={incident.project_id} onChange={v=>setIncident({...incident,project_id:v})} placeholder={t('hse.project')}/>
      <select aria-label={t('hse.severity')} value={incident.severity} onChange={e=>setIncident({...incident,severity:e.target.value})}>{([['near_miss','hse.optNearMiss'],['minor','hse.optMinor'],['major','hse.optMajor'],['fatality','hse.optFatality']] as const).map(([v,k])=><option key={v} value={v}>{t(k)}</option>)}</select>
      <input placeholder={t('hse.description')} aria-label={t('hse.description')} value={incident.description} onChange={e=>setIncident({...incident,description:e.target.value})}/>
      <input placeholder={t('hse.injuredParty')} aria-label={t('hse.injuredParty')} value={incident.injured_party} onChange={e=>setIncident({...incident,injured_party:e.target.value})}/>
      <button onClick={createIncident}>{t('hse.reportIncident')}</button>
    </div><div className="table-wrap"><table><thead><tr><th>{t('hse.colDate')}</th><th>{t('hse.colSeverity')}</th><th>{t('hse.colDescription')}</th><th>{t('hse.colReporter')}</th><th>{t('hse.colStatus')}</th><th>{t('hse.colAction')}</th></tr></thead><tbody>{incidents.map(i=><tr key={i.id}><td><Num text={i.incident_date||'—'}/></td><td>{tv(i.severity)}</td><td>{i.description}</td><td>{i.reported_by_name||i.reported_by}</td><td>{tv(i.investigation_status)}</td><td>{i.investigation_status==='open'&&<button onClick={()=>{const corrective_actions=window.prompt(t('hse.askCorrectiveActions'));if(corrective_actions)run(()=>api.patch(`/hse/incidents/${i.id}/close`,{corrective_actions}));}}>{t('hse.closeInvestigation')}</button>}</td></tr>)}</tbody></table></div></div>

    <div className="panel" data-section="permits"><h2>{t('hse.permits')}</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={permit.project_id} onChange={v=>setPermit({...permit,project_id:v})} placeholder={t('hse.project')}/>
      <select aria-label={t('hse.permitType')} value={permit.permit_type} onChange={e=>setPermit({...permit,permit_type:e.target.value})}>{([['hot_work','hse.optHotWork'],['confined_space','hse.optConfinedSpace'],['height','hse.optHeight'],['other','hse.optOther']] as const).map(([v,k])=><option key={v} value={v}>{t(k)}</option>)}</select>
      <input type="date" aria-label={t('hse.expiryDate')} value={permit.expiry_date} onChange={e=>setPermit({...permit,expiry_date:e.target.value})}/>
      <button onClick={createPermit}>{t('hse.requestPtw')}</button>
    </div><div className="table-wrap"><table><thead><tr><th>{t('hse.colType')}</th><th>{t('hse.colIssue')}</th><th>{t('hse.colExpiry')}</th><th>{t('hse.colRequester')}</th><th>{t('hse.colStatus')}</th><th>{t('hse.colWorkflow')}</th></tr></thead><tbody>{permits.map(p=><tr key={p.id}><td>{tv(p.permit_type)}</td><td><Num text={p.issue_date||'—'}/></td><td><Num text={p.expiry_date||'—'}/></td><td>{p.requested_by_name||p.requested_by}</td><td>{tv(p.status)}</td><td>{p.status==='requested'&&<button onClick={()=>permitAction(`/hse/permits/${p.id}/approve`)}>{t('hse.approve')}</button>}{p.status==='approved'&&<button onClick={()=>permitAction(`/hse/permits/${p.id}/activate`)}>{t('hse.activate')}</button>}{['requested','approved','active'].includes(p.status)&&<button onClick={()=>permitAction(`/hse/permits/${p.id}/close`)}>{t('hse.close')}</button>}{['approved','active'].includes(p.status)&&p.expiry_date&&<button onClick={()=>permitAction(`/hse/permits/${p.id}/expire`)}>{t('hse.expireIfDue')}</button>}</td></tr>)}</tbody></table></div></div>

    <div className="panel" data-section="toolbox-talks"><h2>{t('hse.toolboxTalks')}</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={talk.project_id} onChange={v=>setTalk({...talk,project_id:v})} placeholder={t('hse.project')}/><input placeholder={t('hse.topic')} aria-label={t('hse.topic')} value={talk.topic} onChange={e=>setTalk({...talk,topic:e.target.value})}/><input type="number" placeholder={t('hse.attendees')} aria-label={t('hse.attendees')} value={talk.attendees_count} onChange={e=>setTalk({...talk,attendees_count:e.target.value})}/><button onClick={createTalk}>{t('hse.recordTalk')}</button>
    </div><div className="table-wrap"><table><thead><tr><th>{t('hse.colDate')}</th><th>{t('hse.colTopic')}</th><th>{t('hse.colAttendees')}</th><th>{t('hse.colConductedBy')}</th></tr></thead><tbody>{talks.map(tk=><tr key={tk.id}><td><Num text={tk.talk_date||'—'}/></td><td>{tk.topic}</td><td>{tk.attendees_count??'—'}</td><td>{tk.conducted_by_name||tk.conducted_by}</td></tr>)}</tbody></table></div></div>
  </section>;
}
