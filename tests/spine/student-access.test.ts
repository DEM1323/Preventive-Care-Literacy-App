import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { createServer } from '../../apps/server/src/app.ts';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import {
  createRuntimeDatabaseUser,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from '../../packages/test-support/src/postgres.ts';
import { createFakeStaffAuth } from '../../packages/test-support/src/staff-auth.ts';

const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf4001';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf4002';
const classId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf4003';
const invitationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf4004';
const sessionHandle = 'opaque-administrator-session-handle';
const recipient = 'student.one@example.test';
const invitationCode = '729104';
let generatedInvitationCode = invitationCode;
const now = new Date('2026-08-24T12:00:00.000Z');
const mutationHeaders = {
  origin: 'http://127.0.0.1',
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;

let postgres: EphemeralPostgres;
let server: FastifyInstance;
let baseUrl: string;

async function markInvitationDelivered(deliveredInvitationId: string) {
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(
      `update identity_access.invitations set status = 'delivered'
        where invitation_id = $1`,
      [deliveredInvitationId],
    );
  } finally {
    await owner.end();
  }
}

async function createInvitation(input: {
  recipient: string;
  classId?: string;
  invitationId?: string;
  code?: string;
}) {
  const createdInvitationId = input.invitationId ?? crypto.randomUUID();
  generatedInvitationCode = input.code ?? invitationCode;
  const created = await fetch(`${baseUrl}/api/v1/administration/classes`, {
    method: 'POST',
    headers: {
      ...mutationHeaders,
      cookie: `__Host-prevcare-staff-session=${sessionHandle}`,
    },
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      classId: input.classId ?? crypto.randomUUID(),
      invitationId: createdInvitationId,
      name: 'Health Literacy 7A',
      recipient: input.recipient,
    }),
  });
  generatedInvitationCode = invitationCode;
  expect(created.status).toBe(201);
  await markInvitationDelivered(createdInvitationId);
}

async function redeem(input: {
  recipient: string;
  code?: string;
  cookie?: string;
}) {
  return fetch(`${baseUrl}/api/v1/auth/student/invitations/redeem`, {
    method: 'POST',
    headers: {
      ...mutationHeaders,
      ...(input.cookie ? { cookie: input.cookie } : {}),
    },
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
      `insert into identity_access.staff_sessions values
       ($1, $2, $3, $4, 'aal2', $5, $6, null, $5,
        'school', 'operational_evidence', 'staff_session', $5, $7)`,
      [
        crypto.randomUUID(),
        workspaceId,
        staffIdentityId,
        createHash('sha256').update(sessionHandle).digest('hex'),
        now,
        new Date(now.getTime() + 60 * 60 * 1000),
        new Date(now.getTime() + 15 * 60 * 1000),
      ],
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
      createCode: () => generatedInvitationCode,
    },
  });
  baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });

  const created = await fetch(`${baseUrl}/api/v1/administration/classes`, {
    method: 'POST',
    headers: {
      ...mutationHeaders,
      cookie: `__Host-prevcare-staff-session=${sessionHandle}`,
    },
    body: JSON.stringify({
      operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf4005',
      classId,
      invitationId,
      name: 'Health Literacy 7A',
      recipient,
    }),
  });
  expect(created.status).toBe(201);
  await markInvitationDelivered(invitationId);
});

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
});

