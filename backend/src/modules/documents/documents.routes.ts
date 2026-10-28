import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { getClient, releaseClient, query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { AppError } from '../../middleware/errors.js';
import { htmlToPdf } from './pdf.js';
import { pageFooter, renderDailyDiary, renderGoodsReceipt, renderIpc, renderJournalVoucher, renderPaymentVoucher, renderPurchaseOrder, renderSubcontractCertificate,
  type Lang, type Mark } from './templates.js';

// CC-085 (R1.5 first part, MP-03 §1 / §5): print view (HTML) and PDF of the client IPC (DOC-15-001) and the
// subcontractor payment certificate (DOC-15-004). An export needs the same permission as the screen that shows the
// record; every export is entered in document_exports with the SHA-256 of the exact bytes returned, and its number is
// printed on the document.
export const documentsRouter = Router();

// CC-086: purchase order (DOC-09-004), goods received note (DOC-10-001), payment / receipt voucher (DOC-16-006 / 16-004),
// journal voucher (DOC-16-020) and daily diary (DOC-12-004) added. A record is printed as final only in the statuses
// listed in `final`; rejected or cancelled records carry a NOT VALID mark, every other status the DRAFT mark.
type Doc = { module: string; table: string; load: (c: PoolClient, id: number, org: number) => Promise<any | null>; status: (d: any) => string;
  final: string[]; void?: string[]; render: (lang: Lang, d: any, mark: Mark, exp: { id: number; at: string; by: string }) => string; name: (d: any) => string };

const org = async (c: PoolClient, orgId: number) => (await c.query(`select name, legal_name, address, tax_id from organizations where id = $1`, [orgId])).rows[0];
const steps = async (c: PoolClient, approvalId: number | null) => approvalId ? (await c.query(`
  select l.action as label, u.full_name as name, r.role_name as role, l.action_date::text as at
    from approval_actions_log l left join users u on u.id = l.approver_id left join roles r on r.id = u.role_id
   where l.approval_instance_id = $1 order by l.step_no, l.action_date, l.id`, [approvalId])).rows : [];
const person = async (c: PoolClient, userId: number | null) => userId ? (await c.query(`select u.full_name as name, r.role_name as role from users u left join roles r on r.id = u.role_id where u.id = $1`, [userId])).rows[0] ?? {} : {};

const DOCS: Record<string, Doc> = {
  ipc: {
    module: 'finance', table: 'ipc',
    async load(c, id, orgId) {
      const ipc = (await c.query(`
        select i.id, i.ipc_no, i.status, i.period_from::text, i.period_to::text, i.contract_id, i.client_reference, i.approval_instance_id, i.prepared_by, i.created_at::text,
               i.gross_work_done_this_period::text, i.cumulative_gross_work_done::text, i.materials_on_site_value::text, i.less_retention::text,
               i.less_advance_recovery::text, i.less_previous_certified::text, i.output_tax_amount::text, i.net_amount_due::text, i.client_certified_amount::text,
               p.project_code, p.project_name, cl.client_name, cur.code as currency
          from ipcs i join projects p on p.id = i.project_id join contracts k on k.id = i.contract_id join clients cl on cl.id = k.client_id
          join currencies cur on cur.id = p.currency_id
         where i.id = $1 and i.org_id = $2`, [id, orgId])).rows[0];
      if (!ipc) return null;
      const lines = (await c.query(`
        select b.item_no, b.description, b.unit_of_measure as unit, l.quantity_this_period::text, l.cumulative_quantity::text, l.unit_rate::text,
               l.amount_this_period::text, l.cumulative_amount::text
          from ipc_boq_lines l left join project_boq b on b.id = l.project_boq_item_id where l.ipc_id = $1 order by b.item_no, l.id`, [id])).rows;
      const prep = await person(c, ipc.prepared_by);
      return { ipc, org: await org(c, orgId), lines, steps: [{ label: 'prepared', ...prep, at: ipc.created_at }, ...(await steps(c, ipc.approval_instance_id))] };
    },
    status: d => d.ipc.status, final: ['submitted_to_client', 'client_approved', 'disputed', 'posted', 'paid'],
    render: renderIpc,
    name: d => `IPC-${d.ipc.ipc_no}`
  },
  'subcontract-certificate': {
    module: 'contracts', table: 'subcontract_certificate',
    async load(c, id, orgId) {
      const cert = (await c.query(`
        select s.id, s.certificate_no, s.status, s.period_from::text, s.period_to::text, s.approval_instance_id, s.created_by, s.created_at::text,
               s.site_verified_by, s.site_verified_at::text, s.qs_certified_by, s.qs_certified_at::text,
               s.gross_work_done::text, s.previous_cumulative_gross::text, s.cumulative_gross_to_date::text, s.less_retention::text, s.less_advance_recovery::text,
               s.less_previous_paid::text, s.penalties_deductions::text, s.input_tax_amount::text, s.net_amount_due::text,
               p.project_code, p.project_name, sc.package_name, v.vendor_name, cur.code as currency
          from subcontract_certificates s join subcontracts sc on sc.id = s.subcontract_id join vendors_subcontractors v on v.id = sc.vendor_id
          join projects p on p.id = s.project_id join currencies cur on cur.id = sc.currency_id
         where s.id = $1 and s.org_id = $2`, [id, orgId])).rows[0];
      if (!cert) return null;
      const lines = (await c.query(`select description, quantity_this_period::text, cumulative_quantity::text, unit_rate::text, amount::text
        from subcontract_certificate_lines where certificate_id = $1 order by id`, [id])).rows;
      const st = [{ label: 'prepared', ...(await person(c, cert.created_by)), at: cert.created_at }];
      if (cert.site_verified_by) st.push({ label: 'siteVerified', ...(await person(c, cert.site_verified_by)), at: cert.site_verified_at });
      if (cert.qs_certified_by) st.push({ label: 'qsCertified', ...(await person(c, cert.qs_certified_by)), at: cert.qs_certified_at });
      return { cert, org: await org(c, orgId), lines, steps: [...st, ...(await steps(c, cert.approval_instance_id))] };
    },
    status: d => d.cert.status, final: ['approved', 'posted', 'paid'], void: ['rejected'],
    render: renderSubcontractCertificate,
    name: d => `SC-${d.cert.certificate_no}`
  },
  'purchase-order': {
    module: 'procurement', table: 'purchase_order',
    async load(c, id, orgId) {
      const po = (await c.query(`
        select po.id, po.po_ref, po.po_date::text, po.total_amount::text, po.payment_terms, po.delivery_terms, po.status, po.approval_instance_id,
               p.project_code, p.project_name, v.vendor_name, v.tax_id as vendor_tax_id, cc.code as cost_code, cc.description as cost_code_description, cur.code as currency
          from purchase_orders po join projects p on p.id = po.project_id join vendors_subcontractors v on v.id = po.vendor_id
          join currencies cur on cur.id = po.currency_id left join cost_codes cc on cc.id = po.cost_code_id
         where po.id = $1 and po.org_id = $2`, [id, orgId])).rows[0];
      if (!po) return null;
      const lines = (await c.query(`select b.item_no, l.item_description, l.unit_of_measure, l.quantity::text, l.unit_rate::text, l.amount::text
        from po_lines l left join project_boq b on b.id = l.boq_item_id where l.po_id = $1 order by l.id`, [id])).rows;
      return { po, org: await org(c, orgId), lines, steps: await steps(c, po.approval_instance_id) };
    },
    status: d => d.po.status, final: ['approved', 'issued', 'partially_delivered', 'closed'], void: ['cancelled'],
    render: renderPurchaseOrder,
    name: d => `PO-${d.po.po_ref}`
  },
  'goods-receipt': {
    module: 'procurement', table: 'goods_receipt',
    async load(c, id, orgId) {
      const grn = (await c.query(`
        select g.id, g.grn_no, g.received_date::text, g.status, g.received_by, g.created_at::text, po.po_ref, v.vendor_name, p.project_code, p.project_name,
               w.code as warehouse_code, w.name as warehouse_name
          from goods_receipt_notes g join purchase_orders po on po.id = g.po_id join vendors_subcontractors v on v.id = po.vendor_id
          join projects p on p.id = g.project_id left join warehouses w on w.id = g.warehouse_id
         where g.id = $1 and g.org_id = $2`, [id, orgId])).rows[0];
      if (!grn) return null;
      const lines = (await c.query(`select pl.item_description, pl.unit_of_measure, pl.quantity::text as quantity_ordered, l.quantity_received::text,
               l.quantity_accepted::text, l.quantity_rejected::text, l.rejection_reason, i.item_code
          from grn_lines l join po_lines pl on pl.id = l.po_line_id left join inventory_items i on i.id = l.inventory_item_id where l.grn_id = $1 order by l.id`, [id])).rows;
      return { grn, org: await org(c, orgId), lines, steps: [{ label: 'received', ...(await person(c, grn.received_by)), at: grn.created_at }] };
    },
    status: d => d.grn.status, final: ['confirmed'],
    render: renderGoodsReceipt,
    name: d => `GRN-${d.grn.grn_no}`
  },
  'payment-voucher': {
    module: 'finance', table: 'payment',
    async load(c, id, orgId) {
      const pay = (await c.query(`
        select y.id, y.payment_type, y.payment_date::text, y.amount::text, y.withheld_tax_amount::text, y.withholding_certificate_ref, y.method, y.reference_no,
               y.status, y.approval_instance_id, y.created_by, y.created_at::text, coalesce(y.related_ap_id, y.related_ar_id) as related_id,
               coalesce(v.vendor_name, cl.client_name) as party_name, b.bank_name, b.account_no, cur.code as currency, p.project_code, p.project_name
          from payments y join currencies cur on cur.id = y.currency_id join bank_accounts b on b.id = y.bank_account_id
          left join vendors_subcontractors v on y.party_type = 'vendor' and v.id = y.party_id left join clients cl on y.party_type = 'client' and cl.id = y.party_id
          left join accounts_payable ap on ap.id = y.related_ap_id left join accounts_receivable ar on ar.id = y.related_ar_id
          left join projects p on p.id = coalesce(ap.project_id, ar.project_id)
         where y.id = $1 and y.org_id = $2`, [id, orgId])).rows[0];
      if (!pay) return null;
      return { pay, org: await org(c, orgId), steps: [{ label: 'prepared', ...(await person(c, pay.created_by)), at: pay.created_at }, ...(await steps(c, pay.approval_instance_id))] };
    },
    status: d => d.pay.status, final: ['approved', 'posted', 'reconciled'],
    render: renderPaymentVoucher,
    name: d => `${d.pay.payment_type === 'outgoing' ? 'PV' : 'RV'}-${d.pay.id}`
  },
  'journal-voucher': {
    module: 'finance', table: 'manual_journal',
    async load(c, id, orgId) {
      const mj = (await c.query(`
        select m.id, m.entry_date::text, m.description, m.reason_category, m.status, m.fx_side, m.posted_journal_batch_id, m.approval_instance_id,
               m.requested_by, m.created_at::text, p.project_code, p.project_name
          from manual_journal_entries m left join projects p on p.id = m.project_id where m.id = $1 and m.org_id = $2`, [id, orgId])).rows[0];
      if (!mj) return null;
      const lines = (await c.query(`select a.account_code, a.account_name, l.description, cur.code as currency, l.debit::text, l.credit::text
          from manual_journal_entry_lines l join chart_of_accounts a on a.id = l.account_id join currencies cur on cur.id = l.currency_id
         where l.journal_entry_id = $1 order by l.id`, [id])).rows;
      // Totals are summed by the database from the stored lines, per currency (amounts of different currencies are never added).
      const totals = (await c.query(`select cur.code as currency, sum(l.debit)::text as debit, sum(l.credit)::text as credit
          from manual_journal_entry_lines l join currencies cur on cur.id = l.currency_id where l.journal_entry_id = $1 group by cur.code order by cur.code`, [id])).rows;
      return { mj, org: await org(c, orgId), lines, totals, steps: [{ label: 'prepared', ...(await person(c, mj.requested_by)), at: mj.created_at }, ...(await steps(c, mj.approval_instance_id))] };
    },
    status: d => d.mj.status, final: ['approved', 'posted'], void: ['rejected', 'cancelled'],
    render: renderJournalVoucher,
    name: d => `JV-${d.mj.id}`
  },
  'daily-diary': {
    module: 'site', table: 'site_diary',
    async load(c, id, orgId) {
      const diary = (await c.query(`
        select s.id, s.diary_date::text, s.weather, s.work_performed, s.work_fronts, s.delays_notes, s.constraints_noted, s.instructions_received, s.parties_present,
               s.visitors, s.safety_notes, s.impact_flag, s.impact_description, s.status, s.prepared_by, s.created_at::text, s.signed_by, s.signed_at::text,
               p.project_code, p.project_name
          from site_diary s join projects p on p.id = s.project_id where s.id = $1 and s.org_id = $2`, [id, orgId])).rows[0];
      if (!diary) return null;
      const [manpower, equipment, amendments] = [
        (await c.query(`select m.trade, v.vendor_name as subcontractor_name, m.headcount::text, m.hours::text from diary_manpower m
           left join vendors_subcontractors v on v.id = m.subcontractor_id where m.diary_id = $1 order by m.id`, [id])).rows,
        (await c.query(`select equipment_description, hours_used::text, idle_hours::text from diary_equipment where diary_id = $1 order by id`, [id])).rows,
        (await c.query(`select a.note, u.full_name as author, a.created_at::text from site_diary_amendments a left join users u on u.id = a.author_id
           where a.diary_id = $1 order by a.id`, [id])).rows];
      const st = [{ label: 'prepared', ...(await person(c, diary.prepared_by)), at: diary.created_at }];
      if (diary.signed_by) st.push({ label: 'signed', ...(await person(c, diary.signed_by)), at: diary.signed_at });
      return { diary, org: await org(c, orgId), manpower, equipment, amendments, steps: st };
    },
    status: d => d.diary.status, final: ['signed'],
    render: renderDailyDiary,
    name: d => `DIARY-${d.diary.diary_date}`
  }
};

const canView = (req: any, module: string) => (req.user?.permissions ?? []).some((p: any) => p.module === module && p.action === 'view');
const docOf = (type: string, req: any) => {
  const doc = DOCS[type];
  if (!doc) throw new AppError(404, 'Document type not found');
  if (!canView(req, doc.module)) throw new AppError(403, `Missing permission: ${doc.module}.view`);
  return doc;
};

documentsRouter.get('/exports', asyncHandler(async (req, res) => {
  const q = z.object({ type: z.string(), record_id: z.coerce.number().int().positive() }).parse(req.query);
  const doc = docOf(q.type, req);
  res.json({ success: true, data: await query(`select e.*, u.full_name as exported_by_name from document_exports e join users u on u.id = e.exported_by
    where e.org_id = $1 and e.doc_type = $2 and e.record_id = $3 order by e.id desc`, [req.user!.org_id, doc.table, q.record_id]) });
}));

// Verification of a printed copy by its export number.
documentsRouter.get('/exports/:id', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const [e] = await query<any>(`select e.*, u.full_name as exported_by_name from document_exports e join users u on u.id = e.exported_by where e.id = $1 and e.org_id = $2`, [id, req.user!.org_id]);
  if (!e) throw new AppError(404, 'Export not found');
  const type = Object.keys(DOCS).find(k => DOCS[k].table === e.doc_type)!;
  docOf(type, req);
  res.json({ success: true, data: e });
}));

