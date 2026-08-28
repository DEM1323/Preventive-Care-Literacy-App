import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { Client, Pool } from 'pg';
import { createServer } from '../../apps/server/src/app.ts';
import {
  PermanentInvitationDeliveryError,
  runInvitationDeliveryCycle,
  runSignInCodeDeliveryCycle,
} from '../../modules/invitation-delivery/index.ts';
import type {
  IntakeFormField,
  StudentIntakeSnapshot,
} from '../../modules/intake/index.ts';
import type { StudentLearningSnapshot } from '../../modules/learning-progress/index.ts';
import type { RepairableWorkItem } from '../../modules/operator-repair/index.ts';
import { createEnvelopeKeyManagement } from '../../packages/application-keys/src/index.ts';
import { createApiClient } from '../../packages/api-client/src/index.ts';
import {
  decryptInvitationDelivery,
  decryptSignInDelivery,
} from '../../packages/invitation-secrets/src/index.ts';
import {
  createPostgresInvitationDeliveryPorts,
  createPostgresSignInDeliveryPorts,
} from '../../packages/postgres/src/invitation-delivery.ts';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import {
  createRuntimeDatabaseUser,
  inspectSpineOperation,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from '../../packages/test-support/src/postgres.ts';
import { createFakeStaffAuth } from '../../packages/test-support/src/staff-auth.ts';
import { totpCode } from '../../packages/test-support/src/totp.ts';
import { createUnavailableTranslationAdapter } from '../../modules/school-configuration/index.ts';
import { createDeterministicTranslationAdapter } from '../../packages/translation-adapter/src/index.ts';

const workspaceId = 'beb4193a-1e8f-4096-a449-6d77628fd275';
const administratorId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8101';
const clinicianId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8102';
const classId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8103';
const invitationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8104';
const administratorEmail = 'administrator.repair@example.test';
const clinicianEmail = 'clinician.repair@example.test';
const password = 'correct horse battery staple';
const recipient = 'student.repair@example.test';
const invitationCode = '729104';
const origin = 'http://127.0.0.1';
const operatorToken = 'evolution-repair-operator-token-'.padEnd(40, 'x');
const operatorHeaders = {
  authorization: `Bearer ${operatorToken}`,
  origin,
  'x-prevcare-csrf': '1',
} as const;
const mutationHeaders = {
  origin,
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;
const primaryCareModuleId = '16481542-3831-4d18-aa0c-f138fbc7a970';
const firstKnowledgeId = '1fa49d99-82a5-4614-a11c-c5142b367632';
const nameFieldId = '22f0fc76-42bb-421c-8e61-44604a8765d8';

let now = new Date('2026-08-28T12:00:00.000Z');
let postgres: EphemeralPostgres;
let runtimeDatabaseUrl: string;
let server: FastifyInstance;
let baseUrl: string;
let administratorCookie: string;
let clinicianCookie: string;
let studentCookie: string;
let candidate: unknown;
let telemetryLines: string[] = [];
let generatedCode = invitationCode;
let failSeal = false;
let translationAdapter = createDeterministicTranslationAdapter();
const fakeAuth = createFakeStaffAuth();
const wrappingKeys = {
  wrappingKeys: { test: Buffer.alloc(32, 13) },
  activeWrappingKeyId: 'test',
  idempotencyKey: Buffer.alloc(32, 19),
};
const envelopeKeys = createEnvelopeKeyManagement(wrappingKeys);
const invitationSecretKeys = {
  hmacKey: Buffer.alloc(32, 7),
  encryptionKeys: { test: Buffer.alloc(32, 9) },
  activeEncryptionKeyId: 'test',
  createCode: () => generatedCode,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNoProtectedResidue(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(recipient);
  expect(serialized).not.toContain(invitationCode);
  expect(serialized).not.toContain(password);
  expect(serialized).not.toContain('729104');
}

function createMemoryQueue() {
  const jobs: { messageId: string; outboxId: string; attempt: number }[] = [];
  return {
    jobs,
    async send(payload: { outboxId: string }) {
      if (!jobs.some((job) => job.outboxId === payload.outboxId)) {
        jobs.push({
          messageId: payload.outboxId,
          outboxId: payload.outboxId,
          attempt: 1,
        });
      }
    },
    async receive() {
      return jobs[0];
    },
    async complete() {
      jobs.shift();
    },
    async retry() {
      const job = jobs[0];
      if (job) job.attempt += 1;
    },
  };
}

function ownerDeliveryPool() {
  return new Pool({ connectionString: postgres.connectionString });
}

async function failInvitationDelivery(outboxId: string) {
  const pool = ownerDeliveryPool();
  const ports = createPostgresInvitationDeliveryPorts(pool);
  const queue = createMemoryQueue();
  await queue.send({ outboxId });
  await runInvitationDeliveryCycle({
    ...ports,
    outbox: { pending: async () => [] },
    queue,
    decrypt: (input) =>
      decryptInvitationDelivery({
        keys: invitationSecretKeys,
        keyId: input.keyId,
        ciphertext: input.ciphertext,
        invitationId: input.invitationId,
        purpose: input.purpose,
        generation: input.generation,
      }),
    mail: {
      async sendInvitation() {
        throw new PermanentInvitationDeliveryError();
      },
    },
    clock: { now: () => now },
  });
  await pool.end();
  return outboxId;
}

async function deliverInvitation(outboxId: string) {
  const pool = ownerDeliveryPool();
  const ports = createPostgresInvitationDeliveryPorts(pool);
  const queue = createMemoryQueue();
  await queue.send({ outboxId });
  await runInvitationDeliveryCycle({
    ...ports,
    outbox: { pending: async () => [] },
    queue,
    decrypt: (input) =>
      decryptInvitationDelivery({
        keys: invitationSecretKeys,
        keyId: input.keyId,
        ciphertext: input.ciphertext,
        invitationId: input.invitationId,
        purpose: input.purpose,
        generation: input.generation,
      }),
    mail: {
      async sendInvitation() {
        return { providerMessageId: 'resend-repaired-1' };
      },
    },
    clock: { now: () => now },
  });
  await pool.end();
}

async function failSignInDelivery(outboxId: string) {
  const pool = ownerDeliveryPool();
  const ports = createPostgresSignInDeliveryPorts(pool);
  const queue = createMemoryQueue();
  await queue.send({ outboxId });
  await runSignInCodeDeliveryCycle({
    ...ports,
    outbox: { pending: async () => [] },
    queue,
    decrypt: (input) =>
      decryptSignInDelivery({
        keys: invitationSecretKeys,
        keyId: input.keyId,
        ciphertext: input.ciphertext,
        challengeId: input.challengeId,
        generation: input.generation,
      }),
    mail: {
      async sendInvitation() {
        throw new PermanentInvitationDeliveryError();
      },
    },
    clock: { now: () => now },
  });
  await pool.end();
}

async function deliverSignIn(outboxId: string) {
  const pool = ownerDeliveryPool();
  const ports = createPostgresSignInDeliveryPorts(pool);
  const queue = createMemoryQueue();
  await queue.send({ outboxId });
  await runSignInCodeDeliveryCycle({
    ...ports,
    outbox: { pending: async () => [] },
    queue,
    decrypt: (input) =>
      decryptSignInDelivery({
        keys: invitationSecretKeys,
        keyId: input.keyId,
        ciphertext: input.ciphertext,
        challengeId: input.challengeId,
        generation: input.generation,
      }),
    mail: {
      async sendInvitation() {
        return { providerMessageId: 'resend-sign-in-repaired-1' };
      },
    },
    clock: { now: () => now },
  });
  await pool.end();
}

async function invitationOutbox(createdInvitationId: string) {
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    const row = await owner.query<{
      outbox_id: string;
      operation_id: string;
      status: string;
    }>(
      `select outbox_id, operation_id, status
         from infrastructure.outbox
        where topic = 'invitation.delivery_requested'
          and (payload->>'invitationId') = $1
        order by sequence desc
        limit 1`,
      [createdInvitationId],
    );
    return row.rows[0];
  } finally {
    await owner.end();
  }
}

async function signInOutbox() {
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    const row = await owner.query<{
      outbox_id: string;
      operation_id: string;
      status: string;
    }>(
      `select outbox_id, operation_id, status
         from infrastructure.outbox
        where topic = 'sign_in.delivery_requested'
        order by sequence desc
        limit 1`,
    );
    return row.rows[0];
  } finally {
    await owner.end();
  }
}

async function seedFailedCleanupAndDisposition(studentId: string) {
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  const productionId = crypto.randomUUID();
  const productionOperationId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const locationId = crypto.randomUUID();
  const dispositionOperationId = crypto.randomUUID();
  const publicationOperationId = crypto.randomUUID();
  const policyRevisionId = crypto.randomUUID();
  const productionCaseId = crypto.randomUUID();
  const dispositionCaseId = crypto.randomUUID();
  const dispositionId = crypto.randomUUID();
  const noticeId = crypto.randomUUID();
  const copyId = crypto.randomUUID();
  try {
    await owner.query(
      `insert into records_governance.records_policy_revisions (
         policy_revision_id, workspace_id, revision_number, payload, activated_at,
         record_owner, record_classification, disposal_class
       ) values ($1, $2, 1, '{"schema":"records-policy/v1"}'::jsonb, $3,
         'school', 'school_administrative', 'records_policy_revision')
       on conflict (workspace_id, revision_number) do nothing`,
      [policyRevisionId, workspaceId, now],
    );
    const policy = await owner.query<{ policy_revision_id: string }>(
      `select policy_revision_id
         from records_governance.records_policy_revisions
        where workspace_id = $1
        order by revision_number desc
        limit 1`,
      [workspaceId],
    );
    const policyId = policy.rows[0]?.policy_revision_id ?? policyRevisionId;
    await owner.query(
      `insert into records_governance.record_lifecycle_cases (
         case_id, workspace_id, student_id, case_type, request_code,
         requester_kind, authority_kind, scope, deadline_at, policy_revision_id,
         decision, outcome, opened_at, closed_at, record_owner,
         record_classification, disposal_class
       ) values
         ($1, $2, $3, 'access', 'lawful_access', 'school_administrator',
          'school_administrator', '{"portions":["intake"]}'::jsonb, $4, $5,
          'authorized', 'completed', $6, $6, 'school', 'student_record',
          'record_lifecycle_case'),
         ($7, $2, $3, 'disposition', 'scheduled_destruction', 'school_administrator',
          'school_administrator', '{"portions":["all"]}'::jsonb, $4, $5,
          'authorized', 'open', $6, null, 'school', 'student_record',
          'record_lifecycle_case')`,
      [
        productionCaseId,
        workspaceId,
        studentId,
        new Date(now.getTime() + 24 * 60 * 60 * 1000),
        policyId,
        now,
        dispositionCaseId,
      ],
    );
    await owner.query(
      `insert into records_governance.record_productions (
         production_id, workspace_id, student_id, case_id, status, cleanup_status,
         portions, purpose, recipient_digest, capability_digest, wrapping_key_id,
         wrapped_data_key, ciphertext, delivery_key_id, delivery_ciphertext,
         expires_at, authorized_at, actor_staff_identity_id, operation_id,
         record_owner, record_classification, disposal_class
       ) values (
         $1, $2, $3, $4, 'expired', 'failed', '["intake"]'::jsonb, 'repair-exercise',
         $5, $6, 'test', 'wrapped-key', 'ciphertext', 'test', 'delivery-ciphertext',
         $7, $7, $8, $9, 'school', 'student_record', 'record_production'
       )`,
      [
        productionId,
        workspaceId,
        studentId,
        productionCaseId,
        'a'.repeat(64),
        'b'.repeat(64),
        now,
        administratorId,
        productionOperationId,
      ],
    );
    await owner.query(
      `insert into records_governance.record_disposition_notices (
         notice_id, workspace_id, student_id, completed_at, actor_staff_identity_id,
         operation_id, record_owner, record_classification, disposal_class
       ) values ($1, $2, $3, $4, $5, $6, 'school', 'student_record',
         'record_disposition_notice')`,
      [
        noticeId,
        workspaceId,
        studentId,
        now,
        administratorId,
        crypto.randomUUID(),
      ],
    );
    await owner.query(
      `insert into records_governance.record_disposition_copy_opportunities (
         copy_opportunity_id, workspace_id, student_id, completed_at,
         actor_staff_identity_id, operation_id, record_owner,
         record_classification, disposal_class
       ) values ($1, $2, $3, $4, $5, $6, 'school', 'student_record',
         'record_disposition_copy_opportunity')`,
      [
        copyId,
        workspaceId,
        studentId,
        now,
        administratorId,
        crypto.randomUUID(),
      ],
    );
    await owner.query(
      `insert into records_governance.record_dispositions (
         disposition_id, workspace_id, student_id, case_id, policy_revision_id,
         status, version, scheduled_at, cancellation_deadline_at, authority_kind,
         notice_id, copy_opportunity_id, actor_staff_identity_id, operation_id,
         record_owner, record_classification, disposal_class
       ) values (
         $1, $2, $3, $4, $5, 'failed', 1, $6, $7, 'school_administrator',
         $8, $9, $10, $11, 'school', 'student_record', 'record_disposition'
       )`,
      [
        dispositionId,
        workspaceId,
        studentId,
        dispositionCaseId,
        policyId,
        now,
        new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        noticeId,
        copyId,
        administratorId,
        dispositionOperationId,
      ],
    );
    await owner.query(
      `insert into records_governance.record_disposition_tasks (
         task_id, disposition_id, workspace_id, student_id, adapter, location,
         status, verification, last_error_code, record_owner,
         record_classification, disposal_class
       ) values (
         $1, $2, $3, $4, 'application_database', 'intake.intake_record_versions',
         'failed', 'failed', 'ADAPTER_UNAVAILABLE', 'school', 'student_record',
         'record_disposition_task'
       )`,
      [taskId, dispositionId, workspaceId, studentId],
    );
    await owner.query(
      `insert into records_governance.purge_verification_locations (
         location_id, disposition_id, workspace_id, student_id, adapter, location,
         deletion, verification, residual_retention_deadline_at, last_error_code,
         record_owner, record_classification, disposal_class
       ) values (
         $1, $2, $3, $4, 'application_database', 'intake.intake_record_versions',
         'failed', 'failed', $5, 'PROVIDER_VERIFICATION_FAILED', 'school',
         'operational_evidence', 'purge_verification_location'
       )`,
      [
        locationId,
        dispositionId,
        workspaceId,
        studentId,
        new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      ],
    );
    await owner.query(
      `insert into school_configuration.publication_attempts (
         workspace_id, operation_id, request_fingerprint, proposed_release_id,
         status, created_at, updated_at
       ) values ($1, $2, $3, $4, 'failed', $5, $5)`,
      [
        workspaceId,
        publicationOperationId,
        'c'.repeat(64),
        crypto.randomUUID(),
        now,
      ],
    );
  } finally {
    await owner.end();
  }
  return {
    productionId,
    productionOperationId,
    taskId,
    locationId,
    dispositionOperationId,
    publicationOperationId,
  };
}

function completeAnswers(fields: IntakeFormField[], name = 'Repair Student') {
  const answers: Record<string, string> = {};
  for (const field of [...fields].sort(
    (left, right) => left.order - right.order,
  )) {
    const visible =
      !field.visibility ||
      answers[field.visibility.fieldId] === field.visibility.equalsOptionCode;
    if (!visible) continue;
    if (field.options.length > 0) {
      answers[field.id] =
        field.options.find((option) => option.code === 'no')?.code ??
        field.options[0]?.code ??
        'no';
      continue;
    }
    if (field.type === 'date') {
      answers[field.id] = '2012-03-14';
      continue;
    }
    if (field.required || field.requiredWhenVisible || field.key === 'name') {
      answers[field.id] =
        field.key === 'name' ? name : field.type === 'tel' ? '5550100' : name;
    }
  }
  return answers;
}

beforeAll(async () => {
  candidate = JSON.parse(
    await readFile(
      new URL(
        '../../docs/fixtures/umb-demo-school-configuration-release-1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  postgres = await startEphemeralPostgres();
  await migrate(postgres.connectionString);
  runtimeDatabaseUrl = await createRuntimeDatabaseUser(
    postgres.connectionString,
  );
  server = await createServer({
    databaseUrl: runtimeDatabaseUrl,
    publicOrigin: origin,
    operatorCredentials: {
      token: operatorToken,
      actorId: 'repair-test-operator',
    },
    staffAuth: fakeAuth.provider,
    clock: { now: () => now },
    invitationSecrets: invitationSecretKeys,
    wrappingKeys,
    applicationKeys: {
      name: envelopeKeys.name,
      seal(plaintext, context) {
        if (failSeal) throw new Error('wrapping provider unavailable');
        return envelopeKeys.seal(plaintext, context);
      },
      open: (sealed, context) => envelopeKeys.open(sealed, context),
      bind: (plaintext, context) => envelopeKeys.bind(plaintext, context),
    },
    translationAdapter: {
      get id() {
        return translationAdapter.id;
      },
      get version() {
        return translationAdapter.version;
      },
      get model() {
        return translationAdapter.model;
      },
      get glossaryRevision() {
        return translationAdapter.glossaryRevision;
      },
      translate(request) {
        return translationAdapter.translate(request);
      },
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
        displayName: 'Repair Journey School',
      },
    },
  );
  expect(workspace.response.status).toBe(201);
  for (const staff of [
    {
      staffIdentityId: administratorId,
      email: administratorEmail,
      permissions: ['administrative'] as const,
    },
    {
      staffIdentityId: clinicianId,
      email: clinicianEmail,
      permissions: ['clinical'] as const,
    },
  ]) {
    const provisioned = await client.POST(
      '/api/v1/administration/staff-identities',
      {
        headers: operatorHeaders,
        body: {
          operationId: crypto.randomUUID(),
          workspaceId,
          staffIdentityId: staff.staffIdentityId,
          displayName: staff.email,
          email: staff.email,
          permissions: [...staff.permissions],
          schoolApprover: 'Demo principal',
          reason: 'Evolution failure repair journey',
          initialPassword: password,
        },
      },
    );
    expect(provisioned.response.status).toBe(201);
  }
  async function signIn(email: string) {
    const started = await client.POST('/api/v1/auth/staff/sign-in', {
      headers: { origin, 'x-prevcare-csrf': '1' },
      body: { email, password },
    });
    expect(started.response.status).toBe(200);
    const authenticated = await client.POST('/api/v1/auth/staff/totp', {
      headers: { origin, 'x-prevcare-csrf': '1' },
      body: {
        flowHandle: started.data?.flowHandle ?? '',
        code: totpCode(fakeAuth.totpSecretFor(email)),
      },
    });
    expect(authenticated.response.status).toBe(200);
    return authenticated.response.headers
      .get('set-cookie')
      ?.split(';', 1)[0] as string;
  }
  administratorCookie = await signIn(administratorEmail);
  clinicianCookie = await signIn(clinicianEmail);
  const imported = await client.POST(
    '/api/v1/administration/school-configuration/draft-imports',
    {
      headers: { ...operatorHeaders, cookie: administratorCookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedDraftVersion: 0,
        candidate,
      },
    },
  );
  expect(imported.response.status).toBe(201);
  const steppedUp = await client.POST('/api/v1/auth/staff/step-up', {
    headers: { ...operatorHeaders, cookie: administratorCookie },
    body: {
      password,
      totp: totpCode(fakeAuth.totpSecretFor(administratorEmail)),
    },
  });
  expect(steppedUp.response.status).toBe(200);
  const published = await client.POST(
    '/api/v1/administration/school-configuration/releases',
    {
      headers: { ...operatorHeaders, cookie: administratorCookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedActiveReleaseId: null,
        expectedDraftVersion: 1,
        candidateFingerprint: imported.data?.candidateFingerprint ?? '',
        changeDescription: 'Publish reviewed synthetic content.',
      },
    },
  );
  expect(published.response.status).toBe(201);
  const invited = await client.POST('/api/v1/administration/classes', {
    headers: { ...operatorHeaders, cookie: administratorCookie },
    body: {
      operationId: crypto.randomUUID(),
      classId,
      invitationId,
      name: 'Health Literacy Repair',
      recipient,
    },
  });
  expect(invited.response.status).toBe(201);
});

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
});

test('operator repair requires authority, names the failed work, and resumes invitation delivery', async () => {
  const client = createApiClient(baseUrl);
  const unauthorized = await client.GET('/api/v1/operator/repairable-work');
  expect(unauthorized.response.status).toBe(401);
  expect(unauthorized.error).toMatchObject({
    code: 'OPERATOR_AUTHENTICATION_REQUIRED',
  });

  const createdInvitationId = crypto.randomUUID();
  const invitationOperationId = crypto.randomUUID();
  generatedCode = '610511';
  const invited = await client.POST('/api/v1/administration/classes', {
    headers: { ...operatorHeaders, cookie: administratorCookie },
    body: {
      operationId: invitationOperationId,
      classId: crypto.randomUUID(),
      invitationId: createdInvitationId,
      name: 'Repair Delivery Class',
      recipient: 'repair.delivery@example.test',
    },
  });
  expect(invited.response.status).toBe(201);
  generatedCode = invitationCode;
  const outbox = await invitationOutbox(createdInvitationId);
  expect(outbox?.status).toBe('pending');
  await failInvitationDelivery(outbox!.outbox_id);

  const listed = await client.GET('/api/v1/operator/repairable-work', {
    headers: operatorHeaders,
  });
  expect(listed.response.status).toBe(200);
  const item = listed.data?.find(
    (entry: RepairableWorkItem) => entry.workId === outbox!.outbox_id,
  );
  expect(item).toMatchObject({
    workspaceId,
    kind: 'invitation_delivery',
    workId: outbox!.outbox_id,
    failedOperationId: invitationOperationId,
    status: 'failed',
    guidance: 'RESUME_FAILED_INVITATION_DELIVERY',
  });
  assertNoProtectedResidue(listed.data);
  expect(JSON.stringify(listed.data)).not.toContain(
    'repair.delivery@example.test',
  );
  expect(JSON.stringify(listed.data)).not.toContain('610511');

  const unconfirmed = await fetch(`${baseUrl}/api/v1/operator/repairs`, {
    method: 'POST',
    headers: { ...operatorHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      workspaceId,
      kind: 'invitation_delivery',
      workId: outbox!.outbox_id,
      failedOperationId: invitationOperationId,
    }),
  });
  expect(unconfirmed.status).toBe(400);

  const mismatched = await client.POST('/api/v1/operator/repairs', {
    headers: operatorHeaders,
    body: {
      operationId: crypto.randomUUID(),
      workspaceId,
      kind: 'invitation_delivery',
      workId: outbox!.outbox_id,
      failedOperationId: crypto.randomUUID(),
      confirmation: 'resume_failed_work',
    },
  });
  expect(mismatched.response.status).toBe(409);
  expect(mismatched.error).toMatchObject({
    code: 'REPAIR_PRECONDITION_CONFLICT',
  });

  const repairOperationId = crypto.randomUUID();
  const repaired = await client.POST('/api/v1/operator/repairs', {
    headers: operatorHeaders,
    body: {
      operationId: repairOperationId,
      workspaceId,
      kind: 'invitation_delivery',
      workId: outbox!.outbox_id,
      failedOperationId: invitationOperationId,
      confirmation: 'resume_failed_work',
    },
  });
  expect(repaired.response.status).toBe(200);
  expect(repaired.data).toMatchObject({
    operationId: repairOperationId,
    kind: 'invitation_delivery',
    workId: outbox!.outbox_id,
    failedOperationId: invitationOperationId,
    outcome: 'resumed',
    guidance: 'RESUME_FAILED_INVITATION_DELIVERY',
  });
  assertNoProtectedResidue(repaired.data);

  const replayed = await client.POST('/api/v1/operator/repairs', {
    headers: operatorHeaders,
    body: {
      operationId: repairOperationId,
      workspaceId,
      kind: 'invitation_delivery',
      workId: outbox!.outbox_id,
      failedOperationId: invitationOperationId,
      confirmation: 'resume_failed_work',
    },
  });
  expect(replayed.response.status).toBe(200);
  expect(replayed.data).toMatchObject({
    operationId: repairOperationId,
    outcome: 'resumed',
    replayed: true,
  });

  const reused = await client.POST('/api/v1/operator/repairs', {
    headers: operatorHeaders,
    body: {
      operationId: repairOperationId,
      workspaceId,
      kind: 'invitation_delivery',
      workId: crypto.randomUUID(),
      failedOperationId: invitationOperationId,
      confirmation: 'resume_failed_work',
    },
  });
  expect(reused.response.status).toBe(409);
  expect(reused.error).toMatchObject({ code: 'OPERATION_ID_REUSED' });

  const original = await inspectSpineOperation(
    postgres.connectionString,
    invitationOperationId,
  );
  expect(original.receipt?.commandName).toBe('createClassInvitation');
  expect(original.audit?.eventType).toBe('class_invitation.created');
  const repairInspection = await inspectSpineOperation(
    postgres.connectionString,
    repairOperationId,
  );
  expect(repairInspection.receipt?.commandName).toBe('repairOperatorWork');
  expect(repairInspection.audit).toMatchObject({
    eventType: 'operator.work_repaired',
    actorType: 'technical_operator',
    actorId: 'repair-test-operator',
  });
  expect(repairInspection.outbox?.topic).toBe('operator.work_repaired');
  expect(repairInspection.outbox?.status).toBe('pending');
  assertNoProtectedResidue(repairInspection);

  await deliverInvitation(outbox!.outbox_id);
  generatedCode = '610511';
  const redeemed = await fetch(
    `${baseUrl}/api/v1/auth/student/invitations/redeem`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({
        recipient: 'repair.delivery@example.test',
        code: '610511',
      }),
    },
  );
  generatedCode = invitationCode;
  expect(redeemed.status).toBe(200);

  const afterSuccess = await client.POST('/api/v1/operator/repairs', {
    headers: operatorHeaders,
    body: {
      operationId: crypto.randomUUID(),
      workspaceId,
      kind: 'invitation_delivery',
      workId: outbox!.outbox_id,
      failedOperationId: invitationOperationId,
      confirmation: 'resume_failed_work',
    },
  });
  expect(afterSuccess.response.status).toBe(409);
  expect(afterSuccess.error).toMatchObject({ code: 'REPAIR_NOT_REPAIRABLE' });
  expect(telemetryLines.join('\n')).not.toContain(
    'repair.delivery@example.test',
  );
  expect(telemetryLines.join('\n')).not.toContain('610511');
});

