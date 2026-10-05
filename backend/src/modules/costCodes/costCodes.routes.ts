import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { AppError } from '../../middleware/errors.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

export const costCodesRouter = Router();

costCodesRouter.use(authorize('cost_control', 'view'));

costCodesRouter.get('/', asyncHandler(async (req, res) => {
  const projectId = req.query.project_id ? Number(req.query.project_id) : null;
  const rows = await query(`
    select id, org_id, project_id, code, description, parent_code_id, cost_type, unit_of_measure, is_active
    from cost_codes
    where ($1::bigint is null or project_id = $1)
    order by code
  `, [projectId]);
  res.json({ success: true, data: rows });
}));

// G-014 (migration 042): tenants maintain their own cost-code structure; no codes are defaulted.
const costType = z.enum(['labor', 'material', 'equipment', 'subcontract', 'overhead', 'preliminaries']);
const ccBody = z.object({
  code: z.string().trim().min(1).max(30), description: z.string().trim().min(2).max(255), cost_type: costType,
  unit_of_measure: z.string().trim().max(20).nullable().optional(), parent_code_id: z.number().int().positive().nullable().optional(),
  project_id: z.number().int().positive().nullable().optional()
});
costCodesRouter.post('/', authorize('cost_control', 'manage'), asyncHandler(async (req, res) => {
  const b = ccBody.parse(req.body);
  const [r] = await query(`insert into cost_codes(org_id,project_id,code,description,parent_code_id,cost_type,unit_of_measure) values($1,$2,$3,$4,$5,$6,$7) returning *`,
    [req.user!.org_id, b.project_id ?? null, b.code, b.description, b.parent_code_id ?? null, b.cost_type, b.unit_of_measure ?? null]);
  res.status(201).json({ success: true, data: r });
}));
costCodesRouter.patch('/:id', authorize('cost_control', 'manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(400, 'Invalid cost code id');
  const b = ccBody.omit({ project_id: true }).partial().extend({ is_active: z.boolean().optional() }).parse(req.body);
  const keys = (Object.keys(b) as (keyof typeof b)[]).filter(k => b[k] !== undefined);
  if (!keys.length) throw new AppError(400, 'No fields to update');
  const rows = await query(`update cost_codes set ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')},updated_at=now() where id=$1 returning *`, [id, ...keys.map(k => b[k] ?? null)]);
  if (!rows[0]) throw new AppError(404, 'Cost code not found');
  res.json({ success: true, data: rows[0] });
}));
