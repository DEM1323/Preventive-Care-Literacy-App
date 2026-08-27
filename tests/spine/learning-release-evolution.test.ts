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
const administratorId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf7101';
const clinicianId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf7102';
const classId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf7103';
const invitationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf7104';
const administratorEmail = 'administrator.evolution@example.test';
const clinicianEmail = 'clinician.evolution@example.test';
const password = 'correct horse battery staple';
const recipient = 'student.evolution@example.test';
const invitationCode = '729104';
let generatedCode = invitationCode;
const origin = 'http://127.0.0.1';
const operatorHeaders = {
  authorization: `Bearer ${'evolution-operator-token-'.padEnd(40, 'x')}`,
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
const secondKnowledgeId = 'f8b680c1-7280-493a-a3e6-be65f7a42990';
const firstSkillId = 'c328aa32-a628-4de4-9200-46406e17e6c3';
const applicationId = 'f1cf82bc-5075-49d1-9846-86be6abc9b75';
const managedLocales = ['es-US', 'pt-BR', 'fr-CA', 'ht-HT'] as const;

let now = new Date('2026-08-27T16:30:00.000Z');
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
const invitationSecrets = {
  hmacKey: Buffer.alloc(32, 7),
  encryptionKeys: { test: Buffer.alloc(32, 9) },
  activeEncryptionKeyId: 'test',
  createCode: () => generatedCode,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
          ? 'Evolution Student'
          : field.type === 'tel'
            ? '5550100'
            : 'Evolution Student';
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

function projectedItem(snapshot: StudentLearningSnapshot, itemId: string) {
  for (const module of snapshot.modules) {
    for (const section of module.sections) {
      const item = section.items.find((entry) => entry.itemId === itemId);
      if (item) return item;
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

function moduleById(draftCandidate: unknown, moduleId: string) {
  if (!isRecord(draftCandidate) || !isRecord(draftCandidate.release)) {
    throw new Error('missing release');
  }
  const modules = draftCandidate.release.modules;
  if (!Array.isArray(modules)) throw new Error('missing modules');
  const found = modules.find(
    (module) => isRecord(module) && module.id === moduleId,
  );
  if (!isRecord(found)) throw new Error('missing module');
  return found;
}

function knowledgeItemsOf(module: Record<string, unknown>) {
  return Array.isArray(module.knowledgeItems)
    ? module.knowledgeItems.filter(isRecord)
    : [];
}

function localized(value: unknown, locale: string): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[locale])) {
    throw new Error(`missing ${locale}`);
  }
  return value[locale];
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

async function signInFreshBrowser(code: string) {
  generatedCode = code;
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
      body: JSON.stringify({ recipient, code }),
    },
  );
  expect(verified.status).toBe(200);
  return verified.headers.get('set-cookie')?.split(';', 1)[0] as string;
}

async function completeCurrentItem(
  cookie: string,
  itemId: string,
  revisionNumber = 1,
) {
  const opened = await readLearning(cookie);
  const snapshot = (await opened.json()) as StudentLearningSnapshot;
  const accepted = await acknowledgeItem(cookie, {
    operationId: crypto.randomUUID(),
    expectedSchoolConfigurationReleaseId:
      snapshot.schoolConfigurationReleaseId as string,
    itemId,
    revisionNumber,
  });
  expect(accepted.status).toBe(201);
  return {
    snapshot,
    created: (await accepted.json()) as AcknowledgeLearningItemResult,
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
      actorId: 'evolution-test-operator',
    },
    staffAuth: fakeAuth.provider,
    clock: { now: () => now },
    invitationSecrets,
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
          reason: 'Learning release evolution test',
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
  await publishDraft('Publish the reviewed synthetic golden-journey content.');

  studentCookie = await inviteAndRedeemStudent({
    classId,
    invitationId,
    recipient,
    name: 'Health Literacy Evolution',
  });
  await submitIntake(studentCookie);
}, 120_000);

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
}, 30_000);

