import { expect, test } from 'bun:test';
import {
  GoldenJourneyDigestMismatchError,
  GoldenJourneyPreflightError,
  runGoldenJourney,
} from '../../packages/golden-journey/src/index.ts';

const commit = 'beda69fca3f7954a0200a3209cb44aac7ade4a72';
const artifactDigest =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const origin = 'https://staging.up.railway.app';
const mailbox = 'controlled@example.test';
const operatorToken = 'operator-token-with-more-than-32-chars';
const releaseId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8101';
const studentId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8102';
const intakeRecordVersionId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8103';
const itemCompletionId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8104';
const itemId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8105';
const fingerprint = 'a'.repeat(64);

const fixtureCandidate = {
  workspace: { branding: { displayName: { 'en-US': { value: 'Synthetic' } } } },
  release: {
    modules: [
      {
        id: itemId,
        title: { 'en-US': { value: 'Module' } },
        knowledgeItems: [],
        skillItems: [],
        applicationItems: [],
      },
    ],
    intakeForm: {
      title: { 'en-US': { value: 'Intake' } },
      sections: [],
      fields: [
        {
          id: 'field-name',
          key: 'name',
          order: 1,
          type: 'text',
          required: true,
          requiredWhenVisible: false,
          visibility: null,
          options: [],
        },
      ],
    },
    submissionAttestation: { text: { 'en-US': { value: 'Notice' } } },
  },
};

function jsonResponse(status: number, body: unknown, cookies: string[] = []) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(cookies.length > 0 ? { 'set-cookie': cookies.join(', ') } : {}),
    },
  });
}

function cookieResponse(status: number, body: unknown, cookie: string) {
  const headers = new Headers({
    'content-type': 'application/json',
    'set-cookie': cookie,
  });
  return new Response(JSON.stringify(body), { status, headers });
}

function intakeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    learningUnlocked: false,
    currentIntakeRecordVersion: null,
    draft: null,
    form: {
      schoolConfigurationReleaseId: releaseId,
      locale: 'en-US',
      intakeForm: {
        resourceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8201',
        revisionNumber: 1,
        title: 'Intake',
        sections: [],
        fields: [
          {
            id: 'field-name',
            revision: 1,
            key: 'name',
            sectionId: 'section-1',
            order: 1,
            type: 'text',
            required: true,
            requiredWhenVisible: false,
            visibility: null,
            options: [],
            label: 'Name',
          },
        ],
      },
      submissionAttestation: {
        resourceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8202',
        revisionNumber: 1,
        text: 'Notice',
      },
    },
    ...overrides,
  };
}

