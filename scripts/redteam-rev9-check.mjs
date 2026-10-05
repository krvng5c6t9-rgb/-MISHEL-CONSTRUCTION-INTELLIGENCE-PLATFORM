import fs from 'node:fs';
const procurement=fs.readFileSync('backend/src/modules/procurement/procurement.routes.ts','utf8');
const finance=fs.readFileSync('backend/src/modules/finance/finance.routes.ts','utf8');
const cost=fs.readFileSync('backend/src/services/costPosting.service.ts','utf8');
const gl=fs.readFileSync('backend/src/services/glPosting.service.ts','utf8');
const approval=fs.readFileSync('backend/src/services/approval.service.ts','utf8');
const failures=[];
if(procurement.includes('Math.abs(variance)') || procurement.includes('const invoiceAmount=Number(')) failures.push('3-way match still uses JS Float64');
if(!procurement.includes('All monetary arithmetic stays in PostgreSQL NUMERIC')) failures.push('3-way match NUMERIC calculation missing');
if(cost.includes('const actualAmount = Number(invoice.amount)')) failures.push('vendor invoice cost posting still uses JS Float64');
if(finance.includes('body.lines.reduce') || finance.includes('Math.abs(debit - credit)')) failures.push('manual journal balance still uses JS Float64');
if(!finance.includes('jsonb_array_elements($1::jsonb)')) failures.push('manual journal creation DB NUMERIC balance missing');
if(gl.includes('amount: Number(ct.amount)') || gl.includes('amount: Number(ipc.net_amount_due)') || gl.includes('amount: Number(payment.amount)')) failures.push('GL monetary amount still coerced through Number');
if(!approval.includes('number | string | null')) failures.push('approval amount type cannot preserve PG NUMERIC strings');
if(failures.length){console.error('REV9 REDTEAM FAIL');failures.forEach(x=>console.error('-',x));process.exit(1)}
console.log('REV9 REDTEAM PASS — monetary precision hardening verified statically');
