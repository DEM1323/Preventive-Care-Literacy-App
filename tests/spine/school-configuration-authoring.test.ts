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
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf7001';
const password = 'correct horse battery staple';
const email = 'administrator@example.test';
const origin = 'http://127.0.0.1';
const brandingId = '67f942fa-8fa7-4fec-9b30-2773940cb1d2';
const firstModuleId = '16481542-3831-4d18-aa0c-f138fbc7a970';
const firstKnowledgeId = '1fa49d99-82a5-4614-a11c-c5142b367632';
const secondKnowledgeId = 'f8b680c1-7280-493a-a3e6-be65f7a42990';
const operatorHeaders = {
  authorization: `Bearer ${'authoring-operator-token-'.padEnd(40, 'x')}`,
  origin,
  'x-prevcare-csrf': '1',
} as const;

let now = new Date('2026-08-26T15:00:00.000Z');
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

function localizedEnglish(value: unknown): {
  id: string;
  revision: number;
  value: string;
} {
  if (!isRecord(value) || !isRecord(value['en-US'])) {
    throw new Error('missing English value');
  }
  return {
    id: String(value['en-US'].id),
    revision: Number(value['en-US'].revision),
    value: String(value['en-US'].value),
  };
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

function moduleById(draftCandidate: unknown, moduleId: string) {
  const found = modulesOf(draftCandidate).find(
    (module) => module.id === moduleId,
  );
  if (!found) throw new Error(`missing module ${moduleId}`);
  return found;
}

function knowledgeItemsOf(module: Record<string, unknown>) {
  if (!Array.isArray(module.knowledgeItems))
    throw new Error('missing knowledge items');
  return module.knowledgeItems.filter(isRecord);
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
      actorId: 'authoring-test-operator',
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
      reason: 'School Configuration authoring test',
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

test('imported draft exposes linked validation with no branding or module blockers', async () => {
  await importFixture();
  const draft = await readDraft();
  expect(draft?.unpublishedChanges).toBe(true);
  expect(draft?.validation?.blockers).toEqual([]);
  expect(
    draft?.comparisons?.some(
      (comparison) => comparison.resourceId === brandingId,
    ),
  ).toBe(true);
});

test('reordering Knowledge items keeps child identities and item revisions', async () => {
  const before = await readDraft();
  const module = moduleById(before?.candidate, firstModuleId);
  const items = knowledgeItemsOf(module);
  expect(items[0]?.id).toBe(firstKnowledgeId);
  expect(items[1]?.id).toBe(secondKnowledgeId);
  const reordered = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: before?.draftVersion,
    expectedResourceRevisions: [
      { resourceId: firstModuleId, revisionNumber: Number(module.revision) },
      {
        resourceId: firstKnowledgeId,
        revisionNumber: Number(items[0]?.revision),
      },
      {
        resourceId: secondKnowledgeId,
        revisionNumber: Number(items[1]?.revision),
      },
    ],
    type: 'reorder-learning-module-items',
    moduleId: firstModuleId,
    collection: 'knowledgeItems',
    orderedResourceIds: [
      secondKnowledgeId,
      firstKnowledgeId,
      ...items.slice(2).map((item) => String(item.id)),
    ],
  });
  expect(reordered.response.status).toBe(200);
  const afterModule = moduleById(reordered.data?.candidate, firstModuleId);
  const afterItems = knowledgeItemsOf(afterModule);
  expect(afterItems.map((item) => item.id)).toEqual([
    secondKnowledgeId,
    firstKnowledgeId,
    ...items.slice(2).map((item) => item.id),
  ]);
  expect(Number(afterItems[0]?.revision)).toBe(Number(items[1]?.revision));
  expect(Number(afterItems[1]?.revision)).toBe(Number(items[0]?.revision));
  expect(Number(afterModule.revision)).toBe(Number(module.revision) + 1);
});

