import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

export interface RequestStore { ip?: string; device?: string; userId?: string; userName?: string }
const als = new AsyncLocalStorage<RequestStore>();

export const currentContext = (): RequestStore => als.getStore() || {};

/** "Chrome on Windows"-style label from a user-agent. Never stores the raw string. */
export function deviceLabel(ua = ''): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ua ? 'Other browser' : 'Unknown';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/** Wrap each request so any save() further down can say who did it, from where. */
export function requestContext(req: Request, _res: Response, next: NextFunction) {
  als.run({ ip: req.ip, device: deviceLabel(String(req.headers['user-agent'] || '')) }, next);
}
/** Call once the user is known (requireAuth). */
export function setContextUser(id: string, name: string) {
  const s = als.getStore();
  if (s) { s.userId = id; s.userName = name; }
}
