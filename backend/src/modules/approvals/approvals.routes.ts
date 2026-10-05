import { Router } from 'express';
import { z } from 'zod';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { AppError } from '../../middleware/errors.js';
import { authorize } from '../../middleware/authorize.js';
import { actOnApproval } from '../../services/approval.service.js';

export const approvalsRouter = Router();

approvalsRouter.get('/', authorize('approvals', 'view'), asyncHandler(async (_req, res) => {
  const rows = await query(`
    select ai.id, ai.org_id, ai.module, ai.record_id, ai.amount, ai.currency_id,
           ai.current_step, ai.status, ai.initiated_by, u.full_name as initiated_by_name,
           ai.initiated_at, ai.completed_at
    from approval_instances ai
    join users u on u.id = ai.initiated_by
    order by ai.initiated_at desc
    limit 200
  `);
  res.json({ success: true, data: rows });
}));

approvalsRouter.get('/:id', authorize('approvals', 'view'), asyncHandler(async (req, res) => {
  const approvalId = Number(req.params.id);
  if (!Number.isInteger(approvalId) || approvalId <= 0) throw new AppError(400, 'Invalid approval id');

  const approvalRows = await query(`
    select * from approval_instances where id = $1 limit 1
  `, [approvalId]);
  const approval = approvalRows[0];
  if (!approval) throw new AppError(404, 'Approval instance not found');

  const actions = await query(`
    select aal.*, u.full_name as approver_name
    from approval_actions_log aal
    join users u on u.id = aal.approver_id
    where aal.approval_instance_id = $1
    order by aal.action_date asc
  `, [approvalId]);

  res.json({ success: true, data: { approval, actions } });
}));

const actionSchema = z.object({
  action: z.enum(['approved', 'rejected', 'returned']),
  comment: z.string().max(1000).optional()
}).refine(b => b.action === 'approved' || (b.comment ?? '').trim().length >= 5, {
  message: 'A rejection or return must state its reason (comment, at least 5 characters)', path: ['comment']
});

approvalsRouter.post('/:id/actions', authorize('approvals', 'approve'), asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError(401, 'Authentication required');
  const body = actionSchema.parse(req.body);
  const approvalId = Number(req.params.id);
  if (!Number.isInteger(approvalId) || approvalId <= 0) throw new AppError(400, 'Invalid approval id');

  const client = await getClient();
  try {
    await client.query('begin');
    const result = await actOnApproval(client, approvalId, {
      actor_user_id: req.user.id,
      actor_role_id: req.user.role_id,
      action: body.action,
      comment: body.comment ?? null
    });
    await client.query('commit');
    res.json({ success: true, data: result });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

approvalsRouter.get('/configuration/doa', authorize('admin','view'), asyncHandler(async(req,res)=>{
 const rows=await query(`select d.*,r.role_name,c.code currency_code from delegation_of_authority d join roles r on r.id=d.approver_role_id left join currencies c on c.id=d.currency_id order by d.module,d.approval_level,d.min_amount`);
 res.json({success:true,data:rows});
}));
// G-004 (migration 040): DOA rules are drafted, confirmed by a different user, then immutable.
// Changes are made by a superseding draft; confirmed rules can only be retired. No thresholds are
// defaulted here: every amount is supplied by the tenant (constitution: no invented DOA values).
const doaDraft = z.object({
  module: z.string().trim().min(2).max(60),
  min_amount: z.number().nonnegative(), max_amount: z.number().positive().nullable().optional(),
  currency_id: z.number().int().positive().nullable().optional(), approval_level: z.number().int().positive().max(20),
  approver_role_id: z.number().int().positive(), is_active: z.boolean().default(true),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional()
});
const doaId = (v: string) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, 'Invalid DOA id'); return n; };
const checkRange = (b: { min_amount?: number; max_amount?: number | null }) => { if (b.max_amount != null && b.min_amount != null && b.max_amount <= b.min_amount) throw new AppError(400, 'max_amount must be greater than min_amount'); };