test('Invitation redemption creates durable Student access and a restorable Student Session atomically', async () => {
  const redeemed = await redeem({ recipient });

  expect(redeemed.status).toBe(200);
  expect(await redeemed.json()).toEqual({ outcome: 'authenticated' });
  const cookie = redeemed.headers.get('set-cookie');
  expect(cookie).toContain('__Host-prevcare-student-session=');
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Strict');
  expect(cookie).not.toContain(recipient);
  expect(cookie).not.toContain(invitationCode);

  const restored = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie: cookie?.split(';', 1)[0] ?? '' },
  });
  expect(restored.status).toBe(200);
  const access = (await restored.json()) as Record<string, unknown>;
  expect(access).toMatchObject({
    workspaceId,
    activeClassMemberships: [{ classId, name: 'Health Literacy 7A' }],
  });
  expect(access.studentId).toBeString();
  expect(JSON.stringify(access)).not.toContain(recipient);

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const records = await inspection.query<{
      students: string;
      memberships: string;
      sessions: string;
      invitation_status: string;
      completed_at: Date | null;
    }>(
      `select
         (select count(*) from identity_access.students) as students,
         (select count(*) from identity_access.class_memberships) as memberships,
         (select count(*) from identity_access.student_sessions) as sessions,
         invitation.status as invitation_status,
         challenge.completed_at
       from identity_access.invitations invitation
       join identity_access.invitation_challenges challenge
         on challenge.invitation_id = invitation.invitation_id
        and challenge.generation = invitation.current_generation
       where invitation.invitation_id = $1`,
      [invitationId],
    );
    expect(records.rows).toEqual([
      {
        students: '1',
        memberships: '1',
        sessions: '1',
        invitation_status: 'completed',
        completed_at: now,
      },
    ]);
  } finally {
    await inspection.end();
  }
});

test('unavailable Invitation Codes fail generically without replacing an existing Student Session', async () => {
  const firstSession = await redeem({ recipient });
  expect(firstSession.status).toBe(401);

  const cases = [
    { state: 'pending', recipient: 'pending@example.test' },
    { state: 'replaced', recipient: 'replaced@example.test' },
    { state: 'expired', recipient: 'expired@example.test' },
    { state: 'exhausted', recipient: 'exhausted@example.test' },
    { state: 'revoked', recipient: 'revoked@example.test' },
  ] as const;
  const invitationIds = new Map<string, string>();
  for (const invalidCase of cases) {
    const invalidInvitationId = crypto.randomUUID();
    invitationIds.set(invalidCase.state, invalidInvitationId);
    await createInvitation({
      recipient: invalidCase.recipient,
      invitationId: invalidInvitationId,
    });
  }

  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(
      `update identity_access.invitations set status = 'pending_delivery'
        where invitation_id = $1`,
      [invitationIds.get('pending')],
    );
    const replacedId = invitationIds.get('replaced') as string;
    await owner.query(
      `insert into identity_access.invitation_challenges
         (invitation_id, generation, purpose, code_digest, expires_at,
          completed_at, failed_attempts)
       values ($1, 2, 'join_class', 'replacement-digest', $2, null, 0)`,
      [replacedId, new Date(now.getTime() + 10 * 60 * 1000)],
    );
    await owner.query(
      `insert into identity_access.invitation_deliveries
         (invitation_id, generation, key_id, ciphertext, status,
          provider_idempotency_key, provider_message_id, delivered_at)
       values ($1, 2, 'test', 'replacement-protected', 'pending', $2, null, null)`,
      [replacedId, `${replacedId}:2`],
    );
    await owner.query(
      'update identity_access.invitations set current_generation = 2 where invitation_id = $1',
      [replacedId],
    );
    await owner.query(
      `update identity_access.invitation_challenges set expires_at = $2
        where invitation_id = $1`,
      [invitationIds.get('expired'), now],
    );
    await owner.query(
      `update identity_access.invitation_challenges set failed_attempts = 5
        where invitation_id = $1`,
      [invitationIds.get('exhausted')],
    );
    await owner.query(
      `update identity_access.invitations set status = 'revoked'
        where invitation_id = $1`,
      [invitationIds.get('revoked')],
    );
  } finally {
    await owner.end();
  }

  const existingCookie =
    '__Host-prevcare-student-session=invalid-existing-handle';
  const attempts = [
    { recipient, code: invitationCode },
    ...cases.map((invalidCase) => ({
      recipient: invalidCase.recipient,
      code: invitationCode,
    })),
    { recipient: 'unknown@example.test', code: '000000' },
  ];
  for (const attempt of attempts) {
    const response = await redeem({ ...attempt, cookie: existingCookie });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      type: 'https://preventive-care-literacy.example/problems/student-authentication',
      title: 'Student authentication failed',
      status: 401,
      code: 'STUDENT_AUTHENTICATION_FAILED',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  }
});

