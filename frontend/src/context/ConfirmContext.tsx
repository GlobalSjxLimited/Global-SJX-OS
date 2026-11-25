import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import { Modal } from '@/components/ui/Modal';

interface ConfirmOptions { title?: string; message: string; confirmLabel?: string; danger?: boolean; }
interface ConfirmContextValue { confirm: (options: ConfirmOptions | string) => Promise<boolean>; }

const ConfirmContext = createContext<ConfirmContextValue | undefined>(undefined);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  const confirm = useCallback((options: ConfirmOptions | string) => {
    const normalized = typeof options === 'string' ? { message: options } : options;
    return new Promise<boolean>((resolve) => setState({ options: normalized, resolve }));
  }, []);

  function handle(result: boolean) {
    state?.resolve(result);
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Modal
        open={!!state}
        onClose={() => handle(false)}
        title={state?.options.title || 'Are you sure?'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => handle(false)}>Cancel</button>
            <button className={state?.options.danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => handle(true)}>
              {state?.options.confirmLabel || 'Confirm'}
            </button>
          </>
        }
      >
        <p style={{ fontSize: 14, color: 'var(--muted)' }}>{state?.options.message}</p>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue['confirm'] {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx.confirm;
}
