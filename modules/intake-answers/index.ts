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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type IntakeCanonicalField = {
  id: string;
  type: string;
  required: boolean;
  requiredWhenVisible: boolean;
  visibility: { fieldId: string; equalsOptionCode: string } | null;
  optionCodes: string[];
};

export type IntakeFormCompatibility =
  'presentation-equivalent' | 'canonical-change';

export type IntakeCanonicalComparison = {
  compatibility: IntakeFormCompatibility;
  impactedFieldIds: string[];
  attestationChanged: boolean;
};

export type IntakeAnswerRebase = {
  answers: Record<string, string>;
  reviewFieldIds: string[];
  omittedFieldIds: string[];
};

function canonicalOptionCodes(field: Record<string, unknown>): string[] {
  if (!Array.isArray(field.options)) return [];
  return field.options
    .flatMap((option) =>
      isRecord(option) && typeof option.code === 'string' ? [option.code] : [],
    )
    .sort();
}

function canonicalVisibility(
  field: Record<string, unknown>,
): IntakeCanonicalField['visibility'] {
  if (!isRecord(field.visibility)) return null;
  if (
    typeof field.visibility.fieldId !== 'string' ||
    typeof field.visibility.equalsOptionCode !== 'string'
  ) {
    return null;
  }
  return {
    fieldId: field.visibility.fieldId,
    equalsOptionCode: field.visibility.equalsOptionCode,
  };
}

export function canonicalIntakeFieldsFromPayload(
  payload: unknown,
): IntakeCanonicalField[] {
  if (!isRecord(payload) || !Array.isArray(payload.fields)) return [];
  return payload.fields.flatMap((field) => {
    if (!isRecord(field) || typeof field.id !== 'string') return [];
    return [
      {
        id: field.id,
        type: typeof field.type === 'string' ? field.type : '',
        required: field.required === true,
        requiredWhenVisible: field.requiredWhenVisible === true,
        visibility: canonicalVisibility(field),
        optionCodes: canonicalOptionCodes(field),
      },
    ];
  });
}

export function canonicalAttestationTextFromPayload(
  payload: unknown,
): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.text)) return undefined;
  const english = payload.text['en-US'];
  if (!isRecord(english) || typeof english.value !== 'string') return undefined;
  return english.value;
}

function fieldCanonicalSignature(field: IntakeCanonicalField): string {
  return [
    field.type,
    field.required ? '1' : '0',
    field.requiredWhenVisible ? '1' : '0',
    field.visibility
      ? `${field.visibility.fieldId}=${field.visibility.equalsOptionCode}`
      : '',
    field.optionCodes.join(','),
  ].join('|');
}

export function compareIntakeCanonicalMeaning(input: {
  previousForm: unknown;
  nextForm: unknown;
  previousAttestation?: unknown;
  nextAttestation?: unknown;
}): IntakeCanonicalComparison {
  const previousFields = canonicalIntakeFieldsFromPayload(input.previousForm);
  const nextFields = canonicalIntakeFieldsFromPayload(input.nextForm);
  const previousById = new Map(
    previousFields.map((field) => [field.id, field]),
  );
  const nextById = new Map(nextFields.map((field) => [field.id, field]));
  const impacted = new Set<string>();
  for (const field of previousFields) {
    const next = nextById.get(field.id);
    if (
      !next ||
      fieldCanonicalSignature(field) !== fieldCanonicalSignature(next)
    ) {
      impacted.add(field.id);
    }
  }
  for (const field of nextFields) {
    const previous = previousById.get(field.id);
    if (
      !previous ||
      fieldCanonicalSignature(previous) !== fieldCanonicalSignature(field)
    ) {
      impacted.add(field.id);
    }
  }
  const attestationChanged =
    input.previousAttestation !== undefined ||
    input.nextAttestation !== undefined
      ? canonicalAttestationTextFromPayload(input.previousAttestation) !==
        canonicalAttestationTextFromPayload(input.nextAttestation)
      : false;
  const impactedFieldIds = [...impacted].sort();
  return {
    compatibility:
      impactedFieldIds.length === 0 && !attestationChanged
        ? 'presentation-equivalent'
        : 'canonical-change',
    impactedFieldIds,
    attestationChanged,
  };
}

function answerIsCompatible(
  field: IntakeCanonicalField,
  value: string | undefined,
): boolean {
  if (value === undefined || value.trim() === '') return false;
  if (field.optionCodes.length === 0) return true;
  const selected = selectedIntakeOptionCodes(value);
  if (selected.length === 0) return false;
  if (selected.some((code) => !field.optionCodes.includes(code))) return false;
  if (field.type !== 'multiple-choice' && selected.length !== 1) return false;
  return true;
}

export function rebaseIntakeAnswers(input: {
  previousForm: unknown;
  nextForm: unknown;
  answers: Record<string, string>;
}): IntakeAnswerRebase {
  const comparison = compareIntakeCanonicalMeaning({
    previousForm: input.previousForm,
    nextForm: input.nextForm,
  });
  const nextFields = canonicalIntakeFieldsFromPayload(input.nextForm);
  const nextById = new Map(nextFields.map((field) => [field.id, field]));
  const preserved: Record<string, string> = {};
  const omitted = new Set<string>();
  for (const [fieldId, value] of Object.entries(input.answers)) {
    const next = nextById.get(fieldId);
    if (!next || !answerIsCompatible(next, value)) {
      omitted.add(fieldId);
      continue;
    }
    preserved[fieldId] = value;
  }
  const previewFields: IntakePreviewField[] = nextFields.map((field) => ({
    id: field.id,
    type: field.type,
    required: field.required,
    requiredWhenVisible: field.requiredWhenVisible,
    visibility: field.visibility,
    options: field.optionCodes.map((code) => ({ code })),
  }));
  const visible = evaluateIntakePreview(previewFields, preserved);
  for (const fieldId of Object.keys(preserved)) {
    if (!visible.visibleFieldIds.includes(fieldId)) {
      omitted.add(fieldId);
    }
  }
  const reviewFieldIds = [
    ...new Set([
      ...comparison.impactedFieldIds.filter((fieldId) => nextById.has(fieldId)),
      ...[...omitted].filter((fieldId) => nextById.has(fieldId)),
    ]),
  ].sort();
  return {
    answers: visible.answers,
    reviewFieldIds,
    omittedFieldIds: [...omitted].sort(),
  };
}
