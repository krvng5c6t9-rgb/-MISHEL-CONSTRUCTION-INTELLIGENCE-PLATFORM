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
async function conflictOr404(table: 'contract_notices' | 'contract_obligation_rules' | 'compensation_events', id: number, msg: string): Promise<never> {
  const exists = (await query(`select 1 from ${table} where id=$1`, [id]))[0];
  throw exists ? new AppError(409, msg) : new AppError(404, table === 'contract_notices' ? 'Notice not found' : 'Obligation rule not found');
}
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ruleBody = z.object({
  clause_ref: z.string().trim().min(1).max(60),
  obligation_type: z.enum(['notice_of_claim', 'notice_of_delay', 'early_warning', 'variation_notice', 'notice_of_dispute', 'response_due', 'particulars_due', 'quotation_due', 'other']),
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

// NDC-002: link records to a change event (no automatic conversion or closure between paths).
contractAdminRouter.get('/events/:id', asyncHandler(async (req, res) => {
  const id = pid(req.params.id);
  const e = (await query<any>(`select * from contract_events where id=$1`, [id]))[0];
  if (!e) throw new AppError(404, 'Event not found');
  const [links, notices] = await Promise.all([
    query(`select * from contract_event_links where event_id=$1 order by id`, [id]),
    query(`select n.*, r.clause_ref, r.obligation_type from contract_notices n join contract_obligation_rules r on r.id=n.rule_id where n.event_id=$1 order by n.deadline`, [id])]);
  res.json({ success: true, data: { ...e, links, notices } });
}));
contractAdminRouter.post('/events/:id/links', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ link_type: z.enum(['rfi', 'site_instruction', 'variation', 'claim', 'early_warning', 'site_diary']), linked_id: z.number().int().positive() }).parse(req.body);
  const e = (await query<any>(`select id,org_id from contract_events where id=$1`, [pid(req.params.id)]))[0];
  if (!e) throw new AppError(404, 'Event not found');
  const [r] = await query(`insert into contract_event_links(org_id,event_id,link_type,linked_id,created_by) values($1,$2,$3,$4,$5) returning *`, [e.org_id, e.id, b.link_type, b.linked_id, req.user!.id]);
  res.status(201).json({ success: true, data: r });
}));

