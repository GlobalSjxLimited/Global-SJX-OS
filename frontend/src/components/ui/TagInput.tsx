import { useState } from 'react';
import { X } from 'lucide-react';

/** Multi-value chip input. Press Enter or comma to add; suggestions are one-click. */
export function TagInput({ value, onChange, suggestions = [], placeholder }: { value: string[]; onChange: (v: string[]) => void; suggestions?: string[]; placeholder?: string }) {
  const [text, setText] = useState('');
  function add(raw: string) {
    const v = raw.trim().replace(/,$/, '');
    if (!v || value.some((x) => x.toLowerCase() === v.toLowerCase()) || value.length >= 12) return;
    onChange([...value, v]);
    setText('');
  }
  const remaining = suggestions.filter((s) => !value.some((x) => x.toLowerCase() === s.toLowerCase())).slice(0, 10);
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, border: '1px solid var(--line-strong)', borderRadius: 10, background: 'var(--surface-2)' }}>
        {value.map((v) => (
          <span key={v} className="chip active" style={{ cursor: 'default' }}>
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} style={{ background: 'none', border: 0, color: 'inherit', display: 'inline-flex' }}><X size={12} /></button>
          </span>
        ))}
        <input
          value={text}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text); } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)); }}
          onBlur={() => add(text)}
          style={{ flex: 1, minWidth: 120, background: 'transparent', border: 0, outline: 'none', color: 'var(--text)', fontSize: 14 }}
        />
      </div>
      {remaining.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {remaining.map((s) => <button key={s} type="button" className="chip" onClick={() => add(s)}>+ {s}</button>)}
        </div>
      )}
    </div>
  );
}
