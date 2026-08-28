import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { createServer } from '../../apps/server/src/app.ts';
import {
  PermanentInvitationDeliveryError,
  runRecordProductionDeliveryCycle,
} from '../../modules/invitation-delivery/index.ts';
import { createEnvelopeKeyManagement } from '../../packages/application-keys/src/index.ts';
import { createApiClient } from '../../packages/api-client/src/index.ts';
import { decryptRecordProductionDelivery } from '../../packages/invitation-secrets/src/index.ts';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import {
  createRuntimeDatabaseUser,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from '../../packages/test-support/src/postgres.ts';
import { createFakeStaffAuth } from '../../packages/test-support/src/staff-auth.ts';

const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf9001';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf9002';
const otherWorkspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf9003';
const otherStaffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf9004';
const otherSessionHandle = 'opaque-other-amendment-administrator-session';
const sessionHandle = 'opaque-amendment-administrator-session-handle';
const invitationCode = '910104';
const invitationSecrets = {
  hmacKey: Buffer.alloc(32, 7),
  encryptionKeys: { test: Buffer.alloc(32, 9) },
  activeEncryptionKeyId: 'test',
  createCode: () => generatedCode,
};
const wrappingKeys = {
  wrappingKeys: { test: Buffer.alloc(32, 13) },
  activeWrappingKeyId: 'test',
  idempotencyKey: Buffer.alloc(32, 17),
};
const envelopeKeys = createEnvelopeKeyManagement(wrappingKeys);
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

async function seedStudent(input: {
  name: string;
  recipient: string;
  code: string;
}) {
  const invitationId = crypto.randomUUID();
  generatedCode = input.code;
  const created = await fetch(`${baseUrl}/api/v1/administration/classes`, {
    method: 'POST',
    headers: { ...mutationHeaders, cookie: staffCookie() },
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      classId: crypto.randomUUID(),
      invitationId,
      name: input.name,
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
  return { studentId: access.studentId, sessionCookie };
}

async function insertIntakeVersion(
  studentId: string,
  answers: Record<string, string>,
) {
  const sealed = envelopeKeys.seal(
    Buffer.from(JSON.stringify(answers), 'utf8'),
    {
      purpose: 'intake-record-version',
      workspaceId,
      studentId,
    },
  );
  const intakeId = crypto.randomUUID();
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(
      `insert into intake.intake_record_versions
         (intake_record_version_id, student_id, workspace_id, version_number,
          school_configuration_release_id, intake_form_resource_id,
          intake_form_revision_number, submission_attestation_resource_id,
          submission_attestation_revision_number, locale, wrapping_key_id,
          wrapped_data_key, ciphertext, accepted_at, superseded_at,
          record_owner, record_classification, disposal_class)
       values ($1, $2, $3, 1, $4, $4, 1, $4, 1, 'en-US', $5, $6, $7, $8, null,
               'school', 'student_record', 'intake_record_version')`,
      [
        intakeId,
        studentId,
        workspaceId,
        crypto.randomUUID(),
        sealed.wrappingKeyId,
        sealed.wrappedDataKey,
        sealed.ciphertext,
        now,
      ],
    );
  } finally {
    await owner.end();
  }
  return intakeId;
}

async function openAuthorizedCase(input: {
  studentId: string;
  caseType: 'access' | 'amendment' | 'transfer' | 'disclosure';
  requestCode:
    'lawful_access' | 'amendment_challenge' | 'transfer' | 'disclosure';
  portions: string[];
  purpose: 'lawful_access' | 'amendment_challenge' | 'transfer' | 'disclosure';
  decision?: 'authorized' | 'denied';
}) {
  const client = createApiClient(baseUrl);
  const opened = await client.POST(
    '/api/v1/administration/students/record-lifecycle-cases',
    {
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: {
        operationId: crypto.randomUUID(),
        studentId: input.studentId,
        caseType: input.caseType,
        requestCode: input.requestCode,
        requesterKind: 'parent_guardian',
        authorityKind: 'school_administrator',
        scope: {
          portions: input.portions as [
            'identity' | 'intake' | 'complete_bundle',
          ],
          purpose: input.purpose,
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
        decision: input.decision ?? 'authorized',
      },
    },
  );
  expect(decided.response.status).toBe(200);
  return opened.data!.caseId;
}

beforeAll(async () => {
  postgres = await startEphemeralPostgres();
  await migrate(postgres.connectionString);
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(
      `insert into identity_access.school_workspaces values
       ($1, 'Amendment School', $2, 'school', 'school_administrative', 'school_workspace')`,
      [workspaceId, now],
    );
    await owner.query(
      `insert into identity_access.staff_identities values
       ($1, $2, 'Jordan Blake', 'administrator.amendment@example.test', $3, 'active',
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
       ($1, 'Other Amendment School', $2, 'school', 'school_administrative', 'school_workspace')`,
      [otherWorkspaceId, now],
    );
    await owner.query(
      `insert into identity_access.staff_identities values
       ($1, $2, 'Other Admin', 'other.amendment@example.test', $3, 'active',
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
    invitationSecrets,
    wrappingKeys,
  });
  baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
});

test('Record Amendment preserves the original fact while recording challenge, authority, decision, reason, correction, and requester statement', async () => {
  const client = createApiClient(baseUrl);
  const { studentId } = await seedStudent({
    name: 'Amendment Class',
    recipient: 'amendment.student@example.edu',
    code: '910001',
  });
  const intakeId = await insertIntakeVersion(studentId, {
    allergy: 'peanuts',
  });
  const caseId = await openAuthorizedCase({
    studentId,
    caseType: 'amendment',
    requestCode: 'amendment_challenge',
    portions: ['intake'],
    purpose: 'amendment_challenge',
  });
  const resolved = await fetch(
    `${baseUrl}/api/v1/administration/students/record-amendments`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf9101',
        caseId,
        challengedFactKind: 'intake_record_version',
        challengedFactId: intakeId,
        decision: 'correction_authorized',
        reasonCode: 'intake_inaccuracy',
        effectiveCorrection: {
          projectionKind: 'intake_record_version',
          summaryCode: 'intake_inaccuracy',
          challengedFactId: intakeId,
        },
      }),
    },
  );
  expect(resolved.status).toBe(200);
  const body = (await resolved.json()) as { amendmentId: string };
  expect(body.amendmentId).toBeString();

  const deniedCase = await openAuthorizedCase({
    studentId,
    caseType: 'amendment',
    requestCode: 'amendment_challenge',
    portions: ['identity'],
    purpose: 'amendment_challenge',
    decision: 'denied',
  });
  const denied = await fetch(
    `${baseUrl}/api/v1/administration/students/record-amendments`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        caseId: deniedCase,
        challengedFactKind: 'identity',
        challengedFactId: studentId,
        decision: 'challenge_denied',
        reasonCode: 'insufficient_evidence',
        requesterStatement: 'The legal name on file is wrong.',
      }),
    },
  );
  expect(denied.status).toBe(200);

  const listing = await client.GET(
    '/api/v1/administration/students/records-governance',
    { headers: { cookie: staffCookie() } },
  );
  const row = listing.data?.students.find(
    (student) => student.studentId === studentId,
  );
  expect(row?.amendments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        caseId,
        challengedFactKind: 'intake_record_version',
        challengedFactId: intakeId,
        decision: 'correction_authorized',
        reasonCode: 'intake_inaccuracy',
        authorityKind: 'school_administrator',
        requesterStatementPreserved: false,
        effectiveCorrection: expect.objectContaining({
          projectionKind: 'intake_record_version',
          challengedFactId: intakeId,
        }),
      }),
      expect.objectContaining({
        caseId: deniedCase,
        decision: 'challenge_denied',
        requesterStatementPreserved: true,
        effectiveCorrection: null,
      }),
    ]),
  );
  expect(JSON.stringify(listing.data)).not.toContain('peanuts');
  expect(JSON.stringify(listing.data)).not.toContain(
    'The legal name on file is wrong.',
  );

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const original = await inspection.query<{ ciphertext: string }>(
      `select ciphertext from intake.intake_record_versions
        where intake_record_version_id = $1`,
      [intakeId],
    );
    expect(original.rows[0]?.ciphertext).toBeString();
    const opened = envelopeKeys.open(
      {
        wrappingKeyId: wrappingKeys.activeWrappingKeyId,
        wrappedDataKey: (
          await inspection.query<{ wrapped_data_key: string }>(
            `select wrapped_data_key from intake.intake_record_versions
              where intake_record_version_id = $1`,
            [intakeId],
          )
        ).rows[0]!.wrapped_data_key,
        ciphertext: original.rows[0]!.ciphertext,
      },
      {
        purpose: 'intake-record-version',
        workspaceId,
        studentId,
      },
    );
    expect(JSON.parse(Buffer.from(opened).toString('utf8'))).toEqual({
      allergy: 'peanuts',
    });
  } finally {
    await inspection.end();
  }
});

test('conflicting Student identities enter audited review instead of merge', async () => {
  const client = createApiClient(baseUrl);
  const first = await seedStudent({
    name: 'Conflict A',
    recipient: 'conflict.a@example.edu',
    code: '910002',
  });
  const second = await seedStudent({
    name: 'Conflict B',
    recipient: 'conflict.b@example.edu',
    code: '910003',
  });
  const caseId = await openAuthorizedCase({
    studentId: first.studentId,
    caseType: 'amendment',
    requestCode: 'amendment_challenge',
    portions: ['identity'],
    purpose: 'amendment_challenge',
  });
  const conflicted = await fetch(
    `${baseUrl}/api/v1/administration/students/record-amendments`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf9111',
        caseId,
        challengedFactKind: 'identity',
        challengedFactId: first.studentId,
        decision: 'correction_authorized',
        reasonCode: 'identity_dispute',
        relatedStudentId: second.studentId,
        effectiveCorrection: {
          projectionKind: 'identity',
          summaryCode: 'identity_dispute',
          challengedFactId: first.studentId,
        },
      }),
    },
  );
  expect(conflicted.status).toBe(409);
  const problem = (await conflicted.json()) as {
    code: string;
    reviewId: string;
  };
  expect(problem.code).toBe('RECORD_CONFLICT_REVIEW_REQUIRED');
  expect(problem.reviewId).toBeString();

  const retried = await fetch(
    `${baseUrl}/api/v1/administration/students/record-amendments`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf9111',
        caseId,
        challengedFactKind: 'identity',
        challengedFactId: first.studentId,
        decision: 'correction_authorized',
        reasonCode: 'identity_dispute',
        relatedStudentId: second.studentId,
        effectiveCorrection: {
          projectionKind: 'identity',
          summaryCode: 'identity_dispute',
          challengedFactId: first.studentId,
        },
      }),
    },
  );
  expect(retried.status).toBe(409);
  expect(await retried.json()).toMatchObject({
    code: 'RECORD_CONFLICT_REVIEW_REQUIRED',
    reviewId: problem.reviewId,
  });

  const listing = await client.GET(
    '/api/v1/administration/students/records-governance',
    { headers: { cookie: staffCookie() } },
  );
  const row = listing.data?.students.find(
    (student) => student.studentId === first.studentId,
  );
  expect(row?.amendments ?? []).toEqual([]);
  expect(row?.conflictReviews).toEqual([
    expect.objectContaining({
      reviewId: problem.reviewId,
      conflictKind: 'student_identity',
      subjectStudentId: first.studentId,
      conflictingStudentId: second.studentId,
      status: 'open',
      outcome: null,
    }),
  ]);

  const decided = await fetch(
    `${baseUrl}/api/v1/administration/students/record-conflict-review-decisions`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        reviewId: problem.reviewId,
        outcome: 'keep_distinct',
      }),
    },
  );
  expect(decided.status).toBe(200);

  const merge = await fetch(
    `${baseUrl}/api/v1/administration/students/record-merges`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        studentId: first.studentId,
        mergeIntoStudentId: second.studentId,
      }),
    },
  );
  expect(merge.status).toBe(404);
});

test('Record Production delivers only authorized portions through a one-time encrypted retrieval', async () => {
  const client = createApiClient(baseUrl);
  const address = 'production.student@example.edu';
  const { studentId } = await seedStudent({
    name: 'Production Class',
    recipient: address,
    code: '910004',
  });
  const answers = { allergy: 'UNIQUE-PRODUCTION-ANSWER-48' };
  await insertIntakeVersion(studentId, answers);
  const caseId = await openAuthorizedCase({
    studentId,
    caseType: 'access',
    requestCode: 'lawful_access',
    portions: ['identity', 'intake'],
    purpose: 'lawful_access',
  });

  const unauthorized = await fetch(
    `${baseUrl}/api/v1/administration/students/record-productions`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie(otherSessionHandle) },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        caseId,
        recipient: 'custodian@example.org',
      }),
    },
  );
  expect(unauthorized.status).toBe(404);

  const authorized = await fetch(
    `${baseUrl}/api/v1/administration/students/record-productions`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf9201',
        caseId,
        recipient: 'custodian@example.org',
      }),
    },
  );
  expect(authorized.status).toBe(200);
  const production = (await authorized.json()) as { productionId: string };
  expect(JSON.stringify(production)).not.toContain(
    'UNIQUE-PRODUCTION-ANSWER-48',
  );
  expect(JSON.stringify(production)).not.toContain('custodian@example.org');

  const listing = await client.GET(
    '/api/v1/administration/students/records-governance',
    { headers: { cookie: staffCookie() } },
  );
  const row = listing.data?.students.find(
    (student) => student.studentId === studentId,
  );
  expect(row?.productions).toEqual([
    expect.objectContaining({
      productionId: production.productionId,
      status: 'pending_delivery',
      cleanupStatus: 'pending',
      portions: ['identity', 'intake'],
      purpose: 'lawful_access',
    }),
  ]);
  expect(JSON.stringify(listing.data)).not.toContain(
    'UNIQUE-PRODUCTION-ANSWER-48',
  );
  expect(JSON.stringify(listing.data)).not.toMatch(/learningProgress/i);

  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  let capability = '';
  try {
    const stored = await owner.query<{
      delivery_key_id: string;
      delivery_ciphertext: string;
      ciphertext: string;
    }>(
      `select delivery_key_id, delivery_ciphertext, ciphertext
         from records_governance.record_productions
        where production_id = $1`,
      [production.productionId],
    );
    expect(stored.rows[0]?.ciphertext).toBeString();
    capability = decryptRecordProductionDelivery({
      keys: invitationSecrets,
      keyId: stored.rows[0]!.delivery_key_id,
      ciphertext: stored.rows[0]!.delivery_ciphertext,
      productionId: production.productionId,
    }).capability;
  } finally {
    await owner.end();
  }

  const first = await fetch(
    `${baseUrl}/api/v1/records/productions/retrievals`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ capability }),
    },
  );
  expect(first.status).toBe(200);
  expect(first.headers.get('cache-control')).toBe('no-store');
  const retrieved = (await first.json()) as {
    productionId: string;
    portions: string[];
    package: {
      identity?: { studentId: string; emails: { address: string }[] };
      intake?: { versions: { answers: Record<string, string> }[] };
      learningProgress?: unknown;
    };
  };
  expect(retrieved.productionId).toBe(production.productionId);
  expect(retrieved.portions).toEqual(['identity', 'intake']);
  expect(retrieved.package.identity?.studentId).toBe(studentId);
  expect(retrieved.package.identity?.emails[0]?.address).toBe(address);
  expect(retrieved.package.intake?.versions[0]?.answers).toEqual(answers);
  expect(retrieved.package.learningProgress).toBeUndefined();

  const second = await fetch(
    `${baseUrl}/api/v1/records/productions/retrievals`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ capability }),
    },
  );
  expect(second.status).toBe(404);
  expect(await second.json()).toMatchObject({
    code: 'RECORD_PRODUCTION_UNAVAILABLE',
  });

  const after = new Client({ connectionString: postgres.connectionString });
  await after.connect();
  try {
    const stored = await after.query<{
      ciphertext: string | null;
      delivery_ciphertext: string | null;
      status: string;
      cleanup_status: string;
    }>(
      `select ciphertext, delivery_ciphertext, status, cleanup_status
         from records_governance.record_productions
        where production_id = $1`,
      [production.productionId],
    );
    expect(stored.rows).toEqual([
      {
        ciphertext: null,
        delivery_ciphertext: null,
        status: 'retrieved',
        cleanup_status: 'removed',
      },
    ]);
  } finally {
    await after.end();
  }

  const concurrentCase = await openAuthorizedCase({
    studentId,
    caseType: 'transfer',
    requestCode: 'transfer',
    portions: ['identity'],
    purpose: 'transfer',
  });
  const concurrent = await fetch(
    `${baseUrl}/api/v1/administration/students/record-productions`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        caseId: concurrentCase,
        recipient: 'transfer.office@example.org',
      }),
    },
  );
  expect(concurrent.status).toBe(200);
  const concurrentId = ((await concurrent.json()) as { productionId: string })
    .productionId;
  const inspect = new Client({ connectionString: postgres.connectionString });
  await inspect.connect();
  let concurrentCapability = '';
  try {
    const stored = await inspect.query<{
      delivery_key_id: string;
      delivery_ciphertext: string;
    }>(
      `select delivery_key_id, delivery_ciphertext
         from records_governance.record_productions
        where production_id = $1`,
      [concurrentId],
    );
    concurrentCapability = decryptRecordProductionDelivery({
      keys: invitationSecrets,
      keyId: stored.rows[0]!.delivery_key_id,
      ciphertext: stored.rows[0]!.delivery_ciphertext,
      productionId: concurrentId,
    }).capability;
  } finally {
    await inspect.end();
  }
  const [left, right] = await Promise.all([
    fetch(`${baseUrl}/api/v1/records/productions/retrievals`, {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ capability: concurrentCapability }),
    }),
    fetch(`${baseUrl}/api/v1/records/productions/retrievals`, {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ capability: concurrentCapability }),
    }),
  ]);
  const statuses = [left.status, right.status].sort();
  expect(statuses).toEqual([200, 404]);
});

test('expired Record Production removes the package and stays repairable after cleanup failure', async () => {
  const { studentId } = await seedStudent({
    name: 'Expiry Class',
    recipient: 'expiry.student@example.edu',
    code: '910005',
  });
  const caseId = await openAuthorizedCase({
    studentId,
    caseType: 'disclosure',
    requestCode: 'disclosure',
    portions: ['identity'],
    purpose: 'disclosure',
  });
  const authorized = await fetch(
    `${baseUrl}/api/v1/administration/students/record-productions`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        caseId,
        recipient: 'records.office@example.org',
      }),
    },
  );
  expect(authorized.status).toBe(200);
  const productionId = ((await authorized.json()) as { productionId: string })
    .productionId;
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  let capability = '';
  try {
    const stored = await owner.query<{
      delivery_key_id: string;
      delivery_ciphertext: string;
    }>(
      `select delivery_key_id, delivery_ciphertext
         from records_governance.record_productions
        where production_id = $1`,
      [productionId],
    );
    capability = decryptRecordProductionDelivery({
      keys: invitationSecrets,
      keyId: stored.rows[0]!.delivery_key_id,
      ciphertext: stored.rows[0]!.delivery_ciphertext,
      productionId,
    }).capability;
    await owner.query(`
      create function records_governance.test_fail_cleanup() returns trigger
      language plpgsql as $$
      begin
        if new.ciphertext is null and old.ciphertext is not null then
          raise exception 'forced cleanup failure';
        end if;
        return new;
      end;
      $$;
      create trigger test_fail_cleanup
      before update on records_governance.record_productions
      for each row execute function records_governance.test_fail_cleanup();
    `);
  } finally {
    await owner.end();
  }

  now = new Date(now.getTime() + 11 * 60 * 1000);
  const failed = await fetch(
    `${baseUrl}/api/v1/records/productions/retrievals`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ capability }),
    },
  );
  expect(failed.status).toBe(409);
  expect(await failed.json()).toMatchObject({
    code: 'RECORD_PRODUCTION_CLEANUP_FAILED',
  });

  const blocked = new Client({ connectionString: postgres.connectionString });
  await blocked.connect();
  try {
    const stored = await blocked.query<{
      ciphertext: string | null;
      cleanup_status: string;
    }>(
      `select ciphertext, cleanup_status
         from records_governance.record_productions
        where production_id = $1`,
      [productionId],
    );
    expect(stored.rows[0]?.ciphertext).toBeString();
    await blocked.query(`
      drop trigger test_fail_cleanup on records_governance.record_productions;
      drop function records_governance.test_fail_cleanup();
    `);
  } finally {
    await blocked.end();
  }

  const repaired = await fetch(
    `${baseUrl}/api/v1/administration/students/record-production-cleanups`,
    {
      method: 'POST',
      headers: { ...mutationHeaders, cookie: staffCookie() },
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        productionId,
      }),
    },
  );
  expect(repaired.status).toBe(200);
  expect(await repaired.json()).toMatchObject({ outcome: 'removed' });

  const later = await fetch(
    `${baseUrl}/api/v1/records/productions/retrievals`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ capability }),
    },
  );
  expect(later.status).toBe(404);
});

test('Record Production delivery failure stays visible and is not reported as delivered', async () => {
  let attempts = 0;
  await expect(
    runRecordProductionDeliveryCycle({
      outbox: { pending: async () => [{ outboxId: 'outbox-production-1' }] },
      queue: {
        send: async () => {},
        receive: async () => ({
          messageId: 'message-1',
          outboxId: 'outbox-production-1',
          attempt: attempts + 1,
        }),
        complete: async () => {},
        retry: async () => {},
      },
      deliveries: {
        claim: async () => ({
          outcome: 'deliver',
          outboxId: 'outbox-production-1',
          productionId: 'production-1',
          keyId: 'test',
          ciphertext: 'protected',
          providerIdempotencyKey: 'production-1',
        }),
        complete: async () => {
          throw new Error('must not complete after provider failure');
        },
        suppress: async () => {},
      },
      decrypt: () => ({
        recipient: 'custodian@example.org',
        capability: 'secret-capability',
      }),
      mail: {
        sendInvitation: async () => {
          attempts += 1;
          throw new PermanentInvitationDeliveryError();
        },
      },
      clock: { now: () => now },
    }),
  ).resolves.toBeUndefined();
  expect(attempts).toBe(1);
});

test('staff interfaces do not gain export or Learning Progress reports', async () => {
  const lifecycle = await readFile(
    new URL(
      '../../src/features/staff/StudentRecordLifecycleSection.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  const retrieve = await readFile(
    new URL(
      '../../src/features/records/RecordProductionRetrievePage.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  const clinical = await readFile(
    new URL(
      '../../src/features/staff/ClinicalReviewSection.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  const home = await readFile(
    new URL('../../src/features/staff/StaffHomePage.tsx', import.meta.url),
    'utf8',
  );
  const contract = await readFile(
    new URL('../../packages/http-contract/openapi.json', import.meta.url),
    'utf8',
  );
  expect(lifecycle).toContain('Resolve Record Amendment');
  expect(lifecycle).toContain('Authorize Record Production');
  expect(lifecycle).toContain('Record Conflict Review');
  expect(lifecycle).not.toContain('localStorage');
  expect(lifecycle).not.toContain('sessionStorage');
  expect(lifecycle).not.toMatch(/Learning Progress report/i);
  expect(retrieve).toContain("cache: 'no-store'");
  expect(retrieve).not.toContain('localStorage');
  expect(retrieve).not.toContain('sessionStorage');
  expect(retrieve).not.toContain('searchParams');
  expect(retrieve).not.toContain('useSearchParams');
  expect(clinical).not.toMatch(/\bExport\b/);
  expect(clinical).not.toMatch(/Learning Progress report/i);
  expect(home).not.toMatch(/\bExport\b/);
  expect(home).not.toMatch(/Learning Progress report/i);
  expect(contract).not.toMatch(/record-merges/);
  expect(contract).not.toMatch(/learning-progress-report/);
  expect(contract).toContain('/api/v1/records/productions/retrievals');
});
