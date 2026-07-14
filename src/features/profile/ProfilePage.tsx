import { useAppState } from '../../context/AppStateContext';
import { useLanguage } from '../../context/LanguageContext';
import { useModules } from '../../context/ModulesContext';
import { MODULE_IDS } from '../../types/module';

export function ProfilePage() {
  const { user, intake, earnedBadges, modulesProgress } = useAppState();
  const { t } = useLanguage();
  const { modules } = useModules();

  let totalChecked = 0;
  let totalPossible = 0;
  MODULE_IDS.forEach((key) => {
    const mod = modules[key];
    if (!mod) return;
    totalPossible += mod.content.en.skills.length;
    totalChecked += modulesProgress[key]?.length ?? 0;
  });
  const totalPct = totalPossible ? Math.round((totalChecked / totalPossible) * 100) : 0;

  return (
    <section className="max-w-3xl mx-auto space-y-6">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
        <h2 className="text-2xl font-bold text-slate-900">{user.name || 'Student User'}</h2>
        <p className="text-slate-500 text-sm">{user.email || 'No email registered'}</p>
        <p
          className={`mt-2 text-xs font-bold px-3 py-1 rounded-lg w-fit ${
            intake.completed
              ? 'text-emerald-700 bg-emerald-50 border border-emerald-100'
              : 'text-amber-700 bg-amber-50 border border-amber-100'
          }`}
        >
          {intake.completed ? '✓ Nurse Intake Complete' : '⚠️ Missing Intake Form'}
        </p>
        <p className="mt-4 text-3xl font-extrabold text-emerald-600">{totalPct}%</p>
        <p className="text-xs text-slate-500">Overall module progress</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
        <h3 className="text-lg font-bold mb-4">{t('badgeSecTitle')}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {MODULE_IDS.map((key) => {
            const mod = modules[key];
            if (!mod) return null;
            const unlocked = earnedBadges.includes(key);
            return (
              <div
                key={key}
                className={`p-4 rounded-2xl border flex flex-col items-center space-y-1.5 ${
                  unlocked ? 'bg-white border-emerald-200 shadow-sm' : 'bg-slate-50/50 border-slate-200 opacity-40'
                }`}
              >
                <span className="text-3xl">{mod.badgeIcon}</span>
                <span className="text-[10px] font-extrabold text-slate-800 text-center">{mod.badgeName}</span>
                <span className={`text-[8px] font-bold uppercase ${unlocked ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {unlocked ? 'Unlocked' : 'Locked'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
