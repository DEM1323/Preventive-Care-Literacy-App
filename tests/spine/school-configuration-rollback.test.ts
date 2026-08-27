import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { createServer } from '../../apps/server/src/app.ts';
import { createApiClient } from '../../packages/api-client/src/index.ts';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import {
  createRuntimeDatabaseUser,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from '../../packages/test-support/src/postgres.ts';
import { createFakeStaffAuth } from '../../packages/test-support/src/staff-auth.ts';
import { totpCode } from '../../packages/test-support/src/totp.ts';

const workspaceId = 'beb4193a-1e8f-4096-a449-6d77628fd275';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8001';
const password = 'correct horse battery staple';
const email = 'administrator@example.test';
const origin = 'http://127.0.0.1';
const brandingId = '67f942fa-8fa7-4fec-9b30-2773940cb1d2';
const firstModuleId = '16481542-3831-4d18-aa0c-f138fbc7a970';
const operatorHeaders = {
  authorization: `Bearer ${'rollback-operator-token-'.padEnd(40, 'x')}`,
  origin,
  'x-prevcare-csrf': '1',
} as const;

let now = new Date('2026-08-26T16:00:00.000Z');
let postgres: EphemeralPostgres;
let server: FastifyInstance;
let baseUrl: string;
let cookie: string;
let candidate: Record<string, unknown>;
const fakeAuth = createFakeStaffAuth();

function staffHeaders() {
  return { ...operatorHeaders, cookie };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function brandingOf(draftCandidate: unknown) {
  if (!isRecord(draftCandidate) || !isRecord(draftCandidate.workspace)) {
    throw new Error('missing workspace');
  }
  const branding = draftCandidate.workspace.branding;
  if (!isRecord(branding)) throw new Error('missing branding');
  return branding;
}

function modulesOf(draftCandidate: unknown) {
  if (!isRecord(draftCandidate) || !isRecord(draftCandidate.release)) {
    throw new Error('missing release');
  }
  const modules = draftCandidate.release.modules;
  if (!Array.isArray(modules)) throw new Error('missing modules');
  return modules.filter(isRecord);
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

async function stepUp() {
  const client = createApiClient(baseUrl);
  const steppedUp = await client.POST('/api/v1/auth/staff/step-up', {
    headers: staffHeaders(),
    body: { password, totp: totpCode(fakeAuth.totpSecretFor(email)) },
  });
  expect(steppedUp.response.status).toBe(200);
}

async function publish(input: {
  expectedActiveReleaseId: string | null;
  expectedDraftVersion: number;
  candidateFingerprint: string;
  changeDescription: string;
}) {
  const client = createApiClient(baseUrl);
  return client.POST('/api/v1/administration/school-configuration/releases', {
    headers: staffHeaders(),
    body: {
      operationId: crypto.randomUUID(),
      ...input,
    },
  });
}

async function editDraft(body: Record<string, unknown>) {
  const client = createApiClient(baseUrl);
  return client.POST(
    '/api/v1/administration/school-configuration/draft-edits',
    { headers: staffHeaders(), body },
  );
}

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
      actorId: 'rollback-test-operator',
    },
    staffAuth: fakeAuth.provider,
    clock: { now: () => now },
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
      reason: 'School Configuration rollback test',
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
});

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
});

