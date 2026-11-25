import { useConsent } from '@/context/ConsentContext';

export function CookieFooterLink() {
  const { openSettings } = useConsent();
  return <button type="button" onClick={openSettings} style={{ background: 'none', border: 0, color: 'inherit', textDecoration: 'underline', fontSize: 'inherit' }}>Cookie settings</button>;
}
