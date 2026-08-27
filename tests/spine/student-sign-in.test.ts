import { afterAll, beforeAll, expect, test } from 'bun:test';
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

const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6001';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6002';
const firstClassId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6003';
const secondClassId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6004';
const sessionHandle = 'opaque-administrator-session-handle';
const recipient = 'student.one@example.test';
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

function studentSessionCookie(response: Response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
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
      createCode: () => generatedCode,
    },
  });
  baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
});

test('deactivating one Membership keeps union access, and losing the last one limits intake and learning without deleting records', async () => {
  const client = createApiClient(baseUrl);
  await createClassInvitation({
    classId: firstClassId,
    name: 'Health Literacy 7A',
    invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6101',
    recipient,
    code: '381204',
  });
  await createClassInvitation({
    classId: secondClassId,
    name: 'Spring Wellness',
    invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6102',
    recipient,
    code: '910327',
  });

  const firstJoin = await redeemInvitation({ recipient, code: '381204' });
  expect(firstJoin.status).toBe(200);
  const secondJoin = await redeemInvitation({ recipient, code: '910327' });
  expect(secondJoin.status).toBe(200);
  const cookie = studentSessionCookie(secondJoin);

  const both = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie },
  });
  expect(both.status).toBe(200);
  const bothAccess = (await both.json()) as {
    studentId: string;
    languageChoice: string;
    activeClassMemberships: { classId: string; name: string }[];
  };
  expect(bothAccess.languageChoice).toBe('en-US');
  expect(
    bothAccess.activeClassMemberships
      .map((membership) => membership.classId)
      .sort(),
  ).toEqual([firstClassId, secondClassId].sort());

  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: staffCookie() },
  });
  const firstMembershipId = directory.data?.classes
    .find((entry) => entry.classId === firstClassId)
    ?.relationships.find(
      (entry) => entry.recipient === recipient,
    )?.classMembershipId;
  expect(firstMembershipId).toBeString();

  const deactivated = await client.POST(
    '/api/v1/administration/classes/membership-deactivations',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6103',
        classMembershipId: firstMembershipId!,
      },
    },
  );
  expect(deactivated.response.status).toBe(200);

  const remaining = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie },
  });
  expect(remaining.status).toBe(200);
  const remainingAccess = (await remaining.json()) as {
    studentId: string;
    activeClassMemberships: { classId: string }[];
  };
  expect(remainingAccess.studentId).toBe(bothAccess.studentId);
  expect(remainingAccess.activeClassMemberships).toEqual([
    { classId: secondClassId, name: 'Spring Wellness' },
  ]);

  const secondMembershipId = directory.data?.classes
    .find((entry) => entry.classId === secondClassId)
    ?.relationships.find(
      (entry) => entry.recipient === recipient,
    )?.classMembershipId;
  expect(secondMembershipId).toBeString();
  const lastDeactivated = await client.POST(
    '/api/v1/administration/classes/membership-deactivations',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6104',
        classMembershipId: secondMembershipId!,
      },
    },
  );
  expect(lastDeactivated.response.status).toBe(200);

  const limited = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie },
  });
  expect(limited.status).toBe(200);
  const limitedAccess = (await limited.json()) as {
    studentId: string;
    activeClassMemberships: unknown[];
  };
  expect(limitedAccess.studentId).toBe(bothAccess.studentId);
  expect(limitedAccess.activeClassMemberships).toEqual([]);

  const limitedProblem = {
    type: 'https://preventive-care-literacy.example/problems/student-class-access',
    title: 'No Class access is active',
    status: 403,
    code: 'STUDENT_CLASS_ACCESS_REQUIRED',
  };
  const intake = await fetch(`${baseUrl}/api/v1/student/intake?locale=en-US`, {
    headers: { cookie },
  });
  expect(intake.status).toBe(403);
  expect(await intake.json()).toEqual(limitedProblem);
  const learning = await fetch(
    `${baseUrl}/api/v1/student/learning?locale=en-US`,
    { headers: { cookie } },
  );
  expect(learning.status).toBe(403);
  expect(await learning.json()).toEqual(limitedProblem);

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const records = await inspection.query<{
      students: string;
      memberships: string;
      inactive: string;
      sessions: string;
    }>(
      `select
         (select count(*) from identity_access.students
           where student_id = $1)::text as students,
         (select count(*) from identity_access.class_memberships
           where student_id = $1)::text as memberships,
         (select count(*) from identity_access.class_memberships
           where student_id = $1 and status = 'inactive')::text as inactive,
         (select count(*) from identity_access.student_sessions
           where student_id = $1 and revoked_at is null)::text as sessions`,
      [bothAccess.studentId],
    );
    expect(records.rows).toEqual([
      {
        students: '1',
        memberships: '2',
        inactive: '2',
        sessions: '2',
      },
    ]);
  } finally {
    await inspection.end();
  }
});

