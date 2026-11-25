import { useMemo } from 'react';
import { Lock } from 'lucide-react';

export interface ModuleDef { key: string; label: string; group: string; description: string; sensitive?: boolean }

/** Checkbox grid grouped by area. `locked` modules (always-on) are shown ticked and cannot be toggled. */
export function ModulePicker({ modules, value, onChange, locked = [], disabledKeys = [], title }: {
  modules: ModuleDef[]; value: string[]; onChange: (v: string[]) => void; locked?: string[]; disabledKeys?: string[]; title?: string;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, ModuleDef[]>();
    modules.forEach((x) => m.set(x.group, [...(m.get(x.group) || []), x]));
    return Array.from(m.entries());
  }, [modules]);
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {title && <strong style={{ fontSize: 13 }}>{title}</strong>}
      {groups.map(([g, list]) => (
        <div key={g}>
          <div className="text-muted" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{g}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 4 }}>
            {list.map((m) => {
              const on = value.includes(m.key) || locked.includes(m.key);
              const dis = locked.includes(m.key) || disabledKeys.includes(m.key);
              return (
                <label key={m.key} title={m.description} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, opacity: dis ? 0.55 : 1, cursor: dis ? 'not-allowed' : 'pointer' }}>
                  <input type="checkbox" checked={on} disabled={dis} onChange={() => toggle(m.key)} />
                  {m.label}{m.sensitive && <Lock size={11} aria-label="Sensitive" />}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
