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
const administratorId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf7102';
const clinicianId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf7103';
const classId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf7104';
const invitationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf7105';
const administratorEmail = 'administrator.reveal@example.test';
const clinicianEmail = 'clinician.reveal@example.test';
const password = 'correct horse battery staple';
const recipient = 'student.reveal@example.test';
const invitationCode = '729104';
const distinctiveAnswer = 'UNIQUE-CLINICAL-ANSWER-9c1d';
const origin = 'http://127.0.0.1';
const operatorHeaders = {
  authorization: `Bearer ${'reveal-operator-token-'.padEnd(40, 'x')}`,
  origin,
  'x-prevcare-csrf': '1',
} as const;
const mutationHeaders = {
  origin,
  'x-prevcare-csrf': '1',
  'content-type': 'application/json',
} as const;

let now = new Date('2026-08-25T16:00:00.000Z');
let postgres: EphemeralPostgres;
let runtimeDatabaseUrl: string;
let server: FastifyInstance;
let baseUrl: string;
let administratorCookie: string;
let clinicianCookie: string;
let studentCookie: string;
let studentId: string;
let candidate: unknown;
let telemetryLines: string[] = [];
const fakeAuth = createFakeStaffAuth();
const invitationSecrets = {
  hmacKey: Buffer.alloc(32, 7),
  encryptionKeys: { test: Buffer.alloc(32, 9) },
  activeEncryptionKeyId: 'test',
  createCode: () => invitationCode,
};
const wrappingKeys = {
  wrappingKeys: { test: Buffer.alloc(32, 13) },
  activeWrappingKeyId: 'test',
  idempotencyKey: Buffer.alloc(32, 17),
};
const envelopeKeys = createEnvelopeKeyManagement(wrappingKeys);
let duringDecrypt: (() => Promise<void>) | undefined;

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

