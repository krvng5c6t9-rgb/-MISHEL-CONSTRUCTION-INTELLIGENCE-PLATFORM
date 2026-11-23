import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';
import { decryptSecret, encryptSecret } from '../../services/mfa.service.js';
import { buildDocument, canonical, missingFor, sign, submissionStatus, submit, token, type EtaInputs } from './egEta.js';

// CC-096 (Stage 67): electronic invoicing. Scheme-neutral routes; the scheme adapter (egEta.ts) builds, serializes and
// talks to the authority. finance.view reads; finance.manage sets the company profile, tax-code mapping and client data;
// finance.create prepares a document; finance.approve submits it (the person who prepared it may not submit it).
export const einvoiceRouter = Router();
einvoiceRouter.use(authorize('finance', 'view'));
const SCHEMES = ['eg_eta'] as const;
const scheme = z.enum(SCHEMES);
const ELIGIBLE = ['client_approved', 'posted', 'paid'];

einvoiceRouter.get('/profiles/:scheme', asyncHandler(async (req, res) => {
  const s = scheme.parse(req.params.scheme);
  const [p] = await query(`select scheme, environment, client_id, secret_last4, issuer, defaults, signer_url, enabled, updated_at from einvoice_profiles where org_id = $1 and scheme = $2`, [req.user!.org_id, s]);
  res.json({ success: true, data: p ?? null });
}));

einvoiceRouter.put('/profiles/:scheme', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const s = scheme.parse(req.params.scheme);
  const b = z.object({ environment: z.enum(['test', 'production']), client_id: z.string().trim().min(3).max(200).optional(), client_secret: z.string().min(6).max(500).optional(),
    issuer: z.record(z.any()).default({}), defaults: z.record(z.any()).default({}), signer_url: z.string().url().max(500).nullable().optional(), enabled: z.boolean() }).parse(req.body);
  const [cur] = await query<any>(`select client_id, secret_last4 from einvoice_profiles where org_id = $1 and scheme = $2`, [req.user!.org_id, s]);
  if (b.enabled && !(b.client_id ?? cur?.client_id) ) throw new AppError(422, 'Enter the credentials issued by the tax authority before enabling electronic invoicing');
  if (b.enabled && !(b.client_secret || cur?.secret_last4)) throw new AppError(422, 'Enter the credentials issued by the tax authority before enabling electronic invoicing');
  await query(`insert into einvoice_profiles (org_id, scheme, environment, client_id, client_secret_enc, secret_last4, issuer, defaults, signer_url, enabled, updated_by)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    on conflict (org_id, scheme) do update set environment = excluded.environment, client_id = coalesce(excluded.client_id, einvoice_profiles.client_id),
      client_secret_enc = coalesce(excluded.client_secret_enc, einvoice_profiles.client_secret_enc), secret_last4 = coalesce(excluded.secret_last4, einvoice_profiles.secret_last4),
      issuer = excluded.issuer, defaults = excluded.defaults, signer_url = excluded.signer_url, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()`,
    [req.user!.org_id, s, b.environment, b.client_id ?? null, b.client_secret ? encryptSecret(b.client_secret) : null, b.client_secret ? b.client_secret.slice(-4) : null,
      b.issuer, b.defaults, b.signer_url ?? null, b.enabled, req.user!.id]);
  const [p] = await query(`select scheme, environment, client_id, secret_last4, issuer, defaults, signer_url, enabled, updated_at from einvoice_profiles where org_id = $1 and scheme = $2`, [req.user!.org_id, s]);
  res.json({ success: true, data: p });
}));

einvoiceRouter.put('/tax-codes/:id', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ einvoice_tax_type: z.string().regex(/^[A-Z0-9]{1,10}$/).nullable(), einvoice_sub_type: z.string().regex(/^[A-Z0-9]{1,10}$/).nullable() }).parse(req.body);
  const [r] = await query(`update tax_codes set einvoice_tax_type = $3, einvoice_sub_type = $4 where org_id = $1 and id = $2 returning id, code, einvoice_tax_type, einvoice_sub_type`,
    [req.user!.org_id, Number(req.params.id), b.einvoice_tax_type, b.einvoice_sub_type]);
  if (!r) throw new AppError(404, 'Tax code not found');
  res.json({ success: true, data: r });
}));

