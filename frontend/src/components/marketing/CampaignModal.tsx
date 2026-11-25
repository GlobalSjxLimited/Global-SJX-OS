import { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { Loading, Tabs } from '@/components/ui/PageHead';
import { Badge } from '@/components/ui/Badge';
import { TagInput } from '@/components/ui/TagInput';
import { AuditStamp } from '@/components/ui/AuditStamp';
import { ProtectedImage } from '@/components/ui/ProtectedImage';
import { FileUpload } from '@/components/work/FileUpload';
import { PeoplePicker } from '@/components/work/PeoplePicker';
import { Discussion } from '@/components/discussion/Discussion';
import { RecordDocuments } from '@/components/record/RecordDocuments';
import { toInputDate } from '@/lib/format';
import { APPROVAL_LABEL, APPROVAL_TONE, CHANNELS, GOAL_KINDS, GOAL_META, MAX_MEDIA, channelLabel, composeText } from '@/lib/marketing';
import { CampaignApproval } from './CampaignApproval';
import './marketing.css';

interface Media { url: string; name?: string; size?: number; kind: 'image' | 'banner'; alt?: string }
interface Form {
  name: string; type: string; ownerId: string[]; socialManagerId: string[]; approverId: string[]; startDate: string; endDate: string; budget: string; currency: string;
  objective: string; audience: string; goal: { kind: string; target: string; description: string };
  channels: string[]; content: { headline: string; body: string; callToAction: string; linkUrl: string; hashtags: string[] }; media: Media[];
}
const blank = (me?: string): Form => ({ name: '', type: 'social', ownerId: me ? [me] : [], socialManagerId: [], approverId: [], startDate: '', endDate: '', budget: '', currency: 'NGN', objective: '', audience: '', goal: { kind: 'traffic', target: '', description: '' }, channels: [], content: { headline: '', body: '', callToAction: '', linkUrl: '', hashtags: [] }, media: [] });
const idOf = (v: any) => (v && typeof v === 'object' ? v._id : v) || '';
const fromCampaign = (c: any): Form => ({
  name: c.name || '', type: c.type || 'social', ownerId: idOf(c.ownerId) ? [idOf(c.ownerId)] : [], socialManagerId: idOf(c.socialManagerId) ? [idOf(c.socialManagerId)] : [], approverId: idOf(c.approverId) ? [idOf(c.approverId)] : [],
  startDate: c.startDate ? toInputDate(c.startDate) : '', endDate: c.endDate ? toInputDate(c.endDate) : '', budget: c.budget ? String(c.budget) : '', currency: c.currency || 'NGN', objective: c.objective || '', audience: c.audience || '',
  goal: { kind: c.goal?.kind || 'awareness', target: c.goal?.target ? String(c.goal.target) : '', description: c.goal?.description || '' },
  channels: c.channels || [], content: { headline: c.content?.headline || '', body: c.content?.body || '', callToAction: c.content?.callToAction || '', linkUrl: c.content?.linkUrl || '', hashtags: c.content?.hashtags || [] },
  media: (c.media || []).map((m: any) => ({ url: m.url, name: m.name, size: m.size, kind: m.kind || 'image', alt: m.alt })),
});

/** Everything about one campaign: what it is for, the post and its pictures, approval and posting, results, and the conversation. */
export function CampaignModal({ id: startId, onClose, onChanged, me }: { id: string | null; onClose: () => void; onChanged: () => void; me?: string }) {
  const { showError, showSuccess } = useToast();
  const [id, setId] = useState<string | null>(startId);
  const [camp, setCamp] = useState<any>(null);
  const [form, setForm] = useState<Form>(blank(me));
  const [loading, setLoading] = useState(!!startId);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(startId ? 'approval' : 'details');
  const [preview, setPreview] = useState('');
  const [dirty, setDirty] = useState(false);

  async function load(keepForm = false) {
    if (!id) return;
    try { const r = await api.get(`/campaigns/${id}`); setCamp(r.data.data); if (!keepForm) { setForm(fromCampaign(r.data.data)); setDirty(false); } } catch (e) { showError(apiErrorMessage(e)); } finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); /* eslint-disable-next-line */ }, [id]);

  const set = (patch: Partial<Form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const setContent = (patch: Partial<Form['content']>) => set({ content: { ...form.content, ...patch } });
  const setGoal = (patch: Partial<Form['goal']>) => set({ goal: { ...form.goal, ...patch } });

  const payload = () => ({
    name: form.name.trim(), type: form.type, ownerId: form.ownerId[0] || undefined, socialManagerId: form.socialManagerId[0] || null, approverId: form.approverId[0] || null,
    startDate: form.startDate || null, endDate: form.endDate || null, budget: Number(form.budget) || 0, currency: form.currency, objective: form.objective, audience: form.audience,
    goal: { kind: form.goal.kind, target: Number(form.goal.target) || 0, description: form.goal.description },
    channels: form.channels, content: { ...form.content, hashtags: form.content.hashtags }, media: form.media,
  });

  async function save(): Promise<boolean> {
    if (form.name.trim().length < 2) { showError('Give the campaign a name.'); setTab('details'); return false; }
    setBusy(true);
    try {
      if (id) {
        const r = await api.patch(`/campaigns/${id}`, payload());
        showSuccess(r.data.approvalReset ? 'Saved. The content changed, so it needs approving again.' : 'Saved.');
        await load(); onChanged();
      } else {
        const r = await api.post('/campaigns', payload());
        setId(r.data.data._id); setCamp(r.data.data); setDirty(false); showSuccess('Campaign created. Now write the post and add pictures.'); setTab('content'); onChanged();
      }
      return true;
    } catch (e) { showError(apiErrorMessage(e)); return false; } finally { setBusy(false); }
  }

  const specs = CHANNELS.filter((c) => form.channels.includes(c.key));
  const active = preview && form.channels.includes(preview) ? preview : form.channels[0] || '';
  const spec = specs.find((s) => s.key === active);
  const text = useMemo(() => composeText(form.content, active), [form.content, active]);
  const problems = useMemo(() => {
    const out: string[] = [];
    for (const s of specs) {
      const t = composeText(form.content, s.key);
      if (t.length > s.maxChars) out.push(`${s.label}: ${t.length} characters, limit ${s.maxChars}.`);
      if (s.needsImage && form.media.length === 0) out.push(`${s.label}: needs at least one image.`);
      if (form.media.length > s.maxImages) out.push(`${s.label}: at most ${s.maxImages} images.`);
      if (s.maxHashtags && form.content.hashtags.length > s.maxHashtags) out.push(`${s.label}: at most ${s.maxHashtags} hashtags.`);
    }
    return out;
  }, [form, specs]);

  const status = camp?.approval?.status || 'draft';
  const locked = status === 'pending';

  return (
    <Modal open onClose={onClose} size="xwide" title={camp?.name || form.name || 'New campaign'}
      footer={<>
        {dirty && <span className="text-muted" style={{ fontSize: 12.5, marginRight: 'auto' }}>You have unsaved changes{status === 'approved' || status === 'pending' ? ' — saving changed content resets the approval' : ''}.</span>}
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
        {['details', 'content'].includes(tab) && <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : id ? 'Save changes' : 'Create campaign'}</button>}
      </>}>
      {loading ? <Loading /> : (
        <div style={{ display: 'grid', gap: 14 }}>
          {camp && <div className="row-gap" style={{ flexWrap: 'wrap' }}>
            <Badge tone={APPROVAL_TONE[status]}>{APPROVAL_LABEL[status]}</Badge>
            <Badge tone="neutral">{camp.status}</Badge>
            {camp.status === 'live' && status === 'draft' && !(camp.postings || []).length && <span className="text-muted" style={{ fontSize: 12 }}>Started before approvals existed</span>}
            <AuditStamp doc={camp} />
          </div>}
          <Tabs value={tab} onChange={setTab} tabs={[
            { key: 'details', label: 'Details' }, { key: 'content', label: 'Post & pictures', count: form.media.length || undefined },
            ...(id ? [{ key: 'approval', label: 'Approval & posting' }, { key: 'results', label: 'Results' }, { key: 'comments', label: 'Comments' }, { key: 'documents', label: 'Documents' }] : []),
          ]} />

          {tab === 'details' && (
            <div className="form-grid">
              <div className="field full"><label>Campaign name *</label><input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} placeholder="e.g. Hire 3 security engineers — Q1" /></div>
              <div className="field"><label>What is it for? *</label>
                <select className="input" value={form.goal.kind} onChange={(e) => setGoal({ kind: e.target.value })}>{GOAL_KINDS.map((k) => <option key={k} value={k}>{GOAL_META[k].label}</option>)}</select>
                <span className="text-muted" style={{ fontSize: 12 }}>{GOAL_META[form.goal.kind]?.help}</span></div>
              <div className="field"><label>Target ({GOAL_META[form.goal.kind]?.unit}){form.goal.kind !== 'awareness' ? ' *' : ''}</label><input className="input" type="number" min={0} value={form.goal.target} onChange={(e) => setGoal({ target: e.target.value })} /></div>
              <div className="field full"><label>How will you measure it?</label><input className="input" value={form.goal.description} onChange={(e) => setGoal({ description: e.target.value })} maxLength={500} placeholder="e.g. Applications received through the careers page" /></div>
              <div className="field full"><label>Objective — why are we doing this?</label><textarea className="input" rows={2} value={form.objective} onChange={(e) => set({ objective: e.target.value })} maxLength={2000} /></div>
              <div className="field"><label>Audience</label><input className="input" value={form.audience} onChange={(e) => set({ audience: e.target.value })} maxLength={500} placeholder="Who should see it" /></div>
              <div className="field"><label>Type</label><select className="input" value={form.type} onChange={(e) => set({ type: e.target.value })}>{['social', 'content', 'event', 'newsletter', 'article', 'paid'].map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
              <div className="field"><label>Start date</label><input className="input" type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} /></div>
              <div className="field"><label>End date</label><input className="input" type="date" value={form.endDate} min={form.startDate || undefined} onChange={(e) => set({ endDate: e.target.value })} /></div>
              <div className="field"><label>Budget</label><input className="input" type="number" min={0} value={form.budget} onChange={(e) => set({ budget: e.target.value })} /></div>
              <div className="field"><label>Currency</label><select className="input" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>{['NGN', 'USD', 'GBP', 'EUR'].map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="field"><label>Campaign owner</label><PeoplePicker single value={form.ownerId} onChange={(v) => set({ ownerId: v })} /></div>
              <div className="field"><label>Social media manager</label><PeoplePicker single value={form.socialManagerId} onChange={(v) => set({ socialManagerId: v })} placeholder="Who posts it once approved" /></div>
              <div className="field full"><label>Approver (optional)</label><PeoplePicker single value={form.approverId} onChange={(v) => set({ approverId: v })} placeholder="Leave empty: the CEO, COO or head of Marketing approves" />
                <span className="text-muted" style={{ fontSize: 12 }}>Nothing is posted until someone other than the author has approved it and attached evidence.</span></div>
            </div>
          )}

          {tab === 'content' && (
            <div className="two-col" style={{ alignItems: 'start' }}>
              <div style={{ display: 'grid', gap: 14 }}>
                {locked && <div className="banner warn">This is waiting for approval. Changing the content will take it back to draft.</div>}
                {status === 'approved' && <div className="banner warn">This is approved. Changing the post, pictures or channels will reset the approval, and anything not yet posted is cancelled.</div>}
                <div className="field"><label>Where will it be posted? *</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{CHANNELS.map((c) => { const on = form.channels.includes(c.key); return (
                    <button key={c.key} type="button" className={`chip ${on ? 'active' : ''}`} aria-pressed={on} onClick={() => set({ channels: on ? form.channels.filter((x) => x !== c.key) : [...form.channels, c.key] })}>{c.label}</button>); })}</div>
                  <span className="text-muted" style={{ fontSize: 12 }}>Facebook, Instagram and LinkedIn can be posted by the app once an account is connected. The rest are posted by hand by the social media manager.</span></div>
                <div className="field"><label>Headline</label><input className="input" value={form.content.headline} onChange={(e) => setContent({ headline: e.target.value })} maxLength={300} /></div>
                <div className="field"><label>Post text *</label><textarea className="input" rows={7} value={form.content.body} onChange={(e) => setContent({ body: e.target.value })} maxLength={20000} /></div>
                <div className="form-grid">
                  <div className="field"><label>Call to action</label><input className="input" value={form.content.callToAction} onChange={(e) => setContent({ callToAction: e.target.value })} maxLength={200} placeholder="Apply today" /></div>
                  <div className="field"><label>Link</label><input className="input" value={form.content.linkUrl} onChange={(e) => setContent({ linkUrl: e.target.value })} maxLength={500} placeholder="https://…" /></div>
                </div>
                <div className="field"><label>Hashtags</label><TagInput value={form.content.hashtags} onChange={(v) => setContent({ hashtags: v })} placeholder="Type and press Enter" /></div>

                <div className="field"><label>Pictures and banners ({form.media.length}/{MAX_MEDIA})</label>
                  <div className="mk-media">
                    {form.media.map((m, i) => (
                      <div className="mk-tile" key={m.url}>
                        <ProtectedImage url={m.url} alt={m.alt || m.name} />
                        <button type="button" className="btn btn-ghost btn-sm mk-x" aria-label={`Remove ${m.name || 'picture'}`} onClick={() => set({ media: form.media.filter((_, k) => k !== i) })}><X size={13} /></button>
                        <div className="mk-cap"><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || 'Picture'}</span>
                          <select className="input" style={{ padding: '2px 6px', fontSize: 12 }} value={m.kind} onChange={(e) => set({ media: form.media.map((x, k) => (k === i ? { ...x, kind: e.target.value as any } : x)) })}><option value="image">Image</option><option value="banner">Banner</option></select>
                          <input className="input" style={{ padding: '2px 6px', fontSize: 12 }} placeholder="Describe it (alt text)" value={m.alt || ''} maxLength={300} onChange={(e) => set({ media: form.media.map((x, k) => (k === i ? { ...x, alt: e.target.value } : x)) })} /></div>
                      </div>))}
                    {form.media.length < MAX_MEDIA && <div className="mk-tile" style={{ display: 'grid', placeItems: 'center', minHeight: 140, borderStyle: 'dashed' }}>
                      <div style={{ textAlign: 'center', padding: 10 }}><ImageIcon size={22} style={{ opacity: .5 }} />
                        <div><FileUpload kind="document" accept="image/png,image/jpeg,image/webp" label="Add pictures" onUploaded={(files) => set({ media: [...form.media, ...files.map((f) => ({ url: f.url, name: f.name, size: f.size, kind: 'image' as const }))].slice(0, MAX_MEDIA) })} /></div>
                        <div className="text-muted" style={{ fontSize: 11 }}>PNG, JPEG or WebP, up to 10 MB each. Select several at once.</div></div></div>}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 10, position: 'sticky', top: 0 }}>
                <strong style={{ fontSize: 13 }}>Preview</strong>
                {specs.length === 0 ? <p className="text-muted" style={{ fontSize: 13 }}>Choose a channel to see how the post will look and whether it fits.</p> : <>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{specs.map((s) => <button key={s.key} type="button" className={`chip ${active === s.key ? 'active' : ''}`} onClick={() => setPreview(s.key)}>{s.label}</button>)}</div>
                  <div className="mk-preview">{form.media[0] && <ProtectedImage url={form.media[0].url} style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 10, marginBottom: 10 }} />}{text || <span className="text-muted">Nothing written yet.</span>}</div>
                  {spec && <div className={`mk-count ${text.length > spec.maxChars ? 'over' : ''}`}>{text.length} / {spec.maxChars} characters on {channelLabel(spec.key)}{form.media.length > 1 ? ` · ${form.media.length} pictures` : ''}</div>}
                </>}
                {problems.length > 0 && <div className="banner warn"><ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
              </div>
            </div>
          )}

          {tab === 'approval' && id && camp && <CampaignApproval camp={camp} dirty={dirty} onSaveFirst={save} onChanged={() => { load(true); onChanged(); }} />}

          {tab === 'results' && id && camp && <ResultsTab camp={camp} onChanged={() => { load(true); onChanged(); }} />}
          {tab === 'comments' && id && <Discussion entityType="campaign" entityId={id} title="Campaign conversation" />}
          {tab === 'documents' && id && <RecordDocuments entityType="campaign" entityId={id} kinds={['proposal', 'contract', 'invoice', 'receipt', 'other']} />}
        </div>
      )}
    </Modal>
  );
}

