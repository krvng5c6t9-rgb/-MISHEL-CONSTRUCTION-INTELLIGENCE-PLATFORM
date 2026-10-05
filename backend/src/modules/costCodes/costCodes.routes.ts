import { Router } from 'express';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

export const costCodesRouter = Router();

costCodesRouter.use(authorize('cost_control', 'view'));

costCodesRouter.get('/', asyncHandler(async (req, res) => {
  const projectId = req.query.project_id ? Number(req.query.project_id) : null;
  const rows = await query(`
    select id, org_id, project_id, code, description, cost_type, unit_of_measure, is_active
    from cost_codes
    where ($1::bigint is null or project_id = $1)
    order by code
  `, [projectId]);
  res.json({ success: true, data: rows });
}));
