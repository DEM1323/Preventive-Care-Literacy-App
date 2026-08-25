import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { createServer } from '../../apps/server/src/app.ts';
import type {
  AcknowledgeLearningItemResult,
  StudentLearningSnapshot,
} from '../../modules/learning-progress/index.ts';
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
const administratorId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6101';
const clinicianId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6102';
const classId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6103';
const invitationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf6104';
const administratorEmail = 'administrator@example.test';
const clinicianEmail = 'clinician@example.test';
const password = 'correct horse battery staple';
const recipient = 'student.one@example.test';
const invitationCode = '729104';
const origin = 'http://127.0.0.1';
const operatorHeaders = {
  authorization: `Bearer ${'learning-operator-token-'.padEnd(40, 'x')}`,
  origin,
  'x-prevcare-csrf': '1',
} as const;
const mutationHeaders = {
  origin,
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;
const acceptedOperationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf61aa';

let now = new Date('2026-08-25T16:00:00.000Z');
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
const learningInvitationSecrets = {
  hmacKey: Buffer.alloc(32, 7),
  encryptionKeys: { test: Buffer.alloc(32, 9) },
  activeEncryptionKeyId: 'test',
  createCode: () => invitationCode,
};

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
          ? 'Synthetic Student'
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

async function submitIntake(cookie: string) {
  const client = createApiClient(baseUrl);
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(opened.response.status).toBe(200);
  const snapshot = opened.data as StudentIntakeSnapshot;
  const submitted = await client.POST('/api/v1/student/intake/submissions', {
    headers: { ...mutationHeaders, cookie },
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
  expect(submitted.response.status).toBe(201);
}

async function readLearning(cookie: string, locale = 'en-US') {
  return fetch(`${baseUrl}/api/v1/student/learning?locale=${locale}`, {
    headers: { cookie },
  });
}

async function acknowledgeItem(
  cookie: string,
  body: {
    operationId: string;
    expectedSchoolConfigurationReleaseId: string;
    itemId: string;
    revisionNumber: number;
  },
) {
  return fetch(`${baseUrl}/api/v1/student/learning/acknowledgements`, {
    method: 'POST',
    headers: { ...mutationHeaders, cookie },
    body: JSON.stringify(body),
  });
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
      actorId: 'learning-test-operator',
    },
    staffAuth: fakeAuth.provider,
    clock: { now: () => now },
    invitationSecrets: learningInvitationSecrets,
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
          reason: 'Item Completion test',
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

  studentCookie = await inviteAndRedeemStudent({
    classId,
    invitationId,
    recipient,
    name: 'Health Literacy 7A',
  });
});

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
});

test('learning stays locked until intake is accepted and then names one displayed item', async () => {
  const locked = await readLearning(studentCookie);
  expect(locked.status).toBe(200);
  const lockedSnapshot = (await locked.json()) as StudentLearningSnapshot;
  expect(lockedSnapshot).toMatchObject({
    learningUnlocked: false,
    item: null,
    completion: null,
  });

  const blocked = await acknowledgeItem(studentCookie, {
    operationId: crypto.randomUUID(),
    expectedSchoolConfigurationReleaseId: crypto.randomUUID(),
    itemId: crypto.randomUUID(),
    revisionNumber: 1,
  });
  expect(blocked.status).toBe(403);
  expect(await blocked.json()).toMatchObject({ code: 'LEARNING_LOCKED' });

  await submitIntake(studentCookie);

  const opened = await readLearning(studentCookie);
  expect(opened.status).toBe(200);
  const snapshot = (await opened.json()) as StudentLearningSnapshot;
  expect(snapshot.learningUnlocked).toBe(true);
  expect(snapshot.schoolConfigurationReleaseId).toBeString();
  expect(snapshot.item).toMatchObject({
    kind: 'knowledge',
    revisionNumber: 1,
  });
  expect(snapshot.item?.itemId).toBeString();
  expect(snapshot.item?.text.length).toBeGreaterThan(0);
  expect(snapshot.item?.moduleTitle.length).toBeGreaterThan(0);
  expect(snapshot.completion).toBeNull();
});

