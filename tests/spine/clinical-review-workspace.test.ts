import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { createServer } from '../../apps/server/src/app.ts';
import type {
  IntakeFormField,
  StudentIntakeSnapshot,
} from '../../modules/intake/index.ts';
import { createEnvelopeKeyManagement } from '../../packages/application-keys/src/index.ts';
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
const administratorId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8046';
const clinicianId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8047';
const classAId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8048';
const classBId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8049';
const invitationAId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8050';
const invitationBId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8051';
const invitationCId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8052';
const administratorEmail = 'administrator.workspace46@example.test';
const clinicianEmail = 'clinician.workspace46@example.test';
const password = 'correct horse battery staple';
const recipientA = 'student.workspace46.a@example.test';
const recipientB = 'student.workspace46.b@example.test';
const recipientC = 'student.workspace46.c@example.test';
const originalAnswer = 'UNIQUE-WORKSPACE-ORIGINAL-46a1';
const amendedAnswer = 'UNIQUE-WORKSPACE-AMENDED-46a2';
const origin = 'http://127.0.0.1';
const nameFieldId = '22f0fc76-42bb-421c-8e61-44604a8765d8';
const operatorHeaders = {
  authorization: `Bearer ${'workspace46-operator-token-'.padEnd(40, 'x')}`,
  origin,
  'x-prevcare-csrf': '1',
} as const;
const mutationHeaders = {
  origin,
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;

let now = new Date('2026-08-27T19:00:00.000Z');
let postgres: EphemeralPostgres;
let runtimeDatabaseUrl: string;
let server: FastifyInstance;
let baseUrl: string;
let administratorCookie: string;
let clinicianCookie: string;
let studentACookie: string;
let studentAId = '';
let studentBId = '';
let studentCId = '';
let candidate: unknown;
let nextInvitationCode = '729104';
const fakeAuth = createFakeStaffAuth();
const invitationSecrets = {
  hmacKey: Buffer.alloc(32, 7),
  encryptionKeys: { test: Buffer.alloc(32, 9) },
  activeEncryptionKeyId: 'test',
  createCode: () => nextInvitationCode,
};
const wrappingKeys = {
  wrappingKeys: { test: Buffer.alloc(32, 13) },
  activeWrappingKeyId: 'test',
  idempotencyKey: Buffer.alloc(32, 17),
};

function completeAnswers(fields: IntakeFormField[], name: string) {
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
        field.id === nameFieldId
          ? name
          : field.type === 'tel'
            ? '5550100'
            : 'Synthetic Student';
    }
  }
  return answers;
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

