interface Props {
  name: string;
  label: string;
  value: 'Yes' | 'No';
  onChange: (value: 'Yes' | 'No') => void;
}

export function RadioYesNo({ name, label, value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <p className="font-medium text-slate-700 text-sm">{label}</p>
      <div className="flex space-x-4">
        {(['Yes', 'No'] as const).map((opt) => (
          <label key={opt} className="flex items-center space-x-2 text-sm">
            <input
              type="radio"
              name={name}
              value={opt}
              checked={value === opt}
              onChange={() => onChange(opt)}
              className="text-emerald-600"
              required
            />
            <span>{opt}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
