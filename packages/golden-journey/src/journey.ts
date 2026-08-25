import { APPLICATION_LAYER_ENVELOPE_V1 } from '../../application-keys/src/index.ts';
import { totpCode } from '../../supabase-auth/src/index.ts';
import type { BrowserAssertionOutcomes } from './browser-assertions.ts';
import { cleanupEphemeralAuthUsers } from './cleanup.ts';
import type { EphemeralAuthIdentity } from './cleanup.ts';
import {
  assertExactSubmittedAnswers,
  discardClinicalRevealAnswers,
} from './clinical-answers.ts';
import { environmentHostFromOrigin } from './configuration.ts';
import {
  assertDeployedSourceIdentity,
  assertWorkerArtifactDigest,
  isTimestampWithinRun,
  GoldenJourneyDigestMismatchError,
  type ExpectedSourceIdentity,
} from './digest.ts';
import type { GoldenJourneyErrorCode } from './error-codes.ts';
import { isGoldenJourneyErrorCode } from './error-codes.ts';
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
import {
  captureInvitationMailboxBaseline,
  normalizeMailboxRecipient,
  waitForInvitationCode,
  type InvitationMailbox,
  type ObservedInvitationMail,
} from './mailbox.ts';
import { parseGoldenJourneyOperatorEvidence } from './operator-evidence.ts';
import {
  GoldenJourneyPreflightError,
  reportGoldenJourneyPreflight,
} from './preflight.ts';
import {
  assertStableReplay,
  invitationReplayFields,
  intakeReplayFields,
  learningReplayFields,
  publishReplayFields,
} from './replay.ts';
import { NonRetryableGoldenJourneyError, retryTransient } from './retry.ts';
import { createGoldenJourneyState, type GoldenJourneyStep } from './state.ts';

export class GoldenJourneyRunError extends Error {
  readonly code: GoldenJourneyErrorCode;
  readonly lastCompletedStep: GoldenJourneyStep;
  readonly authCleanup: 'completed' | 'not-attempted' | 'failed';

  constructor(
    code: GoldenJourneyErrorCode,
    lastCompletedStep: GoldenJourneyStep,
    authCleanup: 'completed' | 'not-attempted' | 'failed' = 'not-attempted',
  ) {
    super('Golden journey failed');
    this.name = 'GoldenJourneyRunError';
    this.code = code;
    this.lastCompletedStep = lastCompletedStep;
    this.authCleanup = authCleanup;
  }
}