test('delayed invitation work is visible and resumes without rewriting history', async () => {
  const client = createApiClient(baseUrl);
  const delayedInvitationId = crypto.randomUUID();
  generatedCode = '610522';
  const invited = await client.POST('/api/v1/administration/classes', {
    headers: { ...operatorHeaders, cookie: administratorCookie },
    body: {
      operationId: crypto.randomUUID(),
      classId: crypto.randomUUID(),
      invitationId: delayedInvitationId,
      name: 'Delayed Delivery Class',
      recipient: 'repair.delayed@example.test',
    },
  });
  expect(invited.response.status).toBe(201);
  generatedCode = invitationCode;
  const outbox = await invitationOutbox(delayedInvitationId);
  const pool = ownerDeliveryPool();
  const ports = createPostgresInvitationDeliveryPorts(pool);
  const claimed = await ports.deliveries.claim(outbox!.outbox_id, now);
  expect(claimed.outcome).toBe('deliver');
  await pool.end();

  const listed = await client.GET('/api/v1/operator/repairable-work', {
    headers: operatorHeaders,
  });
  expect(
    listed.data?.find((entry) => entry.workId === outbox!.outbox_id),
  ).toMatchObject({
    kind: 'invitation_delivery',
    status: 'delayed',
    guidance: 'RESUME_DELAYED_INVITATION_DELIVERY',
  });
  const repaired = await client.POST('/api/v1/operator/repairs', {
    headers: operatorHeaders,
    body: {
      operationId: crypto.randomUUID(),
      workspaceId,
      kind: 'invitation_delivery',
      workId: outbox!.outbox_id,
      failedOperationId: outbox!.operation_id,
      confirmation: 'resume_failed_work',
    },
  });
  expect(repaired.response.status).toBe(200);
  await deliverInvitation(outbox!.outbox_id);
  generatedCode = '610522';
  const redeemed = await fetch(
    `${baseUrl}/api/v1/auth/student/invitations/redeem`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({
        recipient: 'repair.delayed@example.test',
        code: '610522',
      }),
    },
  );
  generatedCode = invitationCode;
  expect(redeemed.status).toBe(200);
});

