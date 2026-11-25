import { useState } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import { api, apiErrorMessage, openProtectedFile } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { fdate } from '@/lib/format';
import { FileUpload } from '@/components/work/FileUpload';
import type { EntityType } from '@/components/discussion/Discussion';

const KINDS = [{ key: 'other', label: 'Document' }, { key: 'contract', label: 'Contract' }, { key: 'proposal', label: 'Proposal' }, { key: 'signed', label: 'Signed copy' }, { key: 'invoice', label: 'Invoice' }, { key: 'receipt', label: 'Receipt' }, { key: 'image', label: 'Image' }];
const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Files attached to any record. PDF, Word, Excel, PowerPoint, text or images; 10 MB each. */
export function RecordDocuments({ entityType, entityId, scopeId, kinds, canAdd = true, onChanged }: { entityType: EntityType; entityId: string; scopeId?: string; kinds?: string[]; canAdd?: boolean; onChanged?: () => void }) {
  const url = `/entity-documents/${entityType}/${entityId}`;
  const { data, loading, error, reload } = useApi<any[]>(url, scopeId ? { scopeId } : undefined);
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [kind, setKind] = useState((kinds && kinds[0]) || 'other');
  const [note, setNote] = useState('');
  const options = KINDS.filter((k) => !kinds || kinds.includes(k.key));

  async function add(files: Array<{ name: string; url: string }>) {
    try {
      for (const f of files) await api.post(url, { name: f.name, url: f.url, kind, note: note || undefined, scopeId });
      setNote(''); showSuccess(files.length > 1 ? 'Files attached.' : 'File attached.'); reload(); onChanged?.();
    } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function remove(d: any) {
    if (!(await confirm({ title: 'Remove file', message: `Remove “${d.name}”?`, confirmLabel: 'Remove', danger: true }))) return;
    try { await api.delete(`/entity-documents/file/${d._id}`); reload(); onChanged?.(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  return (
    <div>
      {loading && !data ? <p className="text-muted" style={{ fontSize: 13 }}>Loading…</p> : error ? <p className="text-muted" style={{ fontSize: 13 }}>{error}</p> : !data?.length ? <p className="text-muted" style={{ fontSize: 13 }}>No files yet.</p> : (
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{data.map((d) => (
          <li key={d._id} className="mini-card flex-between" style={{ gap: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start', minWidth: 0, flex: 1 }} onClick={() => openProtectedFile(d.url).catch((e) => showError(apiErrorMessage(e)))}>
              <FileText size={14} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span></button>
            <span className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{options.find((k) => k.key === d.kind)?.label || KINDS.find((k) => k.key === d.kind)?.label || 'Document'} · {size(d.size)} · {d.uploadedByName || ''} · {fdate(d.createdAt)}</span>
            {d.canDelete && <button type="button" className="icon-btn" aria-label={`Remove ${d.name}`} onClick={() => remove(d)}><Trash2 size={14} /></button>}
          </li>))}</ul>
      )}
      {canAdd && (
        <div className="row-gap" style={{ marginTop: 12, alignItems: 'center' }}>
          {options.length > 1 && <select className="input" style={{ width: 'auto' }} aria-label="What kind of file" value={kind} onChange={(e) => setKind(e.target.value)}>{options.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>}
          <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <FileUpload kind="document" label="Attach file (max 10 MB)" onUploaded={add} />
        </div>
      )}
    </div>
  );
}
