import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getClient, query, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

// G-002: governed vendor / subcontractor master (migration 039). Status, prequalification, blacklist
// and bank details change only here, inside a transaction flagged app.vendor_governed, and every
// change writes an append-only vendor_status_events row.
export const vendorsRouter = Router();
vendorsRouter.use(authorize('vendors', 'view'));

const pid = (v: string) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, 'Invalid id'); return n; };
const reason = z.string().trim().min(5).max(2000);
const details = z.object({
  vendor_name: z.string().trim().min(2).max(200),
  vendor_type: z.enum(['supplier', 'subcontractor', 'both']).default('supplier'),
  trade_category: z.string().trim().max(100).optional().nullable(),
  contact_person: z.string().trim().max(150).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email().max(150).optional().nullable(),
  tax_id: z.string().trim().min(1).max(50).optional().nullable()
});
const mask = (acct: string | null) => acct ? `****${acct.slice(-4)}` : null;
const canSeeBank = (req: any) => { const granted: { module: string; action: string }[] = req.user.permissions; return granted.some(g => g.module === 'vendors' && g.action === 'approve'); };

async function governed<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await getClient();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.vendor_governed','on',true)`);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback'); throw e; } finally { await releaseClient(c); }
}
async function lockVendor(c: PoolClient, id: number) {
  const v = (await c.query(`select * from vendors_subcontractors where id=$1 for update`, [id])).rows[0];
  if (!v) throw new AppError(404, 'Vendor not found');
  return v;
}
const event = (c: PoolClient, v: any, ev: string, actor: number, why: string | null, detail: object = {}) =>
  c.query(`insert into vendor_status_events(org_id,vendor_id,event,reason,detail,actor_id) values($1,$2,$3,$4,$5,$6)`, [v.org_id, v.id, ev, why, JSON.stringify(detail), actor]);

vendorsRouter.get('/', asyncHandler(async (req, res) => {
  const rows = await query<any>(`select id,vendor_name,vendor_type,trade_category,contact_person,phone,email,tax_id,bank_name,bank_account_no,prequalification_status,is_blacklisted,is_active,created_at
    from vendors_subcontractors where ($1::text is null or vendor_type=$1 or vendor_type='both') order by vendor_name`, [typeof req.query.type === 'string' ? req.query.type : null]);
  const full = canSeeBank(req);
  res.json({ success: true, data: rows.map(r => ({ ...r, bank_account_no: full ? r.bank_account_no : mask(r.bank_account_no) })) });
}));

vendorsRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = pid(req.params.id);
  const v = (await query<any>(`select * from vendors_subcontractors where id=$1`, [id]))[0];
  if (!v) throw new AppError(404, 'Vendor not found');
  const events = await query(`select e.id,e.event,e.reason,e.detail,e.created_at,u.full_name actor from vendor_status_events e join users u on u.id=e.actor_id where e.vendor_id=$1 order by e.id`, [id]);
  const bankChanges = await query<any>(`select id,new_bank_name,new_bank_account_no,status,requested_by,decided_by,verification_method,created_at,decided_at from vendor_bank_change_requests where vendor_id=$1 order by id`, [id]);
  const full = canSeeBank(req);
  res.json({ success: true, data: { ...v, bank_account_no: full ? v.bank_account_no : mask(v.bank_account_no), events,
    bank_change_requests: bankChanges.map(b => ({ ...b, new_bank_account_no: full ? b.new_bank_account_no : mask(b.new_bank_account_no) })) } });
}));

