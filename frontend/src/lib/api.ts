import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5001/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('gsjx_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    // Downloads use responseType "blob", so a JSON error body arrives as a Blob — unwrap it so the message is readable.
    const body = error?.response?.data;
    if (typeof Blob !== 'undefined' && body instanceof Blob && /json|text/.test(body.type)) {
      try { error.response.data = JSON.parse(await body.text()); } catch { /* keep the blob */ }
    }
    const url = String(error?.config?.url || '');
    // A wrong *current* password or wrong login is a normal 401 — do not treat it as an expired session.
    if (error?.response?.status === 401 && !/\/auth\/(login|change-password|mfa\/challenge)/.test(url)) {
      localStorage.removeItem('gsjx_token');
      localStorage.removeItem('gsjx_user');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(err: unknown): string {
  const anyErr = err as any;
  return anyErr?.response?.data?.message || anyErr?.message || 'Something went wrong';
}

/** Downloads/opens a file served by our authenticated /api/uploads route (a plain <a href> can't carry the Bearer token). */
export async function openProtectedFile(url: string, filename?: string) {
  // Stored URLs are like "/api/uploads/...", but `api`'s baseURL already ends in "/api" — strip the duplicate.
  const relativeUrl = url.startsWith('/api/') ? url.slice(4) : url;
  const res = await api.get(relativeUrl, { responseType: 'blob' });
  const blobUrl = window.URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.target = '_blank';
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(blobUrl), 10000);
}
