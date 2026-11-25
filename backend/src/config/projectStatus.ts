/** Project life-cycle (PMBOK-style phases) plus the standing states. */
export const PROJECT_STATUSES = ['initiation', 'planning', 'execution', 'monitoring', 'closure', 'active', 'inactive', 'on_hold', 'paused', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_LABEL: Record<string, string> = {
  initiation: 'Initiation', planning: 'Planning', execution: 'Execution', monitoring: 'Monitoring', closure: 'Closure', active: 'Active', inactive: 'Inactive', on_hold: 'On hold', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled',
};
/** Statuses where the project is live and its work should be tracked. */
export const PROJECT_RUNNING = ['initiation', 'planning', 'execution', 'monitoring', 'active'];
/** Statuses that end the project. Only the project owner may set them. */
export const PROJECT_ENDING = ['closure', 'inactive', 'completed', 'cancelled'];
export const LEGACY_PROJECT_STATUS: Record<string, string> = { completed: 'closure', cancelled: 'inactive', paused: 'on_hold' };

/** Pure: reasons a project status change must be refused. */
export function projectStatusProblems(i: { from: string; to: string; comment?: string; holdReason?: string; isOwner: boolean; openTasks: number; force?: boolean }): string[] {
  const out: string[] = [];
  if (i.from === i.to) return out;
  if (!(i.comment || '').trim() || (i.comment || '').trim().length < 3) out.push('Write a comment explaining this status change.');
  if (['on_hold', 'paused'].includes(i.to) && !(i.holdReason || i.comment || '').trim()) out.push('Say why the project is on hold.');
  if (PROJECT_ENDING.includes(i.to)) {
    if (!i.isOwner) out.push('Only the project owner can close a project or make it inactive.');
    if (i.openTasks > 0 && !i.force) out.push(`${i.openTasks} task${i.openTasks === 1 ? ' is' : 's are'} still open. Finish them, or confirm that you want to close anyway.`);
  }
  return out;
}
