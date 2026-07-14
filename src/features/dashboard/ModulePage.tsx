import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AudioButton } from '../../components/atoms/AudioButton';
import { ClinicLocator } from '../../components/organisms/ClinicLocator';
import { useAppState } from '../../context/AppStateContext';
import { useLanguage } from '../../context/LanguageContext';
import { useModules } from '../../context/ModulesContext';
import { useToast } from '../../context/ToastContext';
import { useSpeech } from '../../hooks/useSpeech';
import { useStudentFormData } from '../../hooks/useStudentFormData';
import type { ModuleId } from '../../types/module';
import { capitalizeModuleId } from '../../types/module';

type Tab = 'knowledge' | 'skills' | 'application';

export function ModulePage() {
  const { id } = useParams<{ id: string }>();
  const moduleId = id as ModuleId;
  const { modules } = useModules();
  const module = modules[moduleId];
  const { language, t } = useLanguage();
  const { speak } = useSpeech(language);
  const { modulesProgress, toggleSkill, getModuleProgress, earnedBadges, awardBadge } = useAppState();
  const { formData: intakeData } = useStudentFormData();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>('knowledge');

  const content = module?.content[language] ?? module?.content.en;
  const totalSkills = content?.skills.length ?? 0;
  const progress = getModuleProgress(moduleId, totalSkills);
  const checked = modulesProgress[moduleId] ?? [];
  const skillsStarted = checked.length > 0;

  useEffect(() => {
    if (progress === 100 && module && !earnedBadges.includes(moduleId)) {
      awardBadge(moduleId);
      showToast('Badge Earned!', `${module.badgeIcon} Unlocked ${module.badgeName}!`, 'fa-medal text-yellow-500');
    }
  }, [progress, module, moduleId, earnedBadges, awardBadge, showToast]);

  if (!module || !content) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-600">Module not found.</p>
        <Link to="/dashboard" className="text-emerald-600 font-bold mt-4 inline-block">
          {t('backToDashboard')}
        </Link>
      </div>
    );
  }

  const titleKey = `moduleTitle${capitalizeModuleId(moduleId)}` as const;
  const descKey = `moduleDesc${capitalizeModuleId(moduleId)}` as const;
  const words = module.wordsToPronounce[language] ?? module.wordsToPronounce.en;

  return (
    <section className="space-y-6">
      <Link to="/dashboard" className="flex items-center space-x-2 text-slate-600 hover:text-slate-900 font-bold text-sm">
        <i className="fa-solid fa-arrow-left" />
        <span>{t('backToDashboard')}</span>
      </Link>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 sm:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900">{t(titleKey as 'moduleTitlePrimary')}</h2>
            <p className="text-slate-500 text-sm">{t(descKey as 'moduleDescPrimary')}</p>
          </div>
          <div className="text-right">
            <span className="text-3xl">{module.badgeIcon}</span>
            <p className="text-xs font-bold text-slate-500">{progress}% Complete</p>
          </div>
        </div>

        <div className="flex space-x-2 mb-6">
          {(['knowledge', 'skills', 'application'] as Tab[]).map((key) => (
            <button
              key={key}
              type="button"
              disabled={key === 'application' && !skillsStarted}
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                tab === key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40'
              }`}
            >
              {t(key === 'knowledge' ? 'tabKnowledge' : key === 'skills' ? 'tabSkills' : 'tabApplication')}
            </button>
          ))}
        </div>

        {tab === 'knowledge' && (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl">
              <div className="flex justify-between items-start gap-2">
                <p className="text-slate-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: content.script }} />
                <button
                  type="button"
                  onClick={() => speak(content.script.replace(/<[^>]+>/g, ''))}
                  className="shrink-0 text-emerald-700 text-xs font-bold"
                >
                  <i className="fa-solid fa-volume-high mr-1" />
                  {t('audioLabel')}
                </button>
              </div>
            </div>
            <h3 className="font-bold text-slate-900">{t('knowledgeCardTitle')}</h3>
            {content.knowledges.map((kn, i) => (
              <div key={i} className="bg-slate-50 border border-slate-100 p-4 rounded-xl flex items-start space-x-3">
                <div className="bg-white p-2 text-xs font-bold text-slate-400 rounded-lg w-8 h-8 shrink-0 flex items-center justify-center">
                  0{i + 1}
                </div>
                <p className="text-slate-700 font-medium leading-relaxed" dangerouslySetInnerHTML={{ __html: kn }} />
              </div>
            ))}
            <div className="flex flex-wrap gap-2 pt-2">
              {words.map((word) => (
                <AudioButton key={word} word={word} onSpeak={() => speak(word)} />
              ))}
            </div>
          </div>
        )}

        {tab === 'skills' && (
          <div className="space-y-3">
            <h3 className="font-bold text-slate-900">{t('skillsChecklist')}</h3>
            {content.skills.map((skill, idx) => {
              const isChecked = checked.includes(idx);
              return (
                <label
                  key={idx}
                  className={`flex items-start space-x-3 p-3.5 rounded-xl cursor-pointer border transition ${
                    isChecked
                      ? 'bg-emerald-100/50 border-emerald-300 text-emerald-950'
                      : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => toggleSkill(moduleId, idx, e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600"
                  />
                  <span className="text-xs font-semibold leading-relaxed">{skill}</span>
                </label>
              );
            })}
          </div>
        )}

        {tab === 'application' && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl text-sm text-slate-700">
              {intakeData ? (
                <ul className="list-disc pl-5 space-y-1">
                  {intakeData.insuranceStatus === 'No' && (
                    <li>Explore community clinics that offer sliding-scale fees for uninsured students.</li>
                  )}
                  {intakeData.allergies === 'Yes' && (
                    <li>Bring your allergy list ({intakeData.allergiesDetail}) to every clinic visit.</li>
                  )}
                  {intakeData.stableHousing === 'No' && (
                    <li>Ask your school nurse about housing and food resource referrals.</li>
                  )}
                  <li>Practice scheduling a preventive check-up using skills from this module.</li>
                </ul>
              ) : (
                <p>Complete your health history form to unlock personalized application prompts.</p>
              )}
            </div>
            <ClinicLocator />
          </div>
        )}
      </div>
    </section>
  );
}