documentsRouter.get('/:type/:id', asyncHandler(async (req, res) => {
  const doc = docOf(req.params.type, req);
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const q = z.object({ format: z.enum(['html', 'pdf']).default('html'), lang: z.enum(['ar', 'en']).default('ar') }).parse(req.query);
  const orgId = Number(req.user!.org_id);
  const client = await getClient();
  try {
    await client.query('begin');
    const data = await doc.load(client, id, orgId);
    if (!data) throw new AppError(404, 'Document not found');
    const status = doc.status(data);
    const mark: Mark = doc.final.includes(status) ? null : doc.void?.includes(status) ? 'void' : 'draft';
    const draft = mark !== null;
    const e = (await client.query(`insert into document_exports(org_id, doc_type, record_id, record_status, is_draft, format, lang, exported_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, to_char(exported_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') as at`,
      [orgId, doc.table, id, status, draft, q.format, q.lang, req.user!.id])).rows[0];
    const html = doc.render(q.lang, data, mark, { id: Number(e.id), at: e.at, by: req.user!.full_name });
    const bytes = q.format === 'pdf' ? await htmlToPdf(html, pageFooter(Number(e.id))) : Buffer.from(html, 'utf8');
    const sha = createHash('sha256').update(bytes).digest('hex');
    await client.query(`update document_exports set sha256 = $2, size_bytes = $3 where id = $1`, [e.id, sha, bytes.length]);
    await client.query('commit');
    res.setHeader('Content-Type', q.format === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${doc.name(data).replace(/[^A-Za-z0-9._-]/g, '_')}_${e.id}.${q.format}"`);
    res.setHeader('X-Export-Id', String(e.id));
    res.setHeader('X-Export-SHA256', sha);
    res.setHeader('Cache-Control', 'no-store');
    res.send(bytes);
  } catch (err) { await client.query('rollback'); throw err; } finally { await releaseClient(client); }
}));
