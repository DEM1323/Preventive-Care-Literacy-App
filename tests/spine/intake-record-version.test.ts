import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { createServer } from '../../apps/server/src/app.ts';
import type {
  IntakeFormField,
  StudentIntakeSnapshot,
  SubmitIntakeRecordVersionResult,
} from '../../modules/intake/index.ts';
import { canonicalJson } from '../../modules/school-configuration/index.ts';
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
const administratorId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5101';
const clinicianId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5102';
const classId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5103';
const invitationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf5104';
const administratorEmail = 'administrator@example.test';
const clinicianEmail = 'clinician@example.test';
const password = 'correct horse battery staple';
const recipient = 'student.one@example.test';
const invitationCode = '729104';
const distinctiveAnswer = 'UNIQUE-ANSWER-TOKEN-7f3a';
const origin = 'http://127.0.0.1';
const operatorHeaders = {
  authorization: `Bearer ${'intake-operator-token-'.padEnd(40, 'x')}`,
  origin,
  'x-prevcare-csrf': '1',
} as const;
const mutationHeaders = {
  origin,
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;

let now = new Date('2026-08-25T15:00:00.000Z');
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
const intakeIdempotencyKey = Buffer.alloc(32, 17);
const acceptedOperationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf51aa';

function completeAnswers(fields: IntakeFormField[]) {
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
          ? distinctiveAnswer
          : field.type === 'tel'
            ? '5550100'
            : 'Synthetic Student';
    }
  }
  return answers;
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
      actorId: 'intake-test-operator',
    },
    staffAuth: fakeAuth.provider,
    clock: { now: () => now },
    invitationSecrets: intakeInvitationSecrets,
    wrappingKeys: {
      wrappingKeys: { test: Buffer.alloc(32, 13) },
      activeWrappingKeyId: 'test',
      idempotencyKey: intakeIdempotencyKey,
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
          reason: 'Intake Record Version test',
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

test('Student completes an encrypted Intake Draft and receives one immutable Intake Record Version', async () => {
  telemetryLines = [];
  const client = createApiClient(baseUrl);
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(opened.response.status).toBe(200);
  const snapshot = opened.data as StudentIntakeSnapshot;
  expect(snapshot.learningUnlocked).toBe(false);
  expect(snapshot.currentIntakeRecordVersion).toBeNull();
  expect(snapshot.draft).toBeNull();
  expect(snapshot.form.intakeForm.fields.length).toBeGreaterThan(0);

  const answers = completeAnswers(snapshot.form.intakeForm.fields);
  expect(
    answers[
      snapshot.form.intakeForm.fields.find((field) => field.key === 'name')
        ?.id ?? ''
    ],
  ).toBe(distinctiveAnswer);

  const saved = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: {
      expectedSchoolConfigurationReleaseId:
        snapshot.form.schoolConfigurationReleaseId,
      expectedIntakeForm: {
        resourceId: snapshot.form.intakeForm.resourceId,
        revisionNumber: snapshot.form.intakeForm.revisionNumber,
      },
      locale: 'en-US',
      answers,
    },
  });
  expect(saved.response.status).toBe(200);

  const resumed = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(resumed.data?.draft?.answers).toEqual(answers);
  expect(JSON.stringify(resumed.data?.form)).not.toContain(distinctiveAnswer);

  const operationId = acceptedOperationId;
  const command = {
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
  const submitted = await client.POST('/api/v1/student/intake/submissions', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: command,
  });
  expect(submitted.response.status).toBe(201);
  expect(submitted.data).toMatchObject({
    operationId,
    learningUnlocked: true,
    replayed: false,
  });
  expect(JSON.stringify(submitted.data)).not.toContain(distinctiveAnswer);

  const replay = await client.POST('/api/v1/student/intake/submissions', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: command,
  });
  expect(replay.response.status).toBe(201);
  expect(replay.data).toEqual({ ...submitted.data, replayed: true });

  const confirmed = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(confirmed.data).toMatchObject({
    learningUnlocked: true,
    draft: null,
    currentIntakeRecordVersion: {
      intakeRecordVersionId: submitted.data?.intakeRecordVersionId,
      schoolConfigurationReleaseId: snapshot.form.schoolConfigurationReleaseId,
      locale: 'en-US',
    },
  });
  expect(JSON.stringify(confirmed.data)).not.toContain(distinctiveAnswer);

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const records = await inspection.query<{
      versions: string;
      drafts: string;
      audit_count: string;
      outbox_count: string;
      wrapping_key_id: string;
      wrapped_data_key: string;
      ciphertext: string;
    }>(
      `select
         (select count(*) from intake.intake_record_versions) as versions,
         (select count(*) from intake.intake_drafts) as drafts,
         (select count(*) from audit.evidence where operation_id = $1) as audit_count,
         (select count(*) from infrastructure.outbox where operation_id = $1) as outbox_count,
         wrapping_key_id, wrapped_data_key, ciphertext
       from intake.intake_record_versions`,
      [operationId],
    );
    expect(records.rows).toEqual([
      expect.objectContaining({
        versions: '1',
        drafts: '0',
        audit_count: '1',
        outbox_count: '1',
        wrapping_key_id: 'test',
      }),
    ]);
    expect(records.rows[0]?.wrapped_data_key).not.toContain(distinctiveAnswer);
    expect(records.rows[0]?.ciphertext).not.toContain(distinctiveAnswer);
    const receipts = await inspection.query<{
      request_binding: string;
      student_id: string;
      result: SubmitIntakeRecordVersionResult;
    }>(
      `select request_binding, student_id, result
         from intake.intake_operation_receipts
        where operation_id = $1`,
      [operationId],
    );
    expect(receipts.rows).toHaveLength(1);
    const storedBinding = receipts.rows[0]?.request_binding ?? '';
    const guessableFingerprint = createHash('sha256')
      .update(canonicalJson(command))
      .digest('hex');
    expect(storedBinding).not.toBe(guessableFingerprint);
    expect(storedBinding).not.toBe(
      createHash('sha256').update(canonicalJson(answers)).digest('hex'),
    );
    expect(storedBinding).not.toContain(distinctiveAnswer);
    expect(JSON.stringify(receipts.rows[0]?.result)).not.toContain(
      distinctiveAnswer,
    );
    expect(receipts.rows[0]?.student_id).toBeTruthy();
    await expect(
      inspection.query(
        `update intake.intake_record_versions
            set locale = 'es-US' where intake_record_version_id = $1`,
        [submitted.data?.intakeRecordVersionId],
      ),
    ).rejects.toThrow('immutable');
  } finally {
    await inspection.end();
  }

  const nameFieldId =
    snapshot.form.intakeForm.fields.find((field) => field.key === 'name')?.id ??
    Object.keys(answers)[0] ??
    '';
  const reused = await client.POST('/api/v1/student/intake/submissions', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: {
      ...command,
      answers: { ...answers, [nameFieldId]: 'Synthetic Student Retry' },
    },
  });
  expect(reused.response.status).toBe(409);
  expect(reused.error).toMatchObject({ code: 'OPERATION_ID_REUSED' });
  expect(JSON.stringify(reused.error)).not.toContain(distinctiveAnswer);

  expect(telemetryLines.join('\n')).not.toContain(distinctiveAnswer);
  expect(telemetryLines.join('\n')).not.toContain(recipient);
});

