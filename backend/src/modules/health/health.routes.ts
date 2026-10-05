import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { query } from '../../db/pool.js';

export const healthRouter = Router();

healthRouter.get('/', asyncHandler(async (_req, res) => {
  const [db] = await query<{ ok: number; now: string }>('select 1 as ok, now()::text as now');
  res.json({ success: true, service: 'construction-erp-backend', database: db });
}));
