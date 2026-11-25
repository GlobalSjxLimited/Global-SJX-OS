import { useEffect, useState } from 'react';
import { Download, Plus, Search } from 'lucide-react';
import { RecordPanel } from '@/components/record/RecordPanel';
import type { EntityType } from '@/components/discussion/Discussion';
import { exportCsv, isoDate } from '@/lib/exportCsv';
import { fdate } from '@/lib/format';
import { RowActions } from '@/components/work/RowActions';
import { QuarterFilter } from '@/components/work/QuarterFilter';
import { api, apiErrorMessage } from '@/lib/api';
import { Modal } from './Modal';
import { TableSkeleton } from './Feedback';
import { EmptyState } from './Feedback';
import { Badge, statusTone } from './Badge';
import { Pagination } from './Pagination';
import { RichTextEditor } from './RichText';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'email' | 'file' | 'multiselect' | 'richtext';

export interface ResourceField {
  name: string;
  label: string;
  type: FieldType;
  options?: string[];
  optionsEndpoint?: string; // fetch [{_id, name|title}] and use as select options
  required?: boolean;
  full?: boolean; // spans both form-grid columns
}


export interface ResourceColumn {
  key: string; // dot-path supported, e.g. "employeeId.name"
  label: string;
  render?: (row: any) => React.ReactNode;
  badge?: boolean;
  /** plain value for the spreadsheet export (defaults to the key's value) */
  exportValue?: (row: any) => unknown;
}

export interface ResourceFilter { name: string; label: string; options: string[] }

interface ResourcePageProps {
  title: string;
  description?: string;
  endpoint: string; // e.g. "/vendors"
  columns: ResourceColumn[];
  fields: ResourceField[];
  createLabel?: string;
  canDelete?: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  /** Rendered between the page heading and the filters (e.g. a tab strip). */
  headerExtra?: React.ReactNode;
  extraHeaderAction?: React.ReactNode; // rendered next to the "New" button, e.g. a bulk-upload trigger
  rowActions?: (row: any) => React.ReactNode; // extra per-row buttons (e.g. "Updates")
  refreshKey?: number; // bump to force a reload from outside (e.g. after a bulk action completes)
  /** Singular name used in dialogs, e.g. "Risk" → "New Risk" / "Edit Risk" / "Delete Risk". */
  itemName?: string;
  /** Show a quarter filter (sent to the API as ?quarter=YYYY-Qn). */
  quarterFilter?: boolean;
  /** Extra dropdown filters, each sent to the API as ?name=value. */
  filters?: ResourceFilter[];
  /** When set, an opened record shows who changed it, its files and its comment thread. */
  entityType?: EntityType;
  /** which kinds of files can be attached (defaults to all) */
  fileKinds?: string[];
}

