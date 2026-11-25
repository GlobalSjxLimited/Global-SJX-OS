import { AlertTriangle, Pause } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { HOLD_LABEL, STATUS_LABEL, STATUS_TONE } from '@/lib/taskStatus';

export function StatusBadge({ status, hold }: { status: string; hold?: { reason?: string } }) {
  const extra = status === 'on_hold' && hold?.reason ? ` · ${HOLD_LABEL[hold.reason] || ''}` : '';
  return <Badge tone={STATUS_TONE[status] || 'neutral'}>{status === 'delayed' && <AlertTriangle size={11} />}{status === 'on_hold' && <Pause size={11} />} {STATUS_LABEL[status] || status}{extra}</Badge>;
}

/** Completion bar. Reads as a number as well as a shape. */
export function ProgressBar({ value, status, compact }: { value?: number; status?: string; compact?: boolean }) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)));
  const done = status === 'complete' || status === 'closed';
  const dropped = status === 'cancelled' || status === 'abandoned';
  return (
    <div style={{ minWidth: compact ? 80 : 140 }} title={`${v}% complete`}>
      <div style={{ height: 6, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${v}%`, height: '100%', background: dropped ? 'var(--muted-2)' : done ? 'var(--success, #2e9e6b)' : 'var(--accent, #C22FD4)' }} />
      </div>
      {!compact && <div className="text-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{v}%</div>}
    </div>
  );
}
