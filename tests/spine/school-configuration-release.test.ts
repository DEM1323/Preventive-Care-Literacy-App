import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { createServer } from '../../apps/server/src/app.ts';
import { InvalidSchoolConfigurationError } from '../../modules/school-configuration/index.ts';
import { createApiClient } from '../../packages/api-client/src/index.ts';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import { createMemoryReleasePackageStorage } from '../../packages/release-package-storage/src/index.ts';
import {
  createRuntimeDatabaseUser,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from '../../packages/test-support/src/postgres.ts';
import { createFakeStaffAuth } from '../../packages/test-support/src/staff-auth.ts';
import { totpCode } from '../../packages/test-support/src/totp.ts';

const workspaceId = 'beb4193a-1e8f-4096-a449-6d77628fd275';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf4001';
const password = 'correct horse battery staple';
const email = 'administrator@example.test';
const origin = 'http://127.0.0.1';
const operatorHeaders = {
  authorization: `Bearer ${'release-operator-token-'.padEnd(40, 'x')}`,
  origin,
  'x-prevcare-csrf': '1',
} as const;

let now = new Date('2026-08-25T12:00:00.000Z');
let postgres: EphemeralPostgres;
let server: FastifyInstance;
let baseUrl: string;
let cookie: string;
let candidate: unknown;
let candidateFingerprint: string;
let activeReleaseId: string;
let advanceDuringUpload = false;
let failPackageIntegrity = false;
let failedPackageAttempts = 0;
const fakeAuth = createFakeStaffAuth();
const packages = createMemoryReleasePackageStorage();

async function unpublishedDraft() {
  const client = createApiClient(baseUrl);
  const current = await client.GET(
    '/api/v1/administration/school-configuration',
    { headers: { cookie } },
  );
  expect(current.response.status).toBe(200);
  if (current.data?.unpublishedChanges) return current.data;
  const candidate = current.data?.candidate as {
    release: { modules: { id: string; revision: number }[] };
  };
  const modules = candidate.release.modules;
  const edited = await client.POST(
    '/api/v1/administration/school-configuration/draft-edits',
    {
      headers: { ...operatorHeaders, cookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedDraftVersion: current.data?.draftVersion ?? 0,
        expectedResourceRevisions: modules.map((module) => ({
          resourceId: module.id,
          revisionNumber: module.revision,
        })),
        type: 'reorder-learning-modules',
        orderedResourceIds: [...modules.map((module) => module.id)].reverse(),
      },
    },
  );
  expect(edited.response.status).toBe(200);
  return edited.data;
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
  );
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
      actorId: 'release-test-operator',
    },
    staffAuth: fakeAuth.provider,
    releasePackages: {
      async putIfAbsent(input) {
        if (advanceDuringUpload) {
          advanceDuringUpload = false;
          now = new Date(now.getTime() + 16 * 60 * 1000);
        }
        if (failPackageIntegrity) {
          failedPackageAttempts += 1;
          throw new InvalidSchoolConfigurationError('packageIntegrity');
        }
        return packages.putIfAbsent(input);
      },
    },
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
      reason: 'School Configuration release test',
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

test('Administrator imports and previews the exact reviewed five-locale candidate without Student data', async () => {
  const client = createApiClient(baseUrl);
  const imported = await client.POST(
    '/api/v1/administration/school-configuration/draft-imports',
    {
      headers: { ...operatorHeaders, cookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedDraftVersion: 0,
        candidate,
      },
    },
  );
  expect(imported.response.status).toBe(201);
  expect(imported.data?.draftVersion).toBe(1);
  expect(imported.data?.affectedResources.length).toBeGreaterThan(1);
  candidateFingerprint = imported.data?.candidateFingerprint ?? '';

  const preview = await client.GET(
    '/api/v1/administration/school-configuration',
    { headers: { cookie } },
  );
  expect(preview.response.status).toBe(200);
  expect(preview.data).toMatchObject({
    workspaceId,
    draftVersion: 1,
    activeReleaseId: null,
    candidateFingerprint,
  });
  expect(preview.data?.candidate).toEqual(candidate);
  expect(JSON.stringify(preview.data)).not.toContain('intakeRecordVersions');
  expect(JSON.stringify(preview.data)).not.toContain('learningProgress');
});