test('never-published Learning Modules can be created, restored is ineligible, and discard removes them', async () => {
  const before = await readDraft();
  const created = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: before?.draftVersion,
    expectedResourceRevisions: [],
    type: 'create-learning-module',
    title: 'School nurse office hours',
    description: 'How to use the school health office.',
  });
  expect(created.response.status).toBe(200);
  const createdModule = modulesOf(created.data?.candidate).at(-1);
  expect(createdModule?.id).toEqual(expect.any(String));
  expect(localizedEnglish(createdModule?.title).value).toBe(
    'School nurse office hours',
  );
  expect(
    created.data?.validation?.blockers.some(
      (blocker) => blocker.code === 'MISSING_TRANSLATION',
    ),
  ).toBe(true);

  const restore = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: created.data?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: String(createdModule?.id),
        revisionNumber: Number(createdModule?.revision),
      },
    ],
    type: 'restore-active-revision',
    resourceId: String(createdModule?.id),
  });
  expect(restore.response.status).toBe(422);
  expect(restore.error).toMatchObject({
    code: 'INVALID_SCHOOL_CONFIGURATION',
    affectedValue: 'activeRevision',
  });

  const discarded = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: created.data?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: String(createdModule?.id),
        revisionNumber: Number(createdModule?.revision),
      },
    ],
    type: 'discard-authored-resource',
    resourceId: String(createdModule?.id),
  });
  expect(discarded.response.status).toBe(200);
  expect(
    modulesOf(discarded.data?.candidate).some(
      (module) => module.id === createdModule?.id,
    ),
  ).toBe(false);
}, 20_000);

test('active Students stay pinned to the active release while the shared draft is edited', async () => {
  const client = createApiClient(baseUrl);
  const current = await readDraft();
  const steppedUp = await client.POST('/api/v1/auth/staff/step-up', {
    headers: staffHeaders(),
    body: { password, totp: totpCode(fakeAuth.totpSecretFor(email)) },
  });
  expect(steppedUp.response.status).toBe(200);
  const published = await client.POST(
    '/api/v1/administration/school-configuration/releases',
    {
      headers: staffHeaders(),
      body: {
        operationId: crypto.randomUUID(),
        expectedActiveReleaseId: current?.activeReleaseId ?? null,
        expectedDraftVersion: current?.draftVersion,
        candidateFingerprint: current?.candidateFingerprint,
        changeDescription:
          'Publish reviewed synthetic content before draft edits.',
      },
    },
  );
  expect(published.response.status).toBe(201);
  const afterPublish = await readDraft();
  expect(afterPublish?.unpublishedChanges).toBe(false);
  const branding = brandingOf(afterPublish?.candidate);
  const publishedName = localizedEnglish(branding.displayName).value;
  const edited = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: afterPublish?.draftVersion,
    expectedResourceRevisions: [
      { resourceId: brandingId, revisionNumber: Number(branding.revision) },
    ],
    type: 'save-workspace-branding',
    resourceId: brandingId,
    displayName: 'Draft-only school name',
    shortName: localizedEnglish(branding.shortName).value,
    generatedTextMark: String(branding.generatedTextMark),
    primaryColor: String(branding.primaryColor),
    accentColor: String(branding.accentColor),
  });
  expect(edited.response.status).toBe(200);
  expect(
    localizedEnglish(brandingOf(edited.data?.candidate).displayName).value,
  ).toBe('Draft-only school name');
  expect(edited.data?.unpublishedChanges).toBe(true);
  expect(edited.data?.activeReleaseId).toBe(published.data?.releaseId);

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const active = await inspection.query<{ payload: Record<string, unknown> }>(
      `select revision.payload
         from school_configuration.configuration_states state
         join school_configuration.release_components component
           on component.release_id = state.active_release_id
          and component.workspace_id = state.workspace_id
          and component.slot = 'candidate.workspace.branding'
         join school_configuration.authored_revisions revision
           on revision.workspace_id = component.workspace_id
          and revision.resource_id = component.resource_id
          and revision.revision_number = component.revision_number
        where state.workspace_id = $1`,
      [workspaceId],
    );
    expect(localizedEnglish(active.rows[0]?.payload.displayName).value).toBe(
      publishedName,
    );
  } finally {
    await inspection.end();
  }

  const restored = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: edited.data?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: brandingId,
        revisionNumber: Number(brandingOf(edited.data?.candidate).revision),
      },
    ],
    type: 'restore-active-revision',
    resourceId: brandingId,
  });
  expect(restored.response.status).toBe(200);
  expect(
    localizedEnglish(brandingOf(restored.data?.candidate).displayName).value,
  ).toBe(publishedName);
  expect(Number(brandingOf(restored.data?.candidate).revision)).toBe(
    Number(branding.revision),
  );
}, 30_000);