export type GoldenJourneyIds = {
  runId: string;
  workspaceId: string;
  staffIdentityId: string;
  classId: string;
  invitationId: string;
  restorationClassId: string;
  restorationInvitationId: string;
  isolationWorkspaceId: string;
  isolationStaffIdentityId: string;
  operationIds: {
    workspace: string;
    staff: string;
    importDraft: string;
    publish: string;
    invitation: string;
    restorationInvitation: string;
    intake: string;
    learning: string;
    isolationWorkspace: string;
    isolationStaff: string;
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
  captureInvitationMailboxBaseline?: typeof captureInvitationMailboxBaseline;
  runBrowser: (input: {
    origin: string;
    staffCookie?: string;
    studentCookie?: string;
    studentId: string;
  }) => Promise<BrowserAssertionOutcomes>;
  ids: GoldenJourneyIds;
  staffPassword: string;
  isolationStaffPassword: string;
  cleanupAuthUsers?: typeof cleanupEphemeralAuthUsers;
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

function candidateForWorkspace(
  candidate: unknown,
  workspaceId: string,
): unknown {
  if (!isRecord(candidate) || !isRecord(candidate.workspace)) {
    throw new NonRetryableGoldenJourneyError(
      'School Configuration fixture is malformed',
      'RELEASE_PUBLISH_FAILED',
    );
  }
  return {
    ...candidate,
    workspace: { ...candidate.workspace, id: workspaceId },
  };
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

function mapJourneyError(error: unknown): GoldenJourneyErrorCode {
  if (error instanceof GoldenJourneyPreflightError) return error.code;
  if (error instanceof GoldenJourneyDigestMismatchError) return error.code;
  if (error instanceof NonRetryableGoldenJourneyError) {
    return isGoldenJourneyErrorCode(error.code)
      ? error.code
      : 'UNEXPECTED_FAILURE';
  }
  if (
    error instanceof Error &&
    error.message === 'Invitation delivery was not observed'
  ) {
    return 'MAILBOX_UNOBSERVED';
  }
  return 'UNEXPECTED_FAILURE';
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
  const ephemeralIdentities: EphemeralAuthIdentity[] = [];
  let authCleanup: 'completed' | 'not-attempted' | 'failed' = 'not-attempted';
  const cleanupAuth = input.cleanupAuthUsers ?? cleanupEphemeralAuthUsers;
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
    const expectedSource = input.expectedSource;

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
      typeof build.body.tree !== 'string' ||
      typeof build.body.sourceDigest !== 'string' ||
      typeof build.body.browserDigest !== 'string' ||
      typeof build.body.lockDigest !== 'string' ||
      typeof build.body.dependencyDigest !== 'string' ||
      typeof build.body.bunVersion !== 'string' ||
      typeof build.body.artifactDigest !== 'string' ||
      typeof build.body.envelopeAdapter !== 'string'
    ) {
      throw new NonRetryableGoldenJourneyError(
        'Deployed build identity is unavailable',
        'DIGEST_MISMATCH',
      );
    }
    assertDeployedSourceIdentity(
      {
        commit: build.body.commit,
        tree: build.body.tree,
        sourceDigest: build.body.sourceDigest,
        browserDigest: build.body.browserDigest,
        lockDigest: build.body.lockDigest,
        dependencyDigest: build.body.dependencyDigest,
        bunVersion: build.body.bunVersion,
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
      throw new NonRetryableGoldenJourneyError(
        'Provider smoke checks failed',
        'PROVIDER_SMOKE_FAILED',
      );
    }
    state.advance('gated');

    const marker = `golden-journey/${input.ids.runId}`;
    const staffEmail = `g${input.ids.runId.replaceAll('-', '')}@example.test`;
    const isolationStaffEmail = `i${input.ids.runId.replaceAll('-', '')}@example.test`;
    ephemeralIdentities.push(
      { normalizedEmail: normalizeMailboxRecipient(staffEmail) },
      { normalizedEmail: normalizeMailboxRecipient(isolationStaffEmail) },
    );
    function recordProvisionedAuthUser(email: string, body: unknown) {
      const identity = ephemeralIdentities.find(
        (entry) => entry.normalizedEmail === normalizeMailboxRecipient(email),
      );
      if (
        !identity ||
        !isRecord(body) ||
        typeof body.supabaseUserId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.supabaseUserId,
        )
      ) {
        return;
      }
      identity.providerUserId = body.supabaseUserId;
    }
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
    ).then((provisioned) => {
      recordProvisionedAuthUser(staffEmail, provisioned.body);
    });

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
          candidate: candidateForWorkspace(
            input.fixtureCandidate,
            input.ids.workspaceId,
          ),
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
    const packageDigest = requireString(
      isRecord(published.body) && isRecord(published.body.package)
        ? published.body.package.digest
        : undefined,
      'packageDigest',
    );
    if (!/^[0-9a-f]{64}$/.test(packageDigest)) {
      throw new NonRetryableGoldenJourneyError(
        'Published package digest is malformed',
        'RELEASE_PUBLISH_FAILED',
      );
    }
    const releaseNumber = isRecord(published.body)
      ? published.body.releaseNumber
      : undefined;
    if (typeof releaseNumber !== 'number' || releaseNumber < 1) {
      throw new NonRetryableGoldenJourneyError(
        'Published release number is missing',
        'RELEASE_PUBLISH_FAILED',
      );
    }
    const republished = await requestJson(
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
    assertStableReplay({
      first: published.body,
      second: republished.body,
      fields: publishReplayFields,
      replayedSupported: true,
    });
    state.advance('release_published');

    const captureMailboxBaseline =
      input.captureInvitationMailboxBaseline ??
      captureInvitationMailboxBaseline;
    const invitationMailboxBaseline = await captureMailboxBaseline(
      input.mailbox,
      { expectedRecipient: mailbox },
    );
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
      throw new NonRetryableGoldenJourneyError(
        'Class invitation failed',
        'INVITATION_FAILED',
      );
    }
    const recreated = await requestJson(
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
    assertStableReplay({
      first: created.body,
      second: recreated.body,
      fields: invitationReplayFields,
      replayedSupported: false,
    });
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
    const invitationMail: ObservedInvitationMail = await readInvitationCode(
      input.mailbox,
      {
        expectedRecipient: mailbox,
        since: invitationSentAt,
        excludeMessageIds: invitationMailboxBaseline,
        attempts: 12,
        sleep: input.sleep,
        delayMs: 500,
        backoffFactor: 2,
        maxDelayMs: 8_000,
      },
    );
    const invitationCode = invitationMail.code;
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
    const resubmitted = await requestJson(
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
    assertStableReplay({
      first: submitted.body,
      second: resubmitted.body,
      fields: intakeReplayFields,
      replayedSupported: true,
    });
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
    const reacknowledged = await requestJson(
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
    assertStableReplay({
      first: acknowledged.body,
      second: reacknowledged.body,
      fields: learningReplayFields,
      replayedSupported: true,
    });
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
      revealed.body.intakeRecordVersionId !== intakeRecordVersionId
    ) {
      throw new NonRetryableGoldenJourneyError(
        'Clinical reveal failed',
        'CLINICAL_REVEAL_FAILED',
      );
    }
    assertExactSubmittedAnswers(revealed.body.answers, answers);
    discardClinicalRevealAnswers(revealed.body);
    state.advance('clinical_revealed');

    await requestJson(
      operatorFetch,
      `${origin}/api/v1/administration/school-workspaces`,
      {
        method: 'POST',
        body: JSON.stringify({
          operationId: input.ids.operationIds.isolationWorkspace,
          workspaceId: input.ids.isolationWorkspaceId,
          displayName: `${marker}-isolation`,
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
          operationId: input.ids.operationIds.isolationStaff,
          workspaceId: input.ids.isolationWorkspaceId,
          staffIdentityId: input.ids.isolationStaffIdentityId,
          displayName: `${marker}-isolation`,
          email: isolationStaffEmail,
          permissions: ['administrative', 'clinical'],
          schoolApprover: 'golden-journey-operator',
          reason: marker,
          initialPassword: input.isolationStaffPassword,
        }),
      },
      [201],
    ).then((provisioned) => {
      recordProvisionedAuthUser(isolationStaffEmail, provisioned.body);
    });
    const isolationJar = new CookieJar();
    const isolationFetch = createOriginFetch({
      origin,
      fetch: input.fetch,
      jar: isolationJar,
    });
    const isolationStarted = await requestJson(
      anonymousFetch,
      `${origin}/api/v1/auth/staff/sign-in`,
      {
        method: 'POST',
        body: JSON.stringify({
          email: isolationStaffEmail,
          password: input.isolationStaffPassword,
        }),
      },
      [200],
    );
    if (
      !isRecord(isolationStarted.body) ||
      typeof isolationStarted.body.flowHandle !== 'string' ||
      typeof isolationStarted.body.otpauthUri !== 'string'
    ) {
      throw new NonRetryableGoldenJourneyError(
        'Staff authentication failed',
        'AUTHENTICATION_FAILED',
      );
    }
    await requestJson(
      isolationFetch,
      `${origin}/api/v1/auth/staff/totp`,
      {
        method: 'POST',
        body: JSON.stringify({
          flowHandle: isolationStarted.body.flowHandle,
          code: totpCode(
            totpSecretFromOtpauth(isolationStarted.body.otpauthUri),
          ),
        }),
      },
      [200],
    );
    const isolationDirectory = await requestJson(
      isolationFetch,
      `${origin}/api/v1/clinical/review-directory`,
      { method: 'GET' },
      [200],
    );
    if (
      !isRecord(isolationDirectory.body) ||
      !Array.isArray(isolationDirectory.body.students) ||
      isolationDirectory.body.students.some(
        (entry) => isRecord(entry) && entry.studentId === studentId,
      )
    ) {
      throw new NonRetryableGoldenJourneyError(
        'Workspace isolation failed',
        'AUTHORIZATION_DENIED',
      );
    }
    const isolationReveal = await requestJson(
      isolationFetch,
      `${origin}/api/v1/clinical/intake-records/current`,
      {
        method: 'POST',
        body: JSON.stringify({ studentId }),
      },
      [401, 403, 404],
    );
    if (isolationReveal.status === 200) {
      throw new NonRetryableGoldenJourneyError(
        'Workspace isolation failed',
        'AUTHORIZATION_DENIED',
      );
    }
    const anonymousReveal = await requestJson(
      anonymousFetch,
      `${origin}/api/v1/clinical/intake-records/current`,
      {
        method: 'POST',
        body: JSON.stringify({ studentId }),
      },
      [401, 403],
    );
    if (anonymousReveal.status === 200) {
      throw new NonRetryableGoldenJourneyError(
        'Workspace isolation failed',
        'AUTHORIZATION_DENIED',
      );
    }

    const restorationMailboxBaseline = await captureMailboxBaseline(
      input.mailbox,
      { expectedRecipient: mailbox },
    );
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
    const restorationMail: ObservedInvitationMail = await readInvitationCode(
      input.mailbox,
      {
        expectedRecipient: mailbox,
        since: restorationSentAt,
        excludeMessageIds: restorationMailboxBaseline,
        attempts: 12,
        sleep: input.sleep,
        delayMs: 500,
        backoffFactor: 2,
        maxDelayMs: 8_000,
      },
    );
    const restorationCode = restorationMail.code;
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

    const evidenceQuery = new URL(
      `${origin}/api/v1/operator/golden-journey-evidence`,
    );
    evidenceQuery.searchParams.set('workspaceId', input.ids.workspaceId);
    evidenceQuery.searchParams.set('invitationId', input.ids.invitationId);
    evidenceQuery.searchParams.set(
      'publishOperationId',
      input.ids.operationIds.publish,
    );
    evidenceQuery.searchParams.set(
      'invitationOperationId',
      input.ids.operationIds.invitation,
    );
    evidenceQuery.searchParams.set(
      'intakeOperationId',
      input.ids.operationIds.intake,
    );
    evidenceQuery.searchParams.set(
      'learningOperationId',
      input.ids.operationIds.learning,
    );
    evidenceQuery.searchParams.set(
      'isolationWorkspaceId',
      input.ids.isolationWorkspaceId,
    );
    evidenceQuery.searchParams.set('studentId', studentId);
    evidenceQuery.searchParams.set('startedAt', startedAt.toISOString());
    const operatorEvidenceResponse = await requestJson(
      operatorFetch,
      evidenceQuery.toString(),
      { method: 'GET' },
      [200],
    );
    const operatorEvidence = parseGoldenJourneyOperatorEvidence(
      operatorEvidenceResponse.body,
    );
    const completedAt = input.clock.now();
    if (
      operatorEvidence.publishAuditCount !== 1 ||
      operatorEvidence.publishOutboxCount !== 1 ||
      operatorEvidence.publishReceiptCount !== 1 ||
      operatorEvidence.publishReleaseId !== releaseId ||
      operatorEvidence.publishPackageDigest !== packageDigest ||
      operatorEvidence.publishReleaseNumber !== releaseNumber ||
      operatorEvidence.invitationAuditCount !== 1 ||
      operatorEvidence.invitationOutboxCount !== 1 ||
      operatorEvidence.invitationReceiptCount !== 1 ||
      operatorEvidence.intakeReceiptCount !== 1 ||
      operatorEvidence.intakeOutboxCount !== 1 ||
      operatorEvidence.intakeEntityId !== intakeRecordVersionId ||
      operatorEvidence.learningReceiptCount !== 1 ||
      operatorEvidence.learningOutboxCount !== 1 ||
      operatorEvidence.learningEntityId !== itemCompletionId ||
      operatorEvidence.clinicalRevealAuditCount < 1 ||
      operatorEvidence.clinicalDenialAuditCount < 1 ||
      operatorEvidence.unattributedDenialCount < 1 ||
      (operatorEvidence.invitationStatus !== 'delivered' &&
        operatorEvidence.invitationStatus !== 'completed') ||
      !isTimestampWithinRun(
        operatorEvidence.publishOccurredAt,
        startedAt,
        completedAt,
      ) ||
      !isTimestampWithinRun(
        operatorEvidence.invitationOccurredAt,
        startedAt,
        completedAt,
      ) ||
      !isTimestampWithinRun(
        operatorEvidence.intakeOccurredAt,
        startedAt,
        completedAt,
      ) ||
      !isTimestampWithinRun(
        operatorEvidence.learningOccurredAt,
        startedAt,
        completedAt,
      ) ||
      !isTimestampWithinRun(
        operatorEvidence.clinicalRevealOccurredAt,
        startedAt,
        completedAt,
      ) ||
      !isTimestampWithinRun(
        operatorEvidence.clinicalDenialOccurredAt,
        startedAt,
        completedAt,
      ) ||
      !isTimestampWithinRun(
        operatorEvidence.unattributedDenialOccurredAt,
        startedAt,
        completedAt,
      )
    ) {
      throw new NonRetryableGoldenJourneyError(
        'Operator evidence is unavailable',
        'OPERATOR_EVIDENCE_FAILED',
      );
    }
    assertWorkerArtifactDigest({
      publicDigest: expectedSource.artifactDigest,
      workerDigest: operatorEvidence.workerArtifactDigest ?? undefined,
      expectedDigest: expectedSource.artifactDigest,
      invitationId: input.ids.invitationId,
      invitationStatus: operatorEvidence.invitationStatus,
      workerRecordedAt: operatorEvidence.workerRecordedAt,
      runStartedAt: startedAt,
      runCompletedAt: completedAt,
    });

    const browser = await input.runBrowser({
      origin,
      staffCookie: staffJar.header(),
      studentCookie: studentJar.header(),
      studentId,
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
      throw new NonRetryableGoldenJourneyError(
        'Browser assertions failed',
        'BROWSER_ASSERTION_FAILED',
      );
    }
    state.advance('browser_checked');
    authCleanup = await cleanupAuth({
      supabaseUrl: input.environment.SUPABASE_URL ?? '',
      secretKey: input.environment.SUPABASE_SECRET_KEY ?? '',
      identities: ephemeralIdentities,
    });
    if (authCleanup !== 'completed') {
      throw new GoldenJourneyRunError(
        'CLEANUP_FAILED',
        state.step(),
        authCleanup,
      );
    }
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
        isolationWorkspaceId: input.ids.isolationWorkspaceId,
        releaseId,
        studentId,
        intakeRecordVersionId,
        itemCompletionId,
        packageDigest,
      },
      authCleanup,
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
        workspaceIsolation: 'pass',
        authorizationDenial: 'pass',
        auditEvidence: 'pass',
        outboxDelivery: 'pass',
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
    if (error instanceof GoldenJourneyRunError) throw error;
    const lastCompletedStep = state.step();
    if (state.step() !== 'failed' && state.step() !== 'completed') {
      state.fail();
    }
    authCleanup = await cleanupAuth({
      supabaseUrl: input.environment.SUPABASE_URL ?? '',
      secretKey: input.environment.SUPABASE_SECRET_KEY ?? '',
      identities: ephemeralIdentities,
    });
    throw new GoldenJourneyRunError(
      mapJourneyError(error),
      lastCompletedStep === 'failed' ? 'idle' : lastCompletedStep,
      authCleanup,
    );
  }
}
