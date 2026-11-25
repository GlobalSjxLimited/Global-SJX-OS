import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { RichTextRenderer } from '@/components/ui/RichText';
import { PublicShell } from './PublicInsightsPage';

export function PublicArticlePage() {
  const { id } = useParams();
  const [a, setA] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/knowledge/public/${id}`).then((r) => setA(r.data.data)).catch(() => setError("This article isn't available."));
  }, [id]);
  return (
    <PublicShell>
      <Link to="/insights" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: 'var(--accent)', fontSize: 13, marginBottom: 18 }}><ArrowLeft size={14} /> All insights</Link>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {a && (
        <article>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>{(a.categories || []).map((c: string) => <span key={c} className="badge badge-accent">{c}</span>)}</div>
          <h1 style={{ fontSize: 38, marginBottom: 10 }}>{a.title}</h1>
          <div style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 28 }}>{a.authorId?.name} · {new Date(a.publishedAt || a.createdAt).toLocaleDateString()}</div>
          <div style={{ fontSize: 16.5 }}><RichTextRenderer content={a.content} /></div>
        </article>
      )}
    </PublicShell>
  );
}
