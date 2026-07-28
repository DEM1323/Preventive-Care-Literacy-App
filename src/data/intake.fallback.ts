import type { IntakeFieldConfig, IntakeFormData, IntakeMeta, IntakeSchema } from '../types/intakeSchema';

function field(
  partial: Omit<IntakeFieldConfig, 'enabled' | 'showIfField' | 'showIfValue' | 'nurseSummary' | 'moduleHint'> &
    Partial<Pick<IntakeFieldConfig, 'enabled' | 'showIfField' | 'showIfValue' | 'nurseSummary' | 'moduleHint'>>
): IntakeFieldConfig {
  return {
    enabled: true,
    showIfField: '',
    showIfValue: '',
    nurseSummary: false,
    moduleHint: '',
    ...partial,
  };
}

export const intakeMetaFallback: IntakeMeta = {
  schemaVersion: '1',
  consentText: {},
  wizardTitle: {},
};

/** Current hardcoded intake fields as a sheet-compatible fallback. */
export const intakeFieldsFallback: IntakeFieldConfig[] = [
  field({
    fieldId: 'name',
    step: 1,
    sortOrder: 10,
    type: 'text',
    required: true,
    defaultValue: '',
    labels: { en: 'Full Name' },
    nurseSummary: true,
  }),
  field({
    fieldId: 'dob',
    step: 1,
    sortOrder: 20,
    type: 'date',
    required: true,
    defaultValue: '',
    labels: { en: 'Date of Birth' },
  }),
  field({
    fieldId: 'studentId',
    step: 1,
    sortOrder: 30,
    type: 'text',
    required: true,
    defaultValue: '',
    labels: { en: 'Student ID Number' },
    nurseSummary: true,
  }),
  field({
    fieldId: 'address',
    step: 1,
    sortOrder: 40,
    type: 'text',
    required: true,
    defaultValue: '',
    labels: { en: 'Address' },
  }),
  field({
    fieldId: 'phone',
    step: 1,
    sortOrder: 50,
    type: 'tel',
    required: true,
    defaultValue: '',
    labels: { en: 'Phone Number' },
  }),
  field({
    fieldId: 'email',
    step: 1,
    sortOrder: 60,
    type: 'email',
    required: true,
    defaultValue: '',
    labels: { en: 'Email' },
  }),
  field({
    fieldId: 'medConditions',
    step: 2,
    sortOrder: 10,
    type: 'yesno',
    required: true,
    defaultValue: 'No',
    labels: { en: 'Do you have medical conditions requiring medication?' },
  }),
  field({
    fieldId: 'medConditionsDetail',
    step: 2,
    sortOrder: 20,
    type: 'textarea',
    required: true,
    defaultValue: '',
    showIfField: 'medConditions',
    showIfValue: 'Yes',
    labels: { en: 'Describe conditions' },
  }),
  field({
    fieldId: 'visionConcerns',
    step: 2,
    sortOrder: 30,
    type: 'yesno',
    required: true,
    defaultValue: 'No',
    labels: { en: 'Do you have vision or hearing concerns?' },
  }),
  field({
    fieldId: 'allergies',
    step: 3,
    sortOrder: 10,
    type: 'yesno',
    required: true,
    defaultValue: 'No',
    labels: { en: 'Do you have any known allergies?' },
    nurseSummary: true,
    moduleHint: 'allergies',
  }),
  field({
    fieldId: 'allergiesDetail',
    step: 3,
    sortOrder: 20,
    type: 'textarea',
    required: true,
    defaultValue: '',
    showIfField: 'allergies',
    showIfValue: 'Yes',
    labels: { en: 'Please list your allergies' },
    moduleHint: 'allergies',
  }),
  field({
    fieldId: 'medications',
    step: 4,
    sortOrder: 10,
    type: 'yesno',
    required: true,
    defaultValue: 'No',
    labels: { en: 'Are you currently taking any medications?' },
  }),
  field({
    fieldId: 'medicationsDetail',
    step: 4,
    sortOrder: 20,
    type: 'textarea',
    required: true,
    defaultValue: '',
    showIfField: 'medications',
    showIfValue: 'Yes',
    labels: { en: 'Please list medications' },
  }),
  field({
    fieldId: 'pcpName',
    step: 5,
    sortOrder: 10,
    type: 'text',
    required: true,
    defaultValue: '',
    labels: { en: 'Primary Care Provider Name' },
  }),
  field({
    fieldId: 'pcpPhone',
    step: 5,
    sortOrder: 20,
    type: 'tel',
    required: true,
    defaultValue: '',
    labels: { en: 'PCP Phone' },
  }),
  field({
    fieldId: 'clinicName',
    step: 5,
    sortOrder: 30,
    type: 'text',
    required: true,
    defaultValue: '',
    labels: { en: 'Clinic Name' },
  }),
  field({
    fieldId: 'clinicPhone',
    step: 5,
    sortOrder: 40,
    type: 'tel',
    required: true,
    defaultValue: '',
    labels: { en: 'Clinic Phone' },
  }),
  field({
    fieldId: 'lastCheckup',
    step: 5,
    sortOrder: 50,
    type: 'date',
    required: true,
    defaultValue: '',
    labels: { en: 'Last Checkup Date' },
  }),
  field({
    fieldId: 'safeAtHome',
    step: 6,
    sortOrder: 10,
    type: 'yesno',
    required: true,
    defaultValue: 'Yes',
    labels: { en: 'Do you feel safe at home and in relationships?' },
  }),
  field({
    fieldId: 'stableHousing',
    step: 6,
    sortOrder: 20,
    type: 'yesno',
    required: true,
    defaultValue: 'Yes',
    labels: { en: 'Do you have stable housing?' },
    moduleHint: 'housing',
  }),
  field({
    fieldId: 'reliableFood',
    step: 6,
    sortOrder: 30,
    type: 'yesno',
    required: true,
    defaultValue: 'Yes',
    labels: { en: 'Do you have reliable access to food?' },
  }),
  field({
    fieldId: 'insuranceStatus',
    step: 6,
    sortOrder: 40,
    type: 'yesno',
    required: true,
    defaultValue: 'No',
    labels: { en: 'Do you currently have health insurance coverage?' },
    nurseSummary: true,
    moduleHint: 'insurance',
  }),
  field({
    fieldId: 'consent',
    step: 6,
    sortOrder: 50,
    type: 'checkbox',
    required: true,
    defaultValue: 'false',
    labels: { en: 'Consent' },
  }),
];

export const intakeSchemaFallback: IntakeSchema = {
  fields: intakeFieldsFallback,
  meta: intakeMetaFallback,
};

export function buildEmptyIntake(fields: IntakeFieldConfig[], email = ''): IntakeFormData {
  const data: IntakeFormData = {};
  for (const f of fields) {
    if (!f.enabled) continue;
    if (f.type === 'checkbox') {
      data[f.fieldId] = f.defaultValue.toLowerCase() === 'true';
    } else if (f.defaultValue) {
      data[f.fieldId] = f.defaultValue;
    } else {
      data[f.fieldId] = '';
    }
  }
  if (email) data.email = email;
  return data;
}

export function getFallbackIntakeSchema(): IntakeSchema {
  return intakeSchemaFallback;
}