test('reordering and Managed Translation-only changes preserve Item Completion and projections', async () => {
  const { created } = await completeCurrentItem(
    studentCookie,
    firstKnowledgeId,
  );
  const skill = await completeCurrentItem(studentCookie, firstSkillId);
  const application = await completeCurrentItem(studentCookie, applicationId);
  const before = await readLearning(studentCookie);
  const beforeSnapshot = (await before.json()) as StudentLearningSnapshot;
  expect(beforeSnapshot.updatedContent).toBeNull();
  expect(projectedItem(beforeSnapshot, firstKnowledgeId)?.completion).toEqual({
    itemCompletionId: created.itemCompletionId,
    itemId: firstKnowledgeId,
    revisionNumber: 1,
    schoolConfigurationReleaseId: beforeSnapshot.schoolConfigurationReleaseId,
    completedAt: now.toISOString(),
  });
  expect(
    sectionOf(beforeSnapshot, primaryCareModuleId, 'knowledge'),
  ).toMatchObject({
    completedCount: 1,
    totalCount: 3,
    percentComplete: 33,
  });
  const firstRevision = projectedItem(
    beforeSnapshot,
    firstKnowledgeId,
  )?.revisionNumber;
  const skillRevision = projectedItem(
    beforeSnapshot,
    firstSkillId,
  )?.revisionNumber;
  const applicationRevision = projectedItem(
    beforeSnapshot,
    applicationId,
  )?.revisionNumber;

  const draft = await readDraft();
  const module = moduleById(draft?.candidate, primaryCareModuleId);
  const items = knowledgeItemsOf(module);
  const reordered = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: draft?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: primaryCareModuleId,
        revisionNumber: Number(module.revision),
      },
      ...items.map((item) => ({
        resourceId: String(item.id),
        revisionNumber: Number(item.revision),
      })),
    ],
    type: 'reorder-learning-module-items',
    moduleId: primaryCareModuleId,
    collection: 'knowledgeItems',
    orderedResourceIds: [
      secondKnowledgeId,
      firstKnowledgeId,
      ...items.slice(2).map((item) => String(item.id)),
    ],
  });
  expect(reordered.response.status).toBe(200);
  const english = localized(
    knowledgeItemsOf(
      moduleById(reordered.data?.candidate, primaryCareModuleId),
    ).find((item) => item.id === firstKnowledgeId)?.text,
    'en-US',
  );
  const spanish = localized(
    knowledgeItemsOf(
      moduleById(reordered.data?.candidate, primaryCareModuleId),
    ).find((item) => item.id === firstKnowledgeId)?.text,
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
    resourceId: String(english.id),
    locale: 'es-US',
    text: 'Punto clave de chequeos de rutina revisado',
  });
  expect(translated.response.status).toBe(200);
  const pendingSpanish = localized(
    knowledgeItemsOf(
      moduleById(translated.data?.candidate, primaryCareModuleId),
    ).find((item) => item.id === firstKnowledgeId)?.text,
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
    resourceId: String(english.id),
    locale: 'es-US',
  });
  expect(reviewed.response.status).toBe(200);
  const afterItem = knowledgeItemsOf(
    moduleById(reviewed.data?.candidate, primaryCareModuleId),
  ).find((item) => item.id === firstKnowledgeId);
  expect(Number(afterItem?.revision)).toBe(firstRevision);

  const published = await publishDraft(
    'Reorder Knowledge items and revise a Managed Translation.',
  );
  expect(published?.activeReleaseId).not.toBe(
    beforeSnapshot.schoolConfigurationReleaseId,
  );

  const after = await readLearning(studentCookie);
  const afterSnapshot = (await after.json()) as StudentLearningSnapshot;
  expect(afterSnapshot.updatedContent).toBeNull();
  expect(afterSnapshot.schoolConfigurationReleaseId).toBe(
    published?.activeReleaseId,
  );
  expect(projectedItem(afterSnapshot, firstKnowledgeId)).toMatchObject({
    revisionNumber: firstRevision,
    contentChange: null,
    completion: {
      itemCompletionId: created.itemCompletionId,
      revisionNumber: firstRevision,
    },
  });
  expect(projectedItem(afterSnapshot, firstSkillId)).toMatchObject({
    revisionNumber: skillRevision,
    completion: { itemCompletionId: skill.created.itemCompletionId },
  });
  expect(projectedItem(afterSnapshot, applicationId)).toMatchObject({
    revisionNumber: applicationRevision,
    completion: { itemCompletionId: application.created.itemCompletionId },
  });
  expect(
    sectionOf(afterSnapshot, primaryCareModuleId, 'knowledge'),
  ).toMatchObject({
    completedCount: 1,
    totalCount: 3,
    percentComplete: 33,
  });
  expect(
    sectionOf(afterSnapshot, primaryCareModuleId, 'knowledge')?.items[0],
  ).toMatchObject({
    itemId: secondKnowledgeId,
    completion: null,
  });
  const spanishLearning = await readLearning(studentCookie, 'es-US');
  const localizedSnapshot =
    (await spanishLearning.json()) as StudentLearningSnapshot;
  expect(projectedItem(localizedSnapshot, firstKnowledgeId)?.text).toBe(
    'Punto clave de chequeos de rutina revisado',
  );
  expect(
    projectedItem(localizedSnapshot, firstKnowledgeId)?.completion,
  ).toEqual(projectedItem(afterSnapshot, firstKnowledgeId)?.completion);
}, 60_000);

