import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <h1 style={{ fontSize: 40 }}>404</h1>
      <p style={{ color: 'var(--muted)' }}>This page doesn't exist.</p>
      <Link to="/" className="btn btn-primary">Back to dashboard</Link>
    </div>
  );
}