test('an accepted intake operation replays after wrapping-key rotation', async () => {
  const rotated = await createServer({
    databaseUrl: runtimeDatabaseUrl,
    publicOrigin: origin,
    operatorCredentials: {
      token: operatorHeaders.authorization.slice('Bearer '.length),
      actorId: 'intake-test-operator',
    },
    staffAuth: fakeAuth.provider,
    clock: { now: () => now },
    invitationSecrets: intakeInvitationSecrets,
    wrappingKeys: {
      wrappingKeys: { rotated: Buffer.alloc(32, 23) },
      activeWrappingKeyId: 'rotated',
      idempotencyKey: intakeIdempotencyKey,
    },
    telemetry: { record() {} },
  });
  const rotatedUrl = await rotated.listen({ host: '127.0.0.1', port: 0 });
  try {
    const client = createApiClient(rotatedUrl);
    const opened = await client.GET('/api/v1/student/intake', {
      headers: { cookie: studentCookie },
      params: { query: { locale: 'en-US' } },
    });
    expect(opened.response.status).toBe(200);
    const snapshot = opened.data as StudentIntakeSnapshot;
    const answers = completeAnswers(snapshot.form.intakeForm.fields);
    const command = submissionBody(snapshot, answers, acceptedOperationId);

    const replay = await client.POST('/api/v1/student/intake/submissions', {
      headers: { ...mutationHeaders, cookie: studentCookie },
      body: command,
    });
    expect(replay.response.status).toBe(201);
    expect(replay.data).toMatchObject({
      operationId: acceptedOperationId,
      intakeRecordVersionId:
        snapshot.currentIntakeRecordVersion?.intakeRecordVersionId,
      learningUnlocked: true,
      replayed: true,
    });
    expect(JSON.stringify(replay.data)).not.toContain(distinctiveAnswer);

    const nameFieldId =
      snapshot.form.intakeForm.fields.find((field) => field.key === 'name')
        ?.id ?? '';
    const reused = await client.POST('/api/v1/student/intake/submissions', {
      headers: { ...mutationHeaders, cookie: studentCookie },
      body: {
        ...command,
        answers: { ...answers, [nameFieldId]: 'Synthetic Student Retry' },
      },
    });
    expect(reused.response.status).toBe(409);
    expect(reused.error).toMatchObject({ code: 'OPERATION_ID_REUSED' });
    expect(JSON.stringify(reused.error)).not.toContain(distinctiveAnswer);
  } finally {
    await rotated.close();
  }
});

