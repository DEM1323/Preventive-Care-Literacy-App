import { isRecord } from './http.ts';
import { NonRetryableGoldenJourneyError } from './retry.ts';

export const publishReplayFields = [
  'releaseId',
  'releaseNumber',
  'candidateFingerprint',
  'operationId',
  'activeReleaseId',
  'draftVersion',
  'package.digest',
  'package.format',
  'package.byteLength',
] as const;

export const invitationReplayFields = [
  'classId',
  'invitationId',
  'operationId',
  'outcome',
] as const;

export const intakeReplayFields = [
  'intakeRecordVersionId',
  'operationId',
  'learningUnlocked',
  'acceptedAt',
] as const;

export const learningReplayFields = [
  'itemCompletionId',
  'itemId',
  'revisionNumber',
  'schoolConfigurationReleaseId',
  'operationId',
  'completedAt',
] as const;

function valueAtPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

export function assertStableReplay(input: {
  first: unknown;
  second: unknown;
  fields: readonly string[];
  replayedSupported: boolean;
}): void {
  if (!isRecord(input.first) || !isRecord(input.second)) {
    throw new NonRetryableGoldenJourneyError(
      'Replay did not return a stable result',
    );
  }
  for (const field of input.fields) {
    if (valueAtPath(input.first, field) !== valueAtPath(input.second, field)) {
      throw new NonRetryableGoldenJourneyError(
        'Replay did not return a stable result',
      );
    }
    if (valueAtPath(input.first, field) === undefined) {
      throw new NonRetryableGoldenJourneyError(
        'Replay did not return a stable result',
      );
    }
  }
  if (input.replayedSupported && input.second.replayed !== true) {
    throw new NonRetryableGoldenJourneyError(
      'Replay did not return a stable result',
    );
  }
}