async function redeemStudent(input: {
  recipient: string;
  code: string;
  invitationId: string;
}) {
  await markInvitationDelivered(input.invitationId);
  const redeemed = await fetch(
    `${baseUrl}/api/v1/auth/student/invitations/redeem`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ recipient: input.recipient, code: input.code }),
    },
  );
  expect(redeemed.status).toBe(200);
  const cookie = redeemed.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  const session = await fetch(`${baseUrl}/api/v1/student/session`, {
    headers: { cookie },
  });
  const access = (await session.json()) as { studentId: string };
  return { cookie, studentId: access.studentId };
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
  const envelopeKeys = createEnvelopeKeyManagement(wrappingKeys);
  server = await createServer({
    databaseUrl: runtimeDatabaseUrl,
    publicOrigin: origin,
    operatorCredentials: {
      token: operatorHeaders.authorization.slice('Bearer '.length),
      actorId: 'clinical-workspace-operator',
    },
    staffAuth: fakeAuth.provider,
    clock: { now: () => now },
    invitationSecrets,
    wrappingKeys,
    applicationKeys: {
      name: envelopeKeys.name,
      seal: (plaintext, context) => envelopeKeys.seal(plaintext, context),
      bind: (plaintext, context) => envelopeKeys.bind(plaintext, context),
      open: (sealed, context) => envelopeKeys.open(sealed, context),
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
        displayName: 'Clinical Review Workspace',
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
          reason: 'Clinical review workspace test',
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
        changeDescription: 'Publish synthetic content for clinical workspace.',
      },
    },
  );
  expect(published.response.status).toBe(201);

  nextInvitationCode = '111111';
  const classA = await client.POST('/api/v1/administration/classes', {
    headers: { ...operatorHeaders, cookie: administratorCookie },
    body: {
      operationId: crypto.randomUUID(),
      classId: classAId,
      invitationId: invitationAId,
      name: 'Health Literacy 7A',
      recipient: recipientA,
    },
  });
  expect(classA.response.status).toBe(201);
  const redeemedA = await redeemStudent({
    recipient: recipientA,
    code: '111111',
    invitationId: invitationAId,
  });
  studentACookie = redeemedA.cookie;
  studentAId = redeemedA.studentId;

  nextInvitationCode = '222222';
  const classB = await client.POST('/api/v1/administration/classes', {
    headers: { ...operatorHeaders, cookie: administratorCookie },
    body: {
      operationId: crypto.randomUUID(),
      classId: classBId,
      invitationId: invitationBId,
      name: 'Health Literacy 7B',
      recipient: recipientB,
    },
  });
  expect(classB.response.status).toBe(201);
  const redeemedB = await redeemStudent({
    recipient: recipientB,
    code: '222222',
    invitationId: invitationBId,
  });
  studentBId = redeemedB.studentId;

  nextInvitationCode = '333333';
  const invitedC = await client.POST(
    '/api/v1/administration/classes/invitations',
    {
      headers: { ...operatorHeaders, cookie: administratorCookie },
      body: {
        operationId: crypto.randomUUID(),
        classId: classAId,
        invitationId: invitationCId,
        recipient: recipientC,
      },
    },
  );
  expect(invitedC.response.status).toBe(201);
  const redeemedC = await redeemStudent({
    recipient: recipientC,
    code: '333333',
    invitationId: invitationCId,
  });
  studentCId = redeemedC.studentId;

  const directory = await client.GET('/api/v1/administration/classes', {
    headers: { cookie: administratorCookie },
  });
  const membershipC = directory.data?.classes
    .find((entry) => entry.classId === classAId)
    ?.relationships.find(
      (entry) => entry.studentId === studentCId,
    )?.classMembershipId;
  expect(membershipC).toBeString();
  const deactivated = await client.POST(
    '/api/v1/administration/classes/membership-deactivations',
    {
      headers: { ...operatorHeaders, cookie: administratorCookie },
      body: {
        operationId: crypto.randomUUID(),
        classMembershipId: membershipC!,
      },
    },
  );
  expect(deactivated.response.status).toBe(200);

  const disabled = await client.POST(
    '/api/v1/administration/students/disablements',
    {
      headers: { ...operatorHeaders, cookie: administratorCookie },
      body: {
        operationId: crypto.randomUUID(),
        studentId: studentBId,
        reason: 'compromised_access',
      },
    },
  );
  expect(disabled.response.status).toBe(200);
});

afterAll(async () => {
  server?.server.closeAllConnections?.();
  await server?.close();
  await postgres?.stop();
});

