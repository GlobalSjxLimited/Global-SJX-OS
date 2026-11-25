import { useState } from 'react';
import { FileText, Link2, Trash2 } from 'lucide-react';
import { api, apiErrorMessage, openProtectedFile } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { fdatetime } from '@/lib/format';
import { FileUpload } from './FileUpload';
import './work.css';

export interface DocItem { _id: string; name: string; url: string; kind?: string; note?: string; uploadedAt?: string; uploadedById?: { name?: string } | string }

const openDoc = (d: DocItem) => (/^https?:\/\//i.test(d.url) ? window.open(d.url, '_blank', 'noopener') : openProtectedFile(d.url, d.name));
const who = (d: DocItem) => (typeof d.uploadedById === 'object' ? d.uploadedById?.name : undefined);

function DocRow({ d, onRemove }: { d: DocItem; onRemove?: () => void }) {
  return (
    <div className="doc-row">
      <div className="doc-name">
        {/^https?:\/\//i.test(d.url) ? <Link2 size={15} /> : <FileText size={15} />}
        <div style={{ minWidth: 0 }}>
          <button type="button" onClick={() => openDoc(d)} title={d.name}>{d.name}</button>
          <div className="text-muted" style={{ fontSize: 11.5 }}>
            {[d.kind && d.kind !== 'file' ? d.kind : null, who(d), d.uploadedAt ? fdatetime(d.uploadedAt) : null].filter(Boolean).join(' · ')}
            {d.note ? ` — ${d.note}` : ''}
          </div>
        </div>
      </div>
      {onRemove && <button type="button" className="icon-btn" aria-label={`Remove ${d.name}`} onClick={onRemove}><Trash2 size={15} /></button>}
    </div>
  );
}

/** Evidence of completion (files, images, links) with an optional note. Works for tasks and milestones. */
export function EvidencePanel({ baseUrl, items, canAdd, canRemove, locked, onChanged, hint }: {
  baseUrl: string; items: DocItem[]; canAdd: boolean; canRemove?: boolean; locked?: boolean; onChanged: () => void; hint?: string;
}) {
  const { showError, showSuccess } = useToast();
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');

  async function add(files: Array<{ name: string; url: string }>) {
    for (const f of files) await api.post(`${baseUrl}/evidence`, { name: f.name, url: f.url, note: note || undefined, kind: 'evidence' });
    setNote(''); showSuccess(files.length > 1 ? 'Evidence added.' : 'Evidence added.'); onChanged();
  }
  async function addLink() {
    try { await add([{ name: link.replace(/^https?:\/\//i, '').slice(0, 80), url: link.trim() }]); setLink(''); } catch (err) { showError(apiErrorMessage(err)); }
  }
  async function remove(d: DocItem) {
    try { await api.delete(`${baseUrl}/evidence/${d._id}`); onChanged(); } catch (err) { showError(apiErrorMessage(err)); }
  }

  return (
    <div>
      {items.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>{hint || 'No evidence attached yet.'}</p> : items.map((d) => <DocRow key={d._id} d={d} onRemove={canRemove && !locked ? () => remove(d) : undefined} />)}
      {canAdd && !locked && (
        <div className="stack" style={{ marginTop: 12 }}>
          <input className="input" placeholder="Note for this evidence (optional) — e.g. “Signed attendance sheet”" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row-gap">
            <FileUpload onUploaded={async (f) => { try { await add(f); } catch (err) { showError(apiErrorMessage(err)); } }} label="Attach evidence" />
            <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="…or paste a link (https://)" value={link} onChange={(e) => setLink(e.target.value)} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={!/^https?:\/\//i.test(link.trim())} onClick={addLink}>Add link</button>
          </div>
        </div>
      )}
      {locked && <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>Evidence is locked while the work is awaiting approval or complete.</p>}
    </div>
  );
}

/** General documents on a task — recordings, files, images. */
export function DocumentsPanel({ baseUrl, items, canAdd, canRemove, onChanged }: { baseUrl: string; items: DocItem[]; canAdd: boolean; canRemove: boolean; onChanged: () => void }) {
  const { showError, showSuccess } = useToast();
  async function add(files: Array<{ name: string; url: string; mimeType: string }>, kind: string) {
    try {
      for (const f of files) await api.post(`${baseUrl}/documents`, { name: f.name, url: f.url, kind: kind === 'recording' ? 'recording' : f.mimeType.startsWith('image/') ? 'image' : 'file' });
      showSuccess('Added.'); onChanged();
    } catch (err) { showError(apiErrorMessage(err)); }
  }
  async function remove(d: DocItem) {
    try { await api.delete(`${baseUrl}/documents/${d._id}`); onChanged(); } catch (err) { showError(apiErrorMessage(err)); }
  }
  return (
    <div>
      {items.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>No documents yet — add recordings, files or images.</p> : items.map((d) => <DocRow key={d._id} d={d} onRemove={canRemove ? () => remove(d) : undefined} />)}
      {canAdd && (
        <div className="row-gap" style={{ marginTop: 12 }}>
          <FileUpload onUploaded={(f) => add(f, 'file')} label="Add files or images" />
          <FileUpload kind="recording" onUploaded={(f) => add(f, 'recording')} label="Add recording" />
        </div>
      )}
    </div>
  );
}