const METRICS: Array<[string, string]> = [['reach', 'People reached'], ['clicks', 'Clicks / visits'], ['leads', 'Leads'], ['conversions', 'Conversions'], ['hires', 'Hires'], ['revenue', 'Revenue'], ['spend', 'Spend']];

function ResultsTab({ camp, onChanged }: { camp: any; onChanged: () => void }) {
  const { showError, showSuccess } = useToast();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(METRICS.map(([k]) => [k, camp.metrics?.[k] ? String(camp.metrics[k]) : ''])));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const p = camp.progress || { current: 0, target: 0, percent: 0 };
  async function save() {
    setBusy(true);
    try { await api.post(`/campaigns/${camp._id}/metrics`, { ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '').map(([k, x]) => [k, Number(x)])), note: note || undefined }); showSuccess('Results saved.'); setNote(''); onChanged(); }
    catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card"><div className="flex-between" style={{ fontSize: 13, marginBottom: 6 }}><span>{GOAL_META[camp.goal?.kind]?.label || 'Goal'}: {p.current} of {p.target || '—'} {GOAL_META[camp.goal?.kind]?.unit}</span><strong>{p.target ? `${p.percent}%` : '—'}</strong></div>
        <div className="mk-bar"><i style={{ width: `${Math.min(100, p.percent)}%` }} /></div></div>
      {camp.insights?.length > 0 && <div className="card"><strong style={{ fontSize: 13 }}>How it is going</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>{camp.insights.map((t: string) => <li key={t}>{t}</li>)}</ul></div>}
      <div className="form-grid">{METRICS.map(([k, l]) => <div className="field" key={k}><label>{l}</label><input className="input" type="number" min={0} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></div>)}
        <div className="field full"><label>What happened? (optional note, kept in the campaign notes)</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></div></div>
      <div><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save results'}</button>
        {camp.metrics?.updatedAt && <span className="text-muted" style={{ fontSize: 12, marginLeft: 10 }}>Last updated by {camp.metrics.updatedByName}</span>}</div>
      {camp.performanceNotes && <pre className="card" style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, margin: 0 }}>{camp.performanceNotes}</pre>}
    </div>
  );
}
