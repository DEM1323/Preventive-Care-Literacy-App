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

const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecfb011';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecfb012';
const otherWorkspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecfb013';
const otherStaffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecfb014';
const otherSessionHandle = 'opaque-other-purge-verification-session';
const sessionHandle = 'opaque-purge-verification-administrator-session';
const invitationCode = '610301';
const cancellationWindowMs = 7 * 24 * 60 * 60 * 1000;
const cacheWindowMs = 60 * 60 * 1000;
const backupWindowMs = 30 * 24 * 60 * 60 * 1000;
const providerDigest = 'ab'.repeat(32);
let generatedCode = invitationCode;
let now = new Date('2026-08-28T12:00:00.000Z');
const mutationHeaders = {
  origin: 'http://127.0.0.1',
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;
const operatorHeaders = {
  ...mutationHeaders,
  authorization: 'Bearer test-operator-token-with-more-than-32-characters',
};

let postgres: EphemeralPostgres;
let server: FastifyInstance;
let baseUrl: string;
let studentSeq = 0;

function staffCookie(handle = sessionHandle) {
  return `__Host-prevcare-staff-session=${handle}`;
}

function studentSessionCookie(response: Response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
}

type VerificationLocation = {
  adapter: string;
  location: string;
  deletion: string;
  verification: string;
  residualRetentionDeadlineAt: string;
  evidenceDigest: string | null;
};

async function markInvitationDelivered(invitationId: string) {
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(
      `update identity_access.invitations set status = 'delivered'
        where invitation_id = $1`,
      [invitationId],
    );
  } finally {
    await owner.end();
  }
}

async function seedStudent(input: { recipient: string; code: string }) {
  const invitationId = crypto.randomUUID();
  generatedCode = input.code;
  const created = await fetch(`${baseUrl}/api/v1/administration/classes`, {
    method: 'POST',
    headers: { ...mutationHeaders, cookie: staffCookie() },
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      classId: crypto.randomUUID(),
      invitationId,
      name: `Purge Verification Class ${++studentSeq}`,
      recipient: input.recipient,
    }),
  });
  generatedCode = invitationCode;
  expect(created.status).toBe(201);
  await markInvitationDelivered(invitationId);
  const joined = await fetch(
    `${baseUrl}/api/v1/auth/student/invitations/redeem`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({
        recipient: input.recipient,
        code: input.code,
      }),
    },
  );
  expect(joined.status).toBe(200);
  const sessionCookie = studentSessionCookie(joined);
  const access = (await (
    await fetch(`${baseUrl}/api/v1/student/session`, {
      headers: { cookie: sessionCookie },
    })
  ).json()) as { studentId: string };
  return { studentId: access.studentId, sessionCookie, invitationId };
}

async function insertOwnedLocations(studentId: string) {
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    const intakeId = crypto.randomUUID();
    const completionId = crypto.randomUUID();
    await owner.query(
      `insert into intake.intake_record_versions
         (intake_record_version_id, student_id, workspace_id, version_number,
          school_configuration_release_id, intake_form_resource_id,
          intake_form_revision_number, submission_attestation_resource_id,
          submission_attestation_revision_number, locale, wrapping_key_id,
          wrapped_data_key, ciphertext, accepted_at, superseded_at,
          record_owner, record_classification, disposal_class)
       values ($1, $2, $3, 1, $4, $4, 1, $4, 1, 'en-US', 'test', 'wrapped',
               'sealed-intake-answers', $5, null, 'school', 'student_record',
               'intake_record_version')`,
      [intakeId, studentId, workspaceId, crypto.randomUUID(), now],
    );
    await owner.query(
      `insert into intake.intake_drafts
         (student_id, workspace_id, school_configuration_release_id,
          intake_form_resource_id, intake_form_revision_number, locale,
          wrapping_key_id, wrapped_data_key, ciphertext, updated_at,
          record_owner, record_classification, disposal_class, draft_revision)
       values ($1, $2, $3, $3, 1, 'en-US', 'test', 'wrapped-draft',
               'sealed-draft-answers', $4, 'school', 'student_record',
               'intake_draft', 1)
       on conflict (student_id, workspace_id) do nothing`,
      [studentId, workspaceId, crypto.randomUUID(), now],
    );
    await owner.query(
      `insert into learning_progress.item_completions
         (item_completion_id, student_id, workspace_id, item_id,
          item_revision_number, school_configuration_release_id, operation_id,
          completed_at, record_owner, record_classification, disposal_class)
       values ($1, $2, $3, $4, 1, $4, $4, $5, 'school', 'student_record',
               'item_completion')`,
      [completionId, studentId, workspaceId, crypto.randomUUID(), now],
    );
    return { intakeId, completionId };
  } finally {
    await owner.end();
  }
}