describe.serial('clinical review workspace', () => {
  test('directory filters by Class and keeps disabled and inactive Students discoverable without clinical content', async () => {
    const client = createApiClient(baseUrl);
    const listing = await client.GET('/api/v1/clinical/review-directory', {
      headers: { cookie: clinicianCookie },
    });
    expect(listing.response.status).toBe(200);
    expect(listing.response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(listing.data)).not.toContain(originalAnswer);
    expect(JSON.stringify(listing.data)).not.toMatch(
      /draft|progress|follow-?up/i,
    );
    const students = listing.data?.students ?? [];
    expect(students.map((student) => student.studentId).sort()).toEqual(
      [studentAId, studentBId, studentCId].sort(),
    );
    expect(listing.data?.classes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classId: classAId,
          name: 'Health Literacy 7A',
        }),
        expect.objectContaining({
          classId: classBId,
          name: 'Health Literacy 7B',
        }),
      ]),
    );
    const active = students.find((student) => student.studentId === studentAId);
    const disabled = students.find(
      (student) => student.studentId === studentBId,
    );
    const inactive = students.find(
      (student) => student.studentId === studentCId,
    );
    expect(active?.studentStatus).toBe('active');
    expect(active?.statusReasons).toEqual([]);
    expect(disabled?.studentStatus).toBe('disabled');
    expect(disabled?.statusReasons).toContain('disabled');
    expect(inactive?.statusReasons).toContain('no_active_membership');
    expect(inactive?.classMemberships).toEqual([
      expect.objectContaining({
        classId: classAId,
        status: 'inactive',
      }),
    ]);

    const classA = await client.GET('/api/v1/clinical/review-directory', {
      headers: { cookie: clinicianCookie },
      params: { query: { classId: classAId } },
    });
    expect(classA.response.status).toBe(200);
    expect(
      (classA.data?.students ?? []).map((student) => student.studentId).sort(),
    ).toEqual([studentAId, studentCId].sort());

    const classB = await client.GET('/api/v1/clinical/review-directory', {
      headers: { cookie: clinicianCookie },
      params: { query: { classId: classBId } },
    });
    expect(
      (classB.data?.students ?? []).map((student) => student.studentId),
    ).toEqual([studentBId]);

    const denied = await client.GET('/api/v1/clinical/review-directory', {
      headers: { cookie: administratorCookie },
    });
    expect(denied.response.status).toBe(403);
  });

  test('selection and historical reveal recheck authority, record separate evidence, and resolve frozen history', async () => {
    const client = createApiClient(baseUrl);
    const opened = await client.GET('/api/v1/student/intake', {
      headers: { cookie: studentACookie },
      params: { query: { locale: 'en-US' } },
    });
    expect(opened.response.status).toBe(200);
    const snapshot = opened.data as StudentIntakeSnapshot;
    const originalAnswers = completeAnswers(
      snapshot.form.intakeForm.fields,
      originalAnswer,
    );
    const submitted = await client.POST('/api/v1/student/intake/submissions', {
      headers: { ...mutationHeaders, cookie: studentACookie },
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
        answers: originalAnswers,
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
    const versionOneId = submitted.data?.intakeRecordVersionId ?? '';
    const originalReleaseId = snapshot.form.schoolConfigurationReleaseId;
    const originalFormRevision = snapshot.form.intakeForm.revisionNumber;

    const reopened = await client.POST('/api/v1/student/intake/reopen', {
      headers: { ...mutationHeaders, cookie: studentACookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedCurrentIntakeRecordVersionId: versionOneId,
        locale: 'en-US',
      },
    });
    expect(reopened.response.status).toBe(200);
    const draft = await client.GET('/api/v1/student/intake', {
      headers: { cookie: studentACookie },
      params: { query: { locale: 'en-US' } },
    });
    const amended = {
      ...(draft.data?.draft?.answers ?? originalAnswers),
      [nameFieldId]: amendedAnswer,
    };
    const successor = await client.POST('/api/v1/student/intake/submissions', {
      headers: { ...mutationHeaders, cookie: studentACookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedSchoolConfigurationReleaseId:
          draft.data?.form.schoolConfigurationReleaseId ?? '',
        expectedIntakeForm: {
          resourceId: draft.data?.form.intakeForm.resourceId ?? '',
          revisionNumber: draft.data?.form.intakeForm.revisionNumber ?? 1,
        },
        expectedSubmissionAttestation: {
          resourceId: draft.data?.form.submissionAttestation.resourceId ?? '',
          revisionNumber:
            draft.data?.form.submissionAttestation.revisionNumber ?? 1,
        },
        expectedDraftRevision: draft.data?.draft?.draftRevision ?? 1,
        expectedCurrentIntakeRecordVersionId: versionOneId,
        locale: 'en-US',
        answers: amended,
        attestation: {
          locale: 'en-US',
          notice: {
            resourceId: draft.data?.form.submissionAttestation.resourceId ?? '',
            revisionNumber:
              draft.data?.form.submissionAttestation.revisionNumber ?? 1,
          },
        },
      },
    });
    expect(successor.response.status).toBe(201);
    const versionTwoId = successor.data?.intakeRecordVersionId ?? '';

    const missingPurpose = await client.POST(
      '/api/v1/clinical/students/selection',
      {
        headers: { ...mutationHeaders, cookie: clinicianCookie },
        body: { studentId: studentAId },
      },
    );
    expect(missingPurpose.response.status).toBe(400);

    const adminSelection = await client.POST(
      '/api/v1/clinical/students/selection',
      {
        headers: { ...mutationHeaders, cookie: administratorCookie },
        body: { studentId: studentAId, purpose: 'care_coordination' },
      },
    );
    expect(adminSelection.response.status).toBe(403);

    const selected = await client.POST('/api/v1/clinical/students/selection', {
      headers: { ...mutationHeaders, cookie: clinicianCookie },
      body: { studentId: studentAId, purpose: 'care_coordination' },
    });
    expect(selected.response.status).toBe(200);
    expect(selected.response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(selected.data)).not.toContain(originalAnswer);
    expect(JSON.stringify(selected.data)).not.toContain(amendedAnswer);
    expect(JSON.stringify(selected.data)).not.toMatch(/draft/i);
    expect(selected.data?.studentId).toBe(studentAId);
    expect(selected.data?.versions).toEqual([
      expect.objectContaining({
        intakeRecordVersionId: versionOneId,
        versionNumber: 1,
        status: 'superseded',
        schoolConfigurationReleaseId: originalReleaseId,
        locale: 'en-US',
      }),
      expect.objectContaining({
        intakeRecordVersionId: versionTwoId,
        versionNumber: 2,
        status: 'current',
        predecessorIntakeRecordVersionId: versionOneId,
      }),
    ]);

    const historical = await client.POST(
      '/api/v1/clinical/intake-records/versions',
      {
        headers: { ...mutationHeaders, cookie: clinicianCookie },
        body: {
          studentId: studentAId,
          intakeRecordVersionId: versionOneId,
          purpose: 'historical_comparison',
        },
      },
    );
    expect(historical.response.status).toBe(200);
    expect(historical.response.headers.get('cache-control')).toBe('no-store');
    expect(historical.data?.intakeRecordVersionId).toBe(versionOneId);
    expect(historical.data?.status).toBe('superseded');
    expect(historical.data?.answers[nameFieldId]).toBe(originalAnswer);
    expect(historical.data?.schoolConfigurationReleaseId).toBe(
      originalReleaseId,
    );
    expect(historical.data?.intakeForm.revisionNumber).toBe(
      originalFormRevision,
    );
    expect(historical.data?.intakeUpdateRequirement).toBeNull();
    const orderedIds = [...(historical.data?.intakeForm.fields ?? [])]
      .sort((left, right) => left.order - right.order)
      .map((field) => field.id);
    expect(historical.data?.intakeForm.fields.map((field) => field.id)).toEqual(
      orderedIds,
    );

    const current = await client.POST(
      '/api/v1/clinical/intake-records/current',
      {
        headers: { ...mutationHeaders, cookie: clinicianCookie },
        body: { studentId: studentAId },
      },
    );
    expect(current.response.status).toBe(200);
    expect(current.data?.intakeRecordVersionId).toBe(versionTwoId);
    expect(current.data?.status).toBe('current');
    expect(current.data?.predecessorIntakeRecordVersionId).toBe(versionOneId);
    expect(current.data?.answers[nameFieldId]).toBe(amendedAnswer);
    expect(current.data?.changedFields).toEqual([
      { fieldId: nameFieldId, change: 'changed' },
    ]);

    const adminHistorical = await client.POST(
      '/api/v1/clinical/intake-records/versions',
      {
        headers: { ...mutationHeaders, cookie: administratorCookie },
        body: {
          studentId: studentAId,
          intakeRecordVersionId: versionOneId,
          purpose: 'historical_comparison',
        },
      },
    );
    expect(adminHistorical.response.status).toBe(403);

    const inspection = new Client({
      connectionString: postgres.connectionString,
    });
    await inspection.connect();
    try {
      const audits = await inspection.query<{
        event_type: string;
        details: Record<string, unknown>;
      }>(
        `select event_type, details from audit.evidence
          where actor_id = $1 and event_type in (
            'student_record.selected', 'student_record.selection_denied',
            'intake_record.revealed', 'intake_record.reveal_denied'
          )
          order by occurred_at, sequence`,
        [clinicianId],
      );
      expect(audits.rows).toEqual(
        expect.arrayContaining([
          {
            event_type: 'student_record.selected',
            details: expect.objectContaining({
              studentId: studentAId,
              outcome: 'selected',
              purpose: 'care_coordination',
            }),
          },
          {
            event_type: 'intake_record.revealed',
            details: expect.objectContaining({
              studentId: studentAId,
              intakeRecordVersionId: versionOneId,
              purpose: 'historical_comparison',
              kind: 'historical',
            }),
          },
          {
            event_type: 'intake_record.revealed',
            details: expect.objectContaining({
              studentId: studentAId,
              intakeRecordVersionId: versionTwoId,
              kind: 'current',
            }),
          },
        ]),
      );
      expect(
        audits.rows.filter(
          (row) => row.event_type === 'intake_record.reveal_denied',
        ),
      ).toEqual([]);
      const administratorAudits = await inspection.query<{
        event_type: string;
        details: Record<string, unknown>;
      }>(
        `select event_type, details from audit.evidence
          where actor_id = $1 and event_type in (
            'student_record.selected', 'student_record.selection_denied',
            'intake_record.revealed', 'intake_record.reveal_denied'
          )
          order by occurred_at, sequence`,
        [administratorId],
      );
      expect(administratorAudits.rows).toEqual([
        {
          event_type: 'student_record.selection_denied',
          details: expect.objectContaining({
            studentId: studentAId,
            outcome: 'denied_permission',
            purpose: 'care_coordination',
          }),
        },
        {
          event_type: 'intake_record.reveal_denied',
          details: expect.objectContaining({
            studentId: studentAId,
            outcome: 'denied_permission',
          }),
        },
      ]);
      expect(JSON.stringify(audits.rows)).not.toContain(originalAnswer);
      expect(JSON.stringify(audits.rows)).not.toContain(amendedAnswer);
    } finally {
      await inspection.end();
    }
  });
});
