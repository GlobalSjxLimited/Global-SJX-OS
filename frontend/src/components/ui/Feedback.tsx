import { Inbox } from 'lucide-react';

export function EmptyState({ message = 'Nothing here yet.', icon }: { message?: string; icon?: React.ReactNode }) {
  return (
    <div className="empty-state">
      {icon || <Inbox />}
      <p>{message}</p>
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%', style = {} }: { height?: number; width?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height, width, ...style }} />;
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ display: 'grid', gap: 10, padding: 16 }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} height={14} />
          ))}
        </div>
      ))}
    </div>
  );
}
