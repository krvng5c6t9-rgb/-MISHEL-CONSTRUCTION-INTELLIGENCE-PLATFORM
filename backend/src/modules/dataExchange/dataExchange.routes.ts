import { createHash } from 'node:crypto';
import express, { Router } from 'express';
import { z, ZodError } from 'zod';
import type { PoolClient } from 'pg';
import { getClient, query, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { AppError, mapPgError } from '../../middleware/errors.js';
import { ScheduleError } from '../planning/scheduleEngine.js';
import { readXlsx, writeXlsx, type Cell } from '../../services/xlsx.service.js';
import { clientSchema, insertClient } from '../clients/clients.routes.js';
import { details as vendorSchema, insertVendor } from '../vendors/vendors.routes.js';
import { ccBody, insertCostCode } from '../costCodes/costCodes.routes.js';
import { insertBoqMaster, masterSchema } from '../boq/boq.routes.js';

// CC-098 (Stage 69): Excel (.xlsx) template, export and import of clients, vendors, cost codes and bill-of-quantities
// rows. Each row is validated and created by the same code as the screen (exported schema and insert function); an
// import runs in one transaction: dry_run=1 checks every row and saves nothing; a real import saves all rows or none.
// Permissions are those of each record type: view for the template, export for a data export, create (manage for
// cost codes) for an import.
export const dataExchangeRouter = Router();

interface Col { key: string; en: string; ar: string; required?: boolean; kind?: 'text' | 'number'; values?: string[] }
interface Entity {
  module: string; importAction: 'create' | 'manage'; cols: Col[]; scoped?: boolean;
  exportRows: (orgId: number, scope: Scope) => Promise<any[]>;
  insert: (c: PoolClient, orgId: number, userId: number, row: Record<string, unknown>, scope: Scope) => Promise<unknown>;
}
type Scope = { project_id?: number; tender_id?: number };
const exec = (c: PoolClient) => (text: string, params: unknown[]) => c.query(text, params).then(r => r.rows);

const ENTITIES: Record<string, Entity> = {
  clients: { module: 'crm', importAction: 'create',
    cols: [{ key: 'client_name', en: 'Client name', ar: 'اسم العميل', required: true }, { key: 'client_type', en: 'Client type', ar: 'نوع العميل', values: ['private', 'government', 'developer'] },
      { key: 'contact_person', en: 'Contact person', ar: 'مسؤول الاتصال' }, { key: 'phone', en: 'Phone', ar: 'الهاتف' }, { key: 'email', en: 'Email', ar: 'البريد الإلكتروني' },
      { key: 'address', en: 'Address', ar: 'العنوان' }, { key: 'tax_id', en: 'Tax registration number', ar: 'رقم التسجيل الضريبي' }, { key: 'source', en: 'Source', ar: 'المصدر', values: ['referral', 'tender', 'direct', 'other'] }],
    exportRows: (orgId) => query(`select client_name, client_type, contact_person, phone, email, address, tax_id, source from clients where org_id = $1 order by client_name`, [orgId]),
    insert: (c, orgId, userId, row) => insertClient(exec(c), orgId, userId, clientSchema.parse(row)) },
  vendors: { module: 'vendors', importAction: 'create',
    cols: [{ key: 'vendor_name', en: 'Vendor name', ar: 'اسم المورد', required: true }, { key: 'vendor_type', en: 'Vendor type', ar: 'نوع المورد', values: ['supplier', 'subcontractor', 'both'] },
      { key: 'trade_category', en: 'Trade', ar: 'التخصص' }, { key: 'contact_person', en: 'Contact person', ar: 'مسؤول الاتصال' }, { key: 'phone', en: 'Phone', ar: 'الهاتف' },
      { key: 'email', en: 'Email', ar: 'البريد الإلكتروني' }, { key: 'tax_id', en: 'Tax registration number', ar: 'رقم التسجيل الضريبي' }],
    exportRows: (orgId) => query(`select vendor_name, vendor_type, trade_category, contact_person, phone, email, tax_id from vendors_subcontractors where org_id = $1 order by vendor_name`, [orgId]),
    insert: (c, orgId, userId, row) => insertVendor(c, orgId, userId, vendorSchema.parse(row)) },
  cost_codes: { module: 'cost_control', importAction: 'manage',
    cols: [{ key: 'code', en: 'Code', ar: 'الكود', required: true }, { key: 'description', en: 'Description', ar: 'الوصف', required: true },
      { key: 'cost_type', en: 'Cost type', ar: 'نوع التكلفة', required: true, values: ['labor', 'material', 'equipment', 'subcontract', 'overhead', 'preliminaries'] },
      { key: 'unit_of_measure', en: 'Unit', ar: 'الوحدة' }, { key: 'parent_code', en: 'Parent code', ar: 'الكود الأب' }, { key: 'project_code', en: 'Project code (empty for company-wide)', ar: 'كود المشروع (فارغ للشركة كلها)' }],
    exportRows: (orgId) => query(`select c.code, c.description, c.cost_type, c.unit_of_measure, p.code as parent_code, pr.project_code from cost_codes c
      left join cost_codes p on p.id = c.parent_code_id left join projects pr on pr.id = c.project_id where c.org_id = $1 order by pr.project_code nulls first, c.code`, [orgId]),
    insert: async (c, orgId, _u, row) => {
      let project_id: number | null = null;
      if (row.project_code) { const r = (await c.query(`select id from projects where org_id = $1 and project_code = $2`, [orgId, row.project_code])).rows[0]; if (!r) throw new AppError(422, `Unknown project code ${row.project_code}`); project_id = r.id; }
      let parent_code_id: number | null = null;
      if (row.parent_code) { const r = (await c.query(`select id from cost_codes where org_id = $1 and code = $2 and project_id is not distinct from $3`, [orgId, row.parent_code, project_id])).rows[0];
        if (!r) throw new AppError(422, `Unknown parent code ${row.parent_code} (a parent must come before its children)`); parent_code_id = r.id; }
      const { project_code: _p, parent_code: _pc, ...rest } = row;
      return insertCostCode(exec(c), orgId, ccBody.parse({ ...rest, project_id, parent_code_id }));
    } },
  boq: { module: 'boq', importAction: 'create', scoped: true,
    cols: [{ key: 'item_no', en: 'Item no.', ar: 'رقم البند', required: true }, { key: 'section', en: 'Section', ar: 'القسم' }, { key: 'description', en: 'Description', ar: 'الوصف', required: true },
      { key: 'unit_of_measure', en: 'Unit', ar: 'الوحدة', required: true }, { key: 'quantity', en: 'Quantity', ar: 'الكمية', kind: 'number' }, { key: 'cost_code', en: 'Cost code', ar: 'كود التكلفة' },
      { key: 'unit_rate_material', en: 'Material rate', ar: 'فئة المواد', kind: 'number' }, { key: 'unit_rate_labor', en: 'Labour rate', ar: 'فئة العمالة', kind: 'number' },
      { key: 'unit_rate_equipment', en: 'Equipment rate', ar: 'فئة المعدات', kind: 'number' }, { key: 'unit_rate_subcontract', en: 'Subcontract rate', ar: 'فئة مقاولي الباطن', kind: 'number' },
      { key: 'overhead_percent', en: 'Overhead %', ar: 'المصروفات العامة ٪', kind: 'number' }, { key: 'profit_percent', en: 'Profit %', ar: 'الربح ٪', kind: 'number' }],
    exportRows: (orgId, s) => query(`select b.item_no, b.section, b.description, b.unit_of_measure, b.quantity::float8 as quantity, c.code as cost_code, b.unit_rate_material::float8 as unit_rate_material,
      b.unit_rate_labor::float8 as unit_rate_labor, b.unit_rate_equipment::float8 as unit_rate_equipment, b.unit_rate_subcontract::float8 as unit_rate_subcontract,
      b.overhead_percent::float8 as overhead_percent, b.profit_percent::float8 as profit_percent from boq_master b left join cost_codes c on c.id = b.cost_code_id
      where b.org_id = $1 and ($2::bigint is null or b.project_id = $2) and ($3::bigint is null or b.tender_id = $3) order by b.section nulls first, b.item_no`, [orgId, s.project_id ?? null, s.tender_id ?? null]),
    insert: async (c, orgId, userId, row, s) => {
      let cost_code_id: number | null = null;
      if (row.cost_code) { const r = (await c.query(`select id from cost_codes where org_id = $1 and code = $2 and (project_id is null or project_id = $3) order by project_id nulls last limit 1`, [orgId, row.cost_code, s.project_id ?? null])).rows[0];
        if (!r) throw new AppError(422, `Unknown cost code ${row.cost_code}`); cost_code_id = r.id; }
      const { cost_code: _c, ...rest } = row;
      return insertBoqMaster(exec(c), orgId, userId, masterSchema.parse({ ...rest, cost_code_id, project_id: s.project_id ?? null, tender_id: s.tender_id ?? null }));
    } }
};

const can = (req: any, module: string, action: string) => { const granted: { module: string; action: string }[] = req.user.permissions; return granted.some(g => g.module === module && g.action === action); };
function entityOf(req: any, action: 'view' | 'export' | 'import') {
  const e = ENTITIES[String(req.params.entity)]; if (!e) throw new AppError(404, 'Unknown record type');
  const a = action === 'import' ? e.importAction : action;
  if (!can(req, e.module, a)) throw new AppError(403, `Missing permission: ${e.module}.${a}`);
  return e;
}
async function scopeOf(req: any, e: Entity): Promise<Scope> {
  if (!e.scoped) return {};
  const q = z.object({ project_id: z.coerce.number().int().positive().optional(), tender_id: z.coerce.number().int().positive().optional() }).parse(req.query);
  if (!q.project_id === !q.tender_id) throw new AppError(400, 'Give either a project or a tender');
  const [r] = q.project_id ? await query(`select id from projects where org_id = $1 and id = $2`, [req.user.org_id, q.project_id]) : await query(`select id from tenders where org_id = $1 and id = $2`, [req.user.org_id, q.tender_id]);
  if (!r) throw new AppError(404, q.project_id ? 'Project not found' : 'Tender not found');
  return q.project_id ? { project_id: q.project_id } : { tender_id: q.tender_id };
}
function sendXlsx(res: any, name: string, buf: Buffer) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
  res.send(buf);
}
const guide = (e: Entity) => ({ name: 'Guide', widths: [22, 30, 30, 10, 50], rows: [['column', 'English', 'العربية', 'required', 'allowed values'] as Cell[],
  ...e.cols.map(c => [c.key, c.en, c.ar, c.required ? 'yes' : '', c.values?.join(', ') ?? (c.kind === 'number' ? 'number' : '')])] });

