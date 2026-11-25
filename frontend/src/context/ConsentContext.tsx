import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import axios from 'axios';
import { ConsentState, readConsent, writeConsent, clearPreferences, CONSENT_VERSION } from '@/lib/consent';

interface ConsentContextValue {
  consent: ConsentState | null;
  decided: boolean;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  save: (choice: { preferences: boolean; analytics: boolean; marketing: boolean }) => void;
  acceptAll: () => void;
  essentialOnly: () => void;
}

const ConsentContext = createContext<ConsentContextValue | undefined>(undefined);
const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [consent, setConsent] = useState<ConsentState | null>(() => readConsent());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const save = useCallback((choice: { preferences: boolean; analytics: boolean; marketing: boolean }) => {
    const state = writeConsent(choice);
    if (!choice.preferences) clearPreferences();
    setConsent(state);
    setSettingsOpen(false);
    // Proof of consent. Fire-and-forget: failing to record must never block the person.
    axios
      .post(`${API}/consent`, { subjectId: state.subjectId, policyVersion: CONSENT_VERSION, source: 'app', ...choice }, { timeout: 8000 })
      .catch(() => undefined);
  }, []);

  const value: ConsentContextValue = {
    consent,
    decided: !!consent,
    settingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    save,
    acceptAll: () => save({ preferences: true, analytics: true, marketing: true }),
    essentialOnly: () => save({ preferences: false, analytics: false, marketing: false }),
  };
  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error('useConsent must be used within ConsentProvider');
  return ctx;
}
