import { expect, test } from 'bun:test';
import {
  compareIntakeCanonicalMeaning,
  rebaseIntakeAnswers,
} from '../../modules/intake-answers/index.ts';

const parentId = '11111111-1111-4111-8111-111111111111';
const childId = '22222222-2222-4222-8222-222222222222';
const addedId = '33333333-3333-4333-8333-333333333333';

function localized(value: string, locale = 'en-US') {
  return {
    [locale]: { id: crypto.randomUUID(), revision: 1, value },
  };
}

function field(input: {
  id: string;
  type?: string;
  required?: boolean;
  requiredWhenVisible?: boolean;
  order?: number;
  helpText?: string;
  label?: string;
  visibility?: { fieldId: string; equalsOptionCode: string } | null;
  optionCodes?: string[];
}) {
  return {
    id: input.id,
    revision: 1,
    key: input.id,
    sectionId: 'section',
    order: input.order ?? 1,
    type: input.type ?? 'text',
    required: input.required ?? false,
    requiredWhenVisible: input.requiredWhenVisible ?? false,
    label: localized(input.label ?? 'Label'),
    ...(input.helpText ? { helpText: localized(input.helpText) } : {}),
    visibility: input.visibility ?? null,
    ...(input.optionCodes
      ? {
          options: input.optionCodes.map((code, index) => ({
            id: crypto.randomUUID(),
            revision: 1,
            order: index + 1,
            code,
            label: localized(code),
          })),
        }
      : {}),
  };
}

function form(fields: ReturnType<typeof field>[], title = 'Intake') {
  return {
    id: 'form',
    revision: 1,
    title: localized(title),
    fields,
  };
}

function attestation(text: string, translated?: string) {
  return {
    id: 'attestation',
    revision: 1,
    text: {
      ...localized(text),
      ...(translated ? localized(translated, 'es-US') : {}),
    },
  };
}

test('reordering, help-text, labels, and translations are presentation-equivalent', () => {
  const original = form([
    field({
      id: parentId,
      type: 'yes-no',
      optionCodes: ['yes', 'no'],
      order: 1,
    }),
    field({ id: childId, type: 'textarea', order: 2, helpText: 'Old help' }),
  ]);
  const presented = form(
    [
      field({
        id: childId,
        type: 'textarea',
        order: 1,
        helpText: 'New help',
        label: 'Revised label',
      }),
      field({
        id: parentId,
        type: 'yes-no',
        optionCodes: ['no', 'yes'],
        order: 2,
        label: 'Translated later',
      }),
    ],
    'Reordered title',
  );
  presented.fields[1]!.label = {
    ...presented.fields[1]!.label,
    ...localized('Etiqueta', 'es-US'),
  };
  expect(
    compareIntakeCanonicalMeaning({
      previousForm: original,
      nextForm: presented,
      previousAttestation: attestation('Notice', 'Aviso'),
      nextAttestation: attestation('Notice', 'Aviso revisado'),
    }),
  ).toEqual({
    compatibility: 'presentation-equivalent',
    impactedFieldIds: [],
    attestationChanged: false,
  });
});

test('canonical field, option, requiredness, visibility, membership, and attestation changes are distinct', () => {
  const original = form([
    field({ id: parentId, type: 'yes-no', optionCodes: ['yes', 'no'] }),
    field({
      id: childId,
      type: 'textarea',
      visibility: { fieldId: parentId, equalsOptionCode: 'yes' },
    }),
  ]);
  expect(
    compareIntakeCanonicalMeaning({
      previousForm: original,
      nextForm: form([
        field({ id: parentId, type: 'text' }),
        field({
          id: childId,
          type: 'textarea',
          visibility: { fieldId: parentId, equalsOptionCode: 'yes' },
        }),
      ]),
    }).impactedFieldIds,
  ).toEqual([parentId]);
  expect(
    compareIntakeCanonicalMeaning({
      previousForm: original,
      nextForm: form([
        field({
          id: parentId,
          type: 'yes-no',
          required: true,
          optionCodes: ['yes', 'no'],
        }),
        field({
          id: childId,
          type: 'textarea',
          visibility: { fieldId: parentId, equalsOptionCode: 'yes' },
        }),
      ]),
    }).impactedFieldIds,
  ).toEqual([parentId]);
  expect(
    compareIntakeCanonicalMeaning({
      previousForm: original,
      nextForm: form([
        field({ id: parentId, type: 'yes-no', optionCodes: ['yes', 'maybe'] }),
        field({
          id: childId,
          type: 'textarea',
          visibility: { fieldId: parentId, equalsOptionCode: 'yes' },
        }),
      ]),
    }).impactedFieldIds,
  ).toEqual([parentId]);
  expect(
    compareIntakeCanonicalMeaning({
      previousForm: original,
      nextForm: form([
        field({ id: parentId, type: 'yes-no', optionCodes: ['yes', 'no'] }),
        field({
          id: childId,
          type: 'textarea',
          visibility: { fieldId: parentId, equalsOptionCode: 'no' },
        }),
      ]),
    }).impactedFieldIds,
  ).toEqual([childId]);
  expect(
    compareIntakeCanonicalMeaning({
      previousForm: original,
      nextForm: form([
        field({ id: parentId, type: 'yes-no', optionCodes: ['yes', 'no'] }),
        field({
          id: childId,
          type: 'textarea',
          visibility: { fieldId: parentId, equalsOptionCode: 'yes' },
        }),
        field({ id: addedId, type: 'text', required: true }),
      ]),
    }).impactedFieldIds,
  ).toEqual([addedId]);
  expect(
    compareIntakeCanonicalMeaning({
      previousForm: original,
      nextForm: original,
      previousAttestation: attestation('Notice'),
      nextAttestation: attestation('Revised notice'),
    }),
  ).toMatchObject({
    compatibility: 'canonical-change',
    attestationChanged: true,
  });
});

test('rebase keeps compatible answers, flags impacted fields, and omits newly hidden answers', () => {
  const previous = form([
    field({ id: parentId, type: 'yes-no', optionCodes: ['yes', 'no'] }),
    field({
      id: childId,
      type: 'textarea',
      visibility: { fieldId: parentId, equalsOptionCode: 'yes' },
    }),
  ]);
  const next = form([
    field({ id: parentId, type: 'yes-no', optionCodes: ['yes', 'no'] }),
    field({
      id: childId,
      type: 'textarea',
      visibility: { fieldId: parentId, equalsOptionCode: 'no' },
    }),
    field({ id: addedId, type: 'text', required: true }),
  ]);
  const rebased = rebaseIntakeAnswers({
    previousForm: previous,
    nextForm: next,
    answers: {
      [parentId]: 'yes',
      [childId]: 'UNIQUE-HIDDEN-DETAIL',
    },
  });
  expect(rebased.answers).toEqual({ [parentId]: 'yes' });
  expect(rebased.reviewFieldIds).toEqual([childId, addedId]);
  expect(rebased.omittedFieldIds).toEqual([childId]);
});

test('rebase drops answers whose coded options no longer exist', () => {
  const previous = form([
    field({ id: parentId, type: 'yes-no', optionCodes: ['yes', 'no'] }),
  ]);
  const next = form([
    field({ id: parentId, type: 'yes-no', optionCodes: ['yes', 'unsure'] }),
  ]);
  const rebased = rebaseIntakeAnswers({
    previousForm: previous,
    nextForm: next,
    answers: { [parentId]: 'no' },
  });
  expect(rebased.answers).toEqual({});
  expect(rebased.reviewFieldIds).toEqual([parentId]);
  expect(rebased.omittedFieldIds).toEqual([parentId]);
});
