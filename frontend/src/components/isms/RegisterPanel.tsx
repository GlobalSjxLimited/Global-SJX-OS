import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Plus, Search, Upload, History } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useApi } from '@/lib/useApi';
import { Empty, ErrorNote, Loading } from '@/components/ui/PageHead';
import { Badge, statusTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { fdate, fdatetime, filenameFrom, saveBlob, toInputDate } from '@/lib/format';
import { ClipboardCheck, FileText } from 'lucide-react';

export interface Col { key: string; label: string; type?: 'text' | 'longtext' | 'date' | 'select' | 'number' | 'yn' | 'url'; options?: string[]; computed?: boolean; list?: boolean }
export interface RegDef { key: string; title: string; docId: string; clause: string; group: string; description: string; statuses: string[]; closedStatuses: string[]; defaultStatus: string; titleKey: string; cols: Col[]; policy: string; stats: { total: number; open: number; overdue: number } }

const show = (c: Col, v: any) => {
  if (v === undefined || v === null || v === '') return '—';
  if (c.type === 'date') return fdate(v);
  return String(v).length > 90 ? `${String(v).slice(0, 90)}…` : String(v);
};
const tone = (s: string): any => (s === 'Overdue' || s === 'FAIL' || s === 'Major' || s === 'Non-compliant' || s === 'Expired' || s === 'Gap' ? 'danger' : statusTone(s.toLowerCase().replace(/ /g, '_')));

export async function downloadExport(key: string): Promise<void> {
  const res = await api.get(`/isms/export/${key}`, { responseType: 'blob' });
  saveBlob(res.data, filenameFrom(res.headers['content-disposition'], `${key}.xlsx`));
}

export function RegisterPanel({ def, onChanged }: { def: RegDef; onChanged: () => void }) {
  const { showError, showSuccess } = useToast();
  const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [late, setLate] = useState(false); const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setStatus(''); setQ(''); setLate(false); setPage(1); }, [def.key]);
  const { data, extra, loading, error, reload } = useApi<any[]>(`/isms/records/${def.key}`, { status: status || undefined, q: q || undefined, overdue: late || undefined, page, limit: 25 });
  const listCols = useMemo(() => def.cols.filter((c) => c.list), [def]);
  const pages = extra?.pagination?.pages || 1;

  async function exportIt() { setBusy('export'); try { await downloadExport(def.key); } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(''); } }
  async function importIt(f?: File) {
    if (!f) return; setBusy('import');
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('register', def.key);
      const r = await api.post('/isms/import', fd);
      const made = (r.data.data.sheets || []).reduce((n: number, s: any) => n + s.created, 0); const dup = (r.data.data.sheets || []).reduce((n: number, s: any) => n + s.duplicates, 0);
      showSuccess(made ? `Imported ${made} row(s)${dup ? `, ${dup} already existed` : ''}.` : dup ? `Nothing new – ${dup} row(s) already exist.` : 'No rows matched this register in that file.');
      reload(); onChanged();
    } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontWeight: 650, fontSize: 16 }}>{def.title}</div>
            <div className="text-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{def.docId} · ISO/IEC 27001 {def.clause} · evidences “{def.policy}”</div>
            <div style={{ fontSize: 13.5, marginTop: 6 }}>{def.description}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={15} /> New</button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={exportIt}><Download size={15} /> {busy === 'export' ? 'Building…' : 'Excel'}</button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => fileRef.current?.click()} title="Import rows from an existing company spreadsheet (same column headings)"><Upload size={15} /> {busy === 'import' ? 'Importing…' : 'Import'}</button>
            <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => importIt(e.target.files?.[0])} />
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 10, top: 11, opacity: 0.5 }} /><input className="input" style={{ paddingLeft: 30, width: 230 }} placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <select className="input" style={{ width: 190 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{def.statuses.map((s) => <option key={s}>{s}</option>)}</select>
        <label style={{ fontSize: 13.5 }}><input type="checkbox" checked={late} onChange={(e) => { setLate(e.target.checked); setPage(1); }} /> Overdue only</label>
        <span className="text-muted" style={{ fontSize: 12.5, marginLeft: 'auto' }}>{def.stats.total} records · {def.stats.open} open · {def.stats.overdue} overdue</span>
      </div>
      <ErrorNote message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty title="Nothing here yet" hint="Add a record, or import your existing spreadsheet with the Import button." /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Ref</th>{listCols.map((c) => <th key={c.key}>{c.label.replace(/ \(.*\)$/, '')}</th>)}<th>Status</th><th>Owner</th></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r._id} onClick={() => setEdit(r)} style={{ cursor: 'pointer' }}>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{r.refNo}{r.source === 'auto' && <span title="Created automatically" style={{ marginLeft: 4 }}>⚙</span>}</td>
                  {listCols.map((c) => <td key={c.key} style={{ maxWidth: 280 }}>{['classification', 'rClassification', 'checks', 'targetMet', 'level'].includes(c.key) && r.data?.[c.key] ? <Badge tone={tone(String(r.data[c.key]))}>{r.data[c.key]}</Badge> : show(c, r.data?.[c.key])}</td>)}
                  <td><Badge tone={tone(r.status)}>{r.status}</Badge></td>
                  <td>{r.ownerName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, alignItems: 'center' }}><button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="text-muted">Page {page} of {pages}</span><button className="btn btn-ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>}
      {edit && <RecordModal def={def} rec={edit._id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); onChanged(); }} />}
    </div>
  );
}

