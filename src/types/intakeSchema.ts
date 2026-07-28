import type { LanguageCode } from './language';

export type IntakeFieldType =
  | 'text'
  | 'date'
  | 'tel'
  | 'email'
  | 'textarea'
  | 'yesno'
  | 'checkbox';

export interface IntakeFieldConfig {
  fieldId: string;
  enabled: boolean;
  step: number;
  sortOrder: number;
  type: IntakeFieldType;
  required: boolean;
  showIfField: string;
  showIfValue: string;
  defaultValue: string;
  labels: Partial<Record<LanguageCode, string>>;
  nurseSummary: boolean;
  moduleHint: string;
}

export interface IntakeMeta {
  schemaVersion: string;
  consentText: Partial<Record<LanguageCode, string>>;
  wizardTitle: Partial<Record<LanguageCode, string>>;
}

export interface IntakeSchema {
  fields: IntakeFieldConfig[];
  meta: IntakeMeta;
}

/** Flexible answers bag — stable field_id keys from the schema sheet. */
export type IntakeFormData = Record<string, string | boolean>;

export const PROTECTED_FIELD_IDS = ['email', 'studentId', 'consent'] as const;
