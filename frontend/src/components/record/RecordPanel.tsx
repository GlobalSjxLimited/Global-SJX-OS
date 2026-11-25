import { useState } from 'react';
import { Discussion, EntityType } from '@/components/discussion/Discussion';
import { RecordDocuments } from './RecordDocuments';
import { AuditStamp } from '@/components/ui/AuditStamp';

/** Everything a record shares: who changed it, its files, and its conversation. Drop it under any form or inside any detail view. */
export function RecordPanel({ entityType, entityId, doc, scopeId, kinds, canAddFiles = true, defaultTab = 'comments' }: { entityType: EntityType; entityId: string; doc?: any; scopeId?: string; kinds?: string[]; canAddFiles?: boolean; defaultTab?: 'comments' | 'documents' }) {
  const [tab, setTab] = useState<'comments' | 'documents'>(defaultTab);
  return (
    <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      {doc && <AuditStamp doc={doc} style={{ marginBottom: 10 }} />}
      <div className="seg" role="tablist" style={{ marginBottom: 12 }}>
        <button role="tab" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>Comments</button>
        <button role="tab" aria-selected={tab === 'documents'} className={tab === 'documents' ? 'on' : ''} onClick={() => setTab('documents')}>Documents</button>
      </div>
      {tab === 'comments' ? <Discussion entityType={entityType} entityId={entityId} scopeId={scopeId} title="Notes and comments" /> : <RecordDocuments entityType={entityType} entityId={entityId} scopeId={scopeId} kinds={kinds} canAdd={canAddFiles} />}
    </div>
  );
}
