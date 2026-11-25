import { useMemo, useState } from 'react';
import { BellRing, CornerDownRight, Eye, Pencil, SmilePlus, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { fdatetime } from '@/lib/format';
import { MentionText, MentionTextarea } from '@/components/ui/MentionTextarea';
import { Loading } from '@/components/ui/PageHead';
import { PeoplePicker } from '@/components/work/PeoplePicker';
import { FileUpload } from '@/components/work/FileUpload';
import { STATUS_LABEL } from '@/lib/taskStatus';
import './discussion.css';

export type EntityType = 'task' | 'project' | 'milestone' | 'client' | 'opportunity' | 'vendor' | 'campaign' | 'lead' | 'expense' | 'invoice' | 'contract' | 'sponsor' | 'risk' | 'goal' | 'ticket' | 'asset' | 'incident' | 'document' | 'post';
const REACTIONS = ['👍', '❤️', '🎉', '👀', '✅', '❓'];
const initials = (n?: string) => (n || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

interface Node { c: any; kids: Node[] }

/**
 * Notes and conversation for any record. Reply, react, edit and delete your own comments, tag people (they are told),
 * tag people for awareness (they are added as followers), and choose who hears about it: just the people you tag, or everyone involved.
 */
export function Discussion({ entityType, entityId, scopeId, title = 'Comments', onChanged, placeholder = 'Write a comment… type @ to tag someone' }: {
  entityType: EntityType; entityId: string; scopeId?: string; title?: string; onChanged?: () => void; placeholder?: string;
}) {
  const url = `/discussions/${entityType}/${entityId}`;
  const { data, loading, error, reload } = useApi<any[]>(url, scopeId ? { scopeId } : undefined);
  const tree = useMemo(() => {
    const nodes = new Map<string, Node>((data || []).map((c) => [c._id, { c, kids: [] }]));
    const roots: Node[] = [];
    nodes.forEach((n) => { const p = n.c.parentId && nodes.get(n.c.parentId); if (p) p.kids.push(n); else roots.push(n); });
    return roots;
  }, [data]);
  const total = (data || []).filter((c) => !c.deleted).length;
  const refresh = () => { reload(); onChanged?.(); };

  return (
    <section className="disc" aria-label={title}>
      <div className="disc-head"><h3>{title}</h3><span className="text-muted">{total} {total === 1 ? 'comment' : 'comments'}</span></div>
      <Composer url={url} scopeId={scopeId} placeholder={placeholder} onPosted={refresh} />
      {loading && !data ? <Loading rows={2} /> : error ? <div className="text-muted" style={{ fontSize: 13 }}>{error}</div> : tree.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13, margin: '12px 0 0' }}>No comments yet. Start the conversation.</p>
      ) : (
        <ul className="disc-list">{tree.map((n) => <Thread key={n.c._id} node={n} depth={0} url={url} scopeId={scopeId} onChanged={refresh} />)}</ul>
      )}
    </section>
  );
}

function Composer({ url, scopeId, parentId, placeholder, onPosted, onCancel, autoFocus }: { url: string; scopeId?: string; parentId?: string; placeholder?: string; onPosted: () => void; onCancel?: () => void; autoFocus?: boolean }) {
  const { showError } = useToast();
  const [body, setBody] = useState('');
  const [notify, setNotify] = useState<'mentioned' | 'all' | 'none'>('mentioned');
  const [aware, setAware] = useState<string[]>([]);
  const [showAware, setShowAware] = useState(false);
  const [files, setFiles] = useState<Array<{ name: string; url: string }>>([]);
  const [busy, setBusy] = useState(false);
  async function post() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post(url, { body, parentId, notify, awareness: aware, scopeId, attachments: files.length ? files : undefined });
      setBody(''); setAware([]); setFiles([]); setShowAware(false); onPosted(); onCancel?.();
    } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <div className={`disc-composer${parentId ? ' reply' : ''}`}>
      <div onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') post(); }}>
        <MentionTextarea value={body} onChange={setBody} rows={parentId ? 2 : 3} placeholder={placeholder} />
      </div>
      {showAware && (
        <div className="disc-aware"><label>Tag for awareness: they are told and can follow this, but nothing is asked of them</label>
          <PeoplePicker value={aware} onChange={setAware} placeholder="Search people…" /></div>
      )}
      {files.length > 0 && <div className="disc-files">{files.map((f, i) => <span key={i} className="chip active">{f.name}<button type="button" aria-label="Remove file" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></span>)}</div>}
      <div className="disc-actions">
        <label className="disc-notify" title="Who is told about this comment">
          <BellRing size={13} />
          <select aria-label="Who to notify" value={notify} onChange={(e) => setNotify(e.target.value as any)}>
            <option value="mentioned">Notify people I tag</option>
            <option value="all">Notify everyone involved</option>
            <option value="none">Don’t notify anyone</option>
          </select>
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAware(!showAware)}><Eye size={13} /> Tag for awareness{aware.length ? ` (${aware.length})` : ''}</button>
        <FileUpload multiple small label="Attach" onUploaded={(u) => setFiles((x) => [...x, ...u.map((f) => ({ name: f.name, url: f.url }))])} />
        <span style={{ flex: 1 }} />
        {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !body.trim()} onClick={post}>{parentId ? 'Reply' : 'Comment'}</button>
      </div>
    </div>
  );
}

