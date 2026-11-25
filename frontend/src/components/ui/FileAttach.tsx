import { useRef, useState } from 'react';
import { Paperclip, X, Image as ImageIcon, FileText, Loader2 } from 'lucide-react';
import { api, apiErrorMessage, openProtectedFile } from '@/lib/api';
import { useToast } from '@/context/ToastContext';

export interface Attachment { url: string; name: string; mimeType?: string; size?: number; kind?: 'receipt' | 'image' | 'invoice' | 'other' }

/**
 * Attach any number of receipts / photos. Files upload immediately to the
 * organisation's private store; the parent only keeps the returned metadata.
 */
export function FileAttach({ value, onChange, label = 'Receipts & photos', max = 20 }: { value: Attachment[]; onChange: (v: Attachment[]) => void; label?: string; max?: number }) {
  const { showError } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    if (value.length + files.length > max) { showError(`You can attach up to ${max} files.`); return; }
    setBusy(true);
    try {
      const body = new FormData();
      Array.from(files).forEach((f) => body.append('files', f));
      const res = await api.post('/uploads/multi', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      const uploaded: Array<{ url: string; originalName: string; mimeType: string; size: number }> = res.data.data;
      onChange([...value, ...uploaded.map((u) => ({ url: u.url, name: u.originalName, mimeType: u.mimeType, size: u.size, kind: u.mimeType.startsWith('image/') ? ('image' as const) : ('receipt' as const) }))]);
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Paperclip size={14} />} {label}
        </button>
        <input ref={input} type="file" multiple accept="image/*,.pdf" capture={undefined} style={{ display: 'none' }} onChange={(e) => add(e.target.files)} />
        <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{value.length ? `${value.length} attached` : 'PDF, JPG, PNG or WebP · up to 20 MB each'}</span>
      </div>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {value.map((a, i) => (
            <span key={a.url} className="chip" style={{ cursor: 'default' }}>
              {a.mimeType?.startsWith('image/') ? <ImageIcon size={13} /> : <FileText size={13} />}
              <button type="button" onClick={() => openProtectedFile(a.url, a.name)} style={{ background: 'none', border: 0, color: 'inherit', padding: 0, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>{a.name}</button>
              <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onChange(value.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 0, color: 'var(--muted-2)', padding: 0, display: 'inline-flex' }}><X size={13} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Read-only list of attachments (opens through the authenticated download route). */
export function AttachmentList({ items }: { items?: Attachment[] }) {
  if (!items?.length) return <span className="text-muted" style={{ fontSize: 12.5 }}>No receipts attached</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((a) => (
        <button key={a.url} type="button" className="chip" onClick={() => openProtectedFile(a.url, a.name)}>
          {a.mimeType?.startsWith('image/') ? <ImageIcon size={13} /> : <FileText size={13} />}{a.name}
        </button>
      ))}
    </div>
  );
}
