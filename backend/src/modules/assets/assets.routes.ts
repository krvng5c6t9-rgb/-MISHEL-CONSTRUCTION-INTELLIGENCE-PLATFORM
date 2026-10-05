import { Router } from 'express';
import { z } from 'zod';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { postEquipmentUsageToCostTransaction } from '../../services/phase5Posting.service.js';
import { createApprovalInstance } from '../../services/approval.service.js';
import { AppError } from '../../middleware/errors.js';

export const assetsRouter = Router();
assetsRouter.use(authorize('assets', 'view'));

assetsRouter.get('/equipment', asyncHandler(async (req, res) => {
  const rows = await query(`select ae.*, p.project_code, p.project_name from assets_equipment ae left join projects p on p.id=ae.current_project_id where ae.org_id=$1 order by ae.asset_code`, [req.user!.org_id]);
  res.json({ success: true, data: rows });
}));

assetsRouter.post('/equipment', authorize('assets', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ asset_code: z.string().min(1).max(30), asset_name: z.string().min(1).max(150), category: z.string().max(50).optional(), ownership_type: z.enum(['owned','rented']), acquisition_date: z.string().optional(), current_project_id: z.number().int().positive().optional(), status: z.enum(['available','in_use','maintenance','retired']).default('available') }).parse(req.body);
  const [created] = await query(`insert into assets_equipment (org_id, asset_code, asset_name, category, ownership_type, acquisition_date, current_project_id, status) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`, [req.user!.org_id, b.asset_code, b.asset_name, b.category ?? null, b.ownership_type, b.acquisition_date ?? null, b.current_project_id ?? null, b.status]);
  res.status(201).json({ success: true, data: created });
}));

assetsRouter.patch('/equipment/:id/status', authorize('assets', 'edit'), asyncHandler(async (req, res) => {
  const b = z.object({ status: z.enum(['available','in_use','maintenance','retired']), current_project_id: z.number().int().positive().optional() }).parse(req.body);
  const [updated] = await query(`update assets_equipment set status=$2, current_project_id=$3, updated_at=now() where id=$1 returning *`, [Number(req.params.id), b.status, b.current_project_id ?? null]);
  res.json({ success: true, data: updated ?? null });
}));

assetsRouter.get('/equipment-usage', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select eu.*, ae.asset_code, ae.asset_name, e.full_name as operator_name, cc.code as cost_code from equipment_usage eu join assets_equipment ae on ae.id=eu.asset_id left join employees e on e.id=eu.operator_id left join cost_codes cc on cc.id=eu.cost_code_id where ($1::bigint=0 or eu.project_id=$1) order by eu.usage_date desc, eu.id desc limit 300`, [projectId]);
  res.json({ success: true, data: rows });
}));

assetsRouter.post('/equipment-usage', authorize('assets', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ asset_id: z.number().int().positive(), project_id: z.number().int().positive(), usage_date: z.string().optional(), hours_used: z.number().positive(), operator_id: z.number().int().positive().optional(), cost_code_id: z.number().int().positive().optional(), currency_id: z.number().int().positive(), hourly_rate: z.number().nonnegative() }).parse(req.body);
  const [created] = await query(`insert into equipment_usage (asset_id, project_id, usage_date, hours_used, operator_id, cost_code_id, currency_id, hourly_rate) values ($1,$2,coalesce($3::date,current_date),$4,$5,$6,$7,$8) returning *`, [b.asset_id, b.project_id, b.usage_date ?? null, b.hours_used, b.operator_id ?? null, b.cost_code_id ?? null, b.currency_id, b.hourly_rate]);
  res.status(201).json({ success: true, data: created });
}));

assetsRouter.patch('/equipment-usage/:id/approve', authorize('assets', 'approve'), asyncHandler(async (req, res) => {
  const usageId = Number(req.params.id);
  if (!Number.isInteger(usageId) || usageId <= 0) throw new AppError(400, 'Invalid equipment usage id');
  const client = await getClient();
  try {
    await client.query('begin');
    const usage = (await client.query(`select * from equipment_usage where id=$1 for update`, [usageId])).rows[0];
    if (!usage) throw new AppError(404, 'Equipment usage not found');
    if (usage.status !== 'draft') throw new AppError(409, 'Only draft equipment usage can be submitted for approval');
    const approval = await createApprovalInstance(client, {
      org_id: req.user!.org_id, module: 'equipment_usage', record_id: usageId,
      amount: String(usage.cost_amount), currency_id: Number(usage.currency_id), initiated_by: req.user!.id
    });
    await client.query(`update equipment_usage set approval_instance_id=$2 where id=$1`, [usageId, approval.id]);
    await client.query('commit');
    res.json({ success: true, data: { approval } });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await releaseClient(client);
  }
}));

assetsRouter.post('/equipment-usage/:id/post-cost', authorize('finance', 'create'), asyncHandler(async (req, res) => {
  const client = await getClient();
  try {
    await client.query('begin');
    const result = await postEquipmentUsageToCostTransaction(client, Number(req.params.id));
    await client.query('commit');
    res.status(201).json({ success: true, data: result });
  } catch (err) { await client.query('rollback'); throw err; } finally { await releaseClient(client); }
}));

assetsRouter.get('/maintenance', asyncHandler(async (req, res) => {
  const rows = await query(`select ml.*, ae.asset_code, ae.asset_name from maintenance_log ml join assets_equipment ae on ae.id=ml.asset_id order by ml.maintenance_date desc limit 300`);
  res.json({ success: true, data: rows });
}));

assetsRouter.post('/maintenance', authorize('assets', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ asset_id: z.number().int().positive(), maintenance_date: z.string().optional(), type: z.enum(['preventive','breakdown']), cost: z.number().nonnegative().optional(), next_due_date: z.string().optional() }).parse(req.body);
  const [created] = await query(`insert into maintenance_log (asset_id, maintenance_date, type, cost, next_due_date) values ($1,coalesce($2::date,current_date),$3,$4,$5) returning *`, [b.asset_id, b.maintenance_date ?? null, b.type, b.cost ?? null, b.next_due_date ?? null]);
  res.status(201).json({ success: true, data: created });
}));
