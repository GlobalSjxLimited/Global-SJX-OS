import { EmailIntakeLog, EmailIntakeRule } from '../models/EmailIntake';
import { Task } from '../models/Task';
import { Client } from '../models/Client';
import { User } from '../models/User';
import { Project } from '../models/Project';
import { env } from '../config/env';
import { escapeRegex } from '../utils/escapeRegex';
import { excludeDeleted } from '../utils/softDeletePlugin';
import { esc } from './mail.templates';
import { sendMail } from './email.service';
import { renderEmail, kvTable } from './mail.templates';
import { notifyWork } from './work.notify';
import { logger } from '../utils/logger';

export interface InboundEmail {
  messageId?: string;
  from: string;
  fromName?: string;
  subject?: string;
  text?: string;
  html?: string;
  receivedAt?: Date;
}
export type Channel = 'webhook' | 'imap' | 'manual' | 'test';
export interface IntakeResult {
  outcome: 'task_created' | 'ignored' | 'error' | 'duplicate';
  reason?: string;
  taskId?: string;
  ruleId?: string;
  ruleName?: string;
  matchedKeywords?: string[];
  matchedOrganisation?: string;
  checks?: Array<{ rule: string; passed: boolean; reason?: string }>;
}

const MAX_BODY = 20000;

/* ----------------------------- text helpers ----------------------------- */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

/** Drop the quoted reply chain and signature separators so a rule never matches on text from an old thread. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cut = lines.findIndex((l) => /^\s*(On .{5,80} wrote:|-{2,}\s*Original Message\s*-{2,}|From:\s.+@|_{5,})\s*$/i.test(l) || /^On .+ wrote:$/i.test(l.trim()));
  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).filter((l) => !/^\s*>/.test(l));
  return kept.join('\n').trim();
}

export const cleanSubject = (s?: string) => (s || '').replace(/^\s*((re|fwd?|aw|sv)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim();

export function wordMatch(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  // whole word / whole phrase, case-insensitive; works for phrases with spaces
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(t)}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

const AUTO_SENDER = /(^|[._-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[s]?|notifications?)([._-]|@)/i;
const AUTO_SUBJECT = /^(auto(matic)?[ -]?reply|out of office|undeliverable|delivery status|automatic reply|auto:)/i;

export function isAutomated(mail: InboundEmail): boolean {
  if (AUTO_SENDER.test(mail.from)) return true;
  if (AUTO_SUBJECT.test((mail.subject || '').trim())) return true;
  const own = (env.smtp.from || '').match(/<([^>]+)>/)?.[1] || env.smtp.from || '';
  return !!own && own.toLowerCase() === mail.from.toLowerCase(); // our own outgoing mail must never create tasks (loop guard)
}

/* ----------------------------- sender lookup ----------------------------- */
export async function identifySender(orgId: string, address: string) {
  const email = address.trim().toLowerCase();
  const domain = email.split('@')[1] || '';
  const user = await User.findOne({ organizationId: orgId, email, isActive: true }).select('name email role');
  const clients = await Client.find(excludeDeleted({ organizationId: orgId, $or: [{ 'contacts.email': new RegExp(`^${escapeRegex(email)}$`, 'i') }, { 'contacts.email': new RegExp(`@${escapeRegex(domain)}$`, 'i') }] })).select('name contacts').limit(5);
  const exact = clients.find((c: any) => (c.contacts || []).some((k: any) => String(k.email || '').toLowerCase() === email));
  const client = exact || clients[0] || null;
  return { user, client, known: !!user || !!exact, domain };
}

/* ------------------------------ rule matching ------------------------------ */
interface RuleLike { _id: any; name: string; keywords: string[]; matchMode: string; organisations: string[]; requireOrganisation: boolean; senderDomains: string[]; allowUnknownSenders: boolean }

export function evaluateRule(rule: RuleLike, ctx: { text: string; domain: string; known: boolean; clientName?: string }): { passed: boolean; reason?: string; keywords: string[]; organisation?: string } {
  if (rule.senderDomains?.length && !rule.senderDomains.map((d) => d.toLowerCase()).includes(ctx.domain)) return { passed: false, reason: `Sender domain ${ctx.domain || '(none)'} is not on this rule's list`, keywords: [] };
  if (!ctx.known && !rule.allowUnknownSenders) return { passed: false, reason: 'Sender is not a known user or client contact', keywords: [] };
  const hits = (rule.keywords || []).filter((k) => wordMatch(ctx.text, k));
  if (!rule.keywords?.length) return { passed: false, reason: 'Rule has no keywords', keywords: [] };
  if (rule.matchMode === 'all' ? hits.length !== rule.keywords.length : hits.length === 0) {
    return { passed: false, reason: rule.matchMode === 'all' ? `Missing keyword(s): ${rule.keywords.filter((k) => !hits.includes(k)).join(', ')}` : `None of the keywords (${rule.keywords.join(', ')}) were found`, keywords: hits };
  }
  let organisation: string | undefined;
  if (rule.requireOrganisation && rule.organisations?.length) {
    organisation = rule.organisations.find((o) => wordMatch(ctx.text, o)) || rule.organisations.find((o) => ctx.clientName && o.trim().toLowerCase() === ctx.clientName.trim().toLowerCase());
    if (!organisation) return { passed: false, reason: `No organisation from the list (${rule.organisations.join(', ')}) was mentioned or matched the sender`, keywords: hits };
  }
  return { passed: true, keywords: hits, organisation };
}

