import { Router } from 'express';
import { z } from 'zod';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

// Stage 34 / GC-24 / DEC-019 (migration 082): go-live cut-over. The preparer loads the opening trial balance, opening
// receivables and payables, and in-flight contract / subcontract positions; the database reconciles every control account
// to its detail; someone else approves, which posts the opening journal and creates the opening receivables / payables.
export const cutoverRouter = Router();
cutoverRouter.use(authorize('finance', 'view'));

const pid = (v: string) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, 'Invalid id'); return n; };
const id = z.number().int().positive();
const money = z.number().nonnegative();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
async function plan(planId: number, orgId: number) {
  const [p] = await query<any>(`select * from cutover_plans where id = $1 and org_id = $2`, [planId, orgId]);
  if (!p) throw new AppError(404, 'Cut-over plan not found');
  return p;
}

// Detail sections: each takes an array of rows and inserts them in one transaction (all or nothing).
const sections = {
  'tb-lines': { table: 'cutover_tb_lines', schema: z.object({ account_id: id, debit: money.default(0), credit: money.default(0), note: z.string().max(500).optional() }),
    cols: ['account_id', 'debit', 'credit', 'note'] },
  receivables: { table: 'cutover_receivables', schema: z.object({ client_id: id, project_id: id, contract_id: id.optional(), reference: z.string().trim().min(2).max(100), amount: z.number().positive(), due_date: isoDate.optional(), gl_account_id: id }),
    cols: ['client_id', 'project_id', 'contract_id', 'reference', 'amount', 'due_date', 'gl_account_id'] },
  payables: { table: 'cutover_payables', schema: z.object({ vendor_id: id, project_id: id.optional(), subcontract_id: id.optional(), reference: z.string().trim().min(2).max(100), amount: z.number().positive(), due_date: isoDate.optional(), gl_account_id: id }),
    cols: ['vendor_id', 'project_id', 'subcontract_id', 'reference', 'amount', 'due_date', 'gl_account_id'] },
  'contract-positions': { table: 'cutover_contract_positions', schema: z.object({ contract_id: id, certified_gross_to_date: money.default(0), retention_held: money.default(0), advances_received: money.default(0), advance_recovered: money.default(0),
      cost_to_date: money.default(0), eac: z.number().positive().optional(), revenue_recognised_to_date: money.default(0), source_reference: z.string().trim().min(3).max(200) }),
    cols: ['contract_id', 'certified_gross_to_date', 'retention_held', 'advances_received', 'advance_recovered', 'cost_to_date', 'eac', 'revenue_recognised_to_date', 'source_reference'] },
  'subcontract-positions': { table: 'cutover_subcontract_positions', schema: z.object({ subcontract_id: id, certified_gross_to_date: money.default(0), retention_held: money.default(0), advance_paid: money.default(0), advance_recovered: money.default(0),
      source_reference: z.string().trim().min(3).max(200) }),
    cols: ['subcontract_id', 'certified_gross_to_date', 'retention_held', 'advance_paid', 'advance_recovered', 'source_reference'] }
} as const;

cutoverRouter.post('/cutover-plans', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ cutover_date: isoDate }).parse(req.body);
  const [p] = await query(`insert into cutover_plans(org_id, cutover_date, prepared_by) values ($1, $2::date, $3) returning *`, [req.user!.org_id, b.cutover_date, req.user!.id]);
  res.status(201).json({ success: true, data: p });
}));
cutoverRouter.get('/cutover-plans', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await query(`select * from cutover_plans where org_id = $1 order by id desc`, [req.user!.org_id]) });
}));
cutoverRouter.get('/cutover-plans/:id', asyncHandler(async (req, res) => {
  const p = await plan(pid(req.params.id), req.user!.org_id);
  const detail: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(sections)) detail[k] = await query(`select * from ${s.table} where plan_id = $1 order by id`, [p.id]);
  res.json({ success: true, data: { plan: p, ...detail } });
}));
for (const [path, s] of Object.entries(sections)) {
  cutoverRouter.post(`/cutover-plans/:id/${path}`, authorize('finance', 'manage'), asyncHandler(async (req, res) => {
    const rows = z.array(s.schema).min(1).max(5000).parse(req.body?.rows);
    const p = await plan(pid(req.params.id), req.user!.org_id);
    const client = await getClient();
    try {
      await client.query('begin');
      const out = [];
      for (const r of rows as Record<string, unknown>[]) {
        const vals = s.cols.map(c => r[c] ?? null);
        out.push((await client.query(`insert into ${s.table}(org_id, plan_id, ${s.cols.join(', ')}) values ($1, $2, ${s.cols.map((_, i) => `$${i + 3}`).join(', ')}) returning *`,
          [p.org_id, p.id, ...vals])).rows[0]);
      }
      await client.query('commit');
      res.status(201).json({ success: true, data: out });
    } catch (e) { await client.query('rollback'); throw e; } finally { await releaseClient(client); }
  }));
  cutoverRouter.delete(`/cutover-plans/:id/${path}/:rowId`, authorize('finance', 'manage'), asyncHandler(async (req, res) => {
    const p = await plan(pid(req.params.id), req.user!.org_id);
    const rows = await query(`delete from ${s.table} where id = $1 and plan_id = $2 returning id`, [pid(req.params.rowId), p.id]);
    if (!rows[0]) throw new AppError(404, 'Line not found');
    res.json({ success: true, data: rows[0] });
  }));
}