dataExchangeRouter.get('/entities', asyncHandler(async (req, res) => {
  res.json({ success: true, data: Object.entries(ENTITIES).filter(([, e]) => can(req, e.module, 'view')).map(([k, e]) => ({ entity: k, scoped: !!e.scoped,
    can_export: can(req, e.module, 'export'), can_import: can(req, e.module, e.importAction), columns: e.cols })) });
}));
dataExchangeRouter.get('/:entity/template', asyncHandler(async (req, res) => {
  const e = entityOf(req, 'view');
  sendXlsx(res, `${req.params.entity}-template`, writeXlsx([{ name: 'Data', widths: e.cols.map(() => 22), rows: [e.cols.map(c => c.key)] }, guide(e)]));
}));
dataExchangeRouter.get('/:entity/export', asyncHandler(async (req, res) => {
  const e = entityOf(req, 'export'), s = await scopeOf(req, e), rows = await e.exportRows(Number(req.user!.org_id), s);
  sendXlsx(res, `${req.params.entity}-export`, writeXlsx([{ name: 'Data', widths: e.cols.map(() => 22), rows: [e.cols.map(c => c.key), ...rows.map(r => e.cols.map(c => r[c.key] ?? null))] }, guide(e)]));
}));

const message = (err: any): string => {
  if (err instanceof ZodError) return err.issues.map(i => `${i.path.join('.') || 'row'}: ${i.message}`).join('; ');
  if (err instanceof AppError) return err.message;
  const m = err?.code ? mapPgError(err.code, err) : null;
  return m?.message ?? 'The row could not be saved';
};

