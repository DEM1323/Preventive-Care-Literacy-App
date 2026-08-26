import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { createServer } from '../../apps/server/src/app.ts';
import {
  applyGeneratedTranslations,
  assertApprovedTranslationRequest,
  extractTranslatableSegments,
  presentManagedTranslations,
  translationAdapterId,
  translationAdapterVersion,
  translationGlossaryRevision,
  translationSafetyRegressionFixtures,
  validateTranslationSafety,
} from '../../modules/school-configuration/index.ts';
import { createApiClient } from '../../packages/api-client/src/index.ts';
import { createTelemetry } from '../../packages/observability/src/index.ts';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import {
  createDeterministicTranslationAdapter,
  createGoogleCloudTranslationAdapter,
} from '../../packages/translation-adapter/src/index.ts';
import {
  createRuntimeDatabaseUser,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from '../../packages/test-support/src/postgres.ts';
import { createFakeStaffAuth } from '../../packages/test-support/src/staff-auth.ts';
import { totpCode } from '../../packages/test-support/src/totp.ts';

const workspaceId = 'beb4193a-1e8f-4096-a449-6d77628fd275';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf9001';
const password = 'correct horse battery staple';
const email = 'administrator@example.test';
const origin = 'http://127.0.0.1';
const brandingId = '67f942fa-8fa7-4fec-9b30-2773940cb1d2';
const operatorHeaders = {
  authorization: `Bearer ${'translation-operator-token-'.padEnd(40, 'x')}`,
  origin,
  'x-prevcare-csrf': '1',
} as const;

let now = new Date('2026-08-26T18:00:00.000Z');
let postgres: EphemeralPostgres;
let server: FastifyInstance;
let baseUrl: string;
let cookie: string;
let candidate: Record<string, unknown>;
const fakeAuth = createFakeStaffAuth();
const telemetryLines: string[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function staffHeaders() {
  return { ...operatorHeaders, cookie };
}

function localized(value: unknown, locale: string): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[locale])) {
    throw new Error(`missing ${locale}`);
  }
  return value[locale];
}

function brandingDisplayName(draftCandidate: unknown) {
  if (!isRecord(draftCandidate) || !isRecord(draftCandidate.workspace)) {
    throw new Error('missing workspace');
  }
  const branding = draftCandidate.workspace.branding;
  if (!isRecord(branding)) throw new Error('missing branding');
  return branding.displayName;
}

async function importFixture() {
  const client = createApiClient(baseUrl);
  const imported = await client.POST(
    '/api/v1/administration/school-configuration/draft-imports',
    {
      headers: staffHeaders(),
      body: {
        operationId: crypto.randomUUID(),
        expectedDraftVersion: 0,
        candidate,
      },
    },
  );
  expect(imported.response.status).toBe(201);
  return imported.data;
}

async function readDraft() {
  const client = createApiClient(baseUrl);
  const draft = await client.GET(
    '/api/v1/administration/school-configuration',
    { headers: { cookie } },
  );
  expect(draft.response.status).toBe(200);
  return draft.data;
}

async function editDraft(body: Record<string, unknown>) {
  const client = createApiClient(baseUrl);
  return client.POST(
    '/api/v1/administration/school-configuration/draft-edits',
    { headers: staffHeaders(), body },
  );
}

async function generateTranslations(body: Record<string, unknown>) {
  const client = createApiClient(baseUrl);
  return client.POST(
    '/api/v1/administration/school-configuration/managed-translation-generations',
    { headers: staffHeaders(), body },
  );
}

for (const fixture of translationSafetyRegressionFixtures) {
  test(`translation safety ${fixture.name}`, () => {
    expect(
      validateTranslationSafety({
        source: fixture.source,
        generated: fixture.generated,
        kind: fixture.kind,
        requiredTerms: fixture.requiredTerms,
        optionCodes: fixture.optionCodes,
        optionCount: fixture.optionCount,
        receivedOptionCount: fixture.receivedOptionCount,
      }),
    ).toBe(fixture.code);
  });
}