function createFetch() {
  const invitationStatus = new Map<string, string>();
  let studentSessions = 0;
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = new URL(url, origin).pathname;

    if (path === '/health/ready' && method === 'GET') {
      return jsonResponse(200, { status: 'ready' });
    }
    if (path === '/health/build' && method === 'GET') {
      return jsonResponse(200, {
        commit,
        artifactDigest,
        envelopeAdapter: 'application-layer-envelope/v1',
      });
    }
    if (path === '/api/v1/administration/school-workspaces') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        workspaceId: string;
      };
      return jsonResponse(201, {
        operationId: 'op',
        workspaceId: body.workspaceId,
        outcome: 'created',
      });
    }
    if (
      path === '/api/v1/administration/staff-identities' &&
      method === 'POST'
    ) {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        staffIdentityId: string;
      };
      return jsonResponse(201, {
        operationId: 'op',
        staffIdentityId: body.staffIdentityId,
        outcome: 'provisioned',
      });
    }
    if (path === '/api/v1/auth/staff/sign-in') {
      return jsonResponse(200, {
        flowHandle: 'flow',
        flowExpiresAt: '2026-08-25T16:10:00.000Z',
        stage: 'enroll',
        otpauthUri:
          'otpauth://totp/PrevCare?secret=JBSWY3DPEHPK3PXP&issuer=PrevCare',
      });
    }
    if (path === '/api/v1/auth/staff/totp') {
      return cookieResponse(
        200,
        { outcome: 'authenticated' },
        '__Host-prevcare-staff-session=staff-handle; Path=/; HttpOnly; Secure; SameSite=Strict',
      );
    }
    if (path === '/api/v1/staff/session') {
      return jsonResponse(200, {
        staffIdentityId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8002',
        workspaceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8001',
        displayName: 'golden-journey',
        permissions: ['administrative', 'clinical'],
        authenticatedAt: '2026-08-25T16:00:00.000Z',
      });
    }
    if (path === '/api/v1/administration/school-configuration/draft-imports') {
      return jsonResponse(201, {
        draftVersion: 1,
        candidateFingerprint: fingerprint,
        affectedResources: [{ resourceId: 'r1' }],
      });
    }
    if (path === '/api/v1/auth/staff/step-up') {
      return jsonResponse(200, { freshUntil: '2026-08-25T16:15:00.000Z' });
    }
    if (path === '/api/v1/administration/school-configuration/releases') {
      return jsonResponse(201, {
        releaseId,
        package: { format: 'json', digest: 'd'.repeat(64), byteLength: 12 },
      });
    }
    if (path === '/api/v1/administration/classes' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        invitationId: string;
        classId: string;
      };
      invitationStatus.set(body.invitationId, 'pending_delivery');
      return jsonResponse(201, {
        operationId: 'op',
        classId: body.classId,
        invitationId: body.invitationId,
        outcome: 'created',
      });
    }
    if (path === '/api/v1/administration/classes' && method === 'GET') {
      return jsonResponse(200, {
        classes: [...invitationStatus.entries()].map(
          ([invitationId, status], index) => ({
            classId: `018f1f5e-7b76-7f70-8f4d-9dc17ecf83${String(index).padStart(2, '0')}`,
            name: 'golden',
            createdAt: '2026-08-25T16:00:00.000Z',
            invitations: [
              {
                invitationId,
                purpose: 'join_class',
                generation: 1,
                status: status === 'pending_delivery' ? 'delivered' : status,
                expiresAt: '2026-08-25T16:10:00.000Z',
              },
            ],
          }),
        ),
      });
    }
    if (path === '/api/v1/auth/student/invitations/redeem') {
      studentSessions += 1;
      const handle =
        studentSessions === 1 ? 'student-handle' : 'student-handle-fresh';
      return cookieResponse(
        200,
        { outcome: 'authenticated' },
        `__Host-prevcare-student-session=${handle}; Path=/; HttpOnly; Secure; SameSite=Strict`,
      );
    }
    if (path === '/api/v1/student/session') {
      return jsonResponse(200, {
        studentId,
        workspaceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8001',
        activeClassMemberships: [{ classId: 'c1', name: 'golden' }],
      });
    }
    if (path === '/api/v1/student/intake' && method === 'GET') {
      const cookie = new Headers(init?.headers).get('cookie') ?? '';
      const restored = cookie.includes('student-handle-fresh');
      return jsonResponse(
        200,
        intakeSnapshot({
          learningUnlocked: restored,
          currentIntakeRecordVersion: restored
            ? {
                intakeRecordVersionId,
                acceptedAt: '2026-08-25T16:05:00.000Z',
                locale: 'en-US',
              }
            : null,
        }),
      );
    }
    if (path === '/api/v1/student/intake/draft') {
      return jsonResponse(200, {
        locale: 'en-US',
        updatedAt: '2026-08-25T16:04:00.000Z',
      });
    }
    if (path === '/api/v1/student/intake/submissions') {
      return jsonResponse(201, {
        operationId: 'op',
        intakeRecordVersionId,
        acceptedAt: '2026-08-25T16:05:00.000Z',
        replayed: false,
      });
    }
    if (path === '/api/v1/student/learning' && method === 'GET') {
      const cookie = new Headers(init?.headers).get('cookie') ?? '';
      const restored = cookie.includes('student-handle-fresh');
      return jsonResponse(200, {
        learningUnlocked: true,
        schoolConfigurationReleaseId: releaseId,
        locale: 'en-US',
        item: restored
          ? null
          : {
              itemId,
              revisionNumber: 1,
              kind: 'knowledge',
              text: 'A learning item',
              moduleTitle: 'Module',
            },
        completion: restored
          ? {
              itemCompletionId,
              itemId,
              revisionNumber: 1,
              schoolConfigurationReleaseId: releaseId,
              completedAt: '2026-08-25T16:06:00.000Z',
            }
          : null,
      });
    }
    if (path === '/api/v1/student/learning/acknowledgements') {
      return jsonResponse(201, {
        operationId: 'op',
        itemCompletionId,
        itemId,
        revisionNumber: 1,
        schoolConfigurationReleaseId: releaseId,
        completedAt: '2026-08-25T16:06:00.000Z',
        replayed: false,
      });
    }
    if (path === '/api/v1/clinical/review-directory') {
      return jsonResponse(200, {
        freshUntil: '2026-08-25T16:15:00.000Z',
        students: [
          {
            studentId,
            createdAt: '2026-08-25T16:03:00.000Z',
            currentIntakeRecordVersion: {
              intakeRecordVersionId,
              acceptedAt: '2026-08-25T16:05:00.000Z',
              locale: 'en-US',
            },
          },
        ],
      });
    }
    if (path === '/api/v1/clinical/intake-records/current') {
      return jsonResponse(200, {
        studentId,
        intakeRecordVersionId,
        acceptedAt: '2026-08-25T16:05:00.000Z',
        schoolConfigurationReleaseId: releaseId,
        locale: 'en-US',
        intakeForm: intakeSnapshot().form.intakeForm,
        answers: { 'field-name': 'UNIQUE-ANSWER-TOKEN' },
        freshUntil: '2026-08-25T16:15:00.000Z',
      });
    }
    return jsonResponse(404, { code: 'NOT_FOUND' });
  };
}

