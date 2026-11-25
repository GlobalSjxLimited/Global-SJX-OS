import { env } from '../config/env';
import { company } from '../config/company';
import { esc, fmtDate } from './mail.templates';
import { sym, fmtN } from './invoiceDocument.service';

/**
 * E-mails in the legacy Global SJX layout (Outfit font, #964FFE header bar, white card on #f9f9f9, detail lists, optional
 * action button, "© GSJX LTD" footer). Every dynamic value is HTML-escaped.
 */
const BRAND = '#964FFE';

interface Block { title: string; rows: Array<[string, unknown]> }
function layout(o: { heading: string; greeting?: string; paragraphs?: string[]; blocks?: Block[]; cta?: { label: string; path: string }; signoff?: string; note?: string }) {
  const link = o.cta ? `${env.appUrl}${o.cta.path.startsWith('/') ? '' : '/'}${o.cta.path}` : '';
  const ul = (rows: Array<[string, unknown]>) => `<ul style="list-style:none;padding:0;margin:0 0 16px">${rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `<li style="padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:14px"><strong style="color:#333">${esc(k)}:</strong> <span style="color:#555">${esc(v)}</span></li>`).join('')}</ul>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.heading)}</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:'Outfit','Segoe UI',Arial,sans-serif;color:#333">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:24px 10px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.08)">
<tr><td style="background:${BRAND};padding:22px 28px"><h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600">${esc(o.heading)}</h1></td></tr>
<tr><td style="padding:26px 28px;font-size:15px;line-height:1.6">
${o.greeting ? `<p style="margin:0 0 14px">${esc(o.greeting)}</p>` : ''}
${(o.paragraphs || []).map((p) => `<p style="margin:0 0 14px">${p}</p>`).join('')}
${(o.blocks || []).map((b) => `<h3 style="margin:18px 0 6px;font-size:15px;color:${BRAND}">${esc(b.title)}</h3>${ul(b.rows)}`).join('')}
${link ? `<p style="margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 26px;border-radius:6px;font-weight:600;font-size:14px">${esc(o.cta!.label)}</a></p>` : ''}
${o.note ? `<p style="margin:14px 0;padding:10px 14px;background:#f5f0ff;border-left:4px solid ${BRAND};border-radius:4px;font-size:13px">${o.note}</p>` : ''}
<p style="margin:22px 0 0">Best Regards,<br><strong>${esc(o.signoff || 'Global SJX Finance')}</strong></p>
</td></tr>
<tr><td style="padding:14px 28px;background:#fafafa;border-top:1px solid #eee;color:#999;font-size:12px;text-align:center">© ${new Date().getFullYear()} GSJX LTD. All rights reserved.</td></tr>
</table></td></tr></table></body></html>`;
}

const money = (n: number, c: string) => `${sym(c)}${fmtN(n, c)}`;
function invoiceRows(inv: any): Array<[string, unknown]> {
  return [['Invoice No', inv.invoiceNo], ['Reference', inv.referenceNo], ['Type', inv.invoiceType], ['Issue date', fmtDate(inv.issueDate)], ['Due date', fmtDate(inv.dueDate)], ['Period', inv.periodLabel],
    ['Currency', inv.currency], ['Total (incl. VAT)', money(inv.total, inv.currency)], ['Amount due', money(inv.balance, inv.currency)], ...(inv.currency !== 'NGN' ? [['NGN equivalent', `₦${fmtN(inv.totalNgn, 'NGN')}`] as [string, unknown]] : [])];
}
const taxBlock = (): Block => ({ title: 'Tax Details', rows: [['Name', company.name], ['VAT Number', company.vatNumber], ['NRC Tax ID', company.taxId]] });
const clientBlock = (c: any): Block => ({ title: 'Client Details', rows: [['Name', c?.name], ['Email', c?.contacts?.[0]?.email], ['Phone', c?.contacts?.[0]?.phone]] });

export interface Mail { subject: string; html: string }

/** Internal: a new invoice needs attention. Client: the invoice itself (PDF attached). */
export function invoiceCreatedMail(inv: any, client: any, o: { audience: 'internal' | 'client'; byName?: string; message?: string }): Mail {
  if (o.audience === 'client') return {
    subject: `Invoice ${inv.invoiceNo} from ${company.name}`,
    html: layout({ heading: 'Your Invoice', greeting: `Dear ${client?.name || 'Customer'},`, paragraphs: [`Please find attached invoice <strong>${esc(inv.invoiceNo)}</strong> from ${esc(company.name)}.`, ...(o.message ? [esc(o.message)] : [])], blocks: [{ title: 'Invoice Details', rows: invoiceRows(inv) }, taxBlock()], note: `Please quote <strong>${esc(inv.invoiceNo)}</strong> as your payment reference. Kindly remit VAT to the VAT number above.`, signoff: `${company.name} Team` }),
  };
  return {
    subject: `Invoice Created: ${inv.invoiceNo}`,
    html: layout({ heading: 'Invoice Created', greeting: 'Hello,', paragraphs: [`A new invoice has been created${o.byName ? ` by <strong>${esc(o.byName)}</strong>` : ''} and is awaiting review.`], blocks: [{ title: 'Invoice Details', rows: invoiceRows(inv) }, taxBlock(), clientBlock(client)], cta: { label: 'Update Invoice', path: `/invoices?invoice=${inv._id}` } }),
  };
}

