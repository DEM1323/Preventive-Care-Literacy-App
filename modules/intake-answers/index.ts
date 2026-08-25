export type LocalizedIntakeAnswerField = {
  options: { code: string; label: string }[];
};

export function renderIntakeAnswer(
  field: LocalizedIntakeAnswerField,
  value: string,
): string | undefined {
  if (field.options.length === 0) return value;
  return field.options.find((option) => option.code === value)?.label;
}
