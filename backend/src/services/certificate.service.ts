import PDFDocument from 'pdfkit';
import { LOGO_PATH } from './mail.templates';

const MAGENTA = '#C22FD4';
const GOLD = '#F0A93B';
const INK = '#1c1727';
const MUTED = '#6b6478';
const d = (x?: Date | string | null) => (x ? new Date(x).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—');

export interface CertificateInput {
  kind: 'Task' | 'Milestone' | 'Goal';
  title: string;
  recipient: string;
  approver: string;
  project?: string;
  certificateNo: string;
  ribbon?: string;
  completedAt?: Date | string | null;
  approvedAt?: Date | string | null;
  evidenceCount: number;
  note?: string;
}

/** One-page landscape completion certificate. Issued only after an approver signs off on evidence. */
export function certificatePdf(c: CertificateInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 0, left: 0, right: 0, bottom: 0 }, info: { Title: `${c.kind} completion certificate ${c.certificateNo}`, Author: 'Global SJX Limited' } });
    const chunks: Buffer[] = [];
    doc.on('data', (x) => chunks.push(x));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 841.89, H = 595.28;
    doc.rect(18, 18, W - 36, H - 36).lineWidth(3).strokeColor(MAGENTA).stroke();
    doc.rect(28, 28, W - 56, H - 56).lineWidth(0.8).strokeColor(GOLD).stroke();
    try { doc.image(LOGO_PATH, W / 2 - 28, 46, { height: 56 }); } catch { /* logo optional */ }

    doc.fillColor(MAGENTA).font('Helvetica-Bold').fontSize(11).text('GLOBAL SJX LIMITED', 0, 112, { width: W, align: 'center', characterSpacing: 3, lineBreak: false });
    doc.fillColor(INK).font('Times-Bold').fontSize(34).text('Certificate of Completion', 0, 136, { width: W, align: 'center', lineBreak: false });
    doc.fillColor(MUTED).font('Helvetica').fontSize(11).text(`This certifies that the following ${c.kind.toLowerCase()} was delivered, evidenced and approved`, 0, 184, { width: W, align: 'center', lineBreak: false });

    doc.fillColor(INK).font('Times-Bold').fontSize(24).text(c.title.length > 90 ? `${c.title.slice(0, 87)}…` : c.title, 80, 214, { width: W - 160, align: 'center', height: 70 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(11).text('Delivered by', 0, 296, { width: W, align: 'center', lineBreak: false });
    doc.fillColor(MAGENTA).font('Helvetica-Bold').fontSize(20).text(c.recipient, 0, 312, { width: W, align: 'center', lineBreak: false });
    if (c.project) doc.fillColor(MUTED).font('Helvetica').fontSize(10.5).text(`Project: ${c.project}`, 0, 342, { width: W, align: 'center', lineBreak: false });

    if (c.ribbon) {
      // gold ribbon
      doc.save().rect(W / 2 - 110, 368, 220, 26).fill(GOLD).restore();
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text(c.ribbon.toUpperCase(), W / 2 - 110, 375, { width: 220, align: 'center', lineBreak: false, characterSpacing: 1 });
    }

    const y = 430;
    const col = (x: number, label: string, value: string) => {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(label.toUpperCase(), x, y, { width: 200, align: 'center', lineBreak: false, characterSpacing: 1 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(value, x, y + 14, { width: 200, align: 'center', lineBreak: false });
    };
    col(70, 'Completed', d(c.completedAt));
    col(W / 2 - 100, 'Approved by', c.approver);
    col(W - 270, 'Approved on', d(c.approvedAt));
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Evidence items on file: ${c.evidenceCount}`, 0, 478, { width: W, align: 'center', lineBreak: false });
    if (c.note) doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9).text(`“${c.note.slice(0, 160)}”`, 120, 494, { width: W - 240, align: 'center', height: 24 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`Certificate no. ${c.certificateNo} · Verify in GLOBAL SJX OS`, 0, H - 52, { width: W, align: 'center', lineBreak: false });
    doc.end();
  });
}
