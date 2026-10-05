import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const failures=[];
const auth=read('backend/src/middleware/authenticate.ts');
const ctx=read('backend/src/db/context.ts');
const approvals=read('backend/src/services/approval.service.ts');
const hardening=read('database/migrations/021_redteam_integrity_hardening.sql');
if(!ctx.includes('enterWith(context)')) failures.push('AsyncLocalStorage downstream context persistence missing');
if(!auth.includes('enterDbContext({ userId, orgId: user.org_id })')) failures.push('Authenticated tenant context is not persisted into route chain');
if(!approvals.includes('initiator cannot approve the same transaction')) failures.push('Approval SoD initiator/approver guard missing');
if(!hardening.includes('guard_inventory_balance')) failures.push('Concurrent negative-stock guard missing');
if(!hardening.includes('guard_fiscal_period_overlap')) failures.push('Fiscal-period overlap guard missing');
if(!hardening.includes('guard_confirmed_doa_overlap')) failures.push('Confirmed DOA overlap guard missing');
for(const base of ['database/migrations','backend/src','frontend/src']){
 const walk=d=>{for(const e of fs.readdirSync(path.join(root,d),{withFileTypes:true})){const q=path.join(d,e.name);if(e.isDirectory())walk(q);else if(/\.(tmp|bak|orig|rej)$/.test(e.name))failures.push(`Release junk artifact: ${q}`)}};walk(base);
}
if(failures.length){console.error('RED-TEAM RELEASE CHECK: FAIL');for(const f of failures)console.error('-',f);process.exit(1)}
console.log('RED-TEAM RELEASE CHECK: PASS');
