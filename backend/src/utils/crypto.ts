import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Field-level encryption (ISO/IEC 27001:2022 A.8.24, data-protection by design).
 * Bank account numbers and employee payment details are stored as AES-256-GCM
 * ciphertext, so a database dump or a mis-scoped query never reveals them.
 * Format:  v1.<iv>.<authTag>.<ciphertext>  (base64url)
 */
const KEY = crypto.createHash('sha256').update(env.dataEncryptionKey).digest();
const HMAC_KEY = crypto.createHash('sha256').update(`hmac|${env.dataEncryptionKey}`).digest();

export function encryptField(plain: string | undefined | null): string | undefined {
  if (plain === undefined || plain === null || plain === '') return undefined;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptField(payload: string | undefined | null): string {
  if (!payload) return '';
  const [v, iv, tag, data] = payload.split('.');
  if (v !== 'v1' || !iv || !tag || !data) return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** Deterministic keyed hash — lets us enforce uniqueness / look up an encrypted value without decrypting it. */
export function blindIndex(value: string): string {
  return crypto.createHmac('sha256', HMAC_KEY).update(String(value).replace(/\s+/g, '').toLowerCase()).digest('hex');
}

export function last4(value: string | undefined | null): string {
  const digits = String(value || '').replace(/\s+/g, '');
  return digits.slice(-4);
}

export function maskAccount(last: string | undefined | null): string {
  return last ? `******${last}` : '—';
}

/** Cryptographically secure password that always satisfies the 12-char policy (replaces the legacy Math.random generator). */
export function generatePassword(length = 16): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*-_=+?';
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
