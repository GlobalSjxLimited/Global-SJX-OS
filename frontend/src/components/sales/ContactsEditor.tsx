import { Plus, Trash2 } from 'lucide-react';

export interface ContactRow { name: string; title?: string; email?: string; phone?: string; role?: string; isPrimary?: boolean; _id?: string }
const ROLES = [['decision_maker', 'Decision maker'], ['influencer', 'Influencer'], ['champion', 'Champion'], ['technical', 'Technical'], ['finance', 'Finance'], ['other', 'Other']];

export const contactProblem = (c: ContactRow) => (!c.name.trim() ? 'Every contact needs a name' : c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email.trim()) ? `“${c.email}” is not a valid e-mail address` : '');

/** Edit a list of contact people (name, title, e-mail, phone, role, primary). Used on opportunities and vendors. */
export function ContactsEditor({ value, onChange, roles = true, fromClient }: { value: ContactRow[]; onChange: (v: ContactRow[]) => void; roles?: boolean; fromClient?: { label: string; contacts: ContactRow[] } }) {
  const set = (i: number, k: keyof ContactRow, v: any) => onChange(value.map((c, j) => (j === i ? { ...c, [k]: v } : k === 'isPrimary' && v ? { ...c, isPrimary: false } : c)));
  const bad = value.map(contactProblem);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {value.map((c, i) => (
        <div key={i} className="mini-card" style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6 }}>
            <input className="input" aria-label="Contact name" placeholder="Name *" value={c.name} onChange={(e) => set(i, 'name', e.target.value)} />
            <input className="input" aria-label="Job title" placeholder="Job title" value={c.title || ''} onChange={(e) => set(i, 'title', e.target.value)} />
            <input className="input" aria-label="Contact e-mail" type="email" placeholder="E-mail" value={c.email || ''} onChange={(e) => set(i, 'email', e.target.value)} />
            <input className="input" aria-label="Contact phone" type="tel" placeholder="Phone" value={c.phone || ''} onChange={(e) => set(i, 'phone', e.target.value)} />
            {roles && <select className="input" aria-label="Role in the decision" value={c.role || 'other'} onChange={(e) => set(i, 'role', e.target.value)}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
          </div>
          <div className="flex-between"><label style={{ fontSize: 12.5, display: 'flex', gap: 6 }}><input type="radio" name="primary-contact" checked={!!c.isPrimary} onChange={() => set(i, 'isPrimary', true)} /> Main contact</label>
            <button type="button" className="icon-btn" aria-label="Remove contact" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 size={14} /></button></div>
          {bad[i] && <small role="alert" style={{ color: 'var(--danger, #e5484d)' }}>{bad[i]}</small>}
        </div>
      ))}
      <div className="row-gap">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...value, { name: '', role: 'other', isPrimary: value.length === 0 }])}><Plus size={13} /> Add contact</button>
        {fromClient && fromClient.contacts.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...value, ...fromClient.contacts.filter((c) => !value.some((v) => v.email && v.email === c.email)).map((c, i) => ({ ...c, role: 'other', isPrimary: value.length === 0 && i === 0 }))])}>Add {fromClient.label}’s contacts</button>}
      </div>
    </div>
  );
}
