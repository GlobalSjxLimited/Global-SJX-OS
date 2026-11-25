import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';

/** GET helper: { data, loading, error, reload } — re-fetches when url/params change. */
export function useApi<T = any>(url: string | null, params?: Record<string, any>) {
  const [data, setData] = useState<T | null>(null);
  const [extra, setExtra] = useState<any>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState('');
  const key = JSON.stringify(params || {});
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current;
    setLoading(true); setError('');
    try {
      const res = await api.get(url, { params: params });
      if (my !== seq.current) return;
      setData(res.data.data);
      const { data: _d, success: _s, ...rest } = res.data;
      setExtra(rest);
    } catch (err) {
      if (my === seq.current) setError(apiErrorMessage(err));
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key]);

  useEffect(() => { load(); }, [load]);
  return { data, extra, loading, error, reload: load, setData };
}
