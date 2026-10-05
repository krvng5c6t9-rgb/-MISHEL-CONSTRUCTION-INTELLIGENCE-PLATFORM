import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const route=read('backend/src/modules/technicalOffice/technicalOffice.routes.ts');
const mig=read('database/migrations/025_technical_office_workflow_hardening.sql');
const ui=read('frontend/src/pages/TechnicalOffice.tsx');
const checks=[
 ['drawing maker/checker API',route.includes('drawing issuer cannot review own drawing')],
 ['submittal maker/checker API',route.includes('submitter cannot review own submittal')],
 ['RFI maker/checker API',route.includes('RFI raiser cannot answer own RFI')],
 ['method statement submit workflow',route.includes('/method-statements/:id/submit')],
 ['method statement review workflow',route.includes('/method-statements/:id/review')],
 ['DB workflow trigger',mig.includes('guard_technical_office_workflow')],
 ['DB cross-tenant document guard',mig.includes('Referenced document must belong to the same organization')],
 ['DB drawing SoD',mig.includes('drawing issuer cannot review own drawing')],
 ['DB method statement SoD',mig.includes('method statement maker/submitter cannot approve own statement')],
 ['UI drawing actions',ui.includes('Approve w/comments')&&ui.includes('Supersede')],
 ['UI submittal actions',ui.includes('Start Review')&&ui.includes('Resubmit required')],
 ['UI RFI actions',ui.includes('Respond')&&ui.includes('Close')],
 ['UI method statement actions',ui.includes('Create Draft')&&ui.includes('Submit')],
];
let fail=0;for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} - ${name}`);if(!ok)fail++;}if(fail)process.exit(1);console.log(`REV13 technical-office hostile checks PASS (${checks.length}/${checks.length})`);
