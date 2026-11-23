import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { AppError } from '../../middleware/errors.js';

// CC-099 (Stage 70): analytics - the company's own dashboards built from a semantic layer of data sources. A source
// fixes its tables, joins, dimensions and measures; a query names only those keys, so no SQL text ever comes from the
// user, every value is a bound parameter and each source needs the view permission of its module (checked for the
// person viewing, also on a shared dashboard). Money measures are grouped by currency always: amounts in different
// currencies are never added. Totals are computed by the database and returned as text.
export const analyticsRouter = Router();

interface Dim { key: string; en: string; ar: string; sql: string; date?: boolean }
interface Measure { key: string; en: string; ar: string; sql: string; money?: boolean }
interface Source { key: string; module: string; en: string; ar: string; from: string; where?: string; currency?: string; date: string; dims: Dim[]; measures: Measure[] }
const month = (col: string) => `to_char(${col}, 'YYYY-MM')`;

const SOURCES: Source[] = [
  { key: 'cost', module: 'cost_control', en: 'Project cost transactions', ar: 'حركات تكلفة المشروعات',
    from: `cost_transactions t join projects p on p.id = t.project_id left join cost_codes cc on cc.id = t.cost_code_id join currencies cur on cur.id = t.currency_id`,
    currency: 'cur.code', date: 't.transaction_date',
    dims: [{ key: 'project', en: 'Project', ar: 'المشروع', sql: 'p.project_code' }, { key: 'cost_code', en: 'Cost code', ar: 'كود التكلفة', sql: `coalesce(cc.code, '-')` },
      { key: 'cost_type', en: 'Cost type', ar: 'نوع التكلفة', sql: `coalesce(cc.cost_type, '-')` }, { key: 'transaction_type', en: 'Transaction type', ar: 'نوع الحركة', sql: 't.transaction_type' },
      { key: 'source', en: 'Source', ar: 'المصدر', sql: 't.source_module' }, { key: 'month', en: 'Month', ar: 'الشهر', sql: month('t.transaction_date'), date: true }],
    measures: [{ key: 'amount', en: 'Amount', ar: 'المبلغ', sql: 'sum(t.amount)', money: true }, { key: 'count', en: 'Transactions', ar: 'عدد الحركات', sql: 'count(*)' }] },
  { key: 'ipcs', module: 'finance', en: 'Interim payment certificates', ar: 'المستخلصات الجارية',
    from: `ipcs i join projects p on p.id = i.project_id join currencies cur on cur.id = p.currency_id`, currency: 'cur.code', date: 'i.period_to',
    dims: [{ key: 'project', en: 'Project', ar: 'المشروع', sql: 'p.project_code' }, { key: 'status', en: 'Status', ar: 'الحالة', sql: 'i.status' },
      { key: 'month', en: 'Month', ar: 'الشهر', sql: month('i.period_to'), date: true }],
    measures: [{ key: 'gross', en: 'Work done this period', ar: 'الأعمال المنفذة في الفترة', sql: 'sum(i.gross_work_done_this_period)', money: true },
      { key: 'net_due', en: 'Net amount due', ar: 'صافي المستحق', sql: 'sum(i.net_amount_due)', money: true },
      { key: 'certified', en: 'Certified by the client', ar: 'المعتمد من العميل', sql: 'sum(i.client_certified_amount)', money: true }, { key: 'count', en: 'Certificates', ar: 'عدد المستخلصات', sql: 'count(*)' }] },
  { key: 'purchase_orders', module: 'procurement', en: 'Purchase orders', ar: 'أوامر الشراء',
    from: `purchase_orders o join projects p on p.id = o.project_id left join vendors_subcontractors v on v.id = o.vendor_id join currencies cur on cur.id = o.currency_id`, currency: 'cur.code', date: 'o.po_date',
    dims: [{ key: 'project', en: 'Project', ar: 'المشروع', sql: 'p.project_code' }, { key: 'vendor', en: 'Vendor', ar: 'المورد', sql: `coalesce(v.vendor_name, '-')` },
      { key: 'status', en: 'Status', ar: 'الحالة', sql: 'o.status' }, { key: 'month', en: 'Month', ar: 'الشهر', sql: month('o.po_date'), date: true }],
    measures: [{ key: 'total', en: 'Order value', ar: 'قيمة الأوامر', sql: 'sum(o.total_amount)', money: true }, { key: 'count', en: 'Orders', ar: 'عدد الأوامر', sql: 'count(*)' }] },
  { key: 'attendance', module: 'hr', en: 'Site attendance', ar: 'حضور الموقع',
    from: `attendance a left join projects p on p.id = a.project_id`, date: 'a.attendance_date',
    dims: [{ key: 'project', en: 'Project', ar: 'المشروع', sql: `coalesce(p.project_code, '-')` }, { key: 'status', en: 'Status', ar: 'الحالة', sql: 'a.status' },
      { key: 'month', en: 'Month', ar: 'الشهر', sql: month('a.attendance_date'), date: true }],
    measures: [{ key: 'hours', en: 'Hours worked', ar: 'ساعات العمل', sql: 'sum(a.hours_worked)' }, { key: 'overtime', en: 'Overtime hours', ar: 'ساعات إضافية', sql: 'sum(a.overtime_hours)' },
      { key: 'records', en: 'Attendance records', ar: 'سجلات الحضور', sql: 'count(*)' }, { key: 'employees', en: 'Employees', ar: 'عدد الموظفين', sql: 'count(distinct a.employee_id)' }] },
  { key: 'boq', module: 'boq', en: 'Bills of quantities (projects)', ar: 'جداول كميات المشروعات',
    from: `boq_master b join projects p on p.id = b.project_id join currencies cur on cur.id = p.currency_id left join cost_codes cc on cc.id = b.cost_code_id`, currency: 'cur.code', date: 'b.created_at::date',
    dims: [{ key: 'project', en: 'Project', ar: 'المشروع', sql: 'p.project_code' }, { key: 'section', en: 'Section', ar: 'القسم', sql: `coalesce(b.section, '-')` },
      { key: 'cost_code', en: 'Cost code', ar: 'كود التكلفة', sql: `coalesce(cc.code, '-')` }],
    measures: [{ key: 'amount', en: 'Amount', ar: 'القيمة', sql: 'sum(b.total_amount)', money: true }, { key: 'items', en: 'Items', ar: 'عدد البنود', sql: 'count(*)' }] }
];
const ALIAS: Record<string, string> = { cost: 't', ipcs: 'i', purchase_orders: 'o', attendance: 'a', boq: 'b' };

