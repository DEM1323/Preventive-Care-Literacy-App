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
const administratorEmail = 'administrator.reconcile@example.test';
const clinicianEmail = 'clinician.reconcile@example.test';
const password = 'correct horse battery staple';
const recipient = 'student.reconcile@example.test';
const draftRecipient = 'student.reconcile.draft@example.test';
const invitationCode = '729104';
const draftInvitationId = crypto.randomUUID();
const draftClassId = crypto.randomUUID();
const distinctiveAnswer = 'UNIQUE-RECONCILE-TOKEN-43a1';
const hiddenDetail = 'UNIQUE-HIDDEN-DETAIL-43b2';
const origin = 'http://127.0.0.1';
const intakeFormId = 'fb68c01a-7fa8-4b0c-8509-200a4f0feace';
const nameFieldId = '22f0fc76-42bb-421c-8e61-44604a8765d8';
const medConditionsFieldId = '4b47380b-9d00-4fd4-b490-30887ee70aa4';
const medConditionsDetailFieldId = '465af9e5-dcf6-4e9b-b11d-4851038879d4';
const operatorHeaders = {
  authorization: `Bearer ${'reconcile-operator-token-'.padEnd(40, 'x')}`,
  origin,
  'x-prevcare-csrf': '1',
} as const;
const mutationHeaders = {
  origin,
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;

let now = new Date('2026-08-27T18:00:00.000Z');
let postgres: EphemeralPostgres;
let runtimeDatabaseUrl: string;
let server: FastifyInstance;
let baseUrl: string;
let administratorCookie: string;
let clinicianCookie: string;
let studentCookie: string;
let draftStudentCookie: string;
let studentId = '';
let candidate: unknown;
let telemetryLines: string[] = [];
const fakeAuth = createFakeStaffAuth();
const intakeInvitationSecrets = {
  hmacKey: Buffer.alloc(32, 7),
  encryptionKeys: { test: Buffer.alloc(32, 9) },
  activeEncryptionKeyId: 'test',
  createCode: () => invitationCode,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function completeAnswers(fields: IntakeFormField[], name = distinctiveAnswer) {
  const answers: Record<string, string> = {};
  for (const field of [...fields].sort(
    (left, right) => left.order - right.order,
  )) {
    const visible =
      !field.visibility ||
      answers[field.visibility.fieldId] === field.visibility.equalsOptionCode;
    if (!visible) continue;
    if (field.id === medConditionsFieldId) {
      answers[field.id] = 'yes';
      continue;
    }
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
    if (field.id === medConditionsDetailFieldId) {
      answers[field.id] = hiddenDetail;
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

async function stepUpAdministrator() {
  const client = createApiClient(baseUrl);
  const steppedUp = await client.POST('/api/v1/auth/staff/step-up', {
    headers: { ...operatorHeaders, cookie: administratorCookie },
    body: {
      password,
      totp: totpCode(fakeAuth.totpSecretFor(administratorEmail)),
    },
  });
  expect(steppedUp.response.status).toBe(200);
}

async function readDraft() {
  const client = createApiClient(baseUrl);
  const draft = await client.GET(
    '/api/v1/administration/school-configuration',
    { headers: { cookie: administratorCookie } },
  );
  expect(draft.response.status).toBe(200);
  return draft.data;
}

async function editDraft(body: Record<string, unknown>) {
  const client = createApiClient(baseUrl);
  return client.POST(
    '/api/v1/administration/school-configuration/draft-edits',
    { headers: { ...operatorHeaders, cookie: administratorCookie }, body },
  );
}

async function publishDraft(changeDescription: string) {
  const draft = await readDraft();
  await stepUpAdministrator();
  const client = createApiClient(baseUrl);
  const published = await client.POST(
    '/api/v1/administration/school-configuration/releases',
    {
      headers: { ...operatorHeaders, cookie: administratorCookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedActiveReleaseId: draft?.activeReleaseId ?? null,
        expectedDraftVersion: draft?.draftVersion ?? 0,
        candidateFingerprint: draft?.candidateFingerprint ?? '',
        changeDescription,
      },
    },
  );
  expect(published.response.status).toBe(201);
  return published.data;
}

function intakeFormOf(draftCandidate: unknown) {
  if (!isRecord(draftCandidate) || !isRecord(draftCandidate.release)) {
    throw new Error('missing release');
  }
  const intake = draftCandidate.release.intakeForm;
  if (!isRecord(intake) || !Array.isArray(intake.fields)) {
    throw new Error('missing intake form');
  }
  return intake;
}

function fieldsOf(intake: Record<string, unknown>) {
  return Array.isArray(intake.fields) ? intake.fields.filter(isRecord) : [];
}

function localized(value: unknown, locale: string): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[locale])) {
    throw new Error(`missing ${locale}`);
  }
  return value[locale];
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
      actorId: 'reconcile-test-operator',
    },
    staffAuth: fakeAuth.provider,
    clock: { now: () => now },
    invitationSecrets: intakeInvitationSecrets,
    wrappingKeys: {
      wrappingKeys: { test: Buffer.alloc(32, 13) },
      activeWrappingKeyId: 'test',
      idempotencyKey: Buffer.alloc(32, 19),
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
          reason: 'Intake release reconciliation test',
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
  await publishDraft('Publish synthetic content for intake reconciliation.');
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
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    const students = await owner.query<{ student_id: string }>(
      'select student_id from identity_access.students where workspace_id = $1',
      [workspaceId],
    );
    studentId = students.rows[0]?.student_id ?? '';
  } finally {
    await owner.end();
  }
}, 120_000);