function journeyInput(overrides: Record<string, unknown> = {}) {
  let invitationReads = 0;
  return {
    environment: {
      STAGING_WEB_URL: origin,
      EXPECTED_COMMIT: commit,
      EXPECTED_GIT_TREE: '89abcdef0123456789abcdef0123456789abcdef',
      OPERATOR_PROVISIONING_TOKEN: operatorToken,
      INVITATION_CONTROLLED_MAILBOX: mailbox,
      DATABASE_URL:
        'postgresql://runtime:secret@db.project-ref.supabase.co/app',
      DATABASE_CA_CERT:
        '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
      SUPABASE_PROJECT_REF: 'project-ref',
      SUPABASE_URL: 'https://project-ref.supabase.co',
      SUPABASE_SECRET_KEY: 'supabase-secret',
      SUPABASE_STORAGE_BUCKET: 'private-records',
      SUPABASE_QUEUE_NAME: 'provider-smoke',
      SUPABASE_CRON_JOB_NAME: 'provider-smoke',
      RESEND_API_KEY: 're-secret',
      PROVIDER_SMOKE_EMAIL: 'smoke@example.test',
      PROVIDER_SMOKE_EMAIL_FROM: 'Staging <sender@example.test>',
      PROVIDER_SMOKE_AUTH_EMAIL: 'auth-smoke@example.test',
      PROVIDER_SMOKE_AUTH_PASSWORD: 'auth-smoke-password',
      PROVIDER_SMOKE_AUTH_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
    },
    expectedSource: { commit, artifactDigest },
    fixtureCandidate,
    clock: { now: () => new Date('2026-08-25T16:00:00.000Z') },
    sleep: async () => undefined,
    fetch: createFetch(),
    checkProviders: async () =>
      ['postgres', 'auth', 'storage', 'queue', 'cron', 'email'].map((name) => ({
        name,
        status: 'ok' as const,
        durationMs: 1,
      })),
    mailbox: {
      list: async () => [],
      read: async () => ({
        id: 'unused',
        text: 'Your Invitation Code is 000000. It expires in 10 minutes.',
        to: [mailbox],
      }),
    },
    waitForInvitationCode: async () => {
      invitationReads += 1;
      return invitationReads === 1 ? '729104' : '456789';
    },
    runBrowser: async () => ({
      keyboard: 'pass' as const,
      focus: 'pass' as const,
      announcements: 'pass' as const,
      contrast: 'pass' as const,
      zoomReflow: 'pass' as const,
      responsive: 'pass' as const,
      multilingualLayout: 'pass' as const,
    }),
    ids: {
      runId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8000',
      workspaceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8001',
      staffIdentityId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8002',
      classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8003',
      invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8004',
      restorationClassId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8013',
      restorationInvitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8005',
      operationIds: {
        workspace: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8301',
        staff: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8302',
        importDraft: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8303',
        publish: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8304',
        invitation: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8305',
        restorationInvitation: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8306',
        intake: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8307',
        learning: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8308',
      },
    },
    staffPassword: 'generated-staff-password-32-chars',
    ...overrides,
  };
}

