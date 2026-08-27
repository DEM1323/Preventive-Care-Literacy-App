import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { createServer } from '../../apps/server/src/app.ts';
import type {
  IntakeFormField,
  SaveIntakeDraftResult,
  StudentIntakeSnapshot,
} from '../../modules/intake/index.ts';
import { canonicalJson } from '../../modules/school-configuration/index.ts';
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
const administratorId = crypto.randomUUID();
const clinicianId = crypto.randomUUID();
const classId = crypto.randomUUID();
const invitationId = crypto.randomUUID();
const administratorEmail = 'administrator.draft@example.test';
const clinicianEmail = 'clinician.draft@example.test';
const password = 'correct horse battery staple';
const recipient = 'student.draft@example.test';
const invitationCode = '729104';
const signInCode = '424242';
const distinctiveAnswer = 'Synthetic draft answer one';
const laterAnswer = 'Synthetic draft answer two';
const origin = 'http://127.0.0.1';
const operatorHeaders = {
  authorization: `Bearer ${'draft-operator-token-'.padEnd(40, 'x')}`,
  origin,
  'x-prevcare-csrf': '1',
} as const;
const mutationHeaders = {
  origin,
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;

let now = new Date('2026-08-27T15:00:00.000Z');
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
const fakeAuth = createFakeStaffAuth();
const wrappingKeys = {
  wrappingKeys: { test: Buffer.alloc(32, 13) },
  activeWrappingKeyId: 'test',
  idempotencyKey: Buffer.alloc(32, 19),
};
const envelopeKeys = createEnvelopeKeyManagement(wrappingKeys);

function nameAnswers(fields: IntakeFormField[], value: string) {
  const nameField = fields.find((field) => field.key === 'name');
  expect(nameField?.id).toBeString();
  return { [nameField!.id]: value };
}

function draftBody(
  snapshot: StudentIntakeSnapshot,
  answers: Record<string, string>,
  operationId: string,
  expectedDraftRevision = snapshot.draft?.draftRevision ?? 0,
) {
  return {
    operationId,
    expectedDraftRevision,
    expectedSchoolConfigurationReleaseId:
      snapshot.form.schoolConfigurationReleaseId,
    expectedIntakeForm: {
      resourceId: snapshot.form.intakeForm.resourceId,
      revisionNumber: snapshot.form.intakeForm.revisionNumber,
    },
    locale: 'en-US' as const,
    answers,
  };
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

async function markSignInDelivered() {
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
      actorId: 'draft-test-operator',
    },
    staffAuth: fakeAuth.provider,
    clock: { now: () => now },
    invitationSecrets: {
      hmacKey: Buffer.alloc(32, 7),
      encryptionKeys: { test: Buffer.alloc(32, 9) },
      activeEncryptionKeyId: 'test',
      createCode: () => generatedCode,
    },
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
          reason: 'Intake Draft concurrency test',
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

test('Student saves and resumes an encrypted Intake Draft bound to exact release and form revisions', async () => {
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

  const answers = nameAnswers(
    snapshot.form.intakeForm.fields,
    distinctiveAnswer,
  );
  const operationId = crypto.randomUUID();
  const saved = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: draftBody(snapshot, answers, operationId, 0),
  });
  expect(saved.response.status).toBe(200);
  expect(saved.data).toMatchObject({
    operationId,
    locale: 'en-US',
    draftRevision: 1,
    replayed: false,
  });
  expect(JSON.stringify(saved.data)).not.toContain(distinctiveAnswer);

  const resumed = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(resumed.response.status).toBe(200);
  expect(resumed.data).toMatchObject({
    learningUnlocked: false,
    currentIntakeRecordVersion: null,
    draft: {
      draftRevision: 1,
      locale: 'en-US',
      answers,
      schoolConfigurationReleaseId: snapshot.form.schoolConfigurationReleaseId,
      intakeForm: {
        resourceId: snapshot.form.intakeForm.resourceId,
        revisionNumber: snapshot.form.intakeForm.revisionNumber,
      },
    },
    form: {
      schoolConfigurationReleaseId: snapshot.form.schoolConfigurationReleaseId,
      intakeForm: {
        resourceId: snapshot.form.intakeForm.resourceId,
        revisionNumber: snapshot.form.intakeForm.revisionNumber,
      },
    },
  });
  expect(JSON.stringify(resumed.data?.form)).not.toContain(distinctiveAnswer);

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const stored = await inspection.query<{
      drafts: string;
      versions: string;
      wrapping_key_id: string;
      wrapped_data_key: string;
      ciphertext: string;
      school_configuration_release_id: string;
      intake_form_resource_id: string;
      intake_form_revision_number: number;
      draft_revision: number;
    }>(
      `select
         (select count(*) from intake.intake_drafts) as drafts,
         (select count(*) from intake.intake_record_versions) as versions,
         wrapping_key_id, wrapped_data_key, ciphertext,
         school_configuration_release_id, intake_form_resource_id,
         intake_form_revision_number, draft_revision
       from intake.intake_drafts`,
    );
    expect(stored.rows).toEqual([
      expect.objectContaining({
        drafts: '1',
        versions: '0',
        wrapping_key_id: 'test',
        school_configuration_release_id:
          snapshot.form.schoolConfigurationReleaseId,
        intake_form_resource_id: snapshot.form.intakeForm.resourceId,
        intake_form_revision_number: snapshot.form.intakeForm.revisionNumber,
        draft_revision: 1,
      }),
    ]);
    expect(stored.rows[0]?.wrapped_data_key).not.toContain(distinctiveAnswer);
    expect(stored.rows[0]?.ciphertext).not.toContain(distinctiveAnswer);
    expect(stored.rows[0]?.ciphertext).not.toContain(recipient);
  } finally {
    await inspection.end();
  }

  expect(telemetryLines.join('\n')).not.toContain(distinctiveAnswer);
  expect(telemetryLines.join('\n')).not.toContain(recipient);
});

