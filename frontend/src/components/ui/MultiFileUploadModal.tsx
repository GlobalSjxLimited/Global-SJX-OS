import { useState } from 'react';
import { UploadCloud, X, File as FileIcon } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { Modal } from './Modal';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';

const DOC_CATEGORIES = ['Corporate', 'Legal', 'Finance', 'HR', 'Clients', 'Projects', 'Vendors', 'Certifications', 'Compliance', 'Marketing', 'Training', 'Contracts', 'Proposals', 'Reports'];

interface PendingFile {
  file: File;
  title: string;
}

interface MultiFileUploadModalProps {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
  defaultCategory?: string;
  relatedProjectId?: string;
  relatedClientId?: string;
}

/**
 * Select any number of files, give each a title (defaulted from the
 * filename), pick one shared category, and create one Document record per
 * file in a single action — the "upload multiple documents at once" flow,
 * reused wherever documents get attached (the main Documents module, a
 * Project's Documents tab, etc).
 */
export function MultiFileUploadModal({ open, onClose, onUploaded, defaultCategory = 'Projects', relatedProjectId, relatedClientId }: MultiFileUploadModalProps) {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [category, setCategory] = useState(defaultCategory);
  const [uploading, setUploading] = useState(false);

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const additions = Array.from(fileList).map((file) => ({ file, title: file.name.replace(/\.[^/.]+$/, '') }));
    setPending((p) => [...p, ...additions]);
  }

  function updateTitle(i: number, title: string) {
    setPending((p) => p.map((item, idx) => (idx === i ? { ...item, title } : item)));
  }

  function removeFile(i: number) {
    setPending((p) => p.filter((_, idx) => idx !== i));
  }

  function reset() {
    setPending([]);
    setCategory(defaultCategory);
  }

  async function handleUpload() {
    if (pending.length === 0) return;
    setUploading(true);
    try {
      const body = new FormData();
      pending.forEach((p) => body.append('files', p.file));
      const res = await api.post('/uploads/multi', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      const uploaded: Array<{ url: string; originalName: string }> = res.data.data;

      await Promise.all(
        uploaded.map((u, i) =>
          api.post('/documents', {
            title: pending[i]?.title || u.originalName,
            category,
            url: u.url,
            ownerId: user?.id,
            relatedProjectId,
            relatedClientId,
          })
        )
      );

      showSuccess(`${uploaded.length} document${uploaded.length > 1 ? 's' : ''} uploaded.`);
      reset();
      onClose();
      onUploaded();
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Upload documents"
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => { reset(); onClose(); }}>Cancel</button>
          <button className="btn btn-primary" onClick={handleUpload} disabled={uploading || pending.length === 0}>
            {uploading ? 'Uploading…' : `Upload ${pending.length || ''} document${pending.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field full">
          <label>Files</label>
          <label
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
              border: '1.5px dashed var(--line-strong)', borderRadius: 12, padding: '28px 16px', cursor: 'pointer', color: 'var(--muted)',
            }}
          >
            <UploadCloud size={22} />
            <span style={{ fontSize: 13 }}>Click to choose files, or drop them here — select as many as you like</span>
            <input type="file" multiple style={{ display: 'none' }} onChange={(e) => addFiles(e.target.files)} />
          </label>
        </div>

        {pending.length > 0 && (
          <div className="field full">
            <label>{pending.length} file{pending.length > 1 ? 's' : ''} selected</label>
            <div style={{ display: 'grid', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
              {pending.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <FileIcon size={15} color="var(--muted-2)" style={{ flexShrink: 0 }} />
                  <input className="input" value={p.title} onChange={(e) => updateTitle(i, e.target.value)} style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, color: 'var(--muted-2)', flexShrink: 0 }}>{(p.file.size / 1024).toFixed(0)} KB</span>
                  <button type="button" className="icon-btn" style={{ width: 32, height: 32, flexShrink: 0 }} onClick={() => removeFile(i)} aria-label="Remove"><X size={13} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="field full">
          <label>Category (applies to all)</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  );
}
