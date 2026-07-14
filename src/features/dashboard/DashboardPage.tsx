import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { useAppState } from '../../context/AppStateContext';
import { useModules } from '../../context/ModulesContext';
import { ModuleCard } from '../../components/organisms/ModuleCard';
import { MODULE_IDS, type ModuleId } from '../../types/module';

export function DashboardPage() {
  const { user, intake } = useAppState();
  const { t } = useLanguage();
  const { modules } = useModules();

  return (
    <section className="space-y-6">
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl p-6 sm:p-8 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between">
        <div className="space-y-1.5">
          <span className="text-2xl md:text-3xl font-extrabold">
            {t('welcomeBack')}, <span className="text-yellow-300">{user.name || 'Student'}</span>! 👋
          </span>
          <p className="text-emerald-100 font-medium">{t('subGreeting')}</p>
        </div>
        <div
          className={`mt-4 md:mt-0 flex items-center space-x-3 px-4 py-3 rounded-xl max-w-sm border ${
            intake.completed
              ? 'bg-emerald-800/40 border-emerald-500/30'
              : 'bg-white/10 backdrop-blur-md border-white/20'
          }`}
        >
          <i className={`fa-solid fa-bell text-yellow-300 ${intake.completed ? '' : 'animate-bounce'} text-lg`} />
          <p className="text-xs font-bold leading-normal text-white">
            {intake.completed ? t('nurseComplete') : t('nurseAlert')}
          </p>
        </div>
      </div>

      {intake.completed && (
        <div className="bg-white border border-emerald-100 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="font-bold text-slate-900 text-sm">Health form on file</p>
            <p className="text-xs text-slate-500">
              Version {intake.version || 1}
              {intake.lastUpdatedAt ? ` · Last updated ${new Date(intake.lastUpdatedAt).toLocaleDateString()}` : ''}
            </p>
          </div>
          <Link
            to="/intake"
            className="inline-flex items-center justify-center bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-sm transition"
          >
            Push Form Update
          </Link>
        </div>
      )}

      <div>
        <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center space-x-2">
          <span className="w-1.5 h-6 bg-emerald-600 rounded-full" />
          <span>{t('categoryHeader')}</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {MODULE_IDS.map((id) => {
            const mod = modules[id];
            if (!mod) return null;
            return <ModuleCard key={id} moduleId={id as ModuleId} module={mod} />;
          })}
        </div>
      </div>
    </section>
  );
}
