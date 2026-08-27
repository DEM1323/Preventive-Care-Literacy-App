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

const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5001';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5002';
const classId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5003';
const secondClassId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5004';
const sessionHandle = 'opaque-administrator-session-handle';
const invitationCode = '729104';
const now = new Date('2026-08-26T12:00:00.000Z');
const csrfHeaders = {
  origin: 'http://127.0.0.1',
  'x-prevcare-csrf': '1',
} as const;

let postgres: EphemeralPostgres;
let server: FastifyInstance;
let baseUrl: string;

function staffHeaders() {
  return {
    ...csrfHeaders,
    cookie: `__Host-prevcare-staff-session=${sessionHandle}`,
  };
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

async function retireCurrentEmail(invitationId: string) {
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(
      `update identity_access.verified_email_addresses email
          set status = 'historical', retired_at = $2
        from identity_access.invitations invitation
       where invitation.invitation_id = $1
         and email.workspace_id = invitation.workspace_id
         and email.recipient_digest = invitation.recipient_digest
         and email.status = 'current'`,
      [invitationId, now],
    );
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
      createCode: () => invitationCode,
    },
  });
  baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
});

test('manual addition reports exact safe outcomes before sending', async () => {
  const client = createApiClient(baseUrl);
  const headers = staffHeaders();
  const created = await client.POST(
    '/api/v1/administration/classes/definitions',
    {
      headers,
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5101',
        classId,
        name: 'Health Literacy 7A',
      },
    },
  );
  expect(created.response.status).toBe(201);
  expect(created.data).toEqual({
    operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5101',
    classId,
    outcome: 'created',
  });

  const ready = await client.POST(
    '/api/v1/administration/classes/invitation-previews',
    {
      headers,
      body: { classId, recipient: ' Maya.Joseph@Example.Edu ' },
    },
  );
  expect(ready.response.status).toBe(200);
  expect(ready.data).toEqual({
    outcome: 'ready',
    reuse: 'none',
  });

  const invitationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5102';
  const sent = await client.POST('/api/v1/administration/classes/invitations', {
    headers,
    body: {
      operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5103',
      classId,
      invitationId,
      recipient: ' Maya.Joseph@Example.Edu ',
    },
  });
  expect(sent.response.status).toBe(201);
  expect(sent.data).toEqual({
    operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5103',
    classId,
    invitationId,
    outcome: 'created',
  });
  expect(JSON.stringify(sent.data)).not.toContain('729104');

  const listed = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: headers.cookie },
  });
  const listedRow = listed.data?.classes
    .find((entry) => entry.classId === classId)
    ?.relationships.find(
      (entry) => entry.recipient === 'maya.joseph@example.edu',
    );
  expect(listedRow?.latestInvitation.expiresAt).toBe(
    new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  );
  expect(listedRow?.history[0]?.createdAt).toBe(now.toISOString());

  const alreadyInvited = await client.POST(
    '/api/v1/administration/classes/invitation-previews',
    {
      headers,
      body: { classId, recipient: 'maya.joseph@example.edu' },
    },
  );
  expect(alreadyInvited.data).toEqual({ outcome: 'already_invited' });
  const blockedInvite = await client.POST(
    '/api/v1/administration/classes/invitations',
    {
      headers,
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5104',
        classId,
        invitationId: crypto.randomUUID(),
        recipient: 'maya.joseph@example.edu',
      },
    },
  );
  expect(blockedInvite.response.status).toBe(409);
  expect(blockedInvite.error).toMatchObject({
    code: 'INVITATION_NOT_SENDABLE',
    outcome: 'already_invited',
  });

  await markInvitationDelivered(invitationId);
  const redeemed = await fetch(
    `${baseUrl}/api/v1/auth/student/invitations/redeem`,
    {
      method: 'POST',
      headers: { ...csrfHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        recipient: 'maya.joseph@example.edu',
        code: invitationCode,
      }),
    },
  );
  expect(redeemed.status).toBe(200);

  const alreadyMember = await client.POST(
    '/api/v1/administration/classes/invitation-previews',
    {
      headers,
      body: { classId, recipient: 'maya.joseph@example.edu' },
    },
  );
  expect(alreadyMember.data).toEqual({ outcome: 'already_a_member' });

  const secondClass = await client.POST(
    '/api/v1/administration/classes/definitions',
    {
      headers,
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5105',
        classId: secondClassId,
        name: 'Spring Wellness',
      },
    },
  );
  expect(secondClass.response.status).toBe(201);
  const existingStudent = await client.POST(
    '/api/v1/administration/classes/invitation-previews',
    {
      headers,
      body: { classId: secondClassId, recipient: 'maya.joseph@example.edu' },
    },
  );
  expect(existingStudent.data).toEqual({
    outcome: 'ready',
    reuse: 'existing_student',
  });

  await retireCurrentEmail(invitationId);
  const historical = await client.POST(
    '/api/v1/administration/classes/invitation-previews',
    {
      headers,
      body: { classId: secondClassId, recipient: 'maya.joseph@example.edu' },
    },
  );
  expect(historical.data).toEqual({
    outcome: 'identity_review',
    reason: 'historical_binding',
  });
  const blockedHistorical = await client.POST(
    '/api/v1/administration/classes/invitations',
    {
      headers,
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5106',
        classId: secondClassId,
        invitationId: crypto.randomUUID(),
        recipient: 'maya.joseph@example.edu',
      },
    },
  );
  expect(blockedHistorical.response.status).toBe(409);
  expect(blockedHistorical.error).toMatchObject({
    code: 'INVITATION_NOT_SENDABLE',
    outcome: 'identity_review',
  });
});