test('stale revisions, concurrent drafts, reused commands, and wrapping failure stay deterministic', async () => {
  const client = createApiClient(baseUrl);
  const outbox = await invitationOutbox(invitationId);
  await deliverInvitation(outbox!.outbox_id);
  const redeemed = await fetch(
    `${baseUrl}/api/v1/auth/student/invitations/redeem`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ recipient, code: invitationCode }),
    },
  );
  expect(redeemed.status).toBe(200);
  studentCookie = redeemed.headers
    .get('set-cookie')
    ?.split(';', 1)[0] as string;

  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(opened.response.status).toBe(200);
  const snapshot = opened.data as StudentIntakeSnapshot;
  const answers = completeAnswers(snapshot.form.intakeForm.fields);
  const operationId = crypto.randomUUID();
  const body = {
    operationId,
    expectedDraftRevision: 0,
    expectedSchoolConfigurationReleaseId:
      snapshot.form.schoolConfigurationReleaseId,
    expectedIntakeForm: {
      resourceId: snapshot.form.intakeForm.resourceId,
      revisionNumber: snapshot.form.intakeForm.revisionNumber,
    },
    locale: 'en-US' as const,
    answers,
  };
  failSeal = true;
  const interrupted = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body,
  });
  failSeal = false;
  expect(interrupted.response.status).toBe(500);
  const retried = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body,
  });
  expect(retried.response.status).toBe(200);
  const replayed = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body,
  });
  expect(replayed.response.status).toBe(200);
  expect(replayed.data?.draftRevision).toBe(retried.data?.draftRevision);
  const mismatched = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: {
      ...body,
      answers: { ...answers, [nameFieldId]: 'Different body' },
    },
  });
  expect(mismatched.response.status).toBe(409);
  expect(mismatched.error).toMatchObject({ code: 'OPERATION_ID_REUSED' });

  const concurrent = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: {
      ...body,
      operationId: crypto.randomUUID(),
      expectedDraftRevision: 0,
      answers: completeAnswers(snapshot.form.intakeForm.fields, 'Later draft'),
    },
  });
  expect(concurrent.response.status).toBe(409);
  expect(concurrent.error).toMatchObject({
    code: 'INTAKE_DRAFT_REVISION_CONFLICT',
  });

  const stale = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: {
      ...body,
      operationId: crypto.randomUUID(),
      expectedDraftRevision: retried.data?.draftRevision ?? 1,
      expectedSchoolConfigurationReleaseId: crypto.randomUUID(),
    },
  });
  expect(stale.response.status).toBe(409);
  expect(stale.error).toMatchObject({ code: 'INTAKE_REVISION_CONFLICT' });
  expect(JSON.stringify(stale.error)).not.toContain('Repair Student');
});

