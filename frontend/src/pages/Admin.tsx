import {useEffect,useMemo,useState} from 'react';
import {apiGet,apiPost,apiPatch,apiPut} from '../lib/api';
import {useI18n} from '../lib/i18n';

// R1.2: labels from messages/admin.ts; permission modules, actions, scopes, user types and DOA modules are stored codes
// shown through tv() (messages/values.ts); server messages are shown as sent.
// CC-081 (F-57): every permission module the API enforces can be granted here (ai_platform, automation, knowledge, commercial_platform and system were missing).
const MODULES=['admin','projects','boq','crm','tendering','contracts','procurement','finance','cost_control','approvals','technical_office','planning','site','hr','assets','qaqc','hse','edms','dashboards','reports','portals','notifications','vendors','ai_platform','automation','knowledge','commercial_platform','system'];
const ACTIONS=['view','create','edit','approve','delete','export','manage','post'];
const SCOPES=['own','department','all'] as const;

type Permission={module:string;action:string;scope:'own'|'department'|'all'};

export function Admin(){
  const{t,tv}=useI18n();
  const[u,setU]=useState<any[]>([]),[r,setR]=useState<any[]>([]),[d,setD]=useState<any[]>([]),[e,setE]=useState('');
  const[f,setF]=useState<any>({full_name:'',email:'',password:'',role_id:0,user_type:'internal'});
  const[rf,setRf]=useState({role_name:'',description:''});
  const[selectedRole,setSelectedRole]=useState<number>(0);
  const[perms,setPerms]=useState<Record<string,Permission>>({});

  async function load(){
    const[a,b,c]=await Promise.all([apiGet<any>('/users'),apiGet<any>('/roles'),apiGet<any>('/approvals/configuration/doa')]);
    setU(a.data);setR(b.data);setD(c.data);
  }
  useEffect(()=>{load().catch(x=>setE(x.message))},[]);

  async function addUser(){try{setE('');await apiPost('/users',f);setF({...f,full_name:'',email:'',password:''});await load()}catch(x:any){setE(x.message)}}
  async function toggleUser(x:any){try{setE('');await apiPatch(`/users/${x.id}/status`,{is_active:!x.is_active});await load()}catch(q:any){setE(q.message)}}
  // Stage 33 / DEC-015: lost authenticator - another administrator resets the second factor with a reason; the user's
  // sessions end and they set up MFA again at the next sign-in.
  const[note,setNote]=useState<string|null>(null); // name of the user whose MFA was reset; the message is built in the current language
  async function resetMfa(x:any){try{setE('');setNote(null);const reason=window.prompt(t('admin.askMfaReason',{name:x.full_name}));if(!reason)return;await apiPost(`/users/${x.id}/mfa-reset`,{reason});setNote(x.full_name);await load()}catch(q:any){setE(q.message)}}
  async function addRole(){try{setE('');if(!rf.role_name.trim())throw new Error(t('admin.roleNameRequired'));await apiPost('/roles',{...rf,permissions:[]});setRf({role_name:'',description:''});await load()}catch(x:any){setE(x.message)}}
  async function loadRolePermissions(roleId:number){try{setE('');setSelectedRole(roleId);const x=await apiGet<any>(`/roles/${roleId}/permissions`);const map:Record<string,Permission>={};for(const p of x.data)map[`${p.module}:${p.action}`]={module:p.module,action:p.action,scope:p.scope};setPerms(map)}catch(x:any){setE(x.message)}}
  function togglePermission(module:string,action:string){const k=`${module}:${action}`;const next={...perms};if(next[k])delete next[k];else next[k]={module,action,scope:'all'};setPerms(next)}
  function setScope(module:string,action:string,scope:'own'|'department'|'all'){const k=`${module}:${action}`;setPerms({...perms,[k]:{module,action,scope}})}
  async function savePermissions(){try{setE('');if(!selectedRole)throw new Error(t('admin.selectRoleFirst'));await apiPut(`/roles/${selectedRole}/permissions`,{permissions:Object.values(perms)});await loadRolePermissions(selectedRole)}catch(x:any){setE(x.message)}}
  // DOA lifecycle (CC-017): drafts are edited and then confirmed by a different user; confirmed rules are
  // immutable and change only through a superseding draft or retirement with a reason.
  function doaBody(x:any){return{min_amount:Number(x.min_amount),max_amount:x.max_amount===''||x.max_amount==null?null:Number(x.max_amount),currency_id:x.currency_id?Number(x.currency_id):null,approval_level:Number(x.approval_level),approver_role_id:Number(x.approver_role_id),is_active:Boolean(x.is_active),effective_from:x.effective_from?String(x.effective_from).slice(0,10):undefined,effective_to:x.effective_to?String(x.effective_to).slice(0,10):null,notes:x.notes||null}}
  async function saveDoa(x:any){try{setE('');await apiPatch(`/approvals/configuration/doa/${x.id}`,doaBody(x));await load()}catch(q:any){setE(q.message)}}
  async function confirmDoa(x:any){try{setE('');await apiPost(`/approvals/configuration/doa/${x.id}/confirm`,{});await load()}catch(q:any){setE(q.message)}}
  async function newDoaVersion(x:any){try{setE('');const b=doaBody(x);await apiPost('/approvals/configuration/doa',{...b,module:x.module,supersedes_id:x.id,effective_from:undefined});await load()}catch(q:any){setE(q.message)}}
  async function retireDoa(x:any){try{setE('');const reason=window.prompt(t('admin.askRetireReason'));if(!reason)return;await apiPost(`/approvals/configuration/doa/${x.id}/retire`,{reason});await load()}catch(q:any){setE(q.message)}}
  function updateDoa(id:number,key:string,value:any){setD(d.map(x=>x.id===id?{...x,[key]:value}:x))}

  const selectedRoleName=useMemo(()=>r.find(x=>x.id===selectedRole)?.role_name??'',[r,selectedRole]);

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('admin.eyebrow')}</p><h1>{t('admin.title')}</h1><p>{t('admin.intro')}</p></div></header>
    {e&&<div className="notice">{e}</div>}

    <div className="panel" data-section="create-user"><h2>{t('admin.createUser')}</h2><div className="form-row"><input placeholder={t('admin.fullName')} value={f.full_name} onChange={x=>setF({...f,full_name:x.target.value})}/><input placeholder={t('admin.email')} value={f.email} onChange={x=>setF({...f,email:x.target.value})} dir="ltr"/><input type="password" placeholder={t('admin.password')} value={f.password} onChange={x=>setF({...f,password:x.target.value})}/><select aria-label={t('admin.role')} value={f.role_id} onChange={x=>setF({...f,role_id:Number(x.target.value)})}><option value={0}>{t('admin.role')}</option>{r.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.role_name}</option>)}</select><button onClick={addUser} disabled={!f.full_name||!f.email||f.password.length<8||!f.role_id}>{t('admin.createUser')}</button></div></div>

    <div className="panel" data-section="users"><h2>{t('admin.users')}</h2>{note!==null&&<div className="notice muted" role="status">{t('admin.mfaResetDone',{name:note})}</div>}<div className="table-wrap"><table><thead><tr><th>{t('admin.colName')}</th><th>{t('admin.colEmail')}</th><th>{t('admin.colRole')}</th><th>{t('admin.colType')}</th><th>{t('admin.colStatus')}</th><th>{t('admin.colMfa')}</th><th>{t('admin.colAction')}</th></tr></thead><tbody>{u.map(x=><tr key={x.id}><td>{x.full_name}</td><td><span dir="ltr">{x.email}</span></td><td>{x.role_name}</td><td>{tv(x.user_type)}</td><td>{x.is_active?t('admin.active'):t('admin.inactive')}</td><td>{x.mfa_enabled?t('admin.mfaEnabled'):x.mfa_required?t('admin.mfaRequired'):'—'}</td><td><button onClick={()=>toggleUser(x)}>{x.is_active?t('admin.deactivate'):t('admin.activate')}</button>{x.mfa_enabled&&<button onClick={()=>resetMfa(x)}>{t('admin.resetMfa')}</button>}</td></tr>)}</tbody></table></div></div>

    <div className="panel" data-section="roles"><h2>{t('admin.roles')}</h2><div className="form-row"><input placeholder={t('admin.roleName')} value={rf.role_name} onChange={x=>setRf({...rf,role_name:x.target.value})}/><input placeholder={t('admin.description')} value={rf.description} onChange={x=>setRf({...rf,description:x.target.value})}/><button onClick={addRole}>{t('admin.createRole')}</button><select aria-label={t('admin.selectRole')} value={selectedRole} onChange={x=>loadRolePermissions(Number(x.target.value))}><option value={0}>{t('admin.selectRole')}</option>{r.map(x=><option key={x.id} value={x.id}>{x.role_name}</option>)}</select></div>
    {selectedRole>0&&<><h3>{t('admin.permissionsFor',{role:selectedRoleName})}</h3><div className="table-wrap"><table><thead><tr><th>{t('admin.colModule')}</th>{ACTIONS.map(a=><th key={a}>{tv(a)}</th>)}</tr></thead><tbody>{MODULES.map(m=><tr key={m}><td>{tv(m)}</td>{ACTIONS.map(a=>{const k=`${m}:${a}`,p=perms[k];return <td key={a}><input type="checkbox" aria-label={`${tv(m)} — ${tv(a)}`} checked={!!p} onChange={()=>togglePermission(m,a)}/>{p&&<select value={p.scope} onChange={x=>setScope(m,a,x.target.value as any)}>{SCOPES.map(s=><option key={s} value={s}>{tv(s)}</option>)}</select>}</td>})}</tr>)}</tbody></table></div><button onClick={savePermissions}>{t('admin.savePermissions')}</button></>}</div>

    <div className="panel" data-section="doa"><h2>{t('admin.doa')}</h2><p>{t('admin.doaNote')}</p><div className="table-wrap"><table><thead><tr><th>{t('admin.colModule')}</th><th>{t('admin.colLevel')}</th><th>{t('admin.colMin')}</th><th>{t('admin.colMax')}</th><th>{t('admin.colApprover')}</th><th>{t('admin.colActive')}</th><th>{t('admin.colConfirmed')}</th><th>{t('admin.colAction')}</th></tr></thead><tbody>{d.map(x=><tr key={x.id}><td>{tv(x.module)}</td><td><input type="number" min="1" value={x.approval_level} onChange={q=>updateDoa(x.id,'approval_level',q.target.value)}/></td><td><input type="number" min="0" value={x.min_amount} onChange={q=>updateDoa(x.id,'min_amount',q.target.value)}/></td><td><input type="number" min="0" value={x.max_amount??''} placeholder={t('admin.unlimited')} onChange={q=>updateDoa(x.id,'max_amount',q.target.value)}/></td><td><select value={x.approver_role_id} onChange={q=>updateDoa(x.id,'approver_role_id',Number(q.target.value))}>{r.map(z=><option key={z.id} value={z.id}>{z.role_name}</option>)}</select></td><td><input type="checkbox" checked={!!x.is_active} onChange={q=>updateDoa(x.id,'is_active',q.target.checked)}/></td><td>{x.is_confirmed?(x.is_active?t('admin.doaConfirmed'):t('admin.doaRetired')):t('admin.doaDraft')}</td><td>{x.is_confirmed?<>{x.is_active&&<><button onClick={()=>newDoaVersion(x)}>{t('admin.newVersion')}</button><button onClick={()=>retireDoa(x)}>{t('admin.retire')}</button></>}</>:<><button onClick={()=>saveDoa(x)}>{t('admin.saveDraft')}</button>{x.is_active&&<button onClick={()=>confirmDoa(x)}>{t('admin.confirm')}</button>}</>}</td></tr>)}</tbody></table></div></div>
  </section>
}