async function advanceTrustedTime(to: Date) {
  now = to;
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    const expiresAt = new Date(to.getTime() + 8 * 60 * 60 * 1000);
    await owner.query(
      `update identity_access.staff_sessions
          set last_seen_at = $1, idle_expires_at = $2, expires_at = $2
        where workspace_id in ($3, $4)`,
      [to, expiresAt, workspaceId, otherWorkspaceId],
    );
    await owner.query(
      `update identity_access.staff_session_freshness
          set refreshed_at = $1
        where workspace_id in ($2, $3)`,
      [to, workspaceId, otherWorkspaceId],
    );
  } finally {
    await owner.end();
  }
}

async function countOwnedLocations(studentId: string) {
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    const result = await owner.query<{
      drafts: string;
      versions: string;
      completions: string;
    }>(
      `select
         (select count(*)::text from intake.intake_drafts
           where student_id = $1 and workspace_id = $2) as drafts,
         (select count(*)::text from intake.intake_record_versions
           where student_id = $1 and workspace_id = $2) as versions,
         (select count(*)::text from learning_progress.item_completions
           where student_id = $1 and workspace_id = $2) as completions`,
      [studentId, workspaceId],
    );
    return result.rows[0]!;
  } finally {
    await owner.end();
  }
}

async function depart(studentId: string) {
  const result = await createApiClient(baseUrl).POST(
    '/api/v1/administration/students/departures',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId,
        reason: 'graduated',
        effectiveOn: '2026-06-15',
      },
    },
  );
  expect(result.response.status).toBe(200);
}

async function completeNotice(studentId: string) {
  const result = await createApiClient(baseUrl).POST(
    '/api/v1/administration/students/record-disposition-notices',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: { operationId: crypto.randomUUID(), studentId },
    },
  );
  expect(result.response.status).toBe(200);
}

async function completeCopyOpportunity(studentId: string) {
  const result = await createApiClient(baseUrl).POST(
    '/api/v1/administration/students/record-disposition-copy-opportunities',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: { operationId: crypto.randomUUID(), studentId },
    },
  );
  expect(result.response.status).toBe(200);
}

async function openAuthorizedDispositionCase(studentId: string) {
  const opened = await createApiClient(baseUrl).POST(
    '/api/v1/administration/students/record-lifecycle-cases',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId,
        caseType: 'disposition',
        requestCode: 'scheduled_destruction',
        requesterKind: 'school_administrator',
        authorityKind: 'school_administrator',
        scope: {
          portions: ['complete_bundle'],
          purpose: 'scheduled_destruction',
        },
        deadlineAt: '2026-09-30T00:00:00.000Z',
      },
    },
  );
  expect(opened.response.status).toBe(200);
  const decided = await createApiClient(baseUrl).POST(
    '/api/v1/administration/students/record-lifecycle-case-decisions',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        caseId: opened.data!.caseId,
        decision: 'authorized',
      },
    },
  );
  expect(decided.response.status).toBe(200);
  return opened.data!.caseId;
}

