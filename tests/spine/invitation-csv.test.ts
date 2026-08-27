import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../apps/server/src/app.ts';
import {
  invitationCsvMaxBytes,
  invitationCsvMaxRows,
  parseInvitationCsv,
} from '../../modules/identity-access/index.ts';
import { createApiClient } from '../../packages/api-client/src/index.ts';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import {
  createRuntimeDatabaseUser,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from '../../packages/test-support/src/postgres.ts';
import { createFakeStaffAuth } from '../../packages/test-support/src/staff-auth.ts';
import { totpCode } from '../../packages/test-support/src/totp.ts';

const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6001';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6002';
const classId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6003';
const otherClassId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6004';
const sendClassId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6005';
const staleClassId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6006';
const invitationCode = '729104';
const password = 'correct-horse-battery-staple';
const administratorEmail = 'administrator@example.test';
const origin = 'http://127.0.0.1';
const csrfHeaders = {
  origin,
  'x-prevcare-csrf': '1',
} as const;
const operatorHeaders = {
  authorization: `Bearer ${'test-operator-token-with-more-than-32-characters'}`,
  ...csrfHeaders,
} as const;

let now = new Date('2026-08-26T18:00:00.000Z');
let postgres: EphemeralPostgres;
let server: FastifyInstance;
let baseUrl: string;
let cookie = '';
const fakeAuth = createFakeStaffAuth();
const telemetryLines: string[] = [];

function staffHeaders() {
  return {
    ...csrfHeaders,
    cookie,
  };
}

async function postCsv(
  path:
    | '/api/v1/administration/classes/invitation-csv-previews'
    | '/api/v1/administration/classes/invitation-csv-sends',
  body: unknown,
) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...staffHeaders(),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
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
  const runtimeDatabaseUrl = await createRuntimeDatabaseUser(
    postgres.connectionString,
  );
  server = await createServer({
    databaseUrl: runtimeDatabaseUrl,
    publicOrigin: origin,
    operatorCredentials: {
      token: 'test-operator-token-with-more-than-32-characters',
      actorId: 'operator',
    },
    staffAuth: fakeAuth.provider,
    clock: { now: () => now },
    invitationSecrets: {
      hmacKey: Buffer.alloc(32, 7),
      encryptionKeys: { test: Buffer.alloc(32, 9) },
      activeEncryptionKeyId: 'test',
      createCode: () => invitationCode,
    },
    telemetry: {
      record(event) {
        telemetryLines.push(JSON.stringify(event));
      },
    },
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
        displayName: 'Franklin Middle School',
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
      displayName: 'Marcus Chen',
      email: administratorEmail,
      permissions: ['administrative'],
      schoolApprover: 'principal',
      reason: 'CSV invitation test',
      initialPassword: password,
    },
  });
  expect(staff.response.status).toBe(201);
  const signIn = await client.POST('/api/v1/auth/staff/sign-in', {
    headers: csrfHeaders,
    body: { email: administratorEmail, password },
  });
  expect(signIn.response.status).toBe(200);
  const authenticated = await client.POST('/api/v1/auth/staff/totp', {
    headers: csrfHeaders,
    body: {
      flowHandle: signIn.data?.flowHandle ?? '',
      code: totpCode(fakeAuth.totpSecretFor(administratorEmail)),
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

test('CSV parser classifies malformed and duplicate-in-file rows without guessing identity', () => {
  const paddedDuplicate = '  SOFIA.ORTIZ@EXAMPLE.EDU  ';
  const parsed = parseInvitationCsv(`email
sofia.ortiz@example.edu
not-an-email
${paddedDuplicate}
noah.williams@example.edu
`);
  expect(parsed).toEqual({
    outcome: 'parsed',
    rows: [
      {
        lineNumber: 2,
        field: 'sofia.ortiz@example.edu',
        kind: 'candidate',
        recipient: 'sofia.ortiz@example.edu',
      },
      {
        lineNumber: 3,
        field: 'not-an-email',
        kind: 'malformed',
      },
      {
        lineNumber: 4,
        field: 'SOFIA.ORTIZ@EXAMPLE.EDU',
        kind: 'duplicate_in_file',
        recipient: 'sofia.ortiz@example.edu',
      },
      {
        lineNumber: 5,
        field: 'noah.williams@example.edu',
        kind: 'candidate',
        recipient: 'noah.williams@example.edu',
      },
    ],
  });
});

test('CSV parser rejects oversized files and too many rows with file-level reasons', () => {
  expect(parseInvitationCsv('a'.repeat(invitationCsvMaxBytes + 1))).toEqual({
    outcome: 'rejected',
    reason: 'too_large',
  });
  expect(
    parseInvitationCsv(
      Array.from(
        { length: invitationCsvMaxRows + 1 },
        (_, index) => `student.${index}@example.edu`,
      ).join('\n'),
    ),
  ).toEqual({
    outcome: 'rejected',
    reason: 'too_many_rows',
  });
  expect(parseInvitationCsv('   \n\n')).toEqual({
    outcome: 'rejected',
    reason: 'empty',
  });
});

test('CSV preview distinguishes mixed-quality rows without changing domain state', async () => {
  const client = createApiClient(baseUrl);
  const headers = staffHeaders();
  await client.POST('/api/v1/administration/classes/definitions', {
    headers,
    body: {
      operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6101',
      classId,
      name: 'Health Literacy 7A',
    },
  });
  await client.POST('/api/v1/administration/classes/definitions', {
    headers,
    body: {
      operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6102',
      classId: otherClassId,
      name: 'Spring Wellness',
    },
  });

  const pendingId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6103';
  const memberId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6104';
  const elsewhereId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6105';
  const historicalId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6106';
  await client.POST('/api/v1/administration/classes/invitations', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId,
      invitationId: pendingId,
      recipient: 'already.invited@example.edu',
    },
  });
  await client.POST('/api/v1/administration/classes/invitations', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId,
      invitationId: memberId,
      recipient: 'already.member@example.edu',
    },
  });
  await markInvitationDelivered(memberId);
  expect(
    (
      await fetch(`${baseUrl}/api/v1/auth/student/invitations/redeem`, {
        method: 'POST',
        headers: { ...csrfHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          recipient: 'already.member@example.edu',
          code: invitationCode,
        }),
      })
    ).status,
  ).toBe(200);
  await client.POST('/api/v1/administration/classes/invitations', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: otherClassId,
      invitationId: elsewhereId,
      recipient: 'existing.elsewhere@example.edu',
    },
  });
  await markInvitationDelivered(elsewhereId);
  expect(
    (
      await fetch(`${baseUrl}/api/v1/auth/student/invitations/redeem`, {
        method: 'POST',
        headers: { ...csrfHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          recipient: 'existing.elsewhere@example.edu',
          code: invitationCode,
        }),
      })
    ).status,
  ).toBe(200);
  await client.POST('/api/v1/administration/classes/invitations', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: otherClassId,
      invitationId: historicalId,
      recipient: 'historical.student@example.edu',
    },
  });
  await markInvitationDelivered(historicalId);
  expect(
    (
      await fetch(`${baseUrl}/api/v1/auth/student/invitations/redeem`, {
        method: 'POST',
        headers: { ...csrfHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          recipient: 'historical.student@example.edu',
          code: invitationCode,
        }),
      })
    ).status,
  ).toBe(200);
  await retireCurrentEmail(historicalId);

  const csv = `email
ready.student@example.edu
not-an-email
READY.STUDENT@EXAMPLE.EDU
already.invited@example.edu
already.member@example.edu
historical.student@example.edu
existing.elsewhere@example.edu
`;
  const before = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: headers.cookie },
  });
  const beforeClass = before.data?.classes.find(
    (entry) => entry.classId === classId,
  );
  expect(beforeClass?.relationships).toHaveLength(2);

  const preview = await postCsv(
    '/api/v1/administration/classes/invitation-csv-previews',
    { classId, csv },
  );
  expect(preview.status).toBe(200);
  const body = (await preview.json()) as {
    rows: {
      lineNumber: number;
      field: string;
      outcome: string;
      reuse?: string;
      reason?: string;
    }[];
    summary: { ready: number; skipped: number };
  };
  expect(body.summary).toEqual({ ready: 2, skipped: 5 });
  expect(body.rows).toEqual([
    {
      lineNumber: 2,
      field: 'ready.student@example.edu',
      outcome: 'ready',
      reuse: 'none',
    },
    {
      lineNumber: 3,
      field: 'not-an-email',
      outcome: 'malformed',
    },
    {
      lineNumber: 4,
      field: 'READY.STUDENT@EXAMPLE.EDU',
      outcome: 'duplicate_in_file',
    },
    {
      lineNumber: 5,
      field: 'already.invited@example.edu',
      outcome: 'already_invited',
    },
    {
      lineNumber: 6,
      field: 'already.member@example.edu',
      outcome: 'already_a_member',
    },
    {
      lineNumber: 7,
      field: 'historical.student@example.edu',
      outcome: 'identity_review',
      reason: 'historical_binding',
    },
    {
      lineNumber: 8,
      field: 'existing.elsewhere@example.edu',
      outcome: 'ready',
      reuse: 'existing_student',
    },
  ]);
  expect(JSON.stringify(body)).not.toContain(invitationCode);

  const after = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: headers.cookie },
  });
  expect(
    after.data?.classes.find((entry) => entry.classId === classId)
      ?.relationships,
  ).toEqual(beforeClass?.relationships);

  const oversized = await postCsv(
    '/api/v1/administration/classes/invitation-csv-previews',
    { classId, csv: 'a'.repeat(invitationCsvMaxBytes + 1) },
  );
  expect(oversized.status).toBe(422);
  expect(await oversized.json()).toMatchObject({
    code: 'INVITATION_CSV_REJECTED',
    reason: 'too_large',
  });
  expect(telemetryLines.join('\n')).not.toContain('ready.student@example.edu');
  expect(telemetryLines.join('\n')).not.toContain('already.member@example.edu');
});

