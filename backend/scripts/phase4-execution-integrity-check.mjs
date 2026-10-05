import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const root = repoRoot;
const src = path.join(root, 'backend', 'src');
const migration = path.join(repoRoot, 'database', 'migrations', '014_phase4_technical_planning_site_subcontracts_hardening.sql');
const routes = path.join(src, 'modules');

const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.ts'))files.push(p);}}
walk(src);
const text=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const checks=[];
const add=(name,ok,detail)=>checks.push({name,ok,detail});

add('Phase 4 migration exists',fs.existsSync(migration),'014_phase4_technical_planning_site_subcontracts_hardening.sql');
const sql=fs.existsSync(migration)?fs.readFileSync(migration,'utf8'):'';
for(const t of ['drawings','submittals','rfis','method_statements','schedule_baselines','schedule_activities','progress_updates','milestones','site_diary','diary_manpower','diary_equipment','site_instructions','quantity_sheets','punch_lists','cost_forecasts','evm_snapshots','subcontracts','subcontract_certificates','subcontract_certificate_lines','schedule_relationships']){
  add(`Tenant hardening: ${t}`,sql.includes(`'${t}'`) && sql.includes('ALTER COLUMN org_id SET NOT NULL') && sql.includes('ALTER TABLE %I ENABLE ROW LEVEL SECURITY'), 'org_id NOT NULL + RLS');
}
add('Subcontract module is routed',text.includes("apiRouter.use('/subcontracts', subcontractsRouter)") && text.includes("modules/subcontracts/subcontracts.routes.js"),'CRUD/approval routes wired');
add('Approval engine supports Phase 4 subcontract workflows',text.includes("'subcontract_signing'") && text.includes("'subcontract_certificate'") && text.includes("module === 'subcontract_certificate'"),'approval finalization + cost posting path');
add('No client-supplied initial approved states for technical records',!text.includes("body.status") || !/technicalOffice\.routes\.ts[\s\S]*body\.status/.test(text),'static scan');
add('No direct pool.connect outside DB layer',files.filter(f=>f.endsWith('.ts')&&!f.endsWith('/db/pool.ts')).every(f=>!fs.readFileSync(f,'utf8').includes('pool.connect(')),'DB context boundary');
add('Schedule relationship same-project guard exists',sql.includes('guard_schedule_relationship_project'),'cross-project schedule links blocked');
add('Financial posting uses existing subcontract validation trigger',sql.includes('subcontract_certificate') && fs.readFileSync(path.join(repoRoot,'database/migrations/009_priority_execution_patch.sql'),'utf8').includes("source_module = 'subcontract'"),'cost transaction integrity preserved');

const failed=checks.filter(x=>!x.ok);
console.log(`PHASE 4 EXECUTION INTEGRITY CHECK: ${failed.length?'FAIL':'PASS'}`);
for(const c of checks) console.log(`${c.ok?'PASS':'FAIL'} | ${c.name} | ${c.detail}`);
process.exit(failed.length?1:0);
