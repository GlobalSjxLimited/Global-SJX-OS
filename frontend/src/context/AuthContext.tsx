import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '@/lib/api';
import { AuthUser } from '@/types';

export type LoginResult = { mfaRequired: true; challengeToken: string } | { mfaRequired: false };

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  completeMfaLogin: (challengeToken: string, code: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem('gsjx_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('gsjx_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then((res) => {
        setUser(res.data.data);
        localStorage.setItem('gsjx_user', JSON.stringify(res.data.data));
      })
      .catch(() => {
        localStorage.removeItem('gsjx_token');
        localStorage.removeItem('gsjx_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  function applySession(token: string, authedUser: AuthUser) {
    localStorage.setItem('gsjx_token', token);
    localStorage.setItem('gsjx_user', JSON.stringify(authedUser));
    setUser(authedUser);
  }

  /** Returns { mfaRequired: true, challengeToken } if the account has MFA enabled — the caller (Login page) then collects a code and calls completeMfaLogin. Otherwise the session is established immediately. */
  async function login(email: string, password: string): Promise<LoginResult> {
    const res = await api.post('/auth/login', { email, password });
    if (res.data.data.mfaRequired) {
      return { mfaRequired: true, challengeToken: res.data.data.challengeToken };
    }
    applySession(res.data.data.token, res.data.data.user);
    return { mfaRequired: false };
  }

  async function completeMfaLogin(challengeToken: string, code: string) {
    const res = await api.post('/auth/mfa/challenge', { challengeToken, code });
    applySession(res.data.data.token, res.data.data.user);
  }

  function logout() {
    localStorage.removeItem('gsjx_token');
    localStorage.removeItem('gsjx_user');
    setUser(null);
    window.location.href = '/login';
  }

  async function refreshUser() {
    const res = await api.get('/auth/me');
    setUser(res.data.data);
    localStorage.setItem('gsjx_user', JSON.stringify(res.data.data));
  }

  return <AuthContext.Provider value={{ user, loading, login, completeMfaLogin, logout, refreshUser }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
