import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
let bad=0;
const fail=(m)=>{console.error('FAIL',m);bad++};
const pass=(m)=>console.log('PASS',m);
const auth=fs.readFileSync(path.join(root,'backend/src/modules/auth/auth.routes.ts'),'utf8');
const routeFiles=[];
const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.ts'))routeFiles.push(p)}};
walk(path.join(root,'backend/src'));
const used=new Set();
for(const f of routeFiles){const t=fs.readFileSync(f,'utf8');for(const m of t.matchAll(/authorize\(['\"]([^'\"]+)['\"]\s*,/g))used.add(m[1]);}
const mm=auth.match(/const modules = \[([^\]]+)\]/);
if(!mm) fail('bootstrap permission module registry not found');
else {
  const boot=new Set([...mm[1].matchAll(/['\"]([^'\"]+)['\"]/g)].map(x=>x[1]));
  const missing=[...used].filter(x=>!boot.has(x));
  if(missing.length) fail(`bootstrap-admin misses authorized modules: ${missing.join(', ')}`); else pass('bootstrap-admin covers every authorize() module');
}
const sub=fs.readFileSync(path.join(root,'backend/src/modules/subcontracts/subcontracts.routes.ts'),'utf8');
for(const needle of ["authorize('site','approve')","created_by<>$3","site_verified_by<>$3","qs_certified_by=$3"]){if(!sub.includes(needle))fail(`subcontract certificate SoD route guard missing: ${needle}`)}
if(!bad) pass('subcontract certificate maker/site/QS segregation is wired in routes');
const mig=fs.readFileSync(path.join(root,'database/migrations/024_subcontract_certificate_sod_hardening.sql'),'utf8');
for(const needle of ['guard_subcontract_certificate_sod','maker cannot site-verify','site verifier cannot QS-certify']){if(!mig.includes(needle))fail(`DB SoD hardening missing: ${needle}`)}
if(!bad) pass('REV12 database SoD trigger present');
process.exit(bad?1:0);
