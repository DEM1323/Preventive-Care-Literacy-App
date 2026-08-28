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

const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecfb001';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecfb002';
const otherWorkspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecfb003';
const otherStaffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecfb004';
const otherSessionHandle = 'opaque-other-disposition-administrator-session';
const sessionHandle = 'opaque-disposition-administrator-session-handle';
const invitationCode = '610104';
const cancellationWindowMs = 7 * 24 * 60 * 60 * 1000;
let generatedCode = invitationCode;
let now = new Date('2026-08-27T18:00:00.000Z');
const mutationHeaders = {
  origin: 'http://127.0.0.1',
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;

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
      name: `Disposition Class ${++studentSeq}`,
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
      emails: string;
      sessions: string;
      memberships: string;
      drafts: string;
      versions: string;
      completions: string;
      version_ciphertext: string | null;
    }>(
      `select
         (select count(*)::text from identity_access.verified_email_addresses
           where student_id = $1 and workspace_id = $2) as emails,
         (select count(*)::text from identity_access.student_sessions
           where student_id = $1 and workspace_id = $2) as sessions,
         (select count(*)::text from identity_access.class_memberships
           where student_id = $1 and workspace_id = $2) as memberships,
         (select count(*)::text from intake.intake_drafts
           where student_id = $1 and workspace_id = $2) as drafts,
         (select count(*)::text from intake.intake_record_versions
           where student_id = $1 and workspace_id = $2) as versions,
         (select count(*)::text from learning_progress.item_completions
           where student_id = $1 and workspace_id = $2) as completions,
         (select ciphertext from intake.intake_record_versions
           where student_id = $1 and workspace_id = $2 limit 1) as version_ciphertext`,
      [studentId, workspaceId],
    );
    return result.rows[0]!;
  } finally {
    await owner.end();
  }
}

async function depart(studentId: string) {
  const client = createApiClient(baseUrl);
  const result = await client.POST(
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
  const client = createApiClient(baseUrl);
  const result = await client.POST(
    '/api/v1/administration/students/record-disposition-notices',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: { operationId: crypto.randomUUID(), studentId },
    },
  );
  expect(result.response.status).toBe(200);
}

async function completeCopyOpportunity(studentId: string) {
  const client = createApiClient(baseUrl);
  const result = await client.POST(
    '/api/v1/administration/students/record-disposition-copy-opportunities',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: { operationId: crypto.randomUUID(), studentId },
    },
  );
  expect(result.response.status).toBe(200);
}

