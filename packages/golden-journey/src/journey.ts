import { APPLICATION_LAYER_ENVELOPE_V1 } from '../../application-keys/src/index.ts';
import { totpCode } from '../../supabase-auth/src/index.ts';
import type { BrowserAssertionOutcomes } from './browser-assertions.ts';
import { environmentHostFromOrigin } from './configuration.ts';
import {
  assertDeployedSourceIdentity,
  artifactDigestForGitTree,
  type ExpectedSourceIdentity,
} from './digest.ts';
import {
  createGoldenJourneyEvidence,
  type GoldenJourneyEvidence,
} from './evidence.ts';
import {
  CookieJar,
  createOriginFetch,
  isRecord,
  readJson,
  type GoldenJourneyFetch,
} from './http.ts';
import { completeSyntheticIntakeAnswers } from './intake-answers.ts';
import { waitForInvitationCode, type InvitationMailbox } from './mailbox.ts';
import {
  GoldenJourneyPreflightError,
  reportGoldenJourneyPreflight,
} from './preflight.ts';
import { NonRetryableGoldenJourneyError, retryTransient } from './retry.ts';
import { createGoldenJourneyState } from './state.ts';

export type GoldenJourneyIds = {
  runId: string;
  workspaceId: string;
  staffIdentityId: string;
  classId: string;
  invitationId: string;
  restorationClassId: string;
  restorationInvitationId: string;
  operationIds: {
    workspace: string;
    staff: string;
    importDraft: string;
    publish: string;
    invitation: string;
    restorationInvitation: string;
    intake: string;
    learning: string;
  };
};

export type GoldenJourneyRunInput = {
  environment: Record<string, string | undefined>;
  expectedSource: ExpectedSourceIdentity;
  fixtureCandidate: unknown;
  clock: { now(): Date };
  sleep: (ms: number) => Promise<void>;
  fetch: GoldenJourneyFetch;
  checkProviders: () => Promise<
    readonly { name: string; status: 'error' | 'ok'; durationMs: number }[]
  >;
  mailbox: InvitationMailbox;
  waitForInvitationCode?: typeof waitForInvitationCode;
  runBrowser: (input: {
    origin: string;
    staffCookie?: string;
    studentCookie?: string;
  }) => Promise<BrowserAssertionOutcomes>;
  ids: GoldenJourneyIds;
  staffPassword: string;
};

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NonRetryableGoldenJourneyError(`${label} was not returned`);
  }
  return value;
}

function requireUuidField(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      text,
    )
  ) {
    throw new NonRetryableGoldenJourneyError(`${label} was not returned`);
  }
  return text;
}

function totpSecretFromOtpauth(uri: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new NonRetryableGoldenJourneyError('TOTP enrollment failed');
  }
  const secret = parsed.searchParams.get('secret');
  if (!secret)
    throw new NonRetryableGoldenJourneyError('TOTP enrollment failed');
  return secret;
}

function problemCode(body: unknown): string | undefined {
  return isRecord(body) && typeof body.code === 'string'
    ? body.code
    : undefined;
}

async function requestJson(
  request: GoldenJourneyFetch,
  url: string,
  init: RequestInit,
  allowed: readonly number[],
): Promise<{ status: number; body: unknown }> {
  const response = await request(url, init);
  const body = await readJson(response);
  if (!allowed.includes(response.status)) {
    const retryable = response.status >= 500;
    const error = new Error(`HTTP ${response.status}`);
    (error as Error & { retryable?: boolean }).retryable = retryable;
    if (!retryable) {
      throw new NonRetryableGoldenJourneyError(
        problemCode(body) ?? `HTTP ${response.status}`,
      );
    }
    throw error;
  }
  return { status: response.status, body };
}

