import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
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

const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8001';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8002';
const otherWorkspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8003';
const otherStaffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8004';
const otherSessionHandle = 'opaque-other-administrator-session-handle';
const classId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8005';
const pendingClassId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8006';
const sessionHandle = 'opaque-administrator-session-handle';
const invitationCode = '729104';
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

async function markSignInDelivered() {
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(
      `update identity_access.sign_in_deliveries
          set status = 'delivered', delivered_at = $1
        where status in ('pending', 'sending')`,
      [now],
    );
  } finally {
    await owner.end();
  }
}

async function createClassInvitation(input: {
  classId: string;
  name: string;
  invitationId?: string;
  recipient: string;
  code?: string;
}) {
  const invitationId = input.invitationId ?? crypto.randomUUID();
  generatedCode = input.code ?? invitationCode;
  const created = await fetch(`${baseUrl}/api/v1/administration/classes`, {
    method: 'POST',
    headers: { ...mutationHeaders, cookie: staffCookie() },
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      classId: input.classId,
      invitationId,
      name: input.name,
      recipient: input.recipient,
    }),
  });
  generatedCode = invitationCode;
  expect(created.status).toBe(201);
  await markInvitationDelivered(invitationId);
  return invitationId;
}

async function redeemInvitation(input: { recipient: string; code?: string }) {
  return fetch(`${baseUrl}/api/v1/auth/student/invitations/redeem`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({
      recipient: input.recipient,
      code: input.code ?? invitationCode,
    }),
  });
}

async function seedStudent(input: {
  classId: string;
  name: string;
  recipient: string;
  code: string;
  pending?: { classId: string; name: string; code: string };
}) {
  await createClassInvitation({
    classId: input.classId,
    name: input.name,
    recipient: input.recipient,
    code: input.code,
  });
  const joined = await redeemInvitation({
    recipient: input.recipient,
    code: input.code,
  });
  expect(joined.status).toBe(200);
  const sessionCookie = studentSessionCookie(joined);
  const access = (await (
    await fetch(`${baseUrl}/api/v1/student/session`, {
      headers: { cookie: sessionCookie },
    })
  ).json()) as { studentId: string };
  if (input.pending) {
    await createClassInvitation({
      classId: input.pending.classId,
      name: input.pending.name,
      recipient: input.recipient,
      code: input.pending.code,
    });
  }
  return { studentId: access.studentId, sessionCookie };
}

