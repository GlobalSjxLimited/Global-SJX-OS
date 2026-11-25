import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { requireAuth } from './auth';

/**
 * Module gate: the request is allowed only if the signed-in user's effective
 * module set (role defaults + overrides) contains at least one of the given modules.
 * Roles are tied to modules, so hiding a menu item is never the only protection.
 */
export function requireModule(...modules: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    requireAuth(req, res, (err?: any) => {
      if (err) return next(err);
      const mine = req.user!.modules || [];
      if (req.user!.role === 'super_admin' || modules.some((m) => mine.includes(m))) return next();
      next(ApiError.forbidden(`Your role does not include access to this module (${modules.join(' / ')}).`));
    });
  };
}

export const hasModule = (req: Request, ...modules: string[]) => req.user!.role === 'super_admin' || modules.some((m) => (req.user!.modules || []).includes(m));
