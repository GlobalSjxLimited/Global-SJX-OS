import PDFDocument from 'pdfkit';
import { LOGO_PATH } from './mail.templates';
import { round2 } from '../models/Finance';
import { buildDoc, invoicePdfStyled } from './invoiceDocument.service';

const MAGENTA = '#C22FD4';
const INK = '#1c1727';
const MUTED = '#6b6478';

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export const fmtMoney = (n: number | undefined, cur = 'NGN') => `${cur} ${(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const d = (x?: Date | string | null) => (x ? new Date(x).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function header(doc: PDFKit.PDFDocument, title: string, right?: string) {
  try { doc.image(LOGO_PATH, 40, 34, { height: 54 }); } catch { /* logo optional */ }
  doc.fillColor(MAGENTA).font('Helvetica-Bold').fontSize(9).text('GLOBAL SJX LIMITED', 110, 42);
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('Security · ISMS · Data Protection · Lagos, Nigeria', 110, 55);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(title, 40, 40, { align: 'right', width: 515 });
  if (right) doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(right, 40, 64, { align: 'right', width: 515 });
  doc.moveTo(40, 98).lineTo(555, 98).lineWidth(1.5).strokeColor(MAGENTA).stroke();
  doc.y = 112;
}

/* ---------------------------------- Invoice -------------------------------- */
/** Invoices are rendered in the Global SJX document design (see invoiceDocument.service). */
export async function invoicePdf(inv: any, client: any, bank: any, accountNumber: string): Promise<Buffer> {
  return invoicePdfStyled(buildDoc(inv, client, bank, accountNumber));
}

/** The simple layout this replaced — kept for credit notes / fallback. */
export async function invoicePdfBasic(inv: any, client: any, bank: any, accountNumber: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Invoice ${inv.invoiceNo}`, Author: 'Global SJX Limited' } });
  header(doc, inv.status === 'void' ? 'INVOICE — VOID' : 'INVOICE', inv.invoiceNo);
  let y = doc.y;
  doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('BILL TO', 40, y);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(client?.name || '—', 40, y + 12);
  const contact = client?.contacts?.[0];
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text([contact?.name, contact?.email, client?.country].filter(Boolean).join('\n'), 40, y + 28);
  const meta: Array<[string, string]> = [['Issue date', d(inv.issueDate)], ['Due date', d(inv.dueDate)], ['Currency', inv.currency], ['Type', inv.invoiceType]];
  if (inv.poNumber) meta.push(['PO number', inv.poNumber]);
  if (inv.periodLabel) meta.push(['Period', inv.periodLabel]);
  meta.forEach(([k, v], i) => {
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(k, 350, y + i * 14, { width: 90 });
    doc.fillColor(INK).font('Helvetica-Bold').text(v, 440, y + i * 14, { width: 115, align: 'right' });
  });
  y = Math.max(y + 100, y + meta.length * 14 + 14);

  // items table
  doc.rect(40, y, 515, 22).fill(INK);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
  doc.text('Description', 48, y + 7, { width: 270 }).text('Qty', 320, y + 7, { width: 40, align: 'right' }).text('Unit fee', 365, y + 7, { width: 80, align: 'right' }).text('Amount', 450, y + 7, { width: 98, align: 'right' });
  y += 26;
  doc.font('Helvetica').fillColor(INK);
  for (const it of inv.items) {
    const h = Math.max(doc.heightOfString(it.description, { width: 270 }), 12) + 8;
    if (y + h > 740) { doc.addPage(); y = 50; }
    doc.fontSize(9).text(it.description, 48, y, { width: 270 }).text(String(it.quantity), 320, y, { width: 40, align: 'right' }).text(fmtMoney(it.unitFee, ''), 365, y, { width: 80, align: 'right' }).text(fmtMoney(it.amount, ''), 450, y, { width: 98, align: 'right' });
    y += h;
    doc.moveTo(40, y - 3).lineTo(555, y - 3).lineWidth(0.4).strokeColor('#ddd').stroke();
  }
  y += 6;
  const totals: Array<[string, string, boolean?]> = [['Subtotal', fmtMoney(inv.subtotal, inv.currency)], [`VAT (${inv.vatRate}%)`, fmtMoney(inv.vatAmount, inv.currency)], ['Total', fmtMoney(inv.total, inv.currency), true]];
  if (inv.whtRate) totals.push([`WHT expected (${inv.whtRate}%)`, fmtMoney(inv.whtAmount, inv.currency)]);
  if (inv.amountPaid) totals.push(['Paid', fmtMoney(inv.amountPaid, inv.currency)]);
  if (inv.whtCredited) totals.push(['WHT deducted by client', fmtMoney(inv.whtCredited, inv.currency)]);
  totals.push(['Balance due', fmtMoney(inv.balance, inv.currency), true]);
  for (const [k, v, bold] of totals) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(bold ? MAGENTA : INK).text(k, 320, y, { width: 120 }).text(v, 440, y, { width: 115, align: 'right' });
    y += bold ? 18 : 14;
  }
  if (inv.templateType === 'split' && inv.splitAmounts?.length) {
    y += 8;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text('Amount split', 40, y); y += 14;
    inv.splitAmounts.forEach((s: any) => { doc.font('Helvetica').text(`${s.label}: ${fmtMoney(s.amount, inv.currency)}${s.inWords ? ` — ${s.inWords}` : ''}`, 48, y, { width: 500 }); y += 13; });
  }
  y += 14;
  if (y > 640) { doc.addPage(); y = 50; }
  doc.roundedRect(40, y, 515, 78, 6).lineWidth(0.8).strokeColor(MAGENTA).stroke();
  doc.fillColor(MAGENTA).font('Helvetica-Bold').fontSize(9).text('PAYMENT DETAILS', 52, y + 9);
  doc.fillColor(INK).font('Helvetica').fontSize(9).text(`Bank: ${bank?.bankName || '—'}\nAccount name: ${bank?.accountName || '—'}\nAccount number: ${accountNumber || '—'}${bank?.sortCode ? `   Sort code: ${bank.sortCode}` : ''}${bank?.swiftCode ? `   SWIFT: ${bank.swiftCode}` : ''}`, 52, y + 24);
  if (inv.notes) { doc.fillColor(MUTED).fontSize(8.5).text(inv.notes, 40, y + 90, { width: 515 }); }
  doc.fontSize(7.5).fillColor(MUTED).text('Please quote the invoice number as the payment reference. Thank you for your business.', 40, 790, { width: 515, align: 'center' });
  return collect(doc);
}

