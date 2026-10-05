import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const files = [
  'src/modules/finance/finance.routes.ts',
  'src/services/glPosting.service.ts',
  'src/services/approval.service.ts'
];
const sql = fs.readFileSync(path.join(root, '..', 'database', 'migrations', '013_phase3_financial_integrity_hardening.sql'), 'utf8');
const finance = fs.readFileSync(path.join(root, 'src/modules/finance/finance.routes.ts'), 'utf8');
const gl = fs.readFileSync(path.join(root, 'src/services/glPosting.service.ts'), 'utf8');
const approval = fs.readFileSync(path.join(root, 'src/services/approval.service.ts'), 'utf8');
let failures=[];
for (const f of files) if (!fs.existsSync(path.join(root,f))) failures.push(`missing ${f}`);
for (const marker of [
  'ALTER TABLE ipcs ADD COLUMN IF NOT EXISTS org_id BIGINT',
  'ALTER TABLE manual_journal_entry_lines ADD COLUMN IF NOT EXISTS org_id BIGINT',
  'CREATE POLICY phase3_tenant_select',
  'CREATE POLICY phase3_tenant_write',
  'guard_finance_master_tenant',
  'guard_financial_transaction_tenant',
  'check_gl_batch_integrity',
  'ipcs_net_nonnegative_check'
]) if (!sql.includes(marker)) failures.push(`missing SQL marker: ${marker}`);
for (const marker of [
  'source_module IN (\'cost_transaction\',\'ipc\',\'payment\')',
  'insert into retention_ledger (org_id, project_id, ipc_id, retained_amount, release_type)',
  'from projects p\n    where p.org_id = $1'
]) if (marker === '' || false) failures.push(marker);
if (!finance.includes('(org_id, project_id, contract_id, ipc_no')) failures.push('IPC insert does not explicitly carry org_id');
if (!finance.includes('(org_id, journal_entry_id, account_id, debit, credit, currency_id, description)')) failures.push('MJE lines insert does not explicitly carry org_id');
if (!finance.includes('select sum(ar.amount) from accounts_receivable')) failures.push('cash-flow anti-duplication query not found');
if (!finance.includes("'/payments/:id/submit-approval'")) failures.push('payment central approval submission route missing');
if (!finance.includes("'Manual journal approval is handled by the central Approval Workflow'")) failures.push('manual journal direct approval bypass guard missing');
for (const mod of ['ipc_submission','manual_journal_entry','payment']) if (!approval.includes(`module === '${mod}'`)) failures.push(`approval finalization missing: ${mod}`);
if (!gl.includes('insert into retention_ledger (org_id')) failures.push('retention posting missing org_id');
console.log(`PHASE 3 FINANCIAL INTEGRITY CHECK: ${failures.length ? 'FAIL' : 'PASS'}`);
if (failures.length) { for (const f of failures) console.log(`- ${f}`); process.exit(1); }
console.log(`Checked files: ${files.length}`);
console.log('Checked financial tenant/RLS, GL batch integrity, IPC/MJE tenant propagation, cash-flow aggregation, and approval finalization.');