function itemRecord(draftCandidate: unknown, itemId: string) {
  const module = moduleById(draftCandidate, primaryCareModuleId);
  const found = [
    ...knowledgeItemsOf(module),
    ...(Array.isArray(module.skillItems)
      ? module.skillItems.filter(isRecord)
      : []),
    ...(Array.isArray(module.applicationItems)
      ? module.applicationItems.filter(isRecord)
      : []),
  ].find((item) => item.id === itemId);
  if (!isRecord(found)) throw new Error(`missing item ${itemId}`);
  return found;
}

async function reviewItemTranslations(itemId: string, text: string) {
  for (const locale of managedLocales) {
    const draft = await readDraft();
    const item = itemRecord(draft?.candidate, itemId);
    const english = localized(item.text, 'en-US');
    const existing = isRecord(item.text) ? item.text[locale] : undefined;
    const saved = await editDraft({
      operationId: crypto.randomUUID(),
      expectedDraftVersion: draft?.draftVersion,
      expectedResourceRevisions: isRecord(existing)
        ? [
            {
              resourceId: String(existing.id),
              revisionNumber: Number(existing.revision),
            },
          ]
        : [],
      type: 'save-managed-translation',
      resourceId: String(english.id),
      locale,
      text,
    });
    expect(saved.response.status).toBe(200);
    const pending = localized(
      itemRecord(saved.data?.candidate, itemId).text,
      locale,
    );
    const reviewed = await editDraft({
      operationId: crypto.randomUUID(),
      expectedDraftVersion: saved.data?.draftVersion,
      expectedResourceRevisions: [
        {
          resourceId: String(pending.id),
          revisionNumber: Number(pending.revision),
        },
      ],
      type: 'review-managed-translation',
      resourceId: String(english.id),
      locale,
    });
    expect(reviewed.response.status).toBe(200);
  }
}

async function listReleases() {
  const response = await fetch(
    `${baseUrl}/api/v1/administration/school-configuration/releases`,
    { headers: { ...operatorHeaders, cookie: administratorCookie } },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    releases: Array<{
      releaseId: string;
      releaseNumber: number;
      active: boolean;
    }>;
  };
}

