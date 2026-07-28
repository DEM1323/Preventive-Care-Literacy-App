import type { IntakeFieldConfig, IntakeFormData } from '../types/intakeSchema';

function isFieldVisible(field: IntakeFieldConfig, data: IntakeFormData): boolean {
  if (!field.enabled) return false;
  if (!field.showIfField) return true;
  return String(data[field.showIfField] ?? '') === field.showIfValue;
}

function fieldLabel(field: IntakeFieldConfig): string {
  return field.labels.en ?? field.fieldId;
}

export function getEnabledSteps(fields: IntakeFieldConfig[]): number[] {
  const steps = new Set<number>();
  for (const f of fields) {
    if (f.enabled) steps.add(f.step);
  }
  return Array.from(steps).sort((a, b) => a - b);
}

export function getFieldsForStep(fields: IntakeFieldConfig[], step: number): IntakeFieldConfig[] {
  return fields
    .filter((f) => f.enabled && f.step === step)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function validateIntakeStep(
  step: number,
  data: IntakeFormData,
  fields: IntakeFieldConfig[]
): string | null {
  const stepFields = getFieldsForStep(fields, step);

  for (const field of stepFields) {
    if (!isFieldVisible(field, data)) continue;

    if (field.type === 'checkbox') {
      if (field.required && !data[field.fieldId]) {
        return field.fieldId === 'consent'
          ? 'Consent is required'
          : `${fieldLabel(field)} is required`;
      }
      continue;
    }

    if (field.type === 'yesno') {
      const value = String(data[field.fieldId] ?? '');
      if (field.required && value !== 'Yes' && value !== 'No') {
        return `${fieldLabel(field)} is required`;
      }
      continue;
    }

    if (!field.required) continue;

    const value = String(data[field.fieldId] ?? '').trim();
    if (!value) {
      return `${fieldLabel(field)} is required`;
    }
  }

  return null;
}

export function isFieldShown(field: IntakeFieldConfig, data: IntakeFormData): boolean {
  return isFieldVisible(field, data);
}