test('only explicitly selected ready CSV rows create Invitations and outbox work', async () => {
  const client = createApiClient(baseUrl);
  const headers = staffHeaders();
  await client.POST('/api/v1/administration/classes/definitions', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: sendClassId,
      name: 'CSV Send Class',
    },
  });
  const csv = `email
first.ready@example.edu
skip.me@example.edu
not-an-email
FIRST.READY@EXAMPLE.EDU
`;
  const operationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6201';
  const sent = await postCsv(
    '/api/v1/administration/classes/invitation-csv-sends',
    {
      operationId,
      classId: sendClassId,
      csv,
      selectedLineNumbers: [2],
    },
  );
  expect(sent.status).toBe(201);
  const body = (await sent.json()) as {
    operationId: string;
    classId: string;
    outcome: string;
    summary: { sent: number; skipped: number; deliveryProblems: number };
    rows: {
      lineNumber: number;
      field: string;
      outcome: string;
      invitationId?: string;
      reuse?: string;
    }[];
  };
  expect(body.operationId).toBe(operationId);
  expect(body.classId).toBe(sendClassId);
  expect(body.outcome).toBe('applied');
  expect(body.summary).toEqual({ sent: 1, skipped: 3, deliveryProblems: 0 });
  expect(body.rows).toMatchObject([
    {
      lineNumber: 2,
      field: 'first.ready@example.edu',
      outcome: 'sent',
      reuse: 'none',
    },
    { lineNumber: 3, field: 'skip.me@example.edu', outcome: 'not_selected' },
    { lineNumber: 4, field: 'not-an-email', outcome: 'malformed' },
    {
      lineNumber: 5,
      field: 'FIRST.READY@EXAMPLE.EDU',
      outcome: 'duplicate_in_file',
    },
  ]);
  expect(body.rows[0]?.invitationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  expect(JSON.stringify(body)).not.toContain(invitationCode);

  const replay = await postCsv(
    '/api/v1/administration/classes/invitation-csv-sends',
    {
      operationId,
      classId: sendClassId,
      csv,
      selectedLineNumbers: [2, 3],
    },
  );
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual(body);

  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: headers.cookie },
  });
  const sendClass = directory.data?.classes.find(
    (entry) => entry.classId === sendClassId,
  );
  expect(sendClass?.relationships.map((row) => row.recipient)).toEqual([
    'first.ready@example.edu',
  ]);
  expect(sendClass?.relationships[0]?.latestInvitation.status).toBe(
    'pending_delivery',
  );

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const outbox = await inspection.query<{ count: string }>(
      `select count(*)::text as count from infrastructure.outbox
        where workspace_id = $1 and topic = 'invitation.delivery_requested'`,
      [workspaceId],
    );
    expect(Number(outbox.rows[0]?.count)).toBeGreaterThanOrEqual(1);
    const invitations = await inspection.query<{ count: string }>(
      `select count(*)::text as count from identity_access.invitations
        where class_id = $1`,
      [sendClassId],
    );
    expect(invitations.rows[0]?.count).toBe('1');
  } finally {
    await inspection.end();
  }
  expect(telemetryLines.join('\n')).not.toContain('first.ready@example.edu');
});