async function waitForDeliveredInvitation(options: {
  request: GoldenJourneyFetch;
  origin: string;
  invitationId: string;
  sleep: (ms: number) => Promise<void>;
}): Promise<void> {
  await retryTransient(
    async () => {
      const listing = await requestJson(
        options.request,
        `${options.origin}/api/v1/administration/classes`,
        { method: 'GET' },
        [200],
      );
      if (!isRecord(listing.body) || !Array.isArray(listing.body.classes)) {
        throw new NonRetryableGoldenJourneyError(
          'Class directory was malformed',
        );
      }
      const invitation = listing.body.classes
        .flatMap((entry) =>
          isRecord(entry) && Array.isArray(entry.invitations)
            ? entry.invitations
            : [],
        )
        .find(
          (entry) =>
            isRecord(entry) && entry.invitationId === options.invitationId,
        );
      if (!isRecord(invitation)) {
        throw new Error('Invitation delivery has not completed');
      }
      if (invitation.status === 'delivery_failed') {
        throw new NonRetryableGoldenJourneyError('Invitation delivery failed');
      }
      if (
        invitation.status !== 'delivered' &&
        invitation.status !== 'completed'
      ) {
        throw new Error('Invitation delivery has not completed');
      }
    },
    { attempts: 20, delayMs: 1_000, sleep: options.sleep },
  );
}