const can = (req: any, module: string) => { const granted: { module: string; action: string }[] = req.user.permissions; return granted.some(g => g.module === module && g.action === 'view'); };
const pub = (s: Source) => ({ key: s.key, module: s.module, en: s.en, ar: s.ar, money: !!s.currency, dims: s.dims.map(({ sql: _s, ...d }) => d), measures: s.measures.map(({ sql: _s, ...m }) => m) });

analyticsRouter.get('/sources', asyncHandler(async (req, res) => {
  res.json({ success: true, data: SOURCES.filter(s => can(req, s.module)).map(pub) });
}));

export const querySchema = z.object({
  source: z.string(), measures: z.array(z.string()).min(1).max(4), dims: z.array(z.string()).max(2).default([]),
  filters: z.array(z.object({ dim: z.string(), values: z.array(z.string().max(200)).min(1).max(50) })).max(5).default([]),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(1000).default(200)
});
export async function runQuery(req: any, raw: unknown) {
  const q = querySchema.parse(raw), s = SOURCES.find(x => x.key === q.source);
  if (!s) throw new AppError(404, 'Unknown data source');
  if (!can(req, s.module)) throw new AppError(403, `Missing permission: ${s.module}.view`);
  const dimOf = (k: string) => { const d = s.dims.find(x => x.key === k); if (!d) throw new AppError(400, `Unknown dimension ${k}`); return d; };
  const ms = q.measures.map(k => { const m = s.measures.find(x => x.key === k); if (!m) throw new AppError(400, `Unknown measure ${k}`); return m; });
  const dims = [...new Set(q.dims)].map(dimOf);
  const money = ms.some(m => m.money);
  const params: unknown[] = [req.user.org_id], where = [`${ALIAS[s.key]}.org_id = $1`];
  for (const f of q.filters) { const d = dimOf(f.dim); params.push(f.values); where.push(`(${d.sql})::text = any($${params.length}::text[])`); }
  if (q.date_from) { params.push(q.date_from); where.push(`${s.date} >= $${params.length}::date`); }
  if (q.date_to) { params.push(q.date_to); where.push(`${s.date} <= $${params.length}::date`); }
  const sel = [...dims.map((d, i) => `${d.sql} as d${i}`), ...(money ? [`${s.currency} as currency`] : []), ...ms.map((m, i) => `(${m.sql})::text as m${i}`)];
  const groups = dims.length + (money ? 1 : 0);
  const order = dims.length ? dims.map((_, i) => `d${i}`).join(', ') : (money ? 'currency' : '1');
  params.push(q.limit + 1);
  const text = `select ${sel.join(', ')} from ${s.from} where ${where.join(' and ')}${groups ? ` group by ${Array.from({ length: groups }, (_, i) => i + 1).join(', ')}` : ''} order by ${order} limit $${params.length}`;
  const rows = await query<any>(text, params);
  const truncated = rows.length > q.limit;
  return { source: s.key, dims: dims.map(d => d.key), measures: ms.map(m => ({ key: m.key, money: !!m.money })), by_currency: money, truncated,
    rows: rows.slice(0, q.limit).map(r => ({ dims: dims.map((_, i) => r[`d${i}`] === null ? null : String(r[`d${i}`])), currency: money ? r.currency : undefined, values: ms.map((_, i) => r[`m${i}`]) })) };
}
analyticsRouter.post('/query', asyncHandler(async (req, res) => { res.json({ success: true, data: await runQuery(req, req.body) }); }));