afterAll(async () => {
  server?.server.closeAllConnections?.();
  await server?.close();
  await postgres?.stop();
}, 30_000);

test('presentation-equivalent Intake Form releases preserve drafts and do not require an update', async () => {
  const client = createApiClient(baseUrl);
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(opened.response.status).toBe(200);
  const snapshot = opened.data as StudentIntakeSnapshot;
  expect(snapshot.intakeUpdateRequirement).toBeNull();
  const answers = completeAnswers(snapshot.form.intakeForm.fields);
  const saved = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: {
      operationId: crypto.randomUUID(),
      expectedDraftRevision: 0,
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
  const staleReleaseId = snapshot.form.schoolConfigurationReleaseId;
  const staleForm = {
    resourceId: snapshot.form.intakeForm.resourceId,
    revisionNumber: snapshot.form.intakeForm.revisionNumber,
  };

  const draft = await readDraft();
  const intake = intakeFormOf(draft?.candidate);
  const fieldIds = fieldsOf(intake).map((field) => String(field.id));
  const reordered = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: draft?.draftVersion,
    expectedResourceRevisions: [
      { resourceId: intakeFormId, revisionNumber: Number(intake.revision) },
      ...fieldsOf(intake).map((field) => ({
        resourceId: String(field.id),
        revisionNumber: Number(field.revision),
      })),
    ],
    type: 'reorder-intake-fields',
    orderedResourceIds: [fieldIds[1], fieldIds[0], ...fieldIds.slice(2)],
  });
  expect(reordered.response.status).toBe(200);
  const nameLabel = localized(
    fieldsOf(intakeFormOf(reordered.data?.candidate)).find(
      (field) => field.id === nameFieldId,
    )?.label,
    'en-US',
  );
  const spanish = localized(
    fieldsOf(intakeFormOf(reordered.data?.candidate)).find(
      (field) => field.id === nameFieldId,
    )?.label,
    'es-US',
  );
  const translated = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: reordered.data?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: String(spanish.id),
        revisionNumber: Number(spanish.revision),
      },
    ],
    type: 'save-managed-translation',
    resourceId: String(nameLabel.id),
    locale: 'es-US',
    text: 'Nombre completo revisado',
  });
  expect(translated.response.status).toBe(200);
  const pendingSpanish = localized(
    fieldsOf(intakeFormOf(translated.data?.candidate)).find(
      (field) => field.id === nameFieldId,
    )?.label,
    'es-US',
  );
  const reviewed = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: translated.data?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: String(pendingSpanish.id),
        revisionNumber: Number(pendingSpanish.revision),
      },
    ],
    type: 'review-managed-translation',
    resourceId: String(nameLabel.id),
    locale: 'es-US',
  });
  expect(reviewed.response.status).toBe(200);
  const published = await publishDraft(
    'Reorder intake fields and revise a Managed Translation.',
  );
  expect(published?.activeReleaseId).not.toBe(staleReleaseId);

  const afterPresentation = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(afterPresentation.response.status).toBe(200);
  expect(afterPresentation.data?.intakeUpdateRequirement).toBeNull();
  expect(afterPresentation.data?.draft?.answers[nameFieldId]).toBe(
    distinctiveAnswer,
  );
  expect(afterPresentation.data?.draft?.compatibility).toBe(
    'presentation-equivalent',
  );
  expect(afterPresentation.data?.learningUnlocked).toBe(false);

  const staleSave = await jsonRequest('/api/v1/student/intake/draft', {
    method: 'PUT',
    cookie: studentCookie,
    body: {
      operationId: crypto.randomUUID(),
      expectedDraftRevision: saved.data?.draftRevision ?? 1,
      expectedSchoolConfigurationReleaseId: staleReleaseId,
      expectedIntakeForm: staleForm,
      locale: 'en-US',
      answers,
    },
  });
  expect(staleSave.response.status).toBe(409);
  expect(staleSave.payload).toMatchObject({
    code: 'INTAKE_REVISION_CONFLICT',
    compatibility: 'presentation-equivalent',
    rebaseRequired: false,
    activeSchoolConfigurationReleaseId: published?.activeReleaseId,
  });
  expect(JSON.stringify(staleSave.payload)).not.toContain(distinctiveAnswer);
  expect(JSON.stringify(staleSave.payload)).not.toContain(hiddenDetail);
  expect(JSON.stringify(telemetryLines)).not.toContain(distinctiveAnswer);

  const adopted = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: {
      operationId: crypto.randomUUID(),
      expectedDraftRevision: afterPresentation.data?.draft?.draftRevision ?? 1,
      expectedSchoolConfigurationReleaseId:
        afterPresentation.data?.form.schoolConfigurationReleaseId,
      expectedIntakeForm: {
        resourceId: afterPresentation.data?.form.intakeForm.resourceId ?? '',
        revisionNumber:
          afterPresentation.data?.form.intakeForm.revisionNumber ?? 1,
      },
      locale: 'en-US',
      answers: afterPresentation.data?.draft?.answers ?? answers,
    },
  });
  expect(adopted.response.status).toBe(200);
}, 60_000);

