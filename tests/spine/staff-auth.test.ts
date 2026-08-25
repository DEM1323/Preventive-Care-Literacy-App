import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
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

const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf2001';
const concurrentWorkspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf2005';
const nurseIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf2002';
const administratorIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf2003';
const clinicalOnlyIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf2004';
const operatorToken = 'test-operator-token-with-more-than-32-characters';
const csrfHeaders = {
  origin: 'http://127.0.0.1',
  'x-prevcare-csrf': '1',
} as const;
const authorizedHeaders = {
  ...csrfHeaders,
  authorization: `Bearer ${operatorToken}`,
} as const;
const nurseEmail = 'nurse@school.example';
const administratorEmail = 'administrator@school.example';
const clinicalOnlyEmail = 'viewer@school.example';
const nursePassword = 'nurse-password-32-chars-long';
const administratorPassword = 'administrator-password-32-chars';

let postgres: EphemeralPostgres;
let server: FastifyInstance;
let baseUrl: string;
let runtimeDatabaseUrl: string;
let currentTime: Date;
const fakeAuth = createFakeStaffAuth();

type ApiClient = ReturnType<typeof createApiClient>;

function cookieFrom(setCookie: string | null): string {
  expect(typeof setCookie).toBe('string');
  return (setCookie as string).split(';')[0] as string;
}

async function signIn(
  client: ApiClient,
  email: string,
  password: string,
): Promise<string> {
  const started = await client.POST('/api/v1/auth/staff/sign-in', {
    body: { email, password },
    headers: csrfHeaders,
  });
  expect(started.response.status).toBe(200);
  const challenge = started.data as {
    flowHandle: string;
    stage: 'enroll' | 'totp';
    otpauthUri?: string;
  };
  const completed = await client.POST('/api/v1/auth/staff/totp', {
    body: {
      flowHandle: challenge.flowHandle,
      code: totpCode(fakeAuth.totpSecretFor(email)),
    },
    headers: csrfHeaders,
  });
  expect(completed.response.status).toBe(200);
  return cookieFrom(completed.response.headers.get('set-cookie'));
}

async function provisionStaffIdentity(
  client: ApiClient,
  command: {
    operationId: string;
    staffIdentityId: string;
    email: string;
    displayName: string;
    permissions: ('administrative' | 'clinical')[];
    initialPassword: string;
  },
) {
  return client.POST('/api/v1/administration/staff-identities', {
    body: {
      workspaceId,
      schoolApprover: 'principal@school.example',
      reason: 'Alpha pilot staffing approved by the school principal',
      ...command,
    },
    headers: authorizedHeaders,
  });
}

beforeAll(async () => {
  currentTime = new Date('2026-08-19T10:00:00.000Z');
  postgres = await startEphemeralPostgres();
  await migrate(postgres.connectionString);
  runtimeDatabaseUrl = await createRuntimeDatabaseUser(
    postgres.connectionString,
  );
  server = await createServer({
    databaseUrl: runtimeDatabaseUrl,
    publicOrigin: 'http://127.0.0.1',
    operatorCredentials: {
      token: operatorToken,
      actorId: 'operator@example.test',
    },
    staffAuth: fakeAuth.provider,
    clock: { now: () => currentTime },
  });
  baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });

  const client = createApiClient(baseUrl);
  const workspace = await client.POST(
    '/api/v1/administration/school-workspaces',
    {
      body: {
        operationId: crypto.randomUUID(),
        workspaceId,
        displayName: 'Franklin Middle School',
      },
      headers: authorizedHeaders,
    },
  );
  expect(workspace.response.status).toBe(201);
});

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
});