test('revoked Student Sessions restore durable state from a fresh browser after Sign-In', async () => {
  const client = createApiClient(baseUrl);
  const session = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie: studentCookie },
  });
  expect(session.status).toBe(200);
  const access = (await session.json()) as { studentId: string };
  await client.POST('/api/v1/administration/students/disablements', {
    headers: { ...mutationHeaders, cookie: administratorCookie },
    body: {
      operationId: crypto.randomUUID(),
      studentId: access.studentId,
      reason: 'safety_hold',
    },
  });
  expect(
    (
      await fetch(`${baseUrl}/api/v1/student/intake?locale=en-US`, {
        headers: { cookie: studentCookie },
      })
    ).status,
  ).toBe(401);
  await client.POST('/api/v1/administration/students/re-enablements', {
    headers: { ...mutationHeaders, cookie: administratorCookie },
    body: {
      operationId: crypto.randomUUID(),
      studentId: access.studentId,
      reason: 'hold_released',
    },
  });
  generatedCode = '424242';
  const requested = await fetch(`${baseUrl}/api/v1/auth/student/sign-in`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ recipient }),
  });
  expect(requested.status).toBe(200);
  const signInWork = await signInOutbox();
  expect(signInWork?.status).toBe('pending');
  await failSignInDelivery(signInWork!.outbox_id);
  const listed = await client.GET('/api/v1/operator/repairable-work', {
    headers: operatorHeaders,
  });
  expect(
    listed.data?.find((entry) => entry.workId === signInWork!.outbox_id),
  ).toMatchObject({
    kind: 'sign_in_delivery',
    failedOperationId: signInWork!.operation_id,
    status: 'failed',
    guidance: 'RESUME_FAILED_SIGN_IN_DELIVERY',
  });
  assertNoProtectedResidue(listed.data);
  const repairedSignIn = await client.POST('/api/v1/operator/repairs', {
    headers: operatorHeaders,
    body: {
      operationId: crypto.randomUUID(),
      workspaceId,
      kind: 'sign_in_delivery',
      workId: signInWork!.outbox_id,
      failedOperationId: signInWork!.operation_id,
      confirmation: 'resume_failed_work',
    },
  });
  expect(repairedSignIn.response.status).toBe(200);
  await deliverSignIn(signInWork!.outbox_id);
  const restored = await fetch(
    `${baseUrl}/api/v1/auth/student/sign-in/verify`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ recipient, code: '424242' }),
    },
  );
  generatedCode = invitationCode;
  expect(restored.status).toBe(200);
  const freshCookie = restored.headers.get('set-cookie')?.split(';', 1)[0];
  expect(freshCookie).toBeString();
  expect(freshCookie).not.toBe(studentCookie);
  const intake = await client.GET('/api/v1/student/intake', {
    headers: { cookie: freshCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(intake.response.status).toBe(200);
  expect(intake.data?.draft?.answers[nameFieldId]).toBe('Repair Student');
  studentCookie = freshCookie as string;
});

test('operator repair resumes failed cleanup, disposition, and purge verification without rewriting history', async () => {
  const client = createApiClient(baseUrl);
  const session = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie: studentCookie },
  });
  expect(session.status).toBe(200);
  const access = (await session.json()) as { studentId: string };
  const seeded = await seedFailedCleanupAndDisposition(access.studentId);
  const listed = await client.GET('/api/v1/operator/repairable-work', {
    headers: operatorHeaders,
  });
  expect(listed.response.status).toBe(200);
  expect(
    listed.data?.find((entry) => entry.workId === seeded.productionId),
  ).toMatchObject({
    kind: 'record_production_cleanup',
    failedOperationId: seeded.productionOperationId,
    status: 'cleanup_failed',
    guidance: 'RESUME_FAILED_RECORD_PRODUCTION_CLEANUP',
  });
  expect(
    listed.data?.find((entry) => entry.workId === seeded.taskId),
  ).toMatchObject({
    kind: 'disposition_task',
    failedOperationId: seeded.dispositionOperationId,
    guidance: 'RESUME_FAILED_DISPOSITION_TASK',
  });
  expect(
    listed.data?.find((entry) => entry.workId === seeded.locationId),
  ).toMatchObject({
    kind: 'purge_verification',
    failedOperationId: seeded.dispositionOperationId,
    guidance: 'RESUME_FAILED_PURGE_VERIFICATION',
  });
  expect(
    listed.data?.find(
      (entry) => entry.workId === seeded.publicationOperationId,
    ),
  ).toMatchObject({
    kind: 'publication_attempt',
    failedOperationId: seeded.publicationOperationId,
    guidance: 'RETRY_PUBLICATION_WITH_NEW_OPERATION',
  });
  assertNoProtectedResidue(listed.data);

  const cleanup = await client.POST('/api/v1/operator/repairs', {
    headers: operatorHeaders,
    body: {
      operationId: crypto.randomUUID(),
      workspaceId,
      kind: 'record_production_cleanup',
      workId: seeded.productionId,
      failedOperationId: seeded.productionOperationId,
      confirmation: 'resume_failed_work',
    },
  });
  expect(cleanup.response.status).toBe(200);
  expect(cleanup.data).toMatchObject({
    outcome: 'resumed',
    guidance: 'RESUME_FAILED_RECORD_PRODUCTION_CLEANUP',
  });
  const disposition = await client.POST('/api/v1/operator/repairs', {
    headers: operatorHeaders,
    body: {
      operationId: crypto.randomUUID(),
      workspaceId,
      kind: 'disposition_task',
      workId: seeded.taskId,
      failedOperationId: seeded.dispositionOperationId,
      confirmation: 'resume_failed_work',
    },
  });
  expect(disposition.response.status).toBe(200);
  const verification = await client.POST('/api/v1/operator/repairs', {
    headers: operatorHeaders,
    body: {
      operationId: crypto.randomUUID(),
      workspaceId,
      kind: 'purge_verification',
      workId: seeded.locationId,
      failedOperationId: seeded.dispositionOperationId,
      confirmation: 'resume_failed_work',
    },
  });
  expect(verification.response.status).toBe(200);
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    const production = await owner.query<{
      cleanup_status: string;
      ciphertext: string | null;
    }>(
      `select cleanup_status, ciphertext
         from records_governance.record_productions
        where production_id = $1`,
      [seeded.productionId],
    );
    expect(production.rows[0]).toEqual({
      cleanup_status: 'removed',
      ciphertext: null,
    });
    const task = await owner.query<{ status: string; verification: string }>(
      `select status, verification
         from records_governance.record_disposition_tasks
        where task_id = $1`,
      [seeded.taskId],
    );
    expect(task.rows[0]).toEqual({
      status: 'pending',
      verification: 'pending',
    });
    const location = await owner.query<{
      deletion: string;
      verification: string;
    }>(
      `select deletion, verification
         from records_governance.purge_verification_locations
        where location_id = $1`,
      [seeded.locationId],
    );
    expect(location.rows[0]).toEqual({
      deletion: 'pending',
      verification: 'pending',
    });
  } finally {
    await owner.end();
  }
  const afterSuccess = await client.POST('/api/v1/operator/repairs', {
    headers: operatorHeaders,
    body: {
      operationId: crypto.randomUUID(),
      workspaceId,
      kind: 'record_production_cleanup',
      workId: seeded.productionId,
      failedOperationId: seeded.productionOperationId,
      confirmation: 'resume_failed_work',
    },
  });
  expect(afterSuccess.response.status).toBe(409);
  expect(afterSuccess.error).toMatchObject({ code: 'REPAIR_NOT_REPAIRABLE' });
  const publicationRepair = await client.POST('/api/v1/operator/repairs', {
    headers: operatorHeaders,
    body: {
      operationId: crypto.randomUUID(),
      workspaceId,
      kind: 'publication_attempt',
      workId: seeded.publicationOperationId,
      failedOperationId: seeded.publicationOperationId,
      confirmation: 'resume_failed_work',
    },
  });
  expect(publicationRepair.response.status).toBe(409);
  expect(publicationRepair.error).toMatchObject({
    code: 'REPAIR_NOT_REPAIRABLE',
  });
});

