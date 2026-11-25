/** Mirrors backend/src/config/taskStatus.ts — keep the two in step. */
export const TASK_STATUSES = ['open', 'in_progress', 'on_hold', 'delayed', 'to_be_reviewed', 'to_be_tested', 'complete', 'closed', 'cancelled', 'abandoned'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABEL: Record<string, string> = {
  open: 'Open', in_progress: 'In progress', on_hold: 'On hold', delayed: 'Delayed', to_be_reviewed: 'To be reviewed', to_be_tested: 'To be tested',
  complete: 'Complete', closed: 'Closed', cancelled: 'Cancelled', abandoned: 'Abandoned',
};
export const STATUS_HELP: Record<string, string> = {
  open: 'Not started yet.', in_progress: 'Being worked on. Track how far along it is.', on_hold: 'Waiting for someone or something else.',
  delayed: 'Running late. This tells the people above you.', to_be_reviewed: 'Finished. Sends it to the reviewer or department head.', to_be_tested: 'Built and waiting to be tested.',
  complete: 'Reviewed and accepted.', closed: 'Closed for good (project owner only).', cancelled: 'No longer needed. Explain why.', abandoned: 'Dropped or out of context. Explain why.',
};
export const STATUS_TONE: Record<string, 'neutral' | 'accent' | 'gold' | 'success' | 'danger'> = {
  open: 'neutral', in_progress: 'accent', on_hold: 'gold', delayed: 'danger', to_be_reviewed: 'accent', to_be_tested: 'accent', complete: 'success', closed: 'success', cancelled: 'neutral', abandoned: 'neutral',
};
export const TERMINAL = ['complete', 'closed', 'cancelled', 'abandoned'];
export const isOpenStatus = (s?: string) => !TERMINAL.includes(s || '');
export const HOLD_REASONS: Array<{ key: string; label: string; needsPerson?: boolean }> = [
  { key: 'awaiting_person', label: 'Awaiting another person', needsPerson: true },
  { key: 'awaiting_ceo', label: 'Awaiting the CEO' },
  { key: 'awaiting_client', label: 'Awaiting the client' },
  { key: 'awaiting_supplier', label: 'Awaiting a supplier' },
  { key: 'awaiting_decision', label: 'Awaiting a decision' },
  { key: 'awaiting_information', label: 'Awaiting information' },
  { key: 'other', label: 'Other' },
];
export const HOLD_LABEL: Record<string, string> = { ...Object.fromEntries(HOLD_REASONS.map((h) => [h.key, h.label])), blocked_by_risk: 'Blocked by an open risk' };
/** Columns shown on the board, in life-cycle order. */
export const BOARD_COLUMNS = TASK_STATUSES.map((k) => ({ key: k, label: STATUS_LABEL[k] }));
