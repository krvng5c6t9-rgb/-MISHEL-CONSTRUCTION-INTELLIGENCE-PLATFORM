import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

// CC-092 (Stage 63, A-006; migration 097): letters of guarantee / bank bonds. Recording and amending need
// finance.create; activating (confirming the guarantee was issued / received as recorded), releasing, recording a
// claim and marking expired need finance.approve, and activation must be done by someone other than the preparer
// (database rule). Every rule on amounts, dates and states is enforced by the database; the API only shapes requests.
export const guaranteesRouter = Router();
guaranteesRouter.use(authorize('finance', 'view'));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.union([z.string(), z.number()]).transform(v => String(v).trim()).refine(v => /^\d{1,16}(\.\d{1,2})?$/.test(v), 'Invalid amount');
const id = z.coerce.number().int().positive();
const body = z.object({
  direction: z.enum(['issued', 'received']), guarantee_type: z.enum(['bid', 'advance_payment', 'performance', 'retention', 'maintenance']),
  tender_id: id.nullable().optional(), project_id: id.nullable().optional(), contract_id: id.nullable().optional(), subcontract_id: id.nullable().optional(),
  client_id: id.nullable().optional(), vendor_id: id.nullable().optional(),
  bank_name: z.string().trim().min(2).max(150), bank_reference: z.string().trim().min(2).max(80), currency_id: id, amount: money,
  issue_date: isoDate, expiry_date: isoDate, cash_margin: money.nullable().optional(),
  commission_rate_pct: z.union([z.string(), z.number()]).transform(v => String(v).trim()).refine(v => /^\d{1,3}(\.\d{1,4})?$/.test(v), 'Invalid rate').nullable().optional(),
  notes: z.string().max(2000).nullable().optional()
});
const cols = ['direction', 'guarantee_type', 'tender_id', 'project_id', 'contract_id', 'subcontract_id', 'client_id', 'vendor_id', 'bank_name', 'bank_reference',
  'currency_id', 'amount', 'issue_date', 'expiry_date', 'cash_margin', 'commission_rate_pct', 'notes'] as const;

const listSql = `
  select g.*, g.amount::text as amount, g.current_amount::text as current_amount, g.cash_margin::text as cash_margin, g.claimed_amount::text as claimed_amount,
         g.issue_date::text as issue_date, g.expiry_date::text as expiry_date, g.current_expiry::text as current_expiry, g.closed_on::text as closed_on,
         cur.code as currency, p.project_code, p.project_name, t.tender_title, cl.client_name, v.vendor_name,
         (g.current_expiry - current_date) as days_to_expiry, up.full_name as prepared_by_name, ua.full_name as activated_by_name,
         coalesce((select json_agg(json_build_object('id', a.id, 'kind', a.kind, 'new_amount', a.new_amount::text, 'new_expiry', a.new_expiry::text,
                   'effective_date', a.effective_date::text, 'bank_reference', a.bank_reference, 'reason', a.reason, 'created_at', a.created_at) order by a.id)
                   from bank_guarantee_amendments a where a.guarantee_id = g.id), '[]') as amendments
    from bank_guarantees g join currencies cur on cur.id = g.currency_id
    left join projects p on p.id = g.project_id left join tenders t on t.id = g.tender_id
    left join clients cl on cl.id = g.client_id left join vendors_subcontractors v on v.id = g.vendor_id
    left join users up on up.id = g.prepared_by left join users ua on ua.id = g.activated_by`;
const one = async (orgId: number, gid: number) => {
  const [g] = await query<any>(`${listSql} where g.org_id = $1 and g.id = $2`, [orgId, gid]);
  if (!g) throw new AppError(404, 'Guarantee not found');
  return g;
};

guaranteesRouter.get('/guarantees', asyncHandler(async (req, res) => {
  const q = z.object({ status: z.enum(['draft', 'active', 'released', 'claimed', 'expired']).optional(), direction: z.enum(['issued', 'received']).optional(),
    project_id: id.optional() }).parse(req.query);
  const params: unknown[] = [req.user!.org_id]; const where: string[] = ['g.org_id = $1'];
  if (q.status) { params.push(q.status); where.push(`g.status = $${params.length}`); }
  if (q.direction) { params.push(q.direction); where.push(`g.direction = $${params.length}`); }
  if (q.project_id) { params.push(q.project_id); where.push(`g.project_id = $${params.length}`); }
  res.json({ success: true, data: await query(`${listSql} where ${where.join(' and ')} order by g.status = 'active' desc, g.current_expiry, g.id`, params) });
}));