test('an idempotent Intake Draft save retry returns the established result', async () => {
  const client = createApiClient(baseUrl);
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  const snapshot = opened.data as StudentIntakeSnapshot;
  const answers = nameAnswers(
    snapshot.form.intakeForm.fields,
    distinctiveAnswer,
  );
  const operationId = crypto.randomUUID();
  const command = draftBody(snapshot, answers, operationId);

  const first = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: command,
  });
  expect(first.response.status).toBe(200);
  expect(first.data?.replayed).toBe(false);

  now = new Date(now.getTime() + 1000);
  const replay = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: command,
  });
  expect(replay.response.status).toBe(200);
  expect(replay.data).toEqual({ ...first.data, replayed: true });

  const inspection = new Client({
    connectionString: postgres.connectionString,
  });
  await inspection.connect();
  try {
    const receipts = await inspection.query<{
      request_binding: string;
      result: SaveIntakeDraftResult;
      command_name: string;
    }>(
      `select request_binding, result, command_name
         from intake.intake_operation_receipts
        where operation_id = $1`,
      [operationId],
    );
    expect(receipts.rows).toHaveLength(1);
    expect(receipts.rows[0]?.command_name).toBe('saveIntakeDraft');
    const storedBinding = receipts.rows[0]?.request_binding ?? '';
    const guessableFingerprint = createHash('sha256')
      .update(canonicalJson(command))
      .digest('hex');
    expect(storedBinding).not.toBe(guessableFingerprint);
    expect(storedBinding).not.toContain(distinctiveAnswer);
    expect(JSON.stringify(receipts.rows[0]?.result)).not.toContain(
      distinctiveAnswer,
    );
  } finally {
    await inspection.end();
  }

  const reused = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: draftBody(
      snapshot,
      nameAnswers(snapshot.form.intakeForm.fields, laterAnswer),
      operationId,
    ),
  });
  expect(reused.response.status).toBe(409);
  expect(reused.error).toMatchObject({ code: 'OPERATION_ID_REUSED' });
  expect(JSON.stringify(reused.error)).not.toContain(distinctiveAnswer);
  expect(JSON.stringify(reused.error)).not.toContain(laterAnswer);

  const unchanged = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(unchanged.data?.draft?.answers).toEqual(answers);
  expect(unchanged.data?.draft?.draftRevision).toBe(first.data?.draftRevision);
});

