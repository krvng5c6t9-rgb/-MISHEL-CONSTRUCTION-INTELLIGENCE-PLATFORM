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
approvalsRouter.patch('/configuration/doa/:id', authorize('admin','manage'), asyncHandler(async(req,res)=>{
 const b=z.object({min_amount:z.number().nonnegative(),max_amount:z.number().positive().nullable().optional(),currency_id:z.number().int().positive().nullable().optional(),approval_level:z.number().int().positive(),approver_role_id:z.number().int().positive(),is_active:z.boolean(),effective_from:z.string().optional(),effective_to:z.string().nullable().optional(),notes:z.string().nullable().optional(),confirm:z.boolean().default(false)}).parse(req.body);
 if(b.max_amount!=null&&b.max_amount<=b.min_amount)throw new AppError(400,'max_amount must be greater than min_amount');
 const rows=await query(`update delegation_of_authority set min_amount=$2,max_amount=$3,currency_id=$4,approval_level=$5,approver_role_id=$6,is_active=$7,effective_from=coalesce($8::date,effective_from),effective_to=$9,notes=$10,is_confirmed=$11,confirmed_by=case when $11 then $12 else null end,confirmed_at=case when $11 then now() else null end,updated_at=now() where id=$1 returning *`,[Number(req.params.id),b.min_amount,b.max_amount??null,b.currency_id??null,b.approval_level,b.approver_role_id,b.is_active,b.effective_from??null,b.effective_to??null,b.notes??null,b.confirm,req.user!.id]);
 if(!rows[0])throw new AppError(404,'DOA row not found');res.json({success:true,data:rows[0]});
}));
