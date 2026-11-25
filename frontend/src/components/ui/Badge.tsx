interface BadgeProps {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'gold' | 'success' | 'danger';
}

const TONE_MAP: Record<string, string> = {
  // status word -> tone, used by statusTone()
  done: 'success', completed: 'success', active: 'success', won: 'success', compliant: 'success', approved: 'success', resolved: 'success', on_track: 'success', launched: 'success',
  in_progress: 'accent', review: 'accent', qualified: 'accent', discovery: 'accent', proposal: 'accent', negotiation: 'accent', pilot: 'accent', prototype: 'accent',
  todo: 'neutral', backlog: 'neutral', pending: 'neutral', draft: 'neutral', submitted: 'neutral', planning: 'neutral', lead: 'neutral',
  urgent: 'danger', high: 'gold', overdue: 'danger', off_track: 'danger', lost: 'danger', expired: 'danger', non_compliant: 'danger', rejected: 'danger', critical: 'danger', at_risk: 'gold',
  medium: 'gold', low: 'neutral', expiring_soon: 'gold', on_hold: 'gold',
  complete: 'success', closed: 'success', delayed: 'danger', to_be_reviewed: 'accent', to_be_tested: 'accent', cancelled: 'neutral', abandoned: 'neutral', open: 'neutral',
};

export function statusTone(status?: string): BadgeProps['tone'] {
  if (!status) return 'neutral';
  return (TONE_MAP[status.toLowerCase()] as BadgeProps['tone']) || 'neutral';
}

export function Badge({ children, tone = 'neutral' }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