test('readiness links every result to an editor and exact preview location and keeps warnings non-blocking', async () => {
  const draft = await readDraft();
  expect(draft?.validation.blockers).toEqual([]);
  expect(
    draft?.validation.warnings.some(
      (warning) =>
        warning.code === 'MISSING_OPTIONAL_MARK' &&
        warning.severity === 'warning' &&
        warning.location.editorResource === 'branding' &&
        warning.location.previewScreen === 'home' &&
        warning.location.resourceId === brandingId,
    ),
  ).toBe(true);

  const created = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: draft?.draftVersion,
    expectedResourceRevisions: [],
    type: 'create-learning-module',
    title: 'Unreviewed extra module',
    description: 'Needs Managed Translations before it can publish.',
  });
  expect(created.response.status).toBe(200);
  const translationBlocker = created.data?.validation.blockers.find(
    (blocker) => blocker.code === 'MISSING_TRANSLATION',
  );
  expect(translationBlocker).toMatchObject({
    severity: 'blocker',
    location: {
      editorResource: 'translations',
      previewScreen: 'module',
    },
  });
  expect(translationBlocker?.location.moduleId).toEqual(expect.any(String));
  expect(translationBlocker?.location.locale).toMatch(
    /^(es-US|pt-BR|fr-CA|ht-HT)$/,
  );

  const discarded = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: created.data?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: String(modulesOf(created.data?.candidate).at(-1)?.id),
        revisionNumber: Number(
          modulesOf(created.data?.candidate).at(-1)?.revision,
        ),
      },
    ],
    type: 'discard-authored-resource',
    resourceId: String(modulesOf(created.data?.candidate).at(-1)?.id),
  });
  expect(discarded.response.status).toBe(200);
  expect(discarded.data?.validation.blockers).toEqual([]);
}, 20_000);

test('publication requires unpublished resource-level changes and records exact release history', async () => {
  const beforePublish = await readDraft();
  expect(beforePublish?.unpublishedChanges).toBe(true);
  const brandingComparison = beforePublish?.comparisons.find(
    (comparison) => comparison.resourceId === brandingId,
  );
  expect(brandingComparison).toMatchObject({
    slot: 'candidate.workspace.branding',
    change: 'added',
    differs: true,
    discardEligible: true,
  });
  expect(brandingComparison?.label).toContain('UMass Boston');

  await stepUp();
  const published = await publish({
    expectedActiveReleaseId: null,
    expectedDraftVersion: beforePublish?.draftVersion ?? 0,
    candidateFingerprint: beforePublish?.candidateFingerprint ?? '',
    changeDescription: 'Publish the reviewed synthetic golden-journey content.',
  });
  expect(published.response.status).toBe(201);
  expect(published.data?.releaseNumber).toBe(1);
  const firstReleaseId = published.data?.releaseId ?? '';
  const firstFingerprint = published.data?.candidateFingerprint ?? '';

  const current = await readDraft();
  expect(current?.unpublishedChanges).toBe(false);
  expect(
    current?.comparisons.every(
      (comparison) => comparison.change === 'unchanged',
    ),
  ).toBe(true);

  await stepUp();
  const unchanged = await publish({
    expectedActiveReleaseId: firstReleaseId,
    expectedDraftVersion: current?.draftVersion ?? 0,
    candidateFingerprint: current?.candidateFingerprint ?? '',
    changeDescription: 'Attempt to republish the same assembly.',
  });
  expect(unchanged.response.status).toBe(422);
  expect(unchanged.error).toMatchObject({
    code: 'INVALID_SCHOOL_CONFIGURATION',
    affectedValue: 'unpublishedChanges',
  });

  const branding = brandingOf(current?.candidate);
  const edited = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: current?.draftVersion,
    expectedResourceRevisions: [
      { resourceId: brandingId, revisionNumber: Number(branding.revision) },
    ],
    type: 'save-workspace-branding',
    resourceId: brandingId,
    displayName: String(
      (branding.displayName as { 'en-US': { value: string } })['en-US'].value,
    ),
    shortName: String(
      (branding.shortName as { 'en-US': { value: string } })['en-US'].value,
    ),
    generatedTextMark: 'HV',
    primaryColor: String(branding.primaryColor),
    accentColor: String(branding.accentColor),
  });
  expect(edited.response.status).toBe(200);
  expect(brandingOf(edited.data?.candidate).generatedTextMark).toBe('HV');
  expect(
    edited.data?.comparisons.find(
      (comparison) => comparison.resourceId === brandingId,
    ),
  ).toMatchObject({
    change: 'changed',
    differs: true,
    discardEligible: false,
    archiveEligible: false,
    label: 'UMass Boston Demo Workspace',
  });

  await stepUp();
  const second = await publish({
    expectedActiveReleaseId: firstReleaseId,
    expectedDraftVersion: edited.data?.draftVersion ?? 0,
    candidateFingerprint: edited.data?.candidateFingerprint ?? '',
    changeDescription: 'Update the generated text mark.',
  });
  expect(second.response.status).toBe(201);
  expect(second.data?.releaseNumber).toBe(2);
  expect(second.data?.candidateFingerprint).not.toBe(firstFingerprint);

  const history = await fetch(
    `${baseUrl}/api/v1/administration/school-configuration/releases`,
    { headers: staffHeaders() },
  );
  expect(history.status).toBe(200);
  const listed = (await history.json()) as {
    releases: Array<{
      releaseId: string;
      releaseNumber: number;
      candidateFingerprint: string;
      changeDescription: string;
      active: boolean;
      components: Array<{
        resourceId: string;
        revisionNumber: number;
        slot: string;
      }>;
    }>;
  };
  expect(listed.releases.map((release) => release.releaseNumber)).toEqual([
    2, 1,
  ]);
  expect(listed.releases[0]).toMatchObject({
    releaseId: second.data?.releaseId,
    active: true,
    changeDescription: 'Update the generated text mark.',
  });
  expect(listed.releases[1]).toMatchObject({
    releaseId: firstReleaseId,
    candidateFingerprint: firstFingerprint,
    active: false,
    changeDescription: 'Publish the reviewed synthetic golden-journey content.',
  });
  expect(
    listed.releases[0].components.some(
      (component) => component.resourceId === brandingId,
    ),
  ).toBe(true);

  const detail = await fetch(
    `${baseUrl}/api/v1/administration/school-configuration/releases/${firstReleaseId}`,
    { headers: staffHeaders() },
  );
  expect(detail.status).toBe(200);
  const firstRelease = (await detail.json()) as {
    releaseNumber: number;
    candidateFingerprint: string;
    candidate: unknown;
    comparisons: Array<{ resourceId: string; change: string }>;
  };
  expect(firstRelease).toMatchObject({
    releaseNumber: 1,
    candidateFingerprint: firstFingerprint,
  });
  expect(brandingOf(firstRelease.candidate).displayName).toEqual(
    expect.objectContaining({
      'en-US': expect.objectContaining({
        value: 'UMass Boston Demo Workspace',
      }),
    }),
  );
  expect(
    firstRelease.comparisons.find(
      (comparison) => comparison.resourceId === brandingId,
    )?.change,
  ).toBe('changed');
}, 40_000);