test('a stale Intake Draft save is rejected with stable conflict details', async () => {
  const client = createApiClient(baseUrl);
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  const snapshot = opened.data as StudentIntakeSnapshot;
  const currentRevision = snapshot.draft?.draftRevision ?? 0;
  const answers = nameAnswers(snapshot.form.intakeForm.fields, laterAnswer);

  const stale = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: draftBody(snapshot, answers, crypto.randomUUID(), 0),
  });
  expect(stale.response.status).toBe(409);
  expect(stale.error).toEqual({
    type: 'https://preventive-care-literacy.example/problems/intake-conflict',
    title: 'The Intake Draft changed',
    status: 409,
    code: 'INTAKE_DRAFT_REVISION_CONFLICT',
    draftRevision: currentRevision,
  });
  expect(JSON.stringify(stale.error)).not.toContain(laterAnswer);
  expect(JSON.stringify(stale.error)).not.toContain(distinctiveAnswer);

  const authoritative = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(authoritative.data?.draft?.draftRevision).toBe(currentRevision);
  expect(authoritative.data?.draft?.answers).toEqual(
    nameAnswers(snapshot.form.intakeForm.fields, distinctiveAnswer),
  );
  expect(authoritative.data?.learningUnlocked).toBe(false);
});

test('fresh-browser Sign-In restores the encrypted Intake Draft without mixing sessions', async () => {
  const client = createApiClient(baseUrl);
  const before = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(before.data?.draft?.answers).toEqual(
    nameAnswers(before.data?.form.intakeForm.fields ?? [], distinctiveAnswer),
  );
  const savedRevision = before.data?.draft?.draftRevision;

  generatedCode = signInCode;
  const requested = await fetch(`${baseUrl}/api/v1/auth/student/sign-in`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ recipient }),
  });
  expect(requested.status).toBe(200);
  await markSignInDelivered();
  generatedCode = invitationCode;
  const verified = await fetch(
    `${baseUrl}/api/v1/auth/student/sign-in/verify`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({ recipient, code: signInCode }),
    },
  );
  expect(verified.status).toBe(200);
  const restoredCookie = verified.headers.get('set-cookie')?.split(';', 1)[0];
  expect(restoredCookie).toBeString();
  expect(restoredCookie).not.toBe(studentCookie);

  const restored = await client.GET('/api/v1/student/intake', {
    headers: { cookie: restoredCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(restored.response.status).toBe(200);
  expect(restored.data).toMatchObject({
    learningUnlocked: false,
    currentIntakeRecordVersion: null,
    draft: {
      draftRevision: savedRevision,
      answers: nameAnswers(
        restored.data?.form.intakeForm.fields ?? [],
        distinctiveAnswer,
      ),
      schoolConfigurationReleaseId:
        before.data?.form.schoolConfigurationReleaseId,
    },
  });
  expect(JSON.stringify(restored.data?.form)).not.toContain(distinctiveAnswer);

  now = new Date(now.getTime() + 1000);
  const concurrent = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: restoredCookie },
    body: draftBody(
      restored.data as StudentIntakeSnapshot,
      nameAnswers(restored.data?.form.intakeForm.fields ?? [], laterAnswer),
      crypto.randomUUID(),
    ),
  });
  expect(concurrent.response.status).toBe(200);
  expect(concurrent.data?.draftRevision).toBe((savedRevision ?? 0) + 1);

  const staleOriginal = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: draftBody(
      before.data as StudentIntakeSnapshot,
      nameAnswers(before.data?.form.intakeForm.fields ?? [], distinctiveAnswer),
      crypto.randomUUID(),
    ),
  });
  expect(staleOriginal.response.status).toBe(409);
  expect(staleOriginal.error).toMatchObject({
    code: 'INTAKE_DRAFT_REVISION_CONFLICT',
    draftRevision: concurrent.data?.draftRevision,
  });
  expect(JSON.stringify(staleOriginal.error)).not.toContain(distinctiveAnswer);

  const authoritative = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(authoritative.data?.draft?.answers).toEqual(
    nameAnswers(authoritative.data?.form.intakeForm.fields ?? [], laterAnswer),
  );
  expect(authoritative.data?.draft?.draftRevision).toBe(
    concurrent.data?.draftRevision,
  );
});