test('canonical edits require acknowledgement of the new revision and restoring the prior revision counts again', async () => {
  const before = await readLearning(studentCookie);
  const beforeSnapshot = (await before.json()) as StudentLearningSnapshot;
  const priorCompletion = projectedItem(
    beforeSnapshot,
    firstKnowledgeId,
  )?.completion;
  expect(priorCompletion).not.toBeNull();
  const priorRevision = projectedItem(
    beforeSnapshot,
    firstKnowledgeId,
  )?.revisionNumber;
  const priorReleaseId = beforeSnapshot.schoolConfigurationReleaseId as string;
  const historyBefore = await listReleases();
  const restoreReleaseId = historyBefore.releases.find(
    (release) => release.active,
  )?.releaseId;
  expect(restoreReleaseId).toBe(priorReleaseId);

  const draft = await readDraft();
  const item = itemRecord(draft?.candidate, firstKnowledgeId);
  const edited = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: draft?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: firstKnowledgeId,
        revisionNumber: Number(item.revision),
      },
    ],
    type: 'save-learning-module-item',
    resourceId: firstKnowledgeId,
    text: 'Revised routine check-up key point for students.',
  });
  expect(edited.response.status).toBe(200);
  const editedItem = itemRecord(edited.data?.candidate, firstKnowledgeId);
  expect(Number(editedItem.revision)).toBeGreaterThan(Number(priorRevision));
  await reviewItemTranslations(
    firstKnowledgeId,
    'Punto clave revisado de chequeos de rutina',
  );
  const published = await publishDraft(
    'Revise the canonical Knowledge key point.',
  );
  expect(published?.activeReleaseId).not.toBe(priorReleaseId);

  const after = await readLearning(studentCookie);
  const afterSnapshot = (await after.json()) as StudentLearningSnapshot;
  expect(projectedItem(afterSnapshot, firstKnowledgeId)).toMatchObject({
    revisionNumber: Number(editedItem.revision),
    contentChange: 'revised',
    completion: null,
    text: 'Revised routine check-up key point for students.',
  });
  expect(afterSnapshot.updatedContent).toMatchObject({
    schoolConfigurationReleaseId: published?.activeReleaseId,
    items: [
      expect.objectContaining({
        itemId: firstKnowledgeId,
        revisionNumber: Number(editedItem.revision),
        kind: 'knowledge',
        moduleId: primaryCareModuleId,
        change: 'revised',
      }),
    ],
  });
  expect(
    sectionOf(afterSnapshot, primaryCareModuleId, 'knowledge'),
  ).toMatchObject({
    completedCount: 0,
    totalCount: 3,
    percentComplete: 0,
  });
  expect(projectedItem(afterSnapshot, firstSkillId)?.completion).not.toBeNull();
  expect(
    projectedItem(afterSnapshot, applicationId)?.completion,
  ).not.toBeNull();

  const stale = await acknowledgeItem(studentCookie, {
    operationId: crypto.randomUUID(),
    expectedSchoolConfigurationReleaseId:
      afterSnapshot.schoolConfigurationReleaseId as string,
    itemId: firstKnowledgeId,
    revisionNumber: priorRevision ?? 1,
  });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({
    code: 'LEARNING_REVISION_CONFLICT',
  });

  const accepted = await acknowledgeItem(studentCookie, {
    operationId: crypto.randomUUID(),
    expectedSchoolConfigurationReleaseId:
      afterSnapshot.schoolConfigurationReleaseId as string,
    itemId: firstKnowledgeId,
    revisionNumber: Number(editedItem.revision),
  });
  expect(accepted.status).toBe(201);
  const current = await readLearning(studentCookie);
  const currentSnapshot = (await current.json()) as StudentLearningSnapshot;
  expect(projectedItem(currentSnapshot, firstKnowledgeId)).toMatchObject({
    contentChange: null,
    completion: { revisionNumber: Number(editedItem.revision) },
  });
  expect(currentSnapshot.updatedContent).toBeNull();

  const restored = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: (await readDraft())?.draftVersion,
    expectedResourceRevisions: [],
    type: 'restore-release-assembly',
    releaseId: restoreReleaseId,
  });
  expect(restored.response.status).toBe(200);
  const rolledBack = await publishDraft(
    'Restore the exact prior Learning Module item revisions.',
  );
  expect(rolledBack?.activeReleaseId).not.toBe(published?.activeReleaseId);

  const counted = await readLearning(studentCookie);
  const countedSnapshot = (await counted.json()) as StudentLearningSnapshot;
  expect(countedSnapshot.updatedContent).toBeNull();
  expect(projectedItem(countedSnapshot, firstKnowledgeId)).toMatchObject({
    revisionNumber: priorRevision,
    contentChange: null,
    completion: {
      itemCompletionId: priorCompletion?.itemCompletionId,
      revisionNumber: priorRevision,
    },
  });
  expect(
    sectionOf(countedSnapshot, primaryCareModuleId, 'knowledge'),
  ).toMatchObject({
    completedCount: 1,
    totalCount: 3,
    percentComplete: 33,
  });

  const freshCookie = await signInFreshBrowser('828282');
  expect(freshCookie).not.toBe(studentCookie);
  const restoredBrowser = await readLearning(freshCookie);
  const restoredSnapshot =
    (await restoredBrowser.json()) as StudentLearningSnapshot;
  expect(projectedItem(restoredSnapshot, firstKnowledgeId)?.completion).toEqual(
    projectedItem(countedSnapshot, firstKnowledgeId)?.completion,
  );
  expect(JSON.stringify(restoredSnapshot)).not.toContain(recipient);
}, 60_000);

