import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ReferenceSelect } from '../components/ReferenceSelect';

type F=Record<string,any>; const n=(v:any)=>Number(v);
export function EDMS(){
  const [docs,setDocs]=useState<any[]>([]),[regs,setRegs]=useState<any[]>([]),[trs,setTrs]=useState<any[]>([]),[err,setErr]=useState('');
  const [doc,setDoc]=useState<F>({project_id:'',doc_number:'',file_name:'',storage_key:'',revision:'A',confidentiality:'internal'});
  const [reg,setReg]=useState<F>({project_id:'',register_type:'drawings',numbering_scheme:''});
  const [tr,setTr]=useState<F>({project_id:'',transmittal_no:'',from_party:'',to_party:'',purpose:'for_approval'});
  const [line,setLine]=useState<F>({transmittal_id:'',document_id:''});
  async function load(){const [d,r,t]=await Promise.all([api.get('/edms/documents'),api.get('/edms/registers'),api.get('/edms/transmittals')]);setDocs(d.data);setRegs(r.data);setTrs(t.data);}
  useEffect(()=>{load().catch(e=>setErr(e.message));},[]);
  async function run(fn:()=>Promise<any>){try{setErr('');await fn();await load();}catch(e:any){setErr(e.message)}}
  const createDoc=()=>run(()=>api.post('/edms/documents',{...doc,project_id:n(doc.project_id)}));
  const addVersion=(d:any)=>{const file_name=window.prompt('New file name',d.file_name);if(!file_name)return;const storage_key=window.prompt('Storage key/path');if(!storage_key)return;const revision=window.prompt('Revision',d.revision||'');run(()=>api.post(`/edms/documents/${d.id}/versions`,{file_name,storage_key,revision:revision||undefined}));};
  const createReg=()=>run(()=>api.post('/edms/registers',{...reg,project_id:n(reg.project_id),numbering_scheme:reg.numbering_scheme||undefined}));
  const createTr=()=>run(()=>api.post('/edms/transmittals',{...tr,project_id:n(tr.project_id)}));
  const addLine=()=>run(()=>api.post(`/edms/transmittals/${n(line.transmittal_id)}/lines`,{document_id:n(line.document_id)}));
  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">EDMS</p><h1>Controlled Documents & Transmittals</h1><p>Version-controlled document register with maker/checker approval and immutable issued transmittals.</p></div></header>
    {err&&<div className="notice">{err}</div>}

    <div className="panel"><h2>Controlled Documents</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={doc.project_id} onChange={v=>setDoc({...doc,project_id:v})} placeholder="Project"/>
      <input placeholder="Document No." value={doc.doc_number} onChange={e=>setDoc({...doc,doc_number:e.target.value})}/>
      <input placeholder="File name" value={doc.file_name} onChange={e=>setDoc({...doc,file_name:e.target.value})}/>
      <input placeholder="Storage key/path" value={doc.storage_key} onChange={e=>setDoc({...doc,storage_key:e.target.value})}/>
      <input placeholder="Revision" value={doc.revision} onChange={e=>setDoc({...doc,revision:e.target.value})}/>
      <select value={doc.confidentiality} onChange={e=>setDoc({...doc,confidentiality:e.target.value})}><option value="public">Public</option><option value="internal">Internal</option><option value="restricted">Restricted</option></select>
      <button onClick={createDoc}>Create Document</button>
    </div><div className="table-wrap"><table><thead><tr><th>No.</th><th>File</th><th>Version</th><th>Revision</th><th>Status</th><th>Control</th></tr></thead><tbody>{docs.map(d=><tr key={d.id}><td>{d.doc_number}</td><td>{d.file_name}</td><td>{d.version_no}</td><td>{d.revision||'—'}</td><td>{d.status}</td><td>
      {['draft','rejected'].includes(d.status)&&<><button onClick={()=>run(()=>api.post(`/edms/documents/${d.id}/submit`,{}))}>Submit</button><button onClick={()=>addVersion(d)}>New Version</button></>}
      {d.status==='for_approval'&&<><button onClick={()=>run(()=>api.post(`/edms/documents/${d.id}/review`,{action:'approved'}))}>Approve</button><button onClick={()=>run(()=>api.post(`/edms/documents/${d.id}/review`,{action:'rejected'}))}>Reject</button></>}
      {d.status==='approved'&&<button onClick={()=>addVersion(d)}>Revise</button>}
    </td></tr>)}</tbody></table></div></div>

    <div className="panel"><h2>Document Registers</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={reg.project_id} onChange={v=>setReg({...reg,project_id:v})} placeholder="Project"/>
      <select value={reg.register_type} onChange={e=>setReg({...reg,register_type:e.target.value})}><option value="drawings">Drawings</option><option value="correspondence">Correspondence</option><option value="contracts">Contracts</option><option value="submittals">Submittals</option><option value="photos">Photos</option></select>
      <input placeholder="Numbering scheme" value={reg.numbering_scheme} onChange={e=>setReg({...reg,numbering_scheme:e.target.value})}/><button onClick={createReg}>Create Register</button>
    </div><div className="table-wrap"><table><thead><tr><th>Project</th><th>Type</th><th>Numbering Scheme</th></tr></thead><tbody>{regs.map(r=><tr key={r.id}><td>{r.project_id}</td><td>{r.register_type}</td><td>{r.numbering_scheme||'—'}</td></tr>)}</tbody></table></div></div>

    <div className="panel"><h2>Transmittals</h2><div className="form-row">
      <ReferenceSelect kind="projects" value={tr.project_id} onChange={v=>setTr({...tr,project_id:v})} placeholder="Project"/><input placeholder="Transmittal No." value={tr.transmittal_no} onChange={e=>setTr({...tr,transmittal_no:e.target.value})}/><input placeholder="From" value={tr.from_party} onChange={e=>setTr({...tr,from_party:e.target.value})}/><input placeholder="To" value={tr.to_party} onChange={e=>setTr({...tr,to_party:e.target.value})}/><select value={tr.purpose} onChange={e=>setTr({...tr,purpose:e.target.value})}><option value="for_approval">For Approval</option><option value="for_information">For Information</option><option value="for_construction">For Construction</option></select><button onClick={createTr}>Create Draft</button>
    </div><div className="form-row"><select value={line.transmittal_id} onChange={e=>setLine({...line,transmittal_id:e.target.value})}><option value="">Draft Transmittal</option>{trs.filter(x=>x.status==='draft').map(x=><option key={x.id} value={x.id}>{x.transmittal_no}</option>)}</select><ReferenceSelect kind="documents" projectId={tr.project_id} value={line.document_id} onChange={v=>setLine({...line,document_id:v})} placeholder="Document"/><button onClick={addLine}>Add Current Version</button></div>
    <div className="table-wrap"><table><thead><tr><th>No.</th><th>Project</th><th>Purpose</th><th>Status</th><th>Lines</th><th>Control</th></tr></thead><tbody>{trs.map(t=><tr key={t.id}><td>{t.transmittal_no}</td><td>{t.project_id}</td><td>{t.purpose||'—'}</td><td>{t.status}</td><td>{t.line_count}</td><td>{t.status==='draft'&&<button onClick={()=>run(()=>api.post(`/edms/transmittals/${t.id}/issue`,{}))}>Issue</button>}{t.status==='issued'&&<button onClick={()=>{const reason=window.prompt('Void reason');if(reason)run(()=>api.post(`/edms/transmittals/${t.id}/void`,{reason}));}}>Void</button>}</td></tr>)}</tbody></table></div></div>
  </section>;
}
