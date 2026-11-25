import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, Columns3, Download, List, Lock, Plus, Search } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { useQuickCreate } from '@/lib/useQuickCreate';
import { fdate, filenameFrom, saveBlob } from '@/lib/format';
import { KanbanBoard } from '@/components/ui/KanbanBoard';
import { Empty, ErrorNote, PageHead, Tabs } from '@/components/ui/PageHead';
import { TableSkeleton } from '@/components/ui/Feedback';
import { QuarterFilter } from '@/components/work/QuarterFilter';
import { RowActions } from '@/components/work/RowActions';
import { SEVERITY_OPTIONS, SeverityBadge } from '@/components/work/SeverityBadge';
import { useTaskActions } from '@/components/work/useTaskActions';
import { ProgressBar, StatusBadge } from '@/components/work/StatusBadge';
import { StatusChangeModal } from '@/components/work/StatusChangeModal';
import { BOARD_COLUMNS, STATUS_LABEL, isOpenStatus } from '@/lib/taskStatus';
import { quarterOf } from '@/lib/quarter';

const COLUMNS = BOARD_COLUMNS;
const name = (v: any) => (v && typeof v === 'object' ? v.name || v.title : undefined);

export function Tasks() {
  const { user } = useAuth();
  const { showError } = useToast();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'mine' ? 'mine' : sp.get('tab') === 'approvals' ? 'approvals' : 'all';
  const view = sp.get('view') === 'board' ? 'board' : 'list';
  const [q, setQ] = useState('');
  const [quarter, setQuarter] = useState(sp.get('quarter') || '');
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [debounced, setDebounced] = useState('');
  const [change, setChange] = useState<{ task: any; to: string } | null>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { api.get('/projects').then((r) => setProjects(r.data.data)).catch(() => undefined); }, []);

  const params = useMemo(() => {
    const p: Record<string, any> = {};
    if (tab === 'mine') p.scope = 'mine';
    if (tab === 'approvals') p.awaitingMyApproval = 'true';
    if (debounced) p.q = debounced;
    if (quarter) p.quarter = quarter;
    if (status && view === 'list') p.status = status;
    if (severity) p.severity = severity;
    if (projectId) p.projectId = projectId;
    return p;
  }, [tab, debounced, quarter, status, severity, projectId, view]);

  const list = useApi<any[]>(view === 'list' ? '/tasks' : null, params);
  const board = useApi<Record<string, any[]>>(view === 'board' ? '/tasks/board' : null, { ...(tab === 'mine' ? { scope: 'mine' } : {}), ...(quarter ? { quarter } : {}), ...(projectId ? { projectId } : {}) });
  const reload = () => { list.reload(); board.reload(); };
  const actions = useTaskActions(reload);
  useQuickCreate(() => actions.openCreate());

  const setParam = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const rows = list.data || [];
  const boardItems = useMemo(() => {
    const b = board.data || {};
    if (!severity && !debounced) return b;
    return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.filter((t) => (!severity || t.severity === severity) && (!debounced || t.title.toLowerCase().includes(debounced.toLowerCase())))]));
  }, [board.data, severity, debounced]);

  /** Dragging a card never changes status silently: the status window asks for the comment (and anything else that status needs). */
  function move(id: string, from: string, to: string) {
    if (from === to) return;
    const task = Object.values(board.data || {}).flat().find((t: any) => t._id === id);
    if (!task) return;
    if (!(task.nextStatuses || []).includes(to)) { showError(`A ${STATUS_LABEL[from].toLowerCase()} task cannot go straight to ${STATUS_LABEL[to].toLowerCase()}.`); return; }
    setChange({ task, to });
  }
  async function exportCsv() {
    try { const r = await api.get('/tasks/export.csv', { params, responseType: 'blob' }); saveBlob(r.data, filenameFrom(r.headers['content-disposition'], 'tasks.csv')); } catch (err) { showError(apiErrorMessage(err)); }
  }

  const overdue = (t: any) => isOpenStatus(t.status) && (t.endDate || t.dueDate) && new Date(t.endDate || t.dueDate) < new Date();
  const error = list.error || board.error;

  return (
    <div>
      <PageHead title={tab === 'mine' ? 'My tasks' : 'All tasks'} subtitle={tab === 'mine' ? 'Everything assigned to you, alone or with others.' : tab === 'approvals' ? 'Work sent to you to be reviewed.' : 'Every task you can see across your projects.'}
        actions={<><button className="btn btn-ghost" onClick={exportCsv} title="Download what you see as a spreadsheet"><Download size={15} /> Export</button><div className="seg"><button className={view === 'list' ? 'on' : ''} onClick={() => setParam('view', '')}><List size={14} /> List</button><button className={view === 'board' ? 'on' : ''} onClick={() => setParam('view', 'board')}><Columns3 size={14} /> Board</button></div>
          <button className="btn btn-primary" onClick={() => actions.openCreate()}><Plus size={16} /> New task</button></>} />

      <Tabs value={tab} onChange={(k) => setParam('tab', k === 'all' ? '' : k)} tabs={[{ key: 'all', label: 'All tasks' }, { key: 'mine', label: 'My tasks' }, { key: 'approvals', label: 'Awaiting my review' }]} />

      <div className="filter-bar" style={{ marginTop: 16 }}>
        <div className="grow" style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted-2)' }} />
          <input className="input" style={{ paddingLeft: 34, width: '100%' }} placeholder="Search task titles…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <QuarterFilter value={quarter} onChange={(v) => { setQuarter(v); setParam('quarter', v); }} />
        {view === 'list' && <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option><option value="active">Still open</option>{COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>}
        <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="">Any severity</option>{SEVERITY_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">All projects</option>{projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
        {quarter && quarter !== quarterOf() && <button className="btn btn-ghost btn-sm" onClick={() => { setQuarter(quarterOf()); setParam('quarter', quarterOf()); }}>This quarter</button>}
      </div>

      <ErrorNote message={error} />

      {view === 'list' ? (
        list.loading && !list.data ? <TableSkeleton /> : rows.length === 0 ? (
          <Empty title={tab === 'mine' ? 'Nothing assigned to you' : tab === 'approvals' ? 'Nothing is waiting for your approval' : 'No tasks match'} hint="Try another quarter or clear the filters." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Task title</th><th>Project</th><th>Owners</th><th>Severity</th><th>Status</th><th>Progress</th><th>Start</th><th>End</th><th style={{ width: 44 }} /></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t._id} style={{ cursor: 'pointer' }} onClick={() => nav(`/tasks/${t._id}`)}>
                    <td style={{ maxWidth: 340 }}>
                      <Link to={`/tasks/${t._id}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 600 }}>{t.confidential && <Lock size={12} style={{ marginRight: 5 }} />}{t.title}</Link>
                      {t.parentTaskId && <div className="text-muted" style={{ fontSize: 11.5 }}>Subtask of {name(t.parentTaskId)}</div>}
                    </td>
                    <td>{name(t.projectId) || <span className="text-muted">—</span>}</td>
                    <td>{[name(t.ownerId), ...(t.coOwnerIds || []).map(name)].filter(Boolean).join(', ') || '—'}</td>
                    <td><SeverityBadge value={t.severity} /></td>
                    <td><StatusBadge status={t.status} hold={t.hold} /></td>
                    <td><ProgressBar value={t.percentComplete} status={t.status} /></td>
                    <td>{fdate(t.startDate)}</td>
                    <td style={{ color: overdue(t) ? 'var(--danger)' : undefined }}>{fdate(t.endDate || t.dueDate)}</td>
                    <td onClick={(e) => e.stopPropagation()}><RowActions permissions={t.permissions} onView={() => nav(`/tasks/${t._id}`)} onEdit={() => actions.openEdit(t)} onDelete={() => actions.remove(t)} extra={actions.extras(t)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : board.loading && !board.data ? <TableSkeleton /> : (
        <KanbanBoard
          columns={COLUMNS}
          itemsByColumn={boardItems}
          getId={(t: any) => t._id}
          onMove={move}
          renderCard={(t: any) => (
            <div className="card" style={{ padding: 12 }}>
              <div className="flex-between" style={{ gap: 6 }}>
                <SeverityBadge value={t.severity} />
                <span onPointerDown={(e) => e.stopPropagation()}><RowActions permissions={t.permissions} onView={() => nav(`/tasks/${t._id}`)} onEdit={() => actions.openEdit(t)} onDelete={() => actions.remove(t)} extra={actions.extras(t)} /></span>
              </div>
              <Link to={`/tasks/${t._id}`} onPointerDown={(e) => e.stopPropagation()} style={{ display: 'block', fontWeight: 600, fontSize: 13.5, margin: '8px 0 6px' }}>{t.confidential && <Lock size={12} style={{ marginRight: 4 }} />}{t.title}</Link>
              <div className="text-muted" style={{ fontSize: 12 }}>{[name(t.ownerId), ...(t.coOwnerIds || []).map(name)].filter(Boolean).join(', ') || 'Unassigned'}</div>
              <div style={{ marginTop: 6 }}><ProgressBar value={t.percentComplete} status={t.status} compact /></div>
              {(t.endDate || t.dueDate) && <div style={{ fontSize: 11.5, marginTop: 6, color: overdue(t) ? 'var(--danger)' : 'var(--muted-2)', display: 'flex', gap: 5, alignItems: 'center' }}><CalendarDays size={12} /> {fdate(t.startDate)} → {fdate(t.endDate || t.dueDate)}</div>}
            </div>
          )}
        />
      )}
      {actions.modals}
      <StatusChangeModal open={!!change} task={change?.task || null} initial={change?.to} onClose={() => setChange(null)} onDone={reload} />
    </div>
  );
}
