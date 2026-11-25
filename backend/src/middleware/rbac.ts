import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { Role } from '../config/roles';

/**
 * Restricts a route to a set of roles. `super_admin` always passes.
 * Usage: router.post('/', requireAuth, requireRole('hr', 'coo'), handler)
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === 'super_admin') return next();
    if (!roles.includes(req.user.role as Role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }
    next();
  };
}

/** Ensures a record's organizationId matches the requester's — the multi-tenant guard rail. */
export function sameOrganization(recordOrgId: unknown, req: Request): boolean {
  return String(recordOrgId) === req.user?.organizationId;
}
