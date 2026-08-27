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
let generatedCode = invitationCode;
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
const primaryCareModuleId = '16481542-3831-4d18-aa0c-f138fbc7a970';
const primaryCareKnowledgeIds = [
  '1fa49d99-82a5-4614-a11c-c5142b367632',
  'f8b680c1-7280-493a-a3e6-be65f7a42990',
  '3ad6aae0-9062-491d-a1cf-f531bba2f45b',
] as const;
const primaryCareSkillIds = [
  'c328aa32-a628-4de4-9200-46406e17e6c3',
  '1989eaa3-0d7f-4dd2-9ba4-61b839d5e83a',
  'bdbe0506-49c8-423e-8a03-8915d29a004b',
  'db0ba20b-df51-4f9b-9c60-7b5720e07467',
  '4e0137e4-f20f-4b1f-8318-1e9b9b0cb78f',
] as const;
const primaryCareApplicationId = 'f1cf82bc-5075-49d1-9846-86be6abc9b75';
const primaryCareItemIds = [
  ...primaryCareKnowledgeIds,
  ...primaryCareSkillIds,
  primaryCareApplicationId,
] as const;

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
  createCode: () => generatedCode,
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

async function unpublishedSuccessorDraft() {
  const client = createApiClient(baseUrl);
  const current = await client.GET(
    '/api/v1/administration/school-configuration',
    { headers: { cookie: administratorCookie } },
  );
  expect(current.response.status).toBe(200);
  const draftCandidate = current.data?.candidate as {
    release: { modules: { id: string; revision: number }[] };
  };
  const modules = draftCandidate.release.modules;
  const edited = await client.POST(
    '/api/v1/administration/school-configuration/draft-edits',
    {
      headers: { ...operatorHeaders, cookie: administratorCookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedDraftVersion: current.data?.draftVersion ?? 0,
        expectedResourceRevisions: modules.map((module) => ({
          resourceId: module.id,
          revisionNumber: module.revision,
        })),
        type: 'reorder-learning-modules',
        orderedResourceIds: [...modules.map((module) => module.id)].reverse(),
      },
    },
  );
  expect(edited.response.status).toBe(200);
  return edited.data;
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

function completionOf(snapshot: StudentLearningSnapshot, itemId: string) {
  for (const module of snapshot.modules) {
    for (const section of module.sections) {
      const item = section.items.find((entry) => entry.itemId === itemId);
      if (item) return item.completion;
    }
  }
  return undefined;
}

function sectionOf(
  snapshot: StudentLearningSnapshot,
  moduleId: string,
  kind: 'knowledge' | 'skill' | 'application',
) {
  return snapshot.modules
    .find((module) => module.moduleId === moduleId)
    ?.sections.find((section) => section.kind === kind);
}

function moduleOf(snapshot: StudentLearningSnapshot, moduleId: string) {
  return snapshot.modules.find((module) => module.moduleId === moduleId);
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

test('learning stays locked until intake is accepted and then projects current-release progress', async () => {
  const locked = await readLearning(studentCookie);
  expect(locked.status).toBe(200);
  const lockedSnapshot = (await locked.json()) as StudentLearningSnapshot;
  expect(lockedSnapshot).toMatchObject({
    learningUnlocked: false,
    modules: [],
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
  expect(snapshot.modules).toHaveLength(6);
  expect(moduleOf(snapshot, primaryCareModuleId)).toMatchObject({
    title: 'Primary & Preventive Care',
    completed: false,
    badge: {
      key: 'primary-care',
      name: 'Primary Care Champion',
      earned: false,
    },
  });
  expect(sectionOf(snapshot, primaryCareModuleId, 'knowledge')).toMatchObject({
    completedCount: 0,
    totalCount: 3,
    percentComplete: 0,
  });
  expect(sectionOf(snapshot, primaryCareModuleId, 'skill')).toMatchObject({
    completedCount: 0,
    totalCount: 5,
    percentComplete: 0,
  });
  expect(sectionOf(snapshot, primaryCareModuleId, 'application')).toMatchObject(
    {
      completedCount: 0,
      totalCount: 1,
      percentComplete: 0,
    },
  );
  expect(snapshot.item).toMatchObject({
    itemId: primaryCareKnowledgeIds[0],
    kind: 'knowledge',
    revisionNumber: 1,
    moduleId: primaryCareModuleId,
    moduleTitle: 'Primary & Preventive Care',
    href: null,
  });
  expect(snapshot.item?.text).toContain('Routine Check-ups');
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
  expect(completionOf(restored, item.itemId)).toEqual({
    itemCompletionId: created.itemCompletionId,
    itemId: item.itemId,
    revisionNumber: item.revisionNumber,
    schoolConfigurationReleaseId: snapshot.schoolConfigurationReleaseId,
    completedAt: now.toISOString(),
  });
  expect(sectionOf(restored, primaryCareModuleId, 'knowledge')).toMatchObject({
    completedCount: 1,
    totalCount: 3,
    percentComplete: 33,
  });
  expect(restored.item).toMatchObject({
    itemId: primaryCareKnowledgeIds[1],
    kind: 'knowledge',
  });
  expect(restored.completion).toBeNull();

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

test('fresh-browser Sign-In restores Memberships, Intake Record status, and Learning Progress', async () => {
  generatedCode = '818181';
  const requested = await fetch(`${baseUrl}/api/v1/auth/student/sign-in`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ recipient }),
  });
  expect(requested.status).toBe(200);
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
  generatedCode = invitationCode;
  const verified = await fetch(
    `${baseUrl}/api/v1/auth/student/sign-in/verify`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ recipient, code: '818181' }),
    },
  );
  expect(verified.status).toBe(200);
  const cookie = verified.headers.get('set-cookie')?.split(';', 1)[0] as string;
  expect(cookie).toStartWith('__Host-prevcare-student-session=');
  expect(cookie).not.toBe(studentCookie);

  const session = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie },
  });
  expect(session.status).toBe(200);
  const access = (await session.json()) as {
    languageChoice: string;
    activeClassMemberships: { classId: string }[];
  };
  expect(access.activeClassMemberships.map((item) => item.classId)).toEqual([
    classId,
  ]);
  expect(access.languageChoice).toBe('en-US');

  const client = createApiClient(baseUrl);
  const intake = await client.GET('/api/v1/student/intake', {
    headers: { cookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(intake.response.status).toBe(200);
  expect(intake.data?.learningUnlocked).toBe(true);

  const learning = await readLearning(cookie);
  expect(learning.status).toBe(200);
  const snapshot = (await learning.json()) as StudentLearningSnapshot;
  expect(snapshot.learningUnlocked).toBe(true);
  expect(completionOf(snapshot, primaryCareKnowledgeIds[0])).not.toBeNull();
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
  expect(
    completionOf(snapshot, primaryCareKnowledgeIds[0])?.itemCompletionId,
  ).toBeString();

  const original = await readLearning(studentCookie);
  const originalSnapshot = (await original.json()) as StudentLearningSnapshot;
  expect(completionOf(snapshot, primaryCareKnowledgeIds[0])).toEqual(
    completionOf(originalSnapshot, primaryCareKnowledgeIds[0]),
  );
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
  expect(JSON.stringify(clinical.data)).not.toMatch(
    /percentComplete|Primary Care Champion/,
  );
  expect(clinical.data?.students).toEqual([
    expect.objectContaining({
      studentId: expect.any(String),
    }),
  ]);

  const configuration = await createApiClient(baseUrl).GET(
    '/api/v1/administration/school-configuration',
    { headers: { cookie: administratorCookie } },
  );
  expect(configuration.response.status).toBe(200);
  expect(JSON.stringify(configuration.data)).not.toContain('itemCompletion');
  expect(JSON.stringify(configuration.data)).not.toContain('percentComplete');
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
    completionOf(firstSnapshot, primaryCareKnowledgeIds[0])?.itemCompletionId,
  );

  const confirmed = await readLearning(peerCookie);
  const peerSnapshot = (await confirmed.json()) as StudentLearningSnapshot;
  expect(
    completionOf(peerSnapshot, snapshot.item!.itemId)?.itemCompletionId,
  ).toBe(created.itemCompletionId);
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

  const successor = await unpublishedSuccessorDraft();
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
        expectedDraftVersion: successor?.draftVersion ?? 0,
        candidateFingerprint: successor?.candidateFingerprint ?? '',
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

test('Knowledge, Skill, and Application actions complete distinct current-release items', async () => {
  const cookie = await inviteAndRedeemStudent({
    classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6301',
    invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6302',
    recipient: 'student.progress@example.test',
    name: 'Health Literacy Progress',
  });
  await submitIntake(cookie);
  const opened = await readLearning(cookie);
  const snapshot = (await opened.json()) as StudentLearningSnapshot;
  const releaseId = snapshot.schoolConfigurationReleaseId as string;

  const knowledge = await acknowledgeItem(cookie, {
    operationId: crypto.randomUUID(),
    expectedSchoolConfigurationReleaseId: releaseId,
    itemId: primaryCareKnowledgeIds[0],
    revisionNumber: 1,
  });
  const skill = await acknowledgeItem(cookie, {
    operationId: crypto.randomUUID(),
    expectedSchoolConfigurationReleaseId: releaseId,
    itemId: primaryCareSkillIds[0],
    revisionNumber: 1,
  });
  const application = await acknowledgeItem(cookie, {
    operationId: crypto.randomUUID(),
    expectedSchoolConfigurationReleaseId: releaseId,
    itemId: primaryCareApplicationId,
    revisionNumber: 1,
  });
  expect(knowledge.status).toBe(201);
  expect(skill.status).toBe(201);
  expect(application.status).toBe(201);
  const created = {
    knowledge: (await knowledge.json()) as AcknowledgeLearningItemResult,
    skill: (await skill.json()) as AcknowledgeLearningItemResult,
    application: (await application.json()) as AcknowledgeLearningItemResult,
  };
  expect(created.knowledge.itemId).toBe(primaryCareKnowledgeIds[0]);
  expect(created.skill.itemId).toBe(primaryCareSkillIds[0]);
  expect(created.application.itemId).toBe(primaryCareApplicationId);
  expect(
    new Set(Object.values(created).map((item) => item.itemCompletionId)).size,
  ).toBe(3);

  const spanish = await readLearning(cookie, 'es-US');
  const localized = (await spanish.json()) as StudentLearningSnapshot;
  expect(localized.locale).toBe('es-US');
  expect(moduleOf(localized, primaryCareModuleId)?.title).toBe(
    'Atención Primaria y Preventiva',
  );
  expect(
    sectionOf(localized, primaryCareModuleId, 'knowledge')?.items[0]?.text,
  ).toContain('Chequeos de rutina');
  expect(localized.item?.itemId).not.toBe(primaryCareKnowledgeIds[0]);
  expect(localized.item?.itemId).not.toBe(primaryCareSkillIds[0]);
  expect(localized.item?.itemId).not.toBe(primaryCareApplicationId);
  expect(completionOf(localized, localized.item!.itemId)).toBeNull();
  expect(sectionOf(localized, primaryCareModuleId, 'knowledge')).toMatchObject({
    completedCount: 1,
    totalCount: 3,
    percentComplete: 33,
  });
  expect(sectionOf(localized, primaryCareModuleId, 'skill')).toMatchObject({
    completedCount: 1,
    totalCount: 5,
    percentComplete: 20,
  });
  expect(
    sectionOf(localized, primaryCareModuleId, 'application'),
  ).toMatchObject({
    completedCount: 1,
    totalCount: 1,
    percentComplete: 100,
  });
  expect(completionOf(localized, primaryCareKnowledgeIds[0])).toEqual({
    itemCompletionId: created.knowledge.itemCompletionId,
    itemId: primaryCareKnowledgeIds[0],
    revisionNumber: 1,
    schoolConfigurationReleaseId: releaseId,
    completedAt: now.toISOString(),
  });
  expect(
    completionOf(localized, primaryCareSkillIds[0])?.itemCompletionId,
  ).toBe(created.skill.itemCompletionId);
  expect(
    completionOf(localized, primaryCareApplicationId)?.itemCompletionId,
  ).toBe(created.application.itemCompletionId);
  expect(moduleOf(localized, primaryCareModuleId)?.completed).toBe(false);
  expect(moduleOf(localized, primaryCareModuleId)?.badge?.earned).toBe(false);
});

test('retry and concurrent clients union Item Completions without duplication', async () => {
  const cookie = await inviteAndRedeemStudent({
    classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6303',
    invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6304',
    recipient: 'student.union@example.test',
    name: 'Health Literacy Union',
  });
  await submitIntake(cookie);
  const opened = await readLearning(cookie);
  const snapshot = (await opened.json()) as StudentLearningSnapshot;
  const releaseId = snapshot.schoolConfigurationReleaseId as string;
  const knowledgeCommand = {
    operationId: crypto.randomUUID(),
    expectedSchoolConfigurationReleaseId: releaseId,
    itemId: primaryCareKnowledgeIds[0],
    revisionNumber: 1,
  };
  const skillCommand = {
    operationId: crypto.randomUUID(),
    expectedSchoolConfigurationReleaseId: releaseId,
    itemId: primaryCareSkillIds[0],
    revisionNumber: 1,
  };

  const concurrent = await Promise.all([
    acknowledgeItem(cookie, knowledgeCommand),
    acknowledgeItem(cookie, skillCommand),
    acknowledgeItem(cookie, knowledgeCommand),
  ]);
  for (const response of concurrent) {
    expect(response.status).toBe(201);
  }
  const bodies = (await Promise.all(
    concurrent.map((response) => response.json()),
  )) as AcknowledgeLearningItemResult[];
  const knowledgeIds = new Set(
    bodies
      .filter((body) => body.itemId === primaryCareKnowledgeIds[0])
      .map((body) => body.itemCompletionId),
  );
  const skillIds = new Set(
    bodies
      .filter((body) => body.itemId === primaryCareSkillIds[0])
      .map((body) => body.itemCompletionId),
  );
  expect(knowledgeIds.size).toBe(1);
  expect(skillIds.size).toBe(1);

  const confirmed = await readLearning(cookie);
  const restored = (await confirmed.json()) as StudentLearningSnapshot;
  expect(
    completionOf(restored, primaryCareKnowledgeIds[0])?.itemCompletionId,
  ).toBe([...knowledgeIds][0]);
  expect(completionOf(restored, primaryCareSkillIds[0])?.itemCompletionId).toBe(
    [...skillIds][0],
  );
});

test('completing every current item in a module earns its badge and clears resume', async () => {
  const cookie = await inviteAndRedeemStudent({
    classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6305',
    invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf6306',
    recipient: 'student.badge@example.test',
    name: 'Health Literacy Badge',
  });
  await submitIntake(cookie);
  const opened = await readLearning(cookie);
  const snapshot = (await opened.json()) as StudentLearningSnapshot;
  const releaseId = snapshot.schoolConfigurationReleaseId as string;
  for (const itemId of primaryCareItemIds) {
    const accepted = await acknowledgeItem(cookie, {
      operationId: crypto.randomUUID(),
      expectedSchoolConfigurationReleaseId: releaseId,
      itemId,
      revisionNumber: 1,
    });
    expect(accepted.status).toBe(201);
  }

  const completed = await readLearning(cookie);
  const projection = (await completed.json()) as StudentLearningSnapshot;
  expect(moduleOf(projection, primaryCareModuleId)).toMatchObject({
    completed: true,
    badge: {
      key: 'primary-care',
      name: 'Primary Care Champion',
      earned: true,
    },
  });
  expect(sectionOf(projection, primaryCareModuleId, 'knowledge')).toMatchObject(
    {
      completedCount: 3,
      totalCount: 3,
      percentComplete: 100,
    },
  );
  expect(sectionOf(projection, primaryCareModuleId, 'skill')).toMatchObject({
    completedCount: 5,
    totalCount: 5,
    percentComplete: 100,
  });
  expect(
    sectionOf(projection, primaryCareModuleId, 'application'),
  ).toMatchObject({
    completedCount: 1,
    totalCount: 1,
    percentComplete: 100,
  });
  expect(projection.item?.moduleId).not.toBe(primaryCareModuleId);
  expect(projection.item?.kind).toBe('knowledge');
  expect(projection.completion).toBeNull();
});
