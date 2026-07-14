import { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { clinicsFallback } from '../../data/clinics.fallback';

export function ClinicLocator() {
  const { t } = useLanguage();
  const [zip, setZip] = useState('');
  const [results, setResults] = useState<typeof clinicsFallback>([]);
  const [searched, setSearched] = useState(false);

  const search = () => {
    const trimmed = zip.trim();
    if (!trimmed) return;
    setResults(clinicsFallback.filter((c) => c.zip === trimmed));
    setSearched(true);
  };

  return (
    <div className="space-y-3">
      <label className="block text-xs font-bold text-slate-600 uppercase">{t('zipLabel')}</label>
      <div className="flex space-x-2">
        <input
          type="text"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          placeholder="Try 02108, 02111, or 01604"
          className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
        />
        <button
          type="button"
          onClick={search}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2.5 rounded-xl text-sm transition"
        >
          {t('zipBtn')}
        </button>
      </div>

      {searched && (
        <div className="space-y-3 pt-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('clinicTitle')}</h4>
          {results.length > 0 ? (
            results.map((item) => (
              <div key={item.name} className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-950">{item.name}</span>
                  <span className="bg-emerald-100 text-emerald-800 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">
                    Clinic
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 flex items-center space-x-1.5">
                  <i className="fa-solid fa-map-pin text-rose-500" />
                  <span>{item.address}</span>
                </p>
                <p className="text-[10px] text-emerald-700 font-semibold flex items-center space-x-1.5 bg-emerald-50 px-2 py-0.5 rounded w-fit">
                  <i className="fa-solid fa-bus-simple" />
                  <span>{item.transit}</span>
                </p>
              </div>
            ))
          ) : (
            <div className="bg-slate-50 border border-dashed border-slate-200 p-4 text-center rounded-xl">
              <p className="text-xs font-bold text-slate-700">No Clinics Registered in {zip}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
