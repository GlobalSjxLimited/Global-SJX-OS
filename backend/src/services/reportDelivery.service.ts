import { ReportDef, ReportResult, REPORT_MAP, reportModules } from './reports.service';
import { reportPdf } from './pdf.service';
import { toCsv } from '../utils/csv';
import { ReportSchedule } from '../models/Governance';
import { User } from '../models/User';
import { effectiveModules } from './access.service';
import { sendMail } from './email.service';
import { renderEmail, kvTable, esc, fmtDate } from './mail.templates';
import { logActivity } from '../models/ActivityLog';
import { logger } from '../utils/logger';

export async function buildExport(def: ReportDef, result: ReportResult, format: 'csv' | 'pdf', opts: { params?: any; generatedBy?: string } = {}) {
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${def.key}-${stamp}`;
  if (format === 'csv') return { buffer: Buffer.from(toCsv(result.columns, result.rows), 'utf8'), filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8' };
  const buffer = await reportPdf({
    title: def.title, subtitle: [def.category, def.standard].filter(Boolean).join(' · '), generatedBy: opts.generatedBy,
    summary: result.summary?.map(([k, v]) => [k, String(v)] as [string, string]),
    columns: result.columns.map((c) => c.label), rows: result.rows.map((r) => result.columns.map((c) => r[c.key] ?? '')), note: result.note,
  });
  return { buffer, filename: `${base}.pdf`, contentType: 'application/pdf' };
}

export const canRun = (def: ReportDef, role: string, modules: string[]) => role === 'super_admin' || reportModules(def).some((m) => modules.includes(m));

const nextRun = (freq: string, from = new Date()) => {
  const d = new Date(from);
  if (freq === 'weekly') d.setDate(d.getDate() + 7);
  else if (freq === 'quarterly') d.setMonth(d.getMonth() + 3);
  else d.setMonth(d.getMonth() + 1);
  d.setHours(6, 0, 0, 0);
  return d;
};
export { nextRun };

/** Runs one schedule: builds the report, mails it to recipients who still hold the required module. */
export async function runSchedule(schedule: any): Promise<{ sent: number; skipped: number }> {
  const def = REPORT_MAP.get(schedule.reportKey);
  const orgId = String(schedule.organizationId);
  let sent = 0, skipped = 0, status = 'ok';
  try {
    if (!def) throw new Error(`Unknown report ${schedule.reportKey}`);
    const result = await def.run({ orgId, params: schedule.params || {} });
    const file = await buildExport(def, result, schedule.format, { generatedBy: 'scheduled delivery' });
    const users = await User.find({ _id: { $in: schedule.recipientIds || [] }, isActive: true, loginEnabled: { $ne: false } }).select('name email role moduleGrant moduleDeny organizationId');
    const to: string[] = [];
    for (const u of users) {
      const mods = await effectiveModules({ role: u.role, organizationId: String(u.organizationId), moduleGrant: u.moduleGrant as string[], moduleDeny: u.moduleDeny as string[] });
      if (canRun(def, u.role, mods)) to.push(u.email); else skipped++; // never mail a report to someone who has since lost access to it
    }
    to.push(...(schedule.extraEmails || []));
    if (to.length) {
      const mail = renderEmail({
        title: schedule.name, intro: `Your scheduled report <strong>${esc(def.title)}</strong> is attached.`,
        body: kvTable([['Report', def.title], ['Generated', fmtDate(new Date())], ...(result.summary || []).slice(0, 6).map(([k, v]) => [k, String(v)] as [string, string])]),
        cta: { label: 'Open Reports Centre', path: '/reports' }, footerNote: 'Confidential — contains business data. Do not forward.',
      });
      await sendMail({ to, subject: `${schedule.name} — ${fmtDate(new Date())}`, html: mail.html, attachments: [...mail.attachments, { filename: file.filename, content: file.buffer, contentType: file.contentType.split(';')[0] }] });
      sent = to.length;
    }
  } catch (err: any) {
    status = `failed: ${String(err.message).slice(0, 120)}`;
    logger.error({ err, schedule: String(schedule._id) }, 'scheduled report failed');
  }
  schedule.lastRunAt = new Date();
  schedule.lastStatus = status;
  schedule.nextRunAt = nextRun(schedule.frequency);
  await schedule.save();
  await logActivity({ organizationId: orgId, action: 'report.scheduled_run', entityType: 'ReportSchedule', entityId: String(schedule._id), module: 'reports', summary: `${schedule.name}: ${status} (${sent} sent)`, status: status === 'ok' ? 'success' : 'failed' });
  return { sent, skipped };
}

export async function runDueSchedules() {
  const due = await ReportSchedule.find({ active: true, isDeleted: { $ne: true }, nextRunAt: { $lte: new Date() } });
  for (const s of due) await runSchedule(s);
  return due.length;
}
