import { useToast } from '../../context/ToastContext';

export function ToastNotification() {
  const { toast } = useToast();
  if (!toast) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-white border border-slate-200 shadow-2xl rounded-2xl p-4 flex items-start space-x-3 max-w-sm transition-all">
      <div className="text-xl">
        <i className={`fa-solid ${toast.iconClass}`} />
      </div>
      <div>
        <p className="font-bold text-slate-900 text-sm">{toast.title}</p>
        <p className="text-xs text-slate-500 mt-0.5">{toast.message}</p>
      </div>
    </div>
  );
}