approvalsRouter.post('/configuration/doa', authorize('admin','manage'), asyncHandler(async(req,res)=>{
  const b = doaDraft.extend({ supersedes_id: z.number().int().positive().nullable().optional() }).parse(req.body); checkRange(b);
  if (b.supersedes_id) {
    const prev = (await query<any>(`select id,module,is_confirmed,is_active from delegation_of_authority where id=$1`, [b.supersedes_id]))[0];
    if (!prev) throw new AppError(404, 'Superseded DOA rule not found');
    if (!prev.is_confirmed || !prev.is_active) throw new AppError(409, 'Only an active confirmed rule can be superseded');
    if (prev.module !== b.module) throw new AppError(422, 'A superseding rule must be for the same module');
  }
  const [r] = await query(`insert into delegation_of_authority(org_id,module,min_amount,max_amount,currency_id,approval_level,approver_role_id,is_active,effective_from,effective_to,notes,created_by,last_edited_by,supersedes_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::date,current_date),$10,$11,$12,$12,$13) returning *`,
    [req.user!.org_id,b.module,b.min_amount,b.max_amount??null,b.currency_id??null,b.approval_level,b.approver_role_id,b.is_active,b.effective_from??null,b.effective_to??null,b.notes??null,req.user!.id,b.supersedes_id??null]);
  res.status(201).json({success:true,data:r});
}));

// Edit a draft (unconfirmed) rule. Kept on the original path for compatibility; confirmation moved to /confirm.
approvalsRouter.patch('/configuration/doa/:id', authorize('admin','manage'), asyncHandler(async(req,res)=>{
  const id = doaId(req.params.id);
  const b = doaDraft.omit({ module: true }).partial().extend({ confirm: z.boolean().optional() }).parse(req.body); checkRange(b);
  if (b.confirm) throw new AppError(422, 'Confirmation is a separate step by a different user: POST /approvals/configuration/doa/:id/confirm');
  const cur = (await query<any>(`select * from delegation_of_authority where id=$1`, [id]))[0];
  if (!cur) throw new AppError(404, 'DOA row not found');
  if (cur.is_confirmed) throw new AppError(409, 'Confirmed DOA rules are immutable; create a superseding draft or retire the rule');
  const keys = (Object.keys(b) as (keyof typeof b)[]).filter(k => k !== 'confirm' && b[k] !== undefined);
  if (!keys.length) throw new AppError(400, 'No fields to update');
  const sets = keys.map((k, i) => `${k}=$${i + 3}`).join(',');
  const [r] = await query(`update delegation_of_authority set ${sets},last_edited_by=$2,updated_at=now() where id=$1 returning *`, [id, req.user!.id, ...keys.map(k => b[k] ?? null)]);
  res.json({success:true,data:r});
}));

approvalsRouter.post('/configuration/doa/:id/confirm', authorize('admin','approve'), asyncHandler(async(req,res)=>{
  const id = doaId(req.params.id);
  const client = await getClient();
  try {
    await client.query('begin');
    const d = (await client.query(`select * from delegation_of_authority where id=$1 for update`, [id])).rows[0];
    if (!d) throw new AppError(404, 'DOA row not found');
    if (d.is_confirmed) throw new AppError(409, 'DOA rule is already confirmed');
    if (Number(d.created_by) === req.user!.id || Number(d.last_edited_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: a DOA rule must be confirmed by someone other than its creator or last editor');
    if (d.supersedes_id) {
      await client.query(`update delegation_of_authority set is_active=false,retired_by=$2,retired_at=now(),retired_reason=$3,updated_at=now() where id=$1 and is_confirmed and is_active`, [d.supersedes_id, req.user!.id, `superseded by DOA rule ${id}`]);
    }
    const r = (await client.query(`update delegation_of_authority set is_confirmed=true,confirmed_by=$2,confirmed_at=now(),updated_at=now() where id=$1 returning *`, [id, req.user!.id])).rows[0];
    await client.query('commit');
    res.json({success:true,data:r});
  } catch (e) { await client.query('rollback'); throw e; } finally { await releaseClient(client); }
}));

approvalsRouter.post('/configuration/doa/:id/retire', authorize('admin','approve'), asyncHandler(async(req,res)=>{
  const id = doaId(req.params.id);
  const b = z.object({ reason: z.string().trim().min(5).max(2000), effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body);
  const cur = (await query<any>(`select is_confirmed,is_active from delegation_of_authority where id=$1`, [id]))[0];
  if (!cur) throw new AppError(404, 'DOA row not found');
  if (!cur.is_active) throw new AppError(409, 'DOA rule is already inactive');
  const [r] = await query(`update delegation_of_authority set is_active=case when $3::date is null then false else is_active end,effective_to=coalesce($3::date,effective_to),retired_by=$2,retired_at=now(),retired_reason=$4,updated_at=now() where id=$1 returning *`, [id, req.user!.id, b.effective_to ?? null, b.reason]);
  res.json({success:true,data:r});
}));