test('resend supersedes prior authority and revocation leaves a redeemed Membership unchanged', async () => {
  const client = createApiClient(baseUrl);
  const headers = staffHeaders();
  const isolatedClassId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5201';
  await client.POST('/api/v1/administration/classes/definitions', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: isolatedClassId,
      name: 'Resend Class',
    },
  });
  const pendingId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5202';
  await client.POST('/api/v1/administration/classes/invitations', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: isolatedClassId,
      invitationId: pendingId,
      recipient: 'ethan.chen@example.edu',
    },
  });
  const replacementId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5203';
  const resent = await client.POST(
    '/api/v1/administration/classes/invitation-resends',
    {
      headers,
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5204',
        invitationId: pendingId,
        replacementInvitationId: replacementId,
      },
    },
  );
  expect(resent.response.status).toBe(201);
  expect(resent.data).toEqual({
    operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5204',
    classId: isolatedClassId,
    invitationId: replacementId,
    supersededInvitationId: pendingId,
    outcome: 'superseded',
  });

  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: headers.cookie },
  });
  const row = directory.data?.classes
    .find((entry) => entry.classId === isolatedClassId)
    ?.relationships.find(
      (entry) => entry.recipient === 'ethan.chen@example.edu',
    );
  expect(row?.latestInvitation.invitationId).toBe(replacementId);
  expect(row?.latestInvitation.status).toBe('pending_delivery');
  expect(row?.history.map((item) => item.status).sort()).toEqual([
    'pending_delivery',
    'superseded',
  ]);
  expect(JSON.stringify(directory.data)).not.toContain(invitationCode);

  await markInvitationDelivered(replacementId);
  const stale = await fetch(
    `${baseUrl}/api/v1/auth/student/invitations/redeem`,
    {
      method: 'POST',
      headers: { ...csrfHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        recipient: 'ethan.chen@example.edu',
        code: invitationCode,
      }),
    },
  );
  expect(stale.status).toBe(200);

  const revoked = await client.POST(
    '/api/v1/administration/classes/invitation-revocations',
    {
      headers,
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5205',
        invitationId: replacementId,
      },
    },
  );
  expect(revoked.response.status).toBe(200);
  expect(revoked.data).toEqual({
    operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5205',
    invitationId: replacementId,
    outcome: 'unchanged_redeemed',
  });
  const afterRevoke = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: headers.cookie },
  });
  const redeemedRow = afterRevoke.data?.classes
    .find((entry) => entry.classId === isolatedClassId)
    ?.relationships.find(
      (entry) => entry.recipient === 'ethan.chen@example.edu',
    );
  expect(redeemedRow?.membershipStatus).toBe('active');
  expect(redeemedRow?.latestInvitation.status).toBe('completed');
});

