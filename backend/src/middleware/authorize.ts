import type { RequestHandler } from 'express';
import { AppError } from './errors.js';
import type { PermissionAction } from '../types/auth.js';

export function authorize(module: string, action: PermissionAction): RequestHandler {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) return next(new AppError(401, 'Authentication required'));

    const allowed = user.permissions.some((permission: import('../types/auth.js').AuthPermission) => {
      return permission.module === module && permission.action === action;
    });

    if (!allowed) {
      return next(new AppError(403, `Missing permission: ${module}.${action}`));
    }

    next();
  };
}

export function requireSystemRole(): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError(401, 'Authentication required'));
    if (req.user.role_name !== 'System Admin') {
      return next(new AppError(403, 'System Admin role required'));
    }
    next();
  };
}
