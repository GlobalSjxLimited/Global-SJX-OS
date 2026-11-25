import path from 'path';
import { env } from '../config/env';
import type { MailAttachment } from './email.service';

/** Escape any dynamic value placed into an e-mail (prevents HTML injection through names, descriptions, vendors …). */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const LOGO_PATH = path.resolve(__dirname, '../../assets/logo.jpg');
export const logoAttachment: MailAttachment = { filename: 'global-sjx-logo.jpg', path: LOGO_PATH, cid: 'gsjx-logo', contentType: 'image/jpeg' };

export function money(amount: number | undefined | null, currency = 'NGN'): string {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export const fmtDate = (d?: Date | string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export function kvTable(rows: Array<[string, unknown]>): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:12px 0">${rows
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<tr><td style="padding:7px 10px;border-bottom:1px solid #eee;color:#6b6477;font-size:13px;width:38%">${esc(k)}</td><td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:14px;color:#1c1727">${typeof v === 'string' && v.startsWith('<!--html-->') ? v.slice(11) : esc(v)}</td></tr>`)
    .join('')}</table>`;
}

export function dataTable(head: string[], rows: string[][]): string {
  const th = head.map((h) => `<th align="left" style="padding:8px 10px;background:#f6effa;color:#4a2a55;font-size:12px;text-transform:uppercase;letter-spacing:.04em">${esc(h)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c) => `<td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:13px;color:#1c1727;vertical-align:top">${c}</td>`).join('')}</tr>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:12px 0"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

export function callout(text: string, tone: 'info' | 'warn' | 'danger' = 'info'): string {
  const c = { info: ['#f3e9fb', '#7b2a8a'], warn: ['#fff4e0', '#9a6212'], danger: ['#fdecea', '#b03226'] }[tone];
  return `<div style="background:${c[0]};border-left:4px solid ${c[1]};padding:10px 14px;border-radius:6px;margin:14px 0;font-size:13.5px;color:#241a2b">${text}</div>`;
}

/** Shared, branded HTML e-mail layout with the Global SJX logo (inline attachment, cid:gsjx-logo). */
export function renderEmail(opts: { title: string; intro?: string; body: string; cta?: { label: string; path: string }; footerNote?: string }): { html: string; attachments: MailAttachment[] } {
  const link = opts.cta ? `${env.appUrl}${opts.cta.path.startsWith('/') ? '' : '/'}${opts.cta.path}` : '';
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f1f7;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1c1727">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(40,20,60,.08)">
<tr><td style="background:linear-gradient(135deg,#C22FD4,#6d1a78);padding:18px 24px"><table role="presentation" width="100%"><tr>
<td style="width:64px"><img src="cid:gsjx-logo" width="56" height="56" alt="Global SJX" style="display:block;border-radius:10px;background:#fff"></td>
<td style="color:#fff;font-size:12px;letter-spacing:.12em;text-transform:uppercase;padding-left:12px">GLOBAL SJX OS<br><span style="font-size:11px;opacity:.85;letter-spacing:.04em;text-transform:none">Security · ISMS · Data Protection</span></td></tr></table></td></tr>
<tr><td style="padding:26px 28px 8px"><h1 style="margin:0 0 6px;font-family:Georgia,serif;font-size:22px;font-weight:600;color:#1c1727">${esc(opts.title)}</h1>${opts.intro ? `<p style="margin:0 0 10px;color:#5b5568;font-size:14px;line-height:1.55">${opts.intro}</p>` : ''}</td></tr>
<tr><td style="padding:4px 28px 20px;font-size:14px;line-height:1.6">${opts.body}
${link ? `<p style="margin:22px 0 4px"><a href="${esc(link)}" style="display:inline-block;background:#C22FD4;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600;font-size:14px">${esc(opts.cta!.label)}</a></p>` : ''}</td></tr>
<tr><td style="padding:14px 28px 22px;border-top:1px solid #eee;color:#8a8398;font-size:11.5px;line-height:1.5">${opts.footerNote ? `${opts.footerNote}<br>` : ''}This is an automated message from GLOBAL SJX OS. It may contain confidential information — do not forward it.<br>© ${new Date().getFullYear()} Global SJX Limited, Lagos.</td></tr>
</table></td></tr></table></body></html>`;
  return { html, attachments: [logoAttachment] };
}
