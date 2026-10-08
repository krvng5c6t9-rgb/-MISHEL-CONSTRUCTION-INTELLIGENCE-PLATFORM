import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize, requireSystemRole } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

export const usersRouter = Router();

const createUserSchema = z.object({
  org_id: z.number().int().positive().optional(),
  employee_id: z.number().int().positive().nullable().optional(),
  role_id: z.number().int().positive(),
  full_name: z.string().min(2).max(150),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
  password: z.string().min(8).max(100),
  user_type: z.enum(['internal','client_portal','subcontractor_portal']).default('internal')
});

usersRouter.get('/', authorize('admin', 'view'), asyncHandler(async (req, res) => {
  const orgId = req.user!.org_id;
  const rows = await query(`
    select u.id, u.org_id, u.employee_id, u.role_id, r.role_name,
           u.full_name, u.email, u.phone, u.user_type, u.is_active, u.last_login_at, u.created_at
    from users u
    join roles r on r.id = u.role_id
    where u.org_id = $1
    order by u.created_at desc
  `, [orgId]);
  res.json({ success: true, data: rows });
}));

usersRouter.post('/', requireSystemRole(), asyncHandler(async (req, res) => {
  const body = createUserSchema.parse(req.body);
  const orgId = req.user!.org_id;
  const client = await getClient();
  try {
    await client.query('begin');
    const role = (await client.query(
      'select id from roles where id=$1 and org_id=$2 and is_active=true for share',
      [body.role_id, orgId]
    )).rows[0];
    if (!role) throw new AppError(422, 'Role not found in current organization');

    if (body.employee_id != null) {
      const employee = (await client.query(
        'select id from employees where id=$1 and org_id=$2 for share',
        [body.employee_id, orgId]
      )).rows[0];
      if (!employee) throw new AppError(422, 'Employee not found in current organization');
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const result = await client.query(`
      insert into users (org_id, employee_id, role_id, full_name, email, phone, password_hash, user_type, is_active)
      values ($1,$2,$3,$4,lower($5),$6,$7,$8,true)
      returning id, org_id, employee_id, role_id, full_name, email, phone, user_type, is_active, created_at
    `, [orgId, body.employee_id ?? null, body.role_id, body.full_name, body.email, body.phone ?? null, passwordHash, body.user_type]);
    await client.query('commit');
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

usersRouter.patch('/:id/status', requireSystemRole(), asyncHandler(async (req, res) => {
  const body = z.object({ is_active: z.boolean() }).parse(req.body);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'Invalid user id');

  const rows = await query(`
    update users set is_active = $2, updated_at = now()
    where id = $1
    returning id, org_id, full_name, email, is_active
  `, [id, body.is_active]);

  if (!rows[0]) throw new AppError(404, 'User not found');
  res.json({ success: true, data: rows[0] });
}));

// CC-037: administrator revokes every session of a user (compromise response) without deactivating the account.
usersRouter.post('/:id/revoke-sessions', requireSystemRole(), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'Invalid user id');
  const rows = await query(`update users set token_version = token_version + 1, updated_at = now() where id = $1 and org_id = $2 returning id`, [id, req.user!.org_id]);
  if (!rows[0]) throw new AppError(404, 'User not found');
  res.json({ success: true, data: { user_id: id, sessions: 'revoked' } });
}));