test('canonical Intake Form changes persist an update requirement without revoking learning', async () => {
  const client = createApiClient(baseUrl);
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(opened.response.status).toBe(200);
  const snapshot = opened.data as StudentIntakeSnapshot;
  const answers =
    snapshot.draft?.answers ?? completeAnswers(snapshot.form.intakeForm.fields);
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
      answers,
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
  const acceptedVersionId = submitted.data?.intakeRecordVersionId;
  const acceptedReleaseId = snapshot.form.schoolConfigurationReleaseId;
  const acceptedForm = {
    resourceId: snapshot.form.intakeForm.resourceId,
    revisionNumber: snapshot.form.intakeForm.revisionNumber,
  };
  const learning = await client.GET('/api/v1/student/learning', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(learning.response.status).toBe(200);
  expect(learning.data?.learningUnlocked).toBe(true);

  draftStudentCookie = await inviteAndRedeemStudent({
    classId: draftClassId,
    invitationId: draftInvitationId,
    recipient: draftRecipient,
    name: 'Health Literacy 7B',
  });
  const draftOpened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: draftStudentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(draftOpened.response.status).toBe(200);
  const draftSaved = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: draftStudentCookie },
    body: {
      operationId: crypto.randomUUID(),
      expectedDraftRevision: 0,
      expectedSchoolConfigurationReleaseId:
        draftOpened.data?.form.schoolConfigurationReleaseId ?? '',
      expectedIntakeForm: {
        resourceId: draftOpened.data?.form.intakeForm.resourceId ?? '',
        revisionNumber: draftOpened.data?.form.intakeForm.revisionNumber ?? 1,
      },
      locale: 'en-US',
      answers: completeAnswers(draftOpened.data?.form.intakeForm.fields ?? []),
    },
  });
  expect(draftSaved.response.status).toBe(200);

  const draft = await readDraft();
  const intake = intakeFormOf(draft?.candidate);
  const detail = fieldsOf(intake).find(
    (field) => field.id === medConditionsDetailFieldId,
  );
  if (!isRecord(detail)) throw new Error('missing detail field');
  const changed = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: draft?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: medConditionsDetailFieldId,
        revisionNumber: Number(detail.revision),
      },
    ],
    type: 'save-intake-field',
    resourceId: medConditionsDetailFieldId,
    sectionId: String(detail.sectionId),
    fieldType: String(detail.type),
    label: String(localized(detail.label, 'en-US').value),
    required: false,
    requiredWhenVisible: true,
    visibility: {
      fieldId: medConditionsFieldId,
      equalsOptionCode: 'no',
    },
  });
  expect(changed.response.status).toBe(200);
  const published = await publishDraft(
    'Change canonical visibility for a follow-up intake field.',
  );
  expect(published?.activeReleaseId).not.toBe(acceptedReleaseId);

  const afterCanonical = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(afterCanonical.response.status).toBe(200);
  expect(afterCanonical.data?.learningUnlocked).toBe(true);
  expect(afterCanonical.data?.currentIntakeRecordVersion).toMatchObject({
    intakeRecordVersionId: acceptedVersionId,
    schoolConfigurationReleaseId: acceptedReleaseId,
    intakeForm: acceptedForm,
  });
  expect(afterCanonical.data?.intakeUpdateRequirement).toMatchObject({
    currentIntakeRecordVersionId: acceptedVersionId,
    currentSchoolConfigurationReleaseId: acceptedReleaseId,
    activeSchoolConfigurationReleaseId: published?.activeReleaseId,
    impactedFieldIds: [medConditionsDetailFieldId],
  });
  expect(
    JSON.stringify(afterCanonical.data?.intakeUpdateRequirement),
  ).not.toContain(distinctiveAnswer);
  expect(
    JSON.stringify(afterCanonical.data?.intakeUpdateRequirement),
  ).not.toContain(hiddenDetail);

  const stillLearning = await client.GET('/api/v1/student/learning', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(stillLearning.data?.learningUnlocked).toBe(true);

  const staleSubmit = await jsonRequest('/api/v1/student/intake/submissions', {
    method: 'POST',
    cookie: studentCookie,
    body: {
      operationId: crypto.randomUUID(),
      expectedSchoolConfigurationReleaseId: acceptedReleaseId,
      expectedIntakeForm: acceptedForm,
      expectedSubmissionAttestation: snapshot.form.submissionAttestation,
      locale: 'en-US',
      answers,
      attestation: {
        locale: 'en-US',
        notice: snapshot.form.submissionAttestation,
      },
    },
  });
  expect(staleSubmit.response.status).toBe(409);
  expect(staleSubmit.payload).toMatchObject({
    code: 'INTAKE_REVISION_CONFLICT',
    compatibility: 'canonical-change',
    rebaseRequired: true,
    impactedFieldIds: [medConditionsDetailFieldId],
    currentIntakeRecordVersionId: acceptedVersionId,
    activeSchoolConfigurationReleaseId: published?.activeReleaseId,
  });
  expect(JSON.stringify(staleSubmit.payload)).not.toContain(distinctiveAnswer);
  expect(JSON.stringify(staleSubmit.payload)).not.toContain(hiddenDetail);
  expect(staleSubmit.response.url).not.toContain(distinctiveAnswer);

  const reveal = await client.POST('/api/v1/clinical/intake-records/current', {
    headers: { ...mutationHeaders, cookie: clinicianCookie },
    body: { studentId },
  });
  expect(reveal.response.status).toBe(200);
  expect(reveal.data?.intakeRecordVersionId).toBe(acceptedVersionId);
  expect(reveal.data?.answers[nameFieldId]).toBe(distinctiveAnswer);
  expect(reveal.data?.answers[medConditionsDetailFieldId]).toBe(hiddenDetail);
  expect(
    reveal.data?.intakeForm.fields.find(
      (field) => field.id === medConditionsDetailFieldId,
    )?.visibility,
  ).toMatchObject({ equalsOptionCode: 'yes' });
  expect(reveal.data?.intakeUpdateRequirement).toMatchObject({
    currentIntakeRecordVersionId: acceptedVersionId,
    activeSchoolConfigurationReleaseId: published?.activeReleaseId,
    impactedFieldIds: [medConditionsDetailFieldId],
  });
  expect(JSON.stringify(reveal.data?.intakeUpdateRequirement)).not.toContain(
    distinctiveAnswer,
  );
}, 60_000);

