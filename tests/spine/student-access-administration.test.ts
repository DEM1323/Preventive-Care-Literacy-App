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

const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf7001';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf7002';
const classId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf7003';
const pendingClassId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf7004';
const sessionHandle = 'opaque-administrator-session-handle';
const invitationCode = '729104';
let generatedCode = invitationCode;
let now = new Date('2026-08-26T18:00:00.000Z');
const mutationHeaders = {
  origin: 'http://127.0.0.1',
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;

let postgres: EphemeralPostgres;
let server: FastifyInstance;
let baseUrl: string;

function staffCookie() {
  return `__Host-prevcare-staff-session=${sessionHandle}`;
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

test('Verified Email Address replacement preserves the Student and revokes sessions, old-address codes, and pending Invitations', async () => {
  const client = createApiClient(baseUrl);
  const oldAddress = 'jordan.lee@example.edu';
  const newAddress = 'jordan.lee.restored@example.edu';
  await createClassInvitation({
    classId,
    name: 'Health Literacy 7A',
    invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf7101',
    recipient: oldAddress,
    code: '246801',
  });
  const joined = await redeemInvitation({
    recipient: oldAddress,
    code: '246801',
  });
  expect(joined.status).toBe(200);
  const sessionCookie = studentSessionCookie(joined);
  const session = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie: sessionCookie },
  });
  const access = (await session.json()) as { studentId: string };
  expect(access.studentId).toBeString();

  generatedCode = '555111';
  const signInRequested = await fetch(
    `${baseUrl}/api/v1/auth/student/sign-in`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ recipient: oldAddress }),
    },
  );
  generatedCode = invitationCode;
  expect(signInRequested.status).toBe(200);
  await markSignInDelivered();

  const pendingInvitationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf7102';
  await createClassInvitation({
    classId: pendingClassId,
    name: 'Spring Wellness',
    invitationId: pendingInvitationId,
    recipient: oldAddress,
    code: '910327',
  });

  const replacement = await client.POST(
    '/api/v1/administration/students/verified-email-replacements',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf7103',
        studentId: access.studentId,
        recipient: newAddress,
        reason: 'mailbox_loss',
        identityVerification: 'in_person_school_id',
      },
    },
  );
  expect(replacement.response.status).toBe(200);
  expect(replacement.data).toEqual({
    operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf7103',
    studentId: access.studentId,
    outcome: 'replaced',
  });

  const revokedSession = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie: sessionCookie },
  });
  expect(revokedSession.status).toBe(401);

  const oldCode = await fetch(`${baseUrl}/api/v1/auth/student/sign-in/verify`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ recipient: oldAddress, code: '555111' }),
  });
  expect(oldCode.status).toBe(401);

  const oldInvitation = await redeemInvitation({
    recipient: oldAddress,
    code: '910327',
  });
  expect(oldInvitation.status).toBe(401);

  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: staffCookie() },
  });
  const relationship = directory.data?.classes
    .find((entry) => entry.classId === classId)
    ?.relationships.find((entry) => entry.studentId === access.studentId);
  expect(relationship?.studentAccessStatus).toBe('active');
  expect(relationship?.currentVerifiedEmail).toBe(newAddress);
  expect(relationship?.identityCollision).toBe('historical_binding');
  expect(relationship?.membershipStatus).toBe('active');
  expect(relationship?.verifiedEmailHistory).toEqual([
    {
      recipient: newAddress,
      status: 'current',
      verifiedAt: now.toISOString(),
      retiredAt: null,
    },
    {
      recipient: oldAddress,
      status: 'historical',
      verifiedAt: now.toISOString(),
      retiredAt: now.toISOString(),
    },
  ]);
  const pending = directory.data?.classes
    .find((entry) => entry.classId === pendingClassId)
    ?.relationships.find((entry) => entry.recipient === oldAddress);
  expect(pending?.latestInvitation.status).toBe('revoked');
  expect(pending?.identityCollision).toBe('historical_binding');
  expect(JSON.stringify(directory.data)).not.toMatch(
    /intake|learning|progress/i,
  );

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const records = await inspection.query<{
      students: string;
      memberships: string;
      current_emails: string;
      historical_emails: string;
      live_sessions: string;
      event_type: string;
      details: unknown;
    }>(
      `select
         (select count(*) from identity_access.students
           where student_id = $1)::text as students,
         (select count(*) from identity_access.class_memberships
           where student_id = $1)::text as memberships,
         (select count(*) from identity_access.verified_email_addresses
           where student_id = $1 and status = 'current')::text as current_emails,
         (select count(*) from identity_access.verified_email_addresses
           where student_id = $1 and status = 'historical')::text as historical_emails,
         (select count(*) from identity_access.student_sessions
           where student_id = $1 and revoked_at is null)::text as live_sessions,
         audit.event_type,
         audit.details
       from audit.evidence audit
      where audit.operation_id = $2`,
      [access.studentId, '018f1f5e-7b76-7f70-8f4d-9dc17ecf7103'],
    );
    expect(records.rows).toEqual([
      {
        students: '1',
        memberships: '1',
        current_emails: '1',
        historical_emails: '1',
        live_sessions: '0',
        event_type: 'student_verified_email.replaced',
        details: {
          studentId: access.studentId,
          reason: 'mailbox_loss',
          identityVerification: 'in_person_school_id',
          revokedSessionCount: 1,
          revokedInvitationCount: 1,
        },
      },
    ]);
    expect(JSON.stringify(records.rows)).not.toContain(oldAddress);
    expect(JSON.stringify(records.rows)).not.toContain(newAddress);
    expect(JSON.stringify(records.rows)).not.toContain('555111');
  } finally {
    await inspection.end();
  }
});

