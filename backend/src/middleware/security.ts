import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { cleanHtml } from '../utils/html';

/** Adds an X-Request-Id to every request/response so log lines, audit entries and user-reported errors can be correlated. */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  (req as any).id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively removes (a) keys starting with "$" or containing "." — the
 * vectors for MongoDB operator injection ({"email": {"$gt": ""}}) — and
 * (b) prototype-pollution keys. Secure-coding rule SC-02.
 */
export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return undefined;
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value as any)._bsontype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.startsWith('$') || k.includes('.') || FORBIDDEN_KEYS.has(k)) continue;
      out[k] = sanitizeValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction) {
  if (req.body) req.body = sanitizeValue(req.body);
  if (req.query) {
    const cleaned = sanitizeValue({ ...req.query }) as Record<string, unknown>;
    // Express 4 lets us reassign req.query; also collapse repeated params (HPP) to the last value for scalar-style filters.
    for (const k of Object.keys(cleaned)) {
      if (Array.isArray(cleaned[k]) && !/ids?$|\[\]$/i.test(k)) cleaned[k] = (cleaned[k] as unknown[])[(cleaned[k] as unknown[]).length - 1];
    }
    (req as any).query = cleaned;
  }
  if (req.params) req.params = sanitizeValue({ ...req.params }) as any;
  next();
}

/** API responses can contain personal data: forbid caching by browsers and intermediaries. */
export function noStoreApi(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

/** Remove fields clients must never set (mass-assignment protection, SC-03). */
export function stripProtected<T extends Record<string, any>>(body: T, extra: string[] = []): T {
  const blocked = new Set(['_id', 'id', 'organizationId', 'isDeleted', 'deletedAt', 'deletedById', 'createdAt', 'updatedAt', '__v', ...extra]);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(body || {})) if (!blocked.has(k)) out[k] = v;
  return out as T;
}

/** Fixed-length hash of an IP for consent / contact records: lets us rate-limit and de-duplicate without storing raw addresses. */
export function hashIp(ip: string | undefined): string {
  return crypto.createHash('sha256').update(`${ip || 'unknown'}|gsjx`).digest('hex').slice(0, 24);
}

/** Password policy (SC-05): 12+ chars, upper, lower, digit, symbol, not a trivially common value. */
export function passwordProblems(pw: string): string[] {
  const problems: string[] = [];
  if (pw.length < 12) problems.push('at least 12 characters');
  if (!/[a-z]/.test(pw)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(pw)) problems.push('an uppercase letter');
  if (!/\d/.test(pw)) problems.push('a number');
  if (!/[^A-Za-z0-9]/.test(pw)) problems.push('a symbol');
  if (/^(password|admin|welcome|qwerty|letmein|changeme)/i.test(pw)) problems.push('to not start with a common word');
  return problems;
}

const SKIP_KEY = /pass(word)?|token|secret|code|^url$|href|link/i;
const TAG_LIKE = /<\/?[a-z!][^>]*>?/i;

function cleanMarkup(value: unknown, key = '', depth = 0): unknown {
  if (depth > 12) return value;
  if (typeof value === 'string') return !SKIP_KEY.test(key) && TAG_LIKE.test(value) ? cleanHtml(value) : value;
  if (Array.isArray(value)) return value.map((v) => cleanMarkup(v, key, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cleanMarkup(v, k, depth + 1);
    return out;
  }
  return value;
}

/**
 * Defence in depth against stored XSS (SC-06): any string in a request body
 * that contains markup is passed through the server-side allow-list sanitiser
 * before a route handler sees it. Credentials, tokens and URLs are skipped.
 */
export function sanitizeMarkup(req: Request, _res: Response, next: NextFunction) {
  // The inbound-mail webhook receives raw e-mail ("Name <a@b.c>"); it escapes everything itself when it stores or displays it.
  if (req.body && typeof req.body === 'object' && !req.path.startsWith('/auth') && !req.path.startsWith('/intake/email')) req.body = cleanMarkup(req.body);
  next();
}
