import { Fragment, ReactNode } from 'react';

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: Array<{ key: string; label: string; count?: number }>; value: string; onChange: (k: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={`tab ${value === t.key ? 'active' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="empty-state">
      {icon}
      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {hint && <div style={{ fontSize: 13, marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return <div style={{ display: 'grid', gap: 10 }}>{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" style={{ height: 44 }} />)}</div>;
}

export function ErrorNote({ message }: { message: string }) {
  return message ? <div className="card" style={{ color: 'var(--danger)', fontSize: 13.5 }}>{message}</div> : null;
}

export function Kv({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd style={{ margin: 0 }}>{v ?? '—'}</dd></Fragment>))}
    </dl>
  );
}
