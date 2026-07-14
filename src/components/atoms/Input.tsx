interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Input({ label, className = '', id, ...props }: Props) {
  const inputId = id ?? label.replace(/\s+/g, '-').toLowerCase();
  return (
    <div>
      <label htmlFor={inputId} className="block text-xs font-bold text-slate-600 uppercase mb-1">
        {label}
      </label>
      <input
        id={inputId}
        className={`w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${className}`}
        {...props}
      />
    </div>
  );
}
