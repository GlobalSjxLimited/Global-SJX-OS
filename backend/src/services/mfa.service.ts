import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import { env } from '../config/env';

export function generateSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpAuthUrl(email: string, secret: string): string {
  return authenticator.keyuri(email, env.mfaIssuer, secret);
}

export async function buildQrCodeDataUrl(otpAuthUrl: string): Promise<string> {
  return qrcode.toDataURL(otpAuthUrl);
}

export function verifyCode(code: string, secret: string): boolean {
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}
