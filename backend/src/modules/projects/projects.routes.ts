import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

export const projectsRouter = Router();

projectsRouter.use(authorize('projects', 'view'));

const projectCreateSchema = z.object({
  org_id: z.number().int().positive().optional(),
  project_code: z.string().min(1).max(30),
  project_name: z.string().min(1).max(200),
  project_type: z.enum(['fit_out', 'finishing', 'construction', 'design_build']).default('fit_out'),
  currency_id: z.number().int().positive(),
  client_id: z.number().int().positive().optional(),
  status: z.enum(['lead', 'tender', 'awarded', 'execution', 'closeout', 'closed', 'cancelled']).default('execution'),
  location: z.string().optional(),
  start_date: z.string().optional(),
  planned_end_date: z.string().optional(),
  original_contract_value: z.number().nonnegative().optional(),
  current_contract_value: z.number().nonnegative().optional(),
  retention_percent: z.number().min(0).max(100).optional(),
  advance_payment_percent: z.number().min(0).max(100).optional()
});

projectsRouter.get('/', asyncHandler(async (_req, res) => {
  const rows = await query(`
    select p.id, p.project_code, p.project_name, p.project_type, p.status,
           p.location, p.start_date, p.planned_end_date,
           p.original_contract_value, p.current_contract_value,
           c.code as currency_code
    from projects p
    join currencies c on c.id = p.currency_id
    order by p.created_at desc
    limit 100
  `);
  res.json({ success: true, data: rows });
}));

projectsRouter.get('/reference-data/options', asyncHandler(async (_req, res) => {
  const [clients, currencies] = await Promise.all([
    query(`select id, client_name from clients where is_active=true order by client_name`),
    query(`select id, code, name from currencies where is_active=true order by code`)
  ]);
  res.json({ success: true, data: { clients, currencies } });
}));

projectsRouter.get('/:id', asyncHandler(async (req, res) => {
  const [project] = await query('select * from projects where id = $1', [Number(req.params.id)]);
  res.json({ success: true, data: project ?? null });
}));

projectsRouter.post('/', authorize('projects', 'create'), asyncHandler(async (req, res) => {
  const body = projectCreateSchema.parse(req.body);
  const orgId = req.user!.org_id;
  const [created] = await query(`
    insert into projects (
      org_id, project_code, project_name, project_type, client_id, currency_id, status,
      location, start_date, planned_end_date, original_contract_value, current_contract_value,
      retention_percent, advance_payment_percent
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    returning *
  `, [
    orgId, body.project_code, body.project_name, body.project_type, body.client_id ?? null,
    body.currency_id, body.status, body.location ?? null, body.start_date ?? null,
    body.planned_end_date ?? null, body.original_contract_value ?? null,
    body.current_contract_value ?? null, body.retention_percent ?? null, body.advance_payment_percent ?? null
  ]);
  res.status(201).json({ success: true, data: created });
}));
