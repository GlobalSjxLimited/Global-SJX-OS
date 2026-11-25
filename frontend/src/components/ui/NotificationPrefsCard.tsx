import { useEffect, useState } from 'react';
import { BellOff } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/context/ToastContext';
import { Loading } from '@/components/ui/PageHead';

/** What the signed-in person wants to hear about, in the app and by e-mail. Security and compliance notices cannot be switched off. */
export function NotificationPrefsCard() {
  const { data, loading, reload } = useApi<any>('/notification-prefs');
  const { showError, showSuccess } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setRows(data.categories); }, [data]);
  const set = (key: string, field: 'inApp' | 'email', v: boolean) => setRows((r) => r.map((x) => (x.key === key ? { ...x, [field]: v } : x)));
  async function save() {
    setBusy(true);
    try { await api.put('/notification-prefs', { categories: rows.map(({ key, inApp, email }) => ({ key, inApp, email })) }); showSuccess('Notification settings saved.'); reload(); } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  async function unmute(m: any) { try { await api.post('/notification-prefs/mute', { entityType: m.entityType, entityId: m.entityId, muted: false }); reload(); } catch (e) { showError(apiErrorMessage(e)); } }
  return (
    <div className="card">
      <h3 style={{ fontSize: 16, marginBottom: 4 }}>Notifications</h3>
      <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>Choose what you hear about, in the app and by e-mail. Urgent items, and security and compliance notices, always reach you.</p>
      {loading && !data ? <Loading rows={3} /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>About</th><th style={{ width: 90 }}>In the app</th><th style={{ width: 90 }}>E-mail</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.key} style={{ cursor: 'default' }}><td>{r.label}</td>
              <td><input type="checkbox" aria-label={`${r.label}: in the app`} checked={r.inApp} onChange={(e) => set(r.key, 'inApp', e.target.checked)} /></td>
              <td><input type="checkbox" aria-label={`${r.label}: e-mail`} checked={r.email} onChange={(e) => set(r.key, 'email', e.target.checked)} /></td></tr>))}</tbody></table></div>
      )}
      <div style={{ marginTop: 12 }}><button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</button></div>
      {!!data?.mutes?.length && (
        <div style={{ marginTop: 16 }}><strong style={{ fontSize: 13 }}><BellOff size={13} style={{ verticalAlign: -2 }} /> Muted items ({data.mutes.length})</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>{data.mutes.map((m: any) => <li key={`${m.entityType}${m.entityId}`}>{m.entityType} <span className="mono" style={{ fontSize: 11 }}>{m.entityId.slice(-6)}</span> <button className="btn btn-ghost btn-sm" onClick={() => unmute(m)}>Unmute</button></li>)}</ul></div>
      )}
    </div>
  );
}
