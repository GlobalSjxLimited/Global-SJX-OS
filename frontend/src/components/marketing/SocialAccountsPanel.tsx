import { useState } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Empty, ErrorNote, Loading } from '@/components/ui/PageHead';
import { PeoplePicker } from '@/components/work/PeoplePicker';
import { fdatetime } from '@/lib/format';

const ID_LABEL: Record<string, string> = { facebook: 'Facebook Page ID', instagram: 'Instagram business account ID', linkedin: 'LinkedIn organisation ID' };

/** The pages and profiles the company posts on, who manages each, and whether the app may post for them. */
export function SocialAccountsPanel() {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const { data, extra, loading, error, reload } = useApi<any[]>('/campaigns/accounts');
  const [edit, setEdit] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const platforms: any[] = (extra?.platforms || []).filter((p: any) => p.social);

  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      const body: any = { platform: edit.platform, label: edit.label, handle: edit.handle || undefined, profileUrl: edit.profileUrl || undefined, externalId: edit.externalId || undefined, managerId: edit.managerId?.[0] || null, status: edit.status };
      if (edit.removeToken) body.token = ''; else if (edit.token) body.token = edit.token;
      if (edit._id) await api.patch(`/campaigns/accounts/${edit._id}`, body); else await api.post('/campaigns/accounts', body);
      showSuccess('Account saved.'); setEdit(null); reload();
    } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  async function remove(a: any) {
    if (!(await confirm({ title: `Remove ${a.label}?`, message: 'Posts already made stay in their campaigns. You can add the account again later.', confirmLabel: 'Remove', danger: true } as any))) return;
    try { await api.delete(`/campaigns/accounts/${a._id}`); showSuccess('Removed.'); reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="banner">
        <strong>How posting works.</strong> Every account has a social media manager who gets approved posts in a queue and posts them by hand. For Facebook, Instagram and LinkedIn you can also connect the account so the app posts for them, but only after the post is approved. Connecting needs an access token from your own Meta or LinkedIn developer app. Tokens are stored encrypted and are never shown again.
      </div>
      <div><button className="btn btn-primary" onClick={() => setEdit({ platform: 'facebook', label: '', managerId: [], status: 'active' })}><Plus size={15} /> Add account</button></div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty title="No accounts yet" hint="Add your Facebook page, Instagram, LinkedIn and others, and name who manages each." /> : (
        <div className="table-wrap"><table className="data-table" style={{ cursor: 'default' }}><thead><tr><th>Platform</th><th>Account</th><th>Manager</th><th>Posting</th><th>Status</th><th style={{ width: 150 }} /></tr></thead>
          <tbody>{data.map((a) => (
            <tr key={a._id} style={{ cursor: 'default' }}>
              <td>{platforms.find((p) => p.key === a.platform)?.label || a.platform}</td>
              <td><strong>{a.label}</strong>{a.handle && <div className="text-muted" style={{ fontSize: 12 }}>{a.handle}</div>}</td>
              <td>{a.managerId?.name || <span className="text-muted">Not set</span>}</td>
              <td>{a.canAutoPost ? <Badge tone="success"><KeyRound size={11} /> App can post (…{a.tokenLast4})</Badge> : <Badge tone="neutral">Posted by hand</Badge>}{a.lastUsedAt && <div className="text-muted" style={{ fontSize: 11.5 }}>Last used {fdatetime(a.lastUsedAt)}</div>}</td>
              <td><Badge tone={a.status === 'active' ? 'success' : a.status === 'needs_attention' ? 'danger' : 'neutral'}>{a.status.replace('_', ' ')}</Badge>{a.lastError && <div style={{ fontSize: 11.5, color: 'var(--danger)' }}>{a.lastError}</div>}</td>
              <td><div className="row-gap"><button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...a, managerId: a.managerId?._id ? [a.managerId._id] : [], token: '' })}>Edit</button><button className="btn btn-ghost btn-sm" onClick={() => remove(a)}>Remove</button></div></td>
            </tr>))}</tbody></table></div>
      )}

      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit._id ? 'Edit account' : 'Add account'}
          footer={<><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || edit.label.trim().length < 2} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
          <div className="form-grid">
            <div className="field"><label>Platform *</label><select className="input" value={edit.platform} disabled={!!edit._id} onChange={(e) => setEdit({ ...edit, platform: e.target.value })}>{platforms.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>
            <div className="field"><label>Name of the account *</label><input className="input" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder="e.g. GLOBAL SJX — LinkedIn page" maxLength={120} /></div>
            <div className="field"><label>Handle</label><input className="input" value={edit.handle || ''} onChange={(e) => setEdit({ ...edit, handle: e.target.value })} placeholder="@globalsjx" /></div>
            <div className="field"><label>Profile link</label><input className="input" value={edit.profileUrl || ''} onChange={(e) => setEdit({ ...edit, profileUrl: e.target.value })} placeholder="https://…" /></div>
            <div className="field full"><label>Social media manager</label><PeoplePicker single value={edit.managerId || []} onChange={(v) => setEdit({ ...edit, managerId: v })} placeholder="Who posts for this account" /></div>
            {ID_LABEL[edit.platform] && <>
              <div className="field full"><label>{ID_LABEL[edit.platform]} (only for automatic posting)</label><input className="input" value={edit.externalId || ''} onChange={(e) => setEdit({ ...edit, externalId: e.target.value })} /></div>
              <div className="field full"><label>Access token {edit.tokenLast4 ? `(a token ending …${edit.tokenLast4} is saved)` : '(optional)'}</label>
                <input className="input" type="password" autoComplete="new-password" value={edit.token || ''} onChange={(e) => setEdit({ ...edit, token: e.target.value, removeToken: false })} placeholder={edit.tokenLast4 ? 'Leave empty to keep the saved token' : 'Paste the token from your developer app'} />
                {edit.tokenLast4 && <label style={{ fontSize: 12.5 }}><input type="checkbox" checked={!!edit.removeToken} onChange={(e) => setEdit({ ...edit, removeToken: e.target.checked, token: '' })} /> Remove the saved token (the manager posts by hand)</label>}</div></>}
            {edit._id && <div className="field"><label>Status</label><select className="input" value={edit.status === 'needs_attention' ? 'active' : edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>}
          </div>
        </Modal>
      )}
    </div>
  );
}
