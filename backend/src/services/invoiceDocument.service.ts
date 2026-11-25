import fs from 'fs';
import PDFDocument from 'pdfkit';
import { company } from '../config/company';
import { amountInWords } from '../utils/words';
import { LOGO_PATH, esc } from './mail.templates';

/* ------------------------------- view model -------------------------------- */
const SYMBOL: Record<string, string> = { USD: '$', NGN: '₦', GBP: '£', EUR: '€' };
export const sym = (c: string) => SYMBOL[c] || c;
const dp = (cur: string) => (cur === 'NGN' ? 2 : 3);
export const fmtN = (n: number, cur: string) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: dp(cur), maximumFractionDigits: dp(cur) });
const fmtDay = (x?: Date | string | null) => (x ? new Date(x).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—');
const fmtLong = (x?: Date | string | null) => (x ? new Date(x).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

const TITLES: Record<string, string> = {
  'Managed Services': 'MANAGED SERVICES INVOICE', Outsourcing: 'OUTSOURCING SERVICES INVOICE', Consultation: 'CONSULTATION SERVICES INVOICE',
  Training: 'TRAINING INVOICE', Licence: 'LICENCE FEE INVOICE', Rental: 'RENTAL INVOICE', Other: 'INVOICE',
};

export interface DocModel {
  title: string; invoiceNo: string; reference?: string; po?: string; issue: string; due: string; currency: string; showNaira: boolean; rate: number;
  client: { name: string; phone?: string; email?: string; address?: string };
  groups: Array<{ label: string; letter: string; rows: Array<{ description: string; qty: number; unit: number; total: number; totalNgn: number }>; sub: number; subNgn: number }>;
  multi: boolean; subtotal: number; vatRate: number; vat: number; grand: number; grandNgn: number; whtRate: number; wht: number; inWords: string;
  split: Array<{ label: string; amount: number; words: string; kind: string; wire: Array<{ label: string; value: string }> }>;
  instructions: string[]; bank: { name: string; number: string; bank: string; sort?: string; swift?: string }; status: string; notes?: string; period?: string;
}

export function buildDoc(inv: any, client: any, bank: any, accountNumber: string): DocModel {
  const cur = inv.currency || 'NGN';
  const rate = cur === 'NGN' ? 1 : inv.exchangeRate || 1;
  const order: string[] = [];
  const map = new Map<string, any[]>();
  for (const it of inv.items || []) { const g = (it.group || '').trim(); if (!map.has(g)) { map.set(g, []); order.push(g); } map.get(g)!.push(it); }
  if (!order.length) order.push('');
  const multi = order.length > 1;
  const period = inv.periodStart && inv.periodEnd ? `${fmtLong(inv.periodStart)} – ${fmtLong(inv.periodEnd)}` : inv.periodLabel || '';
  const groups = order.map((g, i) => {
    const rows = (map.get(g) || []).map((it: any) => ({ description: it.description, qty: it.quantity, unit: it.unitFee, total: it.amount, totalNgn: Math.round(it.amount * rate * 100) / 100 }));
    const sub = rows.reduce((s, r) => s + r.total, 0);
    return { label: g || (period ? `Services for period: ${period}` : 'Services'), letter: String.fromCharCode(65 + i), rows, sub, subNgn: Math.round(sub * rate * 100) / 100 };
  });
  const primary = client?.contacts?.find((c: any) => c.isPrimary) || client?.contacts?.[0];
  const split = (inv.splitAmounts || []).filter((s: any) => s.amount > 0).map((s: any) => ({ label: s.label, amount: s.amount, words: s.inWords || amountInWords(s.amount, cur), kind: s.kind || 'local', wire: s.wire || [] }));
  const instructions: string[] = [...(inv.instructions || [])];
  return {
    title: inv.documentTitle || TITLES[inv.invoiceType] || 'INVOICE', invoiceNo: inv.invoiceNo, reference: inv.referenceNo, po: inv.poNumber,
    issue: fmtDay(inv.issueDate), due: fmtDay(inv.dueDate), currency: cur, showNaira: cur !== 'NGN' && !!inv.includeNaira, rate,
    client: { name: client?.name || '—', phone: primary?.phone, email: primary?.email, address: client?.address },
    groups, multi, subtotal: inv.subtotal, vatRate: inv.vatRate, vat: inv.vatAmount, grand: inv.total, grandNgn: inv.totalNgn, whtRate: inv.whtRate, wht: inv.whtAmount,
    inWords: amountInWords(inv.total, cur), split, instructions,
    bank: { name: bank?.accountName || '—', number: accountNumber || '—', bank: bank?.bankName || '—', sort: bank?.sortCode, swift: bank?.swiftCode },
    status: inv.status, notes: inv.notes, period,
  };
}

/** Numbered payment instructions shown on page 2 (split invoices spell out each party). */
function instructionItems(m: DocModel) {
  const out: Array<{ text: string; wire?: Array<{ label: string; value: string }> }> = [];
  for (const s of m.split) {
    if (s.kind === 'wire') out.push({ text: `Kindly transfer the sum of <b>${esc(s.words)} (${esc(sym(m.currency))}${fmtN(s.amount, m.currency)})</b> to ${esc(s.label)} as detailed below:`, wire: s.wire });
    else out.push({ text: `Transfer the NGN equivalent of <b>${esc(s.words)} (${esc(sym(m.currency))}${fmtN(s.amount, m.currency)})</b> to the NGN account of ${esc(s.label)} (account details below).` });
  }
  if (!m.split.length) out.push({ text: `Kindly make payment of <b>${esc(m.inWords)}</b> to the account detailed below.` });
  out.push({ text: `Kindly send the transfer receipt to <b>${esc(company.receiptEmail)}</b> and quote invoice <b>${esc(m.invoiceNo)}</b> as the payment reference.` });
  if (m.whtRate > 0) out.push({ text: `Please ensure the NGN equivalent of the <b>WHT (${m.whtRate}%)</b> is credited to ${esc(company.name)}’s NGN account.` });
  for (const x of m.instructions) out.push({ text: esc(x) });
  return out;
}

/* ----------------------------------- HTML ---------------------------------- */
let logoUri: string | null = null;
function logoDataUri() {
  if (logoUri !== null) return logoUri;
  try { logoUri = `data:image/jpeg;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`; } catch { logoUri = ''; }
  return logoUri;
}

const CSS = `*{margin:0;padding:0;box-sizing:border-box;font-family:"Montserrat","Helvetica Neue",Arial,sans-serif}body{background:#fff;color:#222}
.page{width:100%;max-width:900px;margin:0 auto;padding:28px 36px;background:#fff;page-break-after:always}.page:last-child{page-break-after:auto}
.header-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;gap:18px}.logo-block{display:flex;flex-direction:column;align-items:flex-start}.logo-block img{width:84px;height:62px;object-fit:contain}.logo-block .rc{font-size:10px;font-weight:700;letter-spacing:1px;margin-top:2px}
.header-content-container{display:flex;gap:34px;text-align:right}.header-content h1{font-size:10px;color:#6635AB;font-weight:700;text-transform:uppercase;letter-spacing:.5px}.header-content h2{font-size:13px;font-weight:700;font-style:italic;color:#6635AB;margin:2px 0 4px}.header-content p,.header-content span{font-size:10px;line-height:1.5;color:#333}
.invoice-title{background:rgb(187,187,187);color:#fff;text-align:center;padding:9px 16px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25);border-radius:4px;margin-bottom:14px}
.date-row{display:flex;justify-content:space-between;margin-bottom:14px}.date-row p{font-size:11px;margin-bottom:3px}
.section-header{background:#f1f1f1;padding:7px 10px;font-size:10px;font-weight:700;border-radius:6px 6px 0 0;text-transform:uppercase;margin-top:12px}
table{width:100%;border-collapse:collapse;font-size:10px}thead th{background:#fff;padding:7px 10px;font-weight:700;border-bottom:1px solid #EFF0F4;border-right:1px solid #EFF0F4;text-align:left}thead th:not(:first-child){text-align:right}
tbody td{padding:7px 10px;border-right:1px solid #EFF0F4;border-bottom:1px solid #EFF0F4;text-align:right}tbody td:first-child{text-align:left;width:42%}
tfoot td{background:rgb(187,187,187);color:#fff;padding:6px 10px;font-weight:700;font-style:italic;text-align:right}tfoot td:first-child{text-align:left}
.totals-table{margin-top:6px}.totals-table td{padding:6px 10px;border-bottom:1px solid #EFF0F4;border-right:1px solid #EFF0F4;text-align:right;font-weight:700}.totals-table td:first-child{text-align:left;width:80%}.totals-table tr.grand td{font-size:11px;font-weight:800}
.amount-words{margin-top:8px;padding:7px 10px;font-size:10px;border-bottom:1px solid #ddd}.amount-words span{font-style:italic}
.breakdown{width:100%;border-collapse:collapse;font-size:11px;border:1px solid #aaa;margin-bottom:16px}.breakdown .bk-title{background:#f1f1f1;text-align:center;font-weight:700;font-size:12px;padding:9px;letter-spacing:1px}
.breakdown th{padding:7px 12px;border-bottom:1px solid #aaa;border-right:1px solid #aaa;font-weight:700;text-align:left}.breakdown td{padding:7px 12px;border-bottom:1px solid #aaa;border-right:1px solid #aaa;font-size:10px;text-align:left}.breakdown td.fee{text-align:right;font-weight:700}.breakdown td.rcp{font-style:italic;text-align:center}
.breakdown .ins-title{text-align:center;font-weight:700;font-size:11px;padding:7px;background:#f9f9f9;letter-spacing:.5px}.breakdown .ins{padding:12px 14px;font-size:10px;line-height:1.8}.breakdown .ins ol{padding-left:16px}.breakdown .ins li{font-style:italic;margin-bottom:6px}.breakdown .ins li b{font-style:normal}
.wire-box{border:1px solid #aaa;margin:8px 0 4px 0;display:block;width:70%}.wire-title{text-align:center;font-weight:700;font-size:10px;padding:5px;border-bottom:1px solid #aaa;letter-spacing:.5px}.wire-box table td{padding:5px 10px;border:none;font-size:9px;vertical-align:top;text-align:left}.wire-box table td:first-child{font-weight:600;width:45%}
.details-row{display:flex;gap:24px;margin-top:16px}.details-col{flex:1}.details-col h2{font-size:11px;font-weight:700;text-decoration:underline;margin-bottom:8px;text-transform:uppercase}.details-col p{font-size:10px;margin-bottom:4px}.details-footer{font-size:9px;font-style:italic;font-weight:700;margin-top:6px}
.page-footer{margin-top:28px;border-top:2px solid #6635AB;padding-top:6px}.page-footer p{font-size:9px;font-style:italic;color:#6635AB;font-weight:600}
.void{position:fixed;top:40%;left:12%;font-size:120px;font-weight:800;color:rgba(200,0,0,.12);transform:rotate(-20deg);pointer-events:none}
@media print{.page{page-break-after:always}.page:last-child{page-break-after:auto}}`;

export function invoiceHtml(m: DocModel, opts: { fullDocument?: boolean } = {}): string {
  const cur = m.currency, s = sym(cur);
  const naira = m.showNaira;
  const th = (a: string) => `<th>${a}</th>`;
  const sections = m.groups.map((g) => `
<div class="section-header">${m.multi ? `${g.letter} - ` : ''}${esc(g.label)}</div>
<table><thead><tr>${th('Description')}${th('Volume')}${th(`Unit Fee (${esc(s)})`)}${th(`Total Fee (${esc(s)})`)}${naira ? th('Total Fee (₦)') : ''}</tr></thead>
<tbody>${g.rows.map((r) => `<tr><td>${esc(r.description)}</td><td>${Number(r.qty).toLocaleString()}</td><td>${fmtN(r.unit, cur)}</td><td>${fmtN(r.total, cur)}</td>${naira ? `<td>${fmtN(r.totalNgn, 'NGN')}</td>` : ''}</tr>`).join('')}</tbody>
<tfoot><tr><td colspan="3">Sub-Total${m.multi ? ` – ${g.letter}` : ''}</td><td>${fmtN(g.sub, cur)}</td>${naira ? `<td>${fmtN(g.subNgn, 'NGN')}</td>` : ''}</tr></tfoot></table>`).join('');
  const letters = m.groups.map((g) => g.letter).join('+');
  const ins = instructionItems(m);
  const page1 = `<div class="page">
<div class="header-row"><div class="logo-block">${logoDataUri() ? `<img src="${logoDataUri()}" alt="">` : ''}<span class="rc">RC: ${esc(company.rc)}</span></div>
<div class="header-content-container">
<div class="header-content"><h1>Bill From:</h1><h2>${esc(company.name)}</h2><p>${esc(company.address)}</p><p>Email: ${esc(company.email)}</p><p>Website: ${esc(company.website)}</p></div>
<div class="header-content"><h1>Bill To:</h1><h2>${esc(m.client.name)}</h2>${m.client.address ? `<p>${esc(m.client.address)}</p>` : ''}${m.client.phone ? `<p>Phone: ${esc(m.client.phone)}</p>` : ''}${m.client.email ? `<p>Email: ${esc(m.client.email)}</p>` : ''}</div></div></div>
<div class="invoice-title">${esc(m.title)}</div>
<div class="date-row"><div><p><strong>Issue Date:</strong> ${esc(m.issue)}</p><p><strong>Invoice Ref:</strong> ${esc(m.invoiceNo)}</p>${m.reference ? `<p><strong>Reference:</strong> ${esc(m.reference)}</p>` : ''}</div><div><p><strong>Due Date:</strong> ${esc(m.due)}</p>${m.po ? `<p><strong>PO Number:</strong> ${esc(m.po)}</p>` : ''}</div></div>
${sections}
<table class="totals-table"><tbody>
<tr><td>TOTAL FEE${m.multi ? ` (${letters})` : ''}</td><td>${fmtN(m.subtotal, cur)}</td></tr>
${m.vatRate > 0 ? `<tr><td>VAT (${m.vatRate}%)</td><td>${fmtN(m.vat, cur)}</td></tr>` : ''}
<tr class="grand"><td>GRAND TOTAL in ${esc(cur)}</td><td>${fmtN(m.grand, cur)}</td></tr>
${naira ? `<tr><td>NGN equivalent @ ₦${m.rate.toLocaleString('en-US')}/${esc(cur)}</td><td>${fmtN(m.grandNgn, 'NGN')}</td></tr>` : ''}</tbody></table>
<div class="amount-words"><strong>AMOUNT IN WORDS: </strong><span>${esc(m.inWords)}</span></div>
${m.notes ? `<div class="amount-words"><strong>NOTES: </strong><span>${esc(m.notes)}</span></div>` : ''}
<div class="page-footer"><p>Directors: ${esc(company.directors)}</p></div></div>`;
  const page2 = `<div class="page"><div class="invoice-title">PAYMENT INSTRUCTION</div>
<table class="breakdown"><thead><tr><td colspan="3" class="bk-title">BREAKDOWN</td></tr><tr><th style="width:58%">Description</th><th style="width:20%;text-align:center">Recipient</th><th style="width:22%;text-align:right">Fee (${esc(cur)})</th></tr></thead><tbody>
<tr><td style="font-weight:700;text-transform:uppercase">${esc(m.title.replace(/ INVOICE$/, ''))}${m.period ? ` — ${esc(m.period)}` : ''}</td><td></td><td class="fee">${fmtN(m.grand, cur)}</td></tr>
${m.split.map((x) => `<tr><td>Amount due ${esc(x.label)}</td><td class="rcp">${esc(x.label)}</td><td class="fee">${fmtN(x.amount, cur)}</td></tr>`).join('')}
<tr><td colspan="3" class="ins-title">INSTRUCTION</td></tr>
<tr><td colspan="3" class="ins"><ol>${ins.map((i) => `<li>${i.text}${i.wire?.length ? `<div class="wire-box"><div class="wire-title">INTERNATIONAL WIRE TRANSFER</div><table>${i.wire.map((w) => `<tr><td>${esc(w.label)}</td><td>${esc(w.value)}</td></tr>`).join('')}</table></div>` : ''}</li>`).join('')}</ol></td></tr></tbody></table>
<div class="details-row"><div class="details-col"><h2>Account Details</h2><p><strong>Name:</strong> ${esc(m.bank.name)}</p><p><strong>Number:</strong> ${esc(m.bank.number)}</p><p><strong>Bank:</strong> ${esc(m.bank.bank)}</p>${m.bank.sort ? `<p><strong>Sort code:</strong> ${esc(m.bank.sort)}</p>` : ''}${m.bank.swift ? `<p><strong>SWIFT:</strong> ${esc(m.bank.swift)}</p>` : ''}</div>
<div class="details-col"><h2>Tax Details</h2><p><strong>Name:</strong> ${esc(company.name)}</p><p><strong>VAT Number:</strong> ${esc(company.vatNumber)}</p><p><strong>NRC TAX ID:</strong> ${esc(company.taxId)}</p><p class="details-footer">(Kindly remit VAT to the above number)</p></div></div>
<div class="page-footer"><p>Directors: ${esc(company.directors)}</p></div></div>`;
  const body = `${m.status === 'void' ? '<div class="void">VOID</div>' : ''}${page1}${page2}`;
  if (!opts.fullDocument) return `<style>${CSS}</style>${body}`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${esc(m.invoiceNo)}</title><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet"><style>${CSS}</style></head><body>${body}</body></html>`;
}

/* ------------------------------------ PDF ---------------------------------- */
const PURPLE = '#6635AB', GREY = '#bbbbbb', LIGHT = '#f1f1f1', LINE = '#EFF0F4';
const plain = (h: string) => h.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function invoicePdfStyled(m: DocModel): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 36, left: 36, right: 36, bottom: 0 }, info: { Title: `Invoice ${m.invoiceNo}`, Author: company.name } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((res, rej) => { doc.on('data', (c) => chunks.push(c)); doc.on('end', () => res(Buffer.concat(chunks))); doc.on('error', rej); });
  const W = 523, X = 36, cur = m.currency, s = sym(cur) === '₦' ? 'NGN ' : sym(cur) === '$' ? '$' : sym(cur) === '£' ? 'GBP ' : sym(cur) === '€' ? 'EUR ' : `${cur} `;
  let y = 36;
  const footer = () => { doc.moveTo(X, 800).lineTo(X + W, 800).lineWidth(1.5).strokeColor(PURPLE).stroke(); doc.fillColor(PURPLE).font('Helvetica-Oblique').fontSize(7.5).text(`Directors: ${company.directors}`, X, 805, { width: W }); };
  const ensure = (h: number) => { if (y + h > 780) { footer(); doc.addPage(); y = 36; } };
  const banner = (t: string) => { doc.roundedRect(X, y, W, 26, 4).fill(GREY); doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11).text(t, X, y + 8, { width: W, align: 'center', characterSpacing: 1 }); y += 38; };

  try { doc.image(LOGO_PATH, X, y, { fit: [84, 62] }); } catch { /* logo optional */ }
  doc.fillColor('#222').font('Helvetica-Bold').fontSize(8).text(`RC: ${company.rc}`, X, y + 64);
  const col = (x: number, head: string, name: string, lines: string[]) => { doc.fillColor(PURPLE).font('Helvetica-Bold').fontSize(8).text(head.toUpperCase(), x, y, { width: 200, align: 'right' }); doc.font('Helvetica-BoldOblique').fontSize(11).text(name, x, y + 11, { width: 200, align: 'right' }); doc.fillColor('#333').font('Helvetica').fontSize(8).text(lines.filter(Boolean).join('\n'), x, y + 26, { width: 200, align: 'right' }); };
  col(X + 140, 'Bill from:', company.name, [company.address, `Email: ${company.email}`, `Website: ${company.website}`]);
  col(X + 340, 'Bill to:', m.client.name, [m.client.address || '', m.client.phone ? `Phone: ${m.client.phone}` : '', m.client.email ? `Email: ${m.client.email}` : '']);
  y += 92;
  banner(m.title);
  const kv = (k: string, v: string, x: number, yy: number, w: number, align: 'left' | 'right') => { doc.fillColor('#222').font('Helvetica-Bold').fontSize(9); const kw = doc.widthOfString(`${k} `); const vw = doc.font('Helvetica').widthOfString(v); const sx = align === 'right' ? x + w - kw - vw : x; doc.font('Helvetica-Bold').text(`${k} `, sx, yy, { lineBreak: false }); doc.font('Helvetica').text(v, sx + kw, yy, { lineBreak: false }); };
  kv('Issue Date:', m.issue, X, y, 250, 'left'); kv('Invoice Ref:', m.invoiceNo, X, y + 13, 250, 'left');
  kv('Due Date:', m.due, X + 273, y, 250, 'right'); if (m.po) kv('PO Number:', m.po, X + 273, y + 13, 250, 'right');
  y += 36;

  const nr = m.showNaira;
  const cw = nr ? [190, 55, 90, 90, 98] : [248, 60, 105, 110];
  const cell = (txt: string, x: number, w: number, align: 'left' | 'right', yy: number) => doc.text(txt, x + 5, yy, { width: w - 10, align });
  for (const g of m.groups) {
    ensure(70);
    doc.roundedRect(X, y, W, 20, 4).fill(LIGHT); doc.fillColor('#222').font('Helvetica-Bold').fontSize(8).text(`${m.multi ? `${g.letter} - ` : ''}${g.label}`.toUpperCase(), X + 8, y + 6, { width: W - 16 }); y += 22;
    const heads = ['Description', 'Volume', `Unit Fee (${plain(sym(cur))})`, `Total Fee (${plain(sym(cur))})`, ...(nr ? ['Total Fee (NGN)'] : [])];
    let x = X; doc.font('Helvetica-Bold').fontSize(8).fillColor('#222');
    heads.forEach((h, i) => { cell(h, x, cw[i], i ? 'right' : 'left', y + 4); x += cw[i]; }); y += 18; doc.moveTo(X, y).lineTo(X + W, y).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(8);
    for (const r of g.rows) {
      const h = Math.max(doc.heightOfString(r.description, { width: cw[0] - 10 }), 10) + 10;
      ensure(h + 24);
      const vals = [r.description, Number(r.qty).toLocaleString(), fmtN(r.unit, cur), fmtN(r.total, cur), ...(nr ? [fmtN(r.totalNgn, 'NGN')] : [])];
      x = X; vals.forEach((v, i) => { cell(v, x, cw[i], i ? 'right' : 'left', y + 5); x += cw[i]; }); y += h;
      doc.moveTo(X, y).lineTo(X + W, y).lineWidth(0.4).strokeColor(LINE).stroke();
    }
    doc.rect(X, y, W, 18).fill(GREY); doc.fillColor('#fff').font('Helvetica-BoldOblique').fontSize(8);
    cell(`Sub-Total${m.multi ? ` – ${g.letter}` : ''}`, X, cw[0] + cw[1] + cw[2], 'left', y + 5);
    cell(fmtN(g.sub, cur), X + cw[0] + cw[1] + cw[2], cw[3], 'right', y + 5);
    if (nr) cell(fmtN(g.subNgn, 'NGN'), X + cw[0] + cw[1] + cw[2] + cw[3], cw[4], 'right', y + 5);
    y += 24;
  }
  ensure(120);
  const tot: Array<[string, string, boolean?]> = [[`TOTAL FEE${m.multi ? ` (${m.groups.map((g) => g.letter).join('+')})` : ''}`, fmtN(m.subtotal, cur)]];
  if (m.vatRate > 0) tot.push([`VAT (${m.vatRate}%)`, fmtN(m.vat, cur)]);
  tot.push([`GRAND TOTAL in ${cur}`, fmtN(m.grand, cur), true]);
  if (nr) tot.push([`NGN equivalent @ N${m.rate.toLocaleString('en-US')}/${cur}`, fmtN(m.grandNgn, 'NGN')]);
  for (const [k, v, b] of tot) { doc.fillColor('#222').font('Helvetica-Bold').fontSize(b ? 10 : 8.5).text(k, X + 5, y + 4, { width: 380 }).text(v, X + 380, y + 4, { width: W - 385, align: 'right' }); y += 18; doc.moveTo(X, y).lineTo(X + W, y).lineWidth(0.4).strokeColor(LINE).stroke(); }
  y += 8; doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#222').text('AMOUNT IN WORDS: ', X + 5, y, { continued: true }).font('Helvetica-Oblique').text(m.inWords, { width: W - 10 }); y = doc.y + 8;
  if (m.notes) { doc.font('Helvetica-Bold').text('NOTES: ', X + 5, y, { continued: true }).font('Helvetica-Oblique').text(m.notes, { width: W - 10 }); y = doc.y + 8; }
  if (m.status === 'void') { doc.save().rotate(-25, { origin: [300, 400] }).fillColor('#c00000').opacity(0.12).font('Helvetica-Bold').fontSize(120).text('VOID', 110, 330).restore(); doc.opacity(1); }
  footer();

  /* page 2 */
  doc.addPage(); y = 36; banner('PAYMENT INSTRUCTION');
  doc.rect(X, y, W, 22).fill(LIGHT); doc.fillColor('#222').font('Helvetica-Bold').fontSize(10).text('BREAKDOWN', X, y + 6, { width: W, align: 'center' }); y += 22;
  const row = (a: string, b: string, c: string, bold = false) => { const h = Math.max(doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).heightOfString(a, { width: 290 }), 10) + 12; doc.rect(X, y, W, h).lineWidth(0.5).strokeColor('#aaa').stroke(); doc.fillColor('#222').text(a, X + 8, y + 6, { width: 290 }).font('Helvetica-Oblique').text(b, X + 305, y + 6, { width: 100, align: 'center' }).font('Helvetica-Bold').text(c, X + 410, y + 6, { width: 105, align: 'right' }); y += h; };
  row(`${m.title.replace(/ INVOICE$/, '')}${m.period ? ` — ${m.period}` : ''}`.toUpperCase(), '', fmtN(m.grand, cur), true);
  m.split.forEach((x) => row(`Amount due ${x.label}`, x.label, fmtN(x.amount, cur)));
  doc.rect(X, y, W, 20).fill('#f9f9f9'); doc.fillColor('#222').font('Helvetica-Bold').fontSize(9).text('INSTRUCTION', X, y + 6, { width: W, align: 'center' }); y += 24;
  instructionItems(m).forEach((it, i) => {
    ensure(40);
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#222').text(`${i + 1}.  ${plain(it.text)}`, X + 12, y, { width: W - 24 }); y = doc.y + 4;
    if (it.wire?.length) { const h = 18 + it.wire.length * 13; doc.rect(X + 28, y, 330, h).lineWidth(0.5).strokeColor('#aaa').stroke(); doc.font('Helvetica-Bold').fontSize(8).text('INTERNATIONAL WIRE TRANSFER', X + 28, y + 5, { width: 330, align: 'center' }); it.wire.forEach((w, j) => { doc.font('Helvetica-Bold').text(w.label, X + 38, y + 20 + j * 13, { width: 140 }).font('Helvetica').text(w.value, X + 185, y + 20 + j * 13, { width: 165 }); }); y += h + 8; }
    y += 2;
  });
  y += 12; ensure(110);
  doc.fillColor('#222').font('Helvetica-Bold').fontSize(9).text('ACCOUNT DETAILS', X, y, { underline: true }).text('TAX DETAILS', X + 270, y, { underline: true }); y += 16;
  doc.font('Helvetica').fontSize(8.5);
  const left = [['Name', m.bank.name], ['Number', m.bank.number], ['Bank', m.bank.bank], ...(m.bank.sort ? [['Sort code', m.bank.sort]] : []), ...(m.bank.swift ? [['SWIFT', m.bank.swift]] : [])];
  const right = [['Name', company.name], ['VAT Number', company.vatNumber], ['NRC TAX ID', company.taxId]];
  left.forEach(([k, v], i) => doc.font('Helvetica-Bold').text(`${k}: `, X, y + i * 13, { continued: true }).font('Helvetica').text(v as string));
  right.forEach(([k, v], i) => doc.font('Helvetica-Bold').text(`${k}: `, X + 270, y + i * 13, { continued: true }).font('Helvetica').text(v as string));
  doc.font('Helvetica-BoldOblique').fontSize(7.5).text('(Kindly remit VAT to the above number)', X + 270, y + right.length * 13 + 2);
  footer();
  doc.end();
  return done;
}