einvoiceRouter.put('/clients/:id', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const addr = z.object({ country: z.string().regex(/^[A-Z]{2}$/), governate: z.string().max(100).optional(), region_city: z.string().max(100).optional(), street: z.string().max(200).optional(),
    building_number: z.string().max(50).optional(), postal_code: z.string().max(20).optional() });
  const b = z.object({ party_type: z.enum(['business', 'person', 'foreign']), address: addr.nullable() }).parse(req.body);
  const [r] = await query(`update clients set einvoice_party_type = $3, einvoice_address = $4 where org_id = $1 and id = $2 returning id, client_name, tax_id, einvoice_party_type, einvoice_address`,
    [req.user!.org_id, Number(req.params.id), b.party_type, b.address]);
  if (!r) throw new AppError(404, 'Client not found');
  res.json({ success: true, data: r });
}));

// Company data the screen maps: output tax codes and clients, with their e-invoice fields.
einvoiceRouter.get('/lookups', asyncHandler(async (req, res) => {
  const [taxCodes, clients] = await Promise.all([
    query(`select id, code, name, rate::text as rate, status, einvoice_tax_type, einvoice_sub_type from tax_codes where org_id = $1 and kind = 'output_tax' order by code`, [req.user!.org_id]),
    query(`select id, client_name, tax_id, einvoice_party_type, einvoice_address from clients where org_id = $1 order by client_name limit 500`, [req.user!.org_id])]);
  res.json({ success: true, data: { tax_codes: taxCodes, clients } });
}));

// IPC data as the adapter needs it; base, tax and total come from the database (total = base + tax computed in SQL).
async function ipcInputs(orgId: number, ipcId: number) {
  const [r] = await query<any>(`
    select i.id, i.ipc_no, i.status, i.tax_treatment, i.output_tax_base::text as base, i.output_tax_amount::text as tax, (i.output_tax_base + i.output_tax_amount)::text as total,
           p.project_code, p.project_name, cur.code as currency, tc.einvoice_tax_type as tax_type, tc.einvoice_sub_type as sub_type, tc.rate::text as rate,
           cl.client_name, cl.tax_id, cl.einvoice_party_type as party_type, cl.einvoice_address as address
      from ipcs i join projects p on p.id = i.project_id join currencies cur on cur.id = p.currency_id join contracts k on k.id = i.contract_id
      join clients cl on cl.id = k.client_id left join tax_codes tc on tc.id = i.output_tax_code_id
     where i.org_id = $1 and i.id = $2`, [orgId, ipcId]);
  return r;
}
async function profileOf(orgId: number, s: string) {
  const [p] = await query<any>(`select * from einvoice_profiles where org_id = $1 and scheme = $2`, [orgId, s]);
  return p;
}
const inputsFrom = (p: any, r: any, issuedAt: string): EtaInputs => ({
  profile: { issuer: p?.issuer ?? {}, defaults: p?.defaults ?? {}, client_id: p?.client_id ?? null, secret_last4: p?.secret_last4 ?? null, signer_url: p?.signer_url ?? null, environment: p?.environment ?? 'test' },
  ipc: { ipc_no: r.ipc_no, project_code: r.project_code, project_name: r.project_name, currency: r.currency, base: r.base, tax: r.tax, total: r.total, tax_type: r.tax_type, sub_type: r.sub_type, rate: r.rate, tax_treatment: r.tax_treatment },
  client: { client_name: r.client_name, tax_id: r.tax_id, party_type: r.party_type, address: r.address }, issuedAt });