// Exposure of active guarantees per currency, direction and type, with what expires in 30 / 90 days (database sums).
guaranteesRouter.get('/guarantees/summary', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await query(`
    select cur.code as currency, g.direction, g.guarantee_type, count(*)::int as count, sum(g.current_amount)::text as amount,
           coalesce(sum(g.cash_margin), 0)::text as cash_margin,
           coalesce(sum(g.current_amount) filter (where g.current_expiry <= current_date + 30), 0)::text as expiring_30,
           coalesce(sum(g.current_amount) filter (where g.current_expiry <= current_date + 90), 0)::text as expiring_90,
           count(*) filter (where g.current_expiry < current_date)::int as past_expiry
      from bank_guarantees g join currencies cur on cur.id = g.currency_id
     where g.org_id = $1 and g.status = 'active' group by cur.code, g.direction, g.guarantee_type order by 1, 2, 3`, [req.user!.org_id]) });
}));

// Names for the form (ids and names only, under finance.view - as the cut-over lookup, F-51): projects, tenders,
// clients, vendors, contracts, subcontracts and the currencies the company uses.
guaranteesRouter.get('/guarantees/lookups', asyncHandler(async (req, res) => {
  const org = req.user!.org_id;
  const [projects, tenders, clients, vendors, contracts, subcontracts, currencies] = await Promise.all([
    query(`select id, project_code, project_name from projects where org_id = $1 order by project_code`, [org]),
    query(`select id, tender_title from tenders where org_id = $1 order by id desc limit 500`, [org]),
    query(`select id, client_name from clients where org_id = $1 order by client_name`, [org]),
    query(`select id, vendor_name from vendors_subcontractors where org_id = $1 order by vendor_name`, [org]),
    query(`select id, project_id, client_id from contracts where org_id = $1 order by id`, [org]),
    query(`select id, project_id, vendor_id, package_name from subcontracts where org_id = $1 order by id`, [org]),
    query(`select c.id, c.code from currencies c where c.id = (select base_currency_id from organizations where id = $1)
             or exists (select 1 from org_currencies oc where oc.org_id = $1 and oc.currency_id = c.id) order by c.code`, [org])]);
  res.json({ success: true, data: { projects, tenders, clients, vendors, contracts, subcontracts, currencies } });
}));

guaranteesRouter.get('/guarantees/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await one(Number(req.user!.org_id), id.parse(req.params.id)) });
}));

guaranteesRouter.post('/guarantees', authorize('finance', 'create'), asyncHandler(async (req, res) => {
  const b = body.parse(req.body);
  const vals = cols.map(c => (b as any)[c] ?? null);
  const [r] = await query<any>(`insert into bank_guarantees(org_id, prepared_by, direction, guarantee_type, tender_id, project_id, contract_id, subcontract_id, client_id,
      vendor_id, bank_name, bank_reference, currency_id, amount, issue_date, expiry_date, cash_margin, commission_rate_pct, notes)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) returning id`,
    [req.user!.org_id, req.user!.id, ...vals]);
  res.status(201).json({ success: true, data: await one(Number(req.user!.org_id), r.id) });
}));

guaranteesRouter.patch('/guarantees/:id', authorize('finance', 'create'), asyncHandler(async (req, res) => {
  const gid = id.parse(req.params.id); const b = body.parse(req.body);
  const g = await one(Number(req.user!.org_id), gid);
  if (g.status !== 'draft') throw new AppError(409, 'Only a draft guarantee is edited; an active one changes by an amendment');
  await query(`update bank_guarantees set direction = $3, guarantee_type = $4, tender_id = $5, project_id = $6, contract_id = $7, subcontract_id = $8, client_id = $9,
      vendor_id = $10, bank_name = $11, bank_reference = $12, currency_id = $13, amount = $14, issue_date = $15, expiry_date = $16, cash_margin = $17,
      commission_rate_pct = $18, notes = $19 where org_id = $1 and id = $2`,
    [req.user!.org_id, gid, ...cols.map(c => (b as any)[c] ?? null)]);
  res.json({ success: true, data: await one(Number(req.user!.org_id), gid) });
}));