async function preparePurged(input: { recipient: string; code: string }) {
  const seeded = await seedStudent(input);
  await insertOwnedLocations(seeded.studentId);
  await depart(seeded.studentId);
  const caseId = await openAuthorizedDispositionCase(seeded.studentId);
  await completeNotice(seeded.studentId);
  await completeCopyOpportunity(seeded.studentId);
  const scheduled = await createApiClient(baseUrl).POST(
    '/api/v1/administration/students/record-dispositions',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId: seeded.studentId,
        caseId,
        confirmation: 'schedule_destruction',
      },
    },
  );
  expect(scheduled.response.status).toBe(200);
  await advanceTrustedTime(new Date(now.getTime() + cancellationWindowMs));
  const executed = await createApiClient(baseUrl).POST(
    '/api/v1/administration/students/record-disposition-executions',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        dispositionId: scheduled.data!.dispositionId,
        expectedVersion: 1,
        confirmation: 'execute_destruction',
      },
    },
  );
  expect(executed.response.status).toBe(200);
  expect(executed.data?.outcome).toBe('purged');
  return {
    ...seeded,
    caseId,
    dispositionId: scheduled.data!.dispositionId,
  };
}

async function readGovernance(studentId: string) {
  const listing = await createApiClient(baseUrl).GET(
    '/api/v1/administration/students/records-governance',
    { headers: { cookie: staffCookie() } },
  );
  expect(listing.response.status).toBe(200);
  return listing.data!.students.find((row) => row.studentId === studentId);
}

async function dispositionState(studentId: string) {
  const row = await readGovernance(studentId);
  const disposition = row?.dispositions[0] as
    | {
        version: number;
        verificationLocations?: VerificationLocation[];
      }
    | undefined;
  expect(disposition).toBeDefined();
  return disposition!;
}

async function reconcileVerification(
  dispositionId: string,
  expectedVersion: number,
) {
  const repaired = await fetch(
    `${baseUrl}/api/v1/administration/students/purge-verification-reconciliations`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        dispositionId,
        expectedVersion,
      }),
    },
  );
  expect(repaired.status).toBe(200);
  return repaired.json() as Promise<{ outcome: string }>;
}

async function readinessStatus() {
  return (await fetch(`${baseUrl}/health/ready`)).status;
}

beforeAll(async () => {
  postgres = await startEphemeralPostgres();
  await migrate(postgres.connectionString);
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(
      `insert into identity_access.school_workspaces values
       ($1, 'Verification School', $2, 'school', 'school_administrative', 'school_workspace')`,
      [workspaceId, now],
    );
    await owner.query(
      `insert into identity_access.staff_identities values
       ($1, $2, 'Riley Nash', 'administrator.verification@example.test', $3, 'active',
        'principal', 'test setup', $4, 'school', 'school_administrative', 'staff_identity')`,
      [staffIdentityId, workspaceId, crypto.randomUUID(), now],
    );
    await owner.query(
      `insert into identity_access.staff_permission_grants values
       ($1, $2, 'administrative', $3, 'test setup', 'school',
        'school_administrative', 'staff_permission_grant')`,
      [workspaceId, staffIdentityId, now],
    );
    const staffSessionId = crypto.randomUUID();
    await owner.query(
      `insert into identity_access.staff_sessions values
       ($1, $2, $3, $4, 'aal2', $5, $6, null, $5,
        'school', 'operational_evidence', 'staff_session', $5, $7)`,
      [
        staffSessionId,
        workspaceId,
        staffIdentityId,
        createHash('sha256').update(sessionHandle).digest('hex'),
        now,
        new Date(now.getTime() + 8 * 60 * 60 * 1000),
        new Date(now.getTime() + 8 * 60 * 60 * 1000),
      ],
    );
    await owner.query(
      `insert into identity_access.staff_session_freshness values
       ($1, $2, $3, $4)`,
      [staffSessionId, workspaceId, staffIdentityId, now],
    );
    await owner.query(
      `insert into identity_access.school_workspaces values
       ($1, 'Other Verification School', $2, 'school', 'school_administrative', 'school_workspace')`,
      [otherWorkspaceId, now],
    );
    await owner.query(
      `insert into identity_access.staff_identities values
       ($1, $2, 'Other Admin', 'other.verification@example.test', $3, 'active',
        'principal', 'test setup', $4, 'school', 'school_administrative', 'staff_identity')`,
      [otherStaffIdentityId, otherWorkspaceId, crypto.randomUUID(), now],
    );
    await owner.query(
      `insert into identity_access.staff_permission_grants values
       ($1, $2, 'administrative', $3, 'test setup', 'school',
        'school_administrative', 'staff_permission_grant')`,
      [otherWorkspaceId, otherStaffIdentityId, now],
    );
    const otherSessionId = crypto.randomUUID();
    await owner.query(
      `insert into identity_access.staff_sessions values
       ($1, $2, $3, $4, 'aal2', $5, $6, null, $5,
        'school', 'operational_evidence', 'staff_session', $5, $7)`,
      [
        otherSessionId,
        otherWorkspaceId,
        otherStaffIdentityId,
        createHash('sha256').update(otherSessionHandle).digest('hex'),
        now,
        new Date(now.getTime() + 8 * 60 * 60 * 1000),
        new Date(now.getTime() + 8 * 60 * 60 * 1000),
      ],
    );
    await owner.query(
      `insert into identity_access.staff_session_freshness values
       ($1, $2, $3, $4)`,
      [otherSessionId, otherWorkspaceId, otherStaffIdentityId, now],
    );
  } finally {
    await owner.end();
  }

  const runtimeDatabaseUrl = await createRuntimeDatabaseUser(
    postgres.connectionString,
  );
  server = await createServer({
    databaseUrl: runtimeDatabaseUrl,
    publicOrigin: 'http://127.0.0.1',
    operatorCredentials: {
      token: 'test-operator-token-with-more-than-32-characters',
      actorId: 'operator',
    },
    staffAuth: createFakeStaffAuth().provider,
    clock: { now: () => now },
    invitationSecrets: {
      hmacKey: Buffer.alloc(32, 7),
      encryptionKeys: { test: Buffer.alloc(32, 9) },
      activeEncryptionKeyId: 'test',
      createCode: () => generatedCode,
    },
  });
  baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
});