function getPath(obj: any, path: string) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function ResourcePage({ title, description, endpoint, columns, fields, createLabel = 'New', canDelete = true, canCreate = true, canEdit = true, extraHeaderAction, headerExtra, refreshKey, rowActions, itemName, quarterFilter, filters, entityType, fileKinds }: ResourcePageProps) {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{ page: number; pages: number; total: number } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [quarter, setQuarter] = useState('');
  const [fv, setFv] = useState<Record<string, string>>({});
  const [created, setCreated] = useState({ from: '', to: '' });
  const noun = itemName || title.replace(/ies$/, 'y').replace(/s$/, '');
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, Array<{ value: string; label: string }>>>({});
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  useEffect(() => {
    fields.forEach((f) => {
      if (f.optionsEndpoint && !dynamicOptions[f.name]) {
        api.get(f.optionsEndpoint).then((res) => {
          const items = res.data.data as any[];
          setDynamicOptions((prev) => ({
            ...prev,
            [f.name]: items.map((it) => ({ value: it._id, label: it.name || it.title || it.email || it._id })),
          }));
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  useEffect(() => {
    const t = setTimeout(() => load(), q ? 300 : 0); // debounce free-text search, load immediately on page/endpoint change
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, page, q, refreshKey, quarter, fv, created]);

  useEffect(() => {
    setPage(1); // reset to first page whenever the search term changes
  }, [q]);

  /** everything the filter bar adds to the request */
  function queryFilters() {
    return { ...Object.fromEntries(Object.entries(fv).filter(([, v]) => v)), ...(created.from ? { createdFrom: created.from } : {}), ...(created.to ? { createdTo: created.to } : {}) };
  }

  /** Download everything that matches the current search and filters, not just the page on screen. */
  async function doExport() {
    try {
      const all: any[] = [];
      for (let p = 1; p <= 30; p++) {
        const res = await api.get(endpoint, { params: { page: p, limit: 100, ...(q ? { q } : {}), ...(quarter ? { quarter } : {}), ...queryFilters() } });
        all.push(...res.data.data);
        if (!res.data.pagination || p >= res.data.pagination.pages) break;
      }
      const plain = (v: any): unknown => (Array.isArray(v) ? v.map(plain).join('; ') : v && typeof v === 'object' ? v.name || v.title || v.email || '' : v);
      exportCsv(title.toLowerCase().replace(/\s+/g, '-'), [
        ...columns.map((c) => ({ label: c.label, value: (row: any) => plain(c.exportValue ? c.exportValue(row) : getPath(row, c.key)) })),
        { label: 'Date created', value: (r: any) => isoDate(r.createdAt) }, { label: 'Created by', value: (r: any) => r.createdBy?.name }, { label: 'Date modified', value: (r: any) => isoDate(r.updatedAt) }, { label: 'Modified by', value: (r: any) => r.updatedBy?.name },
      ], all);
    } catch (err) { showError(apiErrorMessage(err)); }
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(endpoint, { params: { page, limit: 20, ...(q ? { q } : {}), ...(quarter ? { quarter } : {}), ...queryFilters() } });
      setItems(res.data.data);
      setPagination(res.data.pagination || null);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setViewOnly(false);
    const initial: Record<string, any> = {};
    fields.forEach((f) => (initial[f.name] = f.type === 'multiselect' ? [] : ''));
    setForm(initial);
    setModalOpen(true);
  }

  const mayEdit = (row: any) => (row.permissions ? !!row.permissions.edit : canEdit);
  const mayDelete = (row: any) => (row.permissions ? !!row.permissions.delete : canDelete);

  function openRow(row: any, mode: 'view' | 'edit') {
    setViewOnly(mode === 'view' || !mayEdit(row));
    setEditing(row);
    const initial: Record<string, any> = {};
    fields.forEach((f) => {
      const v = row[f.name];
      if (f.type === 'multiselect') {
        initial[f.name] = Array.isArray(v) ? v.map((item: any) => (typeof item === 'object' && item?._id ? item._id : item)) : [];
      } else {
        initial[f.name] = f.type === 'date' && v ? String(v).slice(0, 10) : v ?? '';
      }
    });
    setForm(initial);
    setModalOpen(true);
  }

  async function handleFileUpload(fieldName: string, file: File) {
    setUploadingField(fieldName);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await api.post('/uploads', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      setForm((f) => ({ ...f, [fieldName]: res.data.data.url, [`${fieldName}Name`]: res.data.data.originalName }));
      showSuccess('File uploaded.');
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setUploadingField(null);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`${endpoint}/${editing._id}`, form);
        showSuccess('Saved.');
      } else {
        await api.post(endpoint, form);
        showSuccess('Created.');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: any) {
    const ok = await confirm({
      title: `Delete ${noun.toLowerCase()}`,
      message: `Delete "${row.name || row.title || `this ${noun.toLowerCase()}`}"? It will be archived and can be restored by an administrator.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`${endpoint}/${row._id}`);
      showSuccess('Deleted.');
      load();
    } catch (err) {
      showError(apiErrorMessage(err));
    }
  }

  const filtered = items; // filtering now happens server-side via the `q` param

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {extraHeaderAction}
          <button className="btn btn-ghost" onClick={doExport} title="Download what matches the search and filters"><Download size={15} /> Export</button>
          <button className="btn btn-primary" onClick={openCreate} disabled={!canCreate} title={!canCreate ? "You don't have permission to create records here" : undefined}>
            <Plus size={16} /> {createLabel}
          </button>
        </div>
      </div>
      {headerExtra}

      <div style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="topbar-search" style={{ maxWidth: 320, flex: 1 }}>
          <Search />
          <input placeholder={`Search ${title.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {quarterFilter && <QuarterFilter value={quarter} onChange={(v) => { setQuarter(v); setPage(1); }} />}
        {(filters || []).map((f) => (
          <select key={f.name} className="input" style={{ width: 'auto' }} aria-label={f.label} value={fv[f.name] || ''} onChange={(e) => { setFv({ ...fv, [f.name]: e.target.value }); setPage(1); }}>
            <option value="">{f.label}: all</option>{f.options.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}</select>
        ))}
        <label style={{ fontSize: 12.5 }}>Created from <input className="input" type="date" style={{ width: 'auto' }} value={created.from} onChange={(e) => { setCreated({ ...created, from: e.target.value }); setPage(1); }} /></label>
        <label style={{ fontSize: 12.5 }}>to <input className="input" type="date" style={{ width: 'auto' }} value={created.to} onChange={(e) => { setCreated({ ...created, to: e.target.value }); setPage(1); }} /></label>
      </div>

      <div className="table-wrap">
        {loading ? (
          <TableSkeleton cols={columns.length} />
        ) : error ? (
          <EmptyState message={error} />
        ) : filtered.length === 0 ? (
          <EmptyState message={`No ${title.toLowerCase()} yet. Create the first one.`} />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th>Modified</th>
                {rowActions && <th></th>}
                <th style={{ width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row._id} onClick={() => openRow(row, 'view')} style={{ cursor: 'pointer' }}>
                  {columns.map((c) => {
                    const value = c.render ? c.render(row) : getPath(row, c.key);
                    return <td key={c.key}>{c.badge ? <Badge tone={statusTone(String(value))}>{String(value ?? '—').replace(/_/g, ' ')}</Badge> : value ?? '—'}</td>;
                  })}
                  <td style={{ fontSize: 12 }} title={row.updatedBy?.name ? `Modified by ${row.updatedBy.name}${row.updatedFrom?.device ? ` · ${row.updatedFrom.device}` : ''}${row.updatedFrom?.ip ? ` (${row.updatedFrom.ip})` : ''}` : undefined}>{fdate(row.updatedAt)}</td>
                  {rowActions && <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>{rowActions(row)}</td>}
                  <td style={{ width: 44 }} onClick={(e) => e.stopPropagation()}>
                    <RowActions permissions={{ view: true, edit: mayEdit(row), delete: mayDelete(row) }} onView={() => openRow(row, 'view')} onEdit={() => openRow(row, 'edit')} onDelete={() => handleDelete(row)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pagination && <Pagination page={pagination.page} pages={pagination.pages} total={pagination.total} onChange={setPage} />}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `${viewOnly ? 'View' : 'Edit'} ${noun}` : `New ${noun}`}
        footer={
          viewOnly ? (
            <>
              <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Close</button>
              {editing && mayEdit(editing) && <button className="btn btn-primary" onClick={() => setViewOnly(false)}>Edit</button>}
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </>
          )
        }
      >
        <fieldset disabled={viewOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="form-grid">
          {fields.map((f) => (
            <div className={`field ${f.full ? 'full' : ''}`} key={f.name}>
              <label>{f.label}{f.required && ' *'}</label>
              {f.type === 'richtext' ? (
                <RichTextEditor value={form[f.name] || ''} onChange={(html) => setForm((prev) => ({ ...prev, [f.name]: html }))} />
              ) : f.type === 'textarea' ? (
                <textarea className="input" value={form[f.name] || ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />
              ) : f.type === 'select' ? (
                <select className="input" value={form[f.name] || ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}>
                  <option value="">Select…</option>
                  {(f.optionsEndpoint ? dynamicOptions[f.name] || [] : (f.options || []).map((o) => ({ value: o, label: o }))).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : f.type === 'file' ? (
                <div>
                  <input
                    type="file"
                    onChange={(e) => e.target.files?.[0] && handleFileUpload(f.name, e.target.files[0])}
                    style={{ fontSize: 12.5 }}
                  />
                  {uploadingField === f.name && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Uploading…</div>}
                  {form[f.name] && uploadingField !== f.name && (
                    <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 4 }}>Uploaded: {form[`${f.name}Name`] || form[f.name]}</div>
                  )}
                </div>
              ) : f.type === 'multiselect' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 160, overflowY: 'auto', border: '1px solid var(--line-strong)', borderRadius: 10, padding: 10 }}>
                  {(f.optionsEndpoint ? dynamicOptions[f.name] || [] : (f.options || []).map((o) => ({ value: o, label: o }))).map((o) => {
                    const selected: string[] = form[f.name] || [];
                    const isSelected = selected.includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            [f.name]: isSelected ? selected.filter((v) => v !== o.value) : [...selected, o.value],
                          })
                        }
                        className="badge"
                        style={{
                          cursor: 'pointer', border: '1px solid var(--line-strong)',
                          background: isSelected ? 'var(--accent)' : 'var(--surface-2)',
                          color: isSelected ? '#fff' : 'var(--text)',
                        }}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                  {f.optionsEndpoint && !dynamicOptions[f.name]?.length && <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>Loading…</span>}
                </div>
              ) : (
                <input
                  className="input"
                  type={f.type}
                  value={form[f.name] || ''}
                  onChange={(e) => setForm({ ...form, [f.name]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
        </fieldset>
        {entityType && editing?._id && <RecordPanel entityType={entityType} entityId={editing._id} doc={editing} kinds={fileKinds} />}
      </Modal>
    </div>
  );
}
