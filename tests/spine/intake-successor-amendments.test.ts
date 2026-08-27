import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { createServer } from '../../apps/server/src/app.ts';
import type {
  IntakeFormField,
  StudentIntakeSnapshot,
} from '../../modules/intake/index.ts';
import { createApiClient } from '../../packages/api-client/src/index.ts';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import {
  createRuntimeDatabaseUser,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from '../../packages/test-support/src/postgres.ts';
import { createFakeStaffAuth } from '../../packages/test-support/src/staff-auth.ts';
import { totpCode } from '../../packages/test-support/src/totp.ts';

const workspaceId = 'beb4193a-1e8f-4096-a449-6d77628fd275';
const administratorId = crypto.randomUUID();
const clinicianId = crypto.randomUUID();
const classId = crypto.randomUUID();
const invitationId = crypto.randomUUID();
const administratorEmail = 'administrator.successor@example.test';
const clinicianEmail = 'clinician.successor@example.test';
const password = 'correct horse battery staple';
const recipient = 'student.successor@example.test';
const invitationCode = '729104';
const originalAnswer = 'UNIQUE-ORIGINAL-TOKEN-42a1';
const amendedAnswer = 'UNIQUE-AMENDED-TOKEN-42b2';
const origin = 'http://127.0.0.1';
const operatorHeaders = {
  authorization: `Bearer ${'successor-operator-token-'.padEnd(40, 'x')}`,
  origin,
  'x-prevcare-csrf': '1',
} as const;
const mutationHeaders = {
  origin,
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;

let now = new Date('2026-08-27T16:00:00.000Z');
let postgres: EphemeralPostgres;
let runtimeDatabaseUrl: string;
let server: FastifyInstance;
let baseUrl: string;
let administratorCookie: string;
let clinicianCookie: string;
let studentCookie: string;
let candidate: unknown;
let telemetryLines: string[] = [];
const fakeAuth = createFakeStaffAuth();
const intakeInvitationSecrets = {
  hmacKey: Buffer.alloc(32, 7),
  encryptionKeys: { test: Buffer.alloc(32, 9) },
  activeEncryptionKeyId: 'test',
  createCode: () => invitationCode,
};

function completeAnswers(fields: IntakeFormField[], name = originalAnswer) {
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
        field.key === 'name'
          ? name
          : field.type === 'tel'
            ? '5550100'
            : 'Synthetic Student';
    }
  }
  return answers;
}

function nameFieldId(fields: IntakeFormField[]) {
  return fields.find((field) => field.key === 'name')?.id ?? '';
}

async function jsonRequest(
  path: string,
  input: {
    method: 'GET' | 'POST' | 'PUT';
    cookie: string;
    body?: unknown;
  },
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: input.method,
    headers: {
      ...mutationHeaders,
      cookie: input.cookie,
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  return { response, payload };
}

async function markInvitationDelivered(deliveredInvitationId = invitationId) {
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

async function inviteAndRedeemStudent(input: {
  classId: string;
  invitationId: string;
  recipient: string;
  name: string;
}) {
  const client = createApiClient(baseUrl);
  const invited = await client.POST('/api/v1/administration/classes', {
    headers: { ...operatorHeaders, cookie: administratorCookie },
    body: {
      operationId: crypto.randomUUID(),
      classId: input.classId,
      invitationId: input.invitationId,
      name: input.name,
      recipient: input.recipient,
    },
  });
  expect(invited.response.status).toBe(201);
  await markInvitationDelivered(input.invitationId);
  const redeemed = await fetch(
    `${baseUrl}/api/v1/auth/student/invitations/redeem`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({
        recipient: input.recipient,
        code: invitationCode,
      }),
    },
  );
  expect(redeemed.status).toBe(200);
  return redeemed.headers.get('set-cookie')?.split(';', 1)[0] as string;
}

function submissionBody(
  snapshot: StudentIntakeSnapshot,
  answers: Record<string, string>,
  operationId: string,
  expected?: {
    draftRevision?: number;
    currentIntakeRecordVersionId?: string;
  },
) {
  return {
    operationId,
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
    ...(expected?.draftRevision === undefined
      ? {}
      : { expectedDraftRevision: expected.draftRevision }),
    ...(expected?.currentIntakeRecordVersionId
      ? {
          expectedCurrentIntakeRecordVersionId:
            expected.currentIntakeRecordVersionId,
        }
      : {}),
    locale: 'en-US' as const,
    answers,
    attestation: {
      locale: 'en-US' as const,
      notice: {
        resourceId: snapshot.form.submissionAttestation.resourceId,
        revisionNumber: snapshot.form.submissionAttestation.revisionNumber,
      },
    },
  };
}

async function acceptInitialVersion(cookie: string, name = originalAnswer) {
  const client = createApiClient(baseUrl);
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(opened.response.status).toBe(200);
  const snapshot = opened.data as StudentIntakeSnapshot;
  const answers = completeAnswers(snapshot.form.intakeForm.fields, name);
  const submitted = await jsonRequest('/api/v1/student/intake/submissions', {
    method: 'POST',
    cookie,
    body: submissionBody(snapshot, answers, crypto.randomUUID()),
  });
  expect(submitted.response.status).toBe(201);
  return {
    snapshot,
    answers,
    intakeRecordVersionId: submitted.payload.intakeRecordVersionId as string,
  };
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
      token: operatorHeaders.authorization.slice('Bearer '.length),
      actorId: 'successor-test-operator',
    },
    staffAuth: fakeAuth.provider,
    clock: { now: () => now },
    invitationSecrets: intakeInvitationSecrets,
    wrappingKeys: {
      wrappingKeys: { test: Buffer.alloc(32, 13) },
      activeWrappingKeyId: 'test',
      idempotencyKey: Buffer.alloc(32, 17),
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
        displayName: 'UMass Boston Demo Workspace',
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
          reason: 'Intake successor amendment test',
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
        changeDescription:
          'Publish the reviewed synthetic golden-journey content.',
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
      name: 'Health Literacy 7A',
      recipient,
    },
  });
  expect(invited.response.status).toBe(201);
  await markInvitationDelivered();
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
});

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
});

