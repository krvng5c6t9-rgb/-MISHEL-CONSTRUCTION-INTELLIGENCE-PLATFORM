import { Router } from 'express';
import { z } from 'zod';
import { getClient, query, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

// NDC-001 (migration 044): Contract Data Pack obligation rules, contract event register and the
// notice / time-bar engine. Periods come only from the signed contract (with a source reference) and are
// confirmed by a second person. Issuing a notice is never gated by internal approval.
export const contractAdminRouter = Router();
contractAdminRouter.use(authorize('contracts', 'view'));

const pid = (v: string) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, 'Invalid id'); return n; };
async function conflictOr404(table: 'contract_notices' | 'contract_obligation_rules', id: number, msg: string): Promise<never> {
  const exists = (await query(`select 1 from ${table} where id=$1`, [id]))[0];
  throw exists ? new AppError(409, msg) : new AppError(404, table === 'contract_notices' ? 'Notice not found' : 'Obligation rule not found');
}
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ruleBody = z.object({
  clause_ref: z.string().trim().min(1).max(60),
  obligation_type: z.enum(['notice_of_claim', 'notice_of_delay', 'early_warning', 'variation_notice', 'notice_of_dispute', 'response_due', 'particulars_due', 'other']),
  responsible_party: z.enum(['contractor', 'employer', 'engineer', 'project_manager', 'subcontractor']),
  trigger_description: z.string().trim().min(5),
  period_value: z.number().int().positive().max(3650),
  period_unit: z.enum(['calendar_days', 'weeks', 'months']),
  addressee: z.string().trim().min(2).max(200),
  delivery_requirements: z.string().max(2000).nullable().optional(),
  is_condition_precedent: z.boolean(),
  source_reference: z.string().trim().min(3).max(500)
});

