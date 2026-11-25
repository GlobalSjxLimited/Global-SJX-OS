import { useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { Modal } from '@/components/ui/Modal';

export function MfaSettingsCard() {
  const { user, refreshUser } = useAuth();
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();

  const [setupOpen, setSetupOpen] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function startSetup() {
    setLoading(true);
    try {
      const res = await api.post('/auth/mfa/setup');
      setQrCodeDataUrl(res.data.data.qrCodeDataUrl);
      setSecret(res.data.data.secret);
      setSetupOpen(true);
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function confirmSetup() {
    setLoading(true);
    try {
      await api.post('/auth/mfa/verify', { code });
      showSuccess('Two-factor authentication is now enabled.');
      setSetupOpen(false);
      setCode('');
      await refreshUser();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function disableMfa() {
    const ok = await confirm({
      title: 'Disable two-factor authentication',
      message: "This will make your account rely on a password alone. You'll need to enter a current code to confirm.",
      confirmLabel: 'Continue',
      danger: true,
    });
    if (!ok) return;
    const enteredCode = window.prompt('Enter your current 6-digit authentication code to confirm:');
    if (!enteredCode) return;
    setLoading(true);
    try {
      await api.post('/auth/mfa/disable', { code: enteredCode });
      showSuccess('Two-factor authentication disabled.');
      await refreshUser();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ fontSize: 16, marginBottom: 16 }}>Two-factor authentication</h3>
      <div className="flex-between">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {user?.mfaEnabled ? <ShieldCheck size={20} color="var(--success)" /> : <ShieldOff size={20} color="var(--muted-2)" />}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{user?.mfaEnabled ? 'Enabled' : 'Not enabled'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 320 }}>
              {user?.mfaEnabled
                ? 'Your account requires a code from an authenticator app at every sign-in.'
                : 'Add an authenticator app (Google Authenticator, Authy, 1Password) for a second layer of protection.'}
            </div>
          </div>
        </div>
        {user?.mfaEnabled ? (
          <button className="btn btn-danger" onClick={disableMfa} disabled={loading}>Disable</button>
        ) : (
          <button className="btn btn-primary" onClick={startSetup} disabled={loading}>Enable</button>
        )}
      </div>

      <Modal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        title="Set up two-factor authentication"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setSetupOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={confirmSetup} disabled={loading || code.length !== 6}>{loading ? 'Verifying…' : 'Confirm & enable'}</button>
          </>
        }
      >
        <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>Scan this QR code with your authenticator app, then enter the 6-digit code it generates.</p>
        {qrCodeDataUrl && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 12, background: '#fff', borderRadius: 12 }}>
            <img src={qrCodeDataUrl} alt="MFA QR code" style={{ width: 180, height: 180 }} />
          </div>
        )}
        <div className="field">
          <label>Can't scan? Enter this key manually</label>
          <input className="input" readOnly value={secret} onFocus={(e) => e.target.select()} style={{ fontFamily: 'monospace', fontSize: 12.5 }} />
        </div>
        <div className="field">
          <label>6-digit code</label>
          <input
            className="input"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            style={{ letterSpacing: 4, fontSize: 18, textAlign: 'center' }}
          />
        </div>
      </Modal>
    </div>
  );
}