function RecordModal({ def, rec, onClose, onSaved }: { def: RegDef; rec: any | null; onClose: () => void; onSaved: () => void }) {
  const { showError, showSuccess } = useToast();
  const people = useApi<any[]>('/employees/directory/list');
  const [data, setData] = useState<Record<string, any>>(() => { const d: Record<string, any> = {}; for (const c of def.cols) { const v = rec?.data?.[c.key]; if (v !== undefined) d[c.key] = c.type === 'date' ? toInputDate(v) : v; } return d; });
  const [status, setStatus] = useState(rec?.status || def.defaultStatus);
  const [ownerId, setOwnerId] = useState<string>(rec?.ownerId || '');
  const [evidence, setEvidence] = useState(rec?.evidenceUrl || '');
  const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [saving, setSaving] = useState(false); const [del, setDel] = useState<string | null>(null);
  const set = (k: string, v: any) => setData((d) => ({ ...d, [k]: v }));

  async function save() {
    setSaving(true); setErr('');
    const clean: Record<string, any> = {};
    for (const c of def.cols) if (!c.computed) clean[c.key] = data[c.key] ?? '';
    const owner = (people.data || []).find((p) => p._id === ownerId);
    try {
      const body: any = { data: clean, ownerId: ownerId || null, ownerName: owner?.name ?? (ownerId ? undefined : ''), evidenceUrl: evidence || '', note: note || undefined };
      if (rec) { if (status !== rec.status) body.status = status; await api.patch(`/isms/records/${def.key}/${rec._id}`, body); }
      else { body.status = status; await api.post(`/isms/records/${def.key}`, body); }
      showSuccess(rec ? 'Saved.' : 'Added.'); onSaved();
    } catch (e) { setErr(apiErrorMessage(e)); } finally { setSaving(false); }
  }
  async function remove() {
    if (!del || del.trim().length < 5) { showError('Give a reason (at least 5 characters).'); return; }
    try { await api.delete(`/isms/records/${def.key}/${rec._id}`, { data: { reason: del } }); showSuccess('Deleted (kept in the audit log).'); onSaved(); } catch (e) { showError(apiErrorMessage(e)); }
  }

  return (
    <Modal open onClose={onClose} size="wide" title={rec ? `${rec.refNo} · ${def.title}` : `New – ${def.title}`}
      footer={<>
        {rec && <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => setDel(del === null ? '' : null)}>Delete…</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      {err && <div className="card" style={{ borderLeft: '3px solid var(--danger)', marginBottom: 12, fontSize: 13.5 }}>{err}</div>}
      {del !== null && <div className="field"><label>Why is this being deleted? *</label><div style={{ display: 'flex', gap: 8 }}><input className="input" value={del} onChange={(e) => setDel(e.target.value)} /><button className="btn btn-primary" onClick={remove}>Confirm delete</button></div></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12 }}>
        <div className="field"><label>Status</label><select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>{def.statuses.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="field"><label>Owner (gets the reminders)</label><select className="input" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}><option value="">— ISMS managers —</option>{(people.data || []).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></div>
        <div className="field"><label>Evidence link</label><input className="input" placeholder="https://…" value={evidence} onChange={(e) => setEvidence(e.target.value)} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12, marginTop: 6 }}>
        {def.cols.map((c) => (
          <div className="field" key={c.key} style={c.type === 'longtext' ? { gridColumn: '1 / -1' } : undefined}>
            <label>{c.label}{c.key === def.titleKey ? ' *' : ''}{c.computed ? ' (calculated)' : ''}</label>
            {c.computed ? <div className="input" style={{ opacity: 0.8, minHeight: 38, display: 'flex', alignItems: 'center' }}>{rec?.data?.[c.key] !== undefined && rec?.data?.[c.key] !== '' ? (c.type === 'date' ? fdate(rec.data[c.key]) : String(rec.data[c.key])) : '—'}</div>
              : c.type === 'longtext' ? <textarea className="input" rows={3} value={data[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)} />
              : c.type === 'select' || c.type === 'yn' ? <select className="input" value={data[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)}><option value="">—</option>{(c.options || []).filter(Boolean).map((o) => <option key={o}>{o}</option>)}</select>
              : <input className="input" type={c.type === 'date' ? 'date' : c.type === 'number' ? 'number' : 'text'} step="any" value={data[c.key] ?? ''} onChange={(e) => set(c.key, e.target.value)} />}
          </div>
        ))}
      </div>
      {rec && def.key === 'annex_a' && rec.data?.applicable !== 'No' && <ControlTest rec={rec} onDone={onSaved} />}
      {rec && def.key === 'deletion' && rec.status === 'Verified' && <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={async () => { try { const r = await api.get(`/isms/records/deletion/${rec._id}/certificate`, { responseType: 'blob' }); saveBlob(r.data, filenameFrom(r.headers['content-disposition'], 'certificate.pdf')); } catch (e) { showError(apiErrorMessage(e)); } }}><FileText size={14} /> Destruction certificate (PDF)</button>}
      {rec && <div className="field"><label>Note for the history (optional)</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>}
      {rec?.history?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}><History size={14} /> History</div>
          <div style={{ display: 'grid', gap: 4, marginTop: 6, fontSize: 12.5, maxHeight: 150, overflow: 'auto' }}>
            {[...rec.history].reverse().map((h: any, i: number) => <div key={i} className="text-muted">{fdatetime(h.at)} · <b>{h.byName || 'system'}</b> · {h.action}{h.note ? ` – ${h.note}` : ''}</div>)}
          </div>
        </div>
      )}
    </Modal>
  );
}