test('restore from a pre-purge snapshot reapplies manifests and fail-closes readiness until suppression is proven', async () => {
  expect(await readinessStatus()).toBe(200);
  const prepared = await preparePurged({
    recipient: 'restore.gate@example.edu',
    code: '610302',
  });
  const empty = await countOwnedLocations(prepared.studentId);
  expect(empty.versions).toBe('0');

  const exported = await fetch(`${baseUrl}/api/v1/operator/purge-tombstones`, {
    headers: operatorHeaders,
  });
  expect(exported.status).toBe(200);
  const ledger = (await exported.json()) as {
    tombstones: {
      dispositionId: string;
      workspaceId: string;
      studentId: string;
      completedAt: string;
      adapters: string[];
    }[];
  };
  expect(ledger.tombstones).toHaveLength(1);
  expect(JSON.stringify(ledger)).not.toContain('sealed-intake-answers');
  expect(JSON.stringify(ledger)).not.toContain('restore.gate@example.edu');

  const skipped = await fetch(`${baseUrl}/api/v1/operator/purge-restore-gate`, {
    method: 'POST',
    headers: operatorHeaders,
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      manifests: ledger.tombstones,
    }),
  });
  expect(skipped.status).toBe(200);
  expect(await skipped.json()).toMatchObject({
    outcome: 'failed',
    failedCode: 'RESTORE_GATE_NOT_PENDING',
  });
  expect(await readinessStatus()).toBe(200);

  await insertOwnedLocations(prepared.studentId);
  const resurrected = await countOwnedLocations(prepared.studentId);
  expect(resurrected.versions).toBe('1');
  expect(await readinessStatus()).toBe(503);

  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query('begin');
    await owner.query(`select set_config('app.purge_restore_gate', '1', true)`);
    await expect(
      owner.query(
        `delete from intake.intake_record_versions
          where student_id = $1 and workspace_id = $2`,
        [prepared.studentId, workspaceId],
      ),
    ).rejects.toThrow(/immutable/);
    await owner.query('rollback');
    await owner.query(
      'alter table records_governance.purge_tombstones disable trigger purge_tombstones_are_append_only',
    );
    await owner.query('delete from records_governance.purge_tombstones');
    await owner.query(
      'alter table records_governance.purge_tombstones enable trigger purge_tombstones_are_append_only',
    );
  } finally {
    await owner.end();
  }

  const began = await fetch(
    `${baseUrl}/api/v1/operator/purge-restore-gate/begin`,
    {
      method: 'POST',
      headers: operatorHeaders,
      body: JSON.stringify({ operationId: crypto.randomUUID() }),
    },
  );
  expect(began.status).toBe(200);
  const beganBody = (await began.json()) as {
    operationId: string;
    outcome: string;
  };
  expect(beganBody.outcome).toBe('pending');
  expect(await readinessStatus()).toBe(503);

  const replayBegin = await fetch(
    `${baseUrl}/api/v1/operator/purge-restore-gate/begin`,
    {
      method: 'POST',
      headers: operatorHeaders,
      body: JSON.stringify({ operationId: beganBody.operationId }),
    },
  );
  expect(replayBegin.status).toBe(200);
  expect(await replayBegin.json()).toMatchObject({
    operationId: beganBody.operationId,
    outcome: 'pending',
  });

  const emptyRun = await fetch(
    `${baseUrl}/api/v1/operator/purge-restore-gate`,
    {
      method: 'POST',
      headers: operatorHeaders,
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        manifests: [],
      }),
    },
  );
  expect(emptyRun.status).toBe(200);
  expect(await emptyRun.json()).toMatchObject({
    outcome: 'failed',
    failedCode: 'RESTORE_MANIFESTS_REQUIRED',
  });
  expect(await readinessStatus()).toBe(503);

  const gated = await fetch(`${baseUrl}/api/v1/operator/purge-restore-gate`, {
    method: 'POST',
    headers: operatorHeaders,
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      manifests: ledger.tombstones,
    }),
  });
  expect(gated.status).toBe(200);
  const gateBody = (await gated.json()) as {
    outcome: string;
    reappliedCount: number;
  };
  expect(gateBody.outcome).toBe('verified');
  expect(gateBody.reappliedCount).toBe(1);
  const suppressed = await countOwnedLocations(prepared.studentId);
  expect(suppressed.versions).toBe('0');
  expect(suppressed.drafts).toBe('0');
  expect(suppressed.completions).toBe('0');
  expect(await readinessStatus()).toBe(200);
});

