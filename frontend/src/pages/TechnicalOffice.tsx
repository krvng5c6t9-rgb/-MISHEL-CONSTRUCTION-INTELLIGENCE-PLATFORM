import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { ReferenceSelect } from '../components/ReferenceSelect';

// R1.2: labels from messages/technicalOffice.ts; statuses and submittal types through tv().
// CC-074: an RFI can be flagged for cost / time impact from the screen (the flags existed in the API but the screen
// always sent false, so the contract-event control on closing never applied); closing a flagged RFI asks for the
// no-impact reason the database requires when the RFI is not linked to a contract event.
type Form = Record<string, any>;
const n=(v:any)=>Number(v);

export function TechnicalOffice() {
  const { t, tv } = useI18n();
  const [drawings,setDrawings]=useState<any[]>([]),[submittals,setSubmittals]=useState<any[]>([]),[rfis,setRfis]=useState<any[]>([]),[methods,setMethods]=useState<any[]>([]);
  const [error,setError]=useState('');
  const [drawing,setDrawing]=useState<Form>({project_id:'',drawing_no:'',title:'',discipline:'',revision:'A'});
  const [submittal,setSubmittal]=useState<Form>({project_id:'',submittal_no:'',type:'material',description:'',reviewer_id:''});
  const [rfi,setRfi]=useState<Form>({project_id:'',rfi_no:'',subject:'',question:'',assigned_to:'',cost_impact_flag:false,time_impact_flag:false});
  const [method,setMethod]=useState<Form>({project_id:'',activity_name:''});

  async function load(){const [a,b,c,d]=await Promise.all([api.get('/technical-office/drawings'),api.get('/technical-office/submittals'),api.get('/technical-office/rfis'),api.get('/technical-office/method-statements')]);setDrawings(a.data);setSubmittals(b.data);setRfis(c.data);setMethods(d.data);}
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function run(fn:()=>Promise<any>){try{setError('');await fn();await load();}catch(e:any){setError(e.message);}}
  const withComment=(key:'to.askReviewComments'|'to.askRejectionComments',fn:(comment:string)=>Promise<any>)=>{const comment=window.prompt(t(key))?.trim();if(comment)run(()=>fn(comment));};

  const createDrawing=()=>run(()=>api.post('/technical-office/drawings',{...drawing,project_id:n(drawing.project_id),discipline:drawing.discipline||undefined}));
  const createSubmittal=()=>run(()=>api.post('/technical-office/submittals',{...submittal,project_id:n(submittal.project_id),reviewer_id:submittal.reviewer_id?n(submittal.reviewer_id):undefined}));
  const createRfi=()=>run(()=>api.post('/technical-office/rfis',{...rfi,project_id:n(rfi.project_id),assigned_to:rfi.assigned_to?n(rfi.assigned_to):undefined}));
  const createMethod=()=>run(()=>api.post('/technical-office/method-statements',{...method,project_id:n(method.project_id)}));
  const closeRfi=(x:any)=>{
    if(!x.cost_impact_flag&&!x.time_impact_flag)return run(()=>api.post(`/technical-office/rfis/${x.id}/close`,{}));
    const reason=window.prompt(t('to.askNoImpactReason'));
    if(reason===null)return;
    run(()=>api.post(`/technical-office/rfis/${x.id}/close`,reason.trim()?{no_impact_reason:reason.trim()}:{}));
  };
  const impact=(x:any)=>[x.cost_impact_flag&&t('to.costImpact'),x.time_impact_flag&&t('to.timeImpact')].filter(Boolean).join(' · ')||'—';
  const drawingStatus=(id:number,status:string,comment?:string)=>api.patch(`/technical-office/drawings/${id}/status`,comment?{status,comment}:{status});
  const submittalReview=(id:number,status:string,comment?:string)=>api.patch(`/technical-office/submittals/${id}/review`,comment?{status,comment}:{status});

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('to.eyebrow')}</p><h1>{t('to.title')}</h1><p>{t('to.intro')}</p></div></header>
    {error&&<div className="notice" role="alert"><bdi>{error}</bdi></div>}

    <div className="panel" data-section="drawings"><h2>{t('to.drawings')}</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={drawing.project_id} onChange={v=>setDrawing({...drawing,project_id:v})} placeholder={t('to.project')}/><input placeholder={t('to.drawingNo')} aria-label={t('to.drawingNo')} value={drawing.drawing_no} onChange={e=>setDrawing({...drawing,drawing_no:e.target.value})}/><input placeholder={t('to.titleField')} aria-label={t('to.titleField')} value={drawing.title} onChange={e=>setDrawing({...drawing,title:e.target.value})}/><input placeholder={t('to.discipline')} aria-label={t('to.discipline')} value={drawing.discipline} onChange={e=>setDrawing({...drawing,discipline:e.target.value})}/><input placeholder={t('to.revision')} aria-label={t('to.revision')} value={drawing.revision} onChange={e=>setDrawing({...drawing,revision:e.target.value})}/><button onClick={createDrawing}>{t('to.create')}</button>
    </div><div className="table-wrap"><table><thead><tr><th>{t('to.colNo')}</th><th>{t('to.colTitle')}</th><th>{t('to.colRev')}</th><th>{t('to.colStatus')}</th><th>{t('to.colWorkflow')}</th></tr></thead><tbody>{drawings.map(x=><tr key={x.id}><td>{x.drawing_no}</td><td>{x.title}</td><td>{x.revision}</td><td>{tv(x.status)}</td><td>{x.status==='for_review'&&<><button onClick={()=>run(()=>drawingStatus(x.id,'approved'))}>{t('to.approve')}</button><button onClick={()=>withComment('to.askReviewComments',c=>drawingStatus(x.id,'approved_with_comments',c))}>{t('to.approveWithComments')}</button><button onClick={()=>withComment('to.askReviewComments',c=>drawingStatus(x.id,'rejected',c))}>{t('to.reject')}</button></>}{x.status==='rejected'&&<button onClick={()=>run(()=>drawingStatus(x.id,'for_review'))}>{t('to.resubmit')}</button>}{['approved','approved_with_comments'].includes(x.status)&&<button onClick={()=>run(()=>drawingStatus(x.id,'superseded'))}>{t('to.supersede')}</button>}</td></tr>)}</tbody></table></div></div>

    <div className="panel" data-section="submittals"><h2>{t('to.submittals')}</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={submittal.project_id} onChange={v=>setSubmittal({...submittal,project_id:v})} placeholder={t('to.project')}/><input placeholder={t('to.submittalNo')} aria-label={t('to.submittalNo')} value={submittal.submittal_no} onChange={e=>setSubmittal({...submittal,submittal_no:e.target.value})}/><select aria-label={t('to.submittalType')} value={submittal.type} onChange={e=>setSubmittal({...submittal,type:e.target.value})}>{([['material','to.optMaterial'],['shop_drawing','to.optShopDrawing'],['method_statement','to.optMethodStatement'],['sample','to.optSample'],['other','to.optOther']] as const).map(([v,k])=><option key={v} value={v}>{t(k)}</option>)}</select><input placeholder={t('to.description')} aria-label={t('to.description')} value={submittal.description} onChange={e=>setSubmittal({...submittal,description:e.target.value})}/><ReferenceSelect kind="users" value={submittal.reviewer_id} onChange={v=>setSubmittal({...submittal,reviewer_id:v})} placeholder={t('to.reviewer')}/><button onClick={createSubmittal}>{t('to.create')}</button>
    </div><div className="table-wrap"><table><thead><tr><th>{t('to.colNo')}</th><th>{t('to.colType')}</th><th>{t('to.colDescription')}</th><th>{t('to.colStatus')}</th><th>{t('to.colWorkflow')}</th></tr></thead><tbody>{submittals.map(x=><tr key={x.id}><td>{x.submittal_no}</td><td>{tv(x.type)}</td><td>{x.description}</td><td>{tv(x.status)}</td><td>{x.status==='submitted'&&<button onClick={()=>run(()=>submittalReview(x.id,'under_review'))}>{t('to.startReview')}</button>}{x.status==='under_review'&&<><button onClick={()=>run(()=>submittalReview(x.id,'approved'))}>{t('to.approve')}</button><button onClick={()=>withComment('to.askReviewComments',c=>submittalReview(x.id,'approved_as_noted',c))}>{t('to.approveAsNoted')}</button><button onClick={()=>withComment('to.askReviewComments',c=>submittalReview(x.id,'resubmit_required',c))}>{t('to.resubmitRequired')}</button><button onClick={()=>withComment('to.askReviewComments',c=>submittalReview(x.id,'rejected',c))}>{t('to.reject')}</button></>}{['rejected','resubmit_required'].includes(x.status)&&<button onClick={()=>run(()=>submittalReview(x.id,'submitted'))}>{t('to.resubmit')}</button>}</td></tr>)}</tbody></table></div></div>

    <div className="panel" data-section="rfis"><h2>{t('to.rfis')}</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={rfi.project_id} onChange={v=>setRfi({...rfi,project_id:v})} placeholder={t('to.project')}/><input placeholder={t('to.rfiNo')} aria-label={t('to.rfiNo')} value={rfi.rfi_no} onChange={e=>setRfi({...rfi,rfi_no:e.target.value})}/><input placeholder={t('to.subject')} aria-label={t('to.subject')} value={rfi.subject} onChange={e=>setRfi({...rfi,subject:e.target.value})}/><input placeholder={t('to.question')} aria-label={t('to.question')} value={rfi.question} onChange={e=>setRfi({...rfi,question:e.target.value})}/><ReferenceSelect kind="users" value={rfi.assigned_to} onChange={v=>setRfi({...rfi,assigned_to:v})} placeholder={t('to.assignedUser')}/>
      <label><input type="checkbox" checked={rfi.cost_impact_flag} onChange={e=>setRfi({...rfi,cost_impact_flag:e.target.checked})}/> {t('to.costImpact')}</label><label><input type="checkbox" checked={rfi.time_impact_flag} onChange={e=>setRfi({...rfi,time_impact_flag:e.target.checked})}/> {t('to.timeImpact')}</label><button onClick={createRfi}>{t('to.create')}</button>
    </div><div className="table-wrap"><table><thead><tr><th>{t('to.colNo')}</th><th>{t('to.colSubject')}</th><th>{t('to.colImpact')}</th><th>{t('to.colStatus')}</th><th>{t('to.colResponse')}</th><th>{t('to.colWorkflow')}</th></tr></thead><tbody>{rfis.map(x=><tr key={x.id}><td>{x.rfi_no}</td><td>{x.subject}</td><td>{impact(x)}</td><td>{tv(x.status)}</td><td>{x.response||'—'}</td><td>{x.status==='open'&&<button onClick={()=>{const response=window.prompt(t('to.askResponse'));if(response)run(()=>api.patch(`/technical-office/rfis/${x.id}/respond`,{response,close:false}));}}>{t('to.respond')}</button>}{x.status==='answered'&&<button onClick={()=>closeRfi(x)}>{t('to.close')}</button>}</td></tr>)}</tbody></table></div></div>

    <div className="panel" data-section="method-statements"><h2>{t('to.methodStatements')}</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={method.project_id} onChange={v=>setMethod({...method,project_id:v})} placeholder={t('to.project')}/><input placeholder={t('to.activityName')} aria-label={t('to.activityName')} value={method.activity_name} onChange={e=>setMethod({...method,activity_name:e.target.value})}/><button onClick={createMethod}>{t('to.createDraft')}</button>
    </div><div className="table-wrap"><table><thead><tr><th>{t('to.colActivity')}</th><th>{t('to.colStatus')}</th><th>{t('to.colWorkflow')}</th></tr></thead><tbody>{methods.map(x=><tr key={x.id}><td>{x.activity_name}</td><td>{tv(x.status)}</td><td>{['draft','rejected'].includes(x.status)&&<button onClick={()=>run(()=>api.post(`/technical-office/method-statements/${x.id}/submit`,{}))}>{t('to.submit')}</button>}{x.status==='submitted'&&<><button onClick={()=>run(()=>api.post(`/technical-office/method-statements/${x.id}/review`,{action:'approved'}))}>{t('to.approve')}</button><button onClick={()=>withComment('to.askRejectionComments',c=>api.post(`/technical-office/method-statements/${x.id}/review`,{action:'rejected',comment:c}))}>{t('to.reject')}</button></>}</td></tr>)}</tbody></table></div></div>
  </section>;
}