/* ------------------------------- processing ------------------------------- */
async function fallbackAssignee(orgId: string, rule: any): Promise<string | null> {
  if (rule.defaultAssigneeId) return String(rule.defaultAssigneeId);
  if (rule.defaultProjectId) {
    const p = await Project.findOne(excludeDeleted({ _id: rule.defaultProjectId, organizationId: orgId })).select('projectManagerId');
    if (p) return String(p.projectManagerId);
  }
  if (rule.createdById) return String(rule.createdById);
  for (const role of ['coo', 'ceo', 'super_admin']) {
    const u = await User.findOne({ organizationId: orgId, role, isActive: true }).select('_id');
    if (u) return String(u._id);
  }
  return null;
}

function bodyToHtml(text: string): string {
  return text.split(/\n{2,}/).slice(0, 60).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

export async function processInboundEmail(orgId: string, raw: InboundEmail, opts: { channel?: Channel; force?: boolean; forceRuleId?: string; dryRun?: boolean } = {}): Promise<IntakeResult> {
  const channel = opts.channel || 'webhook';
  const from = String(raw.from || '').match(/[^\s<>"]+@[^\s<>"]+/)?.[0]?.toLowerCase() || '';
  const subject = (raw.subject || '').slice(0, 300);
  const bodyText = stripQuoted((raw.text && raw.text.trim() ? raw.text : raw.html ? htmlToText(raw.html) : '')).slice(0, MAX_BODY);
  const messageId = raw.messageId ? String(raw.messageId).slice(0, 300) : undefined;
  const base = { organizationId: orgId, messageId, from, fromName: raw.fromName, subject, snippet: bodyText.slice(0, 300), receivedAt: raw.receivedAt || new Date(), channel };
  const log = async (outcome: string, extra: Record<string, unknown> = {}) => {
    if (opts.dryRun) return;
    try { await EmailIntakeLog.create({ ...base, outcome, body: bodyText, ...extra }); } catch (err: any) { if (err?.code !== 11000) logger.warn({ err }, 'intake log failed'); }
  };

  if (!from) { await log('ignored', { reason: 'No sender address' }); return { outcome: 'ignored', reason: 'No sender address' }; }
  if (messageId && !opts.dryRun && !opts.force) {
    const seen = await EmailIntakeLog.findOne({ organizationId: orgId, messageId }).select('outcome taskId');
    if (seen) return { outcome: 'duplicate', reason: 'This message was already processed', taskId: seen.taskId ? String(seen.taskId) : undefined };
  }
  if (!opts.force && isAutomated({ ...raw, from })) { await log('ignored', { reason: 'Automated message (auto-reply / no-reply sender)' }); return { outcome: 'ignored', reason: 'Automated message (auto-reply / no-reply sender)' }; }

  const sender = await identifySender(orgId, from);
  const text = `${subject}\n${bodyText}`;
  const rules = await EmailIntakeRule.find({ organizationId: orgId, active: true, ...(opts.forceRuleId ? { _id: opts.forceRuleId } : {}) }).sort('createdAt');
  if (!rules.length && !opts.force) { await log('ignored', { reason: 'No active intake rules' }); return { outcome: 'ignored', reason: 'No active intake rules' }; }

  const checks: IntakeResult['checks'] = [];
  let hit: { rule: any; keywords: string[]; organisation?: string } | null = null;
  for (const rule of rules) {
    const r = evaluateRule(rule as any, { text, domain: sender.domain, known: sender.known, clientName: (sender.client as any)?.name });
    checks.push({ rule: rule.name, passed: r.passed, reason: r.reason });
    if (r.passed) { hit = { rule, keywords: r.keywords, organisation: r.organisation }; break; }
  }
  if (!hit && opts.force && rules.length) hit = { rule: rules[0], keywords: [], organisation: undefined };
  if (!hit) {
    const reason = checks.map((c) => `${c.rule}: ${c.reason}`).join(' · ') || 'No rule matched';
    await log('ignored', { reason });
    return { outcome: 'ignored', reason, checks };
  }
  if (opts.dryRun) return { outcome: 'task_created', reason: 'Dry run — a task would be created', ruleId: String(hit.rule._id), ruleName: hit.rule.name, matchedKeywords: hit.keywords, matchedOrganisation: hit.organisation, checks };

  const rule = hit.rule;
  const owner = await fallbackAssignee(orgId, rule);
  if (!owner) { await log('error', { reason: 'No assignee could be found — set a default assignee on the rule', ruleId: rule._id }); return { outcome: 'error', reason: 'No assignee could be found — set a default assignee on the rule' }; }
  const title = (cleanSubject(subject) || bodyText.split('\n').find((l) => l.trim())?.slice(0, 120) || 'Task from email').slice(0, 200);
  const due = new Date(Date.now() + (rule.dueInDays ?? 7) * 86400000);
  const client: any = sender.client;

  const task = await Task.create({
    organizationId: orgId, title,
    description: `${bodyToHtml(bodyText) || '<p>(no message body)</p>'}<p><em>Created automatically from an e-mail from ${esc(raw.fromName ? `${raw.fromName} <${from}>` : from)}.</em></p>`,
    ownerId: owner, creatorId: sender.user?._id || rule.createdById || owner,
    priority: rule.defaultPriority, severity: rule.defaultSeverity, status: 'open',
    projectId: rule.defaultProjectId, clientId: client?._id,
    startDate: new Date(), endDate: due, dueDate: due,
    tags: ['from-email', ...hit.keywords], source: 'email',
    sourceEmail: { messageId, from, subject, receivedAt: base.receivedAt, matchedKeywords: hit.keywords, ruleId: rule._id },
    requireEvidence: ['major', 'critical', 'show_stopper'].includes(rule.defaultSeverity),
    activityHistory: [{ action: 'created_from_email', meta: { from, rule: rule.name, keywords: hit.keywords, organisation: hit.organisation } }],
  });
  await EmailIntakeRule.updateOne({ _id: rule._id }, { $inc: { matchedCount: 1 } });
  await log('task_created', { ruleId: rule._id, matchedKeywords: hit.keywords, matchedOrganisation: hit.organisation, taskId: task._id });

  const people = Array.from(new Set([owner, ...(rule.notifyUserIds || []).map(String)]));
  await notifyWork({
    organizationId: orgId, userIds: people, title: `New task from e-mail: ${title}`, summary: `An e-mail from ${raw.fromName || from} matched the rule "${rule.name}" and became a task.`,
    rows: [['Task', title], ['From', from], ['Matched keywords', hit.keywords.join(', ')], ['Organisation', hit.organisation || client?.name], ['Due', due.toLocaleDateString('en-GB')]], link: `/tasks/${task._id}`, cta: 'Open task', type: 'task',
  });
  if (rule.acknowledgeSender && sender.known && !AUTO_SENDER.test(from)) {
    const m = renderEmail({ title: 'We received your request', intro: esc(`Thank you${raw.fromName ? `, ${raw.fromName}` : ''}. Your e-mail has been logged as a task and the team has been notified.`), body: kvTable([['Reference', String(task._id).slice(-8).toUpperCase()], ['Subject', title]]) });
    sendMail({ to: from, subject: `Re: ${subject || title} — received`, html: m.html, attachments: m.attachments }).catch((err) => logger.warn({ err }, 'intake acknowledgement failed'));
  }
  return { outcome: 'task_created', taskId: String(task._id), ruleId: String(rule._id), ruleName: rule.name, matchedKeywords: hit.keywords, matchedOrganisation: hit.organisation, checks };
}

/* ------------------------------ optional IMAP poller ------------------------------ */
/**
 * Polls a mailbox for new mail when INTAKE_IMAP_HOST is set. `imapflow` and `mailparser` are optional
 * dependencies loaded only here, so nothing breaks if they are not installed.
 */
let polling = false;
export async function pollImapOnce(orgId: string): Promise<number> {
  if (polling) return 0;
  polling = true;
  let processed = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ImapFlow } = require('imapflow');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { simpleParser } = require('mailparser');
    const client = new ImapFlow({
      host: process.env.INTAKE_IMAP_HOST, port: Number(process.env.INTAKE_IMAP_PORT) || 993, secure: process.env.INTAKE_IMAP_SECURE !== 'false',
      auth: { user: process.env.INTAKE_IMAP_USER, pass: process.env.INTAKE_IMAP_PASS }, logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock(process.env.INTAKE_IMAP_FOLDER || 'INBOX');
    try {
      const uids: number[] = await client.search({ seen: false });
      for (const uid of uids.slice(0, 50)) {
        const msg = await client.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
        const parsed = await simpleParser(msg.source);
        const addr = parsed.from?.value?.[0];
        await processInboundEmail(orgId, { messageId: parsed.messageId, from: addr?.address || '', fromName: addr?.name, subject: parsed.subject, text: parsed.text, html: typeof parsed.html === 'string' ? parsed.html : undefined, receivedAt: parsed.date }, { channel: 'imap' });
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        processed += 1;
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err: any) {
    if (err?.code === 'MODULE_NOT_FOUND') logger.warn('INTAKE_IMAP_HOST is set but imapflow / mailparser are not installed. Run: npm i imapflow mailparser');
    else logger.warn({ err: err?.message }, 'intake IMAP poll failed');
  } finally {
    polling = false;
  }
  return processed;
}
