import { Modal } from '@/components/ui/Modal';

const SHORTCUTS = [
  { keys: 'Ctrl / Cmd + K', desc: 'Open the command palette' },
  { keys: 'Esc', desc: 'Close any open dialog' },
  { keys: 'Enter', desc: 'Submit the focused form' },
];

export function HelpMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Help & shortcuts">
      <div>
        <h4 style={{ fontSize: 12.5, color: 'var(--muted-2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>Keyboard shortcuts</h4>
        <div style={{ display: 'grid', gap: 8 }}>
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex-between">
              <span style={{ fontSize: 13.5 }}>{s.desc}</span>
              <kbd style={{ fontSize: 11.5, color: 'var(--text)', border: '1px solid var(--line-strong)', borderRadius: 6, padding: '3px 8px', background: 'var(--surface-2)' }}>{s.keys}</kbd>
            </div>
          ))}
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
        <h4 style={{ fontSize: 12.5, color: 'var(--muted-2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Need help?</h4>
        <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
          Ask <strong style={{ color: 'var(--text)' }}>SJX AI</strong> from the sidebar for questions about your own tasks, projects and certifications, or
          reach the platform team at <a href="mailto:talk2us@globalsjxltd.com" style={{ color: 'var(--accent)' }}>talk2us@globalsjxltd.com</a>.
        </p>
      </div>
    </Modal>
  );
}
