import { Router } from 'express';
import { z } from 'zod';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

// Stage 20 (GC-12 steps 4-5, migration 069): subcontract advances and their recovery, back-charges applied to
// certificates, and the deductions position. The database enforces the limits; these routes add the
// segregation-of-duties answers (403) and readable 404/409s.
export const subcontractDeductionsRouter = Router();
subcontractDeductionsRouter.use(authorize('contracts', 'view'));

const pid = (v: string) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, 'Invalid id'); return n; };
const id = z.number().int().positive();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
async function one(table: 'subcontract_advances' | 'subcontract_backcharges', rowId: number, orgId: number, label: string) {
  const [r] = await query<any>(`select * from ${table} where id = $1 and org_id = $2`, [rowId, orgId]);
  if (!r) throw new AppError(404, `${label} not found`);
  return r;
}

// --- Advances.
subcontractDeductionsRouter.post('/advances', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ subcontract_id: id, amount: z.number().positive(), recovery_percent: z.number().positive().max(100).optional(), guarantee_ref: z.string().trim().min(3).max(100).optional() }).parse(req.body);
  const [a] = await query(`insert into subcontract_advances(org_id, subcontract_id, amount, recovery_percent, guarantee_ref, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
    [req.user!.org_id, b.subcontract_id, b.amount, b.recovery_percent ?? null, b.guarantee_ref ?? null, req.user!.id]);
  res.status(201).json({ success: true, data: a });
}));
subcontractDeductionsRouter.get('/advances', asyncHandler(async (req, res) => {
  const q = z.object({ subcontract_id: z.coerce.number().int().positive() }).parse(req.query);
  res.json({ success: true, data: await query(`select * from subcontract_advances where org_id = $1 and subcontract_id = $2 order by id`, [req.user!.org_id, q.subcontract_id]) });
}));
subcontractDeductionsRouter.post('/advances/:id/approve', authorize('contracts', 'approve'), asyncHandler(async (req, res) => {
  const a = await one('subcontract_advances', pid(req.params.id), req.user!.org_id, 'Advance');
  if (Number(a.created_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: an advance is approved by someone other than its preparer');
  if (a.status !== 'draft') throw new AppError(409, 'Only a draft advance can be approved');
  const [r] = await query(`update subcontract_advances set status = 'approved', approved_by = $2, approved_at = now() where id = $1 returning *`, [a.id, req.user!.id]);
  res.json({ success: true, data: r });
}));
subcontractDeductionsRouter.post('/advances/:id/paid', authorize('contracts', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ payment_reference: z.string().trim().min(3).max(100) }).parse(req.body);
  const a = await one('subcontract_advances', pid(req.params.id), req.user!.org_id, 'Advance');
  if (Number(a.created_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: the preparer cannot record the advance as paid');
  if (a.status !== 'approved') throw new AppError(409, 'Only an approved advance can be recorded as paid');
  const [r] = await query(`update subcontract_advances set status = 'paid', paid_by = $2, paid_at = now(), payment_reference = $3 where id = $1 returning *`, [a.id, req.user!.id, b.payment_reference]);
  res.json({ success: true, data: r });
}));

// --- Back-charges.
subcontractDeductionsRouter.post('/backcharges', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ subcontract_id: id, reference: z.string().trim().min(1).max(40), cause: z.string().trim().min(10), amount: z.number().positive(), evidence_document_id: id.optional(), notified_on: isoDate.optional() }).parse(req.body);
  const [r] = await query(`insert into subcontract_backcharges(org_id, subcontract_id, reference, cause, amount, evidence_document_id, notified_on, raised_by) values ($1,$2,$3,$4,$5,$6,$7::date,$8) returning *`,
    [req.user!.org_id, b.subcontract_id, b.reference, b.cause, b.amount, b.evidence_document_id ?? null, b.notified_on ?? null, req.user!.id]);
  res.status(201).json({ success: true, data: r });
}));
subcontractDeductionsRouter.get('/backcharges', asyncHandler(async (req, res) => {
  const q = z.object({ subcontract_id: z.coerce.number().int().positive() }).parse(req.query);
  res.json({ success: true, data: await query(`select * from subcontract_backcharges where org_id = $1 and subcontract_id = $2 order by id`, [req.user!.org_id, q.subcontract_id]) });
}));
subcontractDeductionsRouter.post('/backcharges/:id/notify', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ notified_on: isoDate }).parse(req.body);
  const c = await one('subcontract_backcharges', pid(req.params.id), req.user!.org_id, 'Back-charge');
  if (c.status !== 'raised') throw new AppError(409, 'The notice date is recorded while the back-charge is raised');
  const [r] = await query(`update subcontract_backcharges set notified_on = $2::date where id = $1 returning *`, [c.id, b.notified_on]);
  res.json({ success: true, data: r });
}));
subcontractDeductionsRouter.post('/backcharges/:id/approve', authorize('contracts', 'approve'), asyncHandler(async (req, res) => {
  const c = await one('subcontract_backcharges', pid(req.params.id), req.user!.org_id, 'Back-charge');
  if (Number(c.raised_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: a back-charge is approved by someone other than the person who raised it');
  if (c.status !== 'raised') throw new AppError(409, 'Only a raised back-charge can be approved');
  if (!c.notified_on) throw new AppError(422, 'The subcontractor must be notified of the back-charge before it is approved (record the notice date)');
  const [r] = await query(`update subcontract_backcharges set status = 'approved', approved_by = $2, approved_at = now() where id = $1 returning *`, [c.id, req.user!.id]);
  res.json({ success: true, data: r });
}));
subcontractDeductionsRouter.post('/backcharges/:id/response', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ response: z.enum(['accepted', 'disputed']), note: z.string().trim().min(5) }).parse(req.body);
  const c = await one('subcontract_backcharges', pid(req.params.id), req.user!.org_id, 'Back-charge');
  if (c.status === 'withdrawn') throw new AppError(409, 'Back-charge is withdrawn');
  const [r] = await query(`update subcontract_backcharges set subcontractor_response = $2, response_note = $3 where id = $1 returning *`, [c.id, b.response, b.note]);
  res.json({ success: true, data: r });
}));
subcontractDeductionsRouter.post('/backcharges/:id/apply', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ certificate_id: id }).parse(req.body);
  const c = await one('subcontract_backcharges', pid(req.params.id), req.user!.org_id, 'Back-charge');
  if (c.status !== 'approved') throw new AppError(409, 'Only an approved back-charge can be applied to a certificate');
  const [r] = await query(`update subcontract_backcharges set status = 'applied', certificate_id = $2 where id = $1 returning *`, [c.id, b.certificate_id]);
  res.json({ success: true, data: r });
}));
subcontractDeductionsRouter.post('/backcharges/:id/detach', authorize('contracts', 'create'), asyncHandler(async (req, res) => {
  const c = await one('subcontract_backcharges', pid(req.params.id), req.user!.org_id, 'Back-charge');
  if (c.status !== 'applied') throw new AppError(409, 'Back-charge is not applied to a certificate');
  const [r] = await query(`update subcontract_backcharges set status = 'approved', certificate_id = null where id = $1 returning *`, [c.id]);
  res.json({ success: true, data: r });
}));
subcontractDeductionsRouter.post('/backcharges/:id/withdraw', authorize('contracts', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ reason: z.string().trim().min(5) }).parse(req.body);
  const c = await one('subcontract_backcharges', pid(req.params.id), req.user!.org_id, 'Back-charge');
  if (!['raised', 'approved'].includes(c.status)) throw new AppError(409, 'Only a raised or approved (not applied) back-charge can be withdrawn');
  const [r] = await query(`update subcontract_backcharges set status = 'withdrawn', withdrawn_reason = $2 where id = $1 returning *`, [c.id, b.reason]);
  res.json({ success: true, data: r });
}));

// --- Retention withheld from subcontractors (DEC-012, migration 077): a liability per certificate, released by a
// reasoned decision (taking-over / defects certificate reference) into its own payable.
subcontractDeductionsRouter.get('/retentions', asyncHandler(async (req, res) => {
  const q = z.object({ subcontract_id: z.coerce.number().int().positive() }).parse(req.query);
  res.json({ success: true, data: await query(`select * from subcontract_retentions where org_id = $1 and subcontract_id = $2 order by id`, [req.user!.org_id, q.subcontract_id]) });
}));
subcontractDeductionsRouter.post('/retentions/:id/release', authorize('contracts', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ reason: z.string().trim().min(10), reference: z.string().trim().min(3).max(100) }).parse(req.body);
  const client = await getClient();
  try {
    await client.query('begin');
    const r = (await client.query(`select r.*, c.created_by as cert_maker, s.vendor_id, s.project_id, s.currency_id from subcontract_retentions r
      join subcontract_certificates c on c.id = r.certificate_id join subcontracts s on s.id = r.subcontract_id
      where r.id = $1 and r.org_id = $2 for update of r`, [pid(req.params.id), req.user!.org_id])).rows[0];
    if (!r) throw new AppError(404, 'Retention not found');
    if (r.status !== 'held') throw new AppError(409, 'Retention is already released');
    if (Number(r.cert_maker) === req.user!.id) throw new AppError(403, 'Segregation of duties: the certificate maker cannot release its retention');
    const ap = (await client.query(`insert into accounts_payable (org_id, vendor_id, project_id, source_type, source_record_id, amount, currency_id)
      values ($1,$2,$3,'subcontract_retention',$4,$5,$6) returning *`, [r.org_id, r.vendor_id, r.project_id, r.id, r.amount, r.currency_id])).rows[0];
    const [u] = (await client.query(`update subcontract_retentions set status = 'released', release_reason = $2, release_reference = $3, released_by = $4,
      released_at = now(), release_payable_id = $5 where id = $1 returning *`, [r.id, b.reason, b.reference, req.user!.id, ap.id])).rows;
    await client.query('commit');
    res.json({ success: true, data: { retention: u, accounts_payable: ap } });
  } catch (e) { await client.query('rollback'); throw e; } finally { await releaseClient(client); }
}));

// --- Position (information for the QS preparing the next certificate).
subcontractDeductionsRouter.get('/:id/deductions-position', asyncHandler(async (req, res) => {
  const [r] = await query<any>(`select subcontract_deductions_position(id) as position from subcontracts where id = $1 and org_id = $2`, [pid(req.params.id), req.user!.org_id]);
  if (!r) throw new AppError(404, 'Subcontract not found');
  res.json({ success: true, data: r.position });
}));