test('reopening seeds a private draft from the current Intake Record Version without mutating accepted evidence', async () => {
  telemetryLines = [];
  const client = createApiClient(baseUrl);
  const accepted = await acceptInitialVersion(studentCookie);
  const nameId = nameFieldId(accepted.snapshot.form.intakeForm.fields);
  expect(accepted.answers[nameId]).toBe(originalAnswer);

  const operationId = crypto.randomUUID();
  const reopened = await jsonRequest('/api/v1/student/intake/reopen', {
    method: 'POST',
    cookie: studentCookie,
    body: {
      operationId,
      expectedCurrentIntakeRecordVersionId: accepted.intakeRecordVersionId,
      locale: 'en-US',
    },
  });
  expect(reopened.response.status).toBe(200);
  expect(reopened.payload).toMatchObject({
    operationId,
    locale: 'en-US',
    draftRevision: 1,
    replayed: false,
  });
  expect(JSON.stringify(reopened.payload)).not.toContain(originalAnswer);

  const replay = await jsonRequest('/api/v1/student/intake/reopen', {
    method: 'POST',
    cookie: studentCookie,
    body: {
      operationId,
      expectedCurrentIntakeRecordVersionId: accepted.intakeRecordVersionId,
      locale: 'en-US',
    },
  });
  expect(replay.response.status).toBe(200);
  expect(replay.payload).toEqual({ ...reopened.payload, replayed: true });

  const snapshot = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(snapshot.response.status).toBe(200);
  expect(snapshot.data).toMatchObject({
    learningUnlocked: true,
    currentIntakeRecordVersion: {
      intakeRecordVersionId: accepted.intakeRecordVersionId,
    },
    draft: {
      draftRevision: 1,
      answers: accepted.answers,
    },
  });

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const evidence = await inspection.query<{
      versions: string;
      drafts: string;
      superseded_at: Date | null;
      wrapping_key_id: string;
      ciphertext: string;
    }>(
      `select
         (select count(*) from intake.intake_record_versions
           where student_id = version.student_id) as versions,
         (select count(*) from intake.intake_drafts
           where student_id = version.student_id) as drafts,
         superseded_at, wrapping_key_id, ciphertext
       from intake.intake_record_versions version
      where intake_record_version_id = $1`,
      [accepted.intakeRecordVersionId],
    );
    expect(evidence.rows).toEqual([
      expect.objectContaining({
        versions: '1',
        drafts: '1',
        superseded_at: null,
        wrapping_key_id: 'test',
      }),
    ]);
    expect(evidence.rows[0]?.ciphertext).not.toContain(originalAnswer);
    await expect(
      inspection.query(
        `update intake.intake_record_versions
            set locale = 'es-US' where intake_record_version_id = $1`,
        [accepted.intakeRecordVersionId],
      ),
    ).rejects.toThrow('immutable');
  } finally {
    await inspection.end();
  }

  expect(telemetryLines.join('\n')).not.toContain(originalAnswer);
});

