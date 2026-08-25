type IntakeField = {
  id: string;
  key: string;
  order: number;
  type: string;
  required: boolean;
  requiredWhenVisible: boolean;
  visibility: { fieldId: string; equalsOptionCode: string } | null;
  options: { code: string }[];
};

export function completeSyntheticIntakeAnswers(
  fields: readonly IntakeField[],
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const field of [...fields].sort(
    (left, right) => left.order - right.order,
  )) {
    const visible =
      !field.visibility ||
      answers[field.visibility.fieldId] === field.visibility.equalsOptionCode;
    if (!visible) continue;
    if (field.options.length > 0) {
      answers[field.id] =
        field.options.find((option) => option.code === 'no')?.code ??
        field.options[0]?.code ??
        'no';
      continue;
    }
    if (field.type === 'date') {
      answers[field.id] = '2012-03-14';
      continue;
    }
    if (field.required || field.requiredWhenVisible || field.key === 'name') {
      answers[field.id] =
        field.key === 'name'
          ? 'Synthetic Student'
          : field.type === 'tel'
            ? '5550100'
            : 'Synthetic';
    }
  }
  return answers;
}
