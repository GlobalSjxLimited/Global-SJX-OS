import { useState } from 'react';
import { CheckCircle2, ExternalLink, Megaphone, RotateCcw, Send } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/context/ToastContext';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ProtectedImage } from '@/components/ui/ProtectedImage';
import { Empty, ErrorNote, Loading, PageHead } from '@/components/ui/PageHead';
import { FileUpload } from '@/components/work/FileUpload';
import { fdatetime } from '@/lib/format';
import { POSTING_LABEL } from '@/lib/marketing';
import '@/components/marketing/marketing.css';

/** The social media manager's list: approved posts waiting to go out. Anyone can be a manager, so this needs only a sign-in. */
export function SocialQueue() {
  const { showError, showSuccess } = useToast();
  const { data, loading, error, reload } = useApi<any[]>('/social-queue');
  const [done, setDone] = useState<{ item: any; postUrl: string; note: string; proof?: { url: string; name: string } } | null>(null);
  const [back, setBack] = useState<{ item: any; note: string } | null>(null);
  const [busy, setBusy] = useState('');
  const key = (i: any) => `${i.campaignId}/${i.posting._id}`;
  const base = (i: any) => `/social-queue/${i.campaignId}/postings/${i.posting._id}`;

  async function copy(text: string) { try { await navigator.clipboard.writeText(text); showSuccess('Copied. Paste it into the platform.'); } catch { showError('Could not copy. Select the text and copy it yourself.'); } }
  async function publish(i: any) { setBusy(key(i)); try { await api.post(`${base(i)}/publish`); showSuccess('Posted.'); reload(); } catch (e) { showError(apiErrorMessage(e)); reload(); } finally { setBusy(''); } }
  async function markPosted() {
    if (!done) return; setBusy(key(done.item));
    try { await api.post(`${base(done.item)}/mark-posted`, { postUrl: done.postUrl || undefined, proof: done.proof, note: done.note || undefined }); showSuccess('Marked as posted.'); setDone(null); reload(); }
    catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(''); }
  }
  async function sendBack() {
    if (!back) return; setBusy(key(back.item));
    try { await api.post(`${base(back.item)}/return`, { note: back.note }); showSuccess('Sent back to Marketing.'); setBack(null); reload(); } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(''); }
  }

  return (
    <div className="page-enter">
      <PageHead title="Posting queue" subtitle="Approved posts waiting for you. Copy the text, post it, then mark it as posted with the link or a screenshot." />
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty icon={<Megaphone />} title="Nothing to post" hint="When Marketing hands you an approved campaign it will appear here and you will be notified." /> : (
        <div style={{ display: 'grid', gap: 14 }}>{data.map((i) => (
          <div className="card" key={key(i)} style={{ display: 'grid', gap: 10 }}>
            <div className="flex-between" style={{ gap: 10, flexWrap: 'wrap' }}>
              <div><strong>{i.campaignName}</strong> <span className="text-muted">· {i.channelLabel}{i.posting.accountLabel ? ` · ${i.posting.accountLabel}` : ''}</span></div>
              <div className="row-gap"><Badge tone={i.posting.status === 'failed' ? 'danger' : 'gold'}>{POSTING_LABEL[i.posting.status]}</Badge>
                {i.approval.stillValid ? <Badge tone="success"><CheckCircle2 size={11} /> Approved by {i.approval.decidedByName}</Badge> : <Badge tone="danger">Approval no longer valid — do not post</Badge>}</div>
            </div>
            {i.posting.scheduledFor && <div className="text-muted" style={{ fontSize: 12.5 }}>Post on or after {fdatetime(i.posting.scheduledFor)}</div>}
            {i.posting.instructions && <div className="banner">{i.posting.instructions}</div>}
            {i.posting.error && <div className="banner warn">{i.posting.error}</div>}
            <div className="mk-preview">{i.text}</div>
            {i.media.length > 0 && <div className="mk-media">{i.media.map((m: any) => <div className="mk-tile" key={m.url}><ProtectedImage url={m.url} alt={m.alt || m.name} /><div className="mk-cap">{m.kind === 'banner' ? 'Banner' : 'Image'} · {m.name}</div></div>)}</div>}
            <div className="row-gap" style={{ flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => copy(i.text)}>Copy text</button>
              {i.canPublishViaApi && i.approval.stillValid && <button className="btn btn-primary btn-sm" disabled={busy === key(i)} onClick={() => publish(i)}><Send size={13} /> {busy === key(i) ? 'Posting…' : 'Post with the app'}</button>}
              {i.approval.stillValid && <button className="btn btn-ghost btn-sm" onClick={() => setDone({ item: i, postUrl: '', note: '' })}><CheckCircle2 size={13} /> I posted it</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => setBack({ item: i, note: '' })}><RotateCcw size={13} /> Send back</button>
              {i.link && <a className="btn btn-ghost btn-sm" href={i.link} target="_blank" rel="noreferrer noopener"><ExternalLink size={13} /> Open link</a>}
            </div>
          </div>))}
        </div>
      )}

      {done && <Modal open onClose={() => setDone(null)} title="Mark as posted" footer={<><button className="btn btn-ghost" onClick={() => setDone(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy || (!done.postUrl && !done.proof)} onClick={markPosted}>Confirm</button></>}>
        <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>Give the link to the live post, or attach a screenshot as proof. One of them is needed.</p>
        <div className="field"><label>Link to the post</label><input className="input" value={done.postUrl} onChange={(e) => setDone({ ...done, postUrl: e.target.value })} placeholder="https://…" /></div>
        <div className="field"><label>Screenshot (proof)</label>{done.proof ? <div style={{ fontSize: 13 }}>{done.proof.name} <button className="btn btn-ghost btn-sm" onClick={() => setDone({ ...done, proof: undefined })}>Remove</button></div> : <FileUpload kind="document" multiple={false} accept="image/*,.pdf" label="Attach screenshot" onUploaded={(f) => f[0] && setDone((d) => d && { ...d, proof: { url: f[0].url, name: f[0].name } })} />}</div>
        <div className="field"><label>Note (optional)</label><input className="input" value={done.note} onChange={(e) => setDone({ ...done, note: e.target.value })} maxLength={1000} /></div>
      </Modal>}
      {back && <Modal open onClose={() => setBack(null)} title="Send back to Marketing" footer={<><button className="btn btn-ghost" onClick={() => setBack(null)}>Cancel</button><button className="btn btn-primary" disabled={!!busy || back.note.trim().length < 3} onClick={sendBack}>Send back</button></>}>
        <div className="field"><label>Why can’t you post it? *</label><textarea className="input" rows={3} value={back.note} onChange={(e) => setBack({ ...back, note: e.target.value })} /></div></Modal>}
    </div>
  );
}
