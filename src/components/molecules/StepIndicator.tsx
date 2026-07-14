interface StepIndicatorProps {
  current: number;
  total: number;
  label: string;
}

export function StepIndicator({ current, total, label }: StepIndicatorProps) {
  const pct = Math.round((current / total) * 100);

  return (
    <div className="mb-6">
      <div className="flex justify-between text-xs font-bold text-slate-600 mb-2">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-600 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
