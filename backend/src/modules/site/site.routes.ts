import { Router } from 'express';
import { z } from 'zod';
import { getClient, query, releaseClient } from '../../db/pool.js';
import { AppError } from '../../middleware/errors.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';

export const siteRouter = Router();
siteRouter.use(authorize('site', 'view'));

const diarySchema = z.object({
  project_id: z.number().int().positive(),
  diary_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weather: z.string().max(50).optional(),
  work_performed: z.string().optional(),
  delays_notes: z.string().optional(),
  visitors: z.string().optional(),
  safety_notes: z.string().optional(),
  // NDC-014 structured fields
  work_fronts: z.string().optional(),
  constraints_noted: z.string().optional(),
  instructions_received: z.string().optional(),
  parties_present: z.string().optional(),
  impact_flag: z.boolean().default(false),
  impact_description: z.string().optional()
});

const manpowerSchema = z.object({
  diary_id: z.number().int().positive(),
  trade: z.string().min(1).max(50),
  subcontractor_id: z.number().int().positive().optional(),
  headcount: z.number().int().nonnegative(),
  hours: z.number().nonnegative().optional()
});

const equipmentSchema = z.object({
  diary_id: z.number().int().positive(),
  equipment_description: z.string().min(1).max(200),
  hours_used: z.number().nonnegative().optional(),
  idle_hours: z.number().nonnegative().optional(),
  asset_id: z.number().int().positive().optional()
});

siteRouter.get('/diaries', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select * from site_diary where ($1::bigint = 0 or project_id=$1) order by diary_date desc, id desc limit 120`, [projectId]);
  res.json({ success: true, data: rows });
}));

siteRouter.post('/diaries', authorize('site', 'manage'), asyncHandler(async (req, res) => {
  const body = diarySchema.parse(req.body);
  const [created] = await query(`
    insert into site_diary (project_id, diary_date, weather, work_performed, delays_notes, visitors, safety_notes, prepared_by, work_fronts, constraints_noted, instructions_received, parties_present, impact_flag, impact_description)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    on conflict (project_id, diary_date) do update set weather=excluded.weather, work_performed=excluded.work_performed, delays_notes=excluded.delays_notes, visitors=excluded.visitors, safety_notes=excluded.safety_notes,
      work_fronts=excluded.work_fronts, constraints_noted=excluded.constraints_noted, instructions_received=excluded.instructions_received, parties_present=excluded.parties_present, impact_flag=excluded.impact_flag, impact_description=excluded.impact_description, updated_at=now()
    returning *
  `, [body.project_id, body.diary_date, body.weather ?? null, body.work_performed ?? null, body.delays_notes ?? null, body.visitors ?? null, body.safety_notes ?? null, req.user!.id,
      body.work_fronts ?? null, body.constraints_noted ?? null, body.instructions_received ?? null, body.parties_present ?? null, body.impact_flag, body.impact_description ?? null]);
  res.status(201).json({ success: true, data: created });
}));

siteRouter.post('/diary-manpower', authorize('site', 'manage'), asyncHandler(async (req, res) => {
  const body = manpowerSchema.parse(req.body);
  const [created] = await query(`insert into diary_manpower (diary_id, trade, subcontractor_id, headcount, hours) values ($1,$2,$3,$4,$5) returning *`, [body.diary_id, body.trade, body.subcontractor_id ?? null, body.headcount, body.hours ?? null]);
  res.status(201).json({ success: true, data: created });
}));

siteRouter.post('/diary-equipment', authorize('site', 'manage'), asyncHandler(async (req, res) => {
  const body = equipmentSchema.parse(req.body);
  const [created] = await query(`insert into diary_equipment (diary_id, equipment_description, hours_used, idle_hours, asset_id) values ($1,$2,$3,$4,$5) returning *`, [body.diary_id, body.equipment_description, body.hours_used ?? null, body.idle_hours ?? null, body.asset_id ?? null]);
  res.status(201).json({ success: true, data: created });
}));

siteRouter.get('/quantity-sheets', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select qs.*, pb.description as boq_description from quantity_sheets qs join project_boq pb on pb.id=qs.boq_item_id where ($1::bigint=0 or qs.project_id=$1) order by qs.measurement_date desc, qs.id desc limit 200`, [projectId]);
  res.json({ success: true, data: rows });
}));

siteRouter.post('/quantity-sheets', authorize('site', 'manage'), asyncHandler(async (req, res) => {
  const body = z.object({ project_id: z.number().int().positive(), boq_item_id: z.number().int().positive(), measurement_date: z.string().optional(), location_ref: z.string().max(150).optional(), quantity: z.number(), checked_by: z.number().int().positive().optional(),  }).parse(req.body);
  const [created] = await query(`insert into quantity_sheets (project_id, boq_item_id, measurement_date, location_ref, quantity, measured_by, checked_by, status) values ($1,$2,coalesce($3::date,current_date),$4,$5,$6,$7,$8) returning *`, [body.project_id, body.boq_item_id, body.measurement_date ?? null, body.location_ref ?? null, body.quantity, req.user!.id, body.checked_by ?? null, 'draft']);
  res.status(201).json({ success: true, data: created });
}));