test('the translation adapter only accepts approved segment kinds from authored identities', () => {
  expect(() =>
    assertApprovedTranslationRequest({
      segments: [
        {
          kind: 'student_answer' as never,
          path: 'student.answers',
          sourceResourceId: crypto.randomUUID(),
          sourceRevision: 1,
          sourceText: 'I take insulin',
          locale: 'es-US',
          requiredTerms: [],
          optionCodes: [],
          optionCount: null,
          schoolEditable: false,
        },
      ],
    }),
  ).toThrow('The translation adapter rejected the request');

  const segments = extractTranslatableSegments(
    {
      workspace: {
        branding: {
          displayName: {
            'en-US': {
              id: 'e2fae1d5-9258-400a-aec9-390a617f315d',
              revision: 1,
              value: 'Harbor School',
            },
          },
        },
      },
      studentAnswers: {
        'en-US': {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          revision: 1,
          value: 'private student answer',
        },
      },
    },
    'es-US',
  );
  expect(
    segments.every((segment) =>
      [
        'interface_string',
        'learning_module_field',
        'intake_question',
        'intake_answer_option',
      ].includes(segment.kind),
    ),
  ).toBe(true);
  expect(
    segments.some((segment) => segment.sourceText === 'private student answer'),
  ).toBe(false);
  expect(
    segments.some((segment) => segment.sourceText === 'Harbor School'),
  ).toBe(true);
  expect(segments.some((segment) => segment.sourceText === 'Back')).toBe(true);
});