// Early-warning register (NEC-style; usable as best practice under any form).
contractAdminRouter.get('/contracts/:contractId/early-warnings', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await query(`select * from early_warnings where contract_id=$1 order by raised_on desc, id desc`, [pid(req.params.contractId)]) });
}));
contractAdminRouter.post('/contracts/:contractId/early-warnings', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ ew_no: z.string().trim().min(1).max(30), raised_by_party: z.enum(['contractor', 'employer', 'project_manager', 'engineer', 'subcontractor']), raised_on: isoDate,
    matter: z.string().trim().min(5), may_increase_price: z.boolean(), may_delay_completion: z.boolean(), may_impair_performance: z.boolean() }).parse(req.body);
  const [r] = await query(`insert into early_warnings(org_id,contract_id,ew_no,raised_by_party,raised_on,matter,may_increase_price,may_delay_completion,may_impair_performance,created_by)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, [req.user!.org_id, pid(req.params.contractId), b.ew_no, b.raised_by_party, b.raised_on, b.matter, b.may_increase_price, b.may_delay_completion, b.may_impair_performance, req.user!.id]);
  res.status(201).json({ success: true, data: r });
}));
contractAdminRouter.patch('/early-warnings/:id', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ risk_reduction_meeting_on: isoDate.nullable().optional(), actions_agreed: z.string().max(4000).nullable().optional() }).parse(req.body);
  const rows = await query(`update early_warnings set risk_reduction_meeting_on=coalesce($2::date,risk_reduction_meeting_on),actions_agreed=coalesce($3,actions_agreed) where id=$1 returning *`, [pid(req.params.id), b.risk_reduction_meeting_on ?? null, b.actions_agreed ?? null]);
  if (!rows[0]) throw new AppError(404, 'Early warning not found');
  res.json({ success: true, data: rows[0] });
}));
contractAdminRouter.post('/early-warnings/:id/close', authorize('contracts', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ closure_note: z.string().trim().min(5).max(4000) }).parse(req.body);
  const id = pid(req.params.id);
  const rows = await query(`update early_warnings set status='closed',closure_note=$2,closed_by=$3,closed_at=now() where id=$1 and status='open' returning *`, [id, b.closure_note, req.user!.id]);
  if (!rows[0]) {
    const exists = (await query(`select 1 from early_warnings where id=$1`, [id]))[0];
    throw exists ? new AppError(409, 'Early warning is already closed') : new AppError(404, 'Early warning not found');
  }
  res.json({ success: true, data: rows[0] });
}));

// NDC-010: programme submissions with a sealed activity snapshot, contractual response deadline,
// and the Engineer's / PM's recorded decision. Exactly one accepted programme per contract.
contractAdminRouter.get('/contracts/:contractId/programme-submissions', asyncHandler(async (req, res) => {
  const rows = await query(`select p.*, (p.status='submitted' and p.response_due is not null and p.response_due < current_date) as response_overdue,
      (select count(*)::int from programme_submission_activities a where a.submission_id=p.id) as activity_count
    from programme_submissions p where p.contract_id=$1 order by p.submitted_on desc, p.id desc`, [pid(req.params.contractId)]);
  res.json({ success: true, data: { accepted: rows.find((r: any) => r.status === 'accepted') ?? null, submissions: rows } });
}));
contractAdminRouter.get('/programme-submissions/:id', asyncHandler(async (req, res) => {
  const id = pid(req.params.id);
  const p = (await query<any>(`select * from programme_submissions where id=$1`, [id]))[0];
  if (!p) throw new AppError(404, 'Programme submission not found');
  res.json({ success: true, data: { ...p, activities: await query(`select * from programme_submission_activities where submission_id=$1 order by activity_id`, [id]) } });
}));
contractAdminRouter.post('/contracts/:contractId/programme-submissions', authorize('planning', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ revision_no: z.string().trim().min(1).max(20), data_date: isoDate, submitted_on: isoDate, response_rule_id: z.number().int().positive().nullable().optional(), narrative: z.string().max(10000).nullable().optional() }).parse(req.body);
  const contractId = pid(req.params.contractId);
  const client = await getClient();
  try {
    await client.query('begin');
    const c = (await client.query(`select id,project_id from contracts where id=$1`, [contractId])).rows[0];
    if (!c) throw new AppError(404, 'Contract not found');
    const sub = (await client.query(`insert into programme_submissions(org_id,contract_id,project_id,revision_no,data_date,submitted_on,submitted_by,response_rule_id,narrative) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [req.user!.org_id, contractId, c.project_id, b.revision_no, b.data_date, b.submitted_on, req.user!.id, b.response_rule_id ?? null, b.narrative ?? null])).rows[0];
    const snap = await client.query(`insert into programme_submission_activities(org_id,submission_id,activity_id,activity_id_ext,activity_name,planned_start,planned_finish,planned_duration_days,percent_complete,predecessors)
      select $1,$2,a.id,a.activity_id_ext,a.activity_name,a.planned_start,a.planned_finish,a.planned_duration_days,a.percent_complete,
        coalesce((select jsonb_agg(jsonb_build_object('predecessor',r.predecessor_activity_id,'type',r.relationship_type,'lag',r.lag_days) order by r.id) from schedule_relationships r where r.successor_activity_id=a.id),'[]'::jsonb)
      from schedule_activities a where a.project_id=$3`, [req.user!.org_id, sub.id, c.project_id]);
    if (!snap.rowCount) throw new AppError(422, 'The project has no schedule activities to submit');
    const sealed = (await client.query(`update programme_submissions set snapshot_sealed=true where id=$1 returning *`, [sub.id])).rows[0];
    await client.query('commit');
    res.status(201).json({ success: true, data: { ...sealed, activity_count: snap.rowCount } });
  } catch (e) { await client.query('rollback'); throw e; } finally { await releaseClient(client); }
}));
contractAdminRouter.post('/programme-submissions/:id/decision', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ decision: z.enum(['accepted', 'rejected']), decision_on: isoDate, decision_reference: z.string().trim().min(3).max(500), rejection_reasons: z.string().trim().min(5).max(10000).optional() }).parse(req.body);
  const id = pid(req.params.id);
  const client = await getClient();
  try {
    await client.query('begin');
    const p = (await client.query(`select * from programme_submissions where id=$1 for update`, [id])).rows[0];
    if (!p) throw new AppError(404, 'Programme submission not found');
    if (p.status !== 'submitted') throw new AppError(409, `Programme submission is already ${p.status}`);
    if (b.decision === 'rejected' && !b.rejection_reasons) throw new AppError(422, 'Rejection reasons are required');
    if (b.decision === 'accepted') {
      await client.query(`update programme_submissions set status='superseded' where contract_id=$1 and status='accepted'`, [p.contract_id]);
    }
    const r = (await client.query(`update programme_submissions set status=$2,decision_on=$3,decision_reference=$4,rejection_reasons=$5,recorded_by=$6 where id=$1 returning *`,
      [id, b.decision, b.decision_on, b.decision_reference, b.rejection_reasons ?? null, req.user!.id])).rows[0];
    await client.query('commit');
    res.json({ success: true, data: r });
  } catch (e) { await client.query('rollback'); throw e; } finally { await releaseClient(client); }
}));

