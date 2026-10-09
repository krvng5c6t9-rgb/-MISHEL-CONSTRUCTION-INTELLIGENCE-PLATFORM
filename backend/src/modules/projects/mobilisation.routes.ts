import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

// Stage 17 (GC-02 step 9, migration 068): mobilisation readiness gate. Items are the project's own list; GO requires
// every mandatory item closed with evidence or risk-accepted against the risk register; decided by a second person.
export const mobilisationRouter = Router();
mobilisationRouter.use(authorize('projects', 'view'));

const pid = (v: string) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, 'Invalid id'); return n; };
const id = z.number().int().positive();
async function gate(gateId: number, orgId: number) {
  const [g] = await query<any>(`select * from mobilisation_gates where id = $1 and org_id = $2`, [gateId, orgId]);
  if (!g) throw new AppError(404, 'Mobilisation gate not found');
  return g;
}
async function item(itemId: number, orgId: number) {
  const [i] = await query<any>(`select * from mobilisation_gate_items where id = $1 and org_id = $2`, [itemId, orgId]);
  if (!i) throw new AppError(404, 'Readiness item not found');
  if (i.status !== 'open') throw new AppError(409, 'Readiness item is already resolved');
  return i;
}

mobilisationRouter.post('/gates', authorize('projects', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ project_id: id }).parse(req.body);
  const [g] = await query(`insert into mobilisation_gates(org_id, project_id, prepared_by) values ($1,$2,$3) returning *`, [req.user!.org_id, b.project_id, req.user!.id]);
  res.status(201).json({ success: true, data: g });
}));
mobilisationRouter.get('/gates/:id', asyncHandler(async (req, res) => {
  const g = await gate(pid(req.params.id), req.user!.org_id);
  const items = await query<any>(`select * from mobilisation_gate_items where gate_id = $1 order by mandatory desc, category, id`, [g.id]);
  res.json({ success: true, data: { ...g, items, open_mandatory: items.filter(i => i.mandatory && i.status === 'open').length } });
}));
mobilisationRouter.post('/gates/:id/items', authorize('projects', 'edit'), asyncHandler(async (req, res) => {
  const g = await gate(pid(req.params.id), req.user!.org_id);
  const b = z.object({ category: z.enum(['permit', 'insurance', 'bond', 'staff', 'other']), item: z.string().trim().min(3).max(500), mandatory: z.boolean() }).parse(req.body);
  const [i] = await query(`insert into mobilisation_gate_items(org_id, gate_id, category, item, mandatory, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
    [req.user!.org_id, g.id, b.category, b.item, b.mandatory, req.user!.id]);
  res.status(201).json({ success: true, data: i });
}));
mobilisationRouter.post('/items/:id/close', authorize('projects', 'edit'), asyncHandler(async (req, res) => {
  const b = z.object({ evidence_document_id: id.optional(), note: z.string().trim().max(4000).optional() })
    .refine(v => v.evidence_document_id || (v.note ?? '').length >= 5, { message: 'Close with an approved evidence document or a note of at least 5 characters' }).parse(req.body);
  const i = await item(pid(req.params.id), req.user!.org_id);
  const [u] = await query(`update mobilisation_gate_items set status = 'closed', evidence_document_id = $2, note = $3, resolved_by = $4, resolved_at = now() where id = $1 returning *`,
    [i.id, b.evidence_document_id ?? null, b.note ?? null, req.user!.id]);
  res.json({ success: true, data: u });
}));
mobilisationRouter.post('/items/:id/risk-accept', authorize('projects', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ risk_id: id, note: z.string().trim().min(10).max(4000) }).parse(req.body);
  const i = await item(pid(req.params.id), req.user!.org_id);
  const [u] = await query(`update mobilisation_gate_items set status = 'risk_accepted', risk_id = $2, note = $3, resolved_by = $4, resolved_at = now() where id = $1 returning *`,
    [i.id, b.risk_id, b.note, req.user!.id]);
  res.json({ success: true, data: u });
}));
mobilisationRouter.post('/gates/:id/submit', authorize('projects', 'edit'), asyncHandler(async (req, res) => {
  const g = await gate(pid(req.params.id), req.user!.org_id);
  if (g.status !== 'draft') throw new AppError(409, 'Only a draft gate can be submitted');
  if (Number(g.prepared_by) !== req.user!.id) throw new AppError(403, 'Only the preparer submits the gate');
  const [u] = await query(`update mobilisation_gates set status = 'submitted', submitted_at = now() where id = $1 returning *`, [g.id]);
  res.json({ success: true, data: u });
}));
mobilisationRouter.post('/gates/:id/decision', authorize('projects', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ decision: z.enum(['go', 'no_go']), note: z.string().trim().max(4000).optional() }).parse(req.body);
  const g = await gate(pid(req.params.id), req.user!.org_id);
  if (g.status !== 'submitted') throw new AppError(409, 'Only a submitted gate can be decided');
  if (Number(g.prepared_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: the gate is decided by someone other than its preparer');
  if (b.decision === 'no_go' && (b.note ?? '').length < 5) throw new AppError(400, 'A no-go decision needs a reason');
  const [u] = await query(`update mobilisation_gates set status = $2::varchar, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1 returning *`, [g.id, b.decision, req.user!.id, b.note ?? null]);
  res.json({ success: true, data: u });
}));