test('stale bulk send authorization creates nothing and is not reported as success', async () => {
  const client = createApiClient(baseUrl);
  const headers = staffHeaders();
  await client.POST('/api/v1/administration/classes/definitions', {
    headers,
    body: {
      operationId: crypto.randomUUID(),
      classId: staleClassId,
      name: 'Stale CSV Class',
    },
  });
  now = new Date(now.getTime() + 14 * 60 * 1000);
  expect(
    (await client.GET('/api/v1/staff/session', { headers: { cookie } }))
      .response.status,
  ).toBe(200);
  now = new Date(now.getTime() + 2 * 60 * 1000);

  const csv = 'fresh.student@example.edu\n';
  const operationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6301';
  const stale = await postCsv(
    '/api/v1/administration/classes/invitation-csv-sends',
    {
      operationId,
      classId: staleClassId,
      csv,
      selectedLineNumbers: [1],
    },
  );
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({
    code: 'AUTHENTICATION_FRESHNESS_REQUIRED',
  });

  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: headers.cookie },
  });
  expect(
    directory.data?.classes.find((entry) => entry.classId === staleClassId)
      ?.relationships,
  ).toEqual([]);

  const rejected = await client.POST('/api/v1/auth/staff/step-up', {
    headers,
    body: { password: 'wrong password', totp: '000000' },
  });
  expect(rejected.response.status).toBe(401);

  const steppedUp = await client.POST('/api/v1/auth/staff/step-up', {
    headers,
    body: {
      password,
      totp: totpCode(fakeAuth.totpSecretFor(administratorEmail)),
    },
  });
  expect(steppedUp.response.status).toBe(200);

  const sent = await postCsv(
    '/api/v1/administration/classes/invitation-csv-sends',
    {
      operationId,
      classId: staleClassId,
      csv,
      selectedLineNumbers: [1],
    },
  );
  expect(sent.status).toBe(201);
  expect(await sent.json()).toMatchObject({
    operationId,
    classId: staleClassId,
    outcome: 'applied',
    summary: { sent: 1, skipped: 0, deliveryProblems: 0 },
  });
});