test('deactivation is Class-scoped and reactivation reuses the Membership', async () => {
  const client = createApiClient(baseUrl);
  const headers = staffHeaders();
  const firstId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5301';
  const otherId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5302';
  await client.POST('/api/v1/administration/classes/definitions', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: firstId,
      name: 'Grade 10 Health',
    },
  });
  await client.POST('/api/v1/administration/classes/definitions', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: otherId,
      name: 'Wellness Elective',
    },
  });
  const firstInvitation = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5303';
  const otherInvitation = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5304';
  await client.POST('/api/v1/administration/classes/invitations', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: firstId,
      invitationId: firstInvitation,
      recipient: 'aaliyah.brown@example.edu',
    },
  });
  await client.POST('/api/v1/administration/classes/invitations', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: otherId,
      invitationId: otherInvitation,
      recipient: 'aaliyah.brown@example.edu',
    },
  });
  await markInvitationDelivered(firstInvitation);
  await markInvitationDelivered(otherInvitation);
  expect(
    (
      await fetch(`${baseUrl}/api/v1/auth/student/invitations/redeem`, {
        method: 'POST',
        headers: { ...csrfHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          recipient: 'aaliyah.brown@example.edu',
          code: invitationCode,
        }),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await fetch(`${baseUrl}/api/v1/auth/student/invitations/redeem`, {
        method: 'POST',
        headers: { ...csrfHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          recipient: 'aaliyah.brown@example.edu',
          code: invitationCode,
        }),
      })
    ).status,
  ).toBe(200);

  const before = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: headers.cookie },
  });
  const firstRow = before.data?.classes
    .find((entry) => entry.classId === firstId)
    ?.relationships.find(
      (entry) => entry.recipient === 'aaliyah.brown@example.edu',
    );
  expect(firstRow?.membershipStatus).toBe('active');
  expect(firstRow?.classMembershipId).toBeTruthy();

  const deactivated = await client.POST(
    '/api/v1/administration/classes/membership-deactivations',
    {
      headers,
      body: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5305',
        classMembershipId: firstRow!.classMembershipId!,
      },
    },
  );
  expect(deactivated.response.status).toBe(200);
  expect(deactivated.data).toEqual({
    operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5305',
    classMembershipId: firstRow!.classMembershipId,
    outcome: 'deactivated',
  });

  const after = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: headers.cookie },
  });
  expect(
    after.data?.classes
      .find((entry) => entry.classId === firstId)
      ?.relationships.find(
        (entry) => entry.recipient === 'aaliyah.brown@example.edu',
      )?.membershipStatus,
  ).toBe('inactive');
  expect(
    after.data?.classes
      .find((entry) => entry.classId === otherId)
      ?.relationships.find(
        (entry) => entry.recipient === 'aaliyah.brown@example.edu',
      )?.membershipStatus,
  ).toBe('active');

  const preview = await client.POST(
    '/api/v1/administration/classes/invitation-previews',
    {
      headers,
      body: { classId: firstId, recipient: 'aaliyah.brown@example.edu' },
    },
  );
  expect(preview.data).toEqual({
    outcome: 'ready',
    reuse: 'inactive_membership',
  });
  const freshId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5306';
  await client.POST('/api/v1/administration/classes/invitations', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: firstId,
      invitationId: freshId,
      recipient: 'aaliyah.brown@example.edu',
    },
  });
  await markInvitationDelivered(freshId);
  expect(
    (
      await fetch(`${baseUrl}/api/v1/auth/student/invitations/redeem`, {
        method: 'POST',
        headers: { ...csrfHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          recipient: 'aaliyah.brown@example.edu',
          code: invitationCode,
        }),
      })
    ).status,
  ).toBe(200);

  const restored = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: headers.cookie },
  });
  const restoredRow = restored.data?.classes
    .find((entry) => entry.classId === firstId)
    ?.relationships.find(
      (entry) => entry.recipient === 'aaliyah.brown@example.edu',
    );
  expect(restoredRow?.membershipStatus).toBe('active');
  expect(restoredRow?.classMembershipId).toBe(firstRow?.classMembershipId);
  expect(restoredRow?.history).toHaveLength(2);

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const memberships = await inspection.query<{ count: string }>(
      `select count(*)::text as count from identity_access.class_memberships
        where class_id = $1`,
      [firstId],
    );
    expect(memberships.rows[0]?.count).toBe('1');
  } finally {
    await inspection.end();
  }
});

