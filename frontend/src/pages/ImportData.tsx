import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHead } from '@/components/ui/PageHead';

interface Target { key: string; title: string; help: string; accept: string; multi?: boolean; modules: string[]; endpoint: string; fileField: string; options?: 'policies' | 'assets' }
const TARGETS: Target[] = [
  { key: 'registers', title: 'ISMS registers', help: 'Risk register, context, legal, change log, CAR/OFI/observation logs, BYOD, communication and training calendars. Use the company workbook as it is; sheets are recognised by name and heading. Already-present rows are skipped.', accept: '.xlsx', modules: ['isms'], endpoint: '/isms/import', fileField: 'file' },
  { key: 'assets', title: 'Assets', help: 'The ISMS Asset Register workbook (digital assets, software, hardware, people, facilities…). Keeps your asset IDs. Does not run the risk engine; do that from Assets afterwards if you want threats suggested.', accept: '.xlsx', modules: ['assets'], endpoint: '/import/assets', fileField: 'file', options: 'assets' },
  { key: 'vendors', title: 'Suppliers / vendors', help: 'The suppliers master list (company, contact, phone, e-mail, address, purpose, status).', accept: '.xlsx', modules: ['vendors', 'isms'], endpoint: '/import/vendors', fileField: 'file' },
  { key: 'maintenance', title: 'Equipment maintenance schedule', help: 'The Equipment Maintenance Schedule and Log workbook (frequency, last done, next due).', accept: '.xlsx', modules: ['isms'], endpoint: '/import/maintenance', fileField: 'file' },
  { key: 'threats', title: 'Threat intelligence register', help: 'The company Threat Intelligence Register workbook; each row becomes an item in the Threat Intelligence module (TLP AMBER).', accept: '.xlsx', modules: ['threat_intel', 'isms'], endpoint: '/import/threats', fileField: 'file' },
  { key: 'policies', title: 'Policies and procedures (Word)', help: 'Select several .docx files. They become draft policies with their text, so you can review and approve each one. Duplicates by title are skipped.', accept: '.docx', multi: true, modules: ['policies'], endpoint: '/import/policies', fileField: 'files', options: 'policies' },
];

export function ImportData() {
  const { user } = useAuth(); const { showError, showSuccess } = useToast();
  const allowed = (t: Target) => user?.role === 'super_admin' || t.modules.some((m) => user?.modules?.includes(m));
  const leader = ['super_admin', 'ceo', 'coo'].includes(user?.role || '');
  return (<div>
    <PageHead title="Import data" subtitle="Load your existing spreadsheets and documents. Always preview first; nothing is written until you confirm, and repeating an import never creates duplicates." />
    <div style={{ display: 'grid', gap: 14 }}>{TARGETS.filter(allowed).map((t) => <Card key={t.key} t={t} leader={leader} showError={showError} showSuccess={showSuccess} />)}</div>
  </div>);
}

function Card({ t, leader, showError, showSuccess }: { t: Target; leader: boolean; showError: (m: string) => void; showSuccess: (m: string) => void }) {
  const ref = useRef<HTMLInputElement>(null); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); const [res, setRes] = useState<any>(null); const [previewed, setPreviewed] = useState(false);
  const [publish, setPublish] = useState(false); const [cat, setCat] = useState('');
  async function go(dryRun: boolean) {
    if (!files.length) return; setBusy(true); setRes(null);
    try {
      const fd = new FormData(); files.forEach((f) => fd.append(t.fileField, f)); fd.append('dryRun', String(dryRun)); if (publish) fd.append('publish', 'true'); if (cat) fd.append('category', cat);
      const r = (await api.post(t.endpoint, fd)).data;
      const d = t.key === 'registers' ? { created: r.sheets.reduce((n: number, s: any) => n + s.created, 0), duplicates: r.sheets.reduce((n: number, s: any) => n + s.duplicates, 0), skipped: r.sheets.reduce((n: number, s: any) => n + s.skipped, 0), ignored: r.ignored, samples: r.sheets.filter((s: any) => s.created).map((s: any) => `${s.register}: ${s.created} from "${s.sheet}"`), notes: [] } : r.data;
      setRes({ ...d, dryRun }); if (t.key === 'registers') setPreviewed(true); else setPreviewed(dryRun);
      if (!dryRun) showSuccess(`${d.created} imported`);
    } catch (e) { showError(apiErrorMessage(e)); } finally { setBusy(false); }
  }
  const isReg = t.key === 'registers';
  return (<div className="card" style={{ display: 'grid', gap: 10 }}>
    <b>{t.title}</b><div className="text-muted" style={{ fontSize: 13.5 }}>{t.help}</div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input ref={ref} type="file" accept={t.accept} multiple={t.multi} style={{ display: 'none' }} onChange={(e) => { setFiles(Array.from(e.target.files || [])); setRes(null); setPreviewed(false); }} />
      <button className="btn btn-ghost" onClick={() => ref.current?.click()}><FileUp size={14} /> Choose {t.multi ? 'files' : 'file'}</button>
      <span className="text-muted" style={{ fontSize: 13 }}>{files.length ? (files.length === 1 ? files[0].name : `${files.length} files`) : 'Nothing chosen'}</span>
      {t.options === 'assets' && <select className="input" style={{ width: 200 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category for unrecognised sheets"><option value="">Unrecognised sheets: skip</option>{[['hardware', 'Hardware'], ['software', 'Software'], ['information', 'Information'], ['cloud', 'Cloud'], ['network', 'Network'], ['services', 'Services'], ['facilities', 'Facilities'], ['people', 'People']].map(([k, l]) => <option key={k} value={k}>Unrecognised sheets: {l}</option>)}</select>}
      {t.options === 'policies' && leader && <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Import as approved (otherwise drafts)</label>}
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      {!isReg && <button className="btn btn-ghost" disabled={busy || !files.length} onClick={() => go(true)}>{busy ? 'Working…' : 'Preview'}</button>}
      <button className="btn btn-primary" disabled={busy || !files.length || (!isReg && !previewed)} onClick={() => go(false)}>{isReg ? 'Import' : 'Import now'}</button>
      {!isReg && !previewed && files.length > 0 && <span className="text-muted" style={{ fontSize: 12.5, alignSelf: 'center' }}>Preview first</span>}
    </div>
    {res && <div role="status" style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 10, fontSize: 14 }}>
      <b>{res.dryRun ? 'Preview: ' : 'Done: '}{res.created} {res.dryRun ? 'would be added' : 'added'}</b>, {res.duplicates} already there{res.skipped ? `, ${res.skipped} skipped` : ''}.
      {res.samples?.length > 0 && <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>{res.samples.slice(0, 10).map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>}
      {res.ignored?.length > 0 && <div className="text-muted" style={{ fontSize: 12.5 }}>Not recognised: {res.ignored.join(', ')}</div>}</div>}
  </div>);
}