test('added items become incomplete requirements and archived items leave history intact', async () => {
  const before = await readLearning(studentCookie);
  const beforeSnapshot = (await before.json()) as StudentLearningSnapshot;
  expect(
    sectionOf(beforeSnapshot, primaryCareModuleId, 'knowledge')?.totalCount,
  ).toBe(3);
  const skillCompletion = projectedItem(
    beforeSnapshot,
    firstSkillId,
  )?.completion;
  expect(skillCompletion).not.toBeNull();

  const draft = await readDraft();
  const module = moduleById(draft?.candidate, primaryCareModuleId);
  const created = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: draft?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: primaryCareModuleId,
        revisionNumber: Number(module.revision),
      },
    ],
    type: 'create-learning-module-item',
    moduleId: primaryCareModuleId,
    collection: 'knowledgeItems',
    text: 'Ask the School Nurse before a new sport starts.',
  });
  expect(created.response.status).toBe(200);
  const addedItem = knowledgeItemsOf(
    moduleById(created.data?.candidate, primaryCareModuleId),
  ).at(-1);
  expect(typeof addedItem?.id).toBe('string');
  const addedItemId = String(addedItem?.id);
  await reviewItemTranslations(
    addedItemId,
    'Pregunte a la enfermera escolar antes de un nuevo deporte.',
  );
  const published = await publishDraft(
    'Add a Knowledge item to the current Learning Module.',
  );

  const afterAdd = await readLearning(studentCookie);
  const addedSnapshot = (await afterAdd.json()) as StudentLearningSnapshot;
  expect(projectedItem(addedSnapshot, addedItemId)).toMatchObject({
    contentChange: 'added',
    completion: null,
    revisionNumber: 1,
    text: 'Ask the School Nurse before a new sport starts.',
  });
  expect(addedSnapshot.updatedContent?.items).toEqual([
    expect.objectContaining({
      itemId: addedItemId,
      change: 'added',
      kind: 'knowledge',
    }),
  ]);
  expect(
    sectionOf(addedSnapshot, primaryCareModuleId, 'knowledge'),
  ).toMatchObject({
    completedCount: 1,
    totalCount: 4,
    percentComplete: 25,
  });
  expect(addedSnapshot.item?.itemId).toBe(secondKnowledgeId);
  expect(
    addedSnapshot.modules.find(
      (module) => module.moduleId === primaryCareModuleId,
    ),
  ).toMatchObject({
    completed: false,
    badge: { earned: false },
  });

  const acknowledged = await acknowledgeItem(studentCookie, {
    operationId: crypto.randomUUID(),
    expectedSchoolConfigurationReleaseId:
      addedSnapshot.schoolConfigurationReleaseId as string,
    itemId: addedItemId,
    revisionNumber: 1,
  });
  expect(acknowledged.status).toBe(201);

  const afterAck = await readLearning(studentCookie);
  const ackedSnapshot = (await afterAck.json()) as StudentLearningSnapshot;
  expect(projectedItem(ackedSnapshot, addedItemId)?.completion).not.toBeNull();
  expect(ackedSnapshot.updatedContent).toBeNull();
  expect(
    sectionOf(ackedSnapshot, primaryCareModuleId, 'knowledge'),
  ).toMatchObject({
    completedCount: 2,
    totalCount: 4,
    percentComplete: 50,
  });

  const current = await readDraft();
  const archived = await editDraft({
    operationId: crypto.randomUUID(),
    expectedDraftVersion: current?.draftVersion,
    expectedResourceRevisions: [
      {
        resourceId: firstSkillId,
        revisionNumber: Number(
          itemRecord(current?.candidate, firstSkillId).revision,
        ),
      },
    ],
    type: 'archive-authored-resource',
    resourceId: firstSkillId,
  });
  expect(archived.response.status).toBe(200);
  await publishDraft('Archive a completed Skill from current requirements.');

  const afterArchive = await readLearning(studentCookie);
  const archivedSnapshot =
    (await afterArchive.json()) as StudentLearningSnapshot;
  expect(projectedItem(archivedSnapshot, firstSkillId)).toBeUndefined();
  expect(
    sectionOf(archivedSnapshot, primaryCareModuleId, 'skill'),
  ).toMatchObject({
    completedCount: 0,
    totalCount: 4,
    percentComplete: 0,
  });
  expect(archivedSnapshot.updatedContent).toBeNull();

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const retained = await inspection.query<{
      item_id: string;
      item_revision_number: number;
      item_completion_id: string;
    }>(
      `select item_id, item_revision_number, item_completion_id
         from learning_progress.item_completions
        where item_id = $1`,
      [firstSkillId],
    );
    expect(retained.rows).toHaveLength(1);
    expect(retained.rows[0]).toMatchObject({
      item_id: firstSkillId,
      item_revision_number: 1,
      item_completion_id: skillCompletion?.itemCompletionId,
    });
  } finally {
    await inspection.end();
  }

  const staffRead = await readLearning(administratorCookie);
  expect(staffRead.status).toBe(401);
  const clinicianRead = await readLearning(clinicianCookie);
  expect(clinicianRead.status).toBe(401);
  const clinical = await createApiClient(baseUrl).GET(
    '/api/v1/clinical/review-directory',
    { headers: { cookie: clinicianCookie } },
  );
  expect(clinical.response.status).toBe(200);
  expect(JSON.stringify(clinical.data)).not.toContain('itemCompletion');
  expect(JSON.stringify(clinical.data)).not.toContain('updatedContent');
  expect(JSON.stringify(clinical.data)).not.toMatch(
    /percentComplete|contentChange/,
  );
  const configuration = await createApiClient(baseUrl).GET(
    '/api/v1/administration/school-configuration',
    { headers: { cookie: administratorCookie } },
  );
  expect(configuration.response.status).toBe(200);
  expect(JSON.stringify(configuration.data)).not.toContain('itemCompletion');
  expect(JSON.stringify(configuration.data)).not.toContain('updatedContent');
  expect(published?.activeReleaseId).toBeString();
}, 60_000);
