import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
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
  const [r] = await query(`update client_advances set status = 'approved', approved_by = $2, approved_at = now() where id = $1 returning *`, [a.id, req.user!.id]);
  res.json({ success: true, data: r });
}));
clientAdvancesRouter.post('/client-advances/:id/received', authorize('finance', 'post'), asyncHandler(async (req, res) => {
  const b = z.object({ receipt_reference: z.string().trim().min(3).max(100) }).parse(req.body);
  const a = await advance(pid(req.params.id), req.user!.org_id);
  if (Number(a.created_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: the preparer cannot record the advance as received');
  if (a.status !== 'approved') throw new AppError(409, 'Only an approved client advance can be recorded as received');
  const [r] = await query(`update client_advances set status = 'received', received_by = $2, received_at = now(), receipt_reference = $3 where id = $1 returning *`, [a.id, req.user!.id, b.receipt_reference]);
  res.json({ success: true, data: r });
}));
clientAdvancesRouter.get('/contracts/:id/advance-position', asyncHandler(async (req, res) => {
  const [r] = await query<any>(`select client_advance_position(id) as position from contracts where id = $1 and org_id = $2`, [pid(req.params.id), req.user!.org_id]);
  if (!r) throw new AppError(404, 'Contract not found');
  res.json({ success: true, data: r.position });
}));
