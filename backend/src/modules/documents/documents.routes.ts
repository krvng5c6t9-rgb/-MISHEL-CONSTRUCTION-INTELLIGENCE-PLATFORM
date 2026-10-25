import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { getClient, releaseClient, query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { AppError } from '../../middleware/errors.js';
import { htmlToPdf } from './pdf.js';
import { pageFooter, renderIpc, renderSubcontractCertificate, type Lang } from './templates.js';

// CC-085 (R1.5 first part, MP-03 §1 / §5): print view (HTML) and PDF of the client IPC (DOC-15-001) and the
// subcontractor payment certificate (DOC-15-004). An export needs the same permission as the screen that shows the
// record; every export is entered in document_exports with the SHA-256 of the exact bytes returned, and its number is
// printed on the document.
export const documentsRouter = Router();

type Doc = { module: string; table: 'ipc' | 'subcontract_certificate'; load: (c: PoolClient, id: number, org: number) => Promise<any | null>; final: (d: any) => boolean;
  render: (lang: Lang, d: any, draft: boolean, exp: { id: number; at: string; by: string }) => string; name: (d: any) => string };

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
    final: d => d.ipc.status !== 'draft',
    render: (lang, d, draft, exp) => renderIpc(lang, d, draft, exp),
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
    final: d => ['approved', 'posted', 'paid'].includes(d.cert.status),
    render: (lang, d, draft, exp) => renderSubcontractCertificate(lang, d, draft, exp),
    name: d => `SC-${d.cert.certificate_no}`
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
    const draft = !doc.final(data);
    const status = data.ipc?.status ?? data.cert?.status;
    const e = (await client.query(`insert into document_exports(org_id, doc_type, record_id, record_status, is_draft, format, lang, exported_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, to_char(exported_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') as at`,
      [orgId, doc.table, id, status, draft, q.format, q.lang, req.user!.id])).rows[0];
    const html = doc.render(q.lang, data, draft, { id: Number(e.id), at: e.at, by: req.user!.full_name });
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