contractAdminRouter.get('/contracts/:contractId/rules', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await query(`select * from contract_obligation_rules where contract_id=$1 order by clause_ref, id`, [pid(req.params.contractId)]) });
}));
contractAdminRouter.post('/contracts/:contractId/rules', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = ruleBody.parse(req.body);
  const [r] = await query(`insert into contract_obligation_rules(org_id,contract_id,clause_ref,obligation_type,responsible_party,trigger_description,period_value,period_unit,addressee,delivery_requirements,is_condition_precedent,source_reference,created_by)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
    [req.user!.org_id, pid(req.params.contractId), b.clause_ref, b.obligation_type, b.responsible_party, b.trigger_description, b.period_value, b.period_unit, b.addressee, b.delivery_requirements ?? null, b.is_condition_precedent, b.source_reference, req.user!.id]);
  res.status(201).json({ success: true, data: r });
}));
contractAdminRouter.patch('/rules/:id', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = ruleBody.partial().parse(req.body);
  const keys = (Object.keys(b) as (keyof typeof b)[]).filter(k => b[k] !== undefined);
  if (!keys.length) throw new AppError(400, 'No fields to update');
  const rows = await query(`update contract_obligation_rules set ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')},updated_at=now() where id=$1 returning *`, [pid(req.params.id), ...keys.map(k => b[k] ?? null)]);
  if (!rows[0]) throw new AppError(404, 'Obligation rule not found');
  res.json({ success: true, data: rows[0] });
}));
contractAdminRouter.post('/rules/:id/confirm', authorize('contracts', 'approve'), asyncHandler(async (req, res) => {
  const id = pid(req.params.id);
  const cur = (await query<any>(`select created_by,status from contract_obligation_rules where id=$1`, [id]))[0];
  if (!cur) throw new AppError(404, 'Obligation rule not found');
  if (cur.status !== 'draft') throw new AppError(409, 'Only draft rules can be confirmed');
  if (Number(cur.created_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: a contract obligation rule must be confirmed by someone other than its author');
  const [r] = await query(`update contract_obligation_rules set status='confirmed',confirmed_by=$2,confirmed_at=now(),updated_at=now() where id=$1 returning *`, [id, req.user!.id]);
  res.json({ success: true, data: r });
}));
contractAdminRouter.post('/rules/:id/retire', authorize('contracts', 'approve'), asyncHandler(async (req, res) => {
  const id = pid(req.params.id);
  const rows = await query(`update contract_obligation_rules set status='retired',updated_at=now() where id=$1 and status='confirmed' returning *`, [id]);
  if (!rows[0]) await conflictOr404('contract_obligation_rules', id, 'Only confirmed rules can be retired');
  res.json({ success: true, data: rows[0] });
}));

// Events: recording an event generates one notice obligation per selected confirmed rule.
const eventBody = z.object({
  title: z.string().trim().min(3).max(250), description: z.string().trim().min(5),
  occurred_on: isoDate, became_aware_on: isoDate,
  source_type: z.enum(['site_instruction', 'rfi', 'correspondence', 'site_diary', 'design_revision', 'meeting', 'other']).nullable().optional(),
  source_reference: z.string().max(500).nullable().optional(),
  rule_ids: z.array(z.number().int().positive()).max(50).default([])
});
contractAdminRouter.get('/contracts/:contractId/events', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await query(`select * from contract_events where contract_id=$1 order by became_aware_on desc, id desc`, [pid(req.params.contractId)]) });
}));
contractAdminRouter.post('/contracts/:contractId/events', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = eventBody.parse(req.body);
  const contractId = pid(req.params.contractId);
  const client = await getClient();
  try {
    await client.query('begin');
    const e = (await client.query(`insert into contract_events(org_id,contract_id,title,description,occurred_on,became_aware_on,source_type,source_reference,recorded_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [req.user!.org_id, contractId, b.title, b.description, b.occurred_on, b.became_aware_on, b.source_type ?? null, b.source_reference ?? null, req.user!.id])).rows[0];
    const notices = [];
    for (const ruleId of [...new Set(b.rule_ids)]) {
      notices.push((await client.query(`insert into contract_notices(org_id,contract_id,event_id,rule_id,deadline) values($1,$2,$3,$4,current_date) returning *`, [req.user!.org_id, contractId, e.id, ruleId])).rows[0]);
    }
    await client.query('commit');
    res.status(201).json({ success: true, data: { event: e, notices } });
  } catch (err) { await client.query('rollback'); throw err; } finally { await releaseClient(client); }
}));
contractAdminRouter.post('/events/:id/notices', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ rule_id: z.number().int().positive() }).parse(req.body);
  const e = (await query<any>(`select id,contract_id from contract_events where id=$1`, [pid(req.params.id)]))[0];
  if (!e) throw new AppError(404, 'Event not found');
  const [n] = await query(`insert into contract_notices(org_id,contract_id,event_id,rule_id,deadline) values($1,$2,$3,$4,current_date) returning *`, [req.user!.org_id, e.contract_id, e.id, b.rule_id]);
  res.status(201).json({ success: true, data: n });
}));

// Notice register across contracts, most urgent first; days_remaining is relative to today.
contractAdminRouter.get('/notices', asyncHandler(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const within = req.query.due_within_days != null ? Number(req.query.due_within_days) : null;
  if (within != null && (!Number.isInteger(within) || within < 0)) throw new AppError(400, 'due_within_days must be a non-negative integer');
  const rows = await query(`select n.*, (n.deadline - current_date) as days_remaining, (n.status='open' and n.deadline < current_date) as overdue,
      r.clause_ref, r.obligation_type, r.addressee, r.is_condition_precedent, e.title as event_title, e.became_aware_on, c.project_id
    from contract_notices n join contract_obligation_rules r on r.id=n.rule_id join contract_events e on e.id=n.event_id join contracts c on c.id=n.contract_id
    where ($1::text is null or n.status=$1) and ($2::int is null or n.deadline <= current_date + $2::int)
    order by (n.status='open') desc, n.deadline asc, n.id asc`, [status, within]);
  res.json({ success: true, data: rows });
}));
contractAdminRouter.post('/notices/:id/issue', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ delivery_method: z.enum(['hand_delivery', 'courier', 'registered_mail', 'email', 'contract_portal', 'other']), delivery_reference: z.string().trim().min(3).max(500),
    issued_at: z.string().datetime({ offset: true }).optional() }).parse(req.body);
  if (b.issued_at && new Date(b.issued_at).getTime() > Date.now() + 60_000) throw new AppError(422, 'Issue time cannot be in the future');
  const rows = await query(`update contract_notices set status='issued',issued_at=coalesce($2::timestamptz,now()),issued_by=$3,delivery_method=$4,delivery_reference=$5 where id=$1 and status='open' returning *`,
    [pid(req.params.id), b.issued_at ?? null, req.user!.id, b.delivery_method, b.delivery_reference]);
  if (!rows[0]) await conflictOr404('contract_notices', pid(req.params.id), 'Only open notices can be issued');
  res.json({ success: true, data: rows[0] });
}));
contractAdminRouter.post('/notices/:id/acknowledge', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ acknowledgement_reference: z.string().trim().min(3).max(500), acknowledged_at: z.string().datetime({ offset: true }).optional() }).parse(req.body);
  const rows = await query(`update contract_notices set status='acknowledged',acknowledged_at=coalesce($2::timestamptz,now()),acknowledgement_reference=$3 where id=$1 and status='issued' returning *`,
    [pid(req.params.id), b.acknowledged_at ?? null, b.acknowledgement_reference]);
  if (!rows[0]) await conflictOr404('contract_notices', pid(req.params.id), 'Only issued notices can be acknowledged');
  res.json({ success: true, data: rows[0] });
}));
contractAdminRouter.post('/notices/:id/not-required', authorize('contracts', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ reason: z.string().trim().min(10).max(2000) }).parse(req.body);
  const rows = await query(`update contract_notices set status='not_required',not_required_reason=$2,decided_by=$3 where id=$1 and status='open' returning *`, [pid(req.params.id), b.reason, req.user!.id]);
  if (!rows[0]) await conflictOr404('contract_notices', pid(req.params.id), 'Only open notices can be marked not required');
  res.json({ success: true, data: rows[0] });
}));
