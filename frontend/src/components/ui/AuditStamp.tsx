import { fdatetime } from '@/lib/format';

/**
 * "Created by A on …  ·  Last updated by B on …  from Chrome on Windows (41.58.0.1)".
 * Works on any record whose model carries the stamp (createdBy / updatedBy / updatedFrom + timestamps).
 */
export function AuditStamp({ doc, style }: { doc: any; style?: React.CSSProperties }) {
  if (!doc) return null;
  const from = [doc.updatedFrom?.device, doc.updatedFrom?.ip && `(${doc.updatedFrom.ip})`].filter(Boolean).join(' ');
  return (
    <div className="text-muted" style={{ fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: '2px 14px', ...style }}>
      <span>Created {fdatetime(doc.createdAt)}{doc.createdBy?.name ? ` by ${doc.createdBy.name}` : ''}</span>
      <span>Modified {fdatetime(doc.updatedAt)}{doc.updatedBy?.name ? ` by ${doc.updatedBy.name}` : ''}{from ? ` · ${from}` : ''}</span>
    </div>
  );
}