test('a later Invitation to the current Verified Email Address reuses the Student and Membership', async () => {
  const address = 'membership.reuse@example.test';
  const classId = crypto.randomUUID();
  await createClassInvitation({
    classId,
    name: 'Health Literacy Reuse',
    recipient: address,
    code: '111222',
  });
  const firstJoin = await redeemInvitation({
    recipient: address,
    code: '111222',
  });
  expect(firstJoin.status).toBe(200);
  const firstAccess = (await (
    await fetch(`${baseUrl}/api/v1/student/session`, {
      headers: { cookie: studentSessionCookie(firstJoin) },
    })
  ).json()) as { studentId: string };

  const client = createApiClient(baseUrl);
  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: staffCookie() },
  });
  const membershipId = directory.data?.classes
    .find((entry) => entry.classId === classId)
    ?.relationships.find(
      (entry) => entry.recipient === address,
    )?.classMembershipId;
  expect(membershipId).toBeString();

  const deactivated = await client.POST(
    '/api/v1/administration/classes/membership-deactivations',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        classMembershipId: membershipId!,
      },
    },
  );
  expect(deactivated.response.status).toBe(200);

  const laterInvitationId = crypto.randomUUID();
  generatedCode = '333444';
  const invited = await fetch(
    `${baseUrl}/api/v1/administration/classes/invitations`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        classId,
        invitationId: laterInvitationId,
        recipient: address,
      }),
    },
  );
  generatedCode = invitationCode;
  expect(invited.status).toBe(201);
  await markInvitationDelivered(laterInvitationId);

  const laterJoin = await redeemInvitation({
    recipient: address,
    code: '333444',
  });
  expect(laterJoin.status).toBe(200);
  const restored = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie: studentSessionCookie(laterJoin) },
  });
  expect(restored.status).toBe(200);
  const restoredAccess = (await restored.json()) as {
    studentId: string;
    activeClassMemberships: { classId: string; name: string }[];
  };
  expect(restoredAccess.studentId).toBe(firstAccess.studentId);
  expect(restoredAccess.activeClassMemberships).toEqual([
    { classId, name: 'Health Literacy Reuse' },
  ]);

  const restoredDirectory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: staffCookie() },
  });
  expect(
    restoredDirectory.data?.classes
      .find((entry) => entry.classId === classId)
      ?.relationships.find((entry) => entry.recipient === address)
      ?.classMembershipId,
  ).toBe(membershipId);

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const records = await inspection.query<{
      students: string;
      memberships: string;
    }>(
      `select
         (select count(*) from identity_access.students
           where student_id = $1)::text as students,
         (select count(*) from identity_access.class_memberships
           where student_id = $1)::text as memberships`,
      [firstAccess.studentId],
    );
    expect(records.rows).toEqual([{ students: '1', memberships: '1' }]);
  } finally {
    await inspection.end();
  }
});

async function requestSignIn(recipientAddress: string) {
  return fetch(`${baseUrl}/api/v1/auth/student/sign-in`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ recipient: recipientAddress }),
  });
}