test('stale Authentication Freshness blocks replacement without changing bindings', async () => {
  const client = createApiClient(baseUrl);
  const address = 'freshness.student@example.edu';
  await createClassInvitation({
    classId: crypto.randomUUID(),
    name: 'Freshness Class',
    recipient: address,
    code: '111000',
  });
  const joined = await redeemInvitation({ recipient: address, code: '111000' });
  const access = (await (
    await fetch(`${baseUrl}/api/v1/student/session`, {
      headers: { cookie: studentSessionCookie(joined) },
    })
  ).json()) as { studentId: string };
  const originalNow = now;
  now = new Date(now.getTime() + 14 * 60 * 1000);
  expect(
    (
      await client.GET('/api/v1/staff/session', {
        headers: { cookie: staffCookie() },
      })
    ).response.status,
  ).toBe(200);
  now = new Date(now.getTime() + 2 * 60 * 1000);
  const stale = await client.POST(
    '/api/v1/administration/students/verified-email-replacements',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId: access.studentId,
        recipient: 'freshness.restored@example.edu',
        reason: 'mailbox_loss',
        identityVerification: 'in_person_school_id',
      },
    },
  );
  now = originalNow;
  expect(stale.response.status).toBe(409);
  expect(stale.error).toMatchObject({
    code: 'AUTHENTICATION_FRESHNESS_REQUIRED',
  });
  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: staffCookie() },
  });
  expect(
    directory.data?.classes
      .flatMap((entry) => entry.relationships)
      .find((entry) => entry.studentId === access.studentId)
      ?.currentVerifiedEmail,
  ).toBe(address);
});

