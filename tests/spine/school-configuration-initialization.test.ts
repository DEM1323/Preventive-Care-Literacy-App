import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  collectValidationResults,
  createInitialSchoolConfigurationCandidate,
  createSchoolConfigurationInitializationIds,
  extractExactResources,
} from '../../modules/school-configuration/index.ts';

test('initial school configuration uses fresh school-authored scaffolding without demo content', () => {
  const workspaceId = randomUUID();
  const candidate = createInitialSchoolConfigurationCandidate({
    workspaceId,
    displayName: 'Pilot Community School',
    shortName: 'Pilot School',
    actorId: randomUUID(),
    ids: { create: randomUUID },
  });
  const serialized = JSON.stringify(candidate);
  const validation = collectValidationResults(candidate, workspaceId);
  const resources = extractExactResources(candidate);

  expect(serialized).toContain('Pilot Community School');
  expect(serialized).toContain('Pilot School');
  expect(serialized.toLowerCase()).not.toContain('synthetic');
  expect(serialized.toLowerCase()).not.toContain('demo');
  expect(serialized).not.toContain('UMass');
  expect(resources.length).toBeGreaterThan(10);
  expect(new Set(resources.map((resource) => resource.resourceId)).size).toBe(
    resources.length,
  );
  expect(
    validation.blockers.some(
      (blocker) => blocker.code === 'MISSING_TRANSLATION',
    ),
  ).toBe(true);
  expect(
    validation.blockers.some(
      (blocker) => blocker.code === 'INVALID_SCHOOL_CONFIGURATION',
    ),
  ).toBe(false);
});

test('initialization retries produce the same candidate fingerprint input', () => {
  const operationId = randomUUID();
  const input = {
    workspaceId: randomUUID(),
    displayName: 'Pilot Community School',
    shortName: 'Pilot School',
    actorId: randomUUID(),
  };

  const first = createInitialSchoolConfigurationCandidate({
    ...input,
    ids: createSchoolConfigurationInitializationIds(operationId),
  });
  const retry = createInitialSchoolConfigurationCandidate({
    ...input,
    ids: createSchoolConfigurationInitializationIds(operationId),
  });

  expect(retry).toEqual(first);
});
