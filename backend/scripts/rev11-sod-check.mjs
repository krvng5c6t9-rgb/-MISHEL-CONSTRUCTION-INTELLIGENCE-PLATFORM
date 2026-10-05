import fs from 'node:fs';
const hr=fs.readFileSync(new URL('../src/modules/hr/hr.routes.ts', import.meta.url),'utf8');
const mig=fs.readFileSync(new URL('../../database/migrations/023_timesheet_sod_hardening.sql', import.meta.url),'utf8');
const checks=[
 ['timesheet creator captured', /insert into timesheets[\s\S]*created_by/i.test(hr)],
 ['route blocks maker self approval', /created_by\s*<>\s*\$2/i.test(hr)],
 ['route tenant-scopes approval', /org_id\s*=\s*\$3/i.test(hr)],
 ['route only approves draft', /status='draft'/i.test(hr)],
 ['db trigger blocks self approval', /maker cannot approve own timesheet/i.test(mig)],
 ['db trigger blocks unattributed approval', /maker identity is missing/i.test(mig)],
 ['leave creator captured', /insert into leave_requests[\s\S]*created_by/i.test(hr)],
 ['leave route blocks maker decision', /leave_requests[\s\S]*created_by\s*<>\s*\$3/i.test(hr)],
 ['leave route tenant-scopes decision', /leave_requests[\s\S]*org_id\s*=\s*\$4/i.test(hr)],
 ['leave db trigger blocks self decision', /maker cannot decide own leave request/i.test(mig)]
];
let bad=0; for(const [n,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${n}`); if(!ok) bad++;}
if(bad) process.exit(1);
