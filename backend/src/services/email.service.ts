import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

/**
 * Email service. If SMTP_HOST isn't set (the default in .env), this
 * logs the email to the console instead of throwing — so the rest of the
 * platform (automation jobs, invite flows) can call sendMail() unconditionally
 * without every caller needing to check "is email configured?" first. Wire
 * real SMTP credentials (or swap this for SES/Postmark/etc — same interface)
 * to actually deliver mail.
 */
export interface MailAttachment {
  filename: string;
  content?: Buffer | string;
  path?: string;
  contentType?: string;
  cid?: string;
}

interface SendMailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: MailAttachment[];
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.smtp.host) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    // TLS certificates are always verified (the legacy app disabled verification, which allows man-in-the-middle attacks).
    tls: { minVersion: 'TLSv1.2' },
  });
  return transporter;
}

export async function sendMail(input: SendMailInput): Promise<{ delivered: boolean }> {
  const t = getTransporter();
  if (!t) {
    // eslint-disable-next-line no-console
    console.log(`[email:not-configured] to=${Array.isArray(input.to) ? input.to.join(',') : input.to} subject="${input.subject}" attachments=${(input.attachments || []).length} — set SMTP_HOST in .env to send real email.`);
    return { delivered: false };
  }
  await t.sendMail({
    from: env.smtp.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text || input.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
    attachments: input.attachments,
  });
  return { delivered: true };
}

export function certificationExpiryEmail(employeeName: string, certName: string, expiryDate: Date) {
  return {
    subject: `Certification expiring soon: ${certName}`,
    html: `<p>Hi ${employeeName},</p><p>Your certification <strong>${certName}</strong> expires on <strong>${expiryDate.toDateString()}</strong>. A renewal task has been created for you in Global SJX OS.</p>`,
  };
}

export function contractExpiryEmail(clientName: string, contractTitle: string, endDate: Date) {
  return {
    subject: `Contract renewal due: ${clientName}`,
    html: `<p>The contract <strong>${contractTitle}</strong> with <strong>${clientName}</strong> expires on <strong>${endDate.toDateString()}</strong>. Please review renewal options.</p>`,
  };
}
