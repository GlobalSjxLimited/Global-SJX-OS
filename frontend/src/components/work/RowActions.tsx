import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import './work.css';

export interface RowPermissions { view?: boolean; edit?: boolean; delete?: boolean }
export interface ExtraAction { key: string; label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; hidden?: boolean }

interface Props {
  permissions?: RowPermissions;
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  extra?: ExtraAction[];
  /** Used when the API gives no per-row permissions — defaults to showing whatever handlers exist. */
  assumeAllowed?: boolean;
}

/**
 * The View / Edit / Delete drop-down shown on every module. Items only appear when
 * the row's permissions (from the server) allow them and a handler was supplied.
 */
export function RowActions({ permissions, onView, onEdit, onDelete, extra = [], assumeAllowed = true }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const allow = (k: keyof RowPermissions) => (permissions ? !!permissions[k] : assumeAllowed);
  const items: Array<{ key: string; label: string; icon: ReactNode; onClick: () => void; danger?: boolean }> = [];
  if (onView && allow('view')) items.push({ key: 'view', label: 'View', icon: <Eye size={15} />, onClick: onView });
  if (onEdit && allow('edit')) items.push({ key: 'edit', label: 'Edit', icon: <Pencil size={15} />, onClick: onEdit });
  extra.filter((x) => !x.hidden).forEach((x) => items.push({ key: x.key, label: x.label, icon: x.icon, onClick: x.onClick, danger: x.danger }));
  const canDelete = !!onDelete && allow('delete');

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = 180; const h = 44 * (items.length + (canDelete ? 1 : 0)) + 12;
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    const top = r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4;
    setPos({ top, left });
  }, [open, items.length, canDelete]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const scroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', scroll); };
  }, [open]);

  if (!items.length && !canDelete) return null;
  const run = (fn: () => void) => { setOpen(false); fn(); };

  return (
    <>
      <button ref={btn} type="button" className="row-menu-btn" aria-label="Actions" aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((o) => !o); }}>
        <MoreVertical size={16} />
      </button>
      {open && pos && createPortal(
        <div ref={menu} className="row-menu" role="menu" style={{ top: pos.top, left: pos.left }} onClick={(e) => e.stopPropagation()}>
          {items.map((i) => (
            <button key={i.key} role="menuitem" className={i.danger ? 'danger' : ''} onClick={() => run(i.onClick)}>{i.icon}{i.label}</button>
          ))}
          {canDelete && items.length > 0 && <hr />}
          {canDelete && <button role="menuitem" className="danger" onClick={() => run(onDelete!)}><Trash2 size={15} />Delete</button>}
        </div>,
        document.body
      )}
    </>
  );
}
