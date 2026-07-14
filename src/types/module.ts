import type { LanguageCode } from './language';

export interface ModuleContent {
  script: string;
  knowledges: string[];
  skills: string[];
}

export interface Module {
  id: string;
  icon: string;
  badgeIcon: string;
  badgeName: string;
  wordsToPronounce: Record<LanguageCode, string[]>;
  content: Record<LanguageCode, ModuleContent>;
}

export type ModuleRecord = Record<string, Module>;

export type ModuleId =
  | 'primary'
  | 'access'
  | 'insurance'
  | 'rights'
  | 'school'
  | 'emergency';

export const MODULE_IDS: ModuleId[] = [
  'primary',
  'access',
  'insurance',
  'rights',
  'school',
  'emergency',
];

export function capitalizeModuleId(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}