test('authorization, freshness, workspace, and expired session denials stay stable', async () => {
  const client = createApiClient(baseUrl);
  const clinical = await client.GET(
    '/api/v1/administration/school-configuration',
    { headers: { cookie: clinicianCookie } },
  );
  expect(clinical.response.status).toBe(403);
  expect(clinical.error).toMatchObject({
    code: 'ADMINISTRATIVE_PERMISSION_REQUIRED',
  });

  const current = await client.GET(
    '/api/v1/administration/school-configuration',
    { headers: { cookie: administratorCookie } },
  );
  expect(current.response.status).toBe(200);
  const freshnessBefore = now;
  now = new Date(now.getTime() + 14 * 60 * 1000);
  expect(
    (
      await client.GET('/api/v1/staff/session', {
        headers: { cookie: administratorCookie },
      })
    ).response.status,
  ).toBe(200);
  now = new Date(now.getTime() + 2 * 60 * 1000);
  const stalePublish = await client.POST(
    '/api/v1/administration/school-configuration/releases',
    {
      headers: { ...operatorHeaders, cookie: administratorCookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedActiveReleaseId: current.data?.activeReleaseId ?? null,
        expectedDraftVersion: current.data?.draftVersion ?? 1,
        candidateFingerprint: current.data?.candidateFingerprint ?? '',
        changeDescription: 'Must not publish without freshness.',
      },
    },
  );
  now = freshnessBefore;
  expect(stalePublish.response.status).toBe(409);
  expect(stalePublish.error).toMatchObject({
    code: 'AUTHENTICATION_FRESHNESS_REQUIRED',
  });

  const foreign = await client.POST('/api/v1/operator/repairs', {
    headers: operatorHeaders,
    body: {
      operationId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      kind: 'invitation_delivery',
      workId: crypto.randomUUID(),
      failedOperationId: crypto.randomUUID(),
      confirmation: 'resume_failed_work',
    },
  });
  expect(foreign.response.status).toBe(404);
  expect(foreign.error).toMatchObject({ code: 'REPAIR_NOT_FOUND' });

  const before = now;
  now = new Date(before.getTime() + 9 * 60 * 60 * 1000);
  const expired = await client.GET('/api/v1/staff/session', {
    headers: { cookie: administratorCookie },
  });
  now = before;
  expect(expired.response.status).toBe(401);
  const started = await client.POST('/api/v1/auth/staff/sign-in', {
    headers: { origin, 'x-prevcare-csrf': '1' },
    body: { email: administratorEmail, password },
  });
  expect(started.response.status).toBe(200);
  const authenticated = await client.POST('/api/v1/auth/staff/totp', {
    headers: { origin, 'x-prevcare-csrf': '1' },
    body: {
      flowHandle: started.data?.flowHandle ?? '',
      code: totpCode(fakeAuth.totpSecretFor(administratorEmail)),
    },
  });
  expect(authenticated.response.status).toBe(200);
  administratorCookie = authenticated.response.headers
    .get('set-cookie')
    ?.split(';', 1)[0] as string;
});

