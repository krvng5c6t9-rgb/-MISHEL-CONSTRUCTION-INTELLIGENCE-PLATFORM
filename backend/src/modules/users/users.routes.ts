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
           u.full_name, u.email, u.phone, u.user_type, u.is_active, u.last_login_at, u.created_at,
           (u.mfa_enabled_at is not null) as mfa_enabled, user_requires_mfa(u.id) as mfa_required
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
// G-017: lift a temporary sign-in lockout for a user of this organization; login events for this organization.
usersRouter.post('/:id/unlock-login', requireSystemRole(), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'Invalid user id');
  const [r] = await query<{ ok: boolean }>(`select login_unlock($1::bigint) as ok`, [id]);
  if (!r.ok) throw new AppError(404, 'User not found');
  res.json({ success: true, data: { user_id: id, sign_in: 'unlocked' } });
}));
usersRouter.get('/login-events', requireSystemRole(), asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
  res.json({ success: true, data: await query(`select id, email_key, address, outcome, occurred_at from login_events where org_id = $1 order by id desc limit $2`, [req.user!.org_id, limit]) });
}));
usersRouter.post('/:id/revoke-sessions', requireSystemRole(), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'Invalid user id');
  const rows = await query(`update users set token_version = token_version + 1, updated_at = now() where id = $1 and org_id = $2 returning id`, [id, req.user!.org_id]);
  if (!rows[0]) throw new AppError(404, 'User not found');
  res.json({ success: true, data: { user_id: id, sessions: 'revoked' } });
}));
// Stage 32 / DEC-015: lost authenticator - an administrator (never the user themself) clears the second factor with a
// reason; unused recovery codes are revoked and every session ends, so the user must set up MFA again at next sign-in.
usersRouter.post('/:id/mfa-reset', requireSystemRole(), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'Invalid user id');
  const b = z.object({ reason: z.string().trim().min(10) }).parse(req.body);
  if (id === req.user!.id) throw new AppError(403, 'Segregation of duties: another administrator resets your multi-factor sign-in');
  const client = await getClient();
  try {
    await client.query('begin');
    const u = (await client.query(`update users set mfa_secret_enc = null, mfa_enabled_at = null, mfa_last_step = 0, token_version = token_version + 1, updated_at = now()
      where id = $1 and org_id = $2 returning id`, [id, req.user!.org_id])).rows[0];
    if (!u) throw new AppError(404, 'User not found');
    await client.query(`update mfa_recovery_codes set revoked_at = now() where user_id = $1 and used_at is null and revoked_at is null`, [id]);
    await client.query(`insert into mfa_events(org_id, user_id, event, actor_id, reason) values ($1,$2,'reset',$3,$4)`, [req.user!.org_id, id, req.user!.id, b.reason]);
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; } finally { await releaseClient(client); }
  res.json({ success: true, data: { user_id: id, mfa: 'reset', sessions: 'revoked' } });
}));