test('staff projections stay blind to Intake Drafts and learning stays locked', async () => {
  const client = createApiClient(baseUrl);
  const session = await client.GET('/api/v1/student/session', {
    headers: { cookie: studentCookie },
  });
  expect(session.response.status).toBe(200);
  const studentId = session.data?.studentId ?? '';

  const clinical = await client.GET('/api/v1/clinical/review-directory', {
    headers: { cookie: clinicianCookie },
  });
  expect(clinical.response.status).toBe(200);
  expect(JSON.stringify(clinical.data)).not.toContain(distinctiveAnswer);
  expect(JSON.stringify(clinical.data)).not.toContain(laterAnswer);
  expect(
    clinical.data?.students.find((entry) => entry.studentId === studentId),
  ).toMatchObject({
    studentId,
    currentIntakeRecordVersion: null,
  });

  const reveal = await client.POST('/api/v1/clinical/intake-records/current', {
    headers: { ...mutationHeaders, cookie: clinicianCookie },
    body: { studentId },
  });
  expect(reveal.response.status).toBe(404);
  expect(reveal.error).toMatchObject({ code: 'INTAKE_RECORD_NOT_FOUND' });
  expect(JSON.stringify(reveal.error)).not.toContain(laterAnswer);

  const configuration = await client.GET(
    '/api/v1/administration/school-configuration',
    { headers: { cookie: administratorCookie } },
  );
  expect(configuration.response.status).toBe(200);
  expect(JSON.stringify(configuration.data)).not.toContain(laterAnswer);

  const staffIntake = await client.GET('/api/v1/student/intake', {
    headers: { cookie: administratorCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(staffIntake.response.status).toBe(401);

  const learning = await client.GET('/api/v1/student/learning', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(learning.response.status).toBe(200);
  expect(learning.data).toMatchObject({
    learningUnlocked: false,
    item: null,
    completion: null,
  });
  const blocked = await client.POST(
    '/api/v1/student/learning/acknowledgements',
    {
      headers: { ...mutationHeaders, cookie: studentCookie },
      body: {
        operationId: crypto.randomUUID(),
        expectedSchoolConfigurationReleaseId: crypto.randomUUID(),
        itemId: crypto.randomUUID(),
        revisionNumber: 1,
      },
    },
  );
  expect(blocked.response.status).toBe(403);
  expect(blocked.error).toMatchObject({ code: 'LEARNING_LOCKED' });
});

test('draft save and retrieval require current Student access', async () => {
  const client = createApiClient(baseUrl);
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  const snapshot = opened.data as StudentIntakeSnapshot;
  const answers = nameAnswers(
    snapshot.form.intakeForm.fields,
    distinctiveAnswer,
  );

  const anonymousRead = await client.GET('/api/v1/student/intake', {
    params: { query: { locale: 'en-US' } },
  });
  expect(anonymousRead.response.status).toBe(401);
  const anonymousSave = await client.PUT('/api/v1/student/intake/draft', {
    headers: mutationHeaders,
    body: draftBody(snapshot, answers, crypto.randomUUID()),
  });
  expect(anonymousSave.response.status).toBe(401);

  const disabledInvitationId = crypto.randomUUID();
  generatedCode = '434343';
  const invited = await client.POST('/api/v1/administration/classes', {
    headers: { ...operatorHeaders, cookie: administratorCookie },
    body: {
      operationId: crypto.randomUUID(),
      classId: crypto.randomUUID(),
      invitationId: disabledInvitationId,
      name: 'Health Literacy Disablement',
      recipient: 'disabled.draft@example.test',
    },
  });
  expect(invited.response.status).toBe(201);
  await markInvitationDelivered(disabledInvitationId);
  const redeemed = await fetch(
    `${baseUrl}/api/v1/auth/student/invitations/redeem`,
    {
      method: 'POST',
      headers: mutationHeaders,
      body: JSON.stringify({
        recipient: 'disabled.draft@example.test',
        code: '434343',
      }),
    },
  );
  generatedCode = invitationCode;
  expect(redeemed.status).toBe(200);
  const disabledCookie = redeemed.headers.get('set-cookie')?.split(';', 1)[0];
  const disabledSession = await client.GET('/api/v1/student/session', {
    headers: { cookie: disabledCookie },
  });
  const disabled = await client.POST(
    '/api/v1/administration/students/disablements',
    {
      headers: { ...mutationHeaders, cookie: administratorCookie },
      body: {
        operationId: crypto.randomUUID(),
        studentId: disabledSession.data?.studentId ?? '',
        reason: 'compromised_access',
      },
    },
  );
  expect(disabled.response.status).toBe(200);
  expect(
    (
      await client.GET('/api/v1/student/intake', {
        headers: { cookie: disabledCookie },
        params: { query: { locale: 'en-US' } },
      })
    ).response.status,
  ).toBe(401);
  expect(
    (
      await client.PUT('/api/v1/student/intake/draft', {
        headers: { ...mutationHeaders, cookie: disabledCookie },
        body: draftBody(snapshot, answers, crypto.randomUUID(), 0),
      })
    ).response.status,
  ).toBe(401);
});

test('provider or persistence failure does not keep a draft write or leak answers', async () => {
  const client = createApiClient(baseUrl);
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  const snapshot = opened.data as StudentIntakeSnapshot;
  const failedAnswers = nameAnswers(
    snapshot.form.intakeForm.fields,
    'Synthetic failed draft answer',
  );
  const operationId = crypto.randomUUID();
  const command = draftBody(snapshot, failedAnswers, operationId);

  failSeal = true;
  const providerFailed = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: command,
  });
  failSeal = false;
  expect(providerFailed.response.status).toBe(500);
  expect(JSON.stringify(providerFailed.error)).not.toContain(
    'Synthetic failed draft answer',
  );
  expect(providerFailed.error).toMatchObject({ code: 'INTERNAL_ERROR' });

  const afterProvider = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(afterProvider.data?.draft?.answers).toEqual(snapshot.draft?.answers);
  expect(afterProvider.data?.draft?.draftRevision).toBe(
    snapshot.draft?.draftRevision,
  );

  const recovered = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: command,
  });
  expect(recovered.response.status).toBe(200);
  expect(recovered.data).toMatchObject({
    operationId,
    replayed: false,
    draftRevision: (snapshot.draft?.draftRevision ?? 0) + 1,
  });

  const runtimeRole = new URL(runtimeDatabaseUrl).username;
  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(
      `revoke insert, update on intake.intake_drafts from ${runtimeRole}`,
    );
  } finally {
    await owner.end();
  }

  const persistenceCommand = draftBody(
    {
      ...snapshot,
      draft: {
        ...snapshot.draft!,
        draftRevision: recovered.data?.draftRevision ?? 0,
      },
    },
    failedAnswers,
    crypto.randomUUID(),
  );
  const persistenceFailed = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: persistenceCommand,
  });
  expect(persistenceFailed.response.status).toBe(500);
  expect(JSON.stringify(persistenceFailed.error)).not.toContain(
    'Synthetic failed draft answer',
  );

  const restore = new Client({ connectionString: postgres.connectionString });
  await restore.connect();
  try {
    await restore.query(
      `grant insert, update on intake.intake_drafts to ${runtimeRole}`,
    );
  } finally {
    await restore.end();
  }

  const retried = await client.PUT('/api/v1/student/intake/draft', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: persistenceCommand,
  });
  expect(retried.response.status).toBe(200);
  expect(retried.data?.replayed).toBe(false);
  expect(retried.data?.draftRevision).toBe(
    (recovered.data?.draftRevision ?? 0) + 1,
  );
});