dataExchangeRouter.post('/:entity/import', express.raw({ type: () => true, limit: '20mb' }), asyncHandler(async (req, res) => {
  const e = entityOf(req, 'import'), s = await scopeOf(req, e);
  const q = z.object({ file_name: z.string().trim().min(1).max(255), dry_run: z.enum(['0', '1']).default('0') }).parse({ file_name: req.query.file_name, dry_run: req.query.dry_run });
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!buf.length) throw new AppError(400, 'The file is empty');
  let table: Cell[][];
  try { table = readXlsx(buf); } catch (err) { if (err instanceof ScheduleError) throw new AppError(422, err.message); throw err; }
  const header = (table[0] ?? []).map(h => String(h ?? '').trim().toLowerCase());
  const pos = new Map<string, number>(), unknown: string[] = [];
  header.forEach((h, i) => { if (!h) return; const c = e.cols.find(c => [c.key, c.en.toLowerCase(), c.ar].includes(h)); if (c) pos.set(c.key, i); else unknown.push(String(table[0][i])); });
  const missing = e.cols.filter(c => c.required && !pos.has(c.key)).map(c => c.key);
  if (missing.length) throw new AppError(422, `Required columns missing: ${missing.join(', ')}`);
  const data = table.slice(1).map((r, i) => ({ n: i + 2, r })).filter(x => x.r.some(v => v !== null && v !== undefined && String(v).trim() !== ''));
  if (!data.length) throw new AppError(422, 'The sheet has no data rows');
  const orgId = Number(req.user!.org_id), userId = Number(req.user!.id), errors: { row: number; error: string }[] = [];
  const c = await getClient();
  try {
    await c.query('begin');
    if (req.params.entity === 'vendors') await c.query(`select set_config('app.vendor_governed', 'on', true)`);
    for (const { n, r } of data) {
      const row: Record<string, unknown> = {};
      for (const col of e.cols) {
        const v = pos.has(col.key) ? r[pos.get(col.key)!] : undefined;
        if (v === null || v === undefined || String(v).trim() === '') continue;
        if (col.kind === 'number') { const x = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '')); row[col.key] = Number.isFinite(x) ? x : String(v); }
        else row[col.key] = String(v).trim();
      }
      await c.query('savepoint r');
      try { await e.insert(c, orgId, userId, row, s); await c.query('release savepoint r'); }
      catch (err) { await c.query('rollback to savepoint r'); errors.push({ row: n, error: message(err) }); }
    }
    const sha = createHash('sha256').update(buf).digest('hex');
    const summary = { rows: data.length, accepted: data.length - errors.length, errors, unknown_columns: unknown, file_sha256: sha };
    if (q.dry_run === '1' || errors.length) {
      await c.query('rollback');
      if (q.dry_run === '1') return res.json({ success: true, data: { ...summary, saved: false } });
      return res.status(422).json({ success: false, error: 'Some rows were refused; nothing was saved', details: { ...summary, saved: false } });
    }
    const { rows } = await c.query(`insert into data_imports (org_id, entity, scope, file_name, file_sha256, rows_count, imported_by) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [orgId, req.params.entity, JSON.stringify(s), q.file_name, sha, data.length, userId]);
    await c.query('commit');
    res.status(201).json({ success: true, data: { ...summary, saved: true, import_id: rows[0].id } });
  } catch (err) { await c.query('rollback').catch(() => undefined); throw err; } finally { await releaseClient(c); }
}));

dataExchangeRouter.get('/imports', asyncHandler(async (req, res) => {
  const visible = Object.entries(ENTITIES).filter(([, e]) => can(req, e.module, 'view')).map(([k]) => k);
  res.json({ success: true, data: await query(`select i.id, i.entity, i.scope, i.file_name, i.file_sha256, i.rows_count, i.created_at, u.full_name as imported_by_name
    from data_imports i join users u on u.id = i.imported_by where i.org_id = $1 and i.entity = any($2) order by i.id desc limit 200`, [req.user!.org_id, visible]) });
}));
