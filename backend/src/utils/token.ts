import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface TokenPayload {
  sub: string;
  role: string;
  organizationId: string;
  /** token version: bumping User.tokenVersion revokes every outstanding session */
  tv?: number;
  /** server-side session id — lets a single device be signed out without affecting the others */
  sid?: string;
}

export interface MfaChallengePayload {
  sub: string;
  purpose: 'mfa_challenge';
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as any });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.jwtSecret) as TokenPayload;
}

/** Short-lived (5 min) token proving "this request just supplied the correct password for this user" — not a session token, only redeemable at POST /auth/mfa/challenge. */
export function signMfaChallengeToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: 'mfa_challenge' }, env.jwtSecret, { expiresIn: '5m' });
}

export function verifyMfaChallengeToken(token: string): MfaChallengePayload {
  const payload = jwt.verify(token, env.jwtSecret) as MfaChallengePayload;
  if (payload.purpose !== 'mfa_challenge') throw new Error('Invalid challenge token');
  return payload;
}