function Thread({ node, depth, url, scopeId, onChanged }: { node: Node; depth: number; url: string; scopeId?: string; onChanged: () => void }) {
  const { c } = node;
  const { user } = useAuth();
  const { showError } = useToast();
  const confirm = useConfirm();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body || '');
  const [picker, setPicker] = useState(false);
  const mine = String(c.authorId?._id || c.authorId) === user?.id;

  async function react(emoji: string) { setPicker(false); try { await api.post(`/discussions/comment/${c._id}/react`, { emoji }); onChanged(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function save() { try { await api.patch(`/discussions/comment/${c._id}`, { body: draft }); setEditing(false); onChanged(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function remove() {
    if (!(await confirm({ title: 'Delete comment', message: 'Delete this comment? Replies to it stay.', confirmLabel: 'Delete', danger: true }))) return;
    try { await api.delete(`/discussions/comment/${c._id}`); onChanged(); } catch (e) { showError(apiErrorMessage(e)); }
  }

  return (
    <li className={`disc-item${c.kind !== 'comment' ? ` ${c.kind}` : ''}`}>
      <div className="disc-avatar" aria-hidden>{c.kind === 'system' ? '·' : initials(c.authorName)}</div>
      <div className="disc-main">
        <div className="disc-meta">
          <strong>{c.kind === 'system' ? 'System' : c.authorName || 'Someone'}</strong>
          {c.kind === 'status' && c.status?.to && <span className="disc-status">{c.status.from && c.status.from !== c.status.to ? `${STATUS_LABEL[c.status.from] || c.status.from} → ` : ''}<b>{STATUS_LABEL[c.status.to] || c.status.to}</b>{typeof c.status.percent === 'number' && c.status.to === 'in_progress' ? ` · ${c.status.percent}%` : ''}</span>}
          <span className="text-muted" title={c.from ? `${c.from.device || ''} ${c.from.ip ? `(${c.from.ip})` : ''}` : undefined}>{fdatetime(c.createdAt)}</span>
          {c.editedAt && <span className="text-muted" title={`Edited ${fdatetime(c.editedAt)}${c.editedByName ? ` by ${c.editedByName}` : ''}`}>edited</span>}
        </div>
        {c.deleted ? <p className="disc-deleted">This comment was deleted.</p> : editing ? (
          <div className="disc-edit">
            <MentionTextarea value={draft} onChange={setDraft} rows={3} />
            <div className="disc-actions"><span style={{ flex: 1 }} /><button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setDraft(c.body); }}>Cancel</button><button className="btn btn-primary btn-sm" disabled={!draft.trim()} onClick={save}>Save</button></div>
          </div>
        ) : (
          <>
            <p className="disc-body"><MentionText text={c.body} /></p>
            {c.attachments?.length > 0 && <div className="disc-files">{c.attachments.map((a: any, i: number) => <a key={i} className="chip" href={a.url} target="_blank" rel="noreferrer noopener">{a.name}</a>)}</div>}
            <div className="disc-react">
              {Object.entries(c.reactions || {}).map(([emoji, r]: any) => (
                <button key={emoji} type="button" className={`disc-chip${r.mine ? ' mine' : ''}`} title={r.names?.join(', ')} onClick={() => react(emoji)}>{emoji} {r.count}</button>
              ))}
              <span className="disc-pick">
                <button type="button" className="disc-link" aria-label="Add reaction" onClick={() => setPicker(!picker)}><SmilePlus size={14} /></button>
                {picker && <span className="disc-emoji">{REACTIONS.map((e) => <button key={e} type="button" onClick={() => react(e)}>{e}</button>)}</span>}
              </span>
              {c.kind !== 'system' && <button type="button" className="disc-link" onClick={() => setReplying(!replying)}><CornerDownRight size={13} /> Reply</button>}
              {c.canEdit && <button type="button" className="disc-link" onClick={() => { setDraft(c.body); setEditing(true); }}><Pencil size={13} /> Edit</button>}
              {c.canDelete && <button type="button" className="disc-link danger" onClick={remove}><Trash2 size={13} /> Delete</button>}
            </div>
          </>
        )}
        {replying && <Composer url={url} scopeId={scopeId} parentId={c._id} placeholder={`Reply to ${c.authorName || 'comment'}…`} autoFocus onPosted={onChanged} onCancel={() => setReplying(false)} />}
        {node.kids.length > 0 && <ul className="disc-list nested">{node.kids.map((k) => <Thread key={k.c._id} node={k} depth={depth + 1} url={url} scopeId={scopeId} onChanged={onChanged} />)}</ul>}
      </div>
    </li>
  );
}
