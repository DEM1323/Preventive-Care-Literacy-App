import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
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
import { classifyProviderDenial } from '../../modules/operational-readiness/index.ts';
import { PermanentInvitationDeliveryError } from '../../modules/invitation-delivery/index.ts';

const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0052';
const otherWorkspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0152';
const administratorId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0252';
const clinicianId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0352';
const otherAdminId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0452';
const administratorHandle = 'opaque-operational-readiness-administrator';
const clinicianHandle = 'opaque-operational-readiness-clinician';
const otherAdminHandle = 'opaque-operational-readiness-other-admin';
const evidenceDigest = 'ab'.repeat(32);
const artifactDigest = 'cd'.repeat(32);
const now = new Date('2026-08-28T15:00:00.000Z');
const origin = 'http://127.0.0.1';
const operatorToken = 'operational-readiness-operator-token-'.padEnd(40, 'x');
const operatorHeaders = {
  authorization: `Bearer ${operatorToken}`,
  origin,
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;
const mutationHeaders = {
  origin,
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;

let postgres: EphemeralPostgres;
let server: FastifyInstance;
let baseUrl: string;

function staffCookie(handle: string) {
  return `__Host-prevcare-staff-session=${handle}`;
}

async function operatorFetch(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...operatorHeaders, ...init?.headers },
  });
}

