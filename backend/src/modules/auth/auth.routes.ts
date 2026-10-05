import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { withDbContext } from '../../db/context.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authenticate } from '../../middleware/authenticate.js';
import { AppError } from '../../middleware/errors.js';
import type { AuthPermission } from '../../types/auth.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  org_id: z.number().int().positive()
});

const bootstrapSchema = z.object({
  org_id: z.number().int().positive().optional(),
  organization: z.object({
    name: z.string().min(2).max(200),
    legal_name: z.string().max(200).nullable().optional(),
    tax_id: z.string().max(50).nullable().optional(),
    address: z.string().max(1000).nullable().optional(),
    base_currency_code: z.string().length(3).transform(v => v.toUpperCase()).default('EGP')
  }).optional(),
  full_name: z.string().min(2).max(150),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  role_name: z.string().min(2).max(100).default('System Admin')
}).refine(v => v.org_id != null || v.organization != null, {
  message: 'Provide org_id or organization details'
});

function signToken(user: { id: number; org_id: number; role_id: number; email: string }) {
  return jwt.sign({
    sub: String(user.id),
    org_id: user.org_id,
    role_id: user.role_id,
    email: user.email
  }, env.JWT_SECRET, { expiresIn: '8h' });
}

async function permissionsForRole(roleId: number) {
  return query<AuthPermission>(`
    select module, action, scope
    from permissions
    where role_id = $1
    order by module, action
  `, [roleId]);
}

authRouter.post('/login', asyncHandler(async (req, res) => {
  const body = loginSchema.parse(req.body);
  const rows = await withDbContext({ mode: 'login' }, () => query<{
    id: number; org_id: number; employee_id: number | null; role_id: number;
    role_name: string; full_name: string; email: string; password_hash: string; user_type: string;
  }>(`
    select u.id, u.org_id, u.employee_id, u.role_id, r.role_name,
           u.full_name, u.email, u.password_hash, u.user_type
    from users u
    join roles r on r.id = u.role_id
    where lower(u.email) = lower($1)
      and ($2::bigint is null or u.org_id = $2)
      and u.is_active = true
      and r.is_active = true
    limit 1
  `, [body.email, body.org_id ?? null]));

  const user = rows[0];
  if (!user) throw new AppError(401, 'Invalid email or password');

  const ok = await bcrypt.compare(body.password, user.password_hash);
  if (!ok) throw new AppError(401, 'Invalid email or password');

  const permissions = await withDbContext({ orgId: user.org_id, userId: user.id }, async () => {
    await query('update users set last_login_at = now() where id = $1', [user.id]);
    return permissionsForRole(user.role_id);
  });
  const token = signToken(user);

  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        org_id: user.org_id,
        employee_id: user.employee_id,
        role_id: user.role_id,
        role_name: user.role_name,
        full_name: user.full_name,
        email: user.email,
        user_type: user.user_type,
        permissions
      }
    }
  });
}));

authRouter.get('/me', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: req.user });
}));