test('acknowledgement binds the Student, workspace, item, revision, release, and operation', async () => {
  telemetryLines = [];
  const opened = await readLearning(studentCookie);
  const snapshot = (await opened.json()) as StudentLearningSnapshot;
  expect(snapshot.item).not.toBeNull();
  const item = snapshot.item!;
  const command = {
    operationId: acceptedOperationId,
    expectedSchoolConfigurationReleaseId:
      snapshot.schoolConfigurationReleaseId as string,
    itemId: item.itemId,
    revisionNumber: item.revisionNumber,
  };

  const accepted = await acknowledgeItem(studentCookie, command);
  expect(accepted.status).toBe(201);
  const created = (await accepted.json()) as AcknowledgeLearningItemResult;
  expect(created).toMatchObject({
    operationId: acceptedOperationId,
    itemId: item.itemId,
    revisionNumber: item.revisionNumber,
    schoolConfigurationReleaseId: snapshot.schoolConfigurationReleaseId,
    replayed: false,
  });
  expect(created.itemCompletionId).toBeString();
  expect(created.completedAt).toBe(now.toISOString());

  const confirmed = await readLearning(studentCookie);
  const restored = (await confirmed.json()) as StudentLearningSnapshot;
  expect(restored.completion).toEqual({
    itemCompletionId: created.itemCompletionId,
    itemId: item.itemId,
    revisionNumber: item.revisionNumber,
    schoolConfigurationReleaseId: snapshot.schoolConfigurationReleaseId,
    completedAt: now.toISOString(),
  });

  const replay = await acknowledgeItem(studentCookie, command);
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual({ ...created, replayed: true });

  const concurrent = await Promise.all([
    acknowledgeItem(studentCookie, command),
    acknowledgeItem(studentCookie, command),
  ]);
  for (const response of concurrent) {
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ...created, replayed: true });
  }

  const reused = await acknowledgeItem(studentCookie, {
    ...command,
    itemId: crypto.randomUUID(),
  });
  expect(reused.status).toBe(409);
  expect(await reused.json()).toMatchObject({ code: 'OPERATION_ID_REUSED' });

  const notDisplayed = await acknowledgeItem(studentCookie, {
    ...command,
    operationId: crypto.randomUUID(),
    itemId: crypto.randomUUID(),
  });
  expect(notDisplayed.status).toBe(409);
  expect(await notDisplayed.json()).toMatchObject({
    code: 'LEARNING_REVISION_CONFLICT',
  });

  const duplicate = await acknowledgeItem(studentCookie, {
    ...command,
    operationId: crypto.randomUUID(),
  });
  expect(duplicate.status).toBe(201);
  const existing = (await duplicate.json()) as AcknowledgeLearningItemResult;
  expect(existing.itemCompletionId).toBe(created.itemCompletionId);
  expect(existing.replayed).toBe(true);

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const completions = await inspection.query<{
      count: string;
      student_id: string;
      workspace_id: string;
      item_id: string;
      item_revision_number: number;
      school_configuration_release_id: string;
      operation_id: string;
    }>(
      `select count(*) over () as count, student_id, workspace_id, item_id,
              item_revision_number, school_configuration_release_id, operation_id
         from learning_progress.item_completions`,
    );
    expect(completions.rows).toHaveLength(1);
    expect(completions.rows[0]).toMatchObject({
      count: '1',
      workspace_id: workspaceId,
      item_id: item.itemId,
      item_revision_number: item.revisionNumber,
      school_configuration_release_id: snapshot.schoolConfigurationReleaseId,
      operation_id: acceptedOperationId,
    });
    expect(completions.rows[0]?.student_id).toBeTruthy();
    await expect(
      inspection.query(
        `update learning_progress.item_completions
            set completed_at = now() where item_completion_id = $1`,
        [created.itemCompletionId],
      ),
    ).rejects.toThrow('immutable');
    await expect(
      inspection.query('delete from learning_progress.item_completions'),
    ).rejects.toThrow('immutable');
  } finally {
    await inspection.end();
  }

  expect(telemetryLines.join('\n')).not.toContain(recipient);
});

test('fresh Student authentication in another browser restores the Item Completion', async () => {
  const independentCookie = await inviteAndRedeemStudent({
    classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6201',
    invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6202',
    recipient,
    name: 'Health Literacy 7B',
  });
  expect(independentCookie).not.toBe(studentCookie);

  const restored = await readLearning(independentCookie);
  expect(restored.status).toBe(200);
  const snapshot = (await restored.json()) as StudentLearningSnapshot;
  expect(snapshot.learningUnlocked).toBe(true);
  expect(snapshot.completion?.itemId).toBe(snapshot.item?.itemId);
  expect(snapshot.completion?.itemCompletionId).toBeString();

  const original = await readLearning(studentCookie);
  const originalSnapshot = (await original.json()) as StudentLearningSnapshot;
  expect(snapshot.completion).toEqual(originalSnapshot.completion);
});

