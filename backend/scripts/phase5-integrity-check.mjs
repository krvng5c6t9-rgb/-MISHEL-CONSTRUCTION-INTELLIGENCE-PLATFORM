import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const root = repoRoot;
const migration = path.join(repoRoot, 'database/migrations/015_phase5_hr_hse_qaqc_edms_hardening.sql');
const modules = ['hr','assets','qaqc','hse','edms'];
const errors = [];
if (!fs.existsSync(migration)) errors.push('Missing Phase 5 hardening migration');
const sql = fs.existsSync(migration) ? fs.readFileSync(migration,'utf8') : '';
for (const token of ['FORCE ROW LEVEL SECURITY','guard_phase5_org_consistency','guard_phase5_status_transition','guard_phase5_posting_lock','guard_transmittal_document_tenant']) {
  if (!sql.includes(token)) errors.push(`Missing required control: ${token}`);
}
for (const m of modules) {
  const dir = path.join(root,'backend/src/modules',m);
  if (!fs.existsSync(dir)) errors.push(`Missing module: ${m}`);
}
const sourceFiles=[];
function walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else if(e.name.endsWith('.ts')) sourceFiles.push(p);} }
walk(path.join(root,'backend/src/modules'));
for (const f of sourceFiles.filter(f=>modules.some(m=>f.includes(`/modules/${m}/`)))) {
  const s=fs.readFileSync(f,'utf8');
  if (/\bpool\.connect\s*\(/.test(s)) errors.push(`Direct pool.connect in ${f}`);
}
if (errors.length) { console.error('PHASE5 INTEGRITY CHECK: FAIL'); for(const e of errors) console.error(`- ${e}`); process.exit(1); }
console.log('PHASE5 INTEGRITY CHECK: PASS');
console.log(`Checked modules: ${modules.length}`);
console.log('Tenant, status-transition, posting-lock and EDMS controls present.');
