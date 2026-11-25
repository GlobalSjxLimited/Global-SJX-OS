import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** An <img> for files that sit behind sign-in: fetched with the user's session, shown from memory. */
export function ProtectedImage({ url, alt = '', style, className }: { url: string; alt?: string; style?: React.CSSProperties; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let on = true; let made: string | null = null;
    setSrc(null); setFailed(false);
    api.get(url.startsWith('/api/') ? url.slice(4) : url, { responseType: 'blob' })
      .then((r) => { if (!on) return; made = URL.createObjectURL(r.data); setSrc(made); })
      .catch(() => on && setFailed(true));
    return () => { on = false; if (made) URL.revokeObjectURL(made); };
  }, [url]);
  if (failed) return <div className={className} style={{ ...style, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', color: 'var(--muted)', fontSize: 12 }}>Picture unavailable</div>;
  if (!src) return <div className={className} style={{ ...style, background: 'var(--surface-2)' }} aria-busy />;
  return <img src={src} alt={alt} className={className} style={style} />;
}