test('recycled and currently bound addresses stop for identity review instead of merging', async () => {
  const client = createApiClient(baseUrl);
  const firstAddress = 'first.bound@example.edu';
  const secondAddress = 'second.bound@example.edu';
  await createClassInvitation({
    classId: crypto.randomUUID(),
    name: 'Collision A',
    recipient: firstAddress,
    code: '222000',
  });
  await createClassInvitation({
    classId: crypto.randomUUID(),
    name: 'Collision B',
    recipient: secondAddress,
    code: '333000',
  });
  const firstJoin = await redeemInvitation({
    recipient: firstAddress,
    code: '222000',
  });
  const secondJoin = await redeemInvitation({
    recipient: secondAddress,
    code: '333000',
  });
  const first = (await (
    await fetch(`${baseUrl}/api/v1/student/session`, {
      headers: { cookie: studentSessionCookie(firstJoin) },
    })
  ).json()) as { studentId: string };
  const second = (await (
    await fetch(`${baseUrl}/api/v1/student/session`, {
      headers: { cookie: studentSessionCookie(secondJoin) },
    })
  ).json()) as { studentId: string };

  const currentCollision = await client.POST(
    '/api/v1/administration/students/verified-email-replacements',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId: first.studentId,
        recipient: secondAddress,
        reason: 'school_issued_address_change',
        identityVerification: 'school_record_match',
      },
    },
  );
  expect(currentCollision.response.status).toBe(409);
  expect(currentCollision.error).toMatchObject({
    code: 'STUDENT_IDENTITY_REVIEW_REQUIRED',
    reason: 'current_binding',
  });

  const pendingAddress = 'pending.collision@example.edu';
  await createClassInvitation({
    classId: crypto.randomUUID(),
    name: 'Collision Pending',
    recipient: pendingAddress,
    code: '334000',
  });
  const pendingCollision = await client.POST(
    '/api/v1/administration/students/verified-email-replacements',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId: first.studentId,
        recipient: pendingAddress,
        reason: 'incorrect_address',
        identityVerification: 'guardian_confirmed',
      },
    },
  );
  expect(pendingCollision.response.status).toBe(409);
  expect(pendingCollision.error).toMatchObject({
    code: 'STUDENT_IDENTITY_REVIEW_REQUIRED',
    reason: 'pending_invitation',
  });

  const retired = await client.POST(
    '/api/v1/administration/students/verified-email-replacements',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId: second.studentId,
        recipient: 'retired.mailbox@example.edu',
        reason: 'mailbox_loss',
        identityVerification: 'in_person_school_id',
      },
    },
  );
  expect(retired.response.status).toBe(200);

  const recycled = await client.POST(
    '/api/v1/administration/students/verified-email-replacements',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId: first.studentId,
        recipient: secondAddress,
        reason: 'mailbox_loss',
        identityVerification: 'guardian_confirmed',
      },
    },
  );
  expect(recycled.response.status).toBe(409);
  expect(recycled.error).toMatchObject({
    code: 'STUDENT_IDENTITY_REVIEW_REQUIRED',
    reason: 'historical_binding',
  });
  expect(first.studentId).not.toBe(second.studentId);

  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: staffCookie() },
  });
  const firstRow = directory.data?.classes
    .flatMap((entry) => entry.relationships)
    .find((entry) => entry.studentId === first.studentId);
  const secondRow = directory.data?.classes
    .flatMap((entry) => entry.relationships)
    .find((entry) => entry.studentId === second.studentId);
  expect(firstRow?.currentVerifiedEmail).toBe(firstAddress);
  expect(secondRow?.currentVerifiedEmail).toBe('retired.mailbox@example.edu');
  expect(secondRow?.identityCollision).toBe('historical_binding');

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const reviews = await inspection.query<{
      event_type: string;
      details: { studentId: string; reviewReason: string };
    }>(
      `select event_type, details from audit.evidence
        where event_type = 'student_verified_email.identity_review'
          and details->>'studentId' = $1
        order by occurred_at, sequence`,
      [first.studentId],
    );
    expect(reviews.rows).toEqual([
      {
        event_type: 'student_verified_email.identity_review',
        details: expect.objectContaining({
          studentId: first.studentId,
          reviewReason: 'current_binding',
        }),
      },
      {
        event_type: 'student_verified_email.identity_review',
        details: expect.objectContaining({
          studentId: first.studentId,
          reviewReason: 'pending_invitation',
        }),
      },
      {
        event_type: 'student_verified_email.identity_review',
        details: expect.objectContaining({
          studentId: first.studentId,
          reviewReason: 'historical_binding',
        }),
      },
    ]);
    expect(JSON.stringify(reviews.rows)).not.toContain(firstAddress);
    expect(JSON.stringify(reviews.rows)).not.toContain(secondAddress);
    expect(JSON.stringify(reviews.rows)).not.toContain(pendingAddress);
  } finally {
    await inspection.end();
  }
});

test('Student Disablement revokes access immediately while preserving memberships and clinical location', async () => {
  const client = createApiClient(baseUrl);
  const address = 'disabled.student@example.edu';
  await createClassInvitation({
    classId: crypto.randomUUID(),
    name: 'Disablement Class',
    recipient: address,
    code: '444000',
  });
  const joined = await redeemInvitation({ recipient: address, code: '444000' });
  const sessionCookie = studentSessionCookie(joined);
  const access = (await (
    await fetch(`${baseUrl}/api/v1/student/session`, {
      headers: { cookie: sessionCookie },
    })
  ).json()) as { studentId: string };

  generatedCode = '666000';
  await fetch(`${baseUrl}/api/v1/auth/student/sign-in`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ recipient: address }),
  });
  generatedCode = invitationCode;
  await markSignInDelivered();

  const disabled = await client.POST(
    '/api/v1/administration/students/disablements',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf7201',
        studentId: access.studentId,
        reason: 'compromised_access',
      },
    },
  );
  expect(disabled.response.status).toBe(200);
  expect(disabled.data).toEqual({
    operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf7201',
    studentId: access.studentId,
    outcome: 'disabled',
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
        body: JSON.stringify({ recipient: address, code: '666000' }),
      })
    ).status,
  ).toBe(401);

  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: staffCookie() },
  });
  const relationship = directory.data?.classes
    .flatMap((entry) => entry.relationships)
    .find((entry) => entry.studentId === access.studentId);
  expect(relationship?.studentAccessStatus).toBe('disabled');
  expect(relationship?.membershipStatus).toBe('active');
  expect(relationship?.currentVerifiedEmail).toBe(address);
  expect(JSON.stringify(directory.data)).not.toMatch(
    /intake|learning|progress/i,
  );

  const clinical = await client.GET('/api/v1/clinical/review-directory', {
    headers: { cookie: staffCookie() },
  });
  expect(clinical.response.status).toBe(200);
  expect(
    clinical.data?.students.some(
      (student) => student.studentId === access.studentId,
    ),
  ).toBe(true);

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const records = await inspection.query<{
      status: string;
      memberships: string;
      live_sessions: string;
      event_type: string;
      details: unknown;
    }>(
      `select student.status,
              (select count(*) from identity_access.class_memberships
                where student_id = $1)::text as memberships,
              (select count(*) from identity_access.student_sessions
                where student_id = $1 and revoked_at is null)::text as live_sessions,
              audit.event_type,
              audit.details
         from identity_access.students student
         join audit.evidence audit on audit.operation_id = $2
        where student.student_id = $1`,
      [access.studentId, '018f1f5e-7b76-7f70-8f4d-9dc17ecf7201'],
    );
    expect(records.rows).toEqual([
      {
        status: 'disabled',
        memberships: '1',
        live_sessions: '0',
        event_type: 'student_access.disabled',
        details: {
          studentId: access.studentId,
          reason: 'compromised_access',
          revokedSessionCount: 1,
        },
      },
    ]);
    expect(JSON.stringify(records.rows)).not.toContain(address);
    expect(JSON.stringify(records.rows)).not.toContain('666000');
  } finally {
    await inspection.end();
  }
});