// Reconcile: the report is computed by the database; a clean report moves the plan to 'reconciled' (frozen with a hash).
cutoverRouter.post('/cutover-plans/:id/reconcile', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const p = await plan(pid(req.params.id), req.user!.org_id);
  if (p.status !== 'draft') throw new AppError(409, `Cut-over plan is ${p.status}`);
  const [r] = await query<any>(`select cutover_reconciliation($1) as report`, [p.id]);
  if (r.report.clean) {
    // The frozen report and its hash are taken from the database text form, so approval can compare them exactly.
    const [u] = await query(`update cutover_plans set status = 'reconciled', reconciliation = cutover_reconciliation($1), reconciled_at = now(),
      reconciliation_sha256 = encode(sha256(convert_to(cutover_reconciliation($1)::text, 'UTF8')), 'hex') where id = $1 and status = 'draft' returning *`, [p.id]);
    res.json({ success: true, data: { plan: u, report: r.report } });
    return;
  }
  res.status(422).json({ success: false, error: 'The opening balances do not reconcile; see the differences', data: { report: r.report } });
}));
cutoverRouter.get('/cutover-plans/:id/reconciliation', asyncHandler(async (req, res) => {
  const p = await plan(pid(req.params.id), req.user!.org_id);
  const [r] = await query<any>(`select cutover_reconciliation($1) as report`, [p.id]);
  res.json({ success: true, data: r.report });
}));
cutoverRouter.post('/cutover-plans/:id/reopen', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const p = await plan(pid(req.params.id), req.user!.org_id);
  if (p.status !== 'reconciled') throw new AppError(409, 'Only a reconciled plan can be reopened for correction');
  const [u] = await query(`update cutover_plans set status = 'draft' where id = $1 returning *`, [p.id]);
  res.json({ success: true, data: u });
}));
cutoverRouter.post('/cutover-plans/:id/cancel', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const p = await plan(pid(req.params.id), req.user!.org_id);
  if (p.status !== 'draft') throw new AppError(409, 'Only a draft plan can be cancelled');
  const [u] = await query(`update cutover_plans set status = 'cancelled' where id = $1 returning *`, [p.id]);
  res.json({ success: true, data: u });
}));

// Approve: someone other than the preparer; the reconciliation is recomputed and must equal the frozen one; the opening
// journal posts as one balanced batch on the cut-over date and the opening receivables / payables are created.
cutoverRouter.post('/cutover-plans/:id/approve', authorize('finance', 'approve'), asyncHandler(async (req, res) => {
  const client = await getClient();
  try {
    await client.query('begin');
    const p = (await client.query(`select cp.*, o.base_currency_id, to_char(cp.cutover_date, 'YYYY-MM-DD') as cutover_text from cutover_plans cp join organizations o on o.id = cp.org_id
      where cp.id = $1 and cp.org_id = $2 for update of cp`, [pid(req.params.id), req.user!.org_id])).rows[0];
    if (!p) throw new AppError(404, 'Cut-over plan not found');
    if (p.status !== 'reconciled') throw new AppError(409, 'Only a reconciled plan can be approved');
    if (Number(p.prepared_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: the preparer cannot approve the opening balances');
    const again = (await client.query(`select cutover_reconciliation($1) as report, encode(sha256(convert_to(cutover_reconciliation($1)::text, 'UTF8')), 'hex') as h`, [p.id])).rows[0];
    if (!again.report.clean || again.h !== p.reconciliation_sha256) throw new AppError(409, 'The opening balances changed since they were reconciled; reconcile again');
    const batch = Number((await client.query(`select nextval('gl_journal_batch_seq')::bigint as b`)).rows[0].b);
    await client.query(`insert into general_ledger(org_id, project_id, account_id, transaction_date, debit, credit, currency_id, source_module, source_table, source_record_id, journal_batch_id, description)
      select org_id, null, account_id, $2::date, debit, credit, $3, 'opening_balance', 'cutover_plans', plan_id, $4, coalesce(note, 'Opening balance') from cutover_tb_lines where plan_id = $1 order by id`,
      [p.id, p.cutover_text, p.base_currency_id, batch]);
    const ar = (await client.query(`with ins as (insert into accounts_receivable(org_id, client_id, project_id, source_type, source_record_id, amount, currency_id, due_date)
        select org_id, client_id, project_id, 'opening', id, amount, $2, due_date from cutover_receivables where plan_id = $1 returning id, source_record_id)
      update cutover_receivables c set receivable_id = ins.id from ins where c.id = ins.source_record_id returning c.id`, [p.id, p.base_currency_id])).rowCount;
    const ap = (await client.query(`with ins as (insert into accounts_payable(org_id, vendor_id, project_id, source_type, source_record_id, amount, currency_id, due_date)
        select org_id, vendor_id, project_id, 'opening', id, amount, $2, due_date from cutover_payables where plan_id = $1 returning id, source_record_id)
      update cutover_payables c set payable_id = ins.id from ins where c.id = ins.source_record_id returning c.id`, [p.id, p.base_currency_id])).rowCount;
    const [u] = (await client.query(`update cutover_plans set status = 'opened', approved_by = $2, approved_at = now(), gl_batch_id = $3 where id = $1 returning *`, [p.id, req.user!.id, batch])).rows;
    await client.query('commit');
    res.json({ success: true, data: { plan: u, gl_batch_id: batch, receivables_created: ar, payables_created: ap } });
  } catch (e) { await client.query('rollback'); throw e; } finally { await releaseClient(client); }
}));
