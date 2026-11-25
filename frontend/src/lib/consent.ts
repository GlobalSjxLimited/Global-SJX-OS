/**
 * Cookie & local-storage consent (ISO 27001 A.5.34 / privacy).
 *  - essential:   always on — sign-in session and the consent record itself
 *  - preferences: remembers theme and similar UI choices
 *  - analytics:   anonymous product usage (not wired to any third party today)
 *  - marketing:   reserved
 * Nothing outside "essential" is written until the person has made a choice.
 */
export const CONSENT_VERSION = '2026-10-01';
const KEY = 'gsjx_consent';

export interface ConsentState {
  version: string;
  decidedAt: string;
  subjectId: string;
  essential: true;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
}

function randomId(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function readConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentState;
    // A new policy version means people must choose again.
    if (parsed.version !== CONSENT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeConsent(choice: { preferences: boolean; analytics: boolean; marketing: boolean }): ConsentState {
  let subjectId = randomId();
  try {
    const prev = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (prev?.subjectId) subjectId = prev.subjectId;
  } catch {
    /* ignore */
  }
  const state: ConsentState = { version: CONSENT_VERSION, decidedAt: new Date().toISOString(), subjectId, essential: true, ...choice };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage blocked — the banner will simply reappear */
  }
  return state;
}

/** Storage helper for non-essential values: a silent no-op unless the "preferences" category was accepted. */
export function setPreference(key: string, value: string) {
  const c = readConsent();
  if (!c?.preferences) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function clearPreferences() {
  try {
    localStorage.removeItem('gsjx-os-theme');
  } catch {
    /* ignore */
  }
}
