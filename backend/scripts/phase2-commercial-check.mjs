import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = path.join(backend, '..', 'database', 'migrations', '012_phase2_crm_tender_contracts.sql');
const routeFiles = [
  'src/modules/clients/clients.routes.ts',
  'src/modules/crm/crm.routes.ts',
  'src/modules/tendering/tendering.routes.ts',
  'src/modules/contracts/contracts.routes.ts'
];
let failed = false;
function assert(ok,msg){ if(!ok){ failed=true; console.error('FAIL:',msg);} else console.log('PASS:',msg); }

assert(fs.existsSync(migration),'Phase 2 migration exists');
for(const f of routeFiles) assert(fs.existsSync(path.join(backend,f)),`${f} exists`);
const index=fs.readFileSync(path.join(backend,'src/routes/index.ts'),'utf8');
for(const token of ["'/clients'","'/crm'","'/tendering'","'/contracts'"]) assert(index.includes(token),`${token} mounted`);
const service=fs.readFileSync(path.join(backend,'src/services/approval.service.ts'),'utf8');
for(const token of ["'tender_submission'","'contract_signing'","'variation'"]) assert(service.includes(token),`approval module ${token} supported`);
const migrationText=fs.readFileSync(migration,'utf8');
for(const table of ['lead_activities','opportunities','tender_documents','tender_clarifications','contracts','contract_clauses','variations','variation_boq_lines','boq_master']) assert(migrationText.includes(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS org_id BIGINT`),`${table} gets tenant key`);
for(const table of ['leads','lead_activities','opportunities','tenders','tender_documents','tender_clarifications','boq_master','contracts','contract_clauses','variations','variation_boq_lines']) assert(migrationText.includes(`'${table}'`),`${table} included in Phase 2 RLS set`);
assert(migrationText.includes('ALTER TABLE %I FORCE ROW LEVEL SECURITY'),'Phase 2 dynamic FORCE RLS statement exists');
for(const route of routeFiles){ const text=fs.readFileSync(path.join(backend,route),'utf8'); assert(text.includes("authorize('"),`${route} uses authorization`); assert(!/body\.org_id|query\.org_id|params\.org_id/.test(text),`${route} does not trust request org_id`); }
assert(!/pool\.connect\(/.test(routeFiles.map(f=>fs.readFileSync(path.join(backend,f),'utf8')).join('\n')),'Phase 2 routes do not use raw pool.connect');
console.log(`PHASE 2 COMMERCIAL CHECK: ${failed?'FAIL':'PASS'}`);
process.exit(failed?1:0);