test('publication requires fresh password-plus-TOTP and atomically activates one immutable package', async () => {
  const client = createApiClient(baseUrl);
  now = new Date(now.getTime() + 14 * 60 * 1000);
  const keptAlive = await client.GET('/api/v1/staff/session', {
    headers: { cookie },
  });
  expect(keptAlive.response.status).toBe(200);
  now = new Date(now.getTime() + 2 * 60 * 1000);
  const command = {
    operationId: crypto.randomUUID(),
    expectedActiveReleaseId: null,
    expectedDraftVersion: 1,
    candidateFingerprint,
    changeDescription: 'Publish the reviewed synthetic golden-journey content.',
  };
  const stale = await client.POST(
    '/api/v1/administration/school-configuration/releases',
    {
      headers: { ...operatorHeaders, cookie },
      body: command,
    },
  );
  expect(stale.response.status).toBe(409);
  expect(stale.error).toMatchObject({
    code: 'AUTHENTICATION_FRESHNESS_REQUIRED',
  });

  const rejected = await client.POST('/api/v1/auth/staff/step-up', {
    headers: { ...operatorHeaders, cookie },
    body: { password: 'wrong password', totp: '000000' },
  });
  expect(rejected.response.status).toBe(401);
  expect(rejected.error).toMatchObject({ code: 'STEP_UP_REJECTED' });

  const steppedUp = await client.POST('/api/v1/auth/staff/step-up', {
    headers: { ...operatorHeaders, cookie },
    body: { password, totp: totpCode(fakeAuth.totpSecretFor(email)) },
  });
  expect(steppedUp.response.status).toBe(200);
  expect(steppedUp.data?.freshUntil).toBe(
    new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
  );

  const published = await client.POST(
    '/api/v1/administration/school-configuration/releases',
    {
      headers: { ...operatorHeaders, cookie },
      body: command,
    },
  );
  expect(published.response.status).toBe(201);
  expect(published.data).toMatchObject({
    operationId: command.operationId,
    releaseNumber: 1,
    candidateFingerprint,
    draftVersion: 2,
    replayed: false,
    package: { format: 'school-configuration-package/v1' },
  });
  activeReleaseId = published.data?.releaseId ?? '';
  const replay = await client.POST(
    '/api/v1/administration/school-configuration/releases',
    {
      headers: { ...operatorHeaders, cookie },
      body: command,
    },
  );
  expect(replay.response.status).toBe(201);
  expect(replay.data).toEqual({ ...published.data, replayed: true });

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const state = await inspection.query<{
      active_release_id: string;
      release_count: string;
      package_count: string;
      audit_count: string;
      outbox_count: string;
    }>(
      `select state.active_release_id,
              (select count(*) from school_configuration.configuration_releases) as release_count,
              (select count(*) from school_configuration.release_packages) as package_count,
              (select count(*) from audit.evidence where operation_id = $2) as audit_count,
              (select count(*) from infrastructure.outbox where operation_id = $2) as outbox_count
         from school_configuration.configuration_states state
        where state.workspace_id = $1`,
      [workspaceId, command.operationId],
    );
    expect(state.rows[0]).toEqual({
      active_release_id: published.data?.releaseId,
      release_count: '1',
      package_count: '1',
      audit_count: '1',
      outbox_count: '1',
    });
    const packageKey = `workspaces/${workspaceId}/packages/sha256/${published.data?.package.digest}.json`;
    expect(packages.read(packageKey)?.byteLength).toBe(
      published.data?.package.byteLength,
    );
    await expect(
      inspection.query(
        `update school_configuration.configuration_releases
            set change_description = 'mutated' where release_id = $1`,
        [published.data?.releaseId],
      ),
    ).rejects.toThrow('immutable');
  } finally {
    await inspection.end();
  }
});