test('staff cannot read or mutate Item Completions and no uncomplete path exists', async () => {
  const staffRead = await readLearning(administratorCookie);
  expect(staffRead.status).toBe(401);
  const clinicianRead = await readLearning(clinicianCookie);
  expect(clinicianRead.status).toBe(401);

  const staffWrite = await acknowledgeItem(administratorCookie, {
    operationId: crypto.randomUUID(),
    expectedSchoolConfigurationReleaseId: crypto.randomUUID(),
    itemId: crypto.randomUUID(),
    revisionNumber: 1,
  });
  expect(staffWrite.status).toBe(401);

  const uncomplete = await fetch(
    `${baseUrl}/api/v1/student/learning/acknowledgements`,
    {
      method: 'DELETE',
      headers: {
        origin,
        'x-prevcare-csrf': '1',
        cookie: studentCookie,
      },
    },
  );
  expect(uncomplete.status).toBe(404);

  const clinical = await createApiClient(baseUrl).GET(
    '/api/v1/clinical/review-directory',
    { headers: { cookie: clinicianCookie } },
  );
  expect(clinical.response.status).toBe(200);
  expect(JSON.stringify(clinical.data)).not.toContain('itemCompletion');
  expect(clinical.data?.students).toEqual([
    expect.objectContaining({
      studentId: expect.any(String),
    }),
  ]);
});

test('one Student cannot replay another Student acknowledgement', async () => {
  const peerCookie = await inviteAndRedeemStudent({
    classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6203',
    invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6204',
    recipient: 'student.two@example.test',
    name: 'Health Literacy 7C',
  });
  await submitIntake(peerCookie);
  const opened = await readLearning(peerCookie);
  const snapshot = (await opened.json()) as StudentLearningSnapshot;
  expect(snapshot.item).not.toBeNull();
  const replay = await acknowledgeItem(peerCookie, {
    operationId: acceptedOperationId,
    expectedSchoolConfigurationReleaseId:
      snapshot.schoolConfigurationReleaseId as string,
    itemId: snapshot.item!.itemId,
    revisionNumber: snapshot.item!.revisionNumber,
  });
  expect(replay.status).toBe(201);
  const created = (await replay.json()) as AcknowledgeLearningItemResult;
  expect(created.replayed).toBe(false);

  const firstStudent = await readLearning(studentCookie);
  const firstSnapshot = (await firstStudent.json()) as StudentLearningSnapshot;
  expect(created.itemCompletionId).not.toBe(
    firstSnapshot.completion?.itemCompletionId,
  );

  const confirmed = await readLearning(peerCookie);
  const peerSnapshot = (await confirmed.json()) as StudentLearningSnapshot;
  expect(peerSnapshot.completion?.itemCompletionId).toBe(
    created.itemCompletionId,
  );
});

test('a later School Configuration Release rejects a stale acknowledgement', async () => {
  const peerCookie = await inviteAndRedeemStudent({
    classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6205',
    invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6206',
    recipient: 'student.three@example.test',
    name: 'Health Literacy 7D',
  });
  await submitIntake(peerCookie);
  const opened = await readLearning(peerCookie);
  const snapshot = (await opened.json()) as StudentLearningSnapshot;
  expect(snapshot.item).not.toBeNull();
  const staleReleaseId = snapshot.schoolConfigurationReleaseId as string;
  const client = createApiClient(baseUrl);

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

  const stale = await acknowledgeItem(peerCookie, {
    operationId: crypto.randomUUID(),
    expectedSchoolConfigurationReleaseId: staleReleaseId,
    itemId: snapshot.item!.itemId,
    revisionNumber: snapshot.item!.revisionNumber,
  });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({
    code: 'LEARNING_REVISION_CONFLICT',
  });

  const current = await readLearning(peerCookie);
  const currentSnapshot = (await current.json()) as StudentLearningSnapshot;
  expect(currentSnapshot.completion).toBeNull();
  expect(currentSnapshot.schoolConfigurationReleaseId).toBe(
    published.data?.activeReleaseId,
  );

  const accepted = await acknowledgeItem(peerCookie, {
    operationId: crypto.randomUUID(),
    expectedSchoolConfigurationReleaseId:
      currentSnapshot.schoolConfigurationReleaseId as string,
    itemId: currentSnapshot.item!.itemId,
    revisionNumber: currentSnapshot.item!.revisionNumber,
  });
  expect(accepted.status).toBe(201);
  expect(
    ((await accepted.json()) as AcknowledgeLearningItemResult).replayed,
  ).toBe(false);
});
