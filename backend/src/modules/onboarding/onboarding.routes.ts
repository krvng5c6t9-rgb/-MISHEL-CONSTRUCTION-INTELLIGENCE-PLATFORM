import { Router } from 'express';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import type { ApprovalModule } from '../../services/approval.service.js';

// G-003 / GC-31: tenant go-live readiness. Reports which tenant-owned configuration is still
// missing before transactions can run end-to-end. It never creates or defaults business values
// (chart of accounts, posting rules, DOA bands, periods are the tenant's decisions).
export const onboardingRouter = Router();

const APPROVAL_MODULES: ApprovalModule[] = ['purchase_order', 'vendor_invoice', 'material_requisition', 'comparative_statement', 'tender_submission', 'contract_signing', 'variation', 'ipc_submission', 'manual_journal_entry', 'payment', 'subcontract_signing', 'subcontract_certificate', 'payroll_run', 'equipment_usage'];
const GL_SOURCES = ['cost_transaction', 'ipc', 'payment'];

onboardingRouter.get('/readiness', authorize('admin', 'view'), asyncHandler(async (req, res) => {
  const org = req.user!.org_id;
  const one = async <T = any>(sql: string, p: unknown[] = []) => (await query<T>(sql, p))[0];
  const [org_, roles, users, coa, rules, doa, period, costCodes, banks, vendors] = await Promise.all([
    one(`select base_currency_id from organizations where id=$1`, [org]),
    one<{ n: number }>(`select count(*)::int n from roles where org_id=$1 and is_active`, [org]),
    one<{ n: number }>(`select count(*)::int n from users where org_id=$1 and is_active`, [org]),
    one<{ n: number }>(`select count(*)::int n from chart_of_accounts where org_id=$1 and is_active`, [org]),
    query<{ source_module: string }>(`select distinct source_module from gl_posting_rules where org_id=$1 and is_active and effective_from<=current_date and (effective_to is null or effective_to>=current_date)`, [org]),
    query<{ module: string }>(`select distinct module from delegation_of_authority where org_id=$1 and is_active and is_confirmed and approval_level=1 and effective_from<=current_date and (effective_to is null or effective_to>=current_date)`, [org]),
    one<{ n: number }>(`select count(*)::int n from fiscal_periods where org_id=$1 and status<>'closed' and current_date between start_date and end_date`, [org]),
    one<{ n: number }>(`select count(*)::int n from cost_codes where org_id=$1`, [org]),
    one<{ n: number }>(`select count(*)::int n from bank_accounts where org_id=$1`, [org]),
    one<{ n: number }>(`select count(*)::int n from vendors_subcontractors where org_id=$1 and is_active and prequalification_status='approved' and not is_blacklisted`, [org])
  ]);
  const ruleSet = new Set(rules.map(r => r.source_module));
  const doaSet = new Set(doa.map(d => d.module));
  const missingRules = GL_SOURCES.filter(s => !ruleSet.has(s));
  const missingDoa = APPROVAL_MODULES.filter(m => !doaSet.has(m));
  const items = [
    { key: 'base_currency', ready: Boolean(org_?.base_currency_id), detail: org_?.base_currency_id ? 'set' : 'organization has no base currency' },
    { key: 'roles', ready: roles.n > 1, detail: `${roles.n} active role(s); separate roles are needed for segregation of duties` },
    { key: 'users', ready: users.n > 1, detail: `${users.n} active user(s); maker/checker controls need at least two` },
    { key: 'chart_of_accounts', ready: coa.n > 0, detail: `${coa.n} active account(s)` },
    { key: 'gl_posting_rules', ready: missingRules.length === 0, detail: missingRules.length ? `missing active rules for: ${missingRules.join(', ')}` : 'all posting sources covered' },
    { key: 'doa_rules', ready: missingDoa.length === 0, detail: missingDoa.length ? `no confirmed level-1 DOA rule for: ${missingDoa.join(', ')}` : 'all approval modules covered', missing: missingDoa },
    { key: 'open_fiscal_period', ready: period.n > 0, detail: period.n ? 'an open period covers today' : 'no open fiscal period covers today' },
    { key: 'cost_codes', ready: costCodes.n > 0, detail: `${costCodes.n} cost code(s)` },
    { key: 'bank_accounts', ready: banks.n > 0, detail: `${banks.n} bank account(s)` },
    { key: 'qualified_vendors', ready: vendors.n > 0, detail: `${vendors.n} prequalified vendor(s)` }
  ];
  res.json({ success: true, data: { ready: items.every(i => i.ready), items } });
}));