test('saving Workspace Branding keeps identity and bumps canonical revision only when meaning changes', async () => {
  const before = await readDraft();
  const branding = brandingOf(before?.candidate);
  const englishName = localizedEnglish(branding.displayName);
  const saved = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: before?.draftVersion,
    expectedResourceRevisions: [
      { resourceId: brandingId, revisionNumber: Number(branding.revision) },
    ],
    type: 'save-workspace-branding',
    resourceId: brandingId,
    displayName: 'Harborview Demonstration School',
    shortName: localizedEnglish(branding.shortName).value,
    generatedTextMark: String(branding.generatedTextMark),
    primaryColor: String(branding.primaryColor),
    accentColor: String(branding.accentColor),
  });
  expect(saved.response.status).toBe(200);
  const after = brandingOf(saved.data?.candidate);
  expect(after.id).toBe(brandingId);
  expect(Number(after.revision)).toBe(Number(branding.revision) + 1);
  const afterName = localizedEnglish(after.displayName);
  expect(afterName.id).toBe(englishName.id);
  expect(afterName.revision).toBe(englishName.revision + 1);
  expect(afterName.value).toBe('Harborview Demonstration School');
  expect(localizedEnglish(after.shortName).revision).toBe(
    localizedEnglish(branding.shortName).revision,
  );
  expect(
    saved.data?.validation?.blockers.some(
      (blocker) =>
        blocker.code === 'STALE_TRANSLATION' &&
        blocker.path.includes('workspace.branding.displayName'),
    ),
  ).toBe(true);

  const repeat = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: saved.data?.draftVersion,
    expectedResourceRevisions: [
      { resourceId: brandingId, revisionNumber: Number(after.revision) },
    ],
    type: 'save-workspace-branding',
    resourceId: brandingId,
    displayName: 'Harborview Demonstration School',
    shortName: localizedEnglish(after.shortName).value,
    generatedTextMark: String(after.generatedTextMark),
    primaryColor: String(after.primaryColor),
    accentColor: String(after.accentColor),
  });
  expect(repeat.response.status).toBe(200);
  expect(Number(brandingOf(repeat.data?.candidate).revision)).toBe(
    Number(after.revision),
  );
});

test('stale expected revisions reject the write without changing the shared draft', async () => {
  const before = await readDraft();
  const branding = brandingOf(before?.candidate);
  const stale = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: before?.draftVersion,
    expectedResourceRevisions: [{ resourceId: brandingId, revisionNumber: 1 }],
    type: 'save-workspace-branding',
    resourceId: brandingId,
    displayName: 'Should not persist',
    shortName: 'Nope',
    generatedTextMark: 'XX',
    primaryColor: '#075985',
    accentColor: '#B45309',
  });
  expect(stale.response.status).toBe(409);
  expect(stale.error).toMatchObject({ code: 'RESOURCE_REVISION_CONFLICT' });
  const after = await readDraft();
  expect(after?.draftVersion).toBe(before?.draftVersion);
  expect(localizedEnglish(brandingOf(after?.candidate).displayName).value).toBe(
    localizedEnglish(branding.displayName).value,
  );
});

