import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

export const costTransactionsRouter = Router();

costTransactionsRouter.use(authorize('cost_control', 'view'));

costTransactionsRouter.get('/', asyncHandler(async (req, res) => {
  const projectId = req.query.project_id ? Number(req.query.project_id) : null;
  const rows = await query(`
    select ct.id, ct.project_id, p.project_code, ct.cost_code_id, cc.code as cost_code,
           ct.source_module, ct.source_table, ct.source_record_id,
           ct.transaction_type, ct.amount, cur.code as currency_code, ct.transaction_date,
           ct.description, ct.is_posted_to_gl, ct.created_at
    from cost_transactions ct
    join projects p on p.id = ct.project_id
    join cost_codes cc on cc.id = ct.cost_code_id
    join currencies cur on cur.id = ct.currency_id
    where ($1::bigint is null or ct.project_id = $1)
    order by ct.created_at desc
    limit 200
  `, [projectId]);
  res.json({ success: true, data: rows });
}));


costTransactionsRouter.get('/forecasts/list',asyncHandler(async(req,res)=>{const projectId=Number(req.query.project_id||0);const rows=await query(`select f.*,c.code cost_code from cost_forecasts f join cost_codes c on c.id=f.cost_code_id where ($1::bigint=0 or f.project_id=$1) order by forecast_date desc,f.id desc`,[projectId]);res.json({success:true,data:rows});}));
costTransactionsRouter.post('/forecasts',authorize('cost_control','manage'),asyncHandler(async(req,res)=>{const b=z.object({project_id:z.number().int().positive(),cost_code_id:z.number().int().positive(),forecast_date:z.string().optional(),estimate_to_complete:z.number().nonnegative(),estimate_at_completion:z.number().nonnegative(),variance_reason:z.string().optional().nullable()}).parse(req.body);const [r]=await query(`insert into cost_forecasts(org_id,project_id,cost_code_id,forecast_date,estimate_to_complete,estimate_at_completion,variance_reason,prepared_by) values($1,$2,$3,coalesce($4::date,current_date),$5,$6,$7,$8) returning *`,[req.user!.org_id,b.project_id,b.cost_code_id,b.forecast_date??null,b.estimate_to_complete,b.estimate_at_completion,b.variance_reason??null,req.user!.id]);res.status(201).json({success:true,data:r});}));