test('five wrong codes exhaust the current Invitation Code', async () => {
  const exhaustedRecipient = 'five-attempts@example.test';
  await createInvitation({ recipient: exhaustedRecipient });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await redeem({
      recipient: exhaustedRecipient,
      code: `${100000 + attempt}`,
    });
    expect(response.status).toBe(401);
  }
  const correctAfterExhaustion = await redeem({
    recipient: exhaustedRecipient,
  });
  expect(correctAfterExhaustion.status).toBe(401);
});

test('parallel guesses cannot exceed the five-attempt Invitation Code limit', async () => {
  const attackedRecipient = 'parallel-attempts@example.test';
  const attackedInvitationId = crypto.randomUUID();
  await createInvitation({
    recipient: attackedRecipient,
    invitationId: attackedInvitationId,
  });

  const attempts = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      redeem({
        recipient: attackedRecipient,
        code: `${200000 + index}`,
      }),
    ),
  );
  expect(attempts.every((response) => response.status === 401)).toBe(true);

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const challenge = await inspection.query<{ failed_attempts: number }>(
      `select failed_attempts
         from identity_access.invitation_challenges
        where invitation_id = $1`,
      [attackedInvitationId],
    );
    expect(challenge.rows).toEqual([{ failed_attempts: 5 }]);
  } finally {
    await inspection.end();
  }
});

test('a valid older Invitation Code is not shadowed by a newer Invitation for the same mailbox', async () => {
  const sharedRecipient = 'multiple-invitations@example.test';
  const olderClassId = crypto.randomUUID();
  const olderInvitationId = crypto.randomUUID();
  const newerInvitationId = crypto.randomUUID();
  await createInvitation({
    recipient: sharedRecipient,
    classId: olderClassId,
    invitationId: olderInvitationId,
    code: '381204',
  });
  await createInvitation({
    recipient: sharedRecipient,
    invitationId: newerInvitationId,
    code: '910327',
  });

  const olderRedemption = await redeem({
    recipient: sharedRecipient,
    code: '381204',
  });
  expect(olderRedemption.status).toBe(200);

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const invitations = await inspection.query<{
      invitation_id: string;
      status: string;
      failed_attempts: number;
    }>(
      `select invitation.invitation_id, invitation.status,
              challenge.failed_attempts
         from identity_access.invitations invitation
         join identity_access.invitation_challenges challenge
           on challenge.invitation_id = invitation.invitation_id
          and challenge.generation = invitation.current_generation
        where invitation.invitation_id in ($1, $2)
        order by invitation.invitation_id`,
      [olderInvitationId, newerInvitationId],
    );
    expect(invitations.rows).toEqual(
      [
        {
          invitation_id: olderInvitationId,
          status: 'completed',
          failed_attempts: 1,
        },
        {
          invitation_id: newerInvitationId,
          status: 'delivered',
          failed_attempts: 0,
        },
      ].sort((left, right) =>
        left.invitation_id.localeCompare(right.invitation_id),
      ),
    );
  } finally {
    await inspection.end();
  }
});

