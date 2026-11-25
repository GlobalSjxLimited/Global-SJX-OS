import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

/**
 * A plain textarea that watches for "@" and offers a dropdown of employees to
 * tag. Selecting one inserts `@[Name](userId)` at the cursor — a small,
 * parseable format the backend's mention notifier reads directly, rather than
 * requiring a full rich-text editor just to support tagging.
 */
export function MentionTextarea({ value, onChange, placeholder, rows = 4 }: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [query, setQuery] = useState('');
  const [triggerIndex, setTriggerIndex] = useState<number | null>(null);

  useEffect(() => {
    api.get('/employees', { params: { limit: 100 } }).then((res) => setEmployees(res.data.data));
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newValue = e.target.value;
    const cursor = e.target.selectionStart;
    onChange(newValue);

    const textBeforeCursor = newValue.slice(0, cursor);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(atIndex + 1);
      if (!/\s/.test(textAfterAt)) {
        setTriggerIndex(atIndex);
        setQuery(textAfterAt);
        setShowPicker(true);
        return;
      }
    }
    setShowPicker(false);
  }

  function selectEmployee(emp: any) {
    if (triggerIndex === null) return;
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, triggerIndex);
    const after = value.slice(cursor);
    const mentionText = `@[${emp.name}](${emp._id}) `;
    const newValue = before + mentionText + after;
    onChange(newValue);
    setShowPicker(false);
    setTimeout(() => {
      const pos = (before + mentionText).length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    }, 0);
  }

  const filtered = employees.filter((e) => e.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={textareaRef}
        className="input"
        rows={rows}
        placeholder={placeholder || 'Type @ to tag a colleague…'}
        value={value}
        onChange={handleChange}
        onBlur={() => setTimeout(() => setShowPicker(false), 150)}
      />
      {showPicker && filtered.length > 0 && (
        <div
          style={{
            position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, width: 220, maxHeight: 200, overflowY: 'auto',
            background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 10, boxShadow: 'var(--shadow)', zIndex: 20,
          }}
        >
          {filtered.map((emp) => (
            <button
              key={emp._id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); selectEmployee(emp); }}
              style={{ width: '100%', textAlign: 'left', padding: '9px 12px', fontSize: 13, background: 'none', border: 'none', color: 'var(--text)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              {emp.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Renders saved text containing @[Name](userId) mentions as styled inline tags instead of raw markup. */
export function MentionText({ text }: { text: string }) {
  const parts = text.split(/(@\[[^\]]+\]\([a-f0-9]{24}\))/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^@\[([^\]]+)\]\([a-f0-9]{24}\)$/);
        if (match) {
          return (
            <span key={i} style={{ color: 'var(--accent)', fontWeight: 600 }}>
              @{match[1]}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
