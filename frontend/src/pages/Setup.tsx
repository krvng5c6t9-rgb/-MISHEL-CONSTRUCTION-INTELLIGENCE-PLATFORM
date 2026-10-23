import {useState} from 'react';
import {useNavigate,Link} from 'react-router-dom';
import {apiBootstrapAdmin,setToken} from '../lib/api';
import {useI18n,LanguageSwitch,type MessageKey} from '../lib/i18n';

// R1.2: labels from messages/setup.ts; the screen has its own language switch (it is shown before sign-in). The local
// check's notice is kept as a key so it follows the language; server messages arrive translated (lib/serverMessages).
export function Setup(){
  const nav=useNavigate();
  const {t}=useI18n();
  const [e,setE]=useState('');
  const [eKey,setEKey]=useState<MessageKey|null>(null);
  const [f,setF]=useState({organization_name:'',legal_name:'',tax_id:'',address:'',currency:'EGP',full_name:'',email:'',password:'',bootstrap_token:''});
  async function submit(){
    try{
      setE('');setEKey(null);
      if(!f.organization_name||!f.full_name||!f.email||f.password.length<8||f.bootstrap_token.length<32){setEKey('setup.incomplete');return;}
      const r=await apiBootstrapAdmin({organization:{name:f.organization_name,legal_name:f.legal_name||null,tax_id:f.tax_id||null,address:f.address||null,base_currency_code:f.currency},full_name:f.full_name,email:f.email,password:f.password,role_name:'System Admin'},f.bootstrap_token);
      setToken(r.data.token);
      nav('/');
    }catch(x:any){setE(x.message)}
  }
  const field=(key:MessageKey,k:keyof typeof f,extra:Record<string,any>={})=><input placeholder={t(key)} aria-label={t(key)} value={f[k]} onChange={x=>setF({...f,[k]:k==='currency'?x.target.value.toUpperCase():x.target.value})} {...extra}/>;
  return <main className="login-shell"><section className="login-card"><LanguageSwitch/><div><p className="eyebrow">{t('setup.eyebrow')}</p><h1>{t('setup.title')}</h1><p>{t('setup.intro')}</p></div>{(e||eKey)&&<div className="notice" role="alert">{eKey?t(eKey):<bdi>{e}</bdi>}</div>}<div className="form-grid">{field('setup.orgName','organization_name')}{field('setup.legalName','legal_name')}{field('setup.taxId','tax_id')}{field('setup.address','address')}{field('setup.currency','currency',{maxLength:3})}{field('setup.adminName','full_name')}{field('setup.adminEmail','email',{type:'email'})}{field('setup.adminPassword','password',{type:'password'})}{field('setup.token','bootstrap_token',{type:'password'})}<button onClick={submit}>{t('setup.submit')}</button></div><p><Link to="/login">{t('setup.backToLogin')}</Link></p></section></main>
}