function ControlTest({ rec, onDone }: { rec: any; onDone: () => void }) {
  const { showError, showSuccess } = useToast();
  const [result, setResult] = useState('Pass'); const [notes, setNotes] = useState(''); const [url, setUrl] = useState(''); const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await api.post(`/isms/records/annex_a/${rec._id}/test`, { result, notes: notes || undefined, evidenceUrl: url || undefined });
      const car = r.data.data.car;
      showSuccess(car ? `Test recorded. Corrective action ${car.refNo} ${car.created ? 'opened' : 'updated'}.` : 'Test recorded.'); onDone();
    } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <div className="card" style={{ marginTop: 12, display: 'grid', gap: 8, borderLeft: '3px solid var(--accent)' }}>
      <strong style={{ fontSize: 13.5, display: 'flex', gap: 6, alignItems: 'center' }}><ClipboardCheck size={14} /> Record a control test</strong>
      <div className="text-muted" style={{ fontSize: 12.5 }}>{rec.data?.test}. A failed test opens a corrective action by itself and brings the retest forward.</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 130 }} value={result} onChange={(e) => setResult(e.target.value)}><option>Pass</option><option>Partial</option><option>Fail</option></select>
        <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder={result === 'Pass' ? 'What you checked (optional)' : 'What failed? (required)'} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <input className="input" style={{ width: 230 }} placeholder="Evidence link (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Saving…' : 'Save test'}</button>
      </div>
    </div>
  );
}