const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// IPCs that may be invoiced (certified by the client), with their latest document and what is still missing.
einvoiceRouter.get('/:scheme/ipcs', asyncHandler(async (req, res) => {
  const s = scheme.parse(req.params.scheme); const orgId = Number(req.user!.org_id);
  const p = await profileOf(orgId, s);
  const ids = await query<any>(`select i.id from ipcs i where i.org_id = $1 and i.status = any($2) order by i.id desc limit 200`, [orgId, ELIGIBLE]);
  const out = [];
  for (const { id } of ids) {
    const r = await ipcInputs(orgId, id);
    const [d] = await query<any>(`select id, status, provider_uuid, created_at from einvoice_documents where org_id = $1 and scheme = $2 and source_table = 'ipcs' and source_id = $3 order by id desc limit 1`, [orgId, s, id]);
    out.push({ ipc_id: id, ipc_no: r.ipc_no, ipc_status: r.status, project_code: r.project_code, client_name: r.client_name, currency: r.currency, base: r.base, tax: r.tax, total: r.total,
      missing: p ? missingFor(inputsFrom(p, r, nowUtc())) : ['profile'], document: d ?? null });
  }
  res.json({ success: true, data: out });
}));

const docCols = `d.id, d.scheme, d.environment, d.source_table, d.source_id, d.internal_id, d.document_json::json as payload, d.canonical_sha256, d.status, d.submission_id, d.provider_uuid,
  d.provider_long_id, d.last_error, d.last_response, d.submitted_at, d.status_checked_at, d.created_at, up.full_name as prepared_by_name, us.full_name as submitted_by_name`;
const docFrom = `from einvoice_documents d join users up on up.id = d.prepared_by left join users us on us.id = d.submitted_by`;

einvoiceRouter.get('/:scheme/documents', asyncHandler(async (req, res) => {
  const s = scheme.parse(req.params.scheme);
  res.json({ success: true, data: await query(`select ${docCols} ${docFrom} where d.org_id = $1 and d.scheme = $2 order by d.id desc limit 200`, [req.user!.org_id, s]) });
}));

einvoiceRouter.post('/:scheme/documents', authorize('finance', 'create'), asyncHandler(async (req, res) => {
  const s = scheme.parse(req.params.scheme); const orgId = Number(req.user!.org_id);
  const b = z.object({ ipc_id: z.number().int().positive() }).parse(req.body);
  const p = await profileOf(orgId, s);
  if (!p?.enabled) throw new AppError(422, 'Electronic invoicing is not enabled for this company');
  const r = await ipcInputs(orgId, b.ipc_id);
  if (!r) throw new AppError(404, 'IPC not found');
  if (!ELIGIBLE.includes(r.status)) throw new AppError(409, 'Only an IPC certified by the client is invoiced electronically');
  const inp = inputsFrom(p, r, nowUtc());
  const missing = missingFor(inp);
  if (missing.length) throw new AppError(422, 'Data needed for the electronic invoice is missing', { missing });
  const [active] = await query(`select id from einvoice_documents where org_id = $1 and scheme = $2 and source_table = 'ipcs' and source_id = $3
    and status not in ('invalid', 'rejected', 'failed', 'cancelled')`, [orgId, s, b.ipc_id]);
  if (active) throw new AppError(409, 'This IPC already has an active electronic invoice');
  const { internalId, doc } = buildDocument(inp);
  const text = canonical(doc), sha = createHash('sha256').update(text, 'utf8').digest('hex');
  const [d] = await query<any>(`insert into einvoice_documents (org_id, scheme, environment, source_table, source_id, internal_id, payload, document_json, canonical, canonical_sha256, prepared_by)
    values ($1, $2, $3, 'ipcs', $4, $5, $6, $10, $7, $8, $9) returning id`, [orgId, s, p.environment, b.ipc_id, internalId, doc, text, sha, req.user!.id, JSON.stringify(doc)]);
  const [out] = await query(`select ${docCols} ${docFrom} where d.id = $1`, [d.id]);
  res.status(201).json({ success: true, data: out });
}));

