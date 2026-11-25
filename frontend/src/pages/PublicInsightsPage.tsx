import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { CookieFooterLink } from '@/components/security/CookieFooterLink';

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--ink)', color: 'var(--text)', padding: '32px 20px 60px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <Link to="/insights" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 30 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(155deg,#C22FD4,#6d1a78)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, fontFamily: 'Fraunces, serif' }}>SJX</div>
          <span style={{ fontFamily: 'Fraunces, serif', fontSize: 17, fontWeight: 600 }}>Global SJX Insights</span>
        </Link>
        {children}
        <div style={{ marginTop: 40, paddingTop: 18, borderTop: '1px solid var(--line)', fontSize: 12.5, color: 'var(--muted-2)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <span>© Global SJX Limited, Lagos</span>
          <CookieFooterLink />
        </div>
      </div>
    </div>
  );
}

export function PublicInsightsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get('/knowledge/public', { params: category ? { category } : {} })
      .then((r) => setItems(r.data.data))
      .catch(() => setError('Insights are unavailable right now.'))
      .finally(() => setLoading(false));
  }, [category]);

  const cats = Array.from(new Set(items.flatMap((i) => i.categories || [])));

  return (
    <PublicShell>
      <h1 style={{ fontSize: 36, marginBottom: 8 }}>Insights</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 22 }}>Articles and case studies from the Global SJX team.</p>
      {(cats.length > 0 || category) && (
        <div className="pill-tabs">
          <button className={`chip ${category === '' ? 'active' : ''}`} onClick={() => setCategory('')}>All</button>
          {cats.map((c) => <button key={c as string} className={`chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(c as string)}>{c as string}</button>)}
        </div>
      )}
      {loading && <p style={{ color: 'var(--muted)' }}>Loading…</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {!loading && !error && items.length === 0 && <p style={{ color: 'var(--muted)' }}>No articles published yet.</p>}
      <div style={{ display: 'grid', gap: 16 }}>
        {items.map((a) => (
          <Link key={a._id} to={`/insights/${a._id}`} className="card card-hover" style={{ display: 'block' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>{(a.categories || []).map((c: string) => <span key={c} className="badge badge-accent">{c}</span>)}</div>
            <h2 style={{ fontSize: 22, marginBottom: 6 }}>{a.title}</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>{a.summary}</p>
            <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 10 }}>{a.authorId?.name} · {new Date(a.publishedAt || a.createdAt).toLocaleDateString()}</div>
          </Link>
        ))}
      </div>
    </PublicShell>
  );
}