siteRouter.get('/punch-list', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select * from punch_lists where ($1::bigint=0 or project_id=$1) order by created_at desc limit 200`, [projectId]);
  res.json({ success: true, data: rows });
}));

siteRouter.post('/punch-list', authorize('site', 'manage'), asyncHandler(async (req, res) => {
  const body = z.object({ project_id: z.number().int().positive(), location: z.string().max(150).optional(), description: z.string().min(1), assigned_to: z.number().int().positive().optional(), due_date: z.string().optional() }).parse(req.body);
  const [created] = await query(`insert into punch_lists (project_id, location, description, raised_by, assigned_to, due_date) values ($1,$2,$3,$4,$5,$6) returning *`, [body.project_id, body.location ?? null, body.description, req.user!.id, body.assigned_to ?? null, body.due_date ?? null]);
  res.status(201).json({ success: true, data: created });
}));

siteRouter.patch('/punch-list/:id/close', authorize('site', 'manage'), asyncHandler(async (req, res) => {
  const [updated] = await query(`update punch_lists set status='closed', closed_date=current_date, updated_at=now() where id=$1 returning *`, [Number(req.params.id)]);
  res.json({ success: true, data: updated ?? null });
}));

siteRouter.get('/site-instructions', asyncHandler(async (req, res) => {
  const projectId = Number(req.query.project_id || 0);
  const rows = await query(`select * from site_instructions where ($1::bigint=0 or project_id=$1) order by issue_date desc, id desc limit 200`, [projectId]);
  res.json({ success: true, data: rows });
}));

siteRouter.post('/site-instructions', authorize('site', 'manage'), asyncHandler(async (req, res) => {
  const body = z.object({ project_id: z.number().int().positive(), instruction_no: z.string().min(1).max(30), issued_to: z.string().max(150).optional(), description: z.string().min(1), related_rfi_id: z.number().int().positive().optional() }).parse(req.body);
  const [created] = await query(`insert into site_instructions (project_id, instruction_no, issued_by, issued_to, description, related_rfi_id) values ($1,$2,$3,$4,$5,$6) returning *`, [body.project_id, body.instruction_no, req.user!.id, body.issued_to ?? null, body.description, body.related_rfi_id ?? null]);
  res.status(201).json({ success: true, data: created });
}));

// NDC-014: sign-off (signer != preparer, enforced in DB), immutability after signing, amendments, and the
// impact flag turning into a contract event that the commercial team must review for notices (NDC-001).
siteRouter.get('/diaries/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(400, 'Invalid diary id');
  const d = (await query<any>(`select * from site_diary where id=$1`, [id]))[0];
  if (!d) throw new AppError(404, 'Site diary not found');
  const [manpower, equipment, amendments] = await Promise.all([
    query(`select * from diary_manpower where diary_id=$1 order by id`, [id]),
    query(`select * from diary_equipment where diary_id=$1 order by id`, [id]),
    query(`select * from site_diary_amendments where diary_id=$1 order by id`, [id])]);
  res.json({ success: true, data: { ...d, manpower, equipment, amendments } });
}));

siteRouter.post('/diaries/:id/sign', authorize('site', 'approve'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(400, 'Invalid diary id');
  const client = await getClient();
  try {
    await client.query('begin');
    const d = (await client.query(`select * from site_diary where id=$1 for update`, [id])).rows[0];
    if (!d) throw new AppError(404, 'Site diary not found');
    if (d.status === 'signed') throw new AppError(409, 'Site diary is already signed');
    if (Number(d.prepared_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: a site diary must be signed by someone other than its preparer');
    const signed = (await client.query(`update site_diary set status='signed',signed_by=$2,signed_at=now(),updated_at=now() where id=$1 returning *`, [id, req.user!.id])).rows[0];
    let impact: { event?: unknown; warning?: string } | null = null;
    if (signed.impact_flag) {
      const contracts = (await client.query(`select id from contracts where project_id=$1 and contract_status in ('signed','active')`, [signed.project_id])).rows;
      if (contracts.length === 1) {
        const ev = (await client.query(`insert into contract_events(org_id,contract_id,title,description,occurred_on,became_aware_on,source_type,source_reference,recorded_by)
          values($1,$2,$3,$4,$5,$5,'site_diary',$6,$7) returning *`,
          [signed.org_id, contracts[0].id, `Site diary impact ${signed.diary_date}`, signed.impact_description, signed.diary_date, `site_diary:${id}`, req.user!.id])).rows[0];
        await client.query(`insert into contract_event_links(org_id,event_id,link_type,linked_id,created_by) values($1,$2,'site_diary',$3,$4)`, [signed.org_id, ev.id, id, req.user!.id]);
        await client.query(`update site_diary set impact_event_id=$2 where id=$1`, [id, ev.id]);
        signed.impact_event_id = ev.id;
        impact = { event: ev };
      } else {
        impact = { warning: contracts.length ? 'Several active contracts on this project: record the contract event manually' : 'No signed/active contract on this project: impact recorded on the diary only' };
      }
    }
    await client.query('commit');
    res.json({ success: true, data: { diary: signed, impact } });
  } catch (e) { await client.query('rollback'); throw e; } finally { await releaseClient(client); }
}));

siteRouter.post('/diaries/:id/amendments', authorize('site', 'manage'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(400, 'Invalid diary id');
  const b = z.object({ note: z.string().trim().min(5).max(4000) }).parse(req.body);
  const d = (await query<any>(`select org_id from site_diary where id=$1`, [id]))[0];
  if (!d) throw new AppError(404, 'Site diary not found');
  const [r] = await query(`insert into site_diary_amendments(org_id,diary_id,note,author_id) values($1,$2,$3,$4) returning *`, [d.org_id, id, b.note, req.user!.id]);
  res.status(201).json({ success: true, data: r });
}));