// --- Dashboards: private to their owner or shared with the company; only the owner changes or deletes one. Each
// widget is a stored query plus a chart type; it runs with the permissions of the person viewing.
const widget = z.object({ title: z.string().trim().min(1).max(120), chart: z.enum(['bar', 'line', 'pie', 'table', 'kpi']), query: querySchema });
const board = z.object({ name: z.string().trim().min(2).max(120), visibility: z.enum(['private', 'company']), widgets: z.array(widget).max(24) });
const cols = `d.id, d.name, d.visibility, d.widgets, d.owner_id, u.full_name as owner_name, d.updated_at`;

analyticsRouter.get('/dashboards', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await query(`select ${cols} from analytics_dashboards d join users u on u.id = d.owner_id
    where d.org_id = $1 and (d.owner_id = $2 or d.visibility = 'company') order by d.name`, [req.user!.org_id, req.user!.id]) });
}));
analyticsRouter.post('/dashboards', asyncHandler(async (req, res) => {
  const b = board.parse(req.body);
  for (const w of b.widgets) if (!SOURCES.some(s => s.key === w.query.source)) throw new AppError(400, 'Unknown data source');
  const [r] = await query<any>(`insert into analytics_dashboards (org_id, owner_id, name, visibility, widgets) values ($1, $2, $3, $4, $5) returning id`,
    [req.user!.org_id, req.user!.id, b.name, b.visibility, JSON.stringify(b.widgets)]);
  res.status(201).json({ success: true, data: r });
}));
analyticsRouter.put('/dashboards/:id', asyncHandler(async (req, res) => {
  const b = board.parse(req.body);
  for (const w of b.widgets) if (!SOURCES.some(s => s.key === w.query.source)) throw new AppError(400, 'Unknown data source');
  const r = await query(`update analytics_dashboards set name = $4, visibility = $5, widgets = $6, updated_at = now() where org_id = $1 and id = $2 and owner_id = $3 returning id`,
    [req.user!.org_id, Number(req.params.id), req.user!.id, b.name, b.visibility, JSON.stringify(b.widgets)]);
  if (!r.length) throw new AppError(404, 'Dashboard not found or not yours');
  res.json({ success: true, data: r[0] });
}));
analyticsRouter.delete('/dashboards/:id', asyncHandler(async (req, res) => {
  const r = await query(`delete from analytics_dashboards where org_id = $1 and id = $2 and owner_id = $3 returning id`, [req.user!.org_id, Number(req.params.id), req.user!.id]);
  if (!r.length) throw new AppError(404, 'Dashboard not found or not yours');
  res.json({ success: true });
}));
