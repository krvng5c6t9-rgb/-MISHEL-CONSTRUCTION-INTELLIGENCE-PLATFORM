import { Router } from 'express';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

export const runtimeValidationRouter = Router();
runtimeValidationRouter.use(authorize('system', 'view'));

const requiredTables = [
  'organizations','users','roles','permissions','projects','project_boq','cost_codes','cost_transactions',
  'material_requisitions','rfqs','vendor_quotations','comparative_statements','purchase_orders','vendor_invoices',
  'chart_of_accounts','gl_posting_rules','general_ledger','ipcs','accounts_payable','accounts_receivable','payments',
  'drawings','submittals','rfis','method_statements','schedule_activities','progress_updates','site_diary','quantity_sheets','punch_lists',
  'attendance','payroll_runs','assets_equipment','equipment_usage','inspection_checklists','ncrs','incidents','permits_to_work','document_registers',
  'client_portal_access','subcontractor_portal_access'
];

const requiredViews = [
  'v_cost_control_summary','v_boq_vs_actual','v_ar_aging','v_ap_aging','v_portfolio_summary','v_tender_win_loss','v_procurement_cycle_time'
];

runtimeValidationRouter.get('/schema-health', asyncHandler(async (_req, res) => {
  const tableRows = await query<{ table_name: string }>(`
    select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
  `);
  const viewRows = await query<{ table_name: string }>(`
    select table_name from information_schema.views where table_schema='public'
  `);
  const existingTables = new Set(tableRows.map(r => r.table_name));
  const existingViews = new Set(viewRows.map(r => r.table_name));
  const missingTables = requiredTables.filter(t => !existingTables.has(t));
  const missingViews = requiredViews.filter(v => !existingViews.has(v));
  res.json({ success: true, data: {
    status: missingTables.length || missingViews.length ? 'failed' : 'passed',
    checked_tables: requiredTables.length,
    checked_views: requiredViews.length,
    missing_tables: missingTables,
    missing_views: missingViews
  }});
}));

runtimeValidationRouter.get('/posting-readiness', asyncHandler(async (req, res) => {
  const rows = await query(`
    select p.id as project_id, p.project_name,
      (select count(*) from gl_posting_rules g where g.org_id=p.org_id and g.is_active=true)::int as active_gl_rules,
      (select count(*) from delegation_of_authority d where d.org_id=p.org_id and d.is_active=true)::int as active_doa_rows,
      (select count(*) from approval_workflow_steps s where s.org_id=p.org_id)::int as workflow_steps,
      (select count(*) from chart_of_accounts c where c.org_id=p.org_id and c.is_active=true)::int as active_accounts
    from projects p
    where p.org_id=$1
    order by p.project_name
  `, [req.user!.org_id]);
  res.json({ success: true, data: rows });
}));
