import {useState} from 'react';
import {useNavigate,Link} from 'react-router-dom';
import {apiBootstrapAdmin,setToken} from '../lib/api';

export function Setup(){
  const nav=useNavigate();
  const [e,setE]=useState('');
  const [f,setF]=useState({organization_name:'',legal_name:'',tax_id:'',address:'',currency:'EGP',full_name:'',email:'',password:'',bootstrap_token:''});
  async function submit(){
    try{
      setE('');
      if(!f.organization_name||!f.full_name||!f.email||f.password.length<8||f.bootstrap_token.length<32) throw new Error('Complete organization/admin details and provide the 32+ character bootstrap token.');
      const r=await apiBootstrapAdmin({organization:{name:f.organization_name,legal_name:f.legal_name||null,tax_id:f.tax_id||null,address:f.address||null,base_currency_code:f.currency},full_name:f.full_name,email:f.email,password:f.password,role_name:'System Admin'},f.bootstrap_token);
      setToken(r.data.token);
      nav('/');
    }catch(x:any){setE(x.message)}
  }
  return <main className="login-shell"><section className="login-card"><div><p className="eyebrow">First-run onboarding</p><h1>Initialize Construction ERP</h1><p>Create the company tenant and first System Administrator without SQL or code changes.</p></div>{e&&<div className="notice">{e}</div>}<div className="form-grid"><input placeholder="Organization name" value={f.organization_name} onChange={x=>setF({...f,organization_name:x.target.value})}/><input placeholder="Legal name" value={f.legal_name} onChange={x=>setF({...f,legal_name:x.target.value})}/><input placeholder="Tax ID" value={f.tax_id} onChange={x=>setF({...f,tax_id:x.target.value})}/><input placeholder="Address" value={f.address} onChange={x=>setF({...f,address:x.target.value})}/><input maxLength={3} placeholder="Base currency (EGP)" value={f.currency} onChange={x=>setF({...f,currency:x.target.value.toUpperCase()})}/><input placeholder="Administrator full name" value={f.full_name} onChange={x=>setF({...f,full_name:x.target.value})}/><input type="email" placeholder="Administrator email" value={f.email} onChange={x=>setF({...f,email:x.target.value})}/><input type="password" placeholder="Administrator password" value={f.password} onChange={x=>setF({...f,password:x.target.value})}/><input type="password" placeholder="Bootstrap token" value={f.bootstrap_token} onChange={x=>setF({...f,bootstrap_token:x.target.value})}/><button onClick={submit}>Initialize ERP</button></div><p><Link to="/login">Back to login</Link></p></section></main>
}
