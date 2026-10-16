import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';

// R1.2: labels from messages/projects.ts; project type and status are stored codes shown through tv().
type Project = { id:number; project_code:string; project_name:string; project_type:string; status:string; location?:string; currency_code?:string };
type ApiResponse<T> = { success:boolean; data:T };
type RefData={clients:{id:number;client_name:string}[];currencies:{id:number;code:string;name:string}[]};
const TYPES: [string, MessageKey][] = [['fit_out','prj.typeFitOut'],['finishing','prj.typeFinishing'],['construction','prj.typeConstruction'],['design_build','prj.typeDesignBuild']];

export function Projects(){
 const{t,tv}=useI18n();
 const[rows,setRows]=useState<Project[]>([]);const[refs,setRefs]=useState<RefData>({clients:[],currencies:[]});const[msg,setMsg]=useState<string|null>(null);const[created,setCreated]=useState(false);
 const[f,setF]=useState<any>({project_code:'',project_name:'',project_type:'fit_out',currency_id:0,client_id:'',status:'execution',location:''});
 async function load(){const[a,b]=await Promise.all([apiGet<ApiResponse<Project[]>>('/projects'),apiGet<ApiResponse<RefData>>('/projects/reference-data/options')]);setRows(a.data);setRefs(b.data);if(!f.currency_id&&b.data.currencies[0])setF((x:any)=>({...x,currency_id:b.data.currencies[0].id}))}
 useEffect(()=>{load().catch(e=>setMsg(e.message))},[]);
 async function create(){try{setMsg(null);setCreated(false);await apiPost('/projects',{...f,currency_id:Number(f.currency_id),client_id:f.client_id?Number(f.client_id):undefined});setF((x:any)=>({...x,project_code:'',project_name:'',location:''}));await load();setCreated(true)}catch(e:any){setMsg(e.message)}}
 return <section className="page-stack"><header className="page-header"><div><p className="eyebrow">{t('prj.eyebrow')}</p><h1>{t('prj.title')}</h1><p>{t('prj.intro')}</p></div></header>{(msg||created)&&<div className="notice">{msg??t('prj.created')}</div>}
 <div className="panel"><h2>{t('prj.create')}</h2><div className="form-row"><input placeholder={t('prj.code')} value={f.project_code} onChange={e=>setF({...f,project_code:e.target.value})}/><input placeholder={t('prj.name')} value={f.project_name} onChange={e=>setF({...f,project_name:e.target.value})}/><select aria-label={t('prj.type')} value={f.project_type} onChange={e=>setF({...f,project_type:e.target.value})}>{TYPES.map(([v,k])=><option key={v} value={v}>{t(k)}</option>)}</select><select aria-label={t('prj.currency')} value={f.currency_id} onChange={e=>setF({...f,currency_id:Number(e.target.value)})}>{refs.currencies.map(c=><option key={c.id} value={c.id}>{c.code}</option>)}</select><select aria-label={t('prj.client')} value={f.client_id} onChange={e=>setF({...f,client_id:e.target.value})}><option value="">{t('prj.noClient')}</option>{refs.clients.map(c=><option key={c.id} value={c.id}>{c.client_name}</option>)}</select><select aria-label={t('prj.status')} value={f.status} onChange={e=>setF({...f,status:e.target.value})}>{['lead','tender','awarded','execution','closeout'].map(s=><option key={s} value={s}>{tv(s)}</option>)}</select><input placeholder={t('prj.location')} value={f.location} onChange={e=>setF({...f,location:e.target.value})}/><button onClick={create} disabled={!f.project_code||!f.project_name||!f.currency_id}>{t('prj.create')}</button></div></div>
 <div className="table-card"><div className="table-wrap"><table><thead><tr><th>{t('prj.colCode')}</th><th>{t('prj.colName')}</th><th>{t('prj.colType')}</th><th>{t('prj.colStatus')}</th><th>{t('prj.colCurrency')}</th><th>{t('prj.colLocation')}</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.project_code}</td><td>{r.project_name}</td><td>{tv(r.project_type)}</td><td>{tv(r.status)}</td><td>{r.currency_code??'-'}</td><td>{r.location??'-'}</td></tr>)}{!rows.length&&<tr><td colSpan={6}>{t('prj.none')}</td></tr>}</tbody></table></div></div></section>
}
