import { Router } from 'express';
import { z } from 'zod';
import { getClient, query, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';
import { details as vendorSchema, insertVendor } from '../vendors/vendors.routes.js';

// CC-107 (Stage 71): MARC supplier directory - platform data shared by every company (read-only here), searchable by
// trade, country, city and text, with each record's source and verification status; a company adopts a directory
// supplier into its own vendors through the same insert as the vendor screen (vendor rules, created event, audit).
export const directoryRouter = Router();
directoryRouter.use(authorize('vendors', 'view'));

const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const MAX_TEXT_FILTER = 120;
const MAX_PAGE = 10000;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;
const MAX_VENDOR_PHONE = 30;
const MAX_VENDOR_EMAIL = 150;
const MAX_VENDOR_NAME = 200;
const MAX_VENDOR_TRADE = 100;
const COUNTRIES = ['EG', 'SA', 'AE'] as const;
// Trade code: lower-case letter then letters, digits or underscores, 2-40 chars.
// Accepts "ceramic_porcelain", "hvac"; rejects "Ceramic", "1abc", "a" (https://regex101.com/?regex=%5E%5Ba-z%5D%5Ba-z0-9_%5D%7B1%2C39%7D%24).
const TRADE_CODE = /^[a-z][a-z0-9_]{1,39}$/;
// LIKE wildcards and the escape character, escaped so a search text is matched literally.
// Matches "%" in "50%", "_" in "a_b", "\\" in "a\\b"; leaves "abc" unchanged (https://regex101.com/?regex=%5B%5C%5C%25_%5D).
const LIKE_SPECIAL = /[\\%_]/g;

interface DirectorySupplierRow { id: number; name: string; email: string | null; phones: string[]; trade_names: string }

directoryRouter.get('/trades', asyncHandler(async (req, res) => {
  const country = z.enum(COUNTRIES).optional().parse(req.query.country || undefined);
  const rows = await query(`select t.code, t.parent_code, t.name_en, t.name_ar, t.sort_order,
      (select count(*) from directory_supplier_trades st join directory_suppliers s on s.id = st.supplier_id
        where (st.trade_code = t.code or st.trade_code in (select c.code from directory_trades c where c.parent_code = t.code))
          and ($1::text is null or s.country = $1) and s.verification_status <> 'rejected')::int as suppliers
    from directory_trades t order by t.sort_order, t.code`, [country ?? null]);
  res.json({ success: true, data: rows });
}));

const search = z.object({
  country: z.enum(COUNTRIES).optional(), trade: z.string().regex(TRADE_CODE).optional(),
  city: z.string().trim().max(MAX_TEXT_FILTER).optional(), q: z.string().trim().max(MAX_TEXT_FILTER).optional(),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1), page_size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
});
directoryRouter.get('/suppliers', asyncHandler(async (req, res) => {
  const f = search.parse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
  const params: unknown[] = [], where = [`s.verification_status <> 'rejected'`];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.country) where.push(`s.country = ${p(f.country)}`);
  if (f.trade) where.push(`exists (select 1 from directory_supplier_trades st where st.supplier_id = s.id and (st.trade_code = ${p(f.trade)}
    or st.trade_code in (select c.code from directory_trades c where c.parent_code = $${params.length})))`);
  if (f.city) where.push(`lower(s.city) = lower(${p(f.city)})`);
  if (f.q) where.push(`(s.name ilike ${p('%' + f.q.replace(LIKE_SPECIAL, (m) => '\\' + m) + '%')} or s.description ilike $${params.length} or s.address ilike $${params.length})`);
  const w = where.join(' and ');
  const [{ total }] = await query<{ total: number }>(`select count(*)::int as total from directory_suppliers s where ${w}`, params);
  const rows = await query(`select s.id, s.country, s.name, s.city, s.address, s.phones, s.email, s.website, s.description, s.source, s.source_url,
      s.fetched_at, s.verification_status,
      coalesce((select array_agg(st.trade_code order by st.trade_code) from directory_supplier_trades st where st.supplier_id = s.id), '{}') as trades,
      (select l.vendor_id from vendor_directory_links l where l.directory_supplier_id = s.id) as my_vendor_id
    from directory_suppliers s where ${w} order by s.name, s.id limit ${p(f.page_size)} offset ${p((f.page - 1) * f.page_size)}`, params);
  res.json({ success: true, data: { total, page: f.page, page_size: f.page_size, rows } });
}));

directoryRouter.get('/suppliers/:id', asyncHandler(async (req, res) => {
  const [r] = await query(`select s.*, coalesce((select array_agg(st.trade_code) from directory_supplier_trades st where st.supplier_id = s.id), '{}') as trades,
      (select l.vendor_id from vendor_directory_links l where l.directory_supplier_id = s.id) as my_vendor_id
    from directory_suppliers s where s.id = $1`, [Number(req.params.id)]);
  if (!r) throw new AppError(HTTP_NOT_FOUND, 'Directory supplier not found');
  res.json({ success: true, data: r });
}));

directoryRouter.get('/stats', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await query(`select country, count(*)::int as suppliers, count(*) filter (where cardinality(phones) > 0)::int as with_phone,
      count(*) filter (where verification_status = 'verified')::int as verified from directory_suppliers where verification_status <> 'rejected' group by country order by country`) });
}));

// Adopt: the company's own vendor record is created from the directory record (supplier by default).
directoryRouter.post('/suppliers/:id/adopt', authorize('vendors', 'create'), asyncHandler(async (req, res) => {
  const b = z.object({ vendor_type: z.enum(['supplier', 'subcontractor', 'both']).default('supplier') }).parse(req.body ?? {});
  const [s] = await query<DirectorySupplierRow>(`select s.id, s.name, s.email, s.phones,
      coalesce((select string_agg(t.name_en, ', ' order by t.sort_order) from directory_supplier_trades st join directory_trades t on t.code = st.trade_code where st.supplier_id = s.id), '') as trade_names
    from directory_suppliers s where s.id = $1 and s.verification_status <> 'rejected'`, [Number(req.params.id)]);
  if (!s) throw new AppError(HTTP_NOT_FOUND, 'Directory supplier not found');
  const phone = s.phones.find(x => x.length <= MAX_VENDOR_PHONE) ?? null;
  const email = z.string().email().max(MAX_VENDOR_EMAIL).safeParse(s.email ?? '').success ? s.email : null;
  const body = vendorSchema.parse({ vendor_name: s.name.slice(0, MAX_VENDOR_NAME), vendor_type: b.vendor_type,
    trade_category: s.trade_names ? s.trade_names.slice(0, MAX_VENDOR_TRADE) : null, phone, email });
  const orgId = Number(req.user!.org_id), userId = Number(req.user!.id);
  const c = await getClient();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.vendor_governed', 'on', true)`);
    const exists = (await c.query(`select vendor_id from vendor_directory_links where org_id = $1 and directory_supplier_id = $2`, [orgId, s.id])).rows[0];
    if (exists) throw new AppError(HTTP_CONFLICT, 'This directory supplier is already one of your vendors');
    const v = await insertVendor(c, orgId, userId, body);
    await c.query(`insert into vendor_directory_links (org_id, vendor_id, directory_supplier_id, adopted_by) values ($1, $2, $3, $4)`, [orgId, v.id, s.id, userId]);
    await c.query('commit');
    res.status(HTTP_CREATED).json({ success: true, data: { vendor_id: v.id, vendor_name: v.vendor_name } });
  } catch (e) { await c.query('rollback').catch(() => undefined); throw e; } finally { await releaseClient(c); }
}));
