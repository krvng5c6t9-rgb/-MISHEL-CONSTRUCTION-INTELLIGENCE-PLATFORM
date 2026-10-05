import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { AppError } from '../../middleware/errors.js';
import { authorize } from '../../middleware/authorize.js';

export const portalsRouter = Router();
portalsRouter.use(authorize('portals', 'view'));

const positiveId = z.number().int().positive();
const parseId = (raw: string) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'Invalid access id');
  return id;
};

/**
 * Portal managers need tenant-scoped reference data without requiring admin/CRM permissions.
 * This endpoint intentionally exposes only the minimum identifiers/labels required to grant access.
 */
portalsRouter.get('/reference-data', authorize('portals', 'manage'), asyncHandler(async (req, res) => {
  const orgId = req.user!.org_id;
  const [users, clients, projects, vendors, subcontracts] = await Promise.all([
    query(`select id, full_name, email, user_type from users where org_id=$1 and is_active=true and user_type in ('client_portal','subcontractor_portal') order by full_name`, [orgId]),
    query(`select id, client_name from clients where org_id=$1 and is_active=true order by client_name`, [orgId]),
    query(`select id, project_code, project_name, client_id from projects where org_id=$1 and status <> 'cancelled' order by project_name`, [orgId]),
    query(`select id, vendor_name from vendors_subcontractors where org_id=$1 and is_active=true order by vendor_name`, [orgId]),
    query(`select id, vendor_id, project_id, package_name, status from subcontracts where org_id=$1 order by id desc`, [orgId])
  ]);
  res.json({ success: true, data: { users, clients, projects, vendors, subcontracts } });
}));

portalsRouter.get('/client-access', asyncHandler(async (req, res) => {
  const rows = await query(`
    select cpa.*, u.full_name, u.email, c.client_name, p.project_name
    from client_portal_access cpa
    join users u on u.id=cpa.user_id and u.org_id=cpa.org_id
    join clients c on c.id=cpa.client_id and c.org_id=cpa.org_id
    join projects p on p.id=cpa.project_id and p.org_id=cpa.org_id
    where cpa.org_id=$1
    order by cpa.granted_at desc
  `, [req.user!.org_id]);
  res.json({ success: true, data: rows });
}));

portalsRouter.post('/client-access', authorize('portals', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ user_id: positiveId, client_id: positiveId, project_id: positiveId, is_active: z.boolean().default(true) }).parse(req.body);
  const orgId = req.user!.org_id;

  const [user] = await query(`select id from users where id=$1 and org_id=$2 and user_type='client_portal' and is_active=true`, [b.user_id, orgId]);
  if (!user) throw new AppError(422, 'Active client portal user not found in your organization');
  const [client] = await query(`select id from clients where id=$1 and org_id=$2 and is_active=true`, [b.client_id, orgId]);
  if (!client) throw new AppError(422, 'Active client not found in your organization');
  const [project] = await query(`select id,client_id from projects where id=$1 and org_id=$2`, [b.project_id, orgId]);
  if (!project) throw new AppError(404, 'Project not found in your organization');
  if (project.client_id !== null && Number(project.client_id) !== b.client_id) {
    throw new AppError(422, 'Project is assigned to a different client');
  }

  const [created] = await query(`
    insert into client_portal_access (org_id, user_id, client_id, project_id, granted_by, is_active)
    values ($1,$2,$3,$4,$5,$6)
    on conflict (user_id, project_id) do update
      set org_id=excluded.org_id, client_id=excluded.client_id, granted_by=excluded.granted_by,
          granted_at=now(), is_active=excluded.is_active
    returning *
  `, [orgId, b.user_id, b.client_id, b.project_id, req.user!.id, b.is_active]);
  res.status(201).json({ success: true, data: created });
}));

portalsRouter.patch('/client-access/:id/status', authorize('portals', 'manage'), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const b = z.object({ is_active: z.boolean() }).parse(req.body);
  const [row] = await query(`update client_portal_access set is_active=$3, granted_by=$4, granted_at=now() where id=$1 and org_id=$2 returning *`, [id, req.user!.org_id, b.is_active, req.user!.id]);
  if (!row) throw new AppError(404, 'Client portal access not found');
  res.json({ success: true, data: row });
}));

portalsRouter.get('/subcontractor-access', asyncHandler(async (req, res) => {
  const rows = await query(`
    select spa.*, u.full_name, u.email, v.vendor_name, ('SC-' || s.id::text) as subcontract_ref, s.package_name
    from subcontractor_portal_access spa
    join users u on u.id=spa.user_id and u.org_id=spa.org_id
    join vendors_subcontractors v on v.id=spa.vendor_id and v.org_id=spa.org_id
    left join subcontracts s on s.id=spa.subcontract_id and s.org_id=spa.org_id
    where spa.org_id=$1
    order by spa.granted_at desc
  `, [req.user!.org_id]);
  res.json({ success: true, data: rows });
}));