test('intake option segments send labels and keep stable codes off the adapter payload', () => {
  const segments = extractTranslatableSegments(
    {
      release: {
        intakeForm: {
          fields: [
            {
              options: [
                {
                  code: 'yes',
                  label: {
                    'en-US': {
                      id: '5c18cf8b-ec91-4b27-bc97-9051c0ca892b',
                      revision: 1,
                      value: 'Yes',
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    },
    'es-US',
  );
  const option = segments.find(
    (segment) => segment.kind === 'intake_answer_option',
  );
  expect(option?.sourceText).toBe('Yes');
  expect(option?.optionCodes).toEqual(['yes']);
  expect(option?.sourceText).not.toBe('yes');
});

beforeAll(async () => {
  candidate = JSON.parse(
    await readFile(
      new URL(
        '../../docs/fixtures/umb-demo-school-configuration-release-1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;
  postgres = await startEphemeralPostgres();
  await migrate(postgres.connectionString);
  const runtimeDatabaseUrl = await createRuntimeDatabaseUser(
    postgres.connectionString,
  );
  server = await createServer({
    databaseUrl: runtimeDatabaseUrl,
    publicOrigin: origin,
    operatorCredentials: {
      token: operatorHeaders.authorization.slice('Bearer '.length),
      actorId: 'translation-test-operator',
    },
    staffAuth: fakeAuth.provider,
    clock: { now: () => now },
    translationAdapter: createDeterministicTranslationAdapter(),
    telemetry: createTelemetry((line) => telemetryLines.push(line)),
  });
  baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  const client = createApiClient(baseUrl);
  const workspace = await client.POST(
    '/api/v1/administration/school-workspaces',
    {
      headers: operatorHeaders,
      body: {
        operationId: crypto.randomUUID(),
        workspaceId,
        displayName: 'UMass Boston Demo Workspace',
      },
    },
  );
  expect(workspace.response.status).toBe(201);
  const staff = await client.POST('/api/v1/administration/staff-identities', {
    headers: operatorHeaders,
    body: {
      operationId: crypto.randomUUID(),
      workspaceId,
      staffIdentityId,
      displayName: 'Demo Administrator',
      email,
      permissions: ['administrative'],
      schoolApprover: 'Demo principal',
      reason: 'Managed Translation generation test',
      initialPassword: password,
    },
  });
  expect(staff.response.status).toBe(201);
  const signIn = await client.POST('/api/v1/auth/staff/sign-in', {
    headers: { origin, 'x-prevcare-csrf': '1' },
    body: { email, password },
  });
  expect(signIn.response.status).toBe(200);
  const authenticated = await client.POST('/api/v1/auth/staff/totp', {
    headers: { origin, 'x-prevcare-csrf': '1' },
    body: {
      flowHandle: signIn.data?.flowHandle ?? '',
      code: totpCode(fakeAuth.totpSecretFor(email)),
    },
  });
  expect(authenticated.response.status).toBe(200);
  cookie = authenticated.response.headers
    .get('set-cookie')
    ?.split(';', 1)[0] as string;
});

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
});

test('generated text stays unreviewed, source edits stale only matching drafts, and regeneration keeps reviewed text', async () => {
  await importFixture();
  const before = await readDraft();
  const displayName = brandingDisplayName(before?.candidate);
  const english = localized(displayName, 'en-US');
  const spanish = localized(displayName, 'es-US');
  expect(
    presentManagedTranslations(before?.candidate).locales[0],
  ).toMatchObject({
    locale: 'es-US',
    stale: 0,
    generated: 0,
  });
  expect(
    presentManagedTranslations(before?.candidate).locales[0]?.reviewed,
  ).toBeGreaterThan(0);

  const branding =
    isRecord(before?.candidate) && isRecord(before.candidate.workspace)
      ? before.candidate.workspace.branding
      : undefined;
  const edited = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: before?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: brandingId,
        revisionNumber: Number(isRecord(branding) ? branding.revision : 1),
      },
    ],
    type: 'save-workspace-branding',
    resourceId: brandingId,
    displayName: 'Harborview Demonstration School',
    shortName: String(
      localized(isRecord(branding) ? branding.shortName : undefined, 'en-US')
        .value,
    ),
    generatedTextMark: String(
      isRecord(branding) ? branding.generatedTextMark : 'UD',
    ),
    primaryColor: String(
      isRecord(branding) ? branding.primaryColor : '#075985',
    ),
    accentColor: String(isRecord(branding) ? branding.accentColor : '#B45309'),
  });
  expect(edited.response.status).toBe(200);
  const afterName = brandingDisplayName(edited.data?.candidate);
  expect(localized(afterName, 'en-US').value).toBe(
    'Harborview Demonstration School',
  );
  expect(localized(afterName, 'es-US').value).toBe(spanish.value);
  const work = presentManagedTranslations(edited.data?.candidate);
  const staleDisplay = work.items.find(
    (item) =>
      item.sourceResourceId === String(english.id) && item.locale === 'es-US',
  );
  expect(staleDisplay?.status).toBe('stale');
  expect(
    work.items.some(
      (item) =>
        item.sourceResourceId !== String(english.id) &&
        item.locale === 'es-US' &&
        item.status === 'reviewed',
    ),
  ).toBe(true);

  const generated = await generateTranslations({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: edited.data?.draftVersion,
    locale: 'es-US',
    sourceResourceIds: [String(english.id)],
  });
  expect(generated.response.status).toBe(200);
  expect(
    telemetryLines.some((line) =>
      line.includes('translation.generation.completed'),
    ),
  ).toBe(true);
  expect(telemetryLines.join('\n')).not.toContain(
    'Harborview Demonstration School',
  );
  const generatedName = localized(
    brandingDisplayName(generated.data?.candidate),
    'es-US',
  );
  expect(generatedName.value).toBe('[es-US] Harborview Demonstration School');
  expect(generatedName.origin).toBe('generated');
  expect(generatedName.reviewProvenanceId).toBeUndefined();
  expect(generatedName.generation).toMatchObject({
    adapter: 'google-cloud-translation-advanced',
    glossaryRevision: 'school-health-glossary/v1',
  });

  const reviewed = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: generated.data?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: String(generatedName.id),
        revisionNumber: Number(generatedName.revision),
      },
    ],
    type: 'review-managed-translation',
    resourceId: String(english.id),
    locale: 'es-US',
  });
  expect(reviewed.response.status).toBe(200);
  const reviewedName = localized(
    brandingDisplayName(reviewed.data?.candidate),
    'es-US',
  );
  expect(reviewedName.reviewProvenanceId).toEqual(expect.any(String));
  expect(reviewedName.reviewer).toBe(staffIdentityId);

  const regenerated = await generateTranslations({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: reviewed.data?.draftVersion,
    locale: 'es-US',
    sourceResourceIds: [String(english.id)],
  });
  expect(regenerated.response.status).toBe(200);
  expect(
    localized(brandingDisplayName(regenerated.data?.candidate), 'es-US').value,
  ).toBe('[es-US] Harborview Demonstration School');
  expect(
    localized(brandingDisplayName(regenerated.data?.candidate), 'es-US')
      .reviewProvenanceId,
  ).toBe(reviewedName.reviewProvenanceId);

  const editedTranslation = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: regenerated.data?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: String(reviewedName.id),
        revisionNumber: Number(
          localized(brandingDisplayName(regenerated.data?.candidate), 'es-US')
            .revision,
        ),
      },
    ],
    type: 'save-managed-translation',
    resourceId: String(english.id),
    locale: 'es-US',
    text: 'Escuela de demostración Harborview',
  });
  expect(editedTranslation.response.status).toBe(200);
  const humanEdited = localized(
    brandingDisplayName(editedTranslation.data?.candidate),
    'es-US',
  );
  expect(humanEdited.value).toBe('Escuela de demostración Harborview');
  expect(humanEdited.origin).toBe('reviewer-edited');
  expect(humanEdited.reviewProvenanceId).toBeUndefined();
  expect(
    JSON.stringify(editedTranslation.data?.managedTranslations).includes(
      'Harborview',
    ),
  ).toBe(false);
}, 40_000);