test('successor submission requires expected revisions and a fresh attestation, then advances the current pointer once', async () => {
  telemetryLines = [];
  const client = createApiClient(baseUrl);
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  const snapshot = opened.data as StudentIntakeSnapshot;
  const nameId = nameFieldId(snapshot.form.intakeForm.fields);
  const originalVersionId =
    snapshot.currentIntakeRecordVersion?.intakeRecordVersionId ?? '';
  const amended = {
    ...(snapshot.draft?.answers ?? {}),
    [nameId]: amendedAnswer,
  };

  const saved = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: {
      operationId: crypto.randomUUID(),
      expectedDraftRevision: snapshot.draft?.draftRevision ?? 0,
      expectedSchoolConfigurationReleaseId:
        snapshot.form.schoolConfigurationReleaseId,
      expectedIntakeForm: {
        resourceId: snapshot.form.intakeForm.resourceId,
        revisionNumber: snapshot.form.intakeForm.revisionNumber,
      },
      locale: 'en-US',
      answers: amended,
    },
  });
  expect(saved.response.status).toBe(200);

  const operationId = crypto.randomUUID();
  const submitted = await jsonRequest('/api/v1/student/intake/submissions', {
    method: 'POST',
    cookie: studentCookie,
    body: submissionBody(snapshot, amended, operationId, {
      draftRevision: saved.data?.draftRevision,
      currentIntakeRecordVersionId: originalVersionId,
    }),
  });
  expect(submitted.response.status).toBe(201);
  expect(submitted.payload).toMatchObject({
    operationId,
    learningUnlocked: true,
    replayed: false,
    predecessorIntakeRecordVersionId: originalVersionId,
  });
  expect(submitted.payload.intakeRecordVersionId).not.toBe(originalVersionId);
  expect(submitted.payload.changedFields).toEqual([
    { fieldId: nameId, change: 'changed' },
  ]);
  expect(JSON.stringify(submitted.payload)).not.toContain(originalAnswer);
  expect(JSON.stringify(submitted.payload)).not.toContain(amendedAnswer);

  const replay = await jsonRequest('/api/v1/student/intake/submissions', {
    method: 'POST',
    cookie: studentCookie,
    body: submissionBody(snapshot, amended, operationId, {
      draftRevision: saved.data?.draftRevision,
      currentIntakeRecordVersionId: originalVersionId,
    }),
  });
  expect(replay.response.status).toBe(201);
  expect(replay.payload).toEqual({ ...submitted.payload, replayed: true });

  const confirmed = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(confirmed.data).toMatchObject({
    learningUnlocked: true,
    draft: null,
    currentIntakeRecordVersion: {
      intakeRecordVersionId: submitted.payload.intakeRecordVersionId,
    },
  });

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const versions = await inspection.query<{
      intake_record_version_id: string;
      version_number: number;
      superseded_at: Date | null;
      intake_form_resource_id: string;
      intake_form_revision_number: number;
      ciphertext: string;
    }>(
      `select intake_record_version_id, version_number, superseded_at,
              intake_form_resource_id, intake_form_revision_number, ciphertext
         from intake.intake_record_versions
        where student_id = (
          select student_id from intake.intake_record_versions
           where intake_record_version_id = $1
        )
        order by version_number`,
      [originalVersionId],
    );
    expect(versions.rows).toHaveLength(2);
    expect(versions.rows[0]).toMatchObject({
      intake_record_version_id: originalVersionId,
      version_number: 1,
    });
    expect(versions.rows[0]?.superseded_at).not.toBeNull();
    expect(versions.rows[1]).toMatchObject({
      intake_record_version_id: submitted.payload.intakeRecordVersionId,
      version_number: 2,
      superseded_at: null,
      intake_form_resource_id: versions.rows[0]?.intake_form_resource_id,
      intake_form_revision_number:
        versions.rows[0]?.intake_form_revision_number,
    });
    expect(versions.rows[0]?.ciphertext).not.toContain(originalAnswer);
    expect(versions.rows[1]?.ciphertext).not.toContain(amendedAnswer);

    const historicalForm = await inspection.query(
      `select lifecycle from school_configuration.authored_revisions
        where resource_id = $1 and revision_number = $2 and lifecycle = 'frozen'`,
      [
        versions.rows[0]?.intake_form_resource_id,
        versions.rows[0]?.intake_form_revision_number,
      ],
    );
    expect(historicalForm.rows).toHaveLength(1);

    await expect(
      inspection.query(
        `update intake.intake_record_versions
            set locale = 'es-US' where intake_record_version_id = $1`,
        [originalVersionId],
      ),
    ).rejects.toThrow('immutable');
    await expect(
      inspection.query(
        `update intake.intake_record_versions
            set superseded_at = null where intake_record_version_id = $1`,
        [originalVersionId],
      ),
    ).rejects.toThrow('immutable');

    const audit = await inspection.query<{ details: Record<string, unknown> }>(
      `select details from audit.evidence where operation_id = $1`,
      [operationId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.details).toMatchObject({
      intakeRecordVersionId: submitted.payload.intakeRecordVersionId,
      predecessorIntakeRecordVersionId: originalVersionId,
      changedFields: [{ fieldId: nameId, change: 'changed' }],
    });
    expect(JSON.stringify(audit.rows[0]?.details)).not.toContain(
      originalAnswer,
    );
    expect(JSON.stringify(audit.rows[0]?.details)).not.toContain(amendedAnswer);
  } finally {
    await inspection.end();
  }

  const session = await client.GET('/api/v1/student/session', {
    headers: { cookie: studentCookie },
  });
  const revealed = await client.POST(
    '/api/v1/clinical/intake-records/current',
    {
      headers: { ...mutationHeaders, cookie: clinicianCookie },
      body: { studentId: session.data?.studentId ?? '' },
    },
  );
  expect(revealed.response.status).toBe(200);
  expect(revealed.data?.intakeRecordVersionId).toBe(
    submitted.payload.intakeRecordVersionId,
  );
  expect(revealed.data?.answers[nameId]).toBe(amendedAnswer);
  expect(revealed.data?.answers[nameId]).not.toBe(originalAnswer);

  expect(telemetryLines.join('\n')).not.toContain(originalAnswer);
  expect(telemetryLines.join('\n')).not.toContain(amendedAnswer);
});

