import { useState } from 'react';
import { Crown } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { Loading, ErrorNote } from '@/components/ui/PageHead';
import { PeoplePicker } from './PeoplePicker';

/**
 * Who heads each department. These people receive tasks that are "to be reviewed", delayed-task escalations,
 * and are asked to approve marketing campaigns. A department can have up to six heads.
 */
export function DepartmentHeadsModal({ onClose }: { onClose: () => void }) {
  const { showError, showSuccess } = useToast();
  const { data, loading, error, reload } = useApi<any>('/employees/department-heads/list');
  const [editing, setEditing] = useState<{ department: string; ids: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = !!data?.canEdit;

  async function save() {
    if (!editing) return;
    setBusy(true);
    try { await api.put(`/employees/department-heads/${encodeURIComponent(editing.department)}`, { userIds: editing.ids }); showSuccess(`Heads of ${editing.department} saved.`); setEditing(null); reload(); }
    catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} size="wide" title="Department heads" footer={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>The head of a department receives work that is sent for review, tasks that are delayed, and campaign approvals for their department. {canEdit ? 'Choose one or more people for each department.' : 'Only HR, the COO, the CEO or an admin can change this.'}</p>
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : (
        <div className="table-wrap"><table className="data-table" style={{ cursor: 'default' }}>
          <thead><tr><th>Department</th><th>People</th><th>Head(s)</th>{canEdit && <th style={{ width: 90 }} />}</tr></thead>
          <tbody>{data?.departments.map((d: any) => (
            <tr key={d.department} style={{ cursor: 'default' }}>
              <td><strong>{d.department}</strong></td>
              <td>{d.members}</td>
              <td>{editing && editing.department === d.department
                ? <PeoplePicker value={editing.ids} onChange={(ids) => setEditing({ department: d.department, ids })} options={data.people} placeholder="Search people…" />
                : d.heads.length ? d.heads.map((h: any) => <span key={h._id} className="badge badge-gold" style={{ marginRight: 6 }}><Crown size={11} /> {h.name}</span>) : <span className="text-muted">No head set — reviews go to the owner’s manager, then HR/CEO</span>}</td>
              {canEdit && <td>{editing?.department === d.department
                ? <div className="row-gap"><button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>Save</button><button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button></div>
                : <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ department: d.department, ids: d.heads.map((h: any) => h._id) })}>Change</button>}</td>}
            </tr>))}</tbody></table></div>
      )}
    </Modal>
  );
}