beforeAll(async () => {
  postgres = await startEphemeralPostgres();
  await migrate(postgres.connectionString);
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(
      `insert into identity_access.school_workspaces values
       ($1, 'Readiness School', $2, 'school', 'school_administrative', 'school_workspace')`,
      [workspaceId, now],
    );
    await owner.query(
      `insert into identity_access.staff_identities values
       ($1, $2, 'Admin Readiness', 'admin.readiness@example.test', $3, 'active',
        'principal', 'test setup', $4, 'school', 'school_administrative', 'staff_identity')`,
      [administratorId, workspaceId, crypto.randomUUID(), now],
    );
    await owner.query(
      `insert into identity_access.staff_permission_grants values
       ($1, $2, 'administrative', $3, 'test setup', 'school',
        'school_administrative', 'staff_permission_grant')`,
      [workspaceId, administratorId, now],
    );
    const adminSessionId = crypto.randomUUID();
    await owner.query(
      `insert into identity_access.staff_sessions values
       ($1, $2, $3, $4, 'aal2', $5, $6, null, $5,
        'school', 'operational_evidence', 'staff_session', $5, $7)`,
      [
        adminSessionId,
        workspaceId,
        administratorId,
        createHash('sha256').update(administratorHandle).digest('hex'),
        now,
        new Date(now.getTime() + 8 * 60 * 60 * 1000),
        new Date(now.getTime() + 8 * 60 * 60 * 1000),
      ],
    );
    await owner.query(
      `insert into identity_access.staff_session_freshness values ($1, $2, $3, $4)`,
      [adminSessionId, workspaceId, administratorId, now],
    );
    await owner.query(
      `insert into identity_access.staff_identities values
       ($1, $2, 'Nurse Readiness', 'nurse.readiness@example.test', $3, 'active',
        'principal', 'test setup', $4, 'school', 'school_administrative', 'staff_identity')`,
      [clinicianId, workspaceId, crypto.randomUUID(), now],
    );
    await owner.query(
      `insert into identity_access.staff_permission_grants values
       ($1, $2, 'clinical', $3, 'test setup', 'school',
        'school_administrative', 'staff_permission_grant')`,
      [workspaceId, clinicianId, now],
    );
    const clinicianSessionId = crypto.randomUUID();
    await owner.query(
      `insert into identity_access.staff_sessions values
       ($1, $2, $3, $4, 'aal2', $5, $6, null, $5,
        'school', 'operational_evidence', 'staff_session', $5, $7)`,
      [
        clinicianSessionId,
        workspaceId,
        clinicianId,
        createHash('sha256').update(clinicianHandle).digest('hex'),
        now,
        new Date(now.getTime() + 8 * 60 * 60 * 1000),
        new Date(now.getTime() + 8 * 60 * 60 * 1000),
      ],
    );
    await owner.query(
      `insert into identity_access.staff_session_freshness values ($1, $2, $3, $4)`,
      [clinicianSessionId, workspaceId, clinicianId, now],
    );
    await owner.query(
      `insert into identity_access.school_workspaces values
       ($1, 'Other Readiness School', $2, 'school', 'school_administrative', 'school_workspace')`,
      [otherWorkspaceId, now],
    );
    await owner.query(
      `insert into identity_access.staff_identities values
       ($1, $2, 'Other Admin', 'other.readiness@example.test', $3, 'active',
        'principal', 'test setup', $4, 'school', 'school_administrative', 'staff_identity')`,
      [otherAdminId, otherWorkspaceId, crypto.randomUUID(), now],
    );
    await owner.query(
      `insert into identity_access.staff_permission_grants values
       ($1, $2, 'administrative', $3, 'test setup', 'school',
        'school_administrative', 'staff_permission_grant')`,
      [otherWorkspaceId, otherAdminId, now],
    );
    const otherSessionId = crypto.randomUUID();
    await owner.query(
      `insert into identity_access.staff_sessions values
       ($1, $2, $3, $4, 'aal2', $5, $6, null, $5,
        'school', 'operational_evidence', 'staff_session', $5, $7)`,
      [
        otherSessionId,
        otherWorkspaceId,
        otherAdminId,
        createHash('sha256').update(otherAdminHandle).digest('hex'),
        now,
        new Date(now.getTime() + 8 * 60 * 60 * 1000),
        new Date(now.getTime() + 8 * 60 * 60 * 1000),
      ],
    );
    await owner.query(
      `insert into identity_access.staff_session_freshness values ($1, $2, $3, $4)`,
      [otherSessionId, otherWorkspaceId, otherAdminId, now],
    );
  } finally {
    await owner.end();
  }
  const runtimeDatabaseUrl = await createRuntimeDatabaseUser(
    postgres.connectionString,
  );
  server = await createServer({
    databaseUrl: runtimeDatabaseUrl,
    operatorCredentials: {
      token: operatorToken,
      actorId: 'readiness-operator',
    },
    staffAuth: createFakeStaffAuth().provider,
    publicOrigin: origin,
    wrappingKeys: {
      wrappingKeys: { test: Buffer.alloc(32, 13) },
      activeWrappingKeyId: 'test',
      idempotencyKey: Buffer.alloc(32, 19),
    },
    invitationSecrets: {
      hmacKey: Buffer.alloc(32, 7),
      encryptionKeys: { test: Buffer.alloc(32, 9) },
      activeEncryptionKeyId: 'test',
    },
    artifactDigest,
    clock: { now: () => now },
  });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  baseUrl =
    typeof address === 'string' ? address : `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) {
    server.server.closeIdleConnections?.();
    server.server.closeAllConnections?.();
    await server.close();
  }
  await postgres?.stop();
});

test('backup and restore resume stay closed until PITR evidence and purge manifests are proven', async () => {
  const unsatisfied = await operatorFetch(
    '/api/v1/operator/backup-configuration',
    {
      method: 'POST',
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        dailyBackupsEnabled: true,
        pointInTimeRecoveryDays: 3,
        source: 'provider_dashboard',
        evidenceDigest,
      }),
    },
  );
  expect(unsatisfied.status).toBe(200);
  expect(await unsatisfied.json()).toMatchObject({ status: 'unsatisfied' });

  const restored = await operatorFetch('/api/v1/operator/restore-runs', {
    method: 'POST',
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      succeeded: true,
      source: 'automated_contract',
    }),
  });
  expect(restored.status).toBe(200);

  const blocked = await operatorFetch('/api/v1/operator/restore-readiness');
  expect(blocked.status).toBe(200);
  expect(await blocked.json()).toMatchObject({
    resume: {
      allowed: false,
      code: 'BACKUP_CONFIGURATION_UNSATISFIED',
    },
  });

  const backup = await operatorFetch('/api/v1/operator/backup-configuration', {
    method: 'POST',
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      dailyBackupsEnabled: true,
      pointInTimeRecoveryDays: 7,
      source: 'automated_contract',
      evidenceDigest,
    }),
  });
  expect(backup.status).toBe(200);
  expect(await backup.json()).toMatchObject({
    status: 'satisfied',
    requiredPointInTimeRecoveryDays: 7,
  });

  const pending = await operatorFetch('/api/v1/operator/restore-readiness');
  expect(await pending.json()).toMatchObject({
    purgeRestoreGate: 'not_required',
    resume: {
      allowed: false,
      code: 'PURGE_RESTORE_GATE_NOT_VERIFIED',
    },
  });
});

test('operator alerts route to the Technical Operator without protected content', async () => {
  const emitted = await operatorFetch('/api/v1/operator/alerts', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'failed_email',
      summary: 'Invitation delivery failed',
    }),
  });
  expect(emitted.status).toBe(200);
  const alert = (await emitted.json()) as {
    alertId: string;
    destination: string;
    acknowledged: boolean;
  };
  expect(alert).toMatchObject({
    kind: 'failed_email',
    destination: 'technical_operator',
    acknowledged: false,
  });
  expect(JSON.stringify(alert)).not.toContain('admin.readiness@example.test');
  expect(JSON.stringify(alert)).not.toContain(administratorHandle);

  const ack = await operatorFetch('/api/v1/operator/alerts/acknowledgements', {
    method: 'POST',
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      alertId: alert.alertId,
    }),
  });
  expect(ack.status).toBe(200);
  expect(await ack.json()).toMatchObject({
    alertId: alert.alertId,
    acknowledged: true,
    acknowledgedBy: 'readiness-operator',
  });

  for (const kind of [
    'uptime',
    'application_error',
    'database_capacity',
  ] as const) {
    const created = await operatorFetch('/api/v1/operator/alerts', {
      method: 'POST',
      body: JSON.stringify({ kind, summary: `${kind} threshold` }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      kind,
      destination: 'technical_operator',
    });
  }
});

test('service caps are explicit and request bodies fail closed at the limit', async () => {
  const caps = await operatorFetch('/api/v1/operator/service-caps');
  expect(caps.status).toBe(200);
  expect(await caps.json()).toEqual({
    databasePoolMax: 10,
    databasePoolIdleTimeoutMs: 10_000,
    databasePoolConnectionTimeoutMs: 5_000,
    requestBodyLimitBytes: 65536,
    workerRequestBodyLimitBytes: 1024,
    workerConcurrency: 1,
    taskMaxAttempts: 5,
    taskBackoffInitialSeconds: 30,
    taskBackoffMaxSeconds: 900,
    invitationChallengeMaxFailedAttempts: 5,
  });

  const oversized = await operatorFetch('/api/v1/operator/alerts', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'uptime',
      summary: 'x'.repeat(70_000),
    }),
  });
  expect(oversized.status).toBe(413);
  expect(await oversized.json()).toMatchObject({ code: 'REQUEST_TOO_LARGE' });
});

test('forward schema compatibility is schema-compatible rollback or roll-forward-only', async () => {
  const schema = ['001_audited_spine.sql', '032_operator_repair.sql'];
  const compatible = await operatorFetch('/api/v1/operator/artifact-rollback', {
    method: 'POST',
    body: JSON.stringify({
      currentSchemaMigrations: schema,
      targetSchemaMigrations: schema,
      currentArtifactDigest: artifactDigest,
      targetArtifactDigest: evidenceDigest,
    }),
  });
  expect(compatible.status).toBe(200);
  expect(await compatible.json()).toMatchObject({
    decision: 'schema_compatible_rollback',
    reason: 'SAME_SCHEMA',
  });
  const rollForward = await operatorFetch(
    '/api/v1/operator/artifact-rollback',
    {
      method: 'POST',
      body: JSON.stringify({
        currentSchemaMigrations: schema,
        targetSchemaMigrations: [...schema, '033_operational_readiness.sql'],
        currentArtifactDigest: artifactDigest,
        targetArtifactDigest: evidenceDigest,
      }),
    },
  );
  expect(await rollForward.json()).toMatchObject({
    decision: 'roll_forward_only',
    reason: 'TARGET_SCHEMA_AHEAD',
  });
});

test('provider denials stay deterministic for permanent rejection and transient for retryable failure', () => {
  expect(classifyProviderDenial({ permanent: true, status: 403 })).toBe(
    'deterministic',
  );
  expect(classifyProviderDenial({ status: 503 })).toBe('transient');
  expect(new PermanentInvitationDeliveryError().name).toBe(
    'PermanentInvitationDeliveryError',
  );
});

test('incident drill stops activity, revokes access, preserves evidence, and resumes only with Technical Operator authorization', async () => {
  const restoreClosed = await operatorFetch('/api/v1/operator/restore-runs', {
    method: 'POST',
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      succeeded: false,
      source: 'automated_contract',
    }),
  });
  expect(restoreClosed.status).toBe(200);
  const adminDenied = await fetch(
    `${baseUrl}/api/v1/clinical/incident-stop-requests`,
    {
      method: 'POST',
      headers: {
        ...mutationHeaders,
        cookie: staffCookie(administratorHandle),
      },
      body: JSON.stringify({ operationId: crypto.randomUUID() }),
    },
  );
  expect(adminDenied.status).toBe(403);

  const nurseStop = await fetch(
    `${baseUrl}/api/v1/clinical/incident-stop-requests`,
    {
      method: 'POST',
      headers: {
        ...mutationHeaders,
        cookie: staffCookie(clinicianHandle),
      },
      body: JSON.stringify({ operationId: crypto.randomUUID() }),
    },
  );
  expect(nurseStop.status).toBe(200);
  expect(await nurseStop.json()).toMatchObject({
    status: 'stopped',
    stopped: true,
    requestedByType: 'school_nurse',
    requestedById: clinicianId,
  });

  expect((await fetch(`${baseUrl}/health/live`)).status).toBe(200);
  expect((await fetch(`${baseUrl}/health/ready`)).status).toBe(200);
  const repairable = await operatorFetch('/api/v1/operator/repairable-work');
  expect(repairable.status).toBe(200);

  const blockedWorkspace = await operatorFetch(
    '/api/v1/administration/school-workspaces',
    {
      method: 'POST',
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        displayName: 'Must not create during stop',
      }),
    },
  );
  expect(blockedWorkspace.status).toBe(409);
  expect(await blockedWorkspace.json()).toMatchObject({
    code: 'INCIDENT_ACTIVITY_STOPPED',
  });

  const otherWorkspaceBlocked = await fetch(
    `${baseUrl}/api/v1/administration/classes`,
    { headers: { cookie: staffCookie(otherAdminHandle) } },
  );
  expect(otherWorkspaceBlocked.status).toBe(409);

  const staleRevoke = await operatorFetch(
    '/api/v1/operator/incidents/revocations',
    {
      method: 'POST',
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        wrappingKeyId: 'rotated',
        deliveryKeyId: 'rotated',
      }),
    },
  );
  expect(staleRevoke.status).toBe(200);

  const sessionAfterRevoke = await createApiClient(baseUrl).GET(
    '/api/v1/staff/session',
    { headers: { cookie: staffCookie(clinicianHandle) } },
  );
  expect(sessionAfterRevoke.response.status).toBe(409);
  expect(sessionAfterRevoke.error).toMatchObject({
    code: 'INCIDENT_ACTIVITY_STOPPED',
  });
  expect(await staleRevoke.json()).toMatchObject({
    secretsRevoked: true,
    wrappingKeyId: 'rotated',
  });

  await operatorFetch('/api/v1/operator/incidents/evidence', {
    method: 'POST',
    body: JSON.stringify({ operationId: crypto.randomUUID() }),
  });
  await operatorFetch('/api/v1/operator/incidents/repairs', {
    method: 'POST',
    body: JSON.stringify({ operationId: crypto.randomUUID() }),
  });
  await operatorFetch('/api/v1/operator/incidents/checks', {
    method: 'POST',
    body: JSON.stringify({ operationId: crypto.randomUUID() }),
  });
  const staleResume = await operatorFetch('/api/v1/operator/incidents/resume', {
    method: 'POST',
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      confirmation: 'authorize_incident_resume',
    }),
  });
  expect(staleResume.status).toBe(409);
  expect(await staleResume.json()).toMatchObject({
    code: 'INCIDENT_CHECKS_FAILED',
  });
});

test('Technical Operator can complete an incident drill with matching secrets and matching artifact identity', async () => {
  const restoreClosed = await operatorFetch('/api/v1/operator/restore-runs', {
    method: 'POST',
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      succeeded: false,
      source: 'automated_contract',
    }),
  });
  expect(restoreClosed.status).toBe(200);
  const stop = await operatorFetch('/api/v1/operator/incidents/stop', {
    method: 'POST',
    body: JSON.stringify({ operationId: crypto.randomUUID() }),
  });
  expect(stop.status).toBe(200);

  const revoke = await operatorFetch('/api/v1/operator/incidents/revocations', {
    method: 'POST',
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      wrappingKeyId: 'test',
      deliveryKeyId: 'test',
    }),
  });
  expect(revoke.status).toBe(200);
  const revoked = (await revoke.json()) as {
    secretsRevoked: boolean;
    wrappingKeyId: string;
  };
  expect(revoked.secretsRevoked).toBe(true);
  expect(revoked.wrappingKeyId).toBe('test');

  const evidence = await operatorFetch('/api/v1/operator/incidents/evidence', {
    method: 'POST',
    body: JSON.stringify({ operationId: crypto.randomUUID() }),
  });
  expect(evidence.status).toBe(200);
  const preserved = await evidence.json();
  expect(JSON.stringify(preserved)).not.toContain(
    'admin.readiness@example.test',
  );
  expect(JSON.stringify(preserved)).not.toContain(administratorHandle);
  expect(JSON.stringify(preserved)).not.toContain(
    'opaque-operational-readiness',
  );

  const repaired = await operatorFetch('/api/v1/operator/incidents/repairs', {
    method: 'POST',
    body: JSON.stringify({ operationId: crypto.randomUUID() }),
  });
  expect(repaired.status).toBe(200);

  const mismatched = await operatorFetch('/api/v1/operator/incidents/checks', {
    method: 'POST',
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      acceptedArtifactDigest: evidenceDigest,
    }),
  });
  expect(mismatched.status).toBe(200);
  expect(await mismatched.json()).toMatchObject({
    checks: expect.arrayContaining([
      { check: 'artifact_identity', outcome: 'failed' },
    ]),
  });
  const blockedArtifact = await operatorFetch(
    '/api/v1/operator/incidents/resume',
    {
      method: 'POST',
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        confirmation: 'authorize_incident_resume',
      }),
    },
  );
  expect(blockedArtifact.status).toBe(409);
  expect(await blockedArtifact.json()).toMatchObject({
    code: 'INCIDENT_CHECKS_FAILED',
  });

  const checks = await operatorFetch('/api/v1/operator/incidents/checks', {
    method: 'POST',
    body: JSON.stringify({ operationId: crypto.randomUUID() }),
  });
  expect(checks.status).toBe(200);
  expect(await checks.json()).toMatchObject({
    status: 'checks_recorded',
    checks: [
      { check: 'purge_restore_gate', outcome: 'passed' },
      { check: 'artifact_identity', outcome: 'passed' },
      { check: 'secret_generation', outcome: 'passed' },
      { check: 'backup_configuration', outcome: 'passed' },
    ],
  });

  const missingConfirmation = await operatorFetch(
    '/api/v1/operator/incidents/resume',
    {
      method: 'POST',
      body: JSON.stringify({ operationId: crypto.randomUUID() }),
    },
  );
  expect(missingConfirmation.status).toBe(400);

  const resumeOperation = crypto.randomUUID();
  const resumed = await operatorFetch('/api/v1/operator/incidents/resume', {
    method: 'POST',
    body: JSON.stringify({
      operationId: resumeOperation,
      confirmation: 'authorize_incident_resume',
    }),
  });
  expect(resumed.status).toBe(200);
  expect(await resumed.json()).toMatchObject({
    status: 'resumed',
    stopped: false,
    resumeAuthorizedBy: 'readiness-operator',
  });

  const replayed = await operatorFetch('/api/v1/operator/incidents/resume', {
    method: 'POST',
    body: JSON.stringify({
      operationId: resumeOperation,
      confirmation: 'authorize_incident_resume',
    }),
  });
  expect(replayed.status).toBe(200);

  const sessionAfterResume = await createApiClient(baseUrl).GET(
    '/api/v1/staff/session',
    { headers: { cookie: staffCookie(administratorHandle) } },
  );
  expect(sessionAfterResume.response.status).toBe(401);

  const created = await operatorFetch(
    '/api/v1/administration/school-workspaces',
    {
      method: 'POST',
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        displayName: 'Post-resume workspace',
      }),
    },
  );
  expect(created.status).toBe(201);
});
