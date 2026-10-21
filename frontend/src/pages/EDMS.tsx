import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { ReferenceSelect } from '../components/ReferenceSelect';

// R1.2: labels from messages/edms.ts; statuses, confidentiality, register types and purposes through tv().
// CC-074: the document list for a transmittal line follows the project of the chosen draft transmittal (it followed
// the project picked in the "new transmittal" form, so after a reload it listed every project's documents).
type F=Record<string,any>; const n=(v:any)=>Number(v);
export function EDMS(){
  const { t, tv } = useI18n();
  const [docs,setDocs]=useState<any[]>([]),[regs,setRegs]=useState<any[]>([]),[trs,setTrs]=useState<any[]>([]),[err,setErr]=useState('');
  const [doc,setDoc]=useState<F>({project_id:'',doc_number:'',file_name:'',storage_key:'',revision:'A',confidentiality:'internal'});
  const [reg,setReg]=useState<F>({project_id:'',register_type:'drawings',numbering_scheme:''});
  const [tr,setTr]=useState<F>({project_id:'',transmittal_no:'',from_party:'',to_party:'',purpose:'for_approval'});
  const [line,setLine]=useState<F>({transmittal_id:'',document_id:''});
  async function load(){const [d,r,tm]=await Promise.all([api.get('/edms/documents'),api.get('/edms/registers'),api.get('/edms/transmittals')]);setDocs(d.data);setRegs(r.data);setTrs(tm.data);}
  useEffect(()=>{load().catch(e=>setErr(e.message));},[]);
  async function run(fn:()=>Promise<any>){try{setErr('');await fn();await load();}catch(e:any){setErr(e.message)}}
  const createDoc=()=>run(()=>api.post('/edms/documents',{...doc,project_id:n(doc.project_id)}));
  const addVersion=(d:any)=>{const file_name=window.prompt(t('edms.askNewFileName'),d.file_name);if(!file_name)return;const storage_key=window.prompt(t('edms.askStorageKey'));if(!storage_key)return;const revision=window.prompt(t('edms.askRevision'),d.revision||'');run(()=>api.post(`/edms/documents/${d.id}/versions`,{file_name,storage_key,revision:revision||undefined}));};
  const createReg=()=>run(()=>api.post('/edms/registers',{...reg,project_id:n(reg.project_id),numbering_scheme:reg.numbering_scheme||undefined}));
  const createTr=()=>run(()=>api.post('/edms/transmittals',{...tr,project_id:n(tr.project_id)}));
  const addLine=()=>run(()=>api.post(`/edms/transmittals/${n(line.transmittal_id)}/lines`,{document_id:n(line.document_id)}));
  const lineProject=trs.find(x=>String(x.id)===String(line.transmittal_id))?.project_id;
  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('edms.eyebrow')}</p><h1>{t('edms.title')}</h1><p>{t('edms.intro')}</p></div></header>
    {err&&<div className="notice" role="alert"><bdi>{err}</bdi></div>}

    <div className="panel" data-section="documents"><h2>{t('edms.documents')}</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={doc.project_id} onChange={v=>setDoc({...doc,project_id:v})} placeholder={t('edms.project')}/>
      <input placeholder={t('edms.docNo')} aria-label={t('edms.docNo')} value={doc.doc_number} onChange={e=>setDoc({...doc,doc_number:e.target.value})}/>
      <input placeholder={t('edms.fileName')} aria-label={t('edms.fileName')} value={doc.file_name} onChange={e=>setDoc({...doc,file_name:e.target.value})}/>
      <input placeholder={t('edms.storageKey')} aria-label={t('edms.storageKey')} value={doc.storage_key} onChange={e=>setDoc({...doc,storage_key:e.target.value})}/>
      <input placeholder={t('edms.revision')} aria-label={t('edms.revision')} value={doc.revision} onChange={e=>setDoc({...doc,revision:e.target.value})}/>
      <select aria-label={t('edms.confidentiality')} value={doc.confidentiality} onChange={e=>setDoc({...doc,confidentiality:e.target.value})}>{([['public','edms.optPublic'],['internal','edms.optInternal'],['restricted','edms.optRestricted']] as const).map(([v,k])=><option key={v} value={v}>{t(k)}</option>)}</select>
      <button onClick={createDoc}>{t('edms.createDocument')}</button>
    </div><div className="table-wrap"><table><thead><tr><th>{t('edms.colNo')}</th><th>{t('edms.colFile')}</th><th>{t('edms.colVersion')}</th><th>{t('edms.colRevision')}</th><th>{t('edms.colStatus')}</th><th>{t('edms.colControl')}</th></tr></thead><tbody>{docs.map(d=><tr key={d.id}><td>{d.doc_number}</td><td><bdi>{d.file_name}</bdi></td><td>{d.version_no}</td><td>{d.revision||'—'}</td><td>{tv(d.status)}</td><td>
      {['draft','rejected'].includes(d.status)&&<><button onClick={()=>run(()=>api.post(`/edms/documents/${d.id}/submit`,{}))}>{t('edms.submit')}</button><button onClick={()=>addVersion(d)}>{t('edms.newVersion')}</button></>}
      {d.status==='for_approval'&&<><button onClick={()=>run(()=>api.post(`/edms/documents/${d.id}/review`,{action:'approved'}))}>{t('edms.approve')}</button><button onClick={()=>{const comment=window.prompt(t('edms.askRejectReason'))?.trim();if(comment)run(()=>api.post(`/edms/documents/${d.id}/review`,{action:'rejected',comment}))}}>{t('edms.reject')}</button></>}
      {d.status==='approved'&&<button onClick={()=>addVersion(d)}>{t('edms.revise')}</button>}
    </td></tr>)}</tbody></table></div></div>

    <div className="panel" data-section="registers"><h2>{t('edms.registers')}</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={reg.project_id} onChange={v=>setReg({...reg,project_id:v})} placeholder={t('edms.project')}/>
      <select aria-label={t('edms.registerType')} value={reg.register_type} onChange={e=>setReg({...reg,register_type:e.target.value})}>{([['drawings','edms.optDrawings'],['correspondence','edms.optCorrespondence'],['contracts','edms.optContracts'],['submittals','edms.optSubmittals'],['photos','edms.optPhotos']] as const).map(([v,k])=><option key={v} value={v}>{t(k)}</option>)}</select>
      <input placeholder={t('edms.numberingScheme')} aria-label={t('edms.numberingScheme')} value={reg.numbering_scheme} onChange={e=>setReg({...reg,numbering_scheme:e.target.value})}/><button onClick={createReg}>{t('edms.createRegister')}</button>
    </div><div className="table-wrap"><table><thead><tr><th>{t('edms.colProject')}</th><th>{t('edms.colType')}</th><th>{t('edms.colNumberingScheme')}</th></tr></thead><tbody>{regs.map(r=><tr key={r.id}><td>{r.project_id}</td><td>{tv(r.register_type)}</td><td>{r.numbering_scheme||'—'}</td></tr>)}</tbody></table></div></div>

    <div className="panel" data-section="transmittals"><h2>{t('edms.transmittals')}</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={tr.project_id} onChange={v=>setTr({...tr,project_id:v})} placeholder={t('edms.project')}/><input placeholder={t('edms.transmittalNo')} aria-label={t('edms.transmittalNo')} value={tr.transmittal_no} onChange={e=>setTr({...tr,transmittal_no:e.target.value})}/><input placeholder={t('edms.from')} aria-label={t('edms.from')} value={tr.from_party} onChange={e=>setTr({...tr,from_party:e.target.value})}/><input placeholder={t('edms.to')} aria-label={t('edms.to')} value={tr.to_party} onChange={e=>setTr({...tr,to_party:e.target.value})}/><select aria-label={t('edms.purpose')} value={tr.purpose} onChange={e=>setTr({...tr,purpose:e.target.value})}>{([['for_approval','edms.optForApproval'],['for_information','edms.optForInformation'],['for_construction','edms.optForConstruction']] as const).map(([v,k])=><option key={v} value={v}>{t(k)}</option>)}</select><button onClick={createTr}>{t('edms.createDraft')}</button>
    </div><div className="form-row"><select aria-label={t('edms.draftTransmittal')} value={line.transmittal_id} onChange={e=>setLine({transmittal_id:e.target.value,document_id:''})}><option value="">{t('edms.draftTransmittal')}</option>{trs.filter(x=>x.status==='draft').map(x=><option key={x.id} value={x.id}>{x.transmittal_no}</option>)}</select><ReferenceSelect kind="documents" projectId={lineProject} value={line.document_id} onChange={v=>setLine({...line,document_id:v})} placeholder={t('edms.document')}/><button onClick={addLine}>{t('edms.addCurrentVersion')}</button></div>
    <div className="table-wrap"><table><thead><tr><th>{t('edms.colNo')}</th><th>{t('edms.colProject')}</th><th>{t('edms.colPurpose')}</th><th>{t('edms.colStatus')}</th><th>{t('edms.colLines')}</th><th>{t('edms.colControl')}</th></tr></thead><tbody>{trs.map(x=><tr key={x.id}><td>{x.transmittal_no}</td><td>{x.project_id}</td><td>{x.purpose?tv(x.purpose):'—'}</td><td>{tv(x.status)}</td><td>{x.line_count}</td><td>{x.status==='draft'&&<button onClick={()=>run(()=>api.post(`/edms/transmittals/${x.id}/issue`,{}))}>{t('edms.issue')}</button>}{x.status==='issued'&&<button onClick={()=>{const reason=window.prompt(t('edms.askVoidReason'));if(reason)run(()=>api.post(`/edms/transmittals/${x.id}/void`,{reason}));}}>{t('edms.void')}</button>}</td></tr>)}</tbody></table></div></div>
  </section>;
}