describe.serial('staff provisioning', () => {
  test('operator provisions identities with independent permissions', async () => {
    const client = createApiClient(baseUrl);

    const unauthorized = await client.POST(
      '/api/v1/administration/staff-identities',
      {
        body: {
          operationId: crypto.randomUUID(),
          workspaceId,
          staffIdentityId: nurseIdentityId,
          displayName: 'Rachel Alvarez',
          email: nurseEmail,
          permissions: ['administrative', 'clinical'],
          schoolApprover: 'principal@school.example',
          reason: 'Alpha pilot staffing approved by the school principal',
          initialPassword: nursePassword,
        },
        headers: csrfHeaders,
      },
    );
    expect(unauthorized.response.status).toBe(401);
    expect(unauthorized.error).toMatchObject({
      code: 'OPERATOR_AUTHENTICATION_REQUIRED',
    });

    const nurseOperationId = crypto.randomUUID();
    const nurse = await provisionStaffIdentity(client, {
      operationId: nurseOperationId,
      staffIdentityId: nurseIdentityId,
      email: nurseEmail,
      displayName: 'Rachel Alvarez',
      permissions: ['administrative', 'clinical'],
      initialPassword: nursePassword,
    });
    expect(nurse.response.status).toBe(201);
    expect(nurse.data).toMatchObject({
      operationId: nurseOperationId,
      staffIdentityId: nurseIdentityId,
      outcome: 'provisioned',
    });
    expect(nurse.data?.supabaseUserId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const replayed = await provisionStaffIdentity(client, {
      operationId: nurseOperationId,
      staffIdentityId: nurseIdentityId,
      email: nurseEmail,
      displayName: 'Rachel Alvarez',
      permissions: ['administrative', 'clinical'],
      initialPassword: nursePassword,
    });
    expect(replayed.response.status).toBe(201);
    expect(replayed.data).toEqual(nurse.data);

    const administrator = await provisionStaffIdentity(client, {
      operationId: crypto.randomUUID(),
      staffIdentityId: administratorIdentityId,
      email: administratorEmail,
      displayName: 'Marcus Chen',
      permissions: ['administrative'],
      initialPassword: administratorPassword,
    });
    expect(administrator.response.status).toBe(201);

    const duplicate = await provisionStaffIdentity(client, {
      operationId: crypto.randomUUID(),
      staffIdentityId: crypto.randomUUID(),
      email: nurseEmail,
      displayName: 'Duplicate Nurse',
      permissions: ['administrative'],
      initialPassword: 'another-password-32-characters',
    });
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.error).toMatchObject({ code: 'STAFF_IDENTITY_EXISTS' });

    const compensatedEmail = 'compensated@school.example';
    const failedAfterCredentials = await provisionStaffIdentity(client, {
      operationId: crypto.randomUUID(),
      staffIdentityId: nurseIdentityId,
      email: compensatedEmail,
      displayName: 'Conflicting Identity',
      permissions: ['administrative'],
      initialPassword: 'compensated-password-32-characters',
    });
    expect(failedAfterCredentials.response.status).toBe(409);
    expect(fakeAuth.hasCredentials(compensatedEmail)).toBe(false);

    const inspection = new Client({
      connectionString: postgres.connectionString,
    });
    await inspection.connect();
    try {
      const grants = await inspection.query<{
        staff_identity_id: string;
        permission: string;
      }>(
        `select staff_identity_id, permission
           from identity_access.staff_permission_grants order by permission`,
      );
      expect(
        grants.rows.filter((row) => row.staff_identity_id === nurseIdentityId),
      ).toEqual([
        { staff_identity_id: nurseIdentityId, permission: 'administrative' },
        { staff_identity_id: nurseIdentityId, permission: 'clinical' },
      ]);
      expect(
        grants.rows.filter(
          (row) => row.staff_identity_id === administratorIdentityId,
        ),
      ).toEqual([
        {
          staff_identity_id: administratorIdentityId,
          permission: 'administrative',
        },
      ]);

      const linked = await inspection.query<{ supabase_user_id: string }>(
        `select supabase_user_id from identity_access.staff_identities
           where staff_identity_id = $1`,
        [nurseIdentityId],
      );
      expect(typeof linked.rows[0]?.supabase_user_id).toBe('string');

      const audit = await inspection.query<{ event_type: string }>(
        `select event_type from audit.evidence
           where event_type = 'staff_identity.provisioned'`,
      );
      expect(audit.rows).toHaveLength(2);
    } finally {
      await inspection.end();
    }
  });

  test('provisions a clinical-only identity for permission-independence checks', async () => {
    const client = createApiClient(baseUrl);
    const clinicalOnly = await provisionStaffIdentity(client, {
      operationId: crypto.randomUUID(),
      staffIdentityId: clinicalOnlyIdentityId,
      email: clinicalOnlyEmail,
      displayName: 'Jordan Reyes',
      permissions: ['clinical'],
      initialPassword: 'clinical-password-32-characters',
    });
    expect(clinicalOnly.response.status).toBe(201);
  });

  test('serializes concurrent idempotent provisioning before provider calls', async () => {
    const client = createApiClient(baseUrl);
    const workspace = await client.POST(
      '/api/v1/administration/school-workspaces',
      {
        body: {
          operationId: crypto.randomUUID(),
          workspaceId: concurrentWorkspaceId,
          displayName: 'Concurrent Test School',
        },
        headers: authorizedHeaders,
      },
    );
    expect(workspace.response.status).toBe(201);

    const operationId = crypto.randomUUID();
    const staffIdentityId = crypto.randomUUID();
    const email = 'concurrent@school.example';
    const command = {
      operationId,
      workspaceId: concurrentWorkspaceId,
      staffIdentityId,
      displayName: 'Concurrent Staff',
      email,
      permissions: ['administrative'] as const,
      schoolApprover: 'principal@school.example',
      reason: 'Concurrent idempotency verification',
      initialPassword: 'concurrent-password-32-characters',
    };
    const results = await Promise.all([
      client.POST('/api/v1/administration/staff-identities', {
        body: command,
        headers: authorizedHeaders,
      }),
      client.POST('/api/v1/administration/staff-identities', {
        body: command,
        headers: authorizedHeaders,
      }),
    ]);
    expect(results.map((result) => result.response.status)).toEqual([201, 201]);
    expect(results[0]?.data).toEqual(results[1]?.data);
    expect(results[0]?.data).toMatchObject({
      operationId,
      staffIdentityId,
      outcome: 'provisioned',
    });
    expect(results[0]?.data?.supabaseUserId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(fakeAuth.hasCredentials(email)).toBe(true);
  });
});

describe.serial('staff authentication', () => {
  test('password plus mandatory TOTP at aal2 issues an opaque session cookie', async () => {
    const client = createApiClient(baseUrl);

    const wrongPassword = await client.POST('/api/v1/auth/staff/sign-in', {
      body: { email: nurseEmail, password: 'wrong-password-guess' },
      headers: csrfHeaders,
    });
    expect(wrongPassword.response.status).toBe(401);
    expect(wrongPassword.error).toEqual({
      type: 'https://preventive-care-literacy.example/problems/staff-authentication',
      title: 'Staff authentication failed',
      status: 401,
      code: 'STAFF_AUTHENTICATION_FAILED',
    });

    const unknownEmail = await client.POST('/api/v1/auth/staff/sign-in', {
      body: { email: 'nobody@school.example', password: nursePassword },
      headers: csrfHeaders,
    });
    expect(unknownEmail.response.status).toBe(401);
    expect(unknownEmail.error).toEqual(wrongPassword.error);

    const started = await client.POST('/api/v1/auth/staff/sign-in', {
      body: { email: nurseEmail, password: nursePassword },
      headers: csrfHeaders,
    });
    expect(started.response.status).toBe(200);
    expect(started.data?.stage).toBe('enroll');
    expect(started.data?.otpauthUri).toContain('otpauth://totp/');
    expect(JSON.stringify(started.data)).not.toContain('fake-access');

    const wrongCode = await client.POST('/api/v1/auth/staff/totp', {
      body: { flowHandle: started.data!.flowHandle, code: '000000' },
      headers: csrfHeaders,
    });
    expect(wrongCode.response.status).toBe(401);
    expect(wrongCode.error).toMatchObject({
      code: 'STAFF_AUTHENTICATION_FAILED',
    });

    const inspection = new Client({
      connectionString: postgres.connectionString,
    });
    await inspection.connect();
    try {
      const failures = await inspection.query(
        `select event_type from audit.evidence
           where event_type = 'staff_authentication.failed'`,
      );
      expect(failures.rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      await inspection.end();
    }

    const completed = await client.POST('/api/v1/auth/staff/totp', {
      body: {
        flowHandle: started.data!.flowHandle,
        code: totpCode(fakeAuth.totpSecretFor(nurseEmail)),
      },
      headers: csrfHeaders,
    });
    expect(completed.response.status).toBe(200);
    expect(completed.data).toEqual({ outcome: 'authenticated' });
    const setCookie = completed.response.headers.get('set-cookie');
    expect(typeof setCookie).toBe('string');
    expect(setCookie).toContain('__Host-prevcare-staff-session=');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).not.toContain('Max-Age');
    expect(setCookie).not.toContain('Expires');

    const sessionHandle = cookieFrom(setCookie).split('=')[1] as string;
    const inspectionTwo = new Client({
      connectionString: postgres.connectionString,
    });
    await inspectionTwo.connect();
    try {
      const sessions = await inspectionTwo.query<{
        authentication_assurance: string;
        session_handle_hash: string;
      }>(
        `select authentication_assurance, session_handle_hash
           from identity_access.staff_sessions`,
      );
      expect(sessions.rows).toHaveLength(1);
      expect(sessions.rows[0]?.authentication_assurance).toBe('aal2');
      expect(sessions.rows[0]?.session_handle_hash).not.toContain(
        sessionHandle,
      );
    } finally {
      await inspectionTwo.end();
    }

    const replayedFlow = await client.POST('/api/v1/auth/staff/totp', {
      body: {
        flowHandle: started.data!.flowHandle,
        code: totpCode(fakeAuth.totpSecretFor(nurseEmail)),
      },
      headers: csrfHeaders,
    });
    expect(replayedFlow.response.status).toBe(401);
  });

  test('a Supabase credential without an application-owned Staff Identity gets no session', async () => {
    const client = createApiClient(baseUrl);
    await fakeAuth.provider.createCredentials({
      email: 'ghost@school.example',
      password: 'ghost-password-32-characters!',
    });
    const started = await client.POST('/api/v1/auth/staff/sign-in', {
      body: {
        email: 'ghost@school.example',
        password: 'ghost-password-32-characters!',
      },
      headers: csrfHeaders,
    });
    expect(started.response.status).toBe(401);
    expect(started.error).toMatchObject({
      code: 'STAFF_AUTHENTICATION_FAILED',
    });
  });
});

describe.serial('staff session rechecks', () => {
  test('every protected request rechecks identity, session, and permission state', async () => {
    const client = createApiClient(baseUrl);
    const cookie = await signIn(client, nurseEmail, nursePassword);

    const anonymous = await client.GET('/api/v1/staff/session');
    expect(anonymous.response.status).toBe(401);
    expect(anonymous.error).toMatchObject({ code: 'STAFF_SESSION_REQUIRED' });

    const session = await client.GET('/api/v1/staff/session', {
      headers: { cookie },
    });
    expect(session.response.status).toBe(200);
    expect(session.data).toEqual({
      staffIdentityId: nurseIdentityId,
      workspaceId,
      displayName: 'Rachel Alvarez',
      permissions: ['administrative', 'clinical'],
      authenticatedAt: currentTime.toISOString(),
    });

    const signedOut = await client.POST('/api/v1/auth/staff/sign-out', {
      headers: { cookie, ...csrfHeaders },
    });
    expect(signedOut.response.status).toBe(200);
    const expiredCookie = signedOut.response.headers.get('set-cookie');
    expect(expiredCookie).toContain('Max-Age=0');

    const replayedSignOut = await client.POST('/api/v1/auth/staff/sign-out', {
      headers: { cookie, ...csrfHeaders },
    });
    expect(replayedSignOut.response.status).toBe(200);
    const revocationInspection = new Client({
      connectionString: postgres.connectionString,
    });
    await revocationInspection.connect();
    try {
      const revocations = await revocationInspection.query<{ count: string }>(
        `select count(*) as count from audit.evidence
           where event_type = 'staff_session.revoked'
             and actor_id = $1`,
        [nurseIdentityId],
      );
      expect(Number(revocations.rows[0]?.count)).toBe(1);
    } finally {
      await revocationInspection.end();
    }

    const afterSignOut = await client.GET('/api/v1/staff/session', {
      headers: { cookie },
    });
    expect(afterSignOut.response.status).toBe(401);

    const freshCookie = await signIn(
      client,
      administratorEmail,
      administratorPassword,
    );
    const inspection = new Client({
      connectionString: postgres.connectionString,
    });
    await inspection.connect();
    try {
      await inspection.query(
        `update identity_access.staff_identities set status = 'disabled'
           where staff_identity_id = $1`,
        [administratorIdentityId],
      );
    } finally {
      await inspection.end();
    }
    const disabledSession = await client.GET('/api/v1/staff/session', {
      headers: { cookie: freshCookie },
    });
    expect(disabledSession.response.status).toBe(401);

    const restore = new Client({ connectionString: postgres.connectionString });
    await restore.connect();
    try {
      await restore.query(
        `update identity_access.staff_identities set status = 'active'
           where staff_identity_id = $1`,
        [administratorIdentityId],
      );
    } finally {
      await restore.end();
    }
  });

  test('expired sessions are denied by default', async () => {
    const client = createApiClient(baseUrl);
    const cookie = await signIn(client, nurseEmail, nursePassword);
    const before = currentTime;
    currentTime = new Date(before.getTime() + 9 * 60 * 60 * 1000);
    const expired = await client.GET('/api/v1/staff/session', {
      headers: { cookie },
    });
    currentTime = before;
    expect(expired.response.status).toBe(401);
  });
});

describe.serial('independent permission enforcement', () => {
  test('administrative projection lists staff only under Administrative Permission', async () => {
    const client = createApiClient(baseUrl);
    const administratorCookie = await signIn(
      client,
      administratorEmail,
      administratorPassword,
    );
    const directory = await client.GET(
      '/api/v1/administration/staff-identities',
      {
        headers: { cookie: administratorCookie },
      },
    );
    expect(directory.response.status).toBe(200);
    expect(directory.data?.staffIdentities).toHaveLength(3);
    for (const entry of directory.data?.staffIdentities ?? []) {
      expect(Object.keys(entry).sort()).toEqual(
        [
          'createdAt',
          'displayName',
          'email',
          'permissions',
          'staffIdentityId',
          'status',
        ].sort(),
      );
    }
    const nurseEntry = directory.data?.staffIdentities.find(
      (entry) => entry.staffIdentityId === nurseIdentityId,
    );
    expect(nurseEntry?.permissions).toEqual(['administrative', 'clinical']);
    const administratorEntry = directory.data?.staffIdentities.find(
      (entry) => entry.staffIdentityId === administratorIdentityId,
    );
    expect(administratorEntry?.permissions).toEqual(['administrative']);

    const clinicalCookie = await signIn(
      client,
      clinicalOnlyEmail,
      'clinical-password-32-characters',
    );
    const denied = await client.GET('/api/v1/administration/staff-identities', {
      headers: { cookie: clinicalCookie },
    });
    expect(denied.response.status).toBe(403);
    expect(denied.error).toMatchObject({ code: 'STAFF_PERMISSION_REQUIRED' });
  });

  test('PostgreSQL independently enforces Administrative Permission and workspace scope', async () => {
    async function visibleStaffIdentities(settings: {
      workspaceId?: string;
      staffIdentityId?: string;
    }): Promise<string[]> {
      const inspection = new Client({ connectionString: runtimeDatabaseUrl });
      await inspection.connect();
      try {
        await inspection.query('begin');
        if (settings.workspaceId) {
          await inspection.query(
            `select set_config('app.workspace_id', $1, true)`,
            [settings.workspaceId],
          );
        }
        if (settings.staffIdentityId) {
          await inspection.query(
            `select set_config('app.staff_identity_id', $1, true)`,
            [settings.staffIdentityId],
          );
        }
        const rows = await inspection.query<{ staff_identity_id: string }>(
          'select staff_identity_id from identity_access.staff_identities',
        );
        await inspection.query('rollback');
        return rows.rows.map((row) => row.staff_identity_id).sort();
      } finally {
        await inspection.end();
      }
    }

    expect(await visibleStaffIdentities({})).toEqual([]);
    expect(
      await visibleStaffIdentities({
        workspaceId,
        staffIdentityId: clinicalOnlyIdentityId,
      }),
    ).toEqual([clinicalOnlyIdentityId]);
    expect(
      await visibleStaffIdentities({
        workspaceId,
        staffIdentityId: administratorIdentityId,
      }),
    ).toEqual(
      [administratorIdentityId, clinicalOnlyIdentityId, nurseIdentityId].sort(),
    );
    expect(
      await visibleStaffIdentities({
        workspaceId: crypto.randomUUID(),
        staffIdentityId: administratorIdentityId,
      }),
    ).toEqual([]);
  });

  test('clinical seam requires Clinical Permission and fresh authentication', async () => {
    const client = createApiClient(baseUrl);
    const nurseCookie = await signIn(client, nurseEmail, nursePassword);

    const directory = await client.GET('/api/v1/clinical/review-directory', {
      headers: { cookie: nurseCookie },
    });
    expect(directory.response.status).toBe(200);
    expect(directory.data).toEqual({
      students: [],
      freshUntil: new Date(
        currentTime.getTime() + 15 * 60 * 1000,
      ).toISOString(),
    });

    const administratorCookie = await signIn(
      client,
      administratorEmail,
      administratorPassword,
    );
    const denied = await client.GET('/api/v1/clinical/review-directory', {
      headers: { cookie: administratorCookie },
    });
    expect(denied.response.status).toBe(403);
    expect(denied.error).toMatchObject({ code: 'STAFF_PERMISSION_REQUIRED' });

    async function databaseHasClinicalPermission(
      staffIdentityId: string,
    ): Promise<boolean> {
      const inspection = new Client({ connectionString: runtimeDatabaseUrl });
      await inspection.connect();
      try {
        await inspection.query('begin');
        await inspection.query(
          `select set_config('app.workspace_id', $1, true)`,
          [workspaceId],
        );
        await inspection.query(
          `select set_config('app.staff_identity_id', $1, true)`,
          [staffIdentityId],
        );
        const result = await inspection.query<{ allowed: boolean }>(
          `select identity_access.current_staff_has_permission('clinical')
             as allowed`,
        );
        await inspection.query('rollback');
        return result.rows[0]?.allowed ?? false;
      } finally {
        await inspection.end();
      }
    }
    expect(await databaseHasClinicalPermission(nurseIdentityId)).toBe(true);
    expect(await databaseHasClinicalPermission(administratorIdentityId)).toBe(
      false,
    );

    const before = currentTime;
    currentTime = new Date(before.getTime() + 16 * 60 * 1000);
    const stale = await client.GET('/api/v1/clinical/review-directory', {
      headers: { cookie: nurseCookie },
    });
    expect(stale.response.status).toBe(403);
    expect(stale.error).toMatchObject({ code: 'STAFF_AUTHENTICATION_STALE' });

    const stillValid = await client.GET('/api/v1/staff/session', {
      headers: { cookie: nurseCookie },
    });
    currentTime = before;
    expect(stillValid.response.status).toBe(200);
  });
});