export async function runGoldenJourney(
  input: GoldenJourneyRunInput,
): Promise<GoldenJourneyEvidence> {
  const state = createGoldenJourneyState();
  const startedAt = input.clock.now();
  try {
    const preflight = reportGoldenJourneyPreflight(input.environment, {
      failClosed: true,
    });
    if (!preflight.ok)
      throw new GoldenJourneyPreflightError(preflight.missingNames);
    state.advance('preflighted');

    const origin = new URL(
      requireString(input.environment.STAGING_WEB_URL, 'STAGING_WEB_URL'),
    ).origin;
    const mailbox = requireString(
      input.environment.INVITATION_CONTROLLED_MAILBOX,
      'INVITATION_CONTROLLED_MAILBOX',
    );
    const operatorToken = requireString(
      input.environment.OPERATOR_PROVISIONING_TOKEN,
      'OPERATOR_PROVISIONING_TOKEN',
    );
    const expectedTree = requireString(
      input.environment.EXPECTED_GIT_TREE,
      'EXPECTED_GIT_TREE',
    );
    const expectedSource = {
      commit: input.expectedSource.commit,
      artifactDigest:
        input.expectedSource.artifactDigest ||
        artifactDigestForGitTree(expectedTree),
    };

    const anonymous = new CookieJar();
    const staffJar = new CookieJar();
    const studentJar = new CookieJar();
    const restoredJar = new CookieJar();
    const anonymousFetch = createOriginFetch({
      origin,
      fetch: input.fetch,
      jar: anonymous,
    });
    const operatorFetch = createOriginFetch({
      origin,
      fetch: input.fetch,
      jar: anonymous,
      authorization: `Bearer ${operatorToken}`,
    });
    const staffFetch = createOriginFetch({
      origin,
      fetch: input.fetch,
      jar: staffJar,
    });
    const studentFetch = createOriginFetch({
      origin,
      fetch: input.fetch,
      jar: studentJar,
    });
    const restoredFetch = createOriginFetch({
      origin,
      fetch: input.fetch,
      jar: restoredJar,
    });

    const ready = await requestJson(
      anonymousFetch,
      `${origin}/health/ready`,
      { method: 'GET' },
      [200],
    );
    if (!isRecord(ready.body) || ready.body.status !== 'ready') {
      throw new NonRetryableGoldenJourneyError(
        'Railway public process is not ready',
      );
    }
    const build = await requestJson(
      anonymousFetch,
      `${origin}/health/build`,
      { method: 'GET' },
      [200],
    );
    if (
      !isRecord(build.body) ||
      typeof build.body.commit !== 'string' ||
      typeof build.body.artifactDigest !== 'string' ||
      typeof build.body.envelopeAdapter !== 'string'
    ) {
      throw new NonRetryableGoldenJourneyError(
        'Deployed build identity is unavailable',
      );
    }
    assertDeployedSourceIdentity(
      {
        commit: build.body.commit,
        artifactDigest: build.body.artifactDigest,
        envelopeAdapter: build.body.envelopeAdapter,
      },
      expectedSource,
    );
    if (build.body.envelopeAdapter !== APPLICATION_LAYER_ENVELOPE_V1) {
      throw new NonRetryableGoldenJourneyError(
        'Deployed process is not using the selected envelope adapter',
      );
    }

    const providers = await input.checkProviders();
    if (
      providers.some(({ status }) => status !== 'ok') ||
      !['postgres', 'auth', 'storage', 'queue', 'cron', 'email'].every((name) =>
        providers.some((entry) => entry.name === name && entry.status === 'ok'),
      )
    ) {
      throw new NonRetryableGoldenJourneyError('Provider smoke checks failed');
    }
    state.advance('gated');

    const marker = `golden-journey/${input.ids.runId}`;
    const staffEmail = `g${input.ids.runId.replaceAll('-', '')}@example.test`;
    await requestJson(
      operatorFetch,
      `${origin}/api/v1/administration/school-workspaces`,
      {
        method: 'POST',
        body: JSON.stringify({
          operationId: input.ids.operationIds.workspace,
          workspaceId: input.ids.workspaceId,
          displayName: marker,
        }),
      },
      [201],
    );
    await requestJson(
      operatorFetch,
      `${origin}/api/v1/administration/staff-identities`,
      {
        method: 'POST',
        body: JSON.stringify({
          operationId: input.ids.operationIds.staff,
          workspaceId: input.ids.workspaceId,
          staffIdentityId: input.ids.staffIdentityId,
          displayName: marker,
          email: staffEmail,
          permissions: ['administrative', 'clinical'],
          schoolApprover: 'golden-journey-operator',
          reason: marker,
          initialPassword: input.staffPassword,
        }),
      },
      [201],
    );

    const started = await requestJson(
      anonymousFetch,
      `${origin}/api/v1/auth/staff/sign-in`,
      {
        method: 'POST',
        body: JSON.stringify({
          email: staffEmail,
          password: input.staffPassword,
        }),
      },
      [200],
    );
    if (
      !isRecord(started.body) ||
      typeof started.body.flowHandle !== 'string' ||
      typeof started.body.otpauthUri !== 'string'
    ) {
      throw new NonRetryableGoldenJourneyError('Staff authentication failed');
    }
    const totpSecret = totpSecretFromOtpauth(started.body.otpauthUri);
    await requestJson(
      staffFetch,
      `${origin}/api/v1/auth/staff/totp`,
      {
        method: 'POST',
        body: JSON.stringify({
          flowHandle: started.body.flowHandle,
          code: totpCode(totpSecret),
        }),
      },
      [200],
    );
    const session = await requestJson(
      staffFetch,
      `${origin}/api/v1/staff/session`,
      { method: 'GET' },
      [200],
    );
    if (
      !isRecord(session.body) ||
      !Array.isArray(session.body.permissions) ||
      !session.body.permissions.includes('administrative') ||
      !session.body.permissions.includes('clinical')
    ) {
      throw new NonRetryableGoldenJourneyError('Staff session is incomplete');
    }
    state.advance('staff_authenticated');

    const imported = await requestJson(
      staffFetch,
      `${origin}/api/v1/administration/school-configuration/draft-imports`,
      {
        method: 'POST',
        body: JSON.stringify({
          operationId: input.ids.operationIds.importDraft,
          expectedDraftVersion: 0,
          candidate: input.fixtureCandidate,
        }),
      },
      [201],
    );
    const candidateFingerprint = requireString(
      isRecord(imported.body) ? imported.body.candidateFingerprint : undefined,
      'candidateFingerprint',
    );
    const draftVersion = isRecord(imported.body)
      ? imported.body.draftVersion
      : undefined;
    if (typeof draftVersion !== 'number') {
      throw new NonRetryableGoldenJourneyError('Draft import failed');
    }
    await requestJson(
      staffFetch,
      `${origin}/api/v1/auth/staff/step-up`,
      {
        method: 'POST',
        body: JSON.stringify({
          password: input.staffPassword,
          totp: totpCode(totpSecret),
        }),
      },
      [200],
    );
    const published = await requestJson(
      staffFetch,
      `${origin}/api/v1/administration/school-configuration/releases`,
      {
        method: 'POST',
        body: JSON.stringify({
          operationId: input.ids.operationIds.publish,
          expectedActiveReleaseId: null,
          expectedDraftVersion: draftVersion,
          candidateFingerprint,
          changeDescription: marker,
        }),
      },
      [201],
    );
    const releaseId = requireUuidField(
      isRecord(published.body) ? published.body.releaseId : undefined,
      'releaseId',
    );
    state.advance('release_published');

    const created = await requestJson(
      staffFetch,
      `${origin}/api/v1/administration/classes`,
      {
        method: 'POST',
        body: JSON.stringify({
          operationId: input.ids.operationIds.invitation,
          classId: input.ids.classId,
          invitationId: input.ids.invitationId,
          name: marker,
          recipient: mailbox,
        }),
      },
      [201],
    );
    if (!isRecord(created.body) || created.body.outcome !== 'created') {
      throw new NonRetryableGoldenJourneyError('Class invitation failed');
    }
    state.advance('invitation_created');

    const invitationSentAt = input.clock.now();
    await waitForDeliveredInvitation({
      request: staffFetch,
      origin,
      invitationId: input.ids.invitationId,
      sleep: input.sleep,
    });
    const readInvitationCode =
      input.waitForInvitationCode ?? waitForInvitationCode;
    const invitationCode = await readInvitationCode(input.mailbox, {
      since: invitationSentAt,
      attempts: 20,
      sleep: input.sleep,
      delayMs: 1_000,
    });
    state.advance('invitation_delivered');

    await requestJson(
      studentFetch,
      `${origin}/api/v1/auth/student/invitations/redeem`,
      {
        method: 'POST',
        body: JSON.stringify({ recipient: mailbox, code: invitationCode }),
      },
      [200],
    );
    const studentSession = await requestJson(
      studentFetch,
      `${origin}/api/v1/student/session`,
      { method: 'GET' },
      [200],
    );
    const studentId = requireUuidField(
      isRecord(studentSession.body) ? studentSession.body.studentId : undefined,
      'studentId',
    );
    state.advance('invitation_redeemed');

    const intake = await requestJson(
      studentFetch,
      `${origin}/api/v1/student/intake?locale=en-US`,
      { method: 'GET' },
      [200],
    );
    if (!isRecord(intake.body) || !isRecord(intake.body.form)) {
      throw new NonRetryableGoldenJourneyError(
        'Intake snapshot is unavailable',
      );
    }
    const form = intake.body.form;
    if (
      !isRecord(form.intakeForm) ||
      !Array.isArray(form.intakeForm.fields) ||
      !isRecord(form.submissionAttestation)
    ) {
      throw new NonRetryableGoldenJourneyError(
        'Intake snapshot is unavailable',
      );
    }
    const answers = completeSyntheticIntakeAnswers(
      form.intakeForm.fields as Parameters<
        typeof completeSyntheticIntakeAnswers
      >[0],
    );
    await requestJson(
      studentFetch,
      `${origin}/api/v1/student/intake/draft`,
      {
        method: 'PUT',
        body: JSON.stringify({
          expectedSchoolConfigurationReleaseId:
            form.schoolConfigurationReleaseId,
          expectedIntakeForm: {
            resourceId: form.intakeForm.resourceId,
            revisionNumber: form.intakeForm.revisionNumber,
          },
          locale: 'en-US',
          answers,
        }),
      },
      [200],
    );
    state.advance('intake_drafted');

    const submitted = await requestJson(
      studentFetch,
      `${origin}/api/v1/student/intake/submissions`,
      {
        method: 'POST',
        body: JSON.stringify({
          operationId: input.ids.operationIds.intake,
          expectedSchoolConfigurationReleaseId:
            form.schoolConfigurationReleaseId,
          expectedIntakeForm: {
            resourceId: form.intakeForm.resourceId,
            revisionNumber: form.intakeForm.revisionNumber,
          },
          expectedSubmissionAttestation: {
            resourceId: form.submissionAttestation.resourceId,
            revisionNumber: form.submissionAttestation.revisionNumber,
          },
          locale: 'en-US',
          answers,
          attestation: {
            locale: 'en-US',
            notice: {
              resourceId: form.submissionAttestation.resourceId,
              revisionNumber: form.submissionAttestation.revisionNumber,
            },
          },
        }),
      },
      [201],
    );
    const intakeRecordVersionId = requireUuidField(
      isRecord(submitted.body)
        ? submitted.body.intakeRecordVersionId
        : undefined,
      'intakeRecordVersionId',
    );
    state.advance('intake_submitted');

    const learning = await requestJson(
      studentFetch,
      `${origin}/api/v1/student/learning?locale=en-US`,
      { method: 'GET' },
      [200],
    );
    if (
      !isRecord(learning.body) ||
      learning.body.learningUnlocked !== true ||
      !isRecord(learning.body.item)
    ) {
      throw new NonRetryableGoldenJourneyError('Learning is locked');
    }
    const acknowledged = await requestJson(
      studentFetch,
      `${origin}/api/v1/student/learning/acknowledgements`,
      {
        method: 'POST',
        body: JSON.stringify({
          operationId: input.ids.operationIds.learning,
          expectedSchoolConfigurationReleaseId:
            learning.body.schoolConfigurationReleaseId,
          itemId: learning.body.item.itemId,
          revisionNumber: learning.body.item.revisionNumber,
        }),
      },
      [201],
    );
    const itemCompletionId = requireUuidField(
      isRecord(acknowledged.body)
        ? acknowledged.body.itemCompletionId
        : undefined,
      'itemCompletionId',
    );
    state.advance('learning_acknowledged');

    const directory = await requestJson(
      staffFetch,
      `${origin}/api/v1/clinical/review-directory`,
      { method: 'GET' },
      [200],
    );
    if (
      !isRecord(directory.body) ||
      !Array.isArray(directory.body.students) ||
      !directory.body.students.some(
        (entry) => isRecord(entry) && entry.studentId === studentId,
      )
    ) {
      throw new NonRetryableGoldenJourneyError(
        'Clinical directory is incomplete',
      );
    }
    const revealed = await requestJson(
      staffFetch,
      `${origin}/api/v1/clinical/intake-records/current`,
      {
        method: 'POST',
        body: JSON.stringify({ studentId }),
      },
      [200],
    );
    if (
      !isRecord(revealed.body) ||
      revealed.body.studentId !== studentId ||
      revealed.body.intakeRecordVersionId !== intakeRecordVersionId ||
      !isRecord(revealed.body.answers) ||
      Object.keys(revealed.body.answers).length === 0
    ) {
      throw new NonRetryableGoldenJourneyError('Clinical reveal failed');
    }
    delete revealed.body.answers;
    delete revealed.body.intakeForm;
    state.advance('clinical_revealed');

    await requestJson(
      staffFetch,
      `${origin}/api/v1/administration/classes`,
      {
        method: 'POST',
        body: JSON.stringify({
          operationId: input.ids.operationIds.restorationInvitation,
          classId: input.ids.restorationClassId,
          invitationId: input.ids.restorationInvitationId,
          name: `${marker}-restore`,
          recipient: mailbox,
        }),
      },
      [201],
    );
    const restorationSentAt = input.clock.now();
    await waitForDeliveredInvitation({
      request: staffFetch,
      origin,
      invitationId: input.ids.restorationInvitationId,
      sleep: input.sleep,
    });
    const restorationCode = await readInvitationCode(input.mailbox, {
      since: restorationSentAt,
      attempts: 20,
      sleep: input.sleep,
      delayMs: 1_000,
    });
    await requestJson(
      restoredFetch,
      `${origin}/api/v1/auth/student/invitations/redeem`,
      {
        method: 'POST',
        body: JSON.stringify({ recipient: mailbox, code: restorationCode }),
      },
      [200],
    );
    const restoredSession = await requestJson(
      restoredFetch,
      `${origin}/api/v1/student/session`,
      { method: 'GET' },
      [200],
    );
    const restoredIntake = await requestJson(
      restoredFetch,
      `${origin}/api/v1/student/intake?locale=en-US`,
      { method: 'GET' },
      [200],
    );
    const restoredLearning = await requestJson(
      restoredFetch,
      `${origin}/api/v1/student/learning?locale=en-US`,
      { method: 'GET' },
      [200],
    );
    if (
      !isRecord(restoredSession.body) ||
      restoredSession.body.studentId !== studentId ||
      !isRecord(restoredIntake.body) ||
      restoredIntake.body.learningUnlocked !== true ||
      !isRecord(restoredLearning.body) ||
      !isRecord(restoredLearning.body.completion) ||
      restoredLearning.body.completion.itemCompletionId !== itemCompletionId
    ) {
      throw new NonRetryableGoldenJourneyError(
        'Fresh-browser Student restoration failed',
      );
    }
    state.advance('student_restored');

    const browser = await input.runBrowser({
      origin,
      staffCookie: staffJar.header(),
      studentCookie: studentJar.header(),
    });
    if (
      browser.keyboard !== 'pass' ||
      browser.focus !== 'pass' ||
      browser.announcements !== 'pass' ||
      browser.contrast !== 'pass' ||
      browser.zoomReflow !== 'pass' ||
      browser.responsive !== 'pass' ||
      browser.multilingualLayout !== 'pass'
    ) {
      throw new NonRetryableGoldenJourneyError('Browser assertions failed');
    }
    state.advance('browser_checked');
    state.advance('completed');

    return createGoldenJourneyEvidence({
      environment: 'staging',
      environmentHost: environmentHostFromOrigin(origin),
      commit: expectedSource.commit,
      artifactDigest: expectedSource.artifactDigest,
      envelopeAdapter: APPLICATION_LAYER_ENVELOPE_V1,
      runId: input.ids.runId,
      startedAt: startedAt.toISOString(),
      completedAt: input.clock.now().toISOString(),
      syntheticIdentifiers: {
        workspaceId: input.ids.workspaceId,
        staffIdentityId: input.ids.staffIdentityId,
        classId: input.ids.classId,
        invitationId: input.ids.invitationId,
        restorationInvitationId: input.ids.restorationInvitationId,
        releaseId,
        studentId,
        intakeRecordVersionId,
        itemCompletionId,
      },
      coverage: {
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
        ...browser,
      },
      providerContracts: [
        ...providers.map((entry) => ({
          name: entry.name as
            'postgres' | 'auth' | 'storage' | 'queue' | 'cron' | 'email',
          status: 'ok' as const,
        })),
        { name: 'envelope', status: 'ok' },
        { name: 'railway-public', status: 'ok' },
        { name: 'invitation-worker', status: 'ok' },
      ],
    });
  } catch (error) {
    if (state.step() !== 'failed' && state.step() !== 'completed') {
      state.fail();
    }
    throw error;
  }
}