test('archiving a published module keeps historical revisions and rollback publishes a new higher release', async () => {
  const current = await readDraft();
  const moduleCount = modulesOf(current?.candidate).length;
  expect(moduleCount).toBeGreaterThan(1);
  const archived = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: current?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: firstModuleId,
        revisionNumber: Number(
          modulesOf(current?.candidate).find(
            (module) => module.id === firstModuleId,
          )?.revision,
        ),
      },
    ],
    type: 'archive-authored-resource',
    resourceId: firstModuleId,
  });
  expect(archived.response.status).toBe(200);
  expect(
    modulesOf(archived.data?.candidate).some(
      (module) => module.id === firstModuleId,
    ),
  ).toBe(false);
  expect(
    archived.data?.comparisons.find(
      (comparison) => comparison.resourceId === firstModuleId,
    ),
  ).toMatchObject({
    change: 'removed',
    archiveEligible: false,
    discardEligible: false,
  });

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const retained = await inspection.query<{
      archived_at: Date | null;
      frozen_revisions: string;
    }>(
      `select resource.archived_at,
              (select count(*) from school_configuration.authored_revisions revision
                where revision.workspace_id = resource.workspace_id
                  and revision.resource_id = resource.resource_id
                  and revision.lifecycle = 'frozen') as frozen_revisions
         from school_configuration.authored_resources resource
        where resource.workspace_id = $1 and resource.resource_id = $2`,
      [workspaceId, firstModuleId],
    );
    expect(retained.rows[0]?.archived_at).toBeInstanceOf(Date);
    expect(Number(retained.rows[0]?.frozen_revisions)).toBeGreaterThan(0);

    const referenced = await inspection.query(
      `select 1
         from school_configuration.release_components
        where workspace_id = $1 and resource_id = $2`,
      [workspaceId, firstModuleId],
    );
    expect(referenced.rows.length).toBeGreaterThan(0);
  } finally {
    await inspection.end();
  }

  const discardPublished = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: archived.data?.draftVersion,
    expectedResourceRevisions: [],
    type: 'discard-authored-resource',
    resourceId: firstModuleId,
  });
  expect(discardPublished.response.status).toBe(422);

  const history = await fetch(
    `${baseUrl}/api/v1/administration/school-configuration/releases`,
    { headers: staffHeaders() },
  );
  const listed = (await history.json()) as {
    releases: Array<{
      releaseId: string;
      releaseNumber: number;
      candidateFingerprint: string;
    }>;
  };
  const firstRelease = listed.releases.find(
    (release) => release.releaseNumber === 1,
  );
  const secondRelease = listed.releases.find(
    (release) => release.releaseNumber === 2,
  );
  expect(firstRelease && secondRelease).toBeTruthy();

  const restored = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: archived.data?.draftVersion,
    expectedResourceRevisions: [],
    type: 'restore-release-assembly',
    releaseId: firstRelease?.releaseId,
  });
  expect(restored.response.status).toBe(200);
  expect(restored.data?.unpublishedChanges).toBe(true);
  expect(restored.data?.validation.blockers).toEqual([]);
  expect(restored.data?.candidateFingerprint).toBe(
    firstRelease?.candidateFingerprint,
  );
  expect(
    modulesOf(restored.data?.candidate).some(
      (module) => module.id === firstModuleId,
    ),
  ).toBe(true);
  expect(brandingOf(restored.data?.candidate).displayName).toEqual(
    expect.objectContaining({
      'en-US': expect.objectContaining({
        value: 'UMass Boston Demo Workspace',
      }),
    }),
  );

  await stepUp();
  const rolledBack = await publish({
    expectedActiveReleaseId: secondRelease?.releaseId ?? null,
    expectedDraftVersion: restored.data?.draftVersion ?? 0,
    candidateFingerprint: restored.data?.candidateFingerprint ?? '',
    changeDescription:
      'Roll back to the first immutable assembly as a new release.',
  });
  expect(rolledBack.response.status).toBe(201);
  expect(rolledBack.data?.releaseNumber).toBe(3);
  expect(rolledBack.data?.candidateFingerprint).toBe(
    firstRelease?.candidateFingerprint,
  );
  expect(rolledBack.data?.releaseId).not.toBe(firstRelease?.releaseId);

  const after = await fetch(
    `${baseUrl}/api/v1/administration/school-configuration/releases`,
    { headers: staffHeaders() },
  );
  const afterListed = (await after.json()) as {
    releases: Array<{
      releaseNumber: number;
      active: boolean;
      candidateFingerprint: string;
    }>;
  };
  expect(afterListed.releases.map((release) => release.releaseNumber)).toEqual([
    3, 2, 1,
  ]);
  expect(afterListed.releases[0]).toMatchObject({
    active: true,
    candidateFingerprint: firstRelease?.candidateFingerprint,
  });
  expect(afterListed.releases[2]).toMatchObject({
    active: false,
    candidateFingerprint: firstRelease?.candidateFingerprint,
  });

  const retainedHistory = new Client({
    connectionString: postgres.connectionString,
  });
  await retainedHistory.connect();
  try {
    const counts = await retainedHistory.query<{
      release_count: string;
      first_release_id: string;
    }>(
      `select (select count(*) from school_configuration.configuration_releases
                where workspace_id = $1) as release_count,
              (select release_id from school_configuration.configuration_releases
                where workspace_id = $1 and release_number = 1) as first_release_id`,
      [workspaceId],
    );
    expect(counts.rows[0]?.release_count).toBe('3');
    expect(counts.rows[0]?.first_release_id).toBe(firstRelease?.releaseId);
  } finally {
    await retainedHistory.end();
  }
}, 40_000);
