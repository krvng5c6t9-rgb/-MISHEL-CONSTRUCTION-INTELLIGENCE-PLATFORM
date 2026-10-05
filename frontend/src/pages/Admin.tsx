import {useEffect,useMemo,useState} from 'react';
import {apiGet,apiPost,apiPatch,apiPut} from '../lib/api';

const MODULES=['admin','projects','boq','crm','tendering','contracts','procurement','finance','cost_control','approvals','technical_office','planning','site','hr','assets','qaqc','hse','edms','dashboards','reports','portals','notifications'];
const ACTIONS=['view','create','edit','approve','delete','export','manage','post'];

type Permission={module:string;action:string;scope:'own'|'department'|'all'};

export function Admin(){
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
  async function addRole(){try{setE('');if(!rf.role_name.trim())throw new Error('Role name is required');await apiPost('/roles',{...rf,permissions:[]});setRf({role_name:'',description:''});await load()}catch(x:any){setE(x.message)}}
  async function loadRolePermissions(roleId:number){try{setE('');setSelectedRole(roleId);const x=await apiGet<any>(`/roles/${roleId}/permissions`);const map:Record<string,Permission>={};for(const p of x.data)map[`${p.module}:${p.action}`]={module:p.module,action:p.action,scope:p.scope};setPerms(map)}catch(x:any){setE(x.message)}}
  function togglePermission(module:string,action:string){const k=`${module}:${action}`;const next={...perms};if(next[k])delete next[k];else next[k]={module,action,scope:'all'};setPerms(next)}
  function setScope(module:string,action:string,scope:'own'|'department'|'all'){const k=`${module}:${action}`;setPerms({...perms,[k]:{module,action,scope}})}
  async function savePermissions(){try{setE('');if(!selectedRole)throw new Error('Select a role first');await apiPut(`/roles/${selectedRole}/permissions`,{permissions:Object.values(perms)});await loadRolePermissions(selectedRole)}catch(x:any){setE(x.message)}}
  async function saveDoa(x:any){try{setE('');await apiPatch(`/approvals/configuration/doa/${x.id}`,{
    min_amount:Number(x.min_amount),max_amount:x.max_amount===''||x.max_amount==null?null:Number(x.max_amount),currency_id:x.currency_id?Number(x.currency_id):null,approval_level:Number(x.approval_level),approver_role_id:Number(x.approver_role_id),is_active:Boolean(x.is_active),effective_from:x.effective_from||undefined,effective_to:x.effective_to||null,notes:x.notes||null,confirm:true
  });await load()}catch(q:any){setE(q.message)}}
  function updateDoa(id:number,key:string,value:any){setD(d.map(x=>x.id===id?{...x,[key]:value}:x))}

  const selectedRoleName=useMemo(()=>r.find(x=>x.id===selectedRole)?.role_name??'',[r,selectedRole]);

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">Governance</p><h1>Users, Roles, Permissions & DOA</h1><p>Operational access control, maker/checker authority and approval thresholds.</p></div></header>
    {e&&<div className="notice">{e}</div>}

    <div className="panel"><h2>Create User</h2><div className="form-row"><input placeholder="Full name" value={f.full_name} onChange={x=>setF({...f,full_name:x.target.value})}/><input placeholder="Email" value={f.email} onChange={x=>setF({...f,email:x.target.value})}/><input type="password" placeholder="Password" value={f.password} onChange={x=>setF({...f,password:x.target.value})}/><select value={f.role_id} onChange={x=>setF({...f,role_id:Number(x.target.value)})}><option value={0}>Role</option>{r.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.role_name}</option>)}</select><button onClick={addUser} disabled={!f.full_name||!f.email||f.password.length<8||!f.role_id}>Create User</button></div></div>

    <div className="panel"><h2>Users</h2><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Type</th><th>Status</th><th>Action</th></tr></thead><tbody>{u.map(x=><tr key={x.id}><td>{x.full_name}</td><td>{x.email}</td><td>{x.role_name}</td><td>{x.user_type}</td><td>{x.is_active?'Active':'Inactive'}</td><td><button onClick={()=>toggleUser(x)}>{x.is_active?'Deactivate':'Activate'}</button></td></tr>)}</tbody></table></div></div>

    <div className="panel"><h2>Role Management</h2><div className="form-row"><input placeholder="Role name" value={rf.role_name} onChange={x=>setRf({...rf,role_name:x.target.value})}/><input placeholder="Description" value={rf.description} onChange={x=>setRf({...rf,description:x.target.value})}/><button onClick={addRole}>Create Role</button><select value={selectedRole} onChange={x=>loadRolePermissions(Number(x.target.value))}><option value={0}>Select role to manage</option>{r.map(x=><option key={x.id} value={x.id}>{x.role_name}</option>)}</select></div>
    {selectedRole>0&&<><h3>Permissions — {selectedRoleName}</h3><div className="table-wrap"><table><thead><tr><th>Module</th>{ACTIONS.map(a=><th key={a}>{a}</th>)}</tr></thead><tbody>{MODULES.map(m=><tr key={m}><td>{m}</td>{ACTIONS.map(a=>{const k=`${m}:${a}`,p=perms[k];return <td key={a}><input type="checkbox" checked={!!p} onChange={()=>togglePermission(m,a)}/>{p&&<select value={p.scope} onChange={x=>setScope(m,a,x.target.value as any)}><option value="own">own</option><option value="department">department</option><option value="all">all</option></select>}</td>})}</tr>)}</tbody></table></div><button onClick={savePermissions}>Save Role Permissions</button></>}</div>

    <div className="panel"><h2>Delegation of Authority</h2><p>Editing and confirming a row makes it eligible for the approval engine. Confirm only company-approved thresholds.</p><div className="table-wrap"><table><thead><tr><th>Module</th><th>Level</th><th>Min</th><th>Max</th><th>Approver</th><th>Active</th><th>Confirmed</th><th>Action</th></tr></thead><tbody>{d.map(x=><tr key={x.id}><td>{x.module}</td><td><input type="number" min="1" value={x.approval_level} onChange={q=>updateDoa(x.id,'approval_level',q.target.value)}/></td><td><input type="number" min="0" value={x.min_amount} onChange={q=>updateDoa(x.id,'min_amount',q.target.value)}/></td><td><input type="number" min="0" value={x.max_amount??''} placeholder="Unlimited" onChange={q=>updateDoa(x.id,'max_amount',q.target.value)}/></td><td><select value={x.approver_role_id} onChange={q=>updateDoa(x.id,'approver_role_id',Number(q.target.value))}>{r.map(z=><option key={z.id} value={z.id}>{z.role_name}</option>)}</select></td><td><input type="checkbox" checked={!!x.is_active} onChange={q=>updateDoa(x.id,'is_active',q.target.checked)}/></td><td>{x.is_confirmed?'Yes':'No'}</td><td><button onClick={()=>saveDoa(x)}>Save & Confirm</button></td></tr>)}</tbody></table></div></div>
  </section>
}
