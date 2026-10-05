import jwt from 'jsonwebtoken';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { AppError } from './errors.js';
import { enterDbContext, withDbContext } from '../db/context.js';
import type { AuthPermission, AuthUser, JwtPayload } from '../types/auth.js';

async function loadUser(userId: number, orgId: number): Promise<AuthUser | null> {
  const users = await query<Omit<AuthUser, 'permissions'>>(`
    select u.id, u.org_id, u.employee_id, u.role_id, r.role_name,
           u.full_name, u.email, u.user_type
    from users u
    join roles r on r.id = u.role_id
    where u.id = $1 and u.org_id = $2 and u.is_active = true and r.is_active = true
    limit 1
  `, [userId, orgId]);

  const user = users[0];
  if (!user) return null;

  const permissions = await query<AuthPermission>(`
    select module, action, scope
    from permissions
    where role_id = $1
  `, [user.role_id]);

  return { ...user, permissions };
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, 'Missing Bearer token');
    }

    const token = header.slice('Bearer '.length);
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    const userId = Number(decoded.sub);
    const tokenOrgId = Number(decoded.org_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AppError(401, 'Invalid token subject');
    }
    if (!Number.isInteger(tokenOrgId) || tokenOrgId <= 0) {
      throw new AppError(401, 'Invalid token organization');
    }

    // RLS requires tenant context before reading users. The tenant comes from the
    // signed JWT, never from request body/query/params, and is re-validated in SQL.
    const user = await withDbContext({ userId, orgId: tokenOrgId }, async () => loadUser(userId, tokenOrgId));
    if (!user || user.org_id !== tokenOrgId) throw new AppError(401, 'User is inactive or not found');

    // Persist tenant/user context for the complete downstream Express async chain.
    // Calling next() inside AsyncLocalStorage.run() is unsafe because Express does not
    // return/await the downstream promise; the run scope can end before route queries.
    enterDbContext({ userId, orgId: user.org_id });
    req.user = user;
    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(401, 'Invalid or expired token'));
  }
};