async function verifySignIn(input: {
  recipient: string;
  code?: string;
  cookie?: string;
}) {
  return fetch(`${baseUrl}/api/v1/auth/student/sign-in/verify`, {
    method: 'POST',
    headers: {
      ...mutationHeaders,
      ...(input.cookie ? { cookie: input.cookie } : {}),
    },
    body: JSON.stringify({
      recipient: input.recipient,
      code: input.code ?? generatedCode,
    }),
  });
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

const genericSignInAccepted = { outcome: 'accepted' } as const;
const genericAuthFailure = {
  type: 'https://preventive-care-literacy.example/problems/student-authentication',
  title: 'Student authentication failed',
  status: 401,
  code: 'STUDENT_AUTHENTICATION_FAILED',
};

test('a Sign-In Code is distinct from an Invitation Code and starts an independent Student Session once', async () => {
  const signInRecipient = 'restored.student@example.test';
  await createClassInvitation({
    classId: crypto.randomUUID(),
    name: 'Advisory',
    recipient: signInRecipient,
    code: '246801',
  });
  const joined = await redeemInvitation({
    recipient: signInRecipient,
    code: '246801',
  });
  expect(joined.status).toBe(200);
  const originalCookie = studentSessionCookie(joined);
  const original = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie: originalCookie },
  });
  const originalAccess = (await original.json()) as { studentId: string };

  generatedCode = '555111';
  const unknown = await requestSignIn('unknown.mailbox@example.test');
  const known = await requestSignIn(signInRecipient);
  const knownAgain = await requestSignIn(signInRecipient);
  generatedCode = invitationCode;
  expect(unknown.status).toBe(200);
  expect(known.status).toBe(200);
  expect(knownAgain.status).toBe(200);
  expect(await unknown.json()).toEqual(genericSignInAccepted);
  expect(await known.json()).toEqual(genericSignInAccepted);
  expect(await knownAgain.json()).toEqual(genericSignInAccepted);
  expect(unknown.headers.get('set-cookie')).toBeNull();
  expect(known.headers.get('set-cookie')).toBeNull();

  await markSignInDelivered();

  const invitationAsSignIn = await verifySignIn({
    recipient: signInRecipient,
    code: '246801',
  });
  expect(invitationAsSignIn.status).toBe(401);
  expect(await invitationAsSignIn.json()).toEqual(genericAuthFailure);
  expect(invitationAsSignIn.headers.get('set-cookie')).toBeNull();

  const signInAsInvitation = await redeemInvitation({
    recipient: signInRecipient,
    code: '555111',
  });
  expect(signInAsInvitation.status).toBe(401);

  const verified = await verifySignIn({
    recipient: signInRecipient,
    code: '555111',
  });
  expect(verified.status).toBe(200);
  expect(await verified.json()).toEqual({ outcome: 'authenticated' });
  const freshCookie = studentSessionCookie(verified);
  expect(freshCookie).toStartWith('__Host-prevcare-student-session=');
  expect(freshCookie).not.toBe(originalCookie);
  expect(verified.headers.get('set-cookie')).toContain('HttpOnly');
  expect(verified.headers.get('set-cookie')).toContain('SameSite=Strict');
  expect(verified.headers.get('set-cookie')).not.toContain('Max-Age');
  expect(verified.headers.get('set-cookie')).not.toContain(signInRecipient);
  expect(verified.headers.get('set-cookie')).not.toContain('555111');

  const restored = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie: freshCookie },
  });
  expect(restored.status).toBe(200);
  const restoredAccess = (await restored.json()) as {
    studentId: string;
    languageChoice: string;
    activeClassMemberships: { name: string }[];
  };
  expect(restoredAccess.studentId).toBe(originalAccess.studentId);
  expect(restoredAccess.languageChoice).toBe('en-US');
  expect(
    restoredAccess.activeClassMemberships.map((item) => item.name),
  ).toEqual(['Advisory']);

  const reused = await verifySignIn({
    recipient: signInRecipient,
    code: '555111',
    cookie: originalCookie,
  });
  expect(reused.status).toBe(401);
  expect(await reused.json()).toEqual(genericAuthFailure);
  expect(reused.headers.get('set-cookie')).toBeNull();

  const originalStillValid = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie: originalCookie },
  });
  expect(originalStillValid.status).toBe(200);
});

test('Sign-In with no active Membership restores the limited state without deleting records', async () => {
  const address = 'limited.restore@example.test';
  const classId = crypto.randomUUID();
  await createClassInvitation({
    classId,
    name: 'Limited Access',
    recipient: address,
    code: '121212',
  });
  const joined = await redeemInvitation({ recipient: address, code: '121212' });
  expect(joined.status).toBe(200);
  const client = createApiClient(baseUrl);
  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: staffCookie() },
  });
  const membershipId = directory.data?.classes
    .find((entry) => entry.classId === classId)
    ?.relationships.find(
      (entry) => entry.recipient === address,
    )?.classMembershipId;
  expect(membershipId).toBeString();
  expect(
    (
      await client.POST(
        '/api/v1/administration/classes/membership-deactivations',
        {
          headers: { ...mutationHeaders, cookie: staffCookie() },
          body: {
            operationId: crypto.randomUUID(),
            classMembershipId: membershipId!,
          },
        },
      )
    ).response.status,
  ).toBe(200);

  generatedCode = '131313';
  expect((await requestSignIn(address)).status).toBe(200);
  await markSignInDelivered();
  generatedCode = invitationCode;
  const verified = await verifySignIn({ recipient: address, code: '131313' });
  expect(verified.status).toBe(200);
  const cookie = studentSessionCookie(verified);
  const restored = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie },
  });
  expect(restored.status).toBe(200);
  const access = (await restored.json()) as {
    studentId: string;
    activeClassMemberships: unknown[];
  };
  expect(access.studentId).toBeString();
  expect(access.activeClassMemberships).toEqual([]);
  expect(
    (
      await fetch(`${baseUrl}/api/v1/student/intake?locale=en-US`, {
        headers: { cookie },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(`${baseUrl}/api/v1/student/learning?locale=en-US`, {
        headers: { cookie },
      })
    ).status,
  ).toBe(403);
});

