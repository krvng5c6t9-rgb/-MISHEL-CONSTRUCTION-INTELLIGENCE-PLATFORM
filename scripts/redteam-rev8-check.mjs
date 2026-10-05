import fs from 'node:fs';
const approval=fs.readFileSync('backend/src/services/approval.service.ts','utf8');
const gl=fs.readFileSync('backend/src/services/glPosting.service.ts','utf8');
const mig=fs.readFileSync('database/migrations/022_approval_integrity_hardening.sql','utf8');
const failures=[];
if(!approval.includes('d.effective_from <= current_date')) failures.push('DOA effective_from not enforced');
if(approval.includes('$5::bigint is null or d.currency_id = $5')) failures.push('DOA null-currency wildcard vulnerability remains');
if(!approval.includes('same user cannot approve more than one step')) failures.push('multi-step same-user SoD guard missing');
if(gl.includes('Math.abs(balance)') || gl.includes('sum + Number(l.debit)')) failures.push('manual journal still balanced in JS Float64');
if(!gl.includes('sum(debit)') || !gl.includes('sum(credit)')) failures.push('PostgreSQL NUMERIC balance check missing');
if(!mig.includes('ux_approval_instances_one_pending_record')) failures.push('pending approval uniqueness missing');
if(!mig.includes('ux_approval_actions_one_approval_per_user')) failures.push('approval user uniqueness missing');
if(fs.existsSync('frontend/src/pages/SimplePage.tsx')) failures.push('dead SimplePage placeholder remains');
if(failures.length){console.error('REV8 REDTEAM FAIL'); failures.forEach(x=>console.error('-',x)); process.exit(1)}
console.log('REV8 REDTEAM PASS');
