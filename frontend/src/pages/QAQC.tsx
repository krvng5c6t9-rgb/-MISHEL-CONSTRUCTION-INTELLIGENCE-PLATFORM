import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { localDate } from '../lib/date';
import { ReferenceSelect } from '../components/ReferenceSelect';
import { Num } from '../components/RecordTable';
const n=(v:any)=>Number(v);

// R1.2: labels from messages/qaqc.ts; statuses through tv(). CC-074: the inspection date is today's local date (the
// screen sent the UTC date, a day early after midnight in Cairo).
export function QAQC() {
  const { t, tv } = useI18n();
  const [inspections,setInspections]=useState<any[]>([]),[ncrs,setNcrs]=useState<any[]>([]),[metrics,setMetrics]=useState<any>({});
  const [error,setError]=useState('');
  const [inspection,setInspection]=useState<any>({project_id:'',checklist_type:''});
  const [ncr,setNcr]=useState<any>({project_id:'',ncr_no:'',description:'',cost_impact:''});
  async function load(){const [i,nc,m]=await Promise.all([api.get('/qaqc/inspections'),api.get('/qaqc/ncrs'),api.get('/qaqc/metrics')]);setInspections(i.data);setNcrs(nc.data);setMetrics(m.data||{});}
  useEffect(()=>{load().catch((e:any)=>setError(e.message));},[]);
  async function run(fn:()=>Promise<any>){try{setError('');await fn();await load();}catch(e:any){setError(e.message);}}
  const result=(id:number,status:'passed'|'failed')=>run(()=>api.patch(`/qaqc/inspections/${id}/status`,{status,inspection_date:localDate()}));

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('qa.eyebrow')}</p><h1>{t('qa.title')}</h1><p>{t('qa.intro')}</p></div></header>
    {error&&<div className="notice" role="alert"><bdi>{error}</bdi></div>}
    <div className="cards-grid"><div className="metric-card"><span>{t('qa.inspectionsKpi')}</span><strong><Num v={metrics.total_inspections??inspections.length}/></strong></div><div className="metric-card"><span>{t('qa.passed')}</span><strong><Num v={metrics.passed_inspections??0}/></strong></div><div className="metric-card"><span>{t('qa.totalNcrs')}</span><strong><Num v={metrics.total_ncrs??ncrs.length}/></strong></div><div className="metric-card"><span>{t('qa.closedNcrs')}</span><strong><Num v={metrics.closed_ncrs??0}/></strong></div></div>

    <div className="panel" data-section="inspections"><h2>{t('qa.inspections')}</h2><div className="form-row"><ReferenceSelect kind="projects" value={inspection.project_id} onChange={v=>setInspection({...inspection,project_id:v})} placeholder={t('qa.project')}/><input placeholder={t('qa.checklistType')} aria-label={t('qa.checklistType')} value={inspection.checklist_type} onChange={e=>setInspection({...inspection,checklist_type:e.target.value})}/><button onClick={()=>run(()=>api.post('/qaqc/inspections',{project_id:n(inspection.project_id),checklist_type:inspection.checklist_type}))}>{t('qa.createInspection')}</button></div><div className="table-wrap"><table><thead><tr><th>{t('qa.colType')}</th><th>{t('qa.colStatus')}</th><th>{t('qa.colDate')}</th><th>{t('qa.colAction')}</th></tr></thead><tbody>{inspections.map(i=><tr key={i.id}><td>{i.checklist_type}</td><td>{tv(i.status)}</td><td><Num text={i.inspection_date||'—'}/></td><td>{i.status==='pending'&&<><button onClick={()=>result(i.id,'passed')}>{t('qa.pass')}</button><button onClick={()=>result(i.id,'failed')}>{t('qa.fail')}</button></>}</td></tr>)}</tbody></table></div></div>

    <div className="panel" data-section="ncrs"><h2>{t('qa.ncrs')}</h2><div className="form-row"><ReferenceSelect kind="projects" value={ncr.project_id} onChange={v=>setNcr({...ncr,project_id:v})} placeholder={t('qa.project')}/><input placeholder={t('qa.ncrNo')} aria-label={t('qa.ncrNo')} value={ncr.ncr_no} onChange={e=>setNcr({...ncr,ncr_no:e.target.value})}/><input placeholder={t('qa.description')} aria-label={t('qa.description')} value={ncr.description} onChange={e=>setNcr({...ncr,description:e.target.value})}/><input type="number" step="0.01" placeholder={t('qa.costImpact')} aria-label={t('qa.costImpact')} value={ncr.cost_impact} onChange={e=>setNcr({...ncr,cost_impact:e.target.value})}/><button onClick={()=>run(()=>api.post('/qaqc/ncrs',{project_id:n(ncr.project_id),ncr_no:ncr.ncr_no,description:ncr.description,cost_impact:ncr.cost_impact===''?undefined:n(ncr.cost_impact)}))}>{t('qa.raiseNcr')}</button></div><div className="table-wrap"><table><thead><tr><th>{t('qa.colNo')}</th><th>{t('qa.colDescription')}</th><th>{t('qa.colRaisedBy')}</th><th>{t('qa.colStatus')}</th><th>{t('qa.colCostImpact')}</th><th>{t('qa.colAction')}</th></tr></thead><tbody>{ncrs.map(x=><tr key={x.id}><td>{x.ncr_no}</td><td>{x.description}</td><td>{x.raised_by_name||x.raised_by}</td><td>{tv(x.status)}</td><td>{x.cost_impact?<Num v={x.cost_impact}/>:'—'}</td><td>{x.status==='open'&&<button onClick={()=>{const root_cause=window.prompt(t('qa.askRootCause'));if(!root_cause)return;const corrective_action=window.prompt(t('qa.askCorrectiveAction'));if(corrective_action)run(()=>api.patch(`/qaqc/ncrs/${x.id}/close`,{root_cause,corrective_action}));}}>{t('qa.independentClose')}</button>}</td></tr>)}</tbody></table></div></div>
  </section>;
}