test('every adapter reports deletion, verification, and its residual-retention window; failed locations stay repairable', async () => {
  const prepared = await preparePurged({
    recipient: 'adapter.windows@example.edu',
    code: '610303',
  });
  const row = await readGovernance(prepared.studentId);
  const locations =
    (
      row?.dispositions[0] as
        { verificationLocations?: VerificationLocation[] } | undefined
    )?.verificationLocations ?? [];
  expect(locations.map((entry) => entry.adapter).sort()).toEqual([
    'backups',
    'caches',
    'clinical_access_evidence',
    'email_provider',
    'identity_access',
    'intake',
    'learning_progress',
    'memberships',
    'object_storage',
    'productions',
    'projections',
    'queues',
    'replicas',
    'telemetry',
  ]);
  const pending = locations.filter((entry) => entry.verification === 'pending');
  expect(pending.map((entry) => entry.adapter).sort()).toEqual([
    'backups',
    'caches',
    'email_provider',
    'object_storage',
    'queues',
    'replicas',
    'telemetry',
  ]);
  for (const entry of pending) {
    expect(entry.deletion).toBe('requested');
    expect(Date.parse(entry.residualRetentionDeadlineAt)).toBeGreaterThan(
      now.getTime(),
    );
  }
  for (const entry of locations.filter(
    (item) => item.verification === 'verified',
  )) {
    expect(entry.deletion).toBe('deleted');
    expect(entry.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(entry)).not.toContain('sealed-intake-answers');
    expect(JSON.stringify(entry)).not.toContain('adapter.windows@example.edu');
  }

  await advanceTrustedTime(new Date(now.getTime() + cacheWindowMs + 1));
  const lateView = await dispositionState(prepared.studentId);
  const caches = lateView.verificationLocations?.find(
    (entry) => entry.adapter === 'caches',
  );
  expect(caches?.verification).toBe('pending');
  expect(Date.parse(caches!.residualRetentionDeadlineAt)).toBeLessThan(
    now.getTime(),
  );
  const lateDenied = await fetch(
    `${baseUrl}/api/v1/administration/students/record-destruction-certificates`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        dispositionId: prepared.dispositionId,
        expectedVersion: lateView.version,
        confirmation: 'issue_destruction_certificate',
      }),
    },
  );
  expect(lateDenied.status).toBe(409);
  const lateProblem = (await lateDenied.json()) as {
    blockingLocations?: { adapter: string }[];
  };
  expect(
    lateProblem.blockingLocations?.map((entry) => entry.adapter),
  ).toContain('caches');

  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(
      `update records_governance.purge_verification_locations
          set deletion = 'failed', verification = 'failed',
              last_error_code = 'ADAPTER_RESIDUE_PRESENT'
        where disposition_id = $1 and adapter = 'object_storage'`,
      [prepared.dispositionId],
    );
  } finally {
    await owner.end();
  }
  const failedView = await dispositionState(prepared.studentId);
  const objectStorage = failedView.verificationLocations?.find(
    (entry) => entry.adapter === 'object_storage',
  );
  expect(objectStorage?.verification).toBe('failed');

  const repaired = await reconcileVerification(
    prepared.dispositionId,
    failedView.version,
  );
  expect(repaired.outcome).toBe('reconciled');
  const after = await dispositionState(prepared.studentId);
  const repairedStorage = after.verificationLocations?.find(
    (entry) => entry.adapter === 'object_storage',
  );
  expect(repairedStorage?.verification).toBe('verified');
  expect(repairedStorage?.deletion).toBe('deleted');
  const repairedCaches = after.verificationLocations?.find(
    (entry) => entry.adapter === 'caches',
  );
  expect(repairedCaches?.verification).toBe('verified');
});