test('a stale publication conflict leaves the prior release active', async () => {
  const client = createApiClient(baseUrl);
  const conflict = await client.POST(
    '/api/v1/administration/school-configuration/releases',
    {
      headers: { ...operatorHeaders, cookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedActiveReleaseId: null,
        expectedDraftVersion: 1,
        candidateFingerprint,
        changeDescription: 'Attempt to publish stale state.',
      },
    },
  );
  expect(conflict.response.status).toBe(409);
  expect(conflict.error).toMatchObject({ code: 'ACTIVE_RELEASE_CONFLICT' });

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const state = await inspection.query<{
      active_release_id: string;
      release_count: string;
    }>(
      `select active_release_id,
              (select count(*) from school_configuration.configuration_releases) as release_count
         from school_configuration.configuration_states where workspace_id = $1`,
      [workspaceId],
    );
    expect(state.rows[0]?.active_release_id).not.toBeNull();
    expect(state.rows[0]?.release_count).toBe('1');
  } finally {
    await inspection.end();
  }
});

test('expiry during package upload is rechecked before activation', async () => {
  const client = createApiClient(baseUrl);
  const steppedUp = await client.POST('/api/v1/auth/staff/step-up', {
    headers: { ...operatorHeaders, cookie },
    body: { password, totp: totpCode(fakeAuth.totpSecretFor(email)) },
  });
  expect(steppedUp.response.status).toBe(200);
  const draft = await unpublishedDraft();
  advanceDuringUpload = true;
  const result = await client.POST(
    '/api/v1/administration/school-configuration/releases',
    {
      headers: { ...operatorHeaders, cookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedActiveReleaseId: activeReleaseId,
        expectedDraftVersion: draft?.draftVersion ?? 0,
        candidateFingerprint: draft?.candidateFingerprint ?? '',
        changeDescription:
          'A package upload that outlives authentication freshness.',
      },
    },
  );
  expect(result.response.status).toBe(409);
  expect(result.error).toMatchObject({
    code: 'AUTHENTICATION_FRESHNESS_REQUIRED',
  });

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const state = await inspection.query<{
      active_release_id: string;
      release_count: string;
    }>(
      `select active_release_id,
              (select count(*) from school_configuration.configuration_releases) as release_count
         from school_configuration.configuration_states where workspace_id = $1`,
      [workspaceId],
    );
    expect(state.rows[0]).toEqual({
      active_release_id: activeReleaseId,
      release_count: '1',
    });
  } finally {
    await inspection.end();
  }
});

test('a deterministic package failure is retained without activation', async () => {
  const client = createApiClient(baseUrl);
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
  const steppedUp = await client.POST('/api/v1/auth/staff/step-up', {
    headers: { ...operatorHeaders, cookie },
    body: { password, totp: totpCode(fakeAuth.totpSecretFor(email)) },
  });
  expect(steppedUp.response.status).toBe(200);
  failPackageIntegrity = true;
  const draft = await unpublishedDraft();
  const command = {
    operationId: crypto.randomUUID(),
    expectedActiveReleaseId: activeReleaseId,
    expectedDraftVersion: draft?.draftVersion ?? 0,
    candidateFingerprint: draft?.candidateFingerprint ?? '',
    changeDescription: 'A deterministic package-integrity failure.',
  };
  const failed = await client.POST(
    '/api/v1/administration/school-configuration/releases',
    { headers: { ...operatorHeaders, cookie }, body: command },
  );
  expect(failed.response.status).toBe(422);
  expect(failed.error).toMatchObject({
    code: 'INVALID_SCHOOL_CONFIGURATION',
    affectedValue: 'packageIntegrity',
  });
  const replay = await client.POST(
    '/api/v1/administration/school-configuration/releases',
    { headers: { ...operatorHeaders, cookie }, body: command },
  );
  expect(replay.response.status).toBe(422);
  expect(failedPackageAttempts).toBe(1);
  failPackageIntegrity = false;

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const state = await inspection.query<{
      active_release_id: string;
      release_count: string;
      attempt_status: string;
    }>(
      `select state.active_release_id,
              (select count(*) from school_configuration.configuration_releases) as release_count,
              attempt.status as attempt_status
         from school_configuration.configuration_states state
         join school_configuration.publication_attempts attempt using (workspace_id)
        where state.workspace_id = $1 and attempt.operation_id = $2`,
      [workspaceId, command.operationId],
    );
    expect(state.rows[0]).toEqual({
      active_release_id: activeReleaseId,
      release_count: '1',
      attempt_status: 'failed',
    });
  } finally {
    await inspection.end();
  }
});