einvoiceRouter.post('/:scheme/documents/:id/submit', authorize('finance', 'approve'), asyncHandler(async (req, res) => {
  const s = scheme.parse(req.params.scheme); const orgId = Number(req.user!.org_id); const id = Number(req.params.id);
  const [d] = await query<any>(`select * from einvoice_documents where org_id = $1 and scheme = $2 and id = $3`, [orgId, s, id]);
  if (!d) throw new AppError(404, 'Electronic invoice not found');
  if (d.status !== 'prepared') throw new AppError(409, 'Only a prepared electronic invoice is submitted');
  if (Number(d.prepared_by) === Number(req.user!.id)) throw new AppError(403, 'The person who prepared an electronic invoice cannot submit it');
  const p = await profileOf(orgId, s);
  if (!p?.enabled) throw new AppError(422, 'Electronic invoicing is not enabled for this company');
  let signature: string | null = null;
  try {
    signature = await sign(p.signer_url, d.canonical, d.canonical_sha256);
    const tok = await token(d.environment, p.client_id, decryptSecret(p.client_secret_enc));
    const r = await submit(d.environment, tok, { ...JSON.parse(d.document_json), signatures: [{ signatureType: 'I', value: signature }] });
    const accepted = r.body?.acceptedDocuments?.[0], rejected = r.body?.rejectedDocuments?.[0];
    if (r.ok && accepted && r.body.submissionId) {
      await query(`update einvoice_documents set status = 'submitted', signature = $2, submission_id = $3, provider_uuid = $4, provider_long_id = $5, last_response = $6,
        submitted_by = $7, submitted_at = now() where id = $1`, [id, signature, String(r.body.submissionId), accepted.uuid ?? null, accepted.longId ?? null, r.body, req.user!.id]);
    } else {
      await query(`update einvoice_documents set status = 'rejected', signature = $2, last_response = $3, last_error = $4, submitted_by = $5 where id = $1`,
        [id, signature, r.body, JSON.stringify(rejected?.error ?? r.body?.error ?? r.body).slice(0, 2000), req.user!.id]);
    }
  } catch (err: any) {
    await query(`update einvoice_documents set status = 'failed', signature = coalesce(signature, $2), last_error = $3, last_response = $4, submitted_by = $5 where id = $1`,
      [id, signature, err.message, err.body ?? null, req.user!.id]);
  }
  const [out] = await query(`select ${docCols} ${docFrom} where d.id = $1`, [id]);
  res.json({ success: true, data: out });
}));

einvoiceRouter.post('/:scheme/documents/:id/refresh', authorize('finance', 'create'), asyncHandler(async (req, res) => {
  const s = scheme.parse(req.params.scheme); const orgId = Number(req.user!.org_id); const id = Number(req.params.id);
  const [d] = await query<any>(`select * from einvoice_documents where org_id = $1 and scheme = $2 and id = $3`, [orgId, s, id]);
  if (!d) throw new AppError(404, 'Electronic invoice not found');
  if (d.status !== 'submitted') throw new AppError(409, 'Only a submitted electronic invoice has a status to read');
  const p = await profileOf(orgId, s);
  const tok = await token(d.environment, p.client_id, decryptSecret(p.client_secret_enc)).catch((e: any) => { throw new AppError(502, e.message); });
  const r = await submissionStatus(d.environment, tok, d.submission_id);
  const item = (r.body?.documentSummary ?? []).find((x: any) => x.uuid === d.provider_uuid) ?? r.body?.documentSummary?.[0];
  const st = String(item?.status ?? '').toLowerCase();
  const next = st === 'valid' ? 'valid' : st === 'invalid' ? 'invalid' : 'submitted';
  await query(`update einvoice_documents set status = $2, last_response = $3, status_checked_at = now(), last_error = $4 where id = $1`,
    [id, next, r.body, next === 'invalid' ? JSON.stringify(item?.validationResults ?? item ?? {}).slice(0, 2000) : null]);
  const [out] = await query(`select ${docCols} ${docFrom} where d.id = $1`, [id]);
  res.json({ success: true, data: out });
}));