test('backup expiry cannot be verified early, and the certificate is denied until every required location is verified', async () => {
  const prepared = await preparePurged({
    recipient: 'certificate.flow@example.edu',
    code: '610304',
  });
  let state = await dispositionState(prepared.studentId);
  const tooEarly = await fetch(
    `${baseUrl}/api/v1/administration/students/purge-backup-expiry-verifications`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        dispositionId: prepared.dispositionId,
        expectedVersion: state.version,
        confirmation: 'backup_expiry_verified',
      }),
    },
  );
  expect(tooEarly.status).toBe(409);
  expect((await tooEarly.json()) as { code?: string }).toMatchObject({
    code: 'PURGE_BACKUP_EXPIRY_NOT_READY',
  });

  const denied = await fetch(
    `${baseUrl}/api/v1/administration/students/record-destruction-certificates`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        dispositionId: prepared.dispositionId,
        expectedVersion: state.version,
        confirmation: 'issue_destruction_certificate',
      }),
    },
  );
  expect(denied.status).toBe(409);
  const problem = (await denied.json()) as {
    code?: string;
    blockingLocations?: { adapter: string; verification: string }[];
  };
  expect(problem.code).toBe('DESTRUCTION_CERTIFICATE_NOT_ISSUABLE');
  expect(
    problem.blockingLocations?.map((entry) => entry.adapter).sort(),
  ).toEqual([
    'backups',
    'caches',
    'email_provider',
    'object_storage',
    'queues',
    'replicas',
    'telemetry',
  ]);
  expect(JSON.stringify(problem)).not.toContain('certificate.flow@example.edu');
  expect(JSON.stringify(problem)).not.toContain('sealed-intake-answers');

  const reconciled = await reconcileVerification(
    prepared.dispositionId,
    state.version,
  );
  expect(reconciled.outcome).toBe('reconciled');
  state = await dispositionState(prepared.studentId);
  const stillPending = await fetch(
    `${baseUrl}/api/v1/administration/students/record-destruction-certificates`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        dispositionId: prepared.dispositionId,
        expectedVersion: state.version,
        confirmation: 'issue_destruction_certificate',
      }),
    },
  );
  expect(stillPending.status).toBe(409);
  expect(
    (
      (await stillPending.json()) as {
        blockingLocations?: { adapter: string }[];
      }
    ).blockingLocations
      ?.map((entry) => entry.adapter)
      .sort(),
  ).toEqual(['backups', 'email_provider']);

  const provider = await fetch(
    `${baseUrl}/api/v1/administration/students/purge-provider-verifications`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        dispositionId: prepared.dispositionId,
        expectedVersion: state.version,
        adapter: 'email_provider',
        confirmation: 'provider_deletion_verified',
        evidenceDigest: providerDigest,
      }),
    },
  );
  expect(provider.status).toBe(200);

  state = await dispositionState(prepared.studentId);
  await advanceTrustedTime(new Date(now.getTime() + backupWindowMs));
  const backup = await fetch(
    `${baseUrl}/api/v1/administration/students/purge-backup-expiry-verifications`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        dispositionId: prepared.dispositionId,
        expectedVersion: state.version,
        confirmation: 'backup_expiry_verified',
      }),
    },
  );
  expect(backup.status).toBe(200);

  state = await dispositionState(prepared.studentId);
  const operationId = crypto.randomUUID();
  const issued = await fetch(
    `${baseUrl}/api/v1/administration/students/record-destruction-certificates`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId,
        dispositionId: prepared.dispositionId,
        expectedVersion: state.version,
        confirmation: 'issue_destruction_certificate',
      }),
    },
  );
  expect(issued.status).toBe(200);
  const certified = (await issued.json()) as {
    certificateId: string;
    outcome: string;
  };
  expect(certified.outcome).toBe('certified');
  const replay = await fetch(
    `${baseUrl}/api/v1/administration/students/record-destruction-certificates`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId,
        dispositionId: prepared.dispositionId,
        expectedVersion: state.version,
        confirmation: 'issue_destruction_certificate',
      }),
    },
  );
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({
    certificateId: certified.certificateId,
    outcome: 'certified',
  });
  const secondIssue = await fetch(
    `${baseUrl}/api/v1/administration/students/record-destruction-certificates`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        dispositionId: prepared.dispositionId,
        expectedVersion: state.version,
        confirmation: 'issue_destruction_certificate',
      }),
    },
  );
  expect(secondIssue.status).toBe(200);
  expect(await secondIssue.json()).toMatchObject({
    certificateId: certified.certificateId,
  });

  const fetched = await fetch(
    `${baseUrl}/api/v1/administration/students/record-destruction-certificates?dispositionId=${prepared.dispositionId}`,
    { headers: { cookie: staffCookie() } },
  );
  expect(fetched.status).toBe(200);
  const certificate = (await fetched.json()) as Record<string, unknown>;
  const serialized = JSON.stringify(certificate);
  expect(serialized).not.toContain(prepared.studentId);
  expect(serialized).not.toContain('certificate.flow@example.edu');
  expect(serialized).not.toContain('sealed-intake-answers');
  expect(serialized).not.toContain('sealed-draft-answers');
  expect(certificate.dispositionId).toBe(prepared.dispositionId);
  expect(certificate.certificateId).toBe(certified.certificateId);

  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    const residue = await owner.query<{
      student_id: string | null;
      discarded_at: Date | null;
    }>(
      `select student_id, discarded_at
         from records_governance.purge_identifying_residue
        where disposition_id = $1`,
      [prepared.dispositionId],
    );
    expect(residue.rows[0]?.student_id).toBeNull();
    expect(residue.rows[0]?.discarded_at).not.toBeNull();
  } finally {
    await owner.end();
  }
});

test('purge verification commands are workspace-isolated', async () => {
  const prepared = await preparePurged({
    recipient: 'isolation.verify@example.edu',
    code: '610305',
  });
  const denied = await fetch(
    `${baseUrl}/api/v1/administration/students/purge-provider-verifications`,
    {
      method: 'POST',
      headers: {
        ...mutationHeaders,
        cookie: staffCookie(otherSessionHandle),
      },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        dispositionId: prepared.dispositionId,
        expectedVersion: 2,
        adapter: 'email_provider',
        confirmation: 'provider_deletion_verified',
        evidenceDigest: providerDigest,
      }),
    },
  );
  expect(denied.status).toBe(404);
  const certificateDenied = await fetch(
    `${baseUrl}/api/v1/administration/students/record-destruction-certificates`,
    {
      method: 'POST',
      headers: {
        ...mutationHeaders,
        cookie: staffCookie(otherSessionHandle),
      },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        dispositionId: prepared.dispositionId,
        expectedVersion: 2,
        confirmation: 'issue_destruction_certificate',
      }),
    },
  );
  expect(certificateDenied.status).toBe(404);
});