vendorsRouter.post('/', authorize('vendors', 'create'), asyncHandler(async (req, res) => {
  const b = details.parse(req.body);
  const v = await governed(async c => {
    const row = (await c.query(`insert into vendors_subcontractors(org_id,vendor_name,vendor_type,trade_category,contact_person,phone,email,tax_id,created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [req.user!.org_id, b.vendor_name, b.vendor_type, b.trade_category ?? null, b.contact_person ?? null, b.phone ?? null, b.email ?? null, b.tax_id ?? null, req.user!.id])).rows[0];
    await event(c, row, 'created', req.user!.id, null);
    return row;
  });
  res.status(201).json({ success: true, data: v });
}));

vendorsRouter.patch('/:id', authorize('vendors', 'edit'), asyncHandler(async (req, res) => {
  const id = pid(req.params.id);
  const b = details.partial().parse(req.body);
  const keys = Object.keys(b) as (keyof typeof b)[];
  if (!keys.length) throw new AppError(400, 'No fields to update');
  const v = await governed(async c => {
    const old = await lockVendor(c, id);
    const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(',');
    const row = (await c.query(`update vendors_subcontractors set ${sets},updated_at=now() where id=$1 returning *`, [id, ...keys.map(k => b[k] ?? null)])).rows[0];
    await event(c, row, 'details_changed', req.user!.id, null, Object.fromEntries(keys.map(k => [k, { from: old[k], to: row[k] }])));
    return row;
  });
  res.json({ success: true, data: v });
}));

// Prequalification decision: by someone other than the person who created the vendor (SoD).
vendorsRouter.post('/:id/prequalification', authorize('vendors', 'approve'), asyncHandler(async (req, res) => {
  const id = pid(req.params.id);
  const b = z.object({ decision: z.enum(['approved', 'rejected', 'expired']), reason }).parse(req.body);
  const v = await governed(async c => {
    const old = await lockVendor(c, id);
    if (Number(old.created_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: the user who created the vendor cannot decide its prequalification');
    if (b.decision === 'approved' && old.is_blacklisted) throw new AppError(409, 'A blacklisted vendor cannot be prequalified');
    if (old.prequalification_status === b.decision) throw new AppError(409, `Vendor is already ${b.decision}`);
    const row = (await c.query(`update vendors_subcontractors set prequalification_status=$2,updated_at=now() where id=$1 returning *`, [id, b.decision])).rows[0];
    await event(c, row, `prequalification_${b.decision}`, req.user!.id, b.reason, { from: old.prequalification_status });
    return row;
  });
  res.json({ success: true, data: v });
}));

vendorsRouter.post('/:id/:action(blacklist|unblacklist|deactivate|reactivate)', authorize('vendors', 'approve'), asyncHandler(async (req, res) => {
  const id = pid(req.params.id);
  const action = req.params.action;
  const b = z.object({ reason }).parse(req.body);
  const v = await governed(async c => {
    const old = await lockVendor(c, id);
    const map: Record<string, [string, string, boolean, string]> = {
      blacklist: ['is_blacklisted', 'blacklisted', true, 'already blacklisted'], unblacklist: ['is_blacklisted', 'unblacklisted', false, 'not blacklisted'],
      deactivate: ['is_active', 'deactivated', false, 'already inactive'], reactivate: ['is_active', 'reactivated', true, 'already active']
    };
    const [col, ev, value, msg] = map[action];
    if (old[col] === value) throw new AppError(409, `Vendor is ${msg}`);
    if (action === 'unblacklist') {
      const last = (await c.query(`select actor_id from vendor_status_events where vendor_id=$1 and event='blacklisted' order by id desc limit 1`, [id])).rows[0];
      if (last && Number(last.actor_id) === req.user!.id) throw new AppError(403, 'Segregation of duties: the user who blacklisted the vendor cannot lift the blacklist');
    }
    const row = (await c.query(`update vendors_subcontractors set ${col}=$2,updated_at=now() where id=$1 returning *`, [id, value])).rows[0];
    await event(c, row, ev, req.user!.id, b.reason);
    return row;
  });
  res.json({ success: true, data: v });
}));

vendorsRouter.post('/:id/bank-change-requests', authorize('vendors', 'edit'), asyncHandler(async (req, res) => {
  const id = pid(req.params.id);
  const b = z.object({ new_bank_name: z.string().trim().min(2).max(150), new_bank_account_no: z.string().trim().regex(/^[A-Za-z0-9 -]{4,50}$/), reason }).parse(req.body);
  const c = await getClient();
  try {
    await c.query('begin');
    const v = await lockVendor(c, id);
    if ((await c.query(`select 1 from vendor_bank_change_requests where vendor_id=$1 and status='pending'`, [id])).rows[0]) throw new AppError(409, 'A bank change request is already pending for this vendor');
    const row = (await c.query(`insert into vendor_bank_change_requests(org_id,vendor_id,new_bank_name,new_bank_account_no,reason,requested_by) values($1,$2,$3,$4,$5,$6) returning id,vendor_id,new_bank_name,status,requested_by,created_at`,
      [v.org_id, id, b.new_bank_name, b.new_bank_account_no, b.reason, req.user!.id])).rows[0];
    await c.query('commit');
    res.status(201).json({ success: true, data: row });
  } catch (e) { await c.query('rollback'); throw e; } finally { await releaseClient(c); }
}));

// Decision by a different user, with the independent verification performed (STEP09: bank-master change is high risk).
vendorsRouter.post('/bank-change-requests/:id/:decision(approve|reject)', authorize('vendors', 'approve'), asyncHandler(async (req, res) => {
  const id = pid(req.params.id);
  const approve = req.params.decision === 'approve';
  const b = approve
    ? z.object({ verification_method: z.enum(['callback_to_known_contact', 'in_person_verification', 'signed_bank_letter_verified', 'other_documented']), verification_reference: z.string().trim().min(5).max(500), decision_note: z.string().max(2000).optional().nullable() }).parse(req.body)
    : z.object({ decision_note: reason }).parse(req.body);
  const out = await governed(async c => {
    const r = (await c.query(`select * from vendor_bank_change_requests where id=$1 for update`, [id])).rows[0];
    if (!r) throw new AppError(404, 'Bank change request not found');
    if (r.status !== 'pending') throw new AppError(409, 'Bank change request is not pending');
    if (Number(r.requested_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: the requester cannot decide their own bank change');
    const v = await lockVendor(c, Number(r.vendor_id));
    if (!approve) {
      return (await c.query(`update vendor_bank_change_requests set status='rejected',decided_by=$2,decided_at=now(),decision_note=$3 where id=$1 returning id,status`, [id, req.user!.id, (b as any).decision_note])).rows[0];
    }
    const clash = (await c.query(`select id from vendors_subcontractors where bank_account_no=$1 and id<>$2 and is_active`, [r.new_bank_account_no, v.id])).rows[0];
    if (clash) throw new AppError(409, 'This bank account is already registered to another active vendor');
    const a = b as { verification_method: string; verification_reference: string; decision_note?: string | null };
    const done = (await c.query(`update vendor_bank_change_requests set status='approved',decided_by=$2,decided_at=now(),verification_method=$3,verification_reference=$4,decision_note=$5 where id=$1 returning id,status`,
      [id, req.user!.id, a.verification_method, a.verification_reference, a.decision_note ?? null])).rows[0];
    await c.query(`update vendors_subcontractors set bank_name=$2,bank_account_no=$3,updated_at=now() where id=$1`, [v.id, r.new_bank_name, r.new_bank_account_no]);
    await event(c, v, 'bank_details_changed', req.user!.id, r.reason, { request_id: id, from: mask(v.bank_account_no), to: mask(r.new_bank_account_no), verification_method: a.verification_method });
    return done;
  });
  res.json({ success: true, data: out });
}));