test('Class workspace CSV import is keyboard operable with announcements and reflow', async () => {
  const workspace = await readFile(
    new URL('../../src/features/staff/ClassWorkspace.tsx', import.meta.url),
    'utf8',
  );
  expect(workspace).toContain('id="invitation-csv-file"');
  expect(workspace).toContain('id="csv-step-up-password"');
  expect(workspace).toContain('id="csv-step-up-totp"');
  expect(workspace).toContain('htmlFor="invitation-csv-file"');
  expect(workspace).toContain('htmlFor={checkboxId}');
  expect(workspace).toContain('aria-live="polite"');
  expect(workspace).toContain('role="dialog"');
  expect(workspace).toContain('aria-modal="true"');
  expect(workspace).toContain('focus-visible:outline');
  expect(workspace).toContain('sm:items-center');
  expect(workspace).toContain('sm:grid-cols-[auto_1fr_auto]');
  expect(workspace).toContain('flex-wrap');
  expect(workspace).toContain('Add one email address');
  expect(workspace).toContain('Import a CSV');
  expect(workspace).toContain(
    'This CSV is too large. Use at most 500 rows and 32 KB.',
  );
  expect(workspace).toContain(
    'This CSV has too many rows. Use at most 500 rows.',
  );
  expect(workspace).toContain(
    'Sent ${result.data.summary.sent} Invitations. ${result.data.summary.skipped} skipped. Delivery is pending.',
  );
  expect(workspace).toContain('Nothing is sent until you select ready rows');
  expect(workspace.match(/id="invitation-recipient"/g)?.length).toBe(1);
});
