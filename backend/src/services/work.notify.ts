import { notify } from './notify.service';
import { callout, esc, fmtDate, kvTable } from './mail.templates';

export interface WorkNote {
  organizationId: string;
  userIds: string[];
  title: string;
  /** one plain-text sentence; escaped here */
  summary: string;
  rows?: Array<[string, unknown]>;
  note?: string;
  /** trusted, already-escaped HTML appended after the note (e.g. a second link) */
  extraHtml?: string;
  noteTone?: 'info' | 'warn' | 'danger';
  link: string;
  cta?: string;
  email?: boolean;
  severity?: 'info' | 'warning' | 'high' | 'critical';
  dedupeKey?: string;
  type?: string;
  category?: string;
  entity?: { type: string; id: string };
}

/** In-app notification + branded e-mail. Every dynamic value is escaped. */
export function notifyWork(n: WorkNote) {
  return notify({
    organizationId: n.organizationId,
    userIds: n.userIds,
    title: n.title,
    body: n.summary,
    link: n.link,
    type: n.type || 'task',
    category: n.category,
    entity: n.entity,
    severity: n.severity,
    dedupeKey: n.dedupeKey,
    email: n.email === false ? undefined : {
      intro: esc(n.summary),
      bodyHtml: `${n.rows?.length ? kvTable(n.rows) : ''}${n.note ? callout(esc(n.note).replace(/\n/g, '<br>'), n.noteTone || 'info') : ''}${n.extraHtml || ''}`,
      ctaLabel: n.cta || 'Open in GLOBAL SJX OS',
    },
  });
}

export const taskRows = (t: any, extra: Array<[string, unknown]> = []): Array<[string, unknown]> => [
  ['Task', t.title],
  ['Status', String(t.status || '').replace(/_/g, ' ')],
  ['Severity', String(t.severity || '').replace(/_/g, ' ')],
  ['Start', t.startDate ? fmtDate(t.startDate) : undefined],
  ['Due', t.endDate || t.dueDate ? fmtDate(t.endDate || t.dueDate) : undefined],
  ...extra,
];
