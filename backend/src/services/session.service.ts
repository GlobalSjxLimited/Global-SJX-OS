import crypto from 'crypto';
import { Request } from 'express';
import { UserSession } from '../models/Access';
import { signToken } from '../utils/token';
import { env } from '../config/env';
import { sendMail } from './email.service';
import { renderEmail, kvTable, callout } from './mail.templates';
import { logger } from '../utils/logger';

export function parseUserAgent(ua = ''): { device: string; browser: string } {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl|axios|node/i.test(ua) ? 'API client' : 'Unknown browser';
  const device = /iPhone|iPad/.test(ua) ? 'iOS device' : /Android/.test(ua) ? 'Android device' : /Windows/.test(ua) ? 'Windows PC' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  return { device, browser };
}

const fingerprint = (ip: string | null | undefined, ua: string) => crypto.createHash('sha256').update(`${ip || ''}|${ua}`).digest('hex').slice(0, 16);

/** Creates a server-side session row and returns a signed JWT bound to it. Sends a "new sign-in" alert when the device/location is unfamiliar. */
export async function issueSession(req: Request, user: any): Promise<string> {
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  const { device, browser } = parseUserAgent(ua);
  const ttlMs = 7 * 24 * 3600 * 1000;
  const previous = await UserSession.find({ userId: user._id }).sort({ createdAt: -1 }).limit(25).select('ip userAgent');
  const known = previous.some((s) => fingerprint(s.ip, s.userAgent || '') === fingerprint(req.ip, ua));
  const session = await UserSession.create({ organizationId: user.organizationId, userId: user._id, ip: req.ip, userAgent: ua, device, browser, expiresAt: new Date(Date.now() + ttlMs) });

  if (!known && previous.length > 0 && user.securityPrefs?.loginNotifications !== false) {
    const mail = renderEmail({
      title: 'New sign-in to your account',
      intro: `Hello ${user.name}, we noticed a sign-in from a device we haven't seen before.`,
      body:
        kvTable([['Device', `${device} · ${browser}`], ['IP address', req.ip], ['Time', new Date().toUTCString()]]) +
        callout("If this was you, no action is needed. If not, change your password immediately and use <b>Sign out other devices</b> in Settings → Security.", 'warn'),
      cta: { label: 'Review my sessions', path: '/settings' },
    });
    sendMail({ to: user.email, subject: 'New sign-in to GLOBAL SJX OS', html: mail.html, attachments: mail.attachments }).catch((err) => logger.warn({ err }, 'new-device e-mail failed'));
  }
  return signToken({ sub: String(user._id), role: user.role, organizationId: String(user.organizationId), tv: user.tokenVersion ?? 0, sid: String(session._id) });
}

export async function endSession(sid: string | undefined, reason: string) {
  if (!sid) return;
  await UserSession.updateOne({ _id: sid, isActive: true }, { isActive: false, terminatedAt: new Date(), terminationReason: reason });
}

export const idleLimitMs = (user: any) => Math.max(5, user?.securityPrefs?.sessionTimeoutMinutes || env.sessionIdleMinutes) * 60000;
