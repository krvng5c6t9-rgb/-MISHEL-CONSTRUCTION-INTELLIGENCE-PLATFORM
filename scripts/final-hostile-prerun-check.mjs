import fs from 'node:fs';
const failures=[];const ok=(c,m)=>{if(c)console.log('PASS '+m);else{console.error('FAIL '+m);failures.push(m)}};
const read=p=>fs.readFileSync(p,'utf8');
const procurement=read('backend/src/modules/procurement/procurement.routes.ts');
const inventory=read('backend/src/modules/inventory/inventory.routes.ts');
const finance=read('backend/src/modules/finance/finance.routes.ts');
const tenant=read('backend/scripts/tenant-isolation-check.mjs');
const mig=read('database/migrations/032_core_procurement_cost_tenant_integrity.sql');
const projectsUi=read('frontend/src/pages/Projects.tsx');
const crmUi=read('frontend/src/pages/CRM.tsx');
const procurementUi=read('frontend/src/pages/Procurement.tsx');
const financeUi=read('frontend/src/pages/Finance.tsx');
const routes=read('backend/src/routes/index.ts');

ok(!/body\.lines\.reduce\(/.test(procurement),'PO monetary total is not calculated with JS reduce/Float64');
ok(procurement.includes('coalesce(sum(amount),0)::numeric(18,2)'),'PO total is calculated in PostgreSQL NUMERIC');
ok(!/const bal=Number\(/.test(inventory),'Inventory sufficiency avoids JS Number conversion');
ok(inventory.includes('as sufficient'),'Inventory sufficiency comparison executes in PostgreSQL NUMERIC');
ok(finance.includes("update payments set approval_instance_id=$2"),'Payment persists approval instance');
ok(finance.includes('count(distinct currency_id)::int as currency_count'),'Manual journal submit rejects mixed currencies');
ok(finance.includes("Manual journal must use exactly one currency"),'Manual journal creation rejects mixed currencies');

for(const t of ['material_requisitions','mr_lines','rfqs','rfq_vendors','vendor_quotations','comparative_statements','purchase_orders','po_lines','goods_receipt_notes','grn_lines','vendor_invoices','cost_transactions','budgets','permissions','approval_actions_log','boq_rate_buildup']){
 ok(new RegExp(`ALTER TABLE ${t}\\s+ADD COLUMN IF NOT EXISTS org_id`,'i').test(mig),`${t} owns org_id`);
}
ok(mig.includes('enforce_core_parent_tenant_integrity'),'Core parent tenant trigger exists');
ok(tenant.includes('tenantCriticalTables'),'Tenant checker explicitly covers relationship-owned core tables');

ok(projectsUi.includes("apiPost('/projects'"),'Projects UI can create projects');
ok(crmUi.includes("apiPost('/clients'"),'CRM UI can create clients');
ok(crmUi.includes('convert-to-tender'),'CRM UI can convert opportunity to tender');
for(const marker of ['/material-requisitions','/rfqs','/vendor-quotations','/purchase-orders','/grns','/vendor-invoices','/match']) ok(procurementUi.includes(marker),`Procurement UI covers ${marker}`);
for(const marker of ['/chart-of-accounts','/bank-accounts','/fiscal-periods','/exchange-rates','/payments','/manual-journals','/ipcs']) ok(financeUi.includes(marker),`Finance UI covers ${marker}`);
ok(routes.includes("'/reference-data'"),'Authenticated internal reference-data route is mounted');

const dockerB=read('backend/Dockerfile'),dockerF=read('frontend/Dockerfile'),run=read('scripts/run-local.sh');
ok(dockerB.includes('npm ci')&&dockerF.includes('npm ci'),'Docker builds use npm ci');
ok(dockerB.includes('package-lock.json')&&dockerF.includes('package-lock.json'),'Docker builds require lockfiles');
ok(run.includes('freeze-dependencies.sh')&&run.includes('check:immutable')&&run.includes('check:release'),'Local runner freezes, verifies and regresses before startup');

if(failures.length){console.error(`FINAL_HOSTILE_PRERUN_FAIL ${failures.length}`);process.exit(1)}
console.log('FINAL_HOSTILE_PRERUN_PASS');
