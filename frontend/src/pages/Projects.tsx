import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Plus, Search } from 'lucide-react';
import { PROJECT_LABEL, PROJECT_STATUS_OPTIONS } from '@/lib/projectStatus';
import { exportCsv, isoDate } from '@/lib/exportCsv';
import { api, apiErrorMessage } from '@/lib/api';
import { Badge, statusTone } from '@/components/ui/Badge';
import { EmptyState, TableSkeleton } from '@/components/ui/Feedback';
import { PageHead } from '@/components/ui/PageHead';
import { useApi } from '@/lib/useApi';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useQuickCreate } from '@/lib/useQuickCreate';
import { can } from '@/lib/permissions';
import { fdate, label } from '@/lib/format';
import { QuarterFilter } from '@/components/work/QuarterFilter';
import { RowActions } from '@/components/work/RowActions';
import { ProjectModal } from '@/components/work/ProjectModal';

export function Projects() {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [quarter, setQuarter] = useState('');
  const [status, setStatus] = useState('');
  const [modal, setModal] = useState<null | { project?: any }>(null);
  const canCreate = can.manageProjects(user?.role);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  const params = useMemo(() => ({ ...(debounced ? { q: debounced } : {}), ...(quarter ? { quarter } : {}), ...(status ? { status } : {}) }), [debounced, quarter, status]);
  const { data, loading, reload } = useApi<any[]>('/projects', params);

  useQuickCreate(() => setModal({}));
  useEffect(() => { if (sp.get('clientId')) setModal({}); /* arriving from a client page */ // eslint-disable-next-line
  }, []);

  async function remove(p: any) {
    if (!(await confirm({ title: 'Delete project', message: `Delete “${p.name}”?`, confirmLabel: 'Delete', danger: true }))) return;
    try { await api.delete(`/projects/${p._id}`); showSuccess('Project deleted.'); reload(); } catch (err) { showError(apiErrorMessage(err)); }
  }

  const rows = data || [];
  return (
    <div>
      <PageHead title="Projects" subtitle="Delivery across every client engagement and internal initiative." actions={<><button className="btn btn-ghost" onClick={() => exportCsv('projects', [{ label: 'Project', value: (p) => p.name }, { label: 'Client', value: (p) => p.clientId?.name }, { label: 'Status', value: (p) => PROJECT_LABEL[p.status] || p.status }, { label: 'Health', value: (p) => p.health }, { label: 'Manager', value: (p) => p.projectManagerId?.name }, { label: 'Start date', value: (p) => isoDate(p.startDate) }, { label: 'End date', value: (p) => isoDate(p.endDate) }, { label: 'Budget', value: (p) => p.budget }, { label: 'Date created', value: (p) => isoDate(p.createdAt) }, { label: 'Created by', value: (p) => p.createdBy?.name }, { label: 'Date modified', value: (p) => isoDate(p.updatedAt) }, { label: 'Modified by', value: (p) => p.updatedBy?.name }], rows)}><Download size={15} /> Export</button>{canCreate ? <button className="btn btn-primary" onClick={() => setModal({})}><Plus size={16} /> New project</button> : null}</>} />
      <div className="filter-bar">
        <div className="grow" style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted-2)' }} /><input className="input" style={{ paddingLeft: 34, width: '100%' }} placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <QuarterFilter value={quarter} onChange={setQuarter} />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{PROJECT_STATUS_OPTIONS.map((o) => o.key).map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      </div>
      {loading && !data ? <TableSkeleton /> : rows.length === 0 ? <EmptyState message="No projects match." /> : (
        <div className="grid-3">
          {rows.map((p) => (
            <div key={p._id} className="card card-hover" style={{ cursor: 'pointer' }} onClick={() => nav(`/projects/${p._id}`)}>
              <div className="flex-between" style={{ marginBottom: 12 }}>
                <div className="row-gap"><Badge tone={statusTone(p.status)}>{PROJECT_LABEL[p.status] || label(p.status)}</Badge><Badge tone={statusTone(p.health)}>{label(p.health)}</Badge></div>
                <span onClick={(e) => e.stopPropagation()}><RowActions permissions={p.permissions} onView={() => nav(`/projects/${p._id}`)} onEdit={() => setModal({ project: p })} onDelete={() => remove(p)} /></span>
              </div>
              <h3 style={{ fontSize: 16.5, marginBottom: 8 }}><Link to={`/projects/${p._id}`} onClick={(e) => e.stopPropagation()}>{p.name}</Link></h3>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>{p.clientId?.name || 'Internal'}</p>
              <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>{fdate(p.startDate)} → {p.endDate ? fdate(p.endDate) : 'ongoing'}</div>
              {['on_hold', 'paused'].includes(p.status) && p.holdReason && <div style={{ fontSize: 12, color: 'var(--gold)', marginTop: 6 }}>Why: {p.holdReason}</div>}
            </div>
          ))}
        </div>
      )}
      <ProjectModal open={!!modal} project={modal?.project} defaults={{ clientId: sp.get('clientId') || undefined }} onClose={() => setModal(null)} onSaved={reload} />
    </div>
  );
}
