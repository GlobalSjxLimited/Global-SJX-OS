import crypto from 'crypto';
import path from 'path';
import { env } from '../../config/env';

/**
 * Instagram and Facebook fetch pictures from a web address, but our uploads are private.
 * So each picture gets a short-lived, signed link (valid ~30 minutes, one file, images only) that is only handed to the platform at the moment of posting.
 */
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const sig = (org: string, file: string, exp: number) => crypto.createHmac('sha256', env.jwtSecret).update(`media|${org}|${file}|${exp}`).digest('hex');

export function isPublicImage(file: string) { return IMAGE_EXT.has(path.extname(file).toLowerCase()); }

export function signedMediaUrl(storedUrl: string, ttlSeconds = 1800, now = Date.now()): string | null {
  const m = /^\/api\/uploads\/([a-f\d]{24})\/([\w.-]+)$/i.exec(storedUrl);
  if (!m || !isPublicImage(m[2])) return null;
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return `${env.publicApiUrl}/api/public-media/${m[1]}/${m[2]}?exp=${exp}&sig=${sig(m[1], m[2], exp)}`;
}

export function verifyMediaSignature(org: string, file: string, exp: number, given: string, now = Date.now()): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const want = sig(org, file, exp);
  const a = Buffer.from(want), b = Buffer.from(String(given || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