async function openAuthorizedDispositionCase(studentId: string) {
  const client = createApiClient(baseUrl);
  const opened = await client.POST(
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
  const decided = await client.POST(
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

async function prepareSchedulable(input: {
  recipient: string;
  code: string;
  withLocations?: boolean;
}) {
  const seeded = await seedStudent({
    recipient: input.recipient,
    code: input.code,
  });
  const locations = input.withLocations
    ? await insertOwnedLocations(seeded.studentId)
    : undefined;
  await depart(seeded.studentId);
  const caseId = await openAuthorizedDispositionCase(seeded.studentId);
  await completeNotice(seeded.studentId);
  await completeCopyOpportunity(seeded.studentId);
  return { ...seeded, caseId, locations };
}

async function scheduleDisposition(input: {
  studentId: string;
  caseId: string;
  operationId?: string;
  confirmation?: 'schedule_destruction';
  cookie?: string;
}) {
  const client = createApiClient(baseUrl);
  return client.POST('/api/v1/administration/students/record-dispositions', {
    headers: {
      ...mutationHeaders,
      cookie: input.cookie ?? staffCookie(),
    },
    body: {
      operationId: input.operationId ?? crypto.randomUUID(),
      studentId: input.studentId,
      caseId: input.caseId,
      confirmation: input.confirmation ?? 'schedule_destruction',
    },
  });
}

async function readGovernance(studentId: string) {
  const client = createApiClient(baseUrl);
  const listing = await client.GET(
    '/api/v1/administration/students/records-governance',
    { headers: { cookie: staffCookie() } },
  );
  expect(listing.response.status).toBe(200);
  expect(listing.response.headers.get('cache-control')).toBe('no-store');
  return listing.data!.students.find((row) => row.studentId === studentId);
}

beforeAll(async () => {
  postgres = await startEphemeralPostgres();
  await migrate(postgres.connectionString);
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(
      `insert into identity_access.school_workspaces values
       ($1, 'Disposition School', $2, 'school', 'school_administrative', 'school_workspace')`,
      [workspaceId, now],
    );
    await owner.query(
      `insert into identity_access.staff_identities values
       ($1, $2, 'Riley Nash', 'administrator.disposition@example.test', $3, 'active',
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
       ($1, 'Other Disposition School', $2, 'school', 'school_administrative', 'school_workspace')`,
      [otherWorkspaceId, now],
    );
    await owner.query(
      `insert into identity_access.staff_identities values
       ($1, $2, 'Other Admin', 'other.disposition@example.test', $3, 'active',
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

test('missing policy, departure, Hold, notice, copy opportunity, or authority blocks scheduling', async () => {
  const { studentId } = await seedStudent({
    recipient: 'blocked.prereq@example.edu',
    code: '610201',
  });
  const scheduledWithoutFacts = await scheduleDisposition({
    studentId,
    caseId: crypto.randomUUID(),
  });
  expect(scheduledWithoutFacts.response.status).toBe(409);
  const blocked = scheduledWithoutFacts.error as {
    code?: string;
    blockingReasons?: string[];
  };
  expect(blocked.code).toBe('RECORD_DISPOSITION_NOT_SCHEDULABLE');
  expect(blocked.blockingReasons).toEqual([
    'missing_policy',
    'missing_student_departure',
    'incomplete_notice',
    'incomplete_copy_opportunity',
    'missing_structured_authority',
  ]);

  await depart(studentId);
  await completeNotice(studentId);
  const afterNotice = await scheduleDisposition({
    studentId,
    caseId: crypto.randomUUID(),
  });
  expect(
    (afterNotice.error as { blockingReasons?: string[] }).blockingReasons,
  ).toEqual([
    'missing_policy',
    'incomplete_copy_opportunity',
    'missing_structured_authority',
  ]);

  await completeCopyOpportunity(studentId);
  const caseId = await openAuthorizedDispositionCase(studentId);
  const client = createApiClient(baseUrl);
  const hold = await client.POST(
    '/api/v1/administration/students/record-holds',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId,
        reason: 'school_preservation',
      },
    },
  );
  expect(hold.response.status).toBe(200);
  const blockedByHold = await scheduleDisposition({ studentId, caseId });
  expect(blockedByHold.response.status).toBe(409);
  expect(
    (blockedByHold.error as { blockingReasons?: string[] }).blockingReasons,
  ).toEqual(['open_hold']);

  const directory = await readGovernance(studentId);
  expect(directory?.dispositionPrerequisites.blockingReasons).toEqual([
    'open_hold',
  ]);
  expect(directory?.dispositions).toEqual([]);
});

test('an authorized disposition observes the seven-day window and cancellation keeps the bundle intact', async () => {
  const prepared = await prepareSchedulable({
    recipient: 'cancel.window@example.edu',
    code: '610202',
    withLocations: true,
  });
  const scheduledAt = now;
  const scheduled = await scheduleDisposition({
    studentId: prepared.studentId,
    caseId: prepared.caseId,
  });
  expect(scheduled.response.status).toBe(200);
  expect(scheduled.data?.outcome).toBe('scheduled');
  const dispositionId = scheduled.data!.dispositionId;
  const replay = await scheduleDisposition({
    studentId: prepared.studentId,
    caseId: prepared.caseId,
    operationId: scheduled.data!.operationId,
  });
  expect(replay.response.status).toBe(200);
  expect(replay.data?.dispositionId).toBe(dispositionId);

  const beforeWindowEnd = new Date(
    scheduledAt.getTime() + cancellationWindowMs - 1,
  );
  await advanceTrustedTime(beforeWindowEnd);
  const early = await createApiClient(baseUrl).POST(
    '/api/v1/administration/students/record-disposition-executions',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        dispositionId,
        expectedVersion: 1,
        confirmation: 'execute_destruction',
      },
    },
  );
  expect(early.response.status).toBe(409);
  expect((early.error as { code?: string }).code).toBe(
    'RECORD_DISPOSITION_CANCELLATION_WINDOW_OPEN',
  );

  const cancelled = await createApiClient(baseUrl).POST(
    '/api/v1/administration/students/record-disposition-cancellations',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        dispositionId,
        expectedVersion: 1,
      },
    },
  );
  expect(cancelled.response.status).toBe(200);
  expect(cancelled.data?.outcome).toBe('cancelled');
  const cancelReplay = await createApiClient(baseUrl).POST(
    '/api/v1/administration/students/record-disposition-cancellations',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: cancelled.data!.operationId,
        dispositionId,
        expectedVersion: 1,
      },
    },
  );
  expect(cancelReplay.response.status).toBe(200);
  expect(cancelReplay.data?.outcome).toBe('cancelled');

  const locations = await countOwnedLocations(prepared.studentId);
  expect(locations.emails).toBe('1');
  expect(locations.versions).toBe('1');
  expect(locations.version_ciphertext).toBe('sealed-intake-answers');
  expect(locations.completions).toBe('1');
  expect(locations.drafts).toBe('1');

  const row = await readGovernance(prepared.studentId);
  expect(row?.dispositions[0]?.status).toBe('cancelled');
  expect(row?.dispositions[0]?.purgeManifest).toEqual([]);
  expect(
    (row as { destructionCertificate?: unknown } | undefined)
      ?.destructionCertificate,
  ).toBeUndefined();
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    const events = await owner.query<{ event_kind: string }>(
      `select event_kind from records_governance.record_disposition_events
        where disposition_id = $1 order by sequence`,
      [dispositionId],
    );
    expect(events.rows.map((event) => event.event_kind)).toEqual([
      'scheduled',
      'cancelled',
    ]);
  } finally {
    await owner.end();
  }
});

test('execution after the seven-day boundary purges owned locations and records a non-sensitive manifest', async () => {
  const prepared = await prepareSchedulable({
    recipient: 'purge.success@example.edu',
    code: '610203',
    withLocations: true,
  });
  const scheduled = await scheduleDisposition({
    studentId: prepared.studentId,
    caseId: prepared.caseId,
  });
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
  expect(executed.data?.outcome).not.toBe('certified');

  const locations = await countOwnedLocations(prepared.studentId);
  expect(locations.emails).toBe('0');
  expect(locations.sessions).toBe('0');
  expect(locations.memberships).toBe('0');
  expect(locations.drafts).toBe('0');
  expect(locations.versions).toBe('0');
  expect(locations.completions).toBe('0');

  const row = await readGovernance(prepared.studentId);
  expect(row?.dispositions[0]?.status).toBe('purged');
  const manifest = row?.dispositions[0]?.purgeManifest ?? [];
  expect(manifest.map((entry) => entry.adapter).sort()).toEqual([
    'clinical_access_evidence',
    'identity_access',
    'intake',
    'learning_progress',
    'memberships',
    'productions',
    'projections',
  ]);
  for (const entry of manifest) {
    expect(entry.status).toBe('purged');
    expect(entry.verification).toBe('verified');
    expect(JSON.stringify(entry)).not.toContain('sealed-intake-answers');
    expect(JSON.stringify(entry)).not.toContain('purge.success@example.edu');
  }
  expect(row?.dispositions[0]?.destructionCertificate).toBeUndefined();
  expect(
    await fetch(
      `${baseUrl}/api/v1/administration/students/record-destruction-certificates`,
      { headers: { cookie: staffCookie() } },
    ).then((response) => response.status),
  ).toBe(404);
});

test('partial adapter failure stays repairable and cannot succeed or certify prematurely', async () => {
  const prepared = await prepareSchedulable({
    recipient: 'partial.fail@example.edu',
    code: '610204',
    withLocations: true,
  });
  const scheduled = await scheduleDisposition({
    studentId: prepared.studentId,
    caseId: prepared.caseId,
  });
  expect(scheduled.response.status).toBe(200);
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(`
      create function intake.test_fail_disposition_purge() returns trigger
      language plpgsql as $$
      begin
        raise exception 'forced intake disposition adapter failure';
      end;
      $$;
      create trigger test_fail_disposition_purge
      before delete on intake.intake_record_versions
      for each row execute function intake.test_fail_disposition_purge();
    `);
  } finally {
    await owner.end();
  }
  await advanceTrustedTime(new Date(now.getTime() + cancellationWindowMs));
  const failed = await createApiClient(baseUrl).POST(
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
  expect(failed.response.status).toBe(200);
  expect(failed.data?.outcome).toBe('failed');
  const incomplete = await readGovernance(prepared.studentId);
  expect(incomplete?.dispositions[0]?.status).toBe('failed');
  const intakeTask = incomplete?.dispositions[0]?.purgeManifest.find(
    (entry) => entry.adapter === 'intake',
  );
  expect(intakeTask?.status).toBe('failed');
  expect(
    incomplete?.dispositions[0]?.purgeManifest.some(
      (entry) => entry.status === 'purged',
    ),
  ).toBe(true);
  const stillPresent = await countOwnedLocations(prepared.studentId);
  expect(stillPresent.versions).toBe('1');
  expect(stillPresent.version_ciphertext).toBe('sealed-intake-answers');

  const ownerCleanup = new Client({
    connectionString: postgres.connectionString,
  });
  await ownerCleanup.connect();
  try {
    await ownerCleanup.query(`
      drop trigger test_fail_disposition_purge on intake.intake_record_versions;
      drop function intake.test_fail_disposition_purge();
    `);
  } finally {
    await ownerCleanup.end();
  }

  const retried = await createApiClient(baseUrl).POST(
    '/api/v1/administration/students/record-disposition-retries',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        dispositionId: scheduled.data!.dispositionId,
        expectedVersion: incomplete!.dispositions[0]!.version,
        confirmation: 'execute_destruction',
      },
    },
  );
  expect(retried.response.status).toBe(200);
  expect(retried.data?.outcome).toBe('purged');
  const repaired = await countOwnedLocations(prepared.studentId);
  expect(repaired.versions).toBe('0');
  expect(repaired.drafts).toBe('0');
  const done = await readGovernance(prepared.studentId);
  expect(done?.dispositions[0]?.status).toBe('purged');
  expect(
    done?.dispositions[0]?.purgeManifest.every(
      (entry) => entry.status === 'purged',
    ),
  ).toBe(true);
});

test('disposition scheduling is workspace-isolated and concurrent cancel uses the expected version', async () => {
  const prepared = await prepareSchedulable({
    recipient: 'isolation.version@example.edu',
    code: '610205',
  });
  const denied = await scheduleDisposition({
    studentId: prepared.studentId,
    caseId: prepared.caseId,
    cookie: staffCookie(otherSessionHandle),
  });
  expect(denied.response.status).toBe(404);

  const scheduled = await scheduleDisposition({
    studentId: prepared.studentId,
    caseId: prepared.caseId,
  });
  expect(scheduled.response.status).toBe(200);
  const first = await createApiClient(baseUrl).POST(
    '/api/v1/administration/students/record-disposition-cancellations',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        dispositionId: scheduled.data!.dispositionId,
        expectedVersion: 1,
      },
    },
  );
  expect(first.response.status).toBe(200);
  const stale = await createApiClient(baseUrl).POST(
    '/api/v1/administration/students/record-disposition-cancellations',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        dispositionId: scheduled.data!.dispositionId,
        expectedVersion: 1,
      },
    },
  );
  expect(stale.response.status).toBe(409);
  expect((stale.error as { code?: string }).code).toBe(
    'RECORD_DISPOSITION_VERSION_CONFLICT',
  );
});

test('open access cases still work after scheduling and Holds remain the destruction gate', async () => {
  const prepared = await prepareSchedulable({
    recipient: 'hold.unaffected@example.edu',
    code: '610206',
  });
  const scheduled = await scheduleDisposition({
    studentId: prepared.studentId,
    caseId: prepared.caseId,
  });
  expect(scheduled.response.status).toBe(200);
  const opened = await createApiClient(baseUrl).POST(
    '/api/v1/administration/students/record-lifecycle-cases',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId: prepared.studentId,
        caseType: 'access',
        requestCode: 'lawful_access',
        requesterKind: 'parent_guardian',
        authorityKind: 'school_administrator',
        scope: { portions: ['intake'], purpose: 'lawful_access' },
        deadlineAt: '2026-09-30T00:00:00.000Z',
      },
    },
  );
  expect(opened.response.status).toBe(200);
  await advanceTrustedTime(new Date(now.getTime() + cancellationWindowMs));
  const blockedExecute = await createApiClient(baseUrl).POST(
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
  expect(blockedExecute.response.status).toBe(409);
  expect((blockedExecute.error as { code?: string }).code).toBe(
    'RECORD_DISPOSITION_NOT_EXECUTABLE',
  );
  const row = await readGovernance(prepared.studentId);
  expect(row?.destructionEligibility).toBe('blocked_by_hold');
  expect(row?.dispositions[0]?.status).toBe('scheduled');
});