async function markInvitationDelivered() {
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

async function submitCurrentIntake() {
  const client = createApiClient(baseUrl);
  const opened = await client.GET('/api/v1/student/intake', {
    headers: { cookie: studentCookie },
    params: { query: { locale: 'en-US' } },
  });
  expect(opened.response.status).toBe(200);
  const snapshot = opened.data as StudentIntakeSnapshot;
  const answers = completeAnswers(snapshot.form.intakeForm.fields);
  const submitted = await client.POST('/api/v1/student/intake/submissions', {
    headers: { ...mutationHeaders, cookie: studentCookie },
    body: {
      operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf71aa',
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
  return { snapshot, answers };
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
      actorId: 'clinical-reveal-operator',
    },
    staffAuth: fakeAuth.provider,
    clock: { now: () => now },
    invitationSecrets,
    wrappingKeys,
    applicationKeys: {
      name: envelopeKeys.name,
      seal: (plaintext, context) => envelopeKeys.seal(plaintext, context),
      bind: (plaintext, context) => envelopeKeys.bind(plaintext, context),
      async open(sealed, context) {
        if (duringDecrypt) await duringDecrypt();
        return envelopeKeys.open(sealed, context);
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
        displayName: 'Clinical Reveal Workspace',
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
          reason: 'Clinical Intake Record reveal test',
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
        changeDescription: 'Publish synthetic content for clinical reveal.',
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
  expect(studentId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
});

afterAll(async () => {
  await server?.close();
  await postgres?.stop();
});

describe.serial('clinical directory and current Intake Record reveal', () => {
  test('directory and reveal are separate requests that recheck authority and keep answers out of the directory', async () => {
    telemetryLines = [];
    const { snapshot, answers } = await submitCurrentIntake();
    const client = createApiClient(baseUrl);
    const directory = await client.GET('/api/v1/clinical/review-directory', {
      headers: { cookie: clinicianCookie },
    });
    expect(directory.response.status).toBe(200);
    expect(directory.response.headers.get('cache-control')).toBe('no-store');
    expect(directory.response.url).not.toContain(studentId);
    expect(JSON.stringify(directory.data)).not.toContain(distinctiveAnswer);
    expect(directory.data?.students).toEqual([
      expect.objectContaining({
        studentId,
        currentIntakeRecordVersion: expect.objectContaining({
          locale: 'en-US',
        }),
      }),
    ]);
    expect(directory.data?.freshUntil).toBe(
      new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    );

    const revealed = await client.POST(
      '/api/v1/clinical/intake-records/current',
      {
        headers: { ...mutationHeaders, cookie: clinicianCookie },
        body: { studentId },
      },
    );
    expect(revealed.response.status).toBe(200);
    expect(revealed.response.headers.get('cache-control')).toBe('no-store');
    expect(revealed.response.url).not.toContain(studentId);
    expect(revealed.response.url).not.toContain(distinctiveAnswer);
    expect(revealed.data?.answers).toEqual(answers);
    expect(revealed.data?.studentId).toBe(studentId);
    expect(revealed.data?.locale).toBe('en-US');
    expect(revealed.data?.intakeForm.resourceId).toBe(
      snapshot.form.intakeForm.resourceId,
    );
    const nameField = revealed.data?.intakeForm.fields.find(
      (field) => field.key === 'name',
    );
    expect(nameField?.label).toBeTruthy();
    expect(revealed.data?.freshUntil).toBe(
      new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    );

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
            'intake_record.revealed', 'intake_record.reveal_denied'
          )
          order by occurred_at, sequence`,
        [clinicianId],
      );
      expect(audits.rows).toEqual([
        {
          event_type: 'intake_record.revealed',
          details: expect.objectContaining({
            studentId,
            outcome: 'revealed',
            staffSessionId: expect.any(String),
            intakeRecordVersionId: expect.any(String),
          }),
        },
      ]);
      expect(JSON.stringify(audits.rows)).not.toContain(distinctiveAnswer);
      expect(JSON.stringify(audits.rows[0]?.details)).not.toContain(
        nameField?.label ?? '___',
      );
    } finally {
      await inspection.end();
    }

    expect(telemetryLines.join('\n')).not.toContain(distinctiveAnswer);
    expect(
      telemetryLines.some((line) => line.includes('clinical-directory')),
    ).toBe(true);
    expect(
      telemetryLines.some((line) => line.includes('clinical-intake-reveal')),
    ).toBe(true);
  });

  test('denied and failed reveals append safe audit evidence and do not decrypt', async () => {
    const client = createApiClient(baseUrl);
    const missingCookie = await client.POST(
      '/api/v1/clinical/intake-records/current',
      {
        headers: mutationHeaders,
        body: { studentId },
      },
    );
    expect(missingCookie.response.status).toBe(401);

    const unknownSession = await client.POST(
      '/api/v1/clinical/intake-records/current',
      {
        headers: {
          ...mutationHeaders,
          cookie: '__Host-prevcare-staff-session=unknown-clinical-reveal',
        },
        body: { studentId },
      },
    );
    expect(unknownSession.response.status).toBe(401);
    expect(JSON.stringify(unknownSession.error)).not.toContain(
      distinctiveAnswer,
    );

    const administratorReveal = await client.POST(
      '/api/v1/clinical/intake-records/current',
      {
        headers: { ...mutationHeaders, cookie: administratorCookie },
        body: { studentId },
      },
    );
    expect(administratorReveal.response.status).toBe(403);
    expect(administratorReveal.error).toMatchObject({
      code: 'STAFF_PERMISSION_REQUIRED',
    });
    expect(JSON.stringify(administratorReveal.error)).not.toContain(
      distinctiveAnswer,
    );

    const unknownStudent = crypto.randomUUID();
    const notFound = await client.POST(
      '/api/v1/clinical/intake-records/current',
      {
        headers: { ...mutationHeaders, cookie: clinicianCookie },
        body: { studentId: unknownStudent },
      },
    );
    expect(notFound.response.status).toBe(404);
    expect(notFound.error).toMatchObject({
      code: 'INTAKE_RECORD_NOT_FOUND',
    });
    expect(JSON.stringify(notFound.error)).not.toContain(distinctiveAnswer);

    const inspection = new Client({
      connectionString: postgres.connectionString,
    });
    await inspection.connect();
    try {
      const denials = await inspection.query<{
        event_type: string;
        actor_id: string;
        details: { outcome: string; studentId: string };
      }>(
        `select event_type, actor_id, details from audit.evidence
          where event_type = 'intake_record.reveal_denied'
          order by occurred_at, sequence`,
      );
      expect(denials.rows).toEqual([
        {
          event_type: 'intake_record.reveal_denied',
          actor_id: administratorId,
          details: expect.objectContaining({
            outcome: 'denied_permission',
            studentId,
          }),
        },
        {
          event_type: 'intake_record.reveal_denied',
          actor_id: clinicianId,
          details: expect.objectContaining({
            outcome: 'not_found',
            studentId: unknownStudent,
          }),
        },
      ]);
      expect(JSON.stringify(denials.rows)).not.toContain(distinctiveAnswer);

      const unattributed = await inspection.query<{
        event_type: string;
        details: Record<string, unknown>;
        actor_type: string | null;
        actor_id: string | null;
      }>(
        `select event_type, details, null::text as actor_type, null::text as actor_id
           from audit.security_events
          order by sequence`,
      );
      expect(unattributed.rows).toEqual([
        {
          event_type: 'intake_record.reveal_denied',
          actor_type: null,
          actor_id: null,
          details: expect.objectContaining({
            outcome: 'denied_unauthenticated',
            studentId,
          }),
        },
        {
          event_type: 'intake_record.reveal_denied',
          actor_type: null,
          actor_id: null,
          details: expect.objectContaining({
            outcome: 'denied_session_unknown',
            studentId,
          }),
        },
      ]);
      expect(JSON.stringify(unattributed.rows)).not.toContain(
        distinctiveAnswer,
      );
      expect(JSON.stringify(unattributed.rows)).not.toContain(
        'unknown-clinical-reveal',
      );

      const runtime = new Client({ connectionString: runtimeDatabaseUrl });
      await runtime.connect();
      try {
        await runtime.query('begin');
        await runtime.query(`select set_config('app.workspace_id', $1, true)`, [
          workspaceId,
        ]);
        await runtime.query(
          `select set_config('app.staff_identity_id', $1, true)`,
          [administratorId],
        );
        const adminRows = await runtime.query(
          'select ciphertext from intake.intake_record_versions',
        );
        expect(adminRows.rowCount).toBe(0);
        const adminStudents = await runtime.query(
          'select student_id from identity_access.students',
        );
        expect(adminStudents.rowCount).toBe(0);
        await runtime.query(
          `select set_config('app.staff_identity_id', $1, true)`,
          [clinicianId],
        );
        const clinicalRows = await runtime.query<{ ciphertext: string }>(
          'select ciphertext from intake.intake_record_versions',
        );
        expect(clinicalRows.rowCount).toBe(1);
        expect(clinicalRows.rows[0]?.ciphertext).not.toContain(
          distinctiveAnswer,
        );
        const clinicalStudents = await runtime.query(
          'select student_id from identity_access.students',
        );
        expect(clinicalStudents.rowCount).toBe(1);
        await runtime.query('rollback');
      } finally {
        await runtime.end();
      }
    } finally {
      await inspection.end();
    }
  });

  test('projection and decrypt failures append safe denial evidence without answers', async () => {
    const client = createApiClient(baseUrl);
    const owner = new Client({ connectionString: postgres.connectionString });
    await owner.connect();
    try {
      const current = await owner.query<{
        intake_form_resource_id: string;
        intake_form_revision_number: number;
        ciphertext: string;
      }>(
        `select intake_form_resource_id, intake_form_revision_number, ciphertext
           from intake.intake_record_versions
          where student_id = $1 and superseded_at is null`,
        [studentId],
      );
      const version = current.rows[0];
      expect(version).toBeDefined();
      const originalForm = await owner.query<{ payload: unknown }>(
        `select payload from school_configuration.authored_revisions
          where workspace_id = $1 and resource_id = $2 and revision_number = $3`,
        [
          workspaceId,
          version?.intake_form_resource_id,
          version?.intake_form_revision_number,
        ],
      );

      await owner.query(
        'alter table school_configuration.authored_revisions disable trigger frozen_revisions_are_immutable',
      );
      await owner.query(
        `update school_configuration.authored_revisions
            set payload = payload - 'title'
          where workspace_id = $1
            and resource_id = $2
            and revision_number = $3`,
        [
          workspaceId,
          version?.intake_form_resource_id,
          version?.intake_form_revision_number,
        ],
      );
      const projectionFailed = await client.POST(
        '/api/v1/clinical/intake-records/current',
        {
          headers: { ...mutationHeaders, cookie: clinicianCookie },
          body: { studentId },
        },
      );
      expect(projectionFailed.response.status).toBe(404);
      expect(JSON.stringify(projectionFailed.error)).not.toContain(
        distinctiveAnswer,
      );
      await owner.query(
        `update school_configuration.authored_revisions
            set payload = $4
          where workspace_id = $1
            and resource_id = $2
            and revision_number = $3`,
        [
          workspaceId,
          version?.intake_form_resource_id,
          version?.intake_form_revision_number,
          originalForm.rows[0]?.payload,
        ],
      );
      await owner.query(
        'alter table school_configuration.authored_revisions enable trigger frozen_revisions_are_immutable',
      );

      await owner.query(
        'alter table intake.intake_record_versions disable trigger intake_record_versions_are_immutable',
      );
      await owner.query(
        `update intake.intake_record_versions
            set ciphertext = 'corrupted-clinical-ciphertext'
          where student_id = $1 and superseded_at is null`,
        [studentId],
      );
      const decryptFailed = await client.POST(
        '/api/v1/clinical/intake-records/current',
        {
          headers: { ...mutationHeaders, cookie: clinicianCookie },
          body: { studentId },
        },
      );
      expect(decryptFailed.response.status).toBe(500);
      expect(JSON.stringify(decryptFailed.error)).not.toContain(
        distinctiveAnswer,
      );
      await owner.query(
        `update intake.intake_record_versions
            set ciphertext = $2
          where student_id = $1 and superseded_at is null`,
        [studentId, version?.ciphertext],
      );
      await owner.query(
        'alter table intake.intake_record_versions enable trigger intake_record_versions_are_immutable',
      );

      const failures = await owner.query<{ outcome: string }>(
        `select details->>'outcome' as outcome from audit.evidence
          where actor_id = $1
            and event_type = 'intake_record.reveal_denied'
            and details->>'outcome' in ('failed_projection', 'failed_decrypt')
          order by sequence`,
        [clinicianId],
      );
      expect(failures.rows.map((row) => row.outcome)).toEqual([
        'failed_projection',
        'failed_decrypt',
      ]);
      expect(JSON.stringify(failures.rows)).not.toContain(distinctiveAnswer);
    } finally {
      await owner
        .query(
          'alter table school_configuration.authored_revisions enable trigger frozen_revisions_are_immutable',
        )
        .catch(() => undefined);
      await owner
        .query(
          'alter table intake.intake_record_versions enable trigger intake_record_versions_are_immutable',
        )
        .catch(() => undefined);
      await owner.end();
    }
  });

  test('revocation cannot interleave decrypt and still expose answers', async () => {
    const client = createApiClient(baseUrl);
    duringDecrypt = async () => {
      const revoker = new Client({
        connectionString: postgres.connectionString,
      });
      await revoker.connect();
      try {
        await revoker.query("set lock_timeout = '500ms'");
        await expect(
          revoker.query(
            `update identity_access.staff_sessions
                set revoked_at = $1
              where staff_identity_id = $2 and revoked_at is null`,
            [now, clinicianId],
          ),
        ).rejects.toThrow(/lock timeout/);
      } finally {
        await revoker.end();
      }
    };
    try {
      const revealed = await client.POST(
        '/api/v1/clinical/intake-records/current',
        {
          headers: { ...mutationHeaders, cookie: clinicianCookie },
          body: { studentId },
        },
      );
      expect(revealed.response.status).toBe(200);
      expect(revealed.data?.answers).toBeDefined();
      expect(JSON.stringify(revealed.data)).toContain(distinctiveAnswer);
    } finally {
      duringDecrypt = undefined;
    }
  });

  test('freshness expiry, session revocation, and permission loss independently deny later reveals', async () => {
    const client = createApiClient(baseUrl);
    const before = now;

    now = new Date(before.getTime() + 16 * 60 * 1000);
    const staleDirectory = await client.GET(
      '/api/v1/clinical/review-directory',
      { headers: { cookie: clinicianCookie } },
    );
    expect(staleDirectory.response.status).toBe(403);
    expect(staleDirectory.error).toMatchObject({
      code: 'STAFF_AUTHENTICATION_STALE',
    });
    const staleReveal = await client.POST(
      '/api/v1/clinical/intake-records/current',
      {
        headers: { ...mutationHeaders, cookie: clinicianCookie },
        body: { studentId },
      },
    );
    expect(staleReveal.response.status).toBe(403);
    expect(staleReveal.error).toMatchObject({
      code: 'STAFF_AUTHENTICATION_STALE',
    });
    expect(JSON.stringify(staleReveal.error)).not.toContain(distinctiveAnswer);

    now = before;
    const sessionStillValid = await client.GET('/api/v1/staff/session', {
      headers: { cookie: clinicianCookie },
    });
    expect(sessionStillValid.response.status).toBe(200);

    const owner = new Client({ connectionString: postgres.connectionString });
    await owner.connect();
    try {
      await owner.query(
        `delete from identity_access.staff_permission_grants
          where staff_identity_id = $1 and permission = 'clinical'`,
        [clinicianId],
      );
      const permissionLost = await client.POST(
        '/api/v1/clinical/intake-records/current',
        {
          headers: { ...mutationHeaders, cookie: clinicianCookie },
          body: { studentId },
        },
      );
      expect(permissionLost.response.status).toBe(403);
      expect(permissionLost.error).toMatchObject({
        code: 'STAFF_PERMISSION_REQUIRED',
      });
      await owner.query(
        `insert into identity_access.staff_permission_grants
           (workspace_id, staff_identity_id, permission, granted_at, grant_reason,
            record_owner, record_classification, disposal_class)
         values ($1, $2, 'clinical', $3, 'restore clinical grant',
                 'school', 'school_administrative', 'staff_permission_grant')`,
        [workspaceId, clinicianId, now],
      );
    } finally {
      await owner.end();
    }

    const signedOut = await client.POST('/api/v1/auth/staff/sign-out', {
      headers: { origin, 'x-prevcare-csrf': '1', cookie: clinicianCookie },
    });
    expect(signedOut.response.status).toBe(200);
    const afterSignOut = await client.POST(
      '/api/v1/clinical/intake-records/current',
      {
        headers: { ...mutationHeaders, cookie: clinicianCookie },
        body: { studentId },
      },
    );
    expect(afterSignOut.response.status).toBe(401);

    const started = await client.POST('/api/v1/auth/staff/sign-in', {
      headers: { origin, 'x-prevcare-csrf': '1' },
      body: { email: clinicianEmail, password },
    });
    const authenticated = await client.POST('/api/v1/auth/staff/totp', {
      headers: { origin, 'x-prevcare-csrf': '1' },
      body: {
        flowHandle: started.data?.flowHandle ?? '',
        code: totpCode(fakeAuth.totpSecretFor(clinicianEmail)),
      },
    });
    clinicianCookie = authenticated.response.headers
      .get('set-cookie')
      ?.split(';', 1)[0] as string;

    const [first, second] = await Promise.all([
      client.POST('/api/v1/clinical/intake-records/current', {
        headers: { ...mutationHeaders, cookie: clinicianCookie },
        body: { studentId },
      }),
      client.POST('/api/v1/clinical/intake-records/current', {
        headers: { ...mutationHeaders, cookie: clinicianCookie },
        body: { studentId },
      }),
    ]);
    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    expect(first.data?.answers).toEqual(second.data?.answers);

    const inspection = new Client({
      connectionString: postgres.connectionString,
    });
    await inspection.connect();
    try {
      const outcomes = await inspection.query<{ outcome: string }>(
        `select details->>'outcome' as outcome from audit.evidence
          where actor_id = $1
            and event_type in (
              'intake_record.revealed', 'intake_record.reveal_denied'
            )
          order by sequence`,
        [clinicianId],
      );
      expect(outcomes.rows.map((row) => row.outcome)).toEqual([
        'revealed',
        'not_found',
        'failed_projection',
        'failed_decrypt',
        'revealed',
        'denied_stale',
        'denied_permission',
        'denied_session_revoked',
        'revealed',
        'revealed',
      ]);
    } finally {
      await inspection.end();
    }
  });
});
