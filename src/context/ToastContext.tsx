import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface ToastState {
  title: string;
  message: string;
  iconClass: string;
}

interface ToastContextValue {
  showToast: (title: string, message: string, iconClass?: string) => void;
  toast: ToastState | null;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback(
    (title: string, message: string, iconClass = 'fa-circle-check text-green-500') => {
      setToast({ title, message, iconClass });
      setTimeout(() => setToast(null), 4000);
    },
    []
  );

  const value = useMemo(() => ({ showToast, toast }), [showToast, toast]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