// CC-035 (NDC-011): approved budgets, reproducible cost snapshots (inputs captured from the ledger), reconciliation.
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const posId = (v: unknown) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new AppError(400, 'Invalid id'); return n; };
costTransactionsRouter.post('/budgets', authorize('cost_control', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ project_id: z.number().int().positive(), cost_code_id: z.number().int().positive(), budget_type: z.enum(['original', 'revised']), amount: z.number().nonnegative() }).parse(req.body);
  const [r] = await query(`insert into budgets(org_id,project_id,cost_code_id,budget_type,amount,created_by) values($1,$2,$3,$4,$5,$6) returning *`, [req.user!.org_id, b.project_id, b.cost_code_id, b.budget_type, String(b.amount), req.user!.id]);
  res.status(201).json({ success: true, data: r });
}));
costTransactionsRouter.post('/budgets/:id/approve', authorize('cost_control', 'approve'), asyncHandler(async (req, res) => {
  const rows = await query(`update budgets set approved_by=$2, approval_date=current_date where id=$1 and org_id=$3 and approved_by is null returning *`, [posId(req.params.id), req.user!.id, req.user!.org_id]);
  if (!rows[0]) { const ex = await query(`select 1 from budgets where id=$1 and org_id=$2`, [posId(req.params.id), req.user!.org_id]); throw new AppError(ex[0] ? 409 : 404, ex[0] ? 'Budget already approved' : 'Budget not found'); }
  res.json({ success: true, data: rows[0] });
}));
costTransactionsRouter.get('/control-summary', asyncHandler(async (req, res) => {
  const projectId = posId(req.query.project_id);
  res.json({ success: true, data: await query(`select v.* from v_cost_control_summary v join projects p on p.id=v.project_id where p.org_id=$1 and v.project_id=$2 order by v.code`, [req.user!.org_id, projectId]) });
}));
costTransactionsRouter.get('/snapshots', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await query(`select * from cost_forecast_snapshots where org_id=$1 and project_id=$2 order by as_of desc, id desc`, [req.user!.org_id, posId(req.query.project_id)]) });
}));
costTransactionsRouter.post('/snapshots', authorize('cost_control', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ project_id: z.number().int().positive(), cost_code_id: z.number().int().positive(), as_of: isoDay, etc_method: z.enum(['manual', 'budget_remaining']), etc_amount: z.number().nonnegative().optional(), etc_basis: z.string().trim().max(4000).optional() })
    .refine(v => v.etc_method !== 'manual' || (v.etc_amount != null && (v.etc_basis ?? '').length >= 10), { message: 'Manual ETC needs an amount and a basis (at least 10 characters)', path: ['etc_basis'] }).parse(req.body);
  const [r] = await query(`insert into cost_forecast_snapshots(org_id,project_id,cost_code_id,as_of,budget,committed,actual,accrual,etc_method,etc_amount,etc_basis,prepared_by) values($1,$2,$3,$4,0,0,0,0,$5,$6,$7,$8) returning *`,
    [req.user!.org_id, b.project_id, b.cost_code_id, b.as_of, b.etc_method, String(b.etc_amount ?? 0), b.etc_basis ?? null, req.user!.id]);
  res.status(201).json({ success: true, data: r });
}));
costTransactionsRouter.post('/snapshots/:id/approve', authorize('cost_control', 'approve'), asyncHandler(async (req, res) => {
  const rows = await query(`update cost_forecast_snapshots set approved_by=$2, approved_at=now() where id=$1 and org_id=$3 and approved_by is null returning *`, [posId(req.params.id), req.user!.id, req.user!.org_id]);
  if (!rows[0]) { const ex = await query(`select 1 from cost_forecast_snapshots where id=$1 and org_id=$2`, [posId(req.params.id), req.user!.org_id]); throw new AppError(ex[0] ? 409 : 404, ex[0] ? 'Snapshot already approved' : 'Snapshot not found'); }
  res.json({ success: true, data: rows[0] });
}));
// Recompute every input from the ledger as of the snapshot date; any difference is listed, never silently absorbed.
costTransactionsRouter.get('/snapshots/:id/reconcile', asyncHandler(async (req, res) => {
  const s = (await query<any>(`select * from cost_forecast_snapshots where id=$1 and org_id=$2`, [posId(req.params.id), req.user!.org_id]))[0];
  if (!s) throw new AppError(404, 'Snapshot not found');
  const [now] = await query<any>(`select coalesce(sum(amount) filter (where transaction_type='committed'),0)::numeric(18,2) as committed, coalesce(sum(amount) filter (where transaction_type='actual'),0)::numeric(18,2) as actual,
      cost_accrual_as_of($1,$2,$3::date) as accrual from cost_transactions where project_id=$1 and cost_code_id=$2 and transaction_date <= $3::date`, [s.project_id, s.cost_code_id, s.as_of]);
  const [diff] = await query<any>(`select ($1::numeric-$2::numeric)::numeric(18,2) as committed, ($3::numeric-$4::numeric)::numeric(18,2) as actual, ($5::numeric-$6::numeric)::numeric(18,2) as accrual, ($1::numeric<>$2::numeric or $3::numeric<>$4::numeric or $5::numeric<>$6::numeric) as unexplained`, [now.committed, s.committed, now.actual, s.actual, now.accrual, s.accrual]);
  const late = await query(`select id, transaction_type, amount, transaction_date, created_at, source_module from cost_transactions where project_id=$1 and cost_code_id=$2 and transaction_date <= $3::date and created_at > $4::timestamptz order by id`, [s.project_id, s.cost_code_id, s.as_of, s.created_at]);
  const unexplained = diff.unexplained === true;
  res.json({ success: true, data: { snapshot_id: s.id, as_of: s.as_of, stored: { committed: s.committed, actual: s.actual, accrual: s.accrual, eac: s.eac }, recomputed: now, difference: { committed: diff.committed, actual: diff.actual, accrual: diff.accrual }, unexplained, backdated_postings: late } });
}));
