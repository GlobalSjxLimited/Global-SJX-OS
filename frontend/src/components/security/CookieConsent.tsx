import { useEffect, useState } from 'react';
import { Cookie, ShieldCheck } from 'lucide-react';
import { useConsent } from '@/context/ConsentContext';

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange?: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      style={{
        width: 44, height: 24, borderRadius: 20, border: '1px solid var(--line-strong)', padding: 2, flexShrink: 0,
        background: checked ? 'var(--accent)' : 'var(--surface-3)', opacity: disabled ? 0.6 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', justifyContent: checked ? 'flex-end' : 'flex-start', transition: 'background .2s',
      }}
    >
      <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', display: 'block' }} />
    </button>
  );
}

const CATEGORIES = [
  { key: 'essential', title: 'Strictly necessary', desc: 'Keeps you signed in, protects against fraud and remembers this choice. Always on.' },
  { key: 'preferences', title: 'Preferences', desc: 'Remembers your display choices such as dark or light mode.' },
  { key: 'analytics', title: 'Analytics', desc: 'Anonymous usage statistics that help us improve the platform. No advertising.' },
  { key: 'marketing', title: 'Marketing', desc: 'Lets Global SJX tailor communications about its products and training. Off unless you opt in.' },
] as const;

/**
 * Blocking consent gate. Until a choice is made the rest of the application is
 * covered and cannot be used, and nothing beyond strictly necessary storage is
 * written. People can reopen it from Settings at any time.
 */
export function CookieConsent() {
  const { decided, settingsOpen, consent, save, acceptAll, essentialOnly, closeSettings } = useConsent();
  const [custom, setCustom] = useState(false);
  const [choice, setChoice] = useState({ preferences: false, analytics: false, marketing: false });
  const visible = !decided || settingsOpen;

  useEffect(() => {
    if (settingsOpen && consent) {
      setChoice({ preferences: consent.preferences, analytics: consent.analytics, marketing: consent.marketing });
      setCustom(true);
    }
  }, [settingsOpen, consent]);

  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cookie-title"
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(5,6,10,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 16, overflowY: 'auto' }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 640, boxShadow: 'var(--shadow)', border: '1px solid var(--line-strong)', margin: 'auto 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Cookie size={20} />
          </div>
          <h3 id="cookie-title" style={{ fontSize: 20 }}>Your privacy choices</h3>
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.65 }}>
          Global SJX OS uses cookies and similar browser storage. Some are strictly necessary to keep the platform secure and keep you signed in. Others are optional and only used if you agree.
          You must make a choice to continue, and you can change it any time from <strong>Settings → Privacy</strong>.
        </p>

        {custom && (
          <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
            {CATEGORIES.map((c) => (
              <div key={c.key} style={{ display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2)' }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.title}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{c.desc}</div>
                </div>
                {c.key === 'essential' ? (
                  <Toggle checked disabled label={c.title} />
                ) : (
                  <Toggle checked={choice[c.key]} label={c.title} onChange={(v) => setChoice({ ...choice, [c.key]: v })} />
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18, justifyContent: 'flex-end' }}>
          {settingsOpen && consent && (
            <button className="btn btn-ghost" onClick={closeSettings}>Cancel</button>
          )}
          {!custom ? (
            <button className="btn btn-ghost" onClick={() => setCustom(true)}>Customise</button>
          ) : (
            <button className="btn btn-ghost" onClick={() => save(choice)}>Save my choices</button>
          )}
          <button className="btn btn-ghost" onClick={essentialOnly}>Necessary only</button>
          <button className="btn btn-primary" onClick={acceptAll}><ShieldCheck size={15} /> Accept all</button>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 12 }}>
          Policy version {consent?.version || '2026-10-01'}. Your choice is recorded (with a one-way hashed network address) as proof of consent.
        </p>
      </div>
    </div>
  );
}