portalsRouter.post('/subcontractor-access', authorize('portals', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ user_id: positiveId, vendor_id: positiveId, subcontract_id: positiveId.nullable().optional(), is_active: z.boolean().default(true) }).parse(req.body);
  const orgId = req.user!.org_id;

  const [user] = await query(`select id from users where id=$1 and org_id=$2 and user_type='subcontractor_portal' and is_active=true`, [b.user_id, orgId]);
  if (!user) throw new AppError(422, 'Active subcontractor portal user not found in your organization');
  const [vendor] = await query(`select id from vendors_subcontractors where id=$1 and org_id=$2 and is_active=true`, [b.vendor_id, orgId]);
  if (!vendor) throw new AppError(422, 'Vendor/subcontractor not found in your organization');
  if (b.subcontract_id != null) {
    const [subcontract] = await query(`select id from subcontracts where id=$1 and org_id=$2 and vendor_id=$3`, [b.subcontract_id, orgId, b.vendor_id]);
    if (!subcontract) throw new AppError(422, 'Subcontract does not belong to the selected vendor/organization');
  }

  const [created] = await query(`
    insert into subcontractor_portal_access (org_id, user_id, vendor_id, subcontract_id, granted_by, is_active)
    values ($1,$2,$3,$4,$5,$6)
    on conflict (user_id, vendor_id, subcontract_id) do update
      set org_id=excluded.org_id, granted_by=excluded.granted_by, granted_at=now(), is_active=excluded.is_active
    returning *
  `, [orgId, b.user_id, b.vendor_id, b.subcontract_id ?? null, req.user!.id, b.is_active]);
  res.status(201).json({ success: true, data: created });
}));

portalsRouter.patch('/subcontractor-access/:id/status', authorize('portals', 'manage'), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const b = z.object({ is_active: z.boolean() }).parse(req.body);
  const [row] = await query(`update subcontractor_portal_access set is_active=$3, granted_by=$4, granted_at=now() where id=$1 and org_id=$2 returning *`, [id, req.user!.org_id, b.is_active, req.user!.id]);
  if (!row) throw new AppError(404, 'Subcontractor portal access not found');
  res.json({ success: true, data: row });
}));

portalsRouter.get('/client/dashboard', asyncHandler(async (req, res) => {
  if (req.user!.user_type !== 'client_portal') throw new AppError(403, 'Client portal user required');
  const rows = await query(`
    select p.id, p.project_name, p.status, p.current_contract_value, v.percent_billed, v.schedule_performance_index,
           count(distinct i.id) filter (where i.status in ('submitted','approved_by_consultant','posted'))::int as ipc_count,
           count(distinct d.id)::int as document_count
    from client_portal_access cpa
    join projects p on p.id=cpa.project_id and p.org_id=cpa.org_id
    left join v_portfolio_summary v on v.project_id=p.id
    left join ipcs i on i.project_id=p.id and i.org_id=cpa.org_id
    left join documents d on d.project_id=p.id and d.org_id=cpa.org_id
    where cpa.org_id=$1 and cpa.user_id=$2 and cpa.is_active=true
    group by p.id, p.project_name, p.status, p.current_contract_value, v.percent_billed, v.schedule_performance_index
    order by p.project_name
  `, [req.user!.org_id, req.user!.id]);
  res.json({ success: true, data: rows });
}));

portalsRouter.get('/subcontractor/dashboard', asyncHandler(async (req, res) => {
  if (req.user!.user_type !== 'subcontractor_portal') throw new AppError(403, 'Subcontractor portal user required');
  const rows = await query(`
    select v.vendor_name, s.id as subcontract_id, ('SC-' || s.id::text) as subcontract_ref, s.status,
           coalesce(cert.certificate_count,0)::int as certificate_count,
           coalesce(cert.approved_value,0) as approved_value,
           coalesce(instr.open_site_instructions,0)::int as open_site_instructions
    from subcontractor_portal_access spa
    join vendors_subcontractors v on v.id=spa.vendor_id and v.org_id=spa.org_id
    left join subcontracts s on s.vendor_id=v.id and s.org_id=spa.org_id and (spa.subcontract_id is null or spa.subcontract_id=s.id)
    left join lateral (
      select count(*)::int as certificate_count,
             coalesce(sum(sc.net_amount_due) filter (where sc.status in ('approved','paid')),0) as approved_value
      from subcontract_certificates sc
      where sc.subcontract_id=s.id and sc.org_id=spa.org_id
    ) cert on true
    left join lateral (
      select count(*)::int as open_site_instructions
      from site_instructions si
      where si.project_id=s.project_id and si.org_id=spa.org_id and si.status <> 'closed'
    ) instr on true
    where spa.org_id=$1 and spa.user_id=$2 and spa.is_active=true
    order by s.id nulls last
  `, [req.user!.org_id, req.user!.id]);
  res.json({ success: true, data: rows });
}));