test('deterministic provider denial and translation-only Learning preservation', async () => {
  const client = createApiClient(baseUrl);
  const currentDraft = await client.GET(
    '/api/v1/administration/school-configuration',
    { headers: { cookie: administratorCookie } },
  );
  expect(currentDraft.response.status).toBe(200);
  translationAdapter = createUnavailableTranslationAdapter();
  const denied = await client.POST(
    '/api/v1/administration/school-configuration/managed-translation-generations',
    {
      headers: { ...operatorHeaders, cookie: administratorCookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedDraftVersion: currentDraft.data?.draftVersion ?? 1,
        locale: 'es-US',
      },
    },
  );
  translationAdapter = createDeterministicTranslationAdapter();
  expect(denied.response.status).toBe(503);
  expect(denied.error).toMatchObject({
    code: 'TRANSLATION_PROVIDER_UNAVAILABLE',
  });

  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(opened.response.status).toBe(200);
  const snapshot = opened.data as StudentIntakeSnapshot;
  const submitted = await client.POST('/api/v1/student/intake/submissions', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: {
      operationId: crypto.randomUUID(),
      expectedSchoolConfigurationReleaseId:
        snapshot.form.schoolConfigurationReleaseId,
      expectedIntakeForm: {
        resourceId: snapshot.form.intakeForm.resourceId,
        revisionNumber: snapshot.form.intakeForm.revisionNumber,
      },
      expectedSubmissionAttestation: {
        resourceId: snapshot.form.submissionAttestation.resourceId,
        revisionNumber: snapshot.form.submissionAttestation.revisionNumber,
      },
      locale: 'en-US',
      answers:
        snapshot.draft?.answers ??
        completeAnswers(snapshot.form.intakeForm.fields),
      attestation: {
        locale: 'en-US',
        notice: {
          resourceId: snapshot.form.submissionAttestation.resourceId,
          revisionNumber: snapshot.form.submissionAttestation.revisionNumber,
        },
      },
    },
  });
  expect(submitted.response.status).toBe(201);

  const learning = await client.GET('/api/v1/student/learning', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(learning.response.status).toBe(200);
  const learningSnapshot = learning.data as StudentLearningSnapshot;
  const knowledge = learningSnapshot.modules
    .find((module) => module.moduleId === primaryCareModuleId)
    ?.sections.find((section) => section.kind === 'knowledge')
    ?.items.find((item) => item.itemId === firstKnowledgeId);
  expect(knowledge?.revisionNumber).toBeGreaterThan(0);
  const acknowledged = await client.POST(
    '/api/v1/student/learning/acknowledgements',
    {
      headers: { ...mutationHeaders, cookie: studentCookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedSchoolConfigurationReleaseId:
          learningSnapshot.schoolConfigurationReleaseId,
        itemId: firstKnowledgeId,
        revisionNumber: knowledge!.revisionNumber,
      },
    },
  );
  expect(acknowledged.response.status).toBe(201);
  const completionId = acknowledged.data?.itemCompletionId;

  const draft = await client.GET(
    '/api/v1/administration/school-configuration',
    { headers: { cookie: administratorCookie } },
  );
  const module = (
    isRecord(draft.data?.candidate) && isRecord(draft.data.candidate.release)
      ? draft.data.candidate.release.modules
      : []
  ) as unknown[];
  const found = module.find(
    (entry) => isRecord(entry) && entry.id === primaryCareModuleId,
  );
  const items =
    isRecord(found) && Array.isArray(found.knowledgeItems)
      ? found.knowledgeItems.filter(isRecord)
      : [];
  const first = items.find((item) => item.id === firstKnowledgeId);
  const text = isRecord(first?.text) ? first.text : {};
  const english = isRecord(text['en-US']) ? text['en-US'] : undefined;
  const spanish = isRecord(text['es-US']) ? text['es-US'] : undefined;
  const saved = await client.POST(
    '/api/v1/administration/school-configuration/draft-edits',
    {
      headers: { ...operatorHeaders, cookie: administratorCookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedDraftVersion: draft.data?.draftVersion,
        expectedResourceRevisions: isRecord(spanish)
          ? [
              {
                resourceId: String(spanish.id),
                revisionNumber: Number(spanish.revision),
              },
            ]
          : [],
        type: 'save-managed-translation',
        resourceId: String(english?.id),
        locale: 'es-US',
        text: 'Punto clave de chequeos de rutina revisado',
      },
    },
  );
  expect(saved.response.status).toBe(200);
  const savedModules =
    isRecord(saved.data?.candidate) && isRecord(saved.data.candidate.release)
      ? (saved.data.candidate.release.modules as unknown[])
      : [];
  const savedItem = savedModules
    .flatMap((entry) =>
      isRecord(entry) && Array.isArray(entry.knowledgeItems)
        ? entry.knowledgeItems.filter(isRecord)
        : [],
    )
    .find((item) => item.id === firstKnowledgeId);
  const pending = isRecord(savedItem?.text)
    ? savedItem.text['es-US']
    : undefined;
  expect(isRecord(pending)).toBe(true);
  const reviewed = await client.POST(
    '/api/v1/administration/school-configuration/draft-edits',
    {
      headers: { ...operatorHeaders, cookie: administratorCookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedDraftVersion: saved.data?.draftVersion,
        expectedResourceRevisions: [
          {
            resourceId: String(isRecord(pending) ? pending.id : ''),
            revisionNumber: Number(isRecord(pending) ? pending.revision : 1),
          },
        ],
        type: 'review-managed-translation',
        resourceId: String(english?.id),
        locale: 'es-US',
      },
    },
  );
  expect(reviewed.response.status).toBe(200);
  const steppedUp = await client.POST('/api/v1/auth/staff/step-up', {
    headers: { ...operatorHeaders, cookie: administratorCookie },
    body: {
      password,
      totp: totpCode(fakeAuth.totpSecretFor(administratorEmail)),
    },
  });
  expect(steppedUp.response.status).toBe(200);
  const published = await client.POST(
    '/api/v1/administration/school-configuration/releases',
    {
      headers: { ...operatorHeaders, cookie: administratorCookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedActiveReleaseId: draft.data?.activeReleaseId ?? null,
        expectedDraftVersion: reviewed.data?.draftVersion,
        candidateFingerprint: reviewed.data?.candidateFingerprint ?? '',
        changeDescription: 'Translation-only Learning Module preservation.',
      },
    },
  );
  expect(published.response.status).toBe(201);
  const after = await client.GET('/api/v1/student/learning', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  const afterSnapshot = after.data as StudentLearningSnapshot;
  const afterItem = afterSnapshot.modules
    .find((entry) => entry.moduleId === primaryCareModuleId)
    ?.sections.find((section) => section.kind === 'knowledge')
    ?.items.find((item) => item.itemId === firstKnowledgeId);
  expect(afterItem).toMatchObject({
    revisionNumber: knowledge!.revisionNumber,
    contentChange: null,
    completion: { itemCompletionId: completionId },
  });
  expect(afterSnapshot.updatedContent).toBeNull();
});
