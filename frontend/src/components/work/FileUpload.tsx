import { useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';

export interface Uploaded { url: string; name: string; mimeType: string; size: number }

/**
 * Single-purpose upload button. `kind="recording"` uses the audio/video endpoint
 * (large files); anything else goes through the general document store.
 */
export function FileUpload({ onUploaded, kind = 'file', label, accept, multiple = true, small = true }: {
  onUploaded: (files: Uploaded[]) => void | Promise<void>;
  kind?: 'file' | 'recording' | 'document';
  label?: string;
  accept?: string;
  multiple?: boolean;
  small?: boolean;
}) {
  const { showError } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function go(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    try {
      const out: Uploaded[] = [];
      for (const f of Array.from(list)) {
        // Contracts and record attachments are capped at 10 MB; say so before wasting an upload.
        if (kind === 'document' && f.size > 10 * 1024 * 1024) { showError(`“${f.name}” is ${(f.size / 1048576).toFixed(1)} MB. The limit is 10 MB.`); continue; }
        const body = new FormData();
        body.append('file', f);
        const res = await api.post(kind === 'recording' ? '/uploads/recording' : kind === 'document' ? '/uploads/document' : '/uploads', body, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 0 });
        const u = res.data.data;
        out.push({ url: u.url, name: u.originalName, mimeType: u.mimeType, size: u.size });
      }
      await onUploaded(out);
    } catch (err) { showError(apiErrorMessage(err)); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  return (
    <span>
      <button type="button" className={`btn btn-ghost ${small ? 'btn-sm' : ''}`} onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {busy ? 'Uploading…' : label || (kind === 'recording' ? 'Upload recording' : 'Upload file')}
      </button>
      <input ref={input} type="file" multiple={multiple} accept={accept || (kind === 'recording' ? 'audio/*,video/*,.mp4,.m4a,.mp3,.wav,.webm,.mov' : undefined)} style={{ display: 'none' }} onChange={(e) => go(e.target.files)} />
    </span>
  );
}