test('rebase preserves compatible answers, flags impacted fields, and omits newly hidden answers', async () => {
  const client = createApiClient(baseUrl);
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(opened.response.status).toBe(200);
  const snapshot = opened.data as StudentIntakeSnapshot;
  expect(snapshot.intakeUpdateRequirement).not.toBeNull();
  const reopened = await jsonRequest('/api/v1/student/intake/reopen', {
    method: 'POST',
    cookie: studentCookie,
    body: {
      operationId: crypto.randomUUID(),
      expectedCurrentIntakeRecordVersionId:
        snapshot.currentIntakeRecordVersion?.intakeRecordVersionId,
      locale: 'en-US',
    },
  });
  expect(reopened.response.status).toBe(200);

  const afterReopen = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(afterReopen.data?.draft?.answers[nameFieldId]).toBe(distinctiveAnswer);
  expect(afterReopen.data?.draft?.answers[medConditionsFieldId]).toBe('yes');
  expect(
    afterReopen.data?.draft?.answers[medConditionsDetailFieldId],
  ).toBeUndefined();
  expect(afterReopen.data?.draft?.reviewFieldIds).toEqual([
    medConditionsDetailFieldId,
  ]);
  expect(afterReopen.data?.draft?.compatibility).toBe('current');
  expect(afterReopen.data?.learningUnlocked).toBe(true);

  const beforeRebase = await client.GET('/api/v1/student/intake', {
    headers: { cookie: draftStudentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(beforeRebase.data?.draft?.compatibility).toBe('canonical-change');
  expect(beforeRebase.data?.intakeUpdateRequirement).toBeNull();
  const rebased = await jsonRequest('/api/v1/student/intake/rebase', {
    method: 'POST',
    cookie: draftStudentCookie,
    body: {
      operationId: crypto.randomUUID(),
      expectedDraftRevision: beforeRebase.data?.draft?.draftRevision ?? 1,
      locale: 'en-US',
    },
  });
  expect(rebased.response.status).toBe(200);
  expect(rebased.payload).toMatchObject({
    reviewFieldIds: [medConditionsDetailFieldId],
    omittedFieldIds: [medConditionsDetailFieldId],
    replayed: false,
  });
  expect(JSON.stringify(rebased.payload)).not.toContain(distinctiveAnswer);
  expect(JSON.stringify(rebased.payload)).not.toContain(hiddenDetail);
  const replay = await jsonRequest('/api/v1/student/intake/rebase', {
    method: 'POST',
    cookie: draftStudentCookie,
    body: {
      operationId: rebased.payload.operationId,
      expectedDraftRevision: beforeRebase.data?.draft?.draftRevision ?? 1,
      locale: 'en-US',
    },
  });
  expect(replay.response.status).toBe(200);
  expect(replay.payload).toMatchObject({ ...rebased.payload, replayed: true });

  const afterRebase = await client.GET('/api/v1/student/intake', {
    headers: { cookie: draftStudentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(afterRebase.data?.draft?.answers[nameFieldId]).toBe(distinctiveAnswer);
  expect(
    afterRebase.data?.draft?.answers[medConditionsDetailFieldId],
  ).toBeUndefined();
  expect(afterRebase.data?.draft?.reviewFieldIds).toEqual([
    medConditionsDetailFieldId,
  ]);
  expect(afterRebase.data?.draft?.compatibility).toBe('current');

  const staffRebase = await jsonRequest('/api/v1/student/intake/rebase', {
    method: 'POST',
    cookie: administratorCookie,
    body: {
      operationId: crypto.randomUUID(),
      expectedDraftRevision: 1,
      locale: 'en-US',
    },
  });
  expect(staffRebase.response.status).toBe(401);
}, 60_000);
