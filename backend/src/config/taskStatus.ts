/**
 * The task life-cycle in one place. Nothing else in the code base should hard-code a status list.
 *
 *   open            default when a task is created
 *   in_progress     being worked on; carries a completion percentage
 *   on_hold         waiting on something outside the owner's control (a person, the CEO, a client …)
 *   delayed         past its date or slipping — an escalation to the people above
 *   to_be_reviewed  work is finished; sent to the reviewer / department head for sign-off
 *   to_be_tested    built, waiting for testing
 *   complete        reviewed and accepted (certificate issued)
 *   closed          closed for good — only the project owner can do this
 *   cancelled       no longer needed
 *   abandoned       dropped / out of context
 */
export const TASK_STATUSES = ['open', 'in_progress', 'on_hold', 'delayed', 'to_be_reviewed', 'to_be_tested', 'complete', 'closed', 'cancelled', 'abandoned'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open', in_progress: 'In progress', on_hold: 'On hold', delayed: 'Delayed', to_be_reviewed: 'To be reviewed', to_be_tested: 'To be tested',
  complete: 'Complete', closed: 'Closed', cancelled: 'Cancelled', abandoned: 'Abandoned',
};

/** Work that is finished successfully. */
export const FINISHED: TaskStatus[] = ['complete', 'closed'];
/** No further work is expected: finished, or dropped. Used everywhere "still open" is asked. */
export const TERMINAL: TaskStatus[] = ['complete', 'closed', 'cancelled', 'abandoned'];
/** Dropped without being finished. */
export const DROPPED: TaskStatus[] = ['cancelled', 'abandoned'];
/** Waiting for somebody else — the owner is not the bottleneck. */
export const WAITING: TaskStatus[] = ['on_hold', 'to_be_reviewed', 'to_be_tested'];

export const isTerminal = (s?: string) => TERMINAL.includes(s as TaskStatus);
export const isFinished = (s?: string) => FINISHED.includes(s as TaskStatus);
export const isDropped = (s?: string) => DROPPED.includes(s as TaskStatus);
export const isOpenStatus = (s?: string) => !isTerminal(s);

/** Mongo filter fragments, so queries read the same everywhere. */
export const OPEN_FILTER = { $nin: TERMINAL as string[] };
export const FINISHED_FILTER = { $in: FINISHED as string[] };

/** Old status → new status (migration and tolerant input). */
export const LEGACY_STATUS: Record<string, TaskStatus> = {
  backlog: 'open', todo: 'open', blocked: 'on_hold', review: 'to_be_reviewed', awaiting_approval: 'to_be_reviewed', done: 'complete',
};
export const normaliseStatus = (s?: string): TaskStatus | undefined => (s ? ((LEGACY_STATUS[s] || s) as TaskStatus) : undefined);

/** Where a task may go from each status. `closed` is further limited by who is asking (see canClose). */
const NEXT: Record<TaskStatus, TaskStatus[]> = {
  open: ['in_progress', 'on_hold', 'delayed', 'to_be_reviewed', 'cancelled', 'abandoned'],
  in_progress: ['open', 'on_hold', 'delayed', 'to_be_reviewed', 'to_be_tested', 'cancelled', 'abandoned'],
  on_hold: ['open', 'in_progress', 'delayed', 'cancelled', 'abandoned'],
  delayed: ['open', 'in_progress', 'on_hold', 'to_be_reviewed', 'to_be_tested', 'cancelled', 'abandoned'],
  to_be_reviewed: ['in_progress', 'complete', 'to_be_tested', 'cancelled'],
  to_be_tested: ['in_progress', 'to_be_reviewed', 'on_hold', 'cancelled'],
  complete: ['closed', 'in_progress'],
  closed: ['in_progress'],
  cancelled: ['open', 'in_progress'],
  abandoned: ['open', 'in_progress'],
};
export const nextStatuses = (from: TaskStatus): TaskStatus[] => NEXT[from] || [];
export const canMove = (from: TaskStatus, to: TaskStatus) => from === to || NEXT[from]?.includes(to);

export const HOLD_REASONS = ['awaiting_person', 'awaiting_ceo', 'awaiting_client', 'awaiting_supplier', 'awaiting_decision', 'awaiting_information', 'blocked_by_risk', 'other'] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];
export const HOLD_LABEL: Record<HoldReason, string> = {
  awaiting_person: 'Awaiting another person', awaiting_ceo: 'Awaiting the CEO', awaiting_client: 'Awaiting the client', awaiting_supplier: 'Awaiting a supplier',
  awaiting_decision: 'Awaiting a decision', awaiting_information: 'Awaiting information', blocked_by_risk: 'Blocked by an open risk', other: 'Other',
};

export interface TransitionInput {
  from: TaskStatus;
  to: TaskStatus;
  comment?: string;
  percent?: number;
  evidenceCount?: number;
  hasHoldReason?: boolean;
  newDate?: unknown;
}

/**
 * Pure rules for one status change. Returns the reasons it must be refused (empty = allowed).
 * Every change needs a comment — including the first "open".
 */
export function transitionProblems(i: TransitionInput): string[] {
  const out: string[] = [];
  const c = (i.comment || '').trim();
  if (!canMove(i.from, i.to)) out.push(`A ${STATUS_LABEL[i.from].toLowerCase()} task cannot go straight to ${STATUS_LABEL[i.to].toLowerCase()}.`);
  if (c.length < 3) out.push('Write a comment explaining this status change.');
  if (i.to === 'on_hold' && !i.hasHoldReason) out.push('Say what the task is waiting for.');
  if (i.to === 'delayed' && !i.newDate) out.push('Give the new expected date.');
  if (i.to === 'in_progress' && i.percent !== undefined && (i.percent < 0 || i.percent > 99)) out.push('Progress must be between 0 and 99%. At 100% send the task for review.');
  if (DROPPED.includes(i.to) && !(i.evidenceCount && i.evidenceCount > 0) && c.length < 15) out.push(`Explain why it is ${STATUS_LABEL[i.to].toLowerCase()} (at least a sentence) or attach evidence.`);
  return out;
}

/** Who may close: the project owner (the project manager), or the creator when the task has no project. Top leaders can step in. */
export function canClose(a: { userId: string; projectManagerId?: string; creatorId?: string; hasProject: boolean; role: string }): boolean {
  if (a.role === 'super_admin' || a.role === 'ceo') return true;
  return a.hasProject ? !!a.projectManagerId && a.projectManagerId === a.userId : !!a.creatorId && a.creatorId === a.userId;
}

/** Days past due → how high the escalation goes. */
export function escalationLevel(daysLate: number): 0 | 1 | 2 | 3 {
  if (daysLate < 1) return 0;
  if (daysLate < 3) return 1; // owner's manager / project manager
  if (daysLate < 7) return 2; // department head / COO
  return 3; // CEO
}
export const percentFor = (status: string, percent?: number) => (isFinished(status) ? 100 : status === 'to_be_reviewed' || status === 'to_be_tested' ? 100 : Math.max(0, Math.min(99, Math.round(percent ?? 0))));
