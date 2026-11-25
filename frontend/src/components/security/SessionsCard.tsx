import { useState } from 'react';
import { MonitorSmartphone, LogOut, Download, Eraser } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/lib/useApi';
import { Badge } from '@/components/ui/Badge';
import { fdatetime, saveBlob, filenameFrom } from '@/lib/format';

/** Devices, sign-in alerts, idle timeout and the data-subject rights of the signed-in person. */
export function SessionsCard() {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const sessions = useApi<any[]>('/account/sessions');
  const activity = useApi<any[]>('/account/my-activity');
  const [prefs, setPrefs] = useState<any>((user as any)?.securityPrefs || {});
  const [timeout, setTimeoutMin] = useState<number>((user as any)?.securityPrefs?.sessionTimeoutMinutes || 30);

  async function savePrefs(patch: any) {
    try { const r = await api.patch('/account/security-prefs', patch); setPrefs(r.data.data); showSuccess('Saved.'); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function end(id: string) { try { await api.delete(`/account/sessions/${id}`); sessions.reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  async function endOthers() {
    if (!(await confirm({ title: 'Sign out other devices?', message: 'Every session except this one will end.', confirmLabel: 'Sign out others' }))) return;
    try { const r = await api.post('/account/sessions/revoke-others'); showSuccess(`${r.data.data.ended} session(s) ended.`); sessions.reload(); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function exportData() {
    try { const r = await api.get('/account/export', { responseType: 'blob' }); saveBlob(r.data, filenameFrom(r.headers['content-disposition'], 'my-data.json')); } catch (e) { showError(apiErrorMessage(e)); }
  }
  async function erasure() {
    if (!(await confirm({ title: 'Request erasure of your data?', message: 'This opens a tracked request with the data-protection team. Records we must keep by law (tax, audit) are retained.', confirmLabel: 'Submit request', danger: true }))) return;
    try { const r = await api.post('/account/erasure-request', {}); showSuccess(`Request ${r.data.data.reference} submitted.`); } catch (e) { showError(apiErrorMessage(e)); }
  }

  return (
    <div className="card" style={{ display: 'grid', gap: 18 }}>
      <div className="flex-between">
        <h3 style={{ fontSize: 16, margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}><MonitorSmartphone size={18} /> Devices & sessions</h3>
        <button className="btn btn-ghost btn-sm" onClick={endOthers}><LogOut size={13} /> Sign out other devices</button>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {(sessions.data || []).map((s) => (
          <div key={s._id} className="flex-between" style={{ fontSize: 13.5, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <span>{s.device} · {s.browser} · <span className="mono">{s.ip}</span> <span className="text-muted">last active {fdatetime(s.lastSeenAt)}</span> {s.current && <Badge tone="success">This device</Badge>}</span>
            {!s.current && <button className="btn btn-ghost btn-sm" onClick={() => end(s._id)}>End</button>}
          </div>))}
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ fontSize: 13.5 }}><input type="checkbox" checked={prefs.loginNotifications !== false} onChange={(e) => savePrefs({ loginNotifications: e.target.checked })} /> E-mail me when my account is used from a new device</label>
        <label style={{ fontSize: 13.5 }}><input type="checkbox" checked={prefs.suspiciousActivityAlerts !== false} onChange={(e) => savePrefs({ suspiciousActivityAlerts: e.target.checked })} /> Alert me about suspicious activity</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>Sign me out after <input className="input" type="number" min={5} max={480} style={{ width: 80 }} value={timeout} onChange={(e) => setTimeoutMin(Number(e.target.value))} /> minutes idle <button className="btn btn-ghost btn-sm" onClick={() => savePrefs({ sessionTimeoutMinutes: timeout })}>Save</button></div>
      </div>

      {activity.data && activity.data.length > 0 && (
        <details><summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Recent sign-in activity</summary>
          <ul style={{ fontSize: 12.5, color: 'var(--muted)', paddingLeft: 18 }}>{activity.data.map((a) => <li key={a._id}>{fdatetime(a.createdAt)} — {a.summary || a.action} {a.status === 'failed' ? '(failed)' : ''} · {a.ip}</li>)}</ul></details>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <button className="btn btn-ghost" onClick={exportData}><Download size={14} /> Download my data</button>
        <button className="btn btn-ghost" onClick={erasure}><Eraser size={14} /> Request erasure</button>
      </div>
    </div>
  );
}
