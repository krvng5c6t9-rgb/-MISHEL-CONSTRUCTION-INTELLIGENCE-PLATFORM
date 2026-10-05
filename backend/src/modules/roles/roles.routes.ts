import { Router } from 'express';
import { z } from 'zod';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize, requireSystemRole } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

export const rolesRouter = Router();

const roleSchema = z.object({
  org_id: z.number().int().positive().optional(),
  role_name: z.string().min(2).max(100),
  description: z.string().optional(),
  permissions: z.array(z.object({
    module: z.string().min(2).max(60),
    action: z.enum(['view','create','edit','approve','delete','export','manage','post']),
    scope: z.enum(['own','department','all']).default('own')
  })).default([])
});

rolesRouter.get('/', authorize('admin', 'view'), asyncHandler(async (req, res) => {
  const orgId = req.user!.org_id;
  const roles = await query(`
    select id, org_id, role_name, description, is_system_role, is_active, created_at
    from roles
    where org_id = $1
    order by role_name
  `, [orgId]);
  res.json({ success: true, data: roles });
}));

rolesRouter.get('/:id/permissions', authorize('admin', 'view'), asyncHandler(async (req, res) => {
  const roleId = Number(req.params.id);
  if (!Number.isInteger(roleId) || roleId <= 0) throw new AppError(400, 'Invalid role id');
  const permissions = await query(`
    select p.id, p.role_id, p.module, p.action, p.scope
    from permissions p
    join roles r on r.id = p.role_id
    where p.role_id = $1 and r.org_id = $2
    order by p.module, p.action
  `, [roleId, req.user!.org_id]);
  res.json({ success: true, data: permissions });
}));

rolesRouter.put('/:id/permissions', requireSystemRole(), asyncHandler(async (req, res) => {
  const roleId = Number(req.params.id);
  if (!Number.isInteger(roleId) || roleId <= 0) throw new AppError(400, 'Invalid role id');
  const body = z.object({ permissions: roleSchema.shape.permissions }).parse(req.body);
  const client = await getClient();
  try {
    await client.query('begin');
    const role = (await client.query(
      'select id, is_system_role from roles where id=$1 and org_id=$2 and is_active=true for update',
      [roleId, req.user!.org_id]
    )).rows[0];
    if (!role) throw new AppError(404, 'Role not found in current organization');

    await client.query('delete from permissions where role_id=$1', [roleId]);
    for (const permission of body.permissions) {
      await client.query(`
        insert into permissions(role_id,module,action,scope)
        values($1,$2,$3,$4)
        on conflict(role_id,module,action) do update set scope=excluded.scope
      `, [roleId, permission.module, permission.action, permission.scope]);
    }
    await client.query('commit');
    const rows = await query(`
      select p.id,p.role_id,p.module,p.action,p.scope
      from permissions p join roles r on r.id=p.role_id
      where p.role_id=$1 and r.org_id=$2 order by p.module,p.action
    `, [roleId, req.user!.org_id]);
    res.json({ success: true, data: rows });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

rolesRouter.post('/', requireSystemRole(), asyncHandler(async (req, res) => {
  const body = roleSchema.parse(req.body);
  const orgId = req.user!.org_id;
  const client = await getClient();
  try {
    await client.query('begin');
    const roleResult = await client.query(`
      insert into roles (org_id, role_name, description, is_system_role, is_active)
      values ($1,$2,$3,false,true)
      returning id, org_id, role_name, description, is_system_role, is_active
    `, [orgId, body.role_name, body.description ?? null]);
    const role = roleResult.rows[0];

    for (const permission of body.permissions) {
      await client.query(`
        insert into permissions (role_id, module, action, scope)
        values ($1,$2,$3,$4)
      `, [role.id, permission.module, permission.action, permission.scope]);
    }

    await client.query('commit');
    res.status(201).json({ success: true, data: role });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

rolesRouter.patch('/:id/status', requireSystemRole(), asyncHandler(async (req, res) => {
  const body = z.object({ is_active: z.boolean() }).parse(req.body);
  const roleId = Number(req.params.id);
  const role = await query<{ is_system_role: boolean }>('select is_system_role from roles where id = $1', [roleId]);
  if (!role[0]) throw new AppError(404, 'Role not found');
  if (role[0].is_system_role && !body.is_active) throw new AppError(409, 'System role cannot be deactivated');

  const rows = await query(`
    update roles set is_active = $2, updated_at = now()
    where id = $1
    returning id, org_id, role_name, is_active
  `, [roleId, body.is_active]);
  res.json({ success: true, data: rows[0] });
}));
