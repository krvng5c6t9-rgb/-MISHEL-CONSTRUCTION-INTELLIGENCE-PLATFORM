import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const src = path.join(root, 'src');
const migrations = path.join(root, '..', 'database', 'migrations');
const files = [];
function walk(dir) { for (const e of fs.readdirSync(dir,{withFileTypes:true})) { const p=path.join(dir,e.name); if(e.isDirectory()) walk(p); else if(/\.(ts|sql)$/.test(e.name)) files.push(p); } }
walk(src); walk(migrations);
const sourceFiles = files.filter(f=>f.endsWith('.ts') && !f.includes(`${path.sep}scripts${path.sep}`));
const source = sourceFiles.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const sql = files.filter(f=>f.endsWith('.sql')).map(f=>fs.readFileSync(f,'utf8')).join('\n');
const failures=[];

const tenantCriticalTables = [
  'permissions','approval_actions_log','boq_rate_buildup','material_requisitions','mr_lines','rfqs',
  'rfq_vendors','vendor_quotations','comparative_statements','purchase_orders','po_lines',
  'goods_receipt_notes','grn_lines','vendor_invoices','cost_transactions','budgets'
];
if (!fs.existsSync(path.join(migrations,'032_core_procurement_cost_tenant_integrity.sql'))) failures.push('Core procurement/cost tenant hardening migration 032 missing');
for (const table of tenantCriticalTables) {
  const addOrg = new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+org_id`, 'i');
  if (!addOrg.test(sql)) failures.push(`Critical table ${table} is not explicitly given org_id`);
}
if (!sql.includes('enforce_core_parent_tenant_integrity')) failures.push('Core parent tenant consistency trigger is missing');
if (!sql.includes('Cross-tenant write blocked')) failures.push('Core tenant trigger does not fail closed on cross-tenant writes');
const nonDbSource = sourceFiles.filter(f=>!f.endsWith(`${path.sep}db${path.sep}pool.ts`)).map(f=>fs.readFileSync(f,'utf8')).join('\n');
if ((nonDbSource.match(/pool\.connect\(\)/g)||[]).length) failures.push('Direct pool.connect() remains outside db/pool.ts');
if (!fs.existsSync(path.join(migrations,'011_phase1_security_tenant_isolation.sql'))) failures.push('Phase 1 security migration missing');
if (!source.includes("set_config($1, $2, false)") || !source.includes('AsyncLocalStorage')) failures.push('Tenant DB context is missing');
if (!source.includes('AsyncLocalStorage')) failures.push('AsyncLocalStorage tenant context is missing');
if (!/ALTER TABLE %I\.%I FORCE ROW LEVEL SECURITY/.test(sql)) failures.push('FORCE RLS migration guard missing');
if (!/CREATE POLICY tenant_isolation_write/.test(sql)) failures.push('Tenant write policy missing');
const routeSource = sourceFiles.filter(f=>!f.endsWith(`${path.sep}auth.routes.ts`)).map(f=>fs.readFileSync(f,'utf8')).join('\n');
const requestOrg = routeSource.match(/(?:body|req\.query|req\.params)\.org_id/g)||[];
if (requestOrg.length) failures.push(`Untrusted org_id references remain outside auth: ${requestOrg.length}`);
if (failures.length) { console.error('TENANT ISOLATION CHECK: FAIL'); failures.forEach(x=>console.error('- '+x)); process.exit(1); }
console.log('TENANT ISOLATION CHECK: PASS');
console.log('Checked TypeScript source files:', sourceFiles.length);
console.log('Checked SQL files:', files.filter(f=>f.endsWith('.sql')).length);