export function invoiceUpdatedMail(inv: any, client: any, byName?: string): Mail {
  return { subject: `Invoice Updated: ${inv.invoiceNo}`, html: layout({ heading: 'Invoice Updated', greeting: 'Hello,', paragraphs: [`Invoice <strong>${esc(inv.invoiceNo)}</strong> was updated${byName ? ` by <strong>${esc(byName)}</strong>` : ''}.`], blocks: [{ title: 'Invoice Details', rows: invoiceRows(inv) }, taxBlock(), clientBlock(client)], cta: { label: 'Update Invoice', path: `/invoices?invoice=${inv._id}` } }) };
}

export function invoiceStatusMail(inv: any, status: 'approved' | 'rejected', o: { byName?: string; reason?: string } = {}): Mail {
  const rejected = status === 'rejected';
  return {
    subject: `Invoice ${rejected ? 'Rejected' : 'Approved'}: ${inv.invoiceNo}`,
    html: layout({ heading: rejected ? 'Invoice Status Update — Rejected' : 'Invoice Status Update — Approved', greeting: 'Hello,', paragraphs: [`Invoice <strong>${esc(inv.invoiceNo)}</strong> has been <strong>${rejected ? 'rejected' : 'approved'}</strong>${o.byName ? ` by ${esc(o.byName)}` : ''}.`, ...(rejected ? [] : ['You can now send it to the client from the invoice page.'])],
      blocks: [...(rejected ? [{ title: 'Reason for rejection', rows: [['Reason', o.reason || '—']] as Array<[string, unknown]> }] : []), { title: 'Invoice Details', rows: invoiceRows(inv) }], cta: { label: rejected ? 'Update Invoice' : 'Open Invoice', path: `/invoices?invoice=${inv._id}` } }),
  };
}

export function paymentAckMail(inv: any, client: any, p: { amount: number; whtDeducted?: number; paidOn: Date; reference?: string }): Mail {
  return {
    subject: `Payment Acknowledgment: ${inv.invoiceNo}`,
    html: layout({ heading: 'Payment Acknowledgment', greeting: `Dear ${client?.name || 'Customer'},`, paragraphs: [`We acknowledge with thanks your payment against invoice <strong>${esc(inv.invoiceNo)}</strong>.`],
      blocks: [{ title: 'Payment Details', rows: [['Invoice No', inv.invoiceNo], ['Amount received', money(p.amount, inv.currency)], ['WHT deducted', p.whtDeducted ? money(p.whtDeducted, inv.currency) : ''], ['Payment date', fmtDate(p.paidOn)], ['Reference', p.reference], ['Outstanding balance', money(inv.balance, inv.currency)], ['Status', inv.status === 'paid' ? 'Paid in full' : 'Partially paid']] }],
      note: p.whtDeducted ? 'Please send us the WHT credit note for the amount deducted.' : undefined, signoff: `${company.name} Team` }),
  };
}

export function invoiceChaseMail(inv: any, client: any, overdueDays: number): Mail {
  const late = overdueDays > 0;
  return {
    subject: `${late ? 'Overdue' : 'Reminder'}: Invoice ${inv.invoiceNo}`,
    html: layout({ heading: late ? 'Payment Overdue' : 'Payment Reminder', greeting: `Dear ${client?.name || 'Customer'},`, paragraphs: [late ? `Invoice <strong>${esc(inv.invoiceNo)}</strong> was due on ${esc(fmtDate(inv.dueDate))} and is now <strong>${overdueDays} day(s)</strong> overdue.` : `This is a friendly reminder that invoice <strong>${esc(inv.invoiceNo)}</strong> falls due on ${esc(fmtDate(inv.dueDate))}.`, 'A copy is attached for your convenience. If you have already paid, please disregard this message and send us the remittance advice.'], blocks: [{ title: 'Invoice Details', rows: invoiceRows(inv) }, taxBlock()], signoff: `${company.name} Team` }),
  };
}

export function clientCreatedMail(client: any, byName?: string): Mail {
  return { subject: `New client added: ${client.name}`, html: layout({ heading: 'Client Created', greeting: 'Hello,', paragraphs: [`A new client was added${byName ? ` by <strong>${esc(byName)}</strong>` : ''}.`], blocks: [{ title: 'Client Details', rows: [['Name', client.name], ['Email', (client.contacts || []).map((c: any) => c.email).filter(Boolean).join(', ')], ['Phone', (client.contacts || []).map((c: any) => c.phone).filter(Boolean).join(', ')], ['Address', client.address]] }], cta: { label: 'Open Clients', path: '/clients' }, signoff: `${company.name} Team` }) };
}

export function employeeWelcomeMail(o: { name: string; email: string; role: string; tempPassword?: string }): Mail {
  return { subject: `Welcome to ${company.name}`, html: layout({ heading: `Welcome to ${company.name}`, greeting: `Hello ${o.name},`, paragraphs: ['Your employee profile has been created.', ...(o.tempPassword ? ['Your sign-in details are below. You will be asked to choose a new password the first time you sign in.'] : [])], blocks: [{ title: 'Your Details', rows: [['Email', o.email], ['Role', o.role], ['Temporary password', o.tempPassword]] }], cta: o.tempPassword ? { label: 'Sign in', path: '/login' } : undefined, signoff: `${company.name} Team` }) };
}