test('a fresh browser authenticates independently and restores the durable Student from the server', async () => {
  const secondClassId = crypto.randomUUID();
  await createInvitation({ recipient, classId: secondClassId });

  const freshBrowserRedemption = await redeem({ recipient });
  expect(freshBrowserRedemption.status).toBe(200);
  const freshCookie = freshBrowserRedemption.headers
    .get('set-cookie')
    ?.split(';', 1)[0];
  expect(freshCookie).toStartWith('__Host-prevcare-student-session=');

  const restored = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie: freshCookie ?? '' },
  });
  expect(restored.status).toBe(200);
  const snapshot = (await restored.json()) as {
    studentId: string;
    activeClassMemberships: { classId: string }[];
  };
  expect(
    snapshot.activeClassMemberships
      .map((membership) => membership.classId)
      .sort(),
  ).toEqual([classId, secondClassId].sort());

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const counts = await inspection.query<{
      memberships: string;
      sessions: string;
      student_id: string;
    }>(
      `select
         (select count(*) from identity_access.class_memberships membership
           where membership.student_id = student.student_id) as memberships,
         (select count(*) from identity_access.student_sessions session
           where session.student_id = student.student_id) as sessions,
         student.student_id
       from identity_access.students student
       join identity_access.verified_email_addresses email
         on email.student_id = student.student_id
       where student.workspace_id = $1`,
      [workspaceId],
    );
    const durableStudent = counts.rows.find(
      (row) => row.student_id === snapshot.studentId,
    );
    expect(durableStudent).toEqual({
      memberships: '2',
      sessions: '2',
      student_id: snapshot.studentId,
    });
  } finally {
    await inspection.end();
  }
});

test('an existing Student Session cannot capture an Invitation for another Student', async () => {
  const signedInRecipient = 'already-signed-in@example.test';
  await createInvitation({ recipient: signedInRecipient });
  const signedIn = await redeem({ recipient: signedInRecipient });
  const originalCookie = signedIn.headers.get('set-cookie')?.split(';', 1)[0];
  expect(signedIn.status).toBe(200);

  const invitedRecipient = 'different-student@example.test';
  await createInvitation({ recipient: invitedRecipient });
  const redeemedWhileSignedIn = await redeem({
    recipient: invitedRecipient,
    cookie: originalCookie,
  });
  expect(redeemedWhileSignedIn.status).toBe(200);
  const replacementCookie = redeemedWhileSignedIn.headers
    .get('set-cookie')
    ?.split(';', 1)[0];
  expect(replacementCookie).not.toBe(originalCookie);

  const [originalSession, invitedSession] = await Promise.all([
    fetch(`${baseUrl}/api/v1/student/session`, {
      headers: { cookie: originalCookie ?? '' },
    }),
    fetch(`${baseUrl}/api/v1/student/session`, {
      headers: { cookie: replacementCookie ?? '' },
    }),
  ]);
  const originalStudent = (await originalSession.json()) as {
    studentId: string;
  };
  const invitedStudent = (await invitedSession.json()) as { studentId: string };
  expect(originalStudent.studentId).not.toBe(invitedStudent.studentId);
});

test('concurrent redemption consumes an Invitation Code exactly once', async () => {
  const concurrentRecipient = 'concurrent@example.test';
  const concurrentInvitationId = crypto.randomUUID();
  await createInvitation({
    recipient: concurrentRecipient,
    invitationId: concurrentInvitationId,
  });

  const responses = await Promise.all([
    redeem({ recipient: concurrentRecipient }),
    redeem({ recipient: concurrentRecipient }),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    200, 401,
  ]);

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const result = await inspection.query<{ sessions: string }>(
      `select count(session.session_id) as sessions
         from identity_access.student_sessions session
         join identity_access.students student
           on student.student_id = session.student_id
          and student.workspace_id = session.workspace_id
         join identity_access.verified_email_addresses email
           on email.student_id = student.student_id
          and email.workspace_id = student.workspace_id
        where email.recipient_digest = (
          select invitation.recipient_digest
            from identity_access.invitations invitation
           where invitation.invitation_id = $1
        )`,
      [concurrentInvitationId],
    );
    expect(result.rows).toEqual([{ sessions: '1' }]);
  } finally {
    await inspection.end();
  }
});
