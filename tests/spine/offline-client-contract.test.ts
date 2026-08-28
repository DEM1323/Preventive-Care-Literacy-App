import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const openapi = JSON.parse(
  readFileSync(
    new URL('../../packages/http-contract/openapi.json', import.meta.url),
    'utf8',
  ),
) as {
  paths: Record<
    string,
    Record<
      string,
      {
        operationId?: string;
        requestBody?: {
          content?: {
            'application/json'?: { schema?: Record<string, unknown> };
          };
        };
        responses?: Record<string, unknown>;
      }
    >
  >;
};

function schemaOf(path: string, method: string) {
  const operation = openapi.paths[path]?.[method];
  expect(operation?.operationId).toBeString();
  return operation;
}

function jsonSchema(path: string, method: string) {
  const schema = schemaOf(path, method)?.requestBody?.content?.[
    'application/json'
  ]?.schema;
  expect(isRecord(schema)).toBe(true);
  return schema as {
    required?: string[];
    properties?: Record<string, unknown>;
  };
}

test('offline-client contract keeps operation identities, exact revisions, and repair preconditions', () => {
  expect(schemaOf('/api/v1/operator/repairable-work', 'get')?.operationId).toBe(
    'listOperatorRepairableWork',
  );
  expect(schemaOf('/api/v1/operator/repairs', 'post')?.operationId).toBe(
    'repairOperatorWork',
  );
  const repair = jsonSchema('/api/v1/operator/repairs', 'post');
  expect(repair.required).toEqual(
    expect.arrayContaining([
      'operationId',
      'workspaceId',
      'kind',
      'workId',
      'failedOperationId',
      'confirmation',
    ]),
  );
  expect(repair.properties?.confirmation).toMatchObject({
    type: 'string',
    enum: ['resume_failed_work'],
  });
  const listed = schemaOf('/api/v1/operator/repairable-work', 'get');
  const listedSchema = listed?.responses as
    | Record<
        string,
        { content?: { 'application/json'?: { schema?: unknown } } }
      >
    | undefined;
  expect(JSON.stringify(listedSchema?.['200'])).toContain(
    'RESUME_FAILED_INVITATION_DELIVERY',
  );
  expect(JSON.stringify(listedSchema?.['200'])).toContain(
    'RETRY_PUBLICATION_WITH_NEW_OPERATION',
  );
  expect(JSON.stringify(repair)).not.toContain('recipient');
  expect(JSON.stringify(repair)).not.toContain('answers');
  expect(JSON.stringify(repair)).not.toContain('sessionHandle');

  const intakeDraft = jsonSchema('/api/v1/student/intake/draft', 'put');
  expect(intakeDraft.required).toEqual(
    expect.arrayContaining([
      'operationId',
      'expectedDraftRevision',
      'expectedSchoolConfigurationReleaseId',
      'expectedIntakeForm',
    ]),
  );
  const intakeSubmit = jsonSchema('/api/v1/student/intake/submissions', 'post');
  expect(intakeSubmit.required).toEqual(
    expect.arrayContaining([
      'operationId',
      'expectedSchoolConfigurationReleaseId',
      'expectedIntakeForm',
      'expectedSubmissionAttestation',
    ]),
  );
  const learning = jsonSchema(
    '/api/v1/student/learning/acknowledgements',
    'post',
  );
  expect(learning.required).toEqual(
    expect.arrayContaining([
      'operationId',
      'expectedSchoolConfigurationReleaseId',
      'itemId',
      'revisionNumber',
    ]),
  );
  const publish = jsonSchema(
    '/api/v1/administration/school-configuration/releases',
    'post',
  );
  expect(publish.required).toEqual(
    expect.arrayContaining([
      'operationId',
      'expectedActiveReleaseId',
      'expectedDraftVersion',
      'candidateFingerprint',
    ]),
  );

  const conflict = schemaOf('/api/v1/student/intake/draft', 'put')?.responses;
  expect(conflict?.['409']).toBeDefined();
  const repairConflict = schemaOf(
    '/api/v1/operator/repairs',
    'post',
  )?.responses;
  expect(repairConflict?.['409']).toBeDefined();
  expect(repairConflict?.['401']).toBeDefined();
  expect(openapi.paths['/api/v1/student/offline']).toBeUndefined();
  expect(JSON.stringify(openapi.paths)).not.toContain('serviceWorker');
  expect(JSON.stringify(openapi.paths)).not.toContain('localVault');
});
