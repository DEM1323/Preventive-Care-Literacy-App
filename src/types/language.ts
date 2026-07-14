export type LanguageCode = 'en' | 'es' | 'pt' | 'fr' | 'ht';

export const LANGUAGE_OPTIONS: { code: LanguageCode; label: string }[] = [
  { code: 'en', label: '🇺🇸 EN' },
  { code: 'es', label: '🇪🇸 ES' },
  { code: 'pt', label: '🇧🇷 PT' },
  { code: 'fr', label: '🇫🇷 FR' },
  { code: 'ht', label: '🇭🇹 HT' },
];

export type TranslationKey =
  | 'appName'
  | 'appTagline'
  | 'navHome'
  | 'navProfile'
  | 'navNurse'
  | 'navNurseDashboard'
  | 'heroTitle'
  | 'heroSub'
  | 'ctaGetStarted'
  | 'ctaSignIn'
  | 'welcomeBack'
  | 'subGreeting'
  | 'categoryHeader'
  | 'nurseAlert'
  | 'nurseComplete'
  | 'offlineMode'
  | 'onlineMode'
  | 'moduleTitlePrimary'
  | 'moduleDescPrimary'
  | 'moduleTitleAccess'
  | 'moduleDescAccess'
  | 'moduleTitleInsurance'
  | 'moduleDescInsurance'
  | 'moduleTitleRights'
  | 'moduleDescRights'
  | 'moduleTitleSchool'
  | 'moduleDescSchool'
  | 'moduleTitleEmergency'
  | 'moduleDescEmergency'
  | 'zipLabel'
  | 'zipBtn'
  | 'audioLabel'
  | 'badgeSecTitle'
  | 'progressText'
  | 'skillsChecklist'
  | 'knowledgeCardTitle'
  | 'backToDashboard'
  | 'clinicTitle'
  | 'intakeTitle'
  | 'intakeSubtitle'
  | 'stepOf'
  | 'next'
  | 'back'
  | 'submit'
  | 'consent'
  | 'tabKnowledge'
  | 'tabSkills'
  | 'tabApplication'
  | 'nurseLoginTitle'
  | 'nurseLoginSubtitle'
  | 'nursePasscode'
  | 'nurseEnter'
  | 'decryptKey'
  | 'decryptDashboard'
  | 'noSubmissions'
  | 'submitSuccess'
  | 'submitQueued'
  | 'invalidPasscode';

export type Translations = Record<TranslationKey, string>;

export type TranslationMap = Record<LanguageCode, Translations>;
