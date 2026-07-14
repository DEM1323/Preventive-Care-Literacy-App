import { Link } from 'react-router-dom';
import { useAppState } from '../../context/AppStateContext';
import { useLanguage } from '../../context/LanguageContext';
import type { Module, ModuleId } from '../../types/module';
import { capitalizeModuleId } from '../../types/module';

interface Props {
  moduleId: ModuleId;
  module: Module;
}

export function ModuleCard({ moduleId, module }: Props) {
  const { getModuleProgress, earnedBadges } = useAppState();
  const { t } = useLanguage();
  const titleKey = `moduleTitle${capitalizeModuleId(moduleId)}`;
  const descKey = `moduleDesc${capitalizeModuleId(moduleId)}`;

  const content = module.content.en;
  const progress = getModuleProgress(moduleId, content.skills.length);
  const unlocked = earnedBadges.includes(moduleId);

  return (
    <Link
      to={`/module/${moduleId}`}
      className="group block bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-emerald-200 transition-all transform hover:-translate-y-1"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-xl group-hover:bg-emerald-100 transition">
          <i className={`fa-solid ${module.icon}`} />
        </div>
        <div className={`text-2xl ${unlocked ? 'opacity-100 scale-110' : 'opacity-35'}`}>
          {module.badgeIcon}
        </div>
      </div>
      <h4 className="text-md font-bold text-slate-900 group-hover:text-emerald-700 transition">
        {t(titleKey as 'moduleTitlePrimary')}
      </h4>
      <p className="text-xs text-slate-500 mt-1 mb-4 leading-normal">{t(descKey as 'moduleDescPrimary')}</p>
      <div className="flex items-center justify-between text-xs font-semibold text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
        <span>{t('progressText')}</span>
        <span className="text-emerald-600">{progress}%</span>
      </div>
    </Link>
  );
}