/* ------------------------------ Generic report PDF ------------------------- */
export interface ReportPdfInput {
  title: string;
  subtitle?: string;
  generatedBy?: string;
  summary?: Array<[string, string]>;
  columns: string[];
  rows: Array<Array<string | number>>;
  note?: string;
}

export async function reportPdf(r: ReportPdfInput): Promise<Buffer> {
  const landscape = r.columns.length > 6;
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 40, bufferPages: true, info: { Title: r.title, Author: 'Global SJX OS' } });
  const W = (landscape ? 842 : 595) - 80;
  const header2 = () => {
    try { doc.image(LOGO_PATH, 40, 30, { height: 44 }); } catch { /* optional */ }
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(r.title, 100, 32, { width: W - 60 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text([r.subtitle, `Generated ${new Date().toLocaleString('en-GB')}${r.generatedBy ? ` by ${r.generatedBy}` : ''}`].filter(Boolean).join('  ·  '), 100, 54, { width: W - 60 });
    doc.moveTo(40, 82).lineTo(40 + W, 82).lineWidth(1.5).strokeColor(MAGENTA).stroke();
    doc.y = 94;
  };
  header2();
  if (r.summary?.length) {
    const cw = W / Math.min(r.summary.length, 4);
    let i = 0;
    for (const [k, v] of r.summary) {
      const col = i % 4, row = Math.floor(i / 4);
      const x = 40 + col * cw, yy = doc.y + row * 38;
      doc.roundedRect(x, yy, cw - 8, 32, 4).fillAndStroke('#faf5fc', '#e8d3ee');
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(k.toUpperCase(), x + 8, yy + 5, { width: cw - 24 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(v, x + 8, yy + 16, { width: cw - 24 });
      i++;
    }
    doc.y += Math.ceil(r.summary.length / 4) * 38 + 6;
  }
  const colW = W / r.columns.length;
  const drawHead = () => {
    const yy = doc.y;
    doc.rect(40, yy, W, 18).fill(INK);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
    r.columns.forEach((c, i) => doc.text(c, 44 + i * colW, yy + 5, { width: colW - 6, ellipsis: true, lineBreak: false }));
    doc.y = yy + 20;
  };
  drawHead();
  const bottom = (landscape ? 595 : 842) - 50;
  r.rows.forEach((row, idx) => {
    const cells = row.map((c) => String(c ?? ''));
    const h = Math.max(...cells.map((c) => doc.font('Helvetica').fontSize(8).heightOfString(c, { width: colW - 6 })), 10) + 6;
    if (doc.y + h > bottom) { doc.addPage(); header2(); drawHead(); }
    const yy = doc.y;
    if (idx % 2) doc.rect(40, yy - 2, W, h).fill('#faf8fc');
    doc.fillColor(INK).font('Helvetica').fontSize(8);
    cells.forEach((c, i) => doc.text(c, 44 + i * colW, yy + 1, { width: colW - 6 }));
    doc.y = yy + h;
  });
  if (!r.rows.length) doc.fillColor(MUTED).fontSize(9).text('No records match this report.', 44, doc.y + 6);
  if (r.note) { doc.moveDown(1).fillColor(MUTED).fontSize(8).text(r.note, 40, doc.y, { width: W }); }
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(MUTED).fontSize(7.5).text(`Confidential — Global SJX Limited · Page ${i + 1} of ${range.count}`, 40, (landscape ? 595 : 842) - 30, { width: W, align: 'center', lineBreak: false });
  }
  return collect(doc);
}
export { round2 };