// CC-034 (NDC-002): compensation-event register. Deadlines only from confirmed contract rules; decisions recorded by
// someone other than the notifier and the quotation preparer; decided events are immutable.
const ceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
contractAdminRouter.get('/contracts/:contractId/compensation-events', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await query(`select ce.*, (ce.status='notified' and ce.quotation_due < current_date) as quotation_overdue,
      (ce.status='quotation_submitted' and ce.reply_due < current_date) as reply_overdue
    from compensation_events ce where ce.contract_id=$1 and ce.org_id=$2 order by ce.notified_on desc, ce.id desc`, [pid(req.params.contractId), req.user!.org_id]) });
}));
contractAdminRouter.post('/contracts/:contractId/compensation-events', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ event_id: z.number().int().positive(), ce_no: z.string().trim().min(1).max(30), description: z.string().trim().min(5), notified_on: ceDate,
    quotation_rule_id: z.number().int().positive().optional(), reply_rule_id: z.number().int().positive().optional() }).parse(req.body);
  const [r] = await query(`insert into compensation_events(org_id,contract_id,event_id,ce_no,description,notified_on,quotation_rule_id,reply_rule_id,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [req.user!.org_id, pid(req.params.contractId), b.event_id, b.ce_no, b.description, b.notified_on, b.quotation_rule_id ?? null, b.reply_rule_id ?? null, req.user!.id]);
  res.status(201).json({ success: true, data: r });
}));
contractAdminRouter.post('/compensation-events/:id/quotation', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ amount: z.number(), time_days: z.number().int().nonnegative(), submitted_on: ceDate }).parse(req.body);
  const rows = await query(`update compensation_events set status='quotation_submitted',quotation_amount=$2,quotation_time_days=$3,quotation_submitted_on=$4,quotation_by=$5 where id=$1 and org_id=$6 and status='notified' returning *`,
    [pid(req.params.id), String(b.amount), b.time_days, b.submitted_on, req.user!.id, req.user!.org_id]);
  if (!rows[0]) await conflictOr404('compensation_events', pid(req.params.id), 'Only a notified compensation event takes a quotation');
  res.json({ success: true, data: rows[0] });
}));
contractAdminRouter.post('/compensation-events/:id/decision', authorize('contracts', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ decision: z.enum(['accepted', 'pm_assessed', 'not_a_ce', 'withdrawn']), decision_on: ceDate.optional(), reference: z.string().trim().max(500).optional(),
    amount: z.number().optional(), time_days: z.number().int().nonnegative().optional(), reason: z.string().trim().max(4000).optional() }).parse(req.body);
  const rows = await query(`update compensation_events set status=$2::varchar,decision_on=$3::date,decision_reference=$4::text,decided_amount=$5::numeric,decided_time_days=$6::int,decision_reason=$7::text,decision_recorded_by=$8::bigint
     where id=$1 and org_id=$9 and status in ('notified','quotation_submitted') returning *`,
    [pid(req.params.id), b.decision, b.decision_on ?? null, b.reference ?? null, b.amount == null ? null : String(b.amount), b.time_days ?? null, b.reason ?? null, req.user!.id, req.user!.org_id]);
  if (!rows[0]) await conflictOr404('compensation_events', pid(req.params.id), 'Compensation event is already decided');
  res.json({ success: true, data: rows[0] });
}));

// NDC-029 (migration 061): Time for Completion revisions (written by the DB when a claim, compensation event or
// variation decision grants days), contract LD terms (second-person confirmed) and the time / LD position.
// LD exposure is information for people; the platform never decides LD entitlement.
contractAdminRouter.get('/contracts/:contractId/time-position', asyncHandler(async (req, res) => {
  const forecast = req.query.forecast_completion === undefined ? null : isoDate.parse(req.query.forecast_completion);
  const [p] = await query(`select * from contract_time_position($1::bigint, $2::date)`, [pid(req.params.contractId), forecast]);
  if (!p) throw new AppError(404, 'Contract not found');
  res.json({ success: true, data: p });
}));
contractAdminRouter.get('/contracts/:contractId/time-revisions', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await query(`select * from time_for_completion_revisions where contract_id=$1 and org_id=$2 order by revision_seq`, [pid(req.params.contractId), req.user!.org_id]) });
}));
contractAdminRouter.get('/contracts/:contractId/ld-terms', asyncHandler(async (req, res) => {
  const [t] = await query(`select * from contract_ld_terms where contract_id=$1 and org_id=$2`, [pid(req.params.contractId), req.user!.org_id]);
  res.json({ success: true, data: t ?? null });
}));
contractAdminRouter.post('/contracts/:contractId/ld-terms', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ basis: z.enum(['amount_per_day', 'percent_of_contract_value_per_day']), rate: z.number().positive(),
    cap_basis: z.enum(['none', 'amount', 'percent_of_contract_value']), cap_value: z.number().positive().optional(),
    clause_ref: z.string().trim().min(1).max(60), source_reference: z.string().trim().min(3).max(500) }).parse(req.body);
  if ((b.cap_basis === 'none') !== (b.cap_value === undefined)) throw new AppError(400, 'cap_value is required for a cap and not allowed without one');
  const [t] = await query(`insert into contract_ld_terms(org_id,contract_id,basis,rate,cap_basis,cap_value,clause_ref,source_reference,created_by) values($1,$2,$3,$4::numeric,$5,$6::numeric,$7,$8,$9) returning *`,
    [req.user!.org_id, pid(req.params.contractId), b.basis, String(b.rate), b.cap_basis, b.cap_value === undefined ? null : String(b.cap_value), b.clause_ref, b.source_reference, req.user!.id]);
  res.status(201).json({ success: true, data: t });
}));
contractAdminRouter.post('/ld-terms/:id/confirm', authorize('contracts', 'approve'), asyncHandler(async (req, res) => {
  const id = pid(req.params.id);
  const cur = (await query<any>(`select created_by,status from contract_ld_terms where id=$1 and org_id=$2`, [id, req.user!.org_id]))[0];
  if (!cur) throw new AppError(404, 'LD terms not found');
  if (cur.status !== 'draft') throw new AppError(409, 'LD terms are already confirmed');
  if (Number(cur.created_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: LD terms must be confirmed by someone other than their author');
  const [t] = await query(`update contract_ld_terms set status='confirmed',confirmed_by=$2,confirmed_at=now() where id=$1 and status='draft' returning *`, [id, req.user!.id]);
  if (!t) throw new AppError(409, 'LD terms are already confirmed');
  res.json({ success: true, data: t });
}));

// Stage 24 (F-37, migration 072): payment period stated in the contract, confirmed by a second person; receivable
// due dates are computed from it.
contractAdminRouter.get('/contracts/:contractId/payment-terms', asyncHandler(async (req, res) => {
  const [t] = await query(`select * from contract_payment_terms where contract_id=$1 and org_id=$2`, [pid(req.params.contractId), req.user!.org_id]);
  res.json({ success: true, data: t ?? null });
}));
contractAdminRouter.post('/contracts/:contractId/payment-terms', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ basis: z.enum(['after_submission', 'after_client_certification']), days: z.number().int().min(0).max(3650),
    clause_ref: z.string().trim().min(1).max(60), source_reference: z.string().trim().min(3).max(500) }).parse(req.body);
  const [t] = await query(`insert into contract_payment_terms(org_id,contract_id,basis,days,clause_ref,source_reference,created_by) values($1,$2,$3,$4,$5,$6,$7) returning *`,
    [req.user!.org_id, pid(req.params.contractId), b.basis, b.days, b.clause_ref, b.source_reference, req.user!.id]);
  res.status(201).json({ success: true, data: t });
}));
contractAdminRouter.post('/payment-terms/:id/confirm', authorize('contracts', 'approve'), asyncHandler(async (req, res) => {
  const id = pid(req.params.id);
  const cur = (await query<any>(`select created_by,status from contract_payment_terms where id=$1 and org_id=$2`, [id, req.user!.org_id]))[0];
  if (!cur) throw new AppError(404, 'Payment terms not found');
  if (cur.status !== 'draft') throw new AppError(409, 'Payment terms are already confirmed');
  if (Number(cur.created_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: payment terms must be confirmed by someone other than their author');
  const [t] = await query(`update contract_payment_terms set status='confirmed',confirmed_by=$2,confirmed_at=now() where id=$1 and status='draft' returning *`, [id, req.user!.id]);
  if (!t) throw new AppError(409, 'Payment terms are already confirmed');
  res.json({ success: true, data: t });
}));
