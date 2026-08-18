import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../apps/server/src/app.ts';
import { createApiClient } from '../../packages/api-client/src/index.ts';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import {
  countVisibleSchoolWorkspaces,
  createRuntimeDatabaseUser,
  inspectSpineOperation,
  schoolWorkspaceExists,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from '../../packages/test-support/src/postgres.ts';

const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1001';
const operationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1002';
const auditId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1003';
const outboxId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1004';
const conflictingOperationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1005';
const rollbackWorkspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1006';
const rollbackOperationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1007';
const rollbackAuditId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1008';
const conflictingAuditId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1009';
const conflictingOutboxId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1010';
const concurrentWorkspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1011';
const concurrentOperationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1012';
const concurrentAuditId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1013';
const concurrentOutboxId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1014';
const occurredAt = new Date('2026-08-18T15:00:00.000Z');
const operatorToken = 'test-operator-token-with-more-than-32-characters';
const authorization = `Bearer ${operatorToken}`;

let postgres: EphemeralPostgres;
let server: FastifyInstance;
let baseUrl: string;
let runtimeDatabaseUrl: string;

beforeAll(async () => {
  const generatedIds = [
    auditId,
    outboxId,
    conflictingAuditId,
    conflictingOutboxId,
    rollbackAuditId,
    outboxId,
    concurrentAuditId,
    concurrentOutboxId,
  ];
  postgres = await startEphemeralPostgres();
  await migrate(postgres.connectionString);
  runtimeDatabaseUrl = await createRuntimeDatabaseUser(
    postgres.connectionString,
  );
  server = await createServer({
    databaseUrl: runtimeDatabaseUrl,
    operatorCredentials: {
      token: operatorToken,
      actorId: 'operator@example.test',
    },
    clock: { now: () => occurredAt },
    ids: { create: () => generatedIds.shift() ?? crypto.randomUUID() },
  });
  baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
});

test('createSchoolWorkspace authorizes and atomically commits governed records', async () => {
  const client = createApiClient(baseUrl);
  const command = {
    operationId,
    workspaceId,
    displayName: 'Franklin Middle School',
  };

  await expect(
    createServer({
      databaseUrl: postgres.connectionString,
      operatorCredentials: {
        token: operatorToken,
        actorId: 'operator@example.test',
      },
    }),
  ).rejects.toThrow(
    'The application database role must not own protected objects or bypass row-level security',
  );
  const ownerMemberDatabaseUrl = await createRuntimeDatabaseUser(
    postgres.connectionString,
    {
      mayAssumeOwnerRole: true,
    },
  );
  await expect(
    createServer({
      databaseUrl: ownerMemberDatabaseUrl,
      operatorCredentials: {
        token: operatorToken,
        actorId: 'operator@example.test',
      },
    }),
  ).rejects.toThrow(
    'The application database role must not own protected objects or bypass row-level security',
  );

  const unauthorized = await client.POST(
    '/api/v1/administration/school-workspaces',
    {
      body: command,
    },
  );
  expect(unauthorized.response.status).toBe(401);
  expect(unauthorized.response.headers.get('content-type')).toContain(
    'application/problem+json',
  );
  expect(unauthorized.error).toEqual({
    type: 'https://preventive-care-literacy.example/problems/operator-authentication',
    title: 'Operator authentication required',
    status: 401,
    code: 'OPERATOR_AUTHENTICATION_REQUIRED',
  });
  const invalid = await client.POST(
    '/api/v1/administration/school-workspaces',
    {
      body: { ...command, displayName: '   ' },
      headers: { authorization },
    },
  );
  expect(invalid.response.status).toBe(400);
  expect(invalid.error).toEqual({
    type: 'https://preventive-care-literacy.example/problems/invalid-request',
    title: 'Request validation failed',
    status: 400,
    code: 'INVALID_REQUEST',
  });

  const created = await client.POST(
    '/api/v1/administration/school-workspaces',
    {
      body: command,
      headers: { authorization },
    },
  );
  const replayed = await client.POST(
    '/api/v1/administration/school-workspaces',
    {
      body: command,
      headers: { authorization },
    },
  );

  expect(created.response.status).toBe(201);
  expect(created.data).toEqual({
    operationId,
    workspaceId,
    outcome: 'created',
  });
  expect(replayed.response.status).toBe(201);
  expect(replayed.data).toEqual(created.data);
  expect(
    await inspectSpineOperation(postgres.connectionString, operationId),
  ).toEqual({
    workspace: {
      workspaceId,
      displayName: 'Franklin Middle School',
      recordOwner: 'school',
      recordClassification: 'school_administrative',
      disposalClass: 'school_workspace',
    },
    receipt: {
      workspaceId,
      operationId,
      commandName: 'createSchoolWorkspace',
      recordOwner: 'school',
      recordClassification: 'operational_evidence',
      disposalClass: 'operation_receipt',
    },
    audit: {
      auditId,
      workspaceId,
      operationId,
      eventType: 'school_workspace.created',
      actorType: 'technical_operator',
      actorId: 'operator@example.test',
      occurredAt: occurredAt.toISOString(),
      recordOwner: 'school',
      recordClassification: 'audit_evidence',
      disposalClass: 'workspace_audit_evidence',
    },
    outbox: {
      outboxId,
      workspaceId,
      operationId,
      topic: 'school_workspace.created',
      status: 'pending',
      recordOwner: 'school',
      recordClassification: 'operational_evidence',
      disposalClass: 'transactional_outbox',
    },
  });

  const conflict = await client.POST(
    '/api/v1/administration/school-workspaces',
    {
      body: { ...command, operationId: conflictingOperationId },
      headers: { authorization },
    },
  );
  expect(conflict.response.status).toBe(409);
  expect(conflict.error).toEqual({
    type: 'https://preventive-care-literacy.example/problems/school-workspace-exists',
    title: 'School Workspace already exists',
    status: 409,
    code: 'SCHOOL_WORKSPACE_EXISTS',
  });
  expect(
    await inspectSpineOperation(
      postgres.connectionString,
      conflictingOperationId,
    ),
  ).toEqual({
    workspace: undefined,
    receipt: undefined,
    audit: undefined,
    outbox: undefined,
  });

  const rolledBack = await client.POST(
    '/api/v1/administration/school-workspaces',
    {
      body: {
        ...command,
        operationId: rollbackOperationId,
        workspaceId: rollbackWorkspaceId,
      },
      headers: { authorization },
    },
  );
  expect(rolledBack.response.status).toBe(500);
  expect(rolledBack.error).toEqual({
    type: 'https://preventive-care-literacy.example/problems/internal-error',
    title: 'Internal server error',
    status: 500,
    code: 'INTERNAL_ERROR',
  });
  expect(
    await inspectSpineOperation(postgres.connectionString, rollbackOperationId),
  ).toEqual({
    workspace: undefined,
    receipt: undefined,
    audit: undefined,
    outbox: undefined,
  });
  expect(
    await schoolWorkspaceExists(postgres.connectionString, rollbackWorkspaceId),
  ).toBe(false);
  expect(await countVisibleSchoolWorkspaces(runtimeDatabaseUrl)).toBe(0);

  const concurrentCommand = {
    ...command,
    workspaceId: concurrentWorkspaceId,
    operationId: concurrentOperationId,
  };
  const concurrentResults = await Promise.all([
    client.POST('/api/v1/administration/school-workspaces', {
      body: concurrentCommand,
      headers: { authorization },
    }),
    client.POST('/api/v1/administration/school-workspaces', {
      body: concurrentCommand,
      headers: { authorization },
    }),
  ]);
  expect(concurrentResults.map(({ response }) => response.status)).toEqual([
    201, 201,
  ]);
  expect(concurrentResults.map(({ data }) => data)).toEqual([
    {
      operationId: concurrentOperationId,
      workspaceId: concurrentWorkspaceId,
      outcome: 'created',
    },
    {
      operationId: concurrentOperationId,
      workspaceId: concurrentWorkspaceId,
      outcome: 'created',
    },
  ]);
  expect(
    (
      await inspectSpineOperation(
        postgres.connectionString,
        concurrentOperationId,
      )
    ).audit?.auditId,
  ).toBe(concurrentAuditId);
});
