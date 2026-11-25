import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

type ToastTone = 'success' | 'error' | 'info';
interface Toast { id: string; message: string; tone: ToastTone; }

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const ICONS: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 size={17} />,
  error: <XCircle size={17} />,
  info: <Info size={17} />,
};
const COLORS: Record<ToastTone, string> = {
  success: 'var(--success)',
  error: 'var(--danger)',
  info: 'var(--accent)',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const showError = useCallback((message: string) => showToast(message, 'error'), [showToast]);
  const showSuccess = useCallback((message: string) => showToast(message, 'success'), [showToast]);

  function dismiss(id: string) {
    setToasts((t) => t.filter((x) => x.id !== id));
  }

  return (
    <ToastContext.Provider value={{ showToast, showError, showSuccess }}>
      {children}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 200, display: 'grid', gap: 10, maxWidth: 340 }}>
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.25, ease: [0.16, 0.8, 0.24, 1] }}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 12,
                padding: '12px 14px', boxShadow: 'var(--shadow)', color: 'var(--text)', fontSize: 13.5,
              }}
            >
              <span style={{ color: COLORS[t.tone], flexShrink: 0, marginTop: 1 }}>{ICONS[t.tone]}</span>
              <span style={{ flex: 1 }}>{t.message}</span>
              <button onClick={() => dismiss(t.id)} style={{ background: 'none', border: 'none', color: 'var(--muted-2)', cursor: 'pointer', flexShrink: 0 }}>
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