test('unsafe rich text, URLs, assets, colors, and contrast block publication candidates', async () => {
  const before = await readDraft();
  const branding = brandingOf(before?.candidate);
  const contrast = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: before?.draftVersion,
    expectedResourceRevisions: [
      { resourceId: brandingId, revisionNumber: Number(branding.revision) },
    ],
    type: 'save-workspace-branding',
    resourceId: brandingId,
    displayName: localizedEnglish(branding.displayName).value,
    shortName: localizedEnglish(branding.shortName).value,
    generatedTextMark: String(branding.generatedTextMark),
    primaryColor: '#ffffff',
    accentColor: '#ffff00',
  });
  expect(contrast.response.status).toBe(200);
  expect(
    contrast.data?.validation?.blockers.some(
      (blocker) => blocker.code === 'INACCESSIBLE_CONTRAST',
    ),
  ).toBe(true);

  const color = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: contrast.data?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: brandingId,
        revisionNumber: Number(brandingOf(contrast.data?.candidate).revision),
      },
    ],
    type: 'save-workspace-branding',
    resourceId: brandingId,
    displayName: localizedEnglish(branding.displayName).value,
    shortName: localizedEnglish(branding.shortName).value,
    generatedTextMark: String(branding.generatedTextMark),
    primaryColor: 'red',
    accentColor: '#B45309',
  });
  expect(color.response.status).toBe(422);
  expect(color.error).toMatchObject({
    code: 'INVALID_SCHOOL_CONFIGURATION',
    affectedValue: 'workspace.branding.primaryColor',
  });

  const module = moduleById(contrast.data?.candidate, firstModuleId);
  const item = knowledgeItemsOf(module)[0];
  const unsafe = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: contrast.data?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: String(item?.id),
        revisionNumber: Number(item?.revision),
      },
    ],
    type: 'save-learning-module-item',
    resourceId: String(item?.id),
    text: '<script>alert(1)</script>',
  });
  expect(unsafe.response.status).toBe(422);
  expect(unsafe.error).toMatchObject({
    code: 'INVALID_SCHOOL_CONFIGURATION',
    affectedValue: `release.modules.knowledgeItems.${item?.id}.text.en-US`,
  });

  const application = module.applicationItems;
  const applicationItem = Array.isArray(application)
    ? application.find(isRecord)
    : undefined;
  const badUrl = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: contrast.data?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: String(applicationItem?.id),
        revisionNumber: Number(applicationItem?.revision),
      },
    ],
    type: 'save-learning-module-item',
    resourceId: String(applicationItem?.id),
    text: localizedEnglish(applicationItem?.text).value,
    href: 'javascript:alert(1)',
  });
  expect(badUrl.response.status).toBe(422);
  expect(badUrl.error).toMatchObject({
    code: 'INVALID_SCHOOL_CONFIGURATION',
    affectedValue: `release.modules.applicationItems.${applicationItem?.id}.href`,
  });

  const unsafeAsset = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: contrast.data?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: brandingId,
        revisionNumber: Number(brandingOf(contrast.data?.candidate).revision),
      },
    ],
    type: 'save-workspace-branding',
    resourceId: brandingId,
    displayName: localizedEnglish(branding.displayName).value,
    shortName: localizedEnglish(branding.shortName).value,
    generatedTextMark: String(branding.generatedTextMark),
    primaryColor: '#075985',
    accentColor: '#B45309',
    logo: {
      mediaType: 'image/svg+xml',
      width: 64,
      height: 64,
      byteLength: 80,
      src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
    },
  });
  expect(unsafeAsset.response.status).toBe(422);
  expect(unsafeAsset.error).toMatchObject({
    code: 'INVALID_SCHOOL_CONFIGURATION',
    affectedValue: 'workspace.branding.logo',
  });
});
