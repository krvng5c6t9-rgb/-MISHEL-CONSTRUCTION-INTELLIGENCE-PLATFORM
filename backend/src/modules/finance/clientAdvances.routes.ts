import { Router } from 'express';
import { z } from 'zod';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

// Stage 21 (GC-13 step 3, F-32, migration 070): client advance payments received under the contract and the advance
// position used when preparing an IPC. Limits and recovery rules are enforced by the database (trg_ipc_deductions).
export const clientAdvancesRouter = Router();
clientAdvancesRouter.use(authorize('finance', 'view'));

const pid = (v: string) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, 'Invalid id'); return n; };
async function advance(advanceId: number, orgId: number) {
  const [a] = await query<any>(`select * from client_advances where id = $1 and org_id = $2`, [advanceId, orgId]);
  if (!a) throw new AppError(404, 'Client advance not found');
  return a;
}

clientAdvancesRouter.post('/client-advances', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ contract_id: z.number().int().positive(), amount: z.number().positive(), recovery_percent: z.number().positive().max(100).optional(), guarantee_ref: z.string().trim().min(3).max(100).optional() }).parse(req.body);
  const [a] = await query(`insert into client_advances(org_id, contract_id, amount, recovery_percent, guarantee_ref, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
    [req.user!.org_id, b.contract_id, b.amount, b.recovery_percent ?? null, b.guarantee_ref ?? null, req.user!.id]);
  res.status(201).json({ success: true, data: a });
}));
clientAdvancesRouter.get('/client-advances', asyncHandler(async (req, res) => {
  const q = z.object({ contract_id: z.coerce.number().int().positive() }).parse(req.query);
  res.json({ success: true, data: await query(`select * from client_advances where org_id = $1 and contract_id = $2 order by id`, [req.user!.org_id, q.contract_id]) });
}));
clientAdvancesRouter.post('/client-advances/:id/approve', authorize('finance', 'approve'), asyncHandler(async (req, res) => {
  const a = await advance(pid(req.params.id), req.user!.org_id);
  if (Number(a.created_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: a client advance is approved by someone other than its preparer');
  if (a.status !== 'draft') throw new AppError(409, 'Only a draft client advance can be approved');
  // Stage 30 / DEC-009 (migration 079): approval opens the advance request receivable (no GL of its own); the advance is
  // received only when receipts posted against it settle it, crediting the client advances liability.
  const client = await getClient();
  try {
    await client.query('begin');
    const k = (await client.query(`select k.client_id, k.project_id, k.currency_id from client_advances a join contracts k on k.id = a.contract_id where a.id = $1 for update of a`, [a.id])).rows[0];
    const ar = (await client.query(`insert into accounts_receivable (org_id, client_id, project_id, source_type, source_record_id, amount, currency_id)
      values ($1,$2,$3,'client_advance',$4,$5,$6) returning *`, [a.org_id, k.client_id, k.project_id, a.id, a.amount, k.currency_id])).rows[0];
    const r = (await client.query(`update client_advances set status = 'approved', approved_by = $2, approved_at = now(), receivable_id = $3 where id = $1 and status = 'draft' returning *`, [a.id, req.user!.id, ar.id])).rows[0];
    if (!r) throw new AppError(409, 'Only a draft client advance can be approved');
    await client.query('commit');
    res.json({ success: true, data: { ...r, accounts_receivable: ar } });
  } catch (e) { await client.query('rollback'); throw e; } finally { await releaseClient(client); }
}));
clientAdvancesRouter.post('/client-advances/:id/received', authorize('finance', 'post'), asyncHandler(async (req, res) => {
  const a = await advance(pid(req.params.id), req.user!.org_id);
  throw new AppError(409, a.receivable_id
    ? `A client advance is received through Finance receipts against its receivable ${a.receivable_id}; it is marked received when that receivable is settled`
    : 'Only an approved client advance can be received, through Finance receipts against its receivable');
}));

// --- Client retention (DEC-009): held per IPC as a conditional contract asset; released against the taking-over /
// defects certificate into its own receivable, then collected through receipts.
clientAdvancesRouter.get('/retentions', asyncHandler(async (req, res) => {
  const q = z.object({ contract_id: z.coerce.number().int().positive() }).parse(req.query);
  res.json({ success: true, data: await query(`select r.*, i.ipc_no from retention_ledger r join ipcs i on i.id = r.ipc_id
    where r.org_id = $1 and i.contract_id = $2 order by r.id`, [req.user!.org_id, q.contract_id]) });
}));
clientAdvancesRouter.post('/retentions/:id/release', authorize('finance', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ reason: z.string().trim().min(10), reference: z.string().trim().min(3).max(100) }).parse(req.body);
  const client = await getClient();
  try {
    await client.query('begin');
    const r = (await client.query(`select r.*, i.prepared_by, k.client_id, k.project_id as contract_project_id, k.currency_id from retention_ledger r
      join ipcs i on i.id = r.ipc_id join contracts k on k.id = i.contract_id where r.id = $1 and r.org_id = $2 for update of r`, [pid(req.params.id), req.user!.org_id])).rows[0];
    if (!r) throw new AppError(404, 'Retention not found');
    if (r.release_status !== 'held') throw new AppError(409, 'Retention is already released');
    if (Number(r.prepared_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: the IPC preparer cannot release its retention');
    const ar = (await client.query(`insert into accounts_receivable (org_id, client_id, project_id, source_type, source_record_id, amount, currency_id)
      values ($1,$2,$3,'retention_release',$4,$5,$6) returning *`, [r.org_id, r.client_id, r.contract_project_id, r.id, r.retained_amount, r.currency_id])).rows[0];
    const [u] = (await client.query(`update retention_ledger set release_status = 'released', release_date = current_date, release_reason = $2, release_reference = $3,
      released_by = $4, released_at = now(), release_receivable_id = $5 where id = $1 returning *`, [r.id, b.reason, b.reference, req.user!.id, ar.id])).rows;
    await client.query('commit');
    res.json({ success: true, data: { retention: u, accounts_receivable: ar } });
  } catch (e) { await client.query('rollback'); throw e; } finally { await releaseClient(client); }
}));
clientAdvancesRouter.get('/contracts/:id/receivable-position', asyncHandler(async (req, res) => {
  const [r] = await query<any>(`select contract_receivable_position(id) as position from contracts where id = $1 and org_id = $2`, [pid(req.params.id), req.user!.org_id]);
  if (!r) throw new AppError(404, 'Contract not found');
  res.json({ success: true, data: r.position });
}));
clientAdvancesRouter.get('/contracts/:id/advance-position', asyncHandler(async (req, res) => {
  const [r] = await query<any>(`select client_advance_position(id) as position from contracts where id = $1 and org_id = $2`, [pid(req.params.id), req.user!.org_id]);
  if (!r) throw new AppError(404, 'Contract not found');
  res.json({ success: true, data: r.position });
}));
