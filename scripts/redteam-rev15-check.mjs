import fs from 'node:fs';
const files={tender:'backend/src/modules/tendering/tendering.routes.ts',crm:'backend/src/modules/crm/crm.routes.ts',claims:'backend/src/modules/claims/claims.routes.ts',mig:'database/migrations/027_claims_crm_tender_workflow_hardening.sql',tenderUi:'frontend/src/pages/Tendering.tsx',crmUi:'frontend/src/pages/CRM.tsx',claimsUi:'frontend/src/pages/Claims.tsx'};
const s=Object.fromEntries(Object.entries(files).map(([k,v])=>[k,fs.readFileSync(v,'utf8')]));
const checks=[
['Tender explicit state machine',s.tender.includes("invited:['in_progress','withdrawn']")&&s.tender.includes("submitted:['won','lost','withdrawn']")],
['Tender submitted only via approval engine',!s.tender.includes("z.enum(['invited','in_progress','submitted'")&&s.tenderUi.includes('Submit Approval')],
['Tender award/loss evidence',s.tender.includes('awarded_value is required')&&s.tender.includes('loss_reason is required')],
['Lead state machine',s.crm.includes("new:['qualified','lost']")&&s.crm.includes("proposal:['won','lost']")],
['Opportunity conversion cannot be patched',s.crm.includes("z.enum(['open','lost'])")&&s.crm.includes('Only open opportunities can be converted')],
['Claim final maker-checker',s.claims.includes('claim creator cannot make the final determination')&&s.mig.includes('claim creator cannot make final decision')],
['Claim determination attribution',s.claims.includes('determined_by')&&s.mig.includes('determined_at')],
['Claim final decision attribution',s.claims.includes('final_decided_by')&&s.mig.includes('final_decided_at')],
['Claim post-submission immutability',s.claims.includes('Only determination fields may be edited while claim is under review')],
['Claims UI explicit determination',s.claimsUi.includes('Approved days')&&s.claimsUi.includes('Approved amount')],
['Tender UI no arbitrary status select',!s.tenderUi.includes('<select value={x.status}')],
['CRM UI no arbitrary stage select',!s.crmUi.includes('<select value={x.stage}')],
['Migration 027 present',fs.existsSync(files.mig)]
];
let fail=0;for(const[c,ok]of checks){console.log(`${ok?'PASS':'FAIL'} - ${c}`);if(!ok)fail++;}console.log(`${checks.length-fail}/${checks.length} checks passed`);process.exit(fail?1:0);
