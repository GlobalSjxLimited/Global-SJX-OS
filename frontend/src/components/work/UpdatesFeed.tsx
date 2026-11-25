import { useState } from 'react';
import { AlertOctagon, MessageSquare, Paperclip, Send } from 'lucide-react';
import { api, apiErrorMessage, openProtectedFile } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { fdatetime, label } from '@/lib/format';
import { FileUpload } from './FileUpload';
import './work.css';

export interface FeedItem { _id: string; body: string; kind?: string; createdAt?: string; at?: string; authorId?: { name?: string } | string; requestedFromId?: { name?: string } | string; attachments?: Array<{ name: string; url: string }> }

const nameOf = (v: any) => (v && typeof v === 'object' ? v.name : undefined);
const KIND: Record<string, string> = { update: 'Update', update_request: 'Update requested', blocker: 'Blocker', completion: 'Completion', comment: 'Comment' };

/** Latest updates + comments on a task or milestone, with a box to post a new one. */
export function UpdatesFeed({ baseUrl, items, canUpdate, canComment = true, onChanged, supportsComment = true, openRequestFor, commentPath = '/comments', allowAttach = true }: {
  baseUrl: string; items: FeedItem[]; canUpdate: boolean; canComment?: boolean; onChanged: () => void; supportsComment?: boolean; openRequestFor?: string[]; commentPath?: string; allowAttach?: boolean;
}) {
  const { showError, showSuccess } = useToast();
  const [body, setBody] = useState('');
  const [blocker, setBlocker] = useState(false);
  const [files, setFiles] = useState<Array<{ name: string; url: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'update' | 'comment'>(canUpdate ? 'update' : 'comment');

  async function post() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const payload: any = { body: body.trim(), attachments: files.length ? files : undefined };
      if (mode === 'update') { payload.blocker = blocker; payload.kind = blocker ? 'blocker' : 'update'; await api.post(`${baseUrl}/updates`, payload); }
      else { payload.kind = 'comment'; await api.post(`${baseUrl}${commentPath}`, payload); }
      setBody(''); setBlocker(false); setFiles([]); showSuccess('Posted.'); onChanged();
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); }
  }

  const sorted = [...items].sort((a, b) => +new Date(b.createdAt || b.at || 0) - +new Date(a.createdAt || a.at || 0));
  return (
    <div>
      {openRequestFor && openRequestFor.length > 0 && (
        <div className="callout warn" style={{ marginBottom: 12 }}>Waiting on an update from <strong>{openRequestFor.join(', ')}</strong>.</div>
      )}
      {(canUpdate || (canComment && supportsComment)) && (
        <div className="stack" style={{ marginBottom: 16 }}>
          {canUpdate && canComment && supportsComment && (
            <div className="seg">
              <button type="button" className={mode === 'update' ? 'on' : ''} onClick={() => setMode('update')}>Progress update</button>
              <button type="button" className={mode === 'comment' ? 'on' : ''} onClick={() => setMode('comment')}>Comment</button>
            </div>
          )}
          <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={mode === 'update' ? 'What has been done, what is next, anything in the way?' : 'Write a comment…'} />
          <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="row-gap">
              {allowAttach && <FileUpload onUploaded={(f) => setFiles((x) => [...x, ...f.map((u) => ({ name: u.name, url: u.url }))])} label={files.length ? `${files.length} attached` : 'Attach'} />}
              {mode === 'update' && <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={blocker} onChange={(e) => setBlocker(e.target.checked)} /> Flag as blocker</label>}
            </div>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !body.trim()} onClick={post}><Send size={14} /> Post</button>
          </div>
        </div>
      )}
      {sorted.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>Nothing posted yet.</p> : (
        <div className="feed">
          {sorted.map((c) => (
            <div key={c._id} className={`feed-item kind-${c.kind || 'comment'}`}>
              <div className="feed-meta">
                {c.kind === 'blocker' ? <AlertOctagon size={14} color="#e5484d" /> : <MessageSquare size={14} />}
                <strong>{nameOf(c.authorId) || 'Someone'}</strong>
                <span>{KIND[c.kind || 'comment'] || label(c.kind)}</span>
                {c.kind === 'update_request' && nameOf(c.requestedFromId) && <span>→ {nameOf(c.requestedFromId)}</span>}
                <span>{fdatetime(c.createdAt || c.at)}</span>
              </div>
              <div className="feed-body">{c.body}</div>
              {c.attachments && c.attachments.length > 0 && (
                <div className="row-gap" style={{ marginTop: 8 }}>
                  {c.attachments.map((a) => <AttachmentChip key={a.url} a={a} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentChip({ a }: { a: { name: string; url: string } }) {
  return <button type="button" className="chip" onClick={() => (/^https?:\/\//i.test(a.url) ? window.open(a.url, '_blank', 'noopener') : openProtectedFile(a.url, a.name))}><Paperclip size={12} /> {a.name}</button>;
}
