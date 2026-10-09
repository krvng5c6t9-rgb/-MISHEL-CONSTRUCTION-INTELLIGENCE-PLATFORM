import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

// Stage 26 (DEC-016/DEC-017, migration 074): tax codes, contract/subcontract tax profiles, e-invoice reference and the
// tax position. The system holds no rate of its own: every rate is entered with its legal reference and source and
// confirmed by a second person; the database enforces versions, immutability and computation.
export const taxRouter = Router();
taxRouter.use(authorize('finance', 'view'));

const pid = (v: string) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, 'Invalid id'); return n; };
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const code = z.string().trim().min(2).max(30);

taxRouter.get('/tax-codes', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await query(`select * from tax_codes where org_id = $1 order by code, effective_from`, [req.user!.org_id]) });
}));
taxRouter.post('/tax-codes', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ code, name: z.string().trim().min(3).max(200), kind: z.enum(['output_tax', 'input_tax', 'withheld_by_client', 'withheld_from_supplier']),
    rate: z.number().min(0).max(100).optional(), base: z.enum(['certified_net', 'certified_gross', 'as_per_certificate']), gl_account_id: z.number().int().positive(),
    effective_from: isoDate, legal_reference: z.string().trim().min(3).max(500), source_reference: z.string().trim().min(3).max(500) }).parse(req.body);
  const [t] = await query(`insert into tax_codes(org_id, code, name, kind, rate, base, gl_account_id, effective_from, legal_reference, source_reference, created_by)
    values ($1,$2,$3,$4,$5::numeric,$6,$7,$8::date,$9,$10,$11) returning *`,
    [req.user!.org_id, b.code, b.name, b.kind, b.rate === undefined ? null : String(b.rate), b.base, b.gl_account_id, b.effective_from, b.legal_reference, b.source_reference, req.user!.id]);
  res.status(201).json({ success: true, data: t });
}));
taxRouter.post('/tax-codes/:id/confirm', authorize('finance', 'approve'), asyncHandler(async (req, res) => {
  const [cur] = await query<any>(`select id, created_by, status from tax_codes where id = $1 and org_id = $2`, [pid(req.params.id), req.user!.org_id]);
  if (!cur) throw new AppError(404, 'Tax code not found');
  if (cur.status !== 'draft') throw new AppError(409, 'Tax code is already confirmed');
  if (Number(cur.created_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: a tax code is confirmed by someone other than its author');
  const [t] = await query(`update tax_codes set status = 'confirmed', confirmed_by = $2, confirmed_at = now() where id = $1 and status = 'draft' returning *`, [cur.id, req.user!.id]);
  res.json({ success: true, data: t });
}));
taxRouter.post('/tax-codes/:id/close', authorize('finance', 'approve'), asyncHandler(async (req, res) => {
  const b = z.object({ effective_to: isoDate }).parse(req.body);
  const [t] = await query(`update tax_codes set effective_to = $3::date where id = $1 and org_id = $2 returning *`, [pid(req.params.id), req.user!.org_id, b.effective_to]);
  if (!t) throw new AppError(404, 'Tax code not found');
  res.json({ success: true, data: t });
}));

const profileBody = (a: string, b: string) => z.object({ [a]: code.optional(), [b]: code.optional(), note: z.string().trim().min(10).max(500).optional() });
taxRouter.get('/contracts/:id/tax-profile', asyncHandler(async (req, res) => {
  const [p] = await query(`select * from contract_tax_profiles where contract_id = $1 and org_id = $2`, [pid(req.params.id), req.user!.org_id]);
  res.json({ success: true, data: p ?? null });
}));
taxRouter.post('/contracts/:id/tax-profile', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const b: any = profileBody('output_tax_code', 'client_withholding_code').parse(req.body);
  const [p] = await query(`insert into contract_tax_profiles(org_id, contract_id, output_tax_code, client_withholding_code, note, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
    [req.user!.org_id, pid(req.params.id), b.output_tax_code ?? null, b.client_withholding_code ?? null, b.note ?? null, req.user!.id]);
  res.status(201).json({ success: true, data: p });
}));
taxRouter.get('/subcontracts/:id/tax-profile', asyncHandler(async (req, res) => {
  const [p] = await query(`select * from subcontract_tax_profiles where subcontract_id = $1 and org_id = $2`, [pid(req.params.id), req.user!.org_id]);
  res.json({ success: true, data: p ?? null });
}));
taxRouter.post('/subcontracts/:id/tax-profile', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const b: any = profileBody('input_tax_code', 'supplier_withholding_code').parse(req.body);
  const [p] = await query(`insert into subcontract_tax_profiles(org_id, subcontract_id, input_tax_code, supplier_withholding_code, note, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
    [req.user!.org_id, pid(req.params.id), b.input_tax_code ?? null, b.supplier_withholding_code ?? null, b.note ?? null, req.user!.id]);
  res.status(201).json({ success: true, data: p });
}));
for (const [table, path] of [['contract_tax_profiles', 'contract'], ['subcontract_tax_profiles', 'subcontract']] as const) {
  taxRouter.post(`/tax-profiles/${path}/:id/confirm`, authorize('finance', 'approve'), asyncHandler(async (req, res) => {
    const [cur] = await query<any>(`select id, created_by, status from ${table} where id = $1 and org_id = $2`, [pid(req.params.id), req.user!.org_id]);
    if (!cur) throw new AppError(404, 'Tax profile not found');
    if (cur.status !== 'draft') throw new AppError(409, 'Tax profile is already confirmed');
    if (Number(cur.created_by) === req.user!.id) throw new AppError(403, 'Segregation of duties: a tax profile is confirmed by someone other than its author');
    const [p] = await query(`update ${table} set status = 'confirmed', confirmed_by = $2, confirmed_at = now() where id = $1 and status = 'draft' returning *`, [cur.id, req.user!.id]);
    res.json({ success: true, data: p });
  }));
}

taxRouter.post('/ipcs/:id/einvoice', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ uuid: z.string().trim().min(8).max(100) }).parse(req.body);
  const [cur] = await query<any>(`select id, status, einvoice_uuid from ipcs where id = $1 and org_id = $2`, [pid(req.params.id), req.user!.org_id]);
  if (!cur) throw new AppError(404, 'IPC not found');
  if (cur.einvoice_uuid) throw new AppError(409, 'The e-invoice reference is already recorded');
  const [i] = await query(`update ipcs set einvoice_uuid = $2, einvoice_recorded_at = now() where id = $1 returning id, ipc_no, einvoice_uuid, einvoice_recorded_at`, [cur.id, b.uuid]);
  res.json({ success: true, data: i });
}));

taxRouter.get('/tax/position', asyncHandler(async (req, res) => {
  const q = z.object({ from: isoDate, to: isoDate }).parse(req.query);
  res.json({ success: true, data: await query(`select * from tax_position($1::date, $2::date)`, [q.from, q.to]) });
}));
