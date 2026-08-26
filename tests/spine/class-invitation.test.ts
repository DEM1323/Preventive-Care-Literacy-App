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

const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf3001';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf3002';
const classId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf3003';
const invitationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf3004';
const operationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf3005';
const sessionHandle = 'opaque-administrator-session-handle';
const recipient = ' Student.One@Example.Test ';
const now = new Date('2026-08-24T12:00:00.000Z');
const csrfHeaders = {
  origin: 'http://127.0.0.1',
  'x-prevcare-csrf': '1',
} as const;

let postgres: EphemeralPostgres;
let server: FastifyInstance;
let baseUrl: string;

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
      createCode: () => '729104',
    },
  });
  baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
});

test('Administrator creates one Class and one protected purpose-bound Invitation atomically', async () => {
  const client = createApiClient(baseUrl);
  const headers = {
    ...csrfHeaders,
    cookie: `__Host-prevcare-staff-session=${sessionHandle}`,
  };
  const command = {
    operationId,
    classId,
    invitationId,
    name: 'Health Literacy 7A',
    recipient,
  };

  const created = await client.POST('/api/v1/administration/classes', {
    headers,
    body: command,
  });
  expect(created.response.status).toBe(201);
  expect(created.data).toEqual({
    operationId,
    classId,
    invitationId,
    outcome: 'created',
  });
  expect(JSON.stringify(created.data)).not.toContain('729104');
  expect(JSON.stringify(created.data)).not.toContain('example.test');

  const replay = await client.POST('/api/v1/administration/classes', {
    headers,
    body: command,
  });
  expect(replay.response.status).toBe(201);
  expect(replay.data).toEqual(created.data);

  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: headers.cookie },
  });
  expect(directory.response.status).toBe(200);
  expect(directory.data).toEqual({
    classes: [
      {
        classId,
        name: 'Health Literacy 7A',
        createdAt: now.toISOString(),
        status: 'open',
        closedAt: null,
        invitations: [
          {
            invitationId,
            purpose: 'join_class',
            generation: 1,
            status: 'pending_delivery',
            expiresAt: new Date(
              now.getTime() + 7 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          },
        ],
        relationships: [
          {
            recipient: 'student.one@example.test',
            studentId: null,
            classMembershipId: null,
            membershipStatus: 'none',
            latestInvitation: {
              invitationId,
              purpose: 'join_class',
              generation: 1,
              status: 'pending_delivery',
              expiresAt: new Date(
                now.getTime() + 7 * 24 * 60 * 60 * 1000,
              ).toISOString(),
            },
            deliveryStatus: 'delayed',
            history: [
              {
                invitationId,
                status: 'pending_delivery',
                generation: 1,
                createdAt: now.toISOString(),
              },
            ],
          },
        ],
      },
    ],
  });
  expect(JSON.stringify(directory.data)).not.toContain('729104');
  expect(JSON.stringify(directory.data)).not.toContain('Student.One');

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const records = await inspection.query<{
      recipient_digest: string;
      code_digest: string;
      current_generation: number;
      ciphertext: string;
      key_id: string;
      outbox_id: string;
      payload: { invitationId?: string; generation?: number };
      event_type: string;
      command_name: string;
    }>(
      `select invitation.recipient_digest, challenge.code_digest,
              invitation.current_generation, delivery.ciphertext, delivery.key_id,
              outbox.outbox_id, outbox.payload, audit.event_type, receipt.command_name
         from identity_access.invitations invitation
         join identity_access.invitation_challenges challenge using (invitation_id)
         join identity_access.invitation_deliveries delivery using (invitation_id, generation)
         join infrastructure.operation_receipts receipt using (workspace_id)
         join audit.evidence audit using (workspace_id, operation_id)
         join infrastructure.outbox outbox using (workspace_id, operation_id)
        where invitation.invitation_id = $1 and receipt.operation_id = $2`,
      [invitationId, operationId],
    );
    expect(records.rows).toHaveLength(1);
    expect(records.rows[0]).toMatchObject({
      current_generation: 1,
      key_id: 'test',
      payload: { invitationId, generation: 1 },
      event_type: 'class_invitation.created',
      command_name: 'createClassInvitation',
    });
    expect(records.rows[0]?.payload).toEqual({ invitationId, generation: 1 });
    expect(records.rows[0]?.recipient_digest).not.toContain('example.test');
    expect(records.rows[0]?.code_digest).not.toContain('729104');
    expect(records.rows[0]?.ciphertext).not.toContain('example.test');
    expect(records.rows[0]?.ciphertext).not.toContain('729104');

    await inspection.query(
      `insert into identity_access.invitation_challenges
         (invitation_id, generation, purpose, code_digest, expires_at)
       values ($1, 2, 'join_class', 'replacement-digest', $2)`,
      [invitationId, new Date(now.getTime() + 24 * 60 * 60 * 1000)],
    );
    await inspection.query(
      `insert into identity_access.invitation_deliveries
         (invitation_id, generation, key_id, ciphertext, status, provider_idempotency_key)
       values ($1, 2, 'test', 'replacement-protected', 'pending', $2)`,
      [invitationId, `${invitationId}:2`],
    );
    await inspection.query(
      `update identity_access.invitations set current_generation = 2
        where invitation_id = $1`,
      [invitationId],
    );
    const staleClaim = await inspection.query<{ outcome: string }>(
      'select outcome from infrastructure.claim_invitation_delivery($1, $2)',
      [records.rows[0]?.outbox_id, now],
    );
    expect(staleClaim.rows).toEqual([{ outcome: 'suppressed' }]);
    const staleState = await inspection.query<{
      old_status: string;
      current_status: string;
      outbox_status: string;
    }>(
      `select old_delivery.status as old_status,
              current_delivery.status as current_status,
              outbox.status as outbox_status
         from identity_access.invitation_deliveries old_delivery
         join identity_access.invitation_deliveries current_delivery
           on current_delivery.invitation_id = old_delivery.invitation_id
          and current_delivery.generation = 2
         join infrastructure.outbox outbox on outbox.outbox_id = $2
        where old_delivery.invitation_id = $1 and old_delivery.generation = 1`,
      [invitationId, records.rows[0]?.outbox_id],
    );
    expect(staleState.rows).toEqual([
      {
        old_status: 'suppressed',
        current_status: 'pending',
        outbox_status: 'completed',
      },
    ]);

    await inspection.query(
      `delete from identity_access.staff_permission_grants
        where staff_identity_id = $1 and permission = 'administrative'`,
      [staffIdentityId],
    );
  } finally {
    await inspection.end();
  }

  const denied = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: headers.cookie },
  });
  expect(denied.response.status).toBe(403);
  expect(denied.error).toMatchObject({ code: 'STAFF_PERMISSION_REQUIRED' });
});
