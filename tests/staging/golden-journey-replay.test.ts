import { expect, test } from 'bun:test';
import {
  assertStableReplay,
  invitationReplayFields,
  intakeReplayFields,
  learningReplayFields,
  publishReplayFields,
} from '../../packages/golden-journey/src/replay.ts';

const publishFirst = {
  releaseId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8101',
  releaseNumber: 1,
  candidateFingerprint: 'a'.repeat(64),
  operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8304',
  activeReleaseId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8101',
  draftVersion: 1,
  package: {
    digest: 'd'.repeat(64),
    format: 'school-configuration-package/v1',
    byteLength: 12,
  },
  replayed: false,
};

const invitationFirst = {
  classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8003',
  invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8004',
  operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8305',
  outcome: 'created',
};

const intakeFirst = {
  intakeRecordVersionId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8103',
  operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8307',
  learningUnlocked: true,
  acceptedAt: '2026-08-25T16:05:00.000Z',
  replayed: false,
};

const learningFirst = {
  itemCompletionId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8104',
  itemId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8105',
  revisionNumber: 1,
  schoolConfigurationReleaseId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8101',
  operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8308',
  completedAt: '2026-08-25T16:06:00.000Z',
  replayed: false,
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function setPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const segments = path.split('.');
  let current: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      throw new Error(`missing ${segment}`);
    }
    current = next as Record<string, unknown>;
  }
  current[segments.at(-1)!] = value;
}

test('replay accepts matching stable receipt fields and a replay marker', () => {
  expect(() =>
    assertStableReplay({
      first: publishFirst,
      second: { ...clone(publishFirst), replayed: true },
      fields: publishReplayFields,
      replayedSupported: true,
    }),
  ).not.toThrow();
});

test('replay ignores volatile HTTP metadata outside the contract fields', () => {
  expect(() =>
    assertStableReplay({
      first: publishFirst,
      second: {
        ...clone(publishFirst),
        replayed: true,
        requestId: 'req-2',
        date: 'Tue, 25 Aug 2026 16:01:00 GMT',
      },
      fields: publishReplayFields,
      replayedSupported: true,
    }),
  ).not.toThrow();
});

test('mutating any previously ignored stable publish field fails replay', () => {
  const mutations: Record<string, unknown> = {
    releaseId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8999',
    releaseNumber: 2,
    candidateFingerprint: 'b'.repeat(64),
    operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8998',
    activeReleaseId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8997',
    draftVersion: 9,
    'package.digest': 'c'.repeat(64),
    'package.format': 'other-package/v1',
    'package.byteLength': 99,
  };
  for (const [field, value] of Object.entries(mutations)) {
    const second = { ...clone(publishFirst), replayed: true };
    setPath(second as Record<string, unknown>, field, value);
    expect(() =>
      assertStableReplay({
        first: publishFirst,
        second,
        fields: publishReplayFields,
        replayedSupported: true,
      }),
    ).toThrow('Replay did not return a stable result');
  }
});

test('mutating any previously ignored stable invitation field fails replay', () => {
  const mutations: Record<string, unknown> = {
    classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8911',
    invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8912',
    operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8913',
    outcome: 'replayed',
  };
  for (const [field, value] of Object.entries(mutations)) {
    const second = { ...invitationFirst, [field]: value };
    expect(() =>
      assertStableReplay({
        first: invitationFirst,
        second,
        fields: invitationReplayFields,
        replayedSupported: false,
      }),
    ).toThrow('Replay did not return a stable result');
  }
});

test('mutating any previously ignored stable intake field fails replay', () => {
  const mutations: Record<string, unknown> = {
    intakeRecordVersionId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8921',
    operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8922',
    learningUnlocked: false,
    acceptedAt: '2026-08-25T16:09:00.000Z',
  };
  for (const [field, value] of Object.entries(mutations)) {
    const second = { ...clone(intakeFirst), replayed: true, [field]: value };
    expect(() =>
      assertStableReplay({
        first: intakeFirst,
        second,
        fields: intakeReplayFields,
        replayedSupported: true,
      }),
    ).toThrow('Replay did not return a stable result');
  }
});

test('mutating any previously ignored stable learning field fails replay', () => {
  const mutations: Record<string, unknown> = {
    itemCompletionId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8931',
    itemId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8932',
    revisionNumber: 2,
    schoolConfigurationReleaseId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8933',
    operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8934',
    completedAt: '2026-08-25T16:09:00.000Z',
  };
  for (const [field, value] of Object.entries(mutations)) {
    const second = { ...clone(learningFirst), replayed: true, [field]: value };
    expect(() =>
      assertStableReplay({
        first: learningFirst,
        second,
        fields: learningReplayFields,
        replayedSupported: true,
      }),
    ).toThrow('Replay did not return a stable result');
  }
});

test('replay fails when a replay marker is required and missing', () => {
  expect(() =>
    assertStableReplay({
      first: publishFirst,
      second: clone(publishFirst),
      fields: publishReplayFields,
      replayedSupported: true,
    }),
  ).toThrow('Replay did not return a stable result');
});
