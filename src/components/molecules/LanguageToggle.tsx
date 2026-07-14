import { useLanguage } from '../../context/LanguageContext';
import { LANGUAGE_OPTIONS } from '../../types/language';

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage();

  return (
    <select
      value={language}
      onChange={(e) => setLanguage(e.target.value as typeof language)}
      className="bg-emerald-800 text-white border border-emerald-600 rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 font-medium"
      aria-label="Select language"
    >
      {LANGUAGE_OPTIONS.map((opt) => (
        <option key={opt.code} value={opt.code}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
