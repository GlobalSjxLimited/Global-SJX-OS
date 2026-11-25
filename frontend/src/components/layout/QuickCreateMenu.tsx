import { useNavigate } from 'react-router-dom';
import { ListChecks, FolderKanban, Building2, TrendingUp, Handshake, Lightbulb } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

interface QuickCreateItem {
  label: string;
  icon: React.ReactNode;
  to: string; // target page; appends ?new=1 which the page auto-opens its create modal for
}

const ITEMS: QuickCreateItem[] = [
  { label: 'Task', icon: <ListChecks size={17} />, to: '/tasks' },
  { label: 'Project', icon: <FolderKanban size={17} />, to: '/projects' },
  { label: 'Client', icon: <Building2 size={17} />, to: '/clients' },
  { label: 'Opportunity', icon: <TrendingUp size={17} />, to: '/sales' },
  { label: 'Meeting', icon: <Handshake size={17} />, to: '/meetings' },
  { label: 'Idea', icon: <Lightbulb size={17} />, to: '/ideas' },
];

/**
 * Global quick-create: jumps to the target module and asks it to open its own
 * create modal via a `?new=1` query param, rather than duplicating every
 * create form here. Each target page reads that param once on mount.
 */
export function QuickCreateMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();

  function go(item: QuickCreateItem) {
    onClose();
    navigate(`${item.to}?new=1`);
  }

  return (
    <Modal open={open} onClose={onClose} title="Quick create">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {ITEMS.map((item) => (
          <button
            key={item.label}
            onClick={() => go(item)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderRadius: 12,
              border: '1px solid var(--line-strong)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13.5, fontWeight: 600,
              textAlign: 'left',
            }}
          >
            <span style={{ color: 'var(--accent)' }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