async function insertBundleRows(studentId: string) {
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

beforeAll(async () => {
  postgres = await startEphemeralPostgres();
  await migrate(postgres.connectionString);
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(
      `insert into identity_access.school_workspaces values
       ($1, 'Franklin Middle School', $2, 'school', 'school_administrative', 'school_workspace')`,
      [workspaceId, now],
    );
    await owner.query(
      `insert into identity_access.staff_identities values
       ($1, $2, 'Marcus Chen', 'administrator@example.test', $3, 'active',
        'principal', 'test setup', $4, 'school', 'school_administrative', 'staff_identity')`,
      [staffIdentityId, workspaceId, crypto.randomUUID(), now],
    );
    await owner.query(
      `insert into identity_access.staff_permission_grants values
       ($1, $2, 'administrative', $3, 'test setup', 'school',
        'school_administrative', 'staff_permission_grant')`,
      [workspaceId, staffIdentityId, now],
    );
    await owner.query(
      `insert into identity_access.staff_permission_grants values
       ($1, $2, 'clinical', $3, 'test setup', 'school',
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
       ($1, 'Other School', $2, 'school', 'school_administrative', 'school_workspace')`,
      [otherWorkspaceId, now],
    );
    await owner.query(
      `insert into identity_access.staff_identities values
       ($1, $2, 'Other Admin', 'other.admin@example.test', $3, 'active',
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

test('Student Departure is an explicit audited fact that revokes access without deleting the Student Record Bundle', async () => {
  const client = createApiClient(baseUrl);
  const operationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8101';
  const address = 'departed.student@example.edu';
  const { studentId, sessionCookie } = await seedStudent({
    classId,
    name: 'Health Literacy 7A',
    recipient: address,
    code: '246801',
    pending: {
      classId: pendingClassId,
      name: 'Spring Wellness',
      code: '910327',
    },
  });
  const bundle = await insertBundleRows(studentId);

  generatedCode = '555111';
  expect(
    (
      await fetch(`${baseUrl}/api/v1/auth/student/sign-in`, {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({ recipient: address }),
      })
    ).status,
  ).toBe(200);
  generatedCode = invitationCode;
  await markSignInDelivered();

  const departed = await client.POST(
    '/api/v1/administration/students/departures',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId,
        studentId,
        reason: 'transferred',
        effectiveOn: '2026-06-12',
      },
    },
  );
  expect(departed.response.status).toBe(200);
  expect(departed.data).toEqual({
    operationId,
    studentId,
    outcome: 'departed',
  });

  const replayed = await client.POST(
    '/api/v1/administration/students/departures',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId,
        studentId,
        reason: 'transferred',
        effectiveOn: '2026-06-12',
      },
    },
  );
  expect(replayed.response.status).toBe(200);
  expect(replayed.data).toEqual(departed.data);

  expect(
    (
      await fetch(`${baseUrl}/api/v1/student/session`, {
        headers: { cookie: sessionCookie },
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(`${baseUrl}/api/v1/auth/student/sign-in/verify`, {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({ recipient: address, code: '555111' }),
      })
    ).status,
  ).toBe(401);
  expect(
    (await redeemInvitation({ recipient: address, code: '910327' })).status,
  ).toBe(401);

  generatedCode = '666000';
  now = new Date(now.getTime() + 61 * 1000);
  const requested = await fetch(`${baseUrl}/api/v1/auth/student/sign-in`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ recipient: address }),
  });
  generatedCode = invitationCode;
  expect(requested.status).toBe(200);
  await markSignInDelivered();
  expect(
    (
      await fetch(`${baseUrl}/api/v1/auth/student/sign-in/verify`, {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({ recipient: address, code: '666000' }),
      })
    ).status,
  ).toBe(401);

  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: staffCookie() },
  });
  const relationship = directory.data?.classes
    .find((entry) => entry.classId === classId)
    ?.relationships.find((entry) => entry.studentId === studentId);
  expect(relationship?.studentAccessStatus).toBe('active');
  expect(relationship?.studentPresence).toBe('departed');
  expect(relationship?.membershipStatus).toBe('inactive');
  expect(relationship?.currentVerifiedEmail).toBe(address);
  const pending = directory.data?.classes
    .find((entry) => entry.classId === pendingClassId)
    ?.relationships.find((entry) => entry.recipient === address);
  expect(pending?.latestInvitation.status).toBe('superseded');

  const closed = await client.POST('/api/v1/administration/classes/closures', {
    headers: { ...mutationHeaders, cookie: staffCookie() },
    body: { operationId: crypto.randomUUID(), classId },
  });
  expect(closed.response.status).toBe(200);
  const afterClose = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: staffCookie() },
  });
  const closedRow = afterClose.data?.classes
    .find((entry) => entry.classId === classId)
    ?.relationships.find((entry) => entry.studentId === studentId);
  expect(closedRow?.studentPresence).toBe('departed');
  expect(closedRow?.studentAccessStatus).toBe('active');

  const clinical = await client.GET('/api/v1/clinical/review-directory', {
    headers: { cookie: staffCookie() },
  });
  expect(
    clinical.data?.students.some((student) => student.studentId === studentId),
  ).toBe(true);

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const records = await inspection.query<{
      presence: string;
      status: string;
      memberships: string;
      inactive_memberships: string;
      live_sessions: string;
      intake_versions: string;
      item_completions: string;
      event_type: string;
      details: unknown;
    }>(
      `select student.presence, student.status,
              (select count(*) from identity_access.class_memberships
                where student_id = $1)::text as memberships,
              (select count(*) from identity_access.class_memberships
                where student_id = $1 and status = 'inactive')::text as inactive_memberships,
              (select count(*) from identity_access.student_sessions
                where student_id = $1 and revoked_at is null)::text as live_sessions,
              (select count(*) from intake.intake_record_versions
                where student_id = $1)::text as intake_versions,
              (select count(*) from learning_progress.item_completions
                where student_id = $1)::text as item_completions,
              audit.event_type, audit.details
         from identity_access.students student
         join audit.evidence audit on audit.operation_id = $2
        where student.student_id = $1`,
      [studentId, operationId],
    );
    expect(records.rows).toEqual([
      {
        presence: 'departed',
        status: 'active',
        memberships: '1',
        inactive_memberships: '1',
        live_sessions: '0',
        intake_versions: '1',
        item_completions: '1',
        event_type: 'student_departure.recorded',
        details: {
          studentId,
          reason: 'transferred',
          effectiveOn: '2026-06-12',
          revokedSessionCount: 1,
          supersededInvitationCount: 1,
          deactivatedMembershipCount: 1,
        },
      },
    ]);
    expect(JSON.stringify(records.rows)).not.toContain(address);
    expect(JSON.stringify(records.rows)).not.toContain('555111');
    expect(JSON.stringify(records.rows)).not.toContain('sealed-intake-answers');
    const facts = await inspection.query<{ kind: string }>(
      `select kind from records_governance.student_departure_facts
        where student_id = $1 order by sequence`,
      [studentId],
    );
    expect(facts.rows).toEqual([{ kind: 'departed' }]);
    const intact = await inspection.query<{ exists: boolean }>(
      `select exists(select 1 from intake.intake_record_versions
                      where intake_record_version_id = $1)
              and exists(select 1 from learning_progress.item_completions
                      where item_completion_id = $2) as exists`,
      [bundle.intakeId, bundle.completionId],
    );
    expect(intact.rows[0]?.exists).toBe(true);
  } finally {
    await inspection.end();
  }
});

test('Student Departure reversal records a new fact and silently revives no access', async () => {
  const client = createApiClient(baseUrl);
  const address = 'reversed.student@example.edu';
  const { studentId, sessionCookie } = await seedStudent({
    classId: crypto.randomUUID(),
    name: 'Reversal Class',
    recipient: address,
    code: '111000',
    pending: {
      classId: crypto.randomUUID(),
      name: 'Pending Reversal Class',
      code: '111001',
    },
  });
  generatedCode = '111002';
  await fetch(`${baseUrl}/api/v1/auth/student/sign-in`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ recipient: address }),
  });
  generatedCode = invitationCode;
  await markSignInDelivered();

  await client.POST('/api/v1/administration/students/departures', {
    headers: { ...mutationHeaders, cookie: staffCookie() },
    body: {
      operationId: crypto.randomUUID(),
      studentId,
      reason: 'graduated',
      effectiveOn: '2026-05-01',
    },
  });
  const reversalId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8102';
  const reversed = await client.POST(
    '/api/v1/administration/students/departure-reversals',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: { operationId: reversalId, studentId },
    },
  );
  expect(reversed.response.status).toBe(200);
  expect(reversed.data).toEqual({
    operationId: reversalId,
    studentId,
    outcome: 'reversed',
  });

  expect(
    (
      await fetch(`${baseUrl}/api/v1/student/session`, {
        headers: { cookie: sessionCookie },
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(`${baseUrl}/api/v1/auth/student/sign-in/verify`, {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({ recipient: address, code: '111002' }),
      })
    ).status,
  ).toBe(401);
  expect(
    (await redeemInvitation({ recipient: address, code: '111001' })).status,
  ).toBe(401);

  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: staffCookie() },
  });
  const relationship = directory.data?.classes
    .flatMap((entry) => entry.relationships)
    .find((entry) => entry.studentId === studentId);
  expect(relationship?.studentPresence).toBe('enrolled');
  expect(relationship?.membershipStatus).toBe('inactive');
  expect(relationship?.studentAccessStatus).toBe('active');

  generatedCode = '111003';
  now = new Date(now.getTime() + 61 * 1000);
  const requested = await fetch(`${baseUrl}/api/v1/auth/student/sign-in`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ recipient: address }),
  });
  generatedCode = invitationCode;
  expect(requested.status).toBe(200);
  await markSignInDelivered();
  const restored = await fetch(
    `${baseUrl}/api/v1/auth/student/sign-in/verify`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ recipient: address, code: '111003' }),
    },
  );
  expect(restored.status).toBe(200);
  const restoredSession = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie: studentSessionCookie(restored) },
  });
  expect(restoredSession.status).toBe(200);
  expect(
    ((await restoredSession.json()) as { studentId: string }).studentId,
  ).toBe(studentId);
  expect(restoredSession.status).toBe(200);

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const facts = await inspection.query<{ kind: string }>(
      `select kind from records_governance.student_departure_facts
        where student_id = $1 order by sequence`,
      [studentId],
    );
    expect(facts.rows.map((row) => row.kind)).toEqual(['departed', 'reversed']);
    expect(
      (
        await inspection.query(
          `select event_type from audit.evidence where operation_id = $1`,
          [reversalId],
        )
      ).rows,
    ).toEqual([{ event_type: 'student_departure.reversed' }]);
  } finally {
    await inspection.end();
  }
});

test('Student Departure is distinct from Disablement and is denied across workspaces', async () => {
  const client = createApiClient(baseUrl);
  const address = 'distinct.student@example.edu';
  const { studentId } = await seedStudent({
    classId: crypto.randomUUID(),
    name: 'Distinct Class',
    recipient: address,
    code: '222000',
  });
  await client.POST('/api/v1/administration/students/disablements', {
    headers: { ...mutationHeaders, cookie: staffCookie() },
    body: {
      operationId: crypto.randomUUID(),
      studentId,
      reason: 'school_directed',
    },
  });
  const departed = await client.POST(
    '/api/v1/administration/students/departures',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId,
        reason: 'withdrew',
        effectiveOn: '2026-04-01',
      },
    },
  );
  expect(departed.response.status).toBe(200);

  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: staffCookie() },
  });
  const relationship = directory.data?.classes
    .flatMap((entry) => entry.relationships)
    .find((entry) => entry.studentId === studentId);
  expect(relationship?.studentAccessStatus).toBe('disabled');
  expect(relationship?.studentPresence).toBe('departed');
  expect(relationship?.membershipStatus).toBe('inactive');

  const conflict = await client.POST(
    '/api/v1/administration/students/departures',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId,
        reason: 'transferred',
        effectiveOn: '2026-04-02',
      },
    },
  );
  expect(conflict.response.status).toBe(409);
  expect(conflict.error).toMatchObject({ code: 'STUDENT_ALREADY_DEPARTED' });

  const denied = await client.POST(
    '/api/v1/administration/students/departures',
    {
      headers: { ...mutationHeaders, cookie: staffCookie(otherSessionHandle) },
      body: {
        operationId: crypto.randomUUID(),
        studentId,
        reason: 'transferred',
        effectiveOn: '2026-04-03',
      },
    },
  );
  expect(denied.response.status).toBe(404);
  expect(denied.error).toMatchObject({ code: 'STUDENT_NOT_FOUND' });
});

test('Record Lifecycle Cases preserve request, authority, scope, deadline, decision, and outcome under the policy revision', async () => {
  const client = createApiClient(baseUrl);
  const address = 'cases.student@example.edu';
  const { studentId } = await seedStudent({
    classId: crypto.randomUUID(),
    name: 'Cases Class',
    recipient: address,
    code: '333000',
  });
  const openId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8201';
  const opened = await client.POST(
    '/api/v1/administration/students/record-lifecycle-cases',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: openId,
        studentId,
        caseType: 'access',
        requestCode: 'lawful_access',
        requesterKind: 'legal_custodian',
        authorityKind: 'school_administrator',
        scope: {
          portions: ['identity', 'intake'],
          purpose: 'lawful_access',
        },
        deadlineAt: '2026-09-30T00:00:00.000Z',
      },
    },
  );
  expect(opened.response.status).toBe(200);
  expect(opened.data).toMatchObject({
    operationId: openId,
    studentId,
    outcome: 'opened',
    caseType: 'access',
  });
  expect(opened.data?.caseId).toBeString();
  expect(opened.data?.policyRevisionId).toBeString();
  expect(JSON.stringify(opened.data)).not.toContain(address);

  const mismatch = await client.POST(
    '/api/v1/administration/students/record-lifecycle-cases',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId,
        caseType: 'access',
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
  expect(mismatch.response.status).toBe(409);
  expect(mismatch.error).toMatchObject({
    code: 'RECORD_LIFECYCLE_CASE_REQUEST_MISMATCH',
  });

  const tooSoon = await client.POST(
    '/api/v1/administration/students/record-lifecycle-case-outcomes',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        caseId: opened.data!.caseId,
        outcome: 'completed',
      },
    },
  );
  expect(tooSoon.response.status).toBe(409);
  expect(tooSoon.error).toMatchObject({
    code: 'RECORD_LIFECYCLE_CASE_DECISION_REQUIRED',
  });

  const listing = await client.GET(
    '/api/v1/administration/students/records-governance',
    { headers: { cookie: staffCookie() } },
  );
  expect(listing.response.status).toBe(200);
  const row = listing.data?.students.find(
    (student) => student.studentId === studentId,
  );
  expect(row?.cases).toEqual([
    expect.objectContaining({
      caseId: opened.data?.caseId,
      caseType: 'access',
      requestCode: 'lawful_access',
      requesterKind: 'legal_custodian',
      authorityKind: 'school_administrator',
      scope: { portions: ['identity', 'intake'], purpose: 'lawful_access' },
      deadlineAt: '2026-09-30T00:00:00.000Z',
      decision: 'pending',
      outcome: 'open',
      policyRevisionId: opened.data?.policyRevisionId,
    }),
  ]);
  expect(row?.holds).toEqual([
    expect.objectContaining({
      source: 'automatic_access_case',
      status: 'active',
      caseId: opened.data?.caseId,
    }),
  ]);
  expect(row?.destructionEligibility).toBe('blocked_by_hold');
  expect(JSON.stringify(listing.data)).not.toMatch(
    /ciphertext|sealed-intake|itemCompletion/i,
  );
  expect(JSON.stringify(listing.data)).not.toContain(address);

  const decided = await client.POST(
    '/api/v1/administration/students/record-lifecycle-case-decisions',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8202',
        caseId: opened.data!.caseId,
        decision: 'authorized',
      },
    },
  );
  expect(decided.response.status).toBe(200);
  const completed = await client.POST(
    '/api/v1/administration/students/record-lifecycle-case-outcomes',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8203',
        caseId: opened.data!.caseId,
        outcome: 'completed',
      },
    },
  );
  expect(completed.response.status).toBe(200);

  const after = await client.GET(
    '/api/v1/administration/students/records-governance',
    { headers: { cookie: staffCookie() } },
  );
  const closed = after.data?.students.find(
    (student) => student.studentId === studentId,
  );
  expect(closed?.cases[0]).toMatchObject({
    decision: 'authorized',
    outcome: 'completed',
  });
  expect(closed?.holds[0]?.status).toBe('released');
  expect(closed?.destructionEligibility).toBe('not_eligible');

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const events = await inspection.query<{ event_kind: string }>(
      `select event_kind from records_governance.record_lifecycle_case_events
        where case_id = $1 order by sequence`,
      [opened.data!.caseId],
    );
    expect(events.rows.map((row) => row.event_kind)).toEqual([
      'opened',
      'decided',
      'outcome_recorded',
    ]);
    const policy = await inspection.query<{ revision_number: string }>(
      `select revision_number::text from records_governance.records_policy_revisions
        where policy_revision_id = $1`,
      [opened.data!.policyRevisionId],
    );
    expect(policy.rows).toEqual([{ revision_number: '1' }]);
  } finally {
    await inspection.end();
  }
});

test('Record Holds block destruction eligibility without denying authorized clinical location or new cases', async () => {
  const client = createApiClient(baseUrl);
  const address = 'holds.student@example.edu';
  const { studentId } = await seedStudent({
    classId: crypto.randomUUID(),
    name: 'Holds Class',
    recipient: address,
    code: '444000',
  });
  await client.POST('/api/v1/administration/students/departures', {
    headers: { ...mutationHeaders, cookie: staffCookie() },
    body: {
      operationId: crypto.randomUUID(),
      studentId,
      reason: 'transferred',
      effectiveOn: '2026-03-01',
    },
  });
  const eligible = await client.GET(
    '/api/v1/administration/students/records-governance',
    { headers: { cookie: staffCookie() } },
  );
  expect(
    eligible.data?.students.find((student) => student.studentId === studentId)
      ?.destructionEligibility,
  ).toBe('eligible_after_departure');

  const hold = await client.POST(
    '/api/v1/administration/students/record-holds',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8301',
        studentId,
        reason: 'school_preservation',
      },
    },
  );
  expect(hold.response.status).toBe(200);
  expect(hold.data).toMatchObject({
    operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8301',
    studentId,
    outcome: 'established',
  });

  const blocked = await client.GET(
    '/api/v1/administration/students/records-governance',
    { headers: { cookie: staffCookie() } },
  );
  const row = blocked.data?.students.find(
    (student) => student.studentId === studentId,
  );
  expect(row?.destructionEligibility).toBe('blocked_by_hold');
  expect(row?.presence).toBe('departed');

  const amendment = await client.POST(
    '/api/v1/administration/students/record-lifecycle-cases',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId,
        caseType: 'amendment',
        requestCode: 'amendment_challenge',
        requesterKind: 'parent_guardian',
        authorityKind: 'school_administrator',
        scope: {
          portions: ['intake'],
          purpose: 'amendment_challenge',
        },
        deadlineAt: '2026-10-15T00:00:00.000Z',
      },
    },
  );
  expect(amendment.response.status).toBe(200);
  expect(amendment.data?.caseType).toBe('amendment');

  const withAutomatic = await client.GET(
    '/api/v1/administration/students/records-governance',
    { headers: { cookie: staffCookie() } },
  );
  const automaticHold = withAutomatic.data?.students
    .find((student) => student.studentId === studentId)
    ?.holds.find((item) => item.source === 'automatic_amendment_case');
  expect(automaticHold?.status).toBe('active');
  const refusedAutomatic = await client.POST(
    '/api/v1/administration/students/record-hold-releases',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        holdId: automaticHold!.holdId,
      },
    },
  );
  expect(refusedAutomatic.response.status).toBe(409);
  expect(refusedAutomatic.error).toMatchObject({
    code: 'RECORD_HOLD_NOT_RELEASABLE',
  });

  const clinical = await client.GET('/api/v1/clinical/review-directory', {
    headers: { cookie: staffCookie() },
  });
  expect(
    clinical.data?.students.some((student) => student.studentId === studentId),
  ).toBe(true);

  const released = await client.POST(
    '/api/v1/administration/students/record-hold-releases',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        holdId: hold.data!.holdId,
      },
    },
  );
  expect(released.response.status).toBe(200);

  const afterRelease = await client.GET(
    '/api/v1/administration/students/records-governance',
    { headers: { cookie: staffCookie() } },
  );
  const later = afterRelease.data?.students.find(
    (student) => student.studentId === studentId,
  );
  expect(later?.holds.some((item) => item.status === 'active')).toBe(true);
  expect(later?.destructionEligibility).toBe('blocked_by_hold');
});

test('a failed Student Departure commits none of the access side effects', async () => {
  const client = createApiClient(baseUrl);
  const address = 'atomic.student@example.edu';
  const { studentId, sessionCookie } = await seedStudent({
    classId: crypto.randomUUID(),
    name: 'Atomic Class',
    recipient: address,
    code: '555000',
  });
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(`
      create function records_governance.test_fail_departure() returns trigger
      language plpgsql as $$
      begin
        raise exception 'forced departure failure';
      end;
      $$;
      create trigger test_fail_departure
      before insert on records_governance.student_departure_facts
      for each row execute function records_governance.test_fail_departure();
    `);
  } finally {
    await owner.end();
  }

  const failed = await client.POST(
    '/api/v1/administration/students/departures',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId,
        reason: 'withdrew',
        effectiveOn: '2026-02-01',
      },
    },
  );
  expect(failed.response.status).toBe(500);

  const cleanup = new Client({ connectionString: postgres.connectionString });
  await cleanup.connect();
  try {
    await cleanup.query(`
      drop trigger test_fail_departure on records_governance.student_departure_facts;
      drop function records_governance.test_fail_departure();
    `);
    const state = await cleanup.query<{
      presence: string;
      live_sessions: string;
    }>(
      `select student.presence,
              (select count(*) from identity_access.student_sessions
                where student_id = $1 and revoked_at is null)::text as live_sessions
         from identity_access.students student
        where student.student_id = $1`,
      [studentId],
    );
    expect(state.rows).toEqual([{ presence: 'enrolled', live_sessions: '1' }]);
  } finally {
    await cleanup.end();
  }

  expect(
    (
      await fetch(`${baseUrl}/api/v1/student/session`, {
        headers: { cookie: sessionCookie },
      })
    ).status,
  ).toBe(200);
});

test('Administrator workspace exposes Student Departure, cases, and Holds without clinical content', async () => {
  const workspace = await readFile(
    new URL('../../src/features/staff/ClassWorkspace.tsx', import.meta.url),
    'utf8',
  );
  const home = await readFile(
    new URL('../../src/features/staff/StaffHomePage.tsx', import.meta.url),
    'utf8',
  );
  const lifecycle = await readFile(
    new URL(
      '../../src/features/staff/StudentRecordLifecycleSection.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  expect(workspace).toContain('Record Student Departure');
  expect(workspace).toContain('Reverse Student Departure');
  expect(workspace).toContain(
    'This records that the Student transferred, graduated, or withdrew. Sessions and Sign-In Codes end. Pending Invitations are superseded. Class Memberships become inactive. The Student Record Bundle is kept. This is not Student Disablement or Class closure.',
  );
  expect(workspace).toContain(
    'This records that the Student did not leave. Prior sessions, Sign-In Codes, Invitations, and Class Memberships stay unusable. Restoration uses a new Invitation or Sign-In Code.',
  );
  expect(home).toContain('StudentRecordLifecycleSection');
  expect(lifecycle).toContain('Student Record Lifecycle');
  expect(lifecycle).toContain('Open Record Lifecycle Case');
  expect(lifecycle).toContain('Record Lifecycle Case Decision');
  expect(lifecycle).toContain('Record Lifecycle Case Outcome');
  expect(lifecycle).toContain('Establish Record Hold');
  expect(lifecycle).toContain('Release Record Hold');
  expect(lifecycle).toContain('blocked_by_hold');
  expect(lifecycle).not.toMatch(/clinical answer/i);
  expect(lifecycle).not.toContain('itemCompletion');
  expect(lifecycle).not.toContain('localStorage');
  expect(lifecycle).not.toContain('sessionStorage');
});