test('unsafe provider output never enters the draft', () => {
  const sourceId = 'e2fae1d5-9258-400a-aec9-390a617f315d';
  const applied = applyGeneratedTranslations({
    candidate: {
      workspace: {
        branding: {
          displayName: {
            'en-US': {
              id: sourceId,
              revision: 2,
              value:
                'For a life-threatening emergency, call 911 or go to an emergency room.',
            },
          },
        },
      },
    },
    locale: 'es-US',
    outputs: [
      {
        sourceResourceId: sourceId,
        locale: 'es-US',
        text: 'Para una emergencia, llame al 112.',
      },
    ],
    adapter: {
      id: translationAdapterId,
      version: translationAdapterVersion,
      model: 'nmt',
      glossaryRevision: translationGlossaryRevision,
    },
    generatedAt: now,
    ids: { create: () => '11111111-1111-4111-8111-111111111111' },
    requestedSourceIds: [sourceId],
  });
  expect(applied.written).toBe(0);
  expect(applied.rejected).toEqual([
    {
      sourceResourceId: sourceId,
      locale: 'es-US',
      code: 'EMERGENCY_NUMBER',
    },
  ]);
});

test('Google Cloud Translation Advanced adapter uses a US endpoint and restores placeholders', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const adapter = createGoogleCloudTranslationAdapter({
    projectId: 'prevcare-alpha',
    credentials: {
      clientEmail: 'translator@prevcare.example',
      privateKey: 'unused',
    },
    accessToken: 'test-token',
    request: async (url, init) => {
      requests.push({
        url,
        body:
          typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      });
      return new Response(
        JSON.stringify({
          translations: [
            { translatedText: 'Paso ⟦PH0⟧ de ⟦PH1⟧', model: 'nmt' },
          ],
        }),
        { status: 200 },
      );
    },
  });
  const result = await adapter.translate({
    segments: [
      {
        kind: 'interface_string',
        path: 'release.interfaceStrings.student.stepProgress.text',
        sourceResourceId: '6f9a1b23-45c7-4d89-ae12-3a4b5c6d7e8f',
        sourceRevision: 1,
        sourceText: 'Step {current} of {total}',
        locale: 'es-US',
        requiredTerms: [],
        optionCodes: [],
        optionCount: null,
        schoolEditable: false,
      },
    ],
  });
  expect(requests[0]?.url).toContain(
    '/v3/projects/prevcare-alpha/locations/us-central1:translateText',
  );
  expect(requests[0]?.body).toMatchObject({
    sourceLanguageCode: 'en',
    targetLanguageCode: 'es',
    mimeType: 'text/plain',
  });
  expect(JSON.stringify(requests[0]?.body)).not.toContain('{current}');
  expect(result.outputs[0]?.text).toBe('Paso {current} de {total}');
});