test('closing a Class revokes pending Invitations, deactivates Memberships, and leaves a read-only history', async () => {
  const client = createApiClient(baseUrl);
  const headers = staffHeaders();
  const closingId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5401';
  await client.POST('/api/v1/administration/classes/definitions', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: closingId,
      name: 'Closing Class',
    },
  });
  const pendingId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5402';
  const redeemedId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5403';
  await client.POST('/api/v1/administration/classes/invitations', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: closingId,
      invitationId: pendingId,
      recipient: 'jordan.smith@example.edu',
    },
  });
  await client.POST('/api/v1/administration/classes/invitations', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: closingId,
      invitationId: redeemedId,
      recipient: 'luis.santos@example.edu',
    },
  });
  await markInvitationDelivered(redeemedId);
  expect(
    (
      await fetch(`${baseUrl}/api/v1/auth/student/invitations/redeem`, {
        method: 'POST',
        headers: { ...csrfHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          recipient: 'luis.santos@example.edu',
          code: invitationCode,
        }),
      })
    ).status,
  ).toBe(200);

  const closed = await client.POST('/api/v1/administration/classes/closures', {
    headers,
    body: {
      operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5404',
      classId: closingId,
    },
  });
  expect(closed.response.status).toBe(200);
  expect(closed.data).toEqual({
    operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5404',
    classId: closingId,
    outcome: 'closed',
    revokedInvitationCount: 1,
    deactivatedMembershipCount: 1,
  });

  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: headers.cookie },
  });
  const closedClass = directory.data?.classes.find(
    (entry) => entry.classId === closingId,
  );
  expect(closedClass?.status).toBe('closed');
  expect(closedClass?.closedAt).toBe(now.toISOString());
  expect(
    closedClass?.relationships.find(
      (entry) => entry.recipient === 'jordan.smith@example.edu',
    )?.latestInvitation.status,
  ).toBe('revoked');
  expect(
    closedClass?.relationships.find(
      (entry) => entry.recipient === 'luis.santos@example.edu',
    )?.membershipStatus,
  ).toBe('inactive');
  expect(JSON.stringify(closedClass)).not.toMatch(/intake|learning|progress/i);
  expect(JSON.stringify(closedClass)).not.toContain(invitationCode);

  const preview = await client.POST(
    '/api/v1/administration/classes/invitation-previews',
    {
      headers,
      body: { classId: closingId, recipient: 'new.student@example.edu' },
    },
  );
  expect(preview.data).toEqual({ outcome: 'class_closed' });
  const send = await client.POST('/api/v1/administration/classes/invitations', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: closingId,
      invitationId: crypto.randomUUID(),
      recipient: 'new.student@example.edu',
    },
  });
  expect(send.response.status).toBe(409);
  expect(send.error).toMatchObject({ code: 'CLASS_CLOSED' });
});

test('Administrator Class workspace keeps singular roster rows and confirmation copy', async () => {
  const staffHome = await readFile(
    new URL('../../src/features/staff/StaffHomePage.tsx', import.meta.url),
    'utf8',
  );
  const workspace = await readFile(
    new URL('../../src/features/staff/ClassWorkspace.tsx', import.meta.url),
    'utf8',
  );
  const source = `${staffHome}\n${workspace}`;
  expect(source).toContain('id="class-name"');
  expect(workspace.match(/id="invitation-recipient"/g)?.length).toBe(1);
  expect(workspace).toContain('Needs follow-up');
  expect(workspace).toContain('Active access');
  expect(workspace).toContain('Closed classes');
  expect(workspace).toContain('Students');
  expect(workspace).not.toContain(' people');
  expect(workspace).toContain('Deactivate Class Membership');
  expect(workspace).toContain('Expires ');
  expect(workspace).toContain('Closed Class · read-only history');
  expect(source).toContain(
    'Outstanding Invitation Codes become unusable. An already-redeemed Class Membership is unaffected.',
  );
  expect(source).toContain(
    'Only this Class access ends. The Student identity, other active Class Memberships, Intake Record, and Learning Progress remain. Reactivation requires a fresh Invitation.',
  );
  expect(source).toContain(
    'This closes the Class. Pending Invitations are revoked and active Class Memberships are deactivated. History is preserved. Reuse requires creating a new Class.',
  );
  expect(source).toContain('Import a CSV');
  expect(source).toContain('id="invitation-csv-file"');
});
