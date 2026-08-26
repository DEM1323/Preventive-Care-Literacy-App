export type LocalizedIntakeAnswerField = {
  options: { code: string; label: string }[];
};

export const supportedIntakeFieldTypes = [
  'text',
  'textarea',
  'date',
  'tel',
  'email',
  'yes-no',
  'single-choice',
  'multiple-choice',
  'acknowledgement',
] as const;

export type SupportedIntakeFieldType =
  (typeof supportedIntakeFieldTypes)[number];

export const choiceIntakeFieldTypes = [
  'yes-no',
  'single-choice',
  'multiple-choice',
] as const;

export type ChoiceIntakeFieldType = (typeof choiceIntakeFieldTypes)[number];

export type IntakePreviewField = {
  id: string;
  type: string;
  required: boolean;
  requiredWhenVisible: boolean;
  visibility: { fieldId: string; equalsOptionCode: string } | null;
  options: { code: string }[];
};

export type IntakePreviewEvaluation = {
  visibleFieldIds: string[];
  requiredFieldIds: string[];
  answers: Record<string, string>;
};

export function isSupportedIntakeFieldType(
  value: unknown,
): value is SupportedIntakeFieldType {
  return (
    typeof value === 'string' &&
    (supportedIntakeFieldTypes as readonly string[]).includes(value)
  );
}

export function isChoiceIntakeFieldType(
  value: unknown,
): value is ChoiceIntakeFieldType {
  return (
    typeof value === 'string' &&
    (choiceIntakeFieldTypes as readonly string[]).includes(value)
  );
}

export function selectedIntakeOptionCodes(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
}

export function intakeAnswerMatchesOption(
  answer: string | undefined,
  optionCode: string,
): boolean {
  return selectedIntakeOptionCodes(answer).includes(optionCode);
}

export function intakeFieldIsVisible(
  field: Pick<IntakePreviewField, 'visibility'>,
  answers: Record<string, string>,
): boolean {
  if (!field.visibility) return true;
  return intakeAnswerMatchesOption(
    answers[field.visibility.fieldId],
    field.visibility.equalsOptionCode,
  );
}

export function intakeFieldIsRequired(
  field: Pick<
    IntakePreviewField,
    'required' | 'requiredWhenVisible' | 'visibility'
  >,
  answers: Record<string, string>,
): boolean {
  if (!intakeFieldIsVisible(field, answers)) return false;
  return field.required || field.requiredWhenVisible;
}

export function omitHiddenIntakeAnswers(
  fields: readonly IntakePreviewField[],
  answers: Record<string, string>,
): Record<string, string> {
  const visible = new Set(
    fields
      .filter((field) => intakeFieldIsVisible(field, answers))
      .map((field) => field.id),
  );
  return Object.fromEntries(
    Object.entries(answers).filter(([fieldId]) => visible.has(fieldId)),
  );
}

export function evaluateIntakePreview(
  fields: readonly IntakePreviewField[],
  answers: Record<string, string>,
): IntakePreviewEvaluation {
  let current = { ...answers };
  for (let pass = 0; pass < fields.length + 1; pass += 1) {
    const next = omitHiddenIntakeAnswers(fields, current);
    if (
      Object.keys(next).length === Object.keys(current).length &&
      Object.keys(next).every((fieldId) => next[fieldId] === current[fieldId])
    ) {
      current = next;
      break;
    }
    current = next;
  }
  const visibleFields = fields.filter((field) =>
    intakeFieldIsVisible(field, current),
  );
  return {
    visibleFieldIds: visibleFields.map((field) => field.id),
    requiredFieldIds: visibleFields
      .filter((field) => intakeFieldIsRequired(field, current))
      .map((field) => field.id),
    answers: current,
  };
}

export function renderIntakeAnswer(
  field: LocalizedIntakeAnswerField,
  value: string,
): string | undefined {
  if (field.options.length === 0) return value;
  const labels = selectedIntakeOptionCodes(value).flatMap((code) => {
    const option = field.options.find((entry) => entry.code === code);
    return option ? [option.label] : [];
  });
  if (labels.length === 0) return undefined;
  return labels.join(', ');
}