// Safe first-run helper: only works when there are no active users in the target org.
authRouter.post('/bootstrap-admin', asyncHandler(async (req, res) => {
  const suppliedToken = String(req.header('x-bootstrap-token') ?? '');
  const expectedToken = env.BOOTSTRAP_ADMIN_TOKEN;
  const supplied = Buffer.from(suppliedToken);
  const expected = Buffer.from(expectedToken);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new AppError(403, 'Bootstrap authorization failed');
  }

  const body = bootstrapSchema.parse(req.body);
  const client = await withDbContext({ mode: 'bootstrap' }, () => getClient());
  try {
    await client.query('begin');

    // First-run only unless multi-tenant bootstrap is explicitly enabled (F-08).
    if (!env.ALLOW_MULTI_TENANT_BOOTSTRAP && (await client.query('select platform_has_any_user() as v')).rows[0]?.v) {
      throw new AppError(403, 'Bootstrap is limited to first run; additional tenants require the tenant provisioning process');
    }

    let org: { id: number; name: string } | undefined;
    if (body.org_id != null) {
      org = (await client.query(
        'select id,name from organizations where id=$1 and is_active=true for update',
        [body.org_id]
      )).rows[0];
      if (!org) throw new AppError(404, 'Organization not found or inactive');
    } else {
      const cfg = body.organization!;
      const currency = (await client.query(
        'select id from currencies where code=$1 and is_active=true limit 1',
        [cfg.base_currency_code]
      )).rows[0];
      if (!currency) throw new AppError(422, `Base currency ${cfg.base_currency_code} is not configured`);

      // Reuse the pristine release placeholder organization when possible so historical
      // seeded roles/cost-code templates remain valid; otherwise create a new tenant.
      const pristine = (await client.query(`
        select o.id,o.name
        from organizations o
        where o.is_active=true
          and o.name='Construction ERP Bootstrap Organization'
          and not exists(select 1 from users u where u.org_id=o.id)
          and not exists(select 1 from projects p where p.org_id=o.id)
        order by o.id
        limit 1
        for update
      `)).rows[0];

      if (pristine) {
        org = (await client.query(`
          update organizations
          set name=$2,legal_name=$3,tax_id=$4,address=$5,base_currency_id=$6,updated_at=now()
          where id=$1
          returning id,name
        `,[pristine.id,cfg.name,cfg.legal_name??null,cfg.tax_id??null,cfg.address??null,currency.id])).rows[0];
      } else {
        org = (await client.query(`
          insert into organizations(name,legal_name,tax_id,address,base_currency_id,is_active)
          values($1,$2,$3,$4,$5,true)
          returning id,name
        `,[cfg.name,cfg.legal_name??null,cfg.tax_id??null,cfg.address??null,currency.id])).rows[0];
      }
    }

    const orgId = Number(org!.id);
    await client.query("select set_config('app.org_id',$1,false)", [String(orgId)]);

    // An organization that has ever had a user (active or not) can never be claimed through bootstrap.
    const claimed = (await client.query('select platform_org_has_any_user($1) as v', [orgId])).rows[0]?.v;
    if (claimed) {
      throw new AppError(409, 'Bootstrap is disabled because this organization already has users');
    }

    const roleResult = await client.query(`
      insert into roles (org_id, role_name, description, is_system_role, is_active)
      values ($1, $2, 'Bootstrap administrator role', true, true)
      on conflict (org_id, role_name) do update set is_active = true
      returning id, org_id, role_name
    `, [orgId, body.role_name]);
    const role = roleResult.rows[0];

    const modules = ['admin','projects','boq','procurement','finance','cost_control','approvals','technical_office','planning','site','hr','assets','qaqc','hse','edms','dashboards','reports','portals','system','crm','tendering','contracts','notifications','ai_platform','commercial_platform','automation','knowledge','vendors'];
    const actions = ['view','create','edit','approve','delete','export','manage','post'];
    for (const module of modules) {
      for (const action of actions) {
        await client.query(`
          insert into permissions (role_id, module, action, scope)
          values ($1, $2, $3, 'all')
          on conflict (role_id, module, action) do nothing
        `, [role.id, module, action]);
      }
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const userResult = await client.query(`
      insert into users (org_id, role_id, full_name, email, password_hash, user_type, is_active)
      values ($1, $2, $3, lower($4), $5, 'internal', true)
      returning id, org_id, employee_id, role_id, full_name, email, user_type
    `, [orgId, role.id, body.full_name, body.email, passwordHash]);

    await client.query('commit');
    const user = userResult.rows[0];
    const permissions = await withDbContext({ orgId, userId: user.id }, () => permissionsForRole(role.id));
    res.status(201).json({
      success: true,
      data: {
        organization: { id: orgId, name: org!.name },
        token: signToken(user),
        user: { ...user, role_name: role.role_name, permissions }
      }
    });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));
