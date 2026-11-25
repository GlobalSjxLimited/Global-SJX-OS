import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { Bold, Italic, Underline, List, ListOrdered, Link2, Image as ImageIcon, Heading2, Quote, Eraser, Code } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';

const API_BASE: string = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const API_ORIGIN = API_BASE.replace(/\/api\/?$/, '');

const ALLOWED_TAGS = ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'img', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div'];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'src', 'alt', 'width', 'height', 'class'];

let hooked = false;
function ensureHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (src.startsWith('/api/uploads/media/')) node.setAttribute('src', API_ORIGIN + src);
      else if (!/^https:\/\//i.test(src)) node.removeAttribute('src');
      node.setAttribute('loading', 'lazy');
    }
  });
}

/** Sanitises HTML for display. Legacy plain-text values (no tags) keep their line breaks. */
export function toSafeHtml(content: string | undefined | null): string {
  ensureHooks();
  const raw = content || '';
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(raw);
  const html = looksLikeHtml
    ? raw
    : raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/@\[([^\]]+)\]\([a-f0-9]{24}\)/g, '<strong>@$1</strong>')
        .replace(/\n/g, '<br/>');
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false });
}

export function RichTextRenderer({ content, className = '' }: { content?: string | null; className?: string }) {
  const html = useMemo(() => toSafeHtml(content), [content]);
  return <div className={`rich-content ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

interface EditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  compact?: boolean;
}

/**
 * Lightweight WYSIWYG editor: bold / italic / underline, headings, bullet and
 * numbered lists, quotes, code, links and images (uploaded or by URL).
 * Output is sanitised on the server again before it is stored.
 */
export function RichTextEditor({ value, onChange, placeholder = 'Write here…', minHeight = 140, compact = false }: EditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { showError } = useToast();
  const [uploading, setUploading] = useState(false);
  const lastEmitted = useRef<string>('');

  // Only push external changes into the DOM (avoids caret jumps while typing).
  useEffect(() => {
    if (!ref.current) return;
    if (value !== lastEmitted.current && value !== ref.current.innerHTML) {
      ref.current.innerHTML = /<[a-z][\s\S]*>/i.test(value || '') ? toSafeHtml(value) : toSafeHtml(value);
    }
  }, [value]);

  function emit() {
    if (!ref.current) return;
    const html = ref.current.innerHTML === '<br>' ? '' : ref.current.innerHTML;
    lastEmitted.current = html;
    onChange(html);
  }

  function exec(cmd: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  }

  function addLink() {
    const url = window.prompt('Link address (https://…)');
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)/i.test(url)) {
      showError('Links must start with https://, http:// or mailto:');
      return;
    }
    exec('createLink', url);
  }

  function addImageByUrl() {
    const url = window.prompt('Image address (https://…) — or cancel and use the upload button');
    if (!url) return;
    if (!/^https:\/\//i.test(url)) {
      showError('Image links must start with https://');
      return;
    }
    exec('insertImage', url);
  }

  async function uploadImage(file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return showError('Only PNG, JPEG or WebP images are allowed.');
    if (file.size > 5 * 1024 * 1024) return showError('Images must be 5 MB or smaller.');
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await api.post('/uploads/media', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      exec('insertImage', API_ORIGIN + res.data.data.url);
    } catch (err) {
      showError(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  const tools: Array<{ icon: React.ReactNode; title: string; run: () => void }> = [
    { icon: <Bold size={14} />, title: 'Bold', run: () => exec('bold') },
    { icon: <Italic size={14} />, title: 'Italic', run: () => exec('italic') },
    { icon: <Underline size={14} />, title: 'Underline', run: () => exec('underline') },
    { icon: <Heading2 size={14} />, title: 'Heading', run: () => exec('formatBlock', 'h3') },
    { icon: <List size={14} />, title: 'Bulleted list', run: () => exec('insertUnorderedList') },
    { icon: <ListOrdered size={14} />, title: 'Numbered list', run: () => exec('insertOrderedList') },
    { icon: <Quote size={14} />, title: 'Quote', run: () => exec('formatBlock', 'blockquote') },
    { icon: <Code size={14} />, title: 'Code', run: () => exec('formatBlock', 'pre') },
    { icon: <Link2 size={14} />, title: 'Link', run: addLink },
    { icon: <ImageIcon size={14} />, title: 'Image (upload)', run: () => fileRef.current?.click() },
    { icon: <Eraser size={14} />, title: 'Clear formatting', run: () => { exec('removeFormat'); exec('formatBlock', 'p'); } },
  ];

  return (
    <div className="rte">
      <div className="rte-toolbar" role="toolbar" aria-label="Formatting">
        {tools.map((t) => (
          <button key={t.title} type="button" className="rte-btn" title={t.title} aria-label={t.title} onMouseDown={(e) => e.preventDefault()} onClick={t.run}>
            {t.icon}
          </button>
        ))}
        <button type="button" className="rte-btn rte-text" onMouseDown={(e) => e.preventDefault()} onClick={addImageByUrl} title="Image from web address">
          URL
        </button>
        {uploading && <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 6 }}>Uploading…</span>}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ''; }} />
      </div>
      <div
        ref={ref}
        className="rte-area rich-content"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        style={{ minHeight: compact ? 70 : minHeight }}
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          // Paste as plain text to avoid importing foreign styles/markup.
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
      />
    </div>
  );
}