test('retries, staff projections, and failures cannot expose or duplicate protected answers', async () => {
  const client = createApiClient(baseUrl);
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  const snapshot = opened.data as StudentIntakeSnapshot;
  const duplicate = await client.POST('/api/v1/student/intake/submissions', {
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
      answers: completeAnswers(snapshot.form.intakeForm.fields),
      attestation: {
        locale: 'en-US',
        notice: {
          resourceId: snapshot.form.submissionAttestation.resourceId,
          revisionNumber: snapshot.form.submissionAttestation.revisionNumber,
        },
      },
    },
  });
  expect(duplicate.response.status).toBe(409);
  expect(duplicate.error).toMatchObject({ code: 'INTAKE_ALREADY_ACCEPTED' });
  expect(JSON.stringify(duplicate.error)).not.toContain(distinctiveAnswer);

  const incomplete = await client.POST('/api/v1/student/intake/submissions', {
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
      answers: {
        [snapshot.form.intakeForm.fields[0]?.id ?? crypto.randomUUID()]:
          distinctiveAnswer,
      },
      attestation: {
        locale: 'en-US',
        notice: {
          resourceId: snapshot.form.submissionAttestation.resourceId,
          revisionNumber: snapshot.form.submissionAttestation.revisionNumber,
        },
      },
    },
  });
  expect([409, 422]).toContain(incomplete.response.status);
  expect(JSON.stringify(incomplete.error)).not.toContain(distinctiveAnswer);

  const clinical = await client.GET('/api/v1/clinical/review-directory', {
    headers: { cookie: clinicianCookie },
  });
  expect(clinical.response.status).toBe(200);
  expect(JSON.stringify(clinical.data)).not.toContain(distinctiveAnswer);
  expect(clinical.data?.students).toEqual([
    expect.objectContaining({
      currentIntakeRecordVersion: expect.objectContaining({
        locale: 'en-US',
      }),
    }),
  ]);

  const staffIntake = await client.GET('/api/v1/student/intake', {
    headers: { cookie: administratorCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(staffIntake.response.status).toBe(401);

  const configuration = await client.GET(
    '/api/v1/administration/school-configuration',
    { headers: { cookie: administratorCookie } },
  );
  expect(configuration.response.status).toBe(200);
  expect(JSON.stringify(configuration.data)).not.toContain(distinctiveAnswer);
});

test('one Student cannot replay another Student intake operation', async () => {
  const client = createApiClient(baseUrl);
  const peerCookie = await inviteAndRedeemStudent({
    classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5201',
    invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5202',
    recipient: 'student.two@example.test',
    name: 'Health Literacy 7B',
  });
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: peerCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(opened.response.status).toBe(200);
  const snapshot = opened.data as StudentIntakeSnapshot;
  const firstStudentOperationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf51aa';
  const replay = await client.POST('/api/v1/student/intake/submissions', {
    headers: { ...mutationHeaders, cookie: peerCookie },
    body: submissionBody(
      snapshot,
      completeAnswers(snapshot.form.intakeForm.fields),
      firstStudentOperationId,
    ),
  });
  expect(replay.response.status).toBe(201);
  expect(replay.data?.replayed).toBe(false);
  expect(replay.data?.intakeRecordVersionId).not.toBeUndefined();
  const firstStudent = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(replay.data?.intakeRecordVersionId).not.toBe(
    firstStudent.data?.currentIntakeRecordVersion?.intakeRecordVersionId,
  );
  expect(JSON.stringify(replay.data)).not.toEqual(
    JSON.stringify({
      ...firstStudent.data?.currentIntakeRecordVersion,
      learningUnlocked: true,
      replayed: true,
      operationId: firstStudentOperationId,
    }),
  );

  const confirmed = await client.GET('/api/v1/student/intake', {
    headers: { cookie: peerCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(
    confirmed.data?.currentIntakeRecordVersion?.intakeRecordVersionId,
  ).toBe(replay.data?.intakeRecordVersionId);
  expect(
    confirmed.data?.currentIntakeRecordVersion?.intakeRecordVersionId,
  ).not.toBe(
    firstStudent.data?.currentIntakeRecordVersion?.intakeRecordVersionId,
  );
});

test('a later School Configuration Release rejects a stale Student submission', async () => {
  const client = createApiClient(baseUrl);
  const peerCookie = await inviteAndRedeemStudent({
    classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5203',
    invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5204',
    recipient: 'student.three@example.test',
    name: 'Health Literacy 7C',
  });
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: peerCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(opened.response.status).toBe(200);
  const snapshot = opened.data as StudentIntakeSnapshot;
  const staleReleaseId = snapshot.form.schoolConfigurationReleaseId;

  const imported = await client.POST(
    '/api/v1/administration/school-configuration/draft-imports',
    {
      headers: { ...operatorHeaders, cookie: administratorCookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedDraftVersion: 2,
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
        expectedActiveReleaseId: staleReleaseId,
        expectedDraftVersion: imported.data?.draftVersion ?? 0,
        candidateFingerprint: imported.data?.candidateFingerprint ?? '',
        changeDescription: 'Publish a successor synthetic release.',
      },
    },
  );
  expect(published.response.status).toBe(201);
  expect(published.data?.activeReleaseId).not.toBe(staleReleaseId);

  const stale = await client.POST('/api/v1/student/intake/submissions', {
    headers: { ...mutationHeaders, cookie: peerCookie },
    body: submissionBody(
      snapshot,
      completeAnswers(snapshot.form.intakeForm.fields),
      crypto.randomUUID(),
    ),
  });
  expect(stale.response.status).toBe(409);
  expect(stale.error).toMatchObject({ code: 'INTAKE_REVISION_CONFLICT' });
  expect(JSON.stringify(stale.error)).not.toContain(distinctiveAnswer);

  const rejected = await client.GET('/api/v1/student/intake', {
    headers: { cookie: peerCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(rejected.data?.currentIntakeRecordVersion).toBeNull();
  expect(rejected.data?.learningUnlocked).toBe(false);
  expect(rejected.data?.form.schoolConfigurationReleaseId).toBe(
    published.data?.activeReleaseId,
  );

  const accepted = await client.POST('/api/v1/student/intake/submissions', {
    headers: { ...mutationHeaders, cookie: peerCookie },
    body: submissionBody(
      rejected.data as StudentIntakeSnapshot,
      completeAnswers(rejected.data?.form.intakeForm.fields ?? []),
      crypto.randomUUID(),
    ),
  });
  expect(accepted.response.status).toBe(201);
  expect(accepted.data?.replayed).toBe(false);
});
