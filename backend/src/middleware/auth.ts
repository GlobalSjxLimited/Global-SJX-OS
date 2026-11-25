import { setContextUser } from '../utils/requestContext';
import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { verifyToken } from '../utils/token';
import { User } from '../models/User';
import { UserSession } from '../models/Access';
import { effectiveModules } from '../services/access.service';
import { idleLimitMs } from '../services/session.service';
import { env } from '../config/env';

export interface AuthedUser {
  id: string;
  role: string;
  organizationId: string;
  name: string;
  email: string;
  modules: string[];
  sessionId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

const SELECT = 'name email role organizationId isActive loginEnabled tokenVersion moduleGrant moduleDeny mustChangePassword securityPrefs';
// A user who must change their password may only use these endpoints until they have.
const PASSWORD_CHANGE_ALLOWED = /^\/api\/(auth\/(me|change-password|logout|revoke-sessions)|consent|sessions\/mine)/;

async function resolve(req: Request): Promise<AuthedUser | null> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const payload = verifyToken(header.slice('Bearer '.length));
  const user = await User.findById(payload.sub).select(SELECT);
  if (!user || !user.isActive || user.loginEnabled === false) throw ApiError.unauthorized('Account not found or disabled');
  if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) throw ApiError.unauthorized('Session revoked');

  if (payload.sid) {
    const session = await UserSession.findById(payload.sid);
    if (!session || !session.isActive || session.expiresAt.getTime() < Date.now()) throw ApiError.unauthorized('Session ended');
    if (Date.now() - new Date(session.lastSeenAt as any).getTime() > idleLimitMs(user)) {
      session.isActive = false;
      session.terminatedAt = new Date();
      session.terminationReason = 'Idle timeout';
      await session.save();
      throw ApiError.unauthorized('Signed out after inactivity');
    }
    // Refresh the activity marker at most once a minute (cheap on hot paths).
    if (Date.now() - new Date(session.lastSeenAt as any).getTime() > 60000) {
      session.lastSeenAt = new Date();
      await session.save();
    }
  } else if (env.isHardened) {
    throw ApiError.unauthorized('Please sign in again');
  }

  if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.test(req.originalUrl.split('?')[0])) {
    throw new ApiError(403, 'You must change your temporary password before continuing.', { code: 'PASSWORD_CHANGE_REQUIRED' });
  }

  const modules = await effectiveModules({ role: user.role, organizationId: String(user.organizationId), moduleGrant: user.moduleGrant as string[], moduleDeny: user.moduleDeny as string[] });
  return { id: user.id, role: user.role, organizationId: String(user.organizationId), name: user.name, email: user.email, modules, sessionId: payload.sid };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    if (req.user) return next(); // already resolved earlier in this request (module gate)
    const u = await resolve(req);
    if (!u) throw ApiError.unauthorized('Missing bearer token');
    req.user = u;
    setContextUser(u.id, u.name);
    next();
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 403) return next(err);
    next(err instanceof ApiError ? err : ApiError.unauthorized('Invalid or expired session'));
  }
}

/** Optional auth — attaches req.user if a valid token is present, otherwise continues. */
export async function attachUserIfPresent(req: Request, _res: Response, next: NextFunction) {
  try {
    const u = await resolve(req);
    if (u) req.user = u;
  } catch {
    /* ignore invalid token on optional auth */
  }
  next();
}
