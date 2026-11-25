import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CookieFooterLink } from '@/components/security/CookieFooterLink';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiErrorMessage } from '@/lib/api';

export function Login() {
  const { login, completeMfaLogin } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@globalsjxltd.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await login(email, password);
      if (result.mfaRequired) {
        setChallengeToken(result.challengeToken);
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e: FormEvent) {
    e.preventDefault();
    if (!challengeToken) return;
    setLoading(true);
    setError('');
    try {
      await completeMfaLogin(challengeToken, mfaCode);
      navigate('/');
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (challengeToken) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ink)', padding: 20 }}>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="card" style={{ maxWidth: 400, width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <ShieldCheck size={22} color="var(--accent)" />
            <h1 style={{ fontSize: 20 }}>Two-factor verification</h1>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13.5, marginBottom: 24 }}>Enter the 6-digit code from your authenticator app.</p>
          <form onSubmit={handleMfaSubmit} style={{ display: 'grid', gap: 16 }}>
            <div className="field">
              <label>Authentication code</label>
              <input
                className="input"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoFocus
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                style={{ letterSpacing: 4, fontSize: 18, textAlign: 'center' }}
                required
              />
            </div>
            {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
            <button className="btn btn-primary" type="submit" disabled={loading || mfaCode.length !== 6} style={{ justifyContent: 'center' }}>
              {loading ? 'Verifying…' : 'Verify and sign in'}
            </button>
            <button type="button" className="btn btn-ghost" style={{ justifyContent: 'center' }} onClick={() => { setChallengeToken(null); setMfaCode(''); setError(''); }}>
              Back to login
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ink)', padding: 20 }}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 0.8, 0.24, 1] }}
        className="card"
        style={{ maxWidth: 400, width: '100%' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <BrandLogo size={44} rounded={10} />
          <div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 17, fontWeight: 600 }}>Global SJX OS</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>Security · ISMS · Data Protection</div>
          </div>
        </div>

        <h1 style={{ fontSize: 22, marginBottom: 6 }}>Welcome back</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13.5, marginBottom: 26 }}>Sign in to continue to your workspace.</p>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ justifyContent: 'center', marginTop: 4 }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 22, textAlign: 'center' }}>
          Access is monitored and audited. Repeated failed sign-ins temporarily lock the account. <CookieFooterLink />
        </p>
      </motion.div>
    </div>
  );
}