test('synthetic journey covers the HTTP golden path and redacts clinical content', async () => {
  const evidence = await runGoldenJourney(journeyInput());

  expect(evidence.coverage).toMatchObject({
    staffAuth: 'pass',
    staffFreshness: 'pass',
    releasePublication: 'pass',
    classInvitation: 'pass',
    emailDelivery: 'pass',
    invitationRedemption: 'pass',
    intakeDraft: 'pass',
    intakeSubmission: 'pass',
    learningAcknowledgement: 'pass',
    clinicalDirectory: 'pass',
    clinicalReveal: 'pass',
    freshBrowserRestoration: 'pass',
  });
  expect(evidence.syntheticIdentifiers.releaseId).toBe(releaseId);
  expect(evidence.syntheticIdentifiers.studentId).toBe(studentId);
  expect(evidence.syntheticIdentifiers.intakeRecordVersionId).toBe(
    intakeRecordVersionId,
  );
  expect(evidence.syntheticIdentifiers.itemCompletionId).toBe(itemCompletionId);
  expect(JSON.stringify(evidence)).not.toContain('UNIQUE-ANSWER-TOKEN');
  expect(JSON.stringify(evidence)).not.toContain('729104');
  expect(JSON.stringify(evidence)).not.toContain('staff-handle');
  expect(JSON.stringify(evidence)).not.toContain(mailbox);
  expect(JSON.stringify(evidence)).not.toContain('generated-staff-password');
  expect(JSON.stringify(evidence)).not.toContain('JBSWY3DPEHPK3PXP');
  expect(JSON.stringify(evidence)).not.toContain('A learning item');
});

test('journey fails closed on preflight before touching HTTP', async () => {
  const fetchCalls: string[] = [];
  await expect(
    runGoldenJourney(
      journeyInput({
        environment: { STAGING_WEB_URL: origin },
        fetch: async (input: string | URL | Request) => {
          fetchCalls.push(String(input));
          return new Response('{}');
        },
      }),
    ),
  ).rejects.toThrow(GoldenJourneyPreflightError);
  expect(fetchCalls).toEqual([]);
});

test('journey fails closed when the deployed digest differs', async () => {
  await expect(
    runGoldenJourney(
      journeyInput({
        fetch: async (input: string | URL | Request) => {
          const path = new URL(String(input), origin).pathname;
          if (path === '/health/ready') {
            return jsonResponse(200, { status: 'ready' });
          }
          if (path === '/health/build') {
            return jsonResponse(200, {
              commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              artifactDigest,
              envelopeAdapter: 'application-layer-envelope/v1',
            });
          }
          throw new Error(`unexpected ${path}`);
        },
        checkProviders: async () => [],
      }),
    ),
  ).rejects.toThrow(GoldenJourneyDigestMismatchError);
});