guaranteesRouter.delete('/guarantees/:id', authorize('finance', 'create'), asyncHandler(async (req, res) => {
  const gid = id.parse(req.params.id); await one(Number(req.user!.org_id), gid);
  await query(`delete from bank_guarantees where org_id = $1 and id = $2`, [req.user!.org_id, gid]);
  res.json({ success: true, data: { id: gid, deleted: true } });
}));

guaranteesRouter.post('/guarantees/:id/activate', authorize('finance', 'approve'), asyncHandler(async (req, res) => {
  const gid = id.parse(req.params.id); const g = await one(Number(req.user!.org_id), gid);
  if (g.status !== 'draft') throw new AppError(409, 'Only a draft guarantee is activated');
  if (Number(g.prepared_by) === Number(req.user!.id)) throw new AppError(403, 'The person who recorded a guarantee cannot activate it');
  await query(`update bank_guarantees set status = 'active', activated_by = $3, activated_at = now() where org_id = $1 and id = $2`, [req.user!.org_id, gid, req.user!.id]);
  res.json({ success: true, data: await one(Number(req.user!.org_id), gid) });
}));

guaranteesRouter.post('/guarantees/:id/amendments', authorize('finance', 'create'), asyncHandler(async (req, res) => {
  const gid = id.parse(req.params.id);
  const b = z.object({ kind: z.enum(['extension', 'reduction', 'increase']), new_amount: money.optional(), new_expiry: isoDate.optional(), effective_date: isoDate,
    bank_reference: z.string().trim().min(2).max(80), reason: z.string().trim().min(10).max(2000) }).parse(req.body);
  if (b.kind === 'extension' ? !b.new_expiry || b.new_amount : !b.new_amount || b.new_expiry) throw new AppError(422, 'An extension gives a new expiry; a reduction or increase gives a new amount');
  await one(Number(req.user!.org_id), gid);
  await query(`insert into bank_guarantee_amendments(org_id, guarantee_id, kind, new_amount, new_expiry, effective_date, bank_reference, reason, created_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [req.user!.org_id, gid, b.kind, b.new_amount ?? null, b.new_expiry ?? null, b.effective_date, b.bank_reference, b.reason, req.user!.id]);
  res.status(201).json({ success: true, data: await one(Number(req.user!.org_id), gid) });
}));

const close = (status: 'released' | 'claimed' | 'expired') => asyncHandler(async (req, res) => {
  const gid = id.parse(req.params.id);
  const b = z.object({ closed_on: isoDate, reference: z.string().trim().min(2).max(200).optional(), claimed_amount: money.optional(), reason: z.string().trim().min(10).max(2000).optional() }).parse(req.body);
  const g = await one(Number(req.user!.org_id), gid);
  if (g.status !== 'active') throw new AppError(409, 'Only an active guarantee is released, claimed or marked expired');
  if (status === 'released' && !b.reference) throw new AppError(422, 'A release needs the reference of the release letter');
  if (status === 'claimed' && (!b.claimed_amount || !b.reason)) throw new AppError(422, 'A claim needs the amount claimed and the reason');
  await query(`update bank_guarantees set status = $3, closed_on = $4, closed_by = $5, close_reference = $6, claimed_amount = $7, claim_reason = $8 where org_id = $1 and id = $2`,
    [req.user!.org_id, gid, status, b.closed_on, req.user!.id, b.reference ?? null, status === 'claimed' ? b.claimed_amount : null, status === 'claimed' ? b.reason : null]);
  res.json({ success: true, data: await one(Number(req.user!.org_id), gid) });
});
guaranteesRouter.post('/guarantees/:id/release', authorize('finance', 'approve'), close('released'));
guaranteesRouter.post('/guarantees/:id/claim', authorize('finance', 'approve'), close('claimed'));
guaranteesRouter.post('/guarantees/:id/expire', authorize('finance', 'approve'), close('expired'));