test('re-enablement restores eligibility without reviving sessions, codes, or Invitations', async () => {
  const client = createApiClient(baseUrl);
  const address = 'reenabled.student@example.edu';
  const pendingId = crypto.randomUUID();
  await createClassInvitation({
    classId: crypto.randomUUID(),
    name: 'Re-enable Class',
    invitationId: pendingId,
    recipient: address,
    code: '777000',
  });
  const joined = await redeemInvitation({ recipient: address, code: '777000' });
  const sessionCookie = studentSessionCookie(joined);
  const access = (await (
    await fetch(`${baseUrl}/api/v1/student/session`, {
      headers: { cookie: sessionCookie },
    })
  ).json()) as { studentId: string };

  generatedCode = '888000';
  await fetch(`${baseUrl}/api/v1/auth/student/sign-in`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ recipient: address }),
  });
  generatedCode = invitationCode;
  await markSignInDelivered();

  await client.POST('/api/v1/administration/students/disablements', {
    headers: { ...mutationHeaders, cookie: staffCookie() },
    body: {
      operationId: crypto.randomUUID(),
      studentId: access.studentId,
      reason: 'safety_hold',
    },
  });
  const enabled = await client.POST(
    '/api/v1/administration/students/re-enablements',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf7301',
        studentId: access.studentId,
        reason: 'hold_released',
      },
    },
  );
  expect(enabled.response.status).toBe(200);
  expect(enabled.data).toEqual({
    operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf7301',
    studentId: access.studentId,
    outcome: 'enabled',
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
        body: JSON.stringify({ recipient: address, code: '888000' }),
      })
    ).status,
  ).toBe(401);
  expect(
    (await redeemInvitation({ recipient: address, code: '777000' })).status,
  ).toBe(401);

  generatedCode = '999000';
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
      body: JSON.stringify({ recipient: address, code: '999000' }),
    },
  );
  expect(restored.status).toBe(200);
  const restoredSession = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie: studentSessionCookie(restored) },
  });
  expect(restoredSession.status).toBe(200);
  expect(
    ((await restoredSession.json()) as { studentId: string }).studentId,
  ).toBe(access.studentId);
});

test('Administrator Class workspace exposes Student access actions without clinical or progress content', async () => {
  const workspace = await readFile(
    new URL('../../src/features/staff/ClassWorkspace.tsx', import.meta.url),
    'utf8',
  );
  expect(workspace).toContain('Replace Verified Email Address');
  expect(workspace).toContain('Disable Student access');
  expect(workspace).toContain('Re-enable Student access');
  expect(workspace).toContain('id="student-email-replacement-recipient"');
  expect(workspace).toContain('id="student-access-step-up-password"');
  expect(workspace).toContain('id="student-access-step-up-totp"');
  expect(workspace).toContain('in_person_school_id');
  expect(workspace).toContain('mailbox_loss');
  expect(workspace).toContain('historical_binding');
  expect(workspace).toContain('Verified Email Address history');
  expect(workspace).not.toMatch(/clinical answer/i);
  expect(workspace).not.toContain('itemCompletion');
  expect(workspace).toContain(
    'Re-enter password and authenticator code. The Student identity stays the same.',
  );
  expect(workspace).toContain(
    'Student access ends immediately. Class Memberships, Intake Records, and Learning Progress stay with this Student. School Nurse access is unchanged.',
  );
  expect(workspace).toContain(
    'Eligibility returns through this same Student. Prior sessions, codes, and Invitations stay unusable.',
  );
});
