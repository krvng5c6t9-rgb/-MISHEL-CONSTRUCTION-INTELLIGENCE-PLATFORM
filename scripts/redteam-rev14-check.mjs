import fs from 'node:fs';

const checks = [];
const read = p => fs.readFileSync(p,'utf8');
const has = (name, file, patterns) => {
  const s=read(file); const missing=patterns.filter(p=>!s.includes(p));
  checks.push({name,ok:missing.length===0,missing});
};

has('Migration 026 exists','database/migrations/026_hse_qaqc_dashboard_integrity.sql',[
  "CHECK (status IN ('requested','approved','active','expired','closed'))",
  'guard_ptw_workflow_integrity','guard_ncr_closure_integrity','guard_incident_closure_integrity',
  'requested_by','approved_by','activated_by','closed_by'
]);
has('HSE controlled PTW API','backend/src/modules/hse/hse.routes.ts',[
  "/permits/:id/approve","/permits/:id/activate","/permits/:id/close","/permits/:id/expire",
  "status='requested'","requested_by<>$2","count(distinct i.id)","fatality"
]);
has('QAQC independent NCR closure','backend/src/modules/qaqc/qaqc.routes.ts',[
  "root_cause: z.string().min(1)","raised_by<>$4","count(distinct ic.id)","count(distinct n.id)"
]);
has('Executive dashboard avoids multiplicative financial joins','backend/src/modules/dashboards/dashboards.routes.ts',[
  'left join lateral (','from cost_transactions where project_id=p.id','from accounts_receivable where project_id=p.id','from accounts_payable where project_id=p.id',
  'count(distinct ic.id)','count(distinct i.id)',"fatality"
]);
has('HSE UI operational workflow','frontend/src/pages/HSE.tsx',["Request PTW","/approve","/activate","Close Investigation"]);
has('QAQC UI operational workflow','frontend/src/pages/QAQC.tsx',['Raise NCR','Independent Close','Create Inspection']);

let failed=0;
for (const c of checks) { console.log(`${c.ok?'PASS':'FAIL'} ${c.name}${c.ok?'':` missing: ${c.missing.join(', ')}`}`); if(!c.ok) failed++; }
console.log(`${checks.length-failed}/${checks.length} REV14 checks passed`);
if(failed) process.exit(1);