test('stale draft and stale base-current submissions conflict without last-write-wins or merging', async () => {
  const cookie = await inviteAndRedeemStudent({
    classId: crypto.randomUUID(),
    invitationId: crypto.randomUUID(),
    recipient: 'student.conflict@example.test',
    name: 'Health Literacy 7B',
  });
  const accepted = await acceptInitialVersion(cookie, originalAnswer);
  const client = createApiClient(baseUrl);
  const reopen = await jsonRequest('/api/v1/student/intake/reopen', {
    method: 'POST',
    cookie,
    body: {
      operationId: crypto.randomUUID(),
      expectedCurrentIntakeRecordVersionId: accepted.intakeRecordVersionId,
      locale: 'en-US',
    },
  });
  expect(reopen.response.status).toBe(200);

  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie },
    params: { query: { locale: 'en-US' } },
  });
  const snapshot = opened.data as StudentIntakeSnapshot;
  const nameId = nameFieldId(snapshot.form.intakeForm.fields);
  const laterAnswers = {
    ...(snapshot.draft?.answers ?? {}),
    [nameId]: amendedAnswer,
  };
  const saved = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie },
    body: {
      operationId: crypto.randomUUID(),
      expectedDraftRevision: snapshot.draft?.draftRevision ?? 0,
      expectedSchoolConfigurationReleaseId:
        snapshot.form.schoolConfigurationReleaseId,
      expectedIntakeForm: {
        resourceId: snapshot.form.intakeForm.resourceId,
        revisionNumber: snapshot.form.intakeForm.revisionNumber,
      },
      locale: 'en-US',
      answers: laterAnswers,
    },
  });
  expect(saved.response.status).toBe(200);

  const staleDraft = await jsonRequest('/api/v1/student/intake/submissions', {
    method: 'POST',
    cookie,
    body: submissionBody(snapshot, laterAnswers, crypto.randomUUID(), {
      draftRevision: snapshot.draft?.draftRevision,
      currentIntakeRecordVersionId: accepted.intakeRecordVersionId,
    }),
  });
  expect(staleDraft.response.status).toBe(409);
  expect(staleDraft.payload).toMatchObject({
    code: 'INTAKE_DRAFT_REVISION_CONFLICT',
    draftRevision: saved.data?.draftRevision,
  });
  expect(JSON.stringify(staleDraft.payload)).not.toContain(amendedAnswer);

  const afterStaleDraft = await client.GET('/api/v1/student/intake', {
    headers: { cookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(
    afterStaleDraft.data?.currentIntakeRecordVersion?.intakeRecordVersionId,
  ).toBe(accepted.intakeRecordVersionId);
  expect(afterStaleDraft.data?.draft?.answers[nameId]).toBe(amendedAnswer);

  const firstSuccessor = await jsonRequest(
    '/api/v1/student/intake/submissions',
    {
      method: 'POST',
      cookie,
      body: submissionBody(
        afterStaleDraft.data as StudentIntakeSnapshot,
        laterAnswers,
        crypto.randomUUID(),
        {
          draftRevision: afterStaleDraft.data?.draft?.draftRevision,
          currentIntakeRecordVersionId: accepted.intakeRecordVersionId,
        },
      ),
    },
  );
  expect(firstSuccessor.response.status).toBe(201);
  const successorId = firstSuccessor.payload.intakeRecordVersionId as string;

  const staleCurrent = await jsonRequest('/api/v1/student/intake/submissions', {
    method: 'POST',
    cookie,
    body: submissionBody(
      afterStaleDraft.data as StudentIntakeSnapshot,
      {
        ...laterAnswers,
        [nameId]: 'UNIQUE-STALE-TOKEN-42c3',
      },
      crypto.randomUUID(),
      {
        draftRevision: afterStaleDraft.data?.draft?.draftRevision,
        currentIntakeRecordVersionId: accepted.intakeRecordVersionId,
      },
    ),
  });
  expect(staleCurrent.response.status).toBe(409);
  expect(staleCurrent.payload).toMatchObject({
    code: 'INTAKE_CURRENT_REVISION_CONFLICT',
    currentIntakeRecordVersionId: successorId,
  });
  expect(JSON.stringify(staleCurrent.payload)).not.toContain(amendedAnswer);
  expect(JSON.stringify(staleCurrent.payload)).not.toContain(
    'UNIQUE-STALE-TOKEN-42c3',
  );

  const confirmed = await client.GET('/api/v1/student/intake', {
    headers: { cookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(
    confirmed.data?.currentIntakeRecordVersion?.intakeRecordVersionId,
  ).toBe(successorId);
  expect(confirmed.data?.draft).toBeNull();

  const session = await client.GET('/api/v1/student/session', {
    headers: { cookie },
  });
  const revealed = await client.POST(
    '/api/v1/clinical/intake-records/current',
    {
      headers: { ...mutationHeaders, cookie: clinicianCookie },
      body: { studentId: session.data?.studentId ?? '' },
    },
  );
  expect(revealed.data?.intakeRecordVersionId).toBe(successorId);
  expect(revealed.data?.answers[nameId]).toBe(amendedAnswer);
  expect(revealed.data?.answers[nameId]).not.toBe('UNIQUE-STALE-TOKEN-42c3');
});

test('amendment drafts stay student-private and a submit without the current pointer is rejected', async () => {
  const cookie = await inviteAndRedeemStudent({
    classId: crypto.randomUUID(),
    invitationId: crypto.randomUUID(),
    recipient: 'student.private@example.test',
    name: 'Health Literacy 7C',
  });
  const accepted = await acceptInitialVersion(cookie, originalAnswer);
  const reopen = await jsonRequest('/api/v1/student/intake/reopen', {
    method: 'POST',
    cookie,
    body: {
      operationId: crypto.randomUUID(),
      expectedCurrentIntakeRecordVersionId: accepted.intakeRecordVersionId,
      locale: 'en-US',
    },
  });
  expect(reopen.response.status).toBe(200);

  const client = createApiClient(baseUrl);
  const duplicate = await jsonRequest('/api/v1/student/intake/submissions', {
    method: 'POST',
    cookie,
    body: submissionBody(
      accepted.snapshot,
      accepted.answers,
      crypto.randomUUID(),
    ),
  });
  expect(duplicate.response.status).toBe(409);
  expect(duplicate.payload).toMatchObject({ code: 'INTAKE_ALREADY_ACCEPTED' });

  const clinical = await client.GET('/api/v1/clinical/review-directory', {
    headers: { cookie: clinicianCookie },
  });
  expect(JSON.stringify(clinical.data)).not.toContain(originalAnswer);
  const session = await client.GET('/api/v1/student/session', {
    headers: { cookie },
  });
  expect(
    clinical.data?.students.find(
      (entry) => entry.studentId === session.data?.studentId,
    )?.currentIntakeRecordVersion?.intakeRecordVersionId,
  ).toBe(accepted.intakeRecordVersionId);

  const staffIntake = await client.GET('/api/v1/student/intake', {
    headers: { cookie: administratorCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(staffIntake.response.status).toBe(401);

  const anonymous = await jsonRequest('/api/v1/student/intake/reopen', {
    method: 'POST',
    cookie: '',
    body: {
      operationId: crypto.randomUUID(),
      expectedCurrentIntakeRecordVersionId: accepted.intakeRecordVersionId,
      locale: 'en-US',
    },
  });
  expect(anonymous.response.status).toBe(401);
});
