import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ThumbsUp, Plus, LinkIcon, Paperclip, X, Image as ImageIcon } from 'lucide-react';
import { RichTextEditor, RichTextRenderer } from '@/components/ui/RichText';
import { api, apiErrorMessage } from '@/lib/api';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Feedback';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { MentionTextarea, MentionText } from '@/components/ui/MentionTextarea';

const STAGES = ['Submitted', 'Under Review', 'Approved', 'Prototype', 'Pilot', 'Launched', 'Rejected', 'Archived'];

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;

export function IdeaDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [idea, setIdea] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');

  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [addingLink, setAddingLink] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get(`/ideas/${id}`);
      setIdea(res.data.data);
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function vote() {
    await api.post(`/ideas/${id}/vote`);
    load();
  }

  async function changeStage(stage: string) {
    await api.patch(`/ideas/${id}`, { stage });
    load();
  }

  async function addComment() {
    if (!comment.trim()) return;
    await api.post(`/ideas/${id}/comments`, { body: comment });
    setComment('');
    load();
  }

  async function addLink() {
    if (!linkUrl.trim()) return;
    setAddingLink(true);
    try {
      await api.post(`/ideas/${id}/links`, { label: linkLabel || linkUrl, url: linkUrl });
      setLinkLabel('');
      setLinkUrl('');
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setAddingLink(false);
    }
  }

  async function removeLink(linkId: string) {
    await api.delete(`/ideas/${id}/links/${linkId}`);
    load();
  }

  async function handleAttachmentFile(file: File) {
    setUploadingAttachment(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await api.post('/uploads', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      await api.post(`/ideas/${id}/attachments`, { name: res.data.data.originalName, url: res.data.data.url, mimeType: res.data.data.mimeType });
      showSuccess('Attachment added.');
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function removeAttachment(attachmentId: string) {
    await api.delete(`/ideas/${id}/attachments/${attachmentId}`);
    load();
  }

  if (loading || !idea) return <Skeleton height={400} />;

  const hasVoted = idea.votes.includes(user?.id);
  const images = (idea.attachments || []).filter((a: any) => IMAGE_EXT.test(a.name));
  const files = (idea.attachments || []).filter((a: any) => !IMAGE_EXT.test(a.name));

  return (
    <div>
      <div className="page-head">
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
            <Badge tone={statusTone(idea.stage)}>{idea.stage}</Badge>
            {idea.aiScore && <Badge tone="gold">AI score {idea.aiScore.overall}/10</Badge>}
          </div>
          <h1>{idea.title}</h1>
          <p>Submitted by {idea.submittedById?.name} · {new Date(idea.createdAt).toLocaleDateString()}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-ghost" onClick={vote} style={{ color: hasVoted ? 'var(--accent)' : undefined, borderColor: hasVoted ? 'var(--accent)' : undefined }}>
            <ThumbsUp size={15} /> {idea.votes.length}
          </button>
          <select className="input" style={{ width: 'auto' }} value={idea.stage} onChange={(e) => changeStage(e.target.value)}>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="grid-2">
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div className="card">
            <h4 style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 8 }}>Problem</h4>
            <div style={{ marginBottom: 18 }}><RichTextRenderer content={idea.problem} /></div>
            <h4 style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 8 }}>Proposed solution</h4>
            <div style={{ marginBottom: 18 }}><RichTextRenderer content={idea.proposedSolution} /></div>
            {idea.targetCustomer && (<><h4 style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 8 }}>Target customer</h4><p style={{ fontSize: 14, marginBottom: 18 }}>{idea.targetCustomer}</p></>)}
            {idea.businessValue && (<><h4 style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 8 }}>Business value</h4><p style={{ fontSize: 14, marginBottom: 18 }}>{idea.businessValue}</p></>)}
            {idea.strategicAlignment && (<><h4 style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 8 }}>Strategic alignment</h4><RichTextRenderer content={idea.strategicAlignment} /></>)}
          </div>

          {images.length > 0 && (
            <div className="card">
              <h4 style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}><ImageIcon size={14} /> Images</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
                {images.map((a: any) => (
                  <div key={a._id} style={{ position: 'relative' }}>
                    <a href={a.url} target="_blank" rel="noopener noreferrer">
                      <img src={a.url} alt={a.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }} />
                    </a>
                    <button className="icon-btn" style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24 }} onClick={() => removeAttachment(a._id)} aria-label="Remove"><X size={11} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <h4 style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 12 }}>Comments</h4>
            <div style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
              {idea.comments?.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>No comments yet.</p>}
              {idea.comments?.map((c: any) => (
                <div key={c._id} style={{ fontSize: 13, borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
                  <strong>{c.authorId?.name}</strong>
                  <p style={{ marginTop: 4, color: 'var(--muted)' }}><MentionText text={c.body} /></p>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <MentionTextarea value={comment} onChange={setComment} placeholder="Add a comment or insight… type @ to tag someone" rows={2} />
              </div>
              <button className="btn btn-primary btn-sm" onClick={addComment}>Post</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          {idea.aiScore && (
            <div className="card">
              <h4 style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 14 }}>AI assessment</h4>
              <div style={{ display: 'grid', gap: 10 }}>
                {[
                  ['Strategic fit', idea.aiScore.strategicFit],
                  ['Market potential', idea.aiScore.marketPotential],
                  ['Revenue potential', idea.aiScore.revenuePotential],
                  ['Complexity', idea.aiScore.complexity],
                ].map(([label, val]: any) => (
                  <div key={label}>
                    <div className="flex-between" style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: 12.5 }}>{label}</span>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{val}/10</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 10, background: 'var(--surface-3)' }}>
                      <div style={{ height: '100%', width: `${(val / 10) * 100}%`, background: 'var(--gold)', borderRadius: 10 }} />
                    </div>
                  </div>
                ))}
                <div className="flex-between" style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 4 }}>
                  <span>Investment band</span>
                  <Badge tone="neutral">{idea.aiScore.estimatedInvestmentBand}</Badge>
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <h4 style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 10 }}>Business case</h4>
            <div style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
              <div className="flex-between"><span>Estimated cost</span><strong>₦{(idea.estimatedCost || 0).toLocaleString()}</strong></div>
              <div className="flex-between"><span>Expected revenue</span><strong>₦{(idea.expectedRevenue || 0).toLocaleString()}</strong></div>
              {idea.resourcesNeeded && <div><span style={{ color: 'var(--muted)' }}>Resources needed:</span><p style={{ marginTop: 4 }}>{idea.resourcesNeeded}</p></div>}
            </div>
          </div>

          <div className="card">
            <h4 style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}><LinkIcon size={14} /> Links</h4>
            <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
              {(idea.links || []).length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>No links added yet.</p>}
              {(idea.links || []).map((l: any) => (
                <div key={l._id} className="flex-between">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--accent)' }}>{l.label}</a>
                  <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => removeLink(l._id)} aria-label="Remove"><X size={12} /></button>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <input className="input" placeholder="Label (optional)" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
                <button className="btn btn-primary btn-sm" onClick={addLink} disabled={addingLink || !linkUrl.trim()}><Plus size={13} /></button>
              </div>
            </div>
          </div>

          <div className="card">
            <h4 style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}><Paperclip size={14} /> Attachments</h4>
            <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
              {files.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>No files attached yet.</p>}
              {files.map((a: any) => (
                <div key={a._id} className="flex-between">
                  <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--accent)' }}>{a.name}</a>
                  <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => removeAttachment(a._id)} aria-label="Remove"><X size={12} /></button>
                </div>
              ))}
            </div>
            <input type="file" onChange={(e) => e.target.files?.[0] && handleAttachmentFile(e.target.files[0])} disabled={uploadingAttachment} style={{ fontSize: 12.5 }} />
            {uploadingAttachment && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Uploading…</div>}
          </div>

          <Link to="/ideas" className="btn btn-ghost" style={{ justifyContent: 'center' }}>Back to Idea Room</Link>
        </div>
      </div>
    </div>
  );
}