async function studentWithMembership(address: string) {
  await createClassInvitation({
    classId: crypto.randomUUID(),
    name: 'Health Literacy',
    recipient: address,
  });
  const joined = await redeemInvitation({ recipient: address });
  expect(joined.status).toBe(200);
  return studentSessionCookie(joined);
}

test('only the latest Sign-In Code remains usable, and expiry or five failed attempts invalidate it', async () => {
  const address = 'latest.code@example.test';
  await studentWithMembership(address);

  generatedCode = '101010';
  expect((await requestSignIn(address)).status).toBe(200);
  await markSignInDelivered();
  now = new Date(now.getTime() + 61_000);
  generatedCode = '202020';
  expect((await requestSignIn(address)).status).toBe(200);
  await markSignInDelivered();
  generatedCode = invitationCode;

  const replaced = await verifySignIn({ recipient: address, code: '101010' });
  expect(replaced.status).toBe(401);
  expect(await replaced.json()).toEqual(genericAuthFailure);
  const latest = await verifySignIn({ recipient: address, code: '202020' });
  expect(latest.status).toBe(200);

  const expiredAddress = 'expired.code@example.test';
  await studentWithMembership(expiredAddress);
  generatedCode = '303030';
  expect((await requestSignIn(expiredAddress)).status).toBe(200);
  await markSignInDelivered();
  now = new Date(now.getTime() + 10 * 60 * 1000);
  const expired = await verifySignIn({
    recipient: expiredAddress,
    code: '303030',
  });
  expect(expired.status).toBe(401);
  generatedCode = invitationCode;

  const exhaustedAddress = 'exhausted.code@example.test';
  await studentWithMembership(exhaustedAddress);
  generatedCode = '404040';
  expect((await requestSignIn(exhaustedAddress)).status).toBe(200);
  await markSignInDelivered();
  generatedCode = invitationCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failed = await verifySignIn({
      recipient: exhaustedAddress,
      code: `${110000 + attempt}`,
    });
    expect(failed.status).toBe(401);
  }
  const afterExhaustion = await verifySignIn({
    recipient: exhaustedAddress,
    code: '404040',
  });
  expect(afterExhaustion.status).toBe(401);
});

test('Sign-In Code sending is rate-limited without changing the generic response', async () => {
  const address = 'rate.limited@example.test';
  await studentWithMembership(address);
  generatedCode = '505050';
  expect((await requestSignIn(address)).status).toBe(200);
  generatedCode = '606060';
  const burst = await requestSignIn(address);
  generatedCode = invitationCode;
  expect(burst.status).toBe(200);
  expect(await burst.json()).toEqual(genericSignInAccepted);
  await markSignInDelivered();
  const firstStillWorks = await verifySignIn({
    recipient: address,
    code: '505050',
  });
  expect(firstStillWorks.status).toBe(200);
  const replacementDidNotSend = await verifySignIn({
    recipient: address,
    code: '606060',
  });
  expect(replacementDidNotSend.status).toBe(401);
});

test('fresh-browser Sign-In restores saved language choice from the server', async () => {
  const address = 'language.choice@example.test';
  const cookie = await studentWithMembership(address);
  const saved = await fetch(`${baseUrl}/api/v1/student/language`, {
    method: 'PUT',
    headers: { ...mutationHeaders, cookie },
    body: JSON.stringify({ languageChoice: 'es-US' }),
  });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ languageChoice: 'es-US' });

  now = new Date(now.getTime() + 61_000);
  generatedCode = '707070';
  expect((await requestSignIn(address)).status).toBe(200);
  await markSignInDelivered();
  generatedCode = invitationCode;
  const verified = await verifySignIn({ recipient: address, code: '707070' });
  expect(verified.status).toBe(200);
  const restored = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie: studentSessionCookie(verified) },
  });
  expect(restored.status).toBe(200);
  expect(await restored.json()).toMatchObject({
    languageChoice: 'es-US',
  });
});

test('Sign-In Code sending is limited to five per hour without changing the generic response', async () => {
  const address = 'hourly.limited@example.test';
  await studentWithMembership(address);
  for (let send = 0; send < 5; send += 1) {
    generatedCode = `${800000 + send}`;
    expect((await requestSignIn(address)).status).toBe(200);
    now = new Date(now.getTime() + 61_000);
  }
  generatedCode = '800005';
  const sixth = await requestSignIn(address);
  generatedCode = invitationCode;
  expect(sixth.status).toBe(200);
  expect(await sixth.json()).toEqual(genericSignInAccepted);
  await markSignInDelivered();
  expect(
    (await verifySignIn({ recipient: address, code: '800005' })).status,
  ).toBe(401);
  expect(
    (await verifySignIn({ recipient: address, code: '800004' })).status,
  ).toBe(200);
});
