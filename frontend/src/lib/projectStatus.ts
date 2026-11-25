/** Mirrors backend/src/config/projectStatus.ts. */
export const PROJECT_STATUS_OPTIONS = [
  { key: 'initiation', label: 'Initiation' }, { key: 'planning', label: 'Planning' }, { key: 'execution', label: 'Execution' }, { key: 'monitoring', label: 'Monitoring' },
  { key: 'closure', label: 'Closure' }, { key: 'active', label: 'Active' }, { key: 'inactive', label: 'Inactive' }, { key: 'on_hold', label: 'On hold' },
];
export const PROJECT_LABEL: Record<string, string> = { ...Object.fromEntries(PROJECT_STATUS_OPTIONS.map((s) => [s.key, s.label])), paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled' };
export const PROJECT_ENDING = ['closure', 'inactive', 'completed', 'cancelled'];
