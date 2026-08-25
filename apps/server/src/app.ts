import swagger from '@fastify/swagger';
import fastifyStatic from '@fastify/static';
import { Type, type Static } from '@sinclair/typebox';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  Clock,
  IdGenerator,
  IdentityAndAccess,
  StaffAuthProvider,
} from '../../../modules/identity-access/index.ts';
import {
  SchoolWorkspaceAlreadyExistsError,
  StaffAuthenticationFailedError,
  StaffAuthenticationStaleError,
  StaffIdentityAlreadyExistsError,
  StaffPermissionRequiredError,
  StudentAuthenticationFailedError,
  StaffSessionExpiredError,
  StaffSessionRevokedError,
  StepUpIncompleteError,
  StepUpRejectedError,
  AdministrativePermissionRequiredError,
} from '../../../modules/identity-access/index.ts';
import type {
  Intake,
  UnattributedRevealOutcome,
} from '../../../modules/intake/index.ts';
import {
  IntakeAlreadyAcceptedError,
  IntakeIncompleteError,
  IntakeOperationReusedError,
  IntakeRecordNotFoundError,
  IntakeRevisionConflictError,
  IntakeUnavailableError,
} from '../../../modules/intake/index.ts';
import { createIntake } from '../../../modules/intake/index.ts';
import type { ApplicationKeyManagement } from '../../../modules/intake/index.ts';
import type { LearningProgress } from '../../../modules/learning-progress/index.ts';
import {
  LearningLockedError,
  LearningOperationReusedError,
  LearningRevisionConflictError,
  LearningUnavailableError,
} from '../../../modules/learning-progress/index.ts';
import { createLearningProgress } from '../../../modules/learning-progress/index.ts';
import type { SchoolConfiguration } from '../../../modules/school-configuration/index.ts';
import {
  ActiveReleaseConflictError,
  AuthenticationFreshnessRequiredError,
  CandidateFingerprintConflictError,
  DraftVersionConflictError,
  InvalidSchoolConfigurationError,
  OperationIdReusedError,
  ResourceRevisionConflictError,
} from '../../../modules/school-configuration/index.ts';
import {
  createEnvelopeKeyManagement,
  type EnvelopeKeyMaterial,
} from '../../../packages/application-keys/src/index.ts';
import {
  createTelemetry,
  type Telemetry,
  type TelemetryEvent,
} from '../../../packages/observability/src/index.ts';
import {
  expireSecureOpaqueCookie,
  readSecureOpaqueCookie,
  setSecureOpaqueCookie,
} from '../../../packages/http-security/src/index.ts';
import {
  assertRestrictedDatabaseRole,
  createPostgresIdentityAndAccess,
} from '../../../packages/postgres/src/identity-access.ts';
import {
  createInvitationSecretProtector,
  type InvitationSecretKeys,
} from '../../../packages/invitation-secrets/src/index.ts';
import { createSchoolConfiguration } from '../../../modules/school-configuration/index.ts';
import {
  createPostgresSchoolConfigurationStore,
  sha256SessionHandle,
} from '../../../packages/postgres/src/school-configuration.ts';
import { createMemoryReleasePackageStorage } from '../../../packages/release-package-storage/src/index.ts';
import type { ReleasePackageStorage } from '../../../modules/school-configuration/index.ts';
import { createPostgresIntakeStore } from '../../../packages/postgres/src/intake.ts';
import { createPostgresLearningProgressStore } from '../../../packages/postgres/src/learning-progress.ts';
import { queryGoldenJourneyOperatorEvidence } from '../../../packages/postgres/src/golden-journey-evidence.ts';
import {
  BUILD_ATTESTATION_SCHEMA_VERSION,
  verifyBuildAttestationForHealth,
  type BuildAttestation,
} from '../../../packages/build-attestation/src/index.ts';

const staffSessionCookie = '__Host-prevcare-staff-session' as const;
const studentSessionCookie = '__Host-prevcare-student-session' as const;

const requestBodyLimit = 64 * 1024;
const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
  ].join('; '),
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy':
    'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const;

class UntrustedRequestOriginError extends Error {}
class UntrustedRequestCsrfError extends Error {}

const CreateSchoolWorkspaceBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    workspaceId: Type.String({ format: 'uuid' }),
    displayName: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: '.*\\S.*',
    }),
  },
  { additionalProperties: false },
);

const OperatorHeaders = Type.Object({
  authorization: Type.Optional(Type.String()),
  'x-prevcare-csrf': Type.Literal('1'),
});

const CreateSchoolWorkspaceResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('created'),
});

const StaffPermissionSchema = Type.Union([
  Type.Literal('administrative'),
  Type.Literal('clinical'),
]);

const ProvisionStaffIdentityBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    workspaceId: Type.String({ format: 'uuid' }),
    staffIdentityId: Type.String({ format: 'uuid' }),
    displayName: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: '.*\\S.*',
    }),
    email: Type.String({ format: 'email', maxLength: 320 }),
    permissions: Type.Array(StaffPermissionSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    schoolApprover: Type.String({ minLength: 1, maxLength: 200 }),
    reason: Type.String({ minLength: 1, maxLength: 2000 }),
    initialPassword: Type.String({ minLength: 12, maxLength: 200 }),
  },
  { additionalProperties: false },
);

const ProvisionStaffIdentityResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  staffIdentityId: Type.String({ format: 'uuid' }),
  supabaseUserId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('provisioned'),
});

const StaffSignInBody = Type.Object(
  {
    email: Type.String({ format: 'email', maxLength: 320 }),
    password: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

const StaffSignInChallengeResponse = Type.Object({
  flowHandle: Type.String(),
  flowExpiresAt: Type.String({ format: 'date-time' }),
  stage: Type.Union([Type.Literal('enroll'), Type.Literal('totp')]),
  otpauthUri: Type.Optional(Type.String()),
});

const StaffTotpBody = Type.Object(
  {
    flowHandle: Type.String({ minLength: 1, maxLength: 200 }),
    code: Type.String({ pattern: '^[0-9]{6}$' }),
  },
  { additionalProperties: false },
);

const StaffSessionCreatedResponse = Type.Object({
  outcome: Type.Literal('authenticated'),
});

const StaffSessionEndedResponse = Type.Object({
  outcome: Type.Literal('ended'),
});

const StaffSessionResponse = Type.Object({
  staffIdentityId: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  displayName: Type.String(),
  permissions: Type.Array(StaffPermissionSchema),
  authenticatedAt: Type.String({ format: 'date-time' }),
});

const StaffDirectoryEntryResponse = Type.Object({
  staffIdentityId: Type.String({ format: 'uuid' }),
  displayName: Type.String(),
  email: Type.String(),
  permissions: Type.Array(StaffPermissionSchema),
  status: Type.Union([Type.Literal('active'), Type.Literal('disabled')]),
  createdAt: Type.String({ format: 'date-time' }),
});

const StaffDirectoryResponse = Type.Object({
  staffIdentities: Type.Array(StaffDirectoryEntryResponse),
});

const CreateClassInvitationBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    classId: Type.String({ format: 'uuid' }),
    invitationId: Type.String({ format: 'uuid' }),
    name: Type.String({ minLength: 1, maxLength: 200, pattern: '.*\\S.*' }),
    recipient: Type.String({
      maxLength: 322,
      pattern: '^\\s*[^\\s@]+@[^\\s@]+\\s*$',
    }),
  },
  { additionalProperties: false },
);
const CreateClassInvitationResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  classId: Type.String({ format: 'uuid' }),
  invitationId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('created'),
});
const ClassDirectoryResponse = Type.Object({
  classes: Type.Array(
    Type.Object({
      classId: Type.String({ format: 'uuid' }),
      name: Type.String(),
      createdAt: Type.String({ format: 'date-time' }),
      invitations: Type.Array(
        Type.Object({
          invitationId: Type.String({ format: 'uuid' }),
          purpose: Type.Literal('join_class'),
          generation: Type.Integer({ minimum: 1 }),
          status: Type.Union([
            Type.Literal('pending_delivery'),
            Type.Literal('delivered'),
            Type.Literal('delivery_failed'),
            Type.Literal('expired'),
            Type.Literal('completed'),
            Type.Literal('revoked'),
            Type.Literal('superseded'),
          ]),
          expiresAt: Type.String({ format: 'date-time' }),
        }),
      ),
    }),
  ),
});

const RedeemInvitationBody = Type.Object(
  {
    recipient: Type.String({
      maxLength: 322,
      pattern: '^\\s*[^\\s@]+@[^\\s@]+\\s*$',
    }),
    code: Type.String({ pattern: '^[0-9]{6}$' }),
  },
  { additionalProperties: false },
);
const StudentSessionCreatedResponse = Type.Object({
  outcome: Type.Literal('authenticated'),
});
const StudentSessionResponse = Type.Object({
  studentId: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  activeClassMemberships: Type.Array(
    Type.Object({
      classId: Type.String({ format: 'uuid' }),
      name: Type.String(),
    }),
  ),
});
const IntakeLocaleSchema = Type.Union([
  Type.Literal('en-US'),
  Type.Literal('es-US'),
  Type.Literal('pt-BR'),
  Type.Literal('fr-CA'),
  Type.Literal('ht-HT'),
]);
const ExactResourceRevisionSchema = Type.Object({
  resourceId: Type.String({ format: 'uuid' }),
  revisionNumber: Type.Integer({ minimum: 1 }),
});
const IntakeAnswersSchema = Type.Record(
  Type.String({ format: 'uuid' }),
  Type.String({ maxLength: 4000 }),
);
const StudentIntakeQuery = Type.Object({
  locale: Type.Optional(IntakeLocaleSchema),
});
const StudentIntakeFormResponse = Type.Object({
  schoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
  locale: IntakeLocaleSchema,
  intakeForm: Type.Object({
    resourceId: Type.String({ format: 'uuid' }),
    revisionNumber: Type.Integer({ minimum: 1 }),
    title: Type.String(),
    sections: Type.Array(
      Type.Object({
        id: Type.String({ format: 'uuid' }),
        revision: Type.Integer({ minimum: 1 }),
        order: Type.Integer({ minimum: 0 }),
        title: Type.String(),
      }),
    ),
    fields: Type.Array(
      Type.Object({
        id: Type.String({ format: 'uuid' }),
        revision: Type.Integer({ minimum: 1 }),
        key: Type.String(),
        sectionId: Type.String({ format: 'uuid' }),
        order: Type.Integer({ minimum: 0 }),
        type: Type.Union([
          Type.Literal('text'),
          Type.Literal('date'),
          Type.Literal('tel'),
          Type.Literal('yes-no'),
          Type.Literal('textarea'),
        ]),
        required: Type.Boolean(),
        requiredWhenVisible: Type.Boolean(),
        visibility: Type.Union([
          Type.Null(),
          Type.Object({
            fieldId: Type.String({ format: 'uuid' }),
            equalsOptionCode: Type.String(),
          }),
        ]),
        options: Type.Array(
          Type.Object({
            code: Type.String(),
            label: Type.String(),
          }),
        ),
        label: Type.String(),
      }),
    ),
  }),
  submissionAttestation: Type.Object({
    resourceId: Type.String({ format: 'uuid' }),
    revisionNumber: Type.Integer({ minimum: 1 }),
    text: Type.String(),
  }),
});
const StudentIntakeSnapshotResponse = Type.Object({
  learningUnlocked: Type.Boolean(),
  currentIntakeRecordVersion: Type.Union([
    Type.Null(),
    Type.Object({
      intakeRecordVersionId: Type.String({ format: 'uuid' }),
      acceptedAt: Type.String({ format: 'date-time' }),
      schoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
      intakeForm: ExactResourceRevisionSchema,
      submissionAttestation: ExactResourceRevisionSchema,
      locale: IntakeLocaleSchema,
    }),
  ]),
  draft: Type.Union([
    Type.Null(),
    Type.Object({
      locale: IntakeLocaleSchema,
      updatedAt: Type.String({ format: 'date-time' }),
      answers: IntakeAnswersSchema,
    }),
  ]),
  form: StudentIntakeFormResponse,
});
const SaveIntakeDraftBody = Type.Object(
  {
    expectedSchoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
    expectedIntakeForm: ExactResourceRevisionSchema,
    locale: IntakeLocaleSchema,
    answers: IntakeAnswersSchema,
  },
  { additionalProperties: false },
);
const SaveIntakeDraftResponse = Type.Object({
  locale: IntakeLocaleSchema,
  updatedAt: Type.String({ format: 'date-time' }),
});
const SubmitIntakeRecordVersionBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    expectedSchoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
    expectedIntakeForm: ExactResourceRevisionSchema,
    expectedSubmissionAttestation: ExactResourceRevisionSchema,
    locale: IntakeLocaleSchema,
    answers: IntakeAnswersSchema,
    attestation: Type.Object({
      locale: IntakeLocaleSchema,
      notice: ExactResourceRevisionSchema,
    }),
  },
  { additionalProperties: false },
);
const SubmitIntakeRecordVersionResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  intakeRecordVersionId: Type.String({ format: 'uuid' }),
  acceptedAt: Type.String({ format: 'date-time' }),
  learningUnlocked: Type.Literal(true),
  replayed: Type.Boolean(),
});
const ClinicalDirectoryResponse = Type.Object({
  students: Type.Array(
    Type.Object({
      studentId: Type.String({ format: 'uuid' }),
      createdAt: Type.String({ format: 'date-time' }),
      currentIntakeRecordVersion: Type.Union([
        Type.Null(),
        Type.Object({
          intakeRecordVersionId: Type.String({ format: 'uuid' }),
          acceptedAt: Type.String({ format: 'date-time' }),
          locale: IntakeLocaleSchema,
        }),
      ]),
    }),
  ),
  freshUntil: Type.String({ format: 'date-time' }),
});
const RevealCurrentIntakeRecordBody = Type.Object(
  {
    studentId: Type.String({ format: 'uuid' }),
  },
  { additionalProperties: false },
);
const RevealedCurrentIntakeRecordResponse = Type.Object({
  studentId: Type.String({ format: 'uuid' }),
  intakeRecordVersionId: Type.String({ format: 'uuid' }),
  acceptedAt: Type.String({ format: 'date-time' }),
  schoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
  locale: IntakeLocaleSchema,
  intakeForm: StudentIntakeFormResponse.properties.intakeForm,
  answers: IntakeAnswersSchema,
  freshUntil: Type.String({ format: 'date-time' }),
});
const StudentLearningQuery = Type.Object({
  locale: Type.Optional(IntakeLocaleSchema),
});
const LearningItemKindSchema = Type.Union([
  Type.Literal('knowledge'),
  Type.Literal('skill'),
  Type.Literal('application'),
]);
const StudentLearningSnapshotResponse = Type.Object({
  learningUnlocked: Type.Boolean(),
  schoolConfigurationReleaseId: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
  locale: IntakeLocaleSchema,
  item: Type.Union([
    Type.Null(),
    Type.Object({
      itemId: Type.String({ format: 'uuid' }),
      revisionNumber: Type.Integer({ minimum: 1 }),
      kind: LearningItemKindSchema,
      text: Type.String(),
      moduleTitle: Type.String(),
    }),
  ]),
  completion: Type.Union([
    Type.Null(),
    Type.Object({
      itemCompletionId: Type.String({ format: 'uuid' }),
      itemId: Type.String({ format: 'uuid' }),
      revisionNumber: Type.Integer({ minimum: 1 }),
      schoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
      completedAt: Type.String({ format: 'date-time' }),
    }),
  ]),
});
const AcknowledgeLearningItemBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    expectedSchoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
    itemId: Type.String({ format: 'uuid' }),
    revisionNumber: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
const AcknowledgeLearningItemResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  itemCompletionId: Type.String({ format: 'uuid' }),
  itemId: Type.String({ format: 'uuid' }),
  revisionNumber: Type.Integer({ minimum: 1 }),
  schoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
  completedAt: Type.String({ format: 'date-time' }),
  replayed: Type.Boolean(),
});

const StepUpBody = Type.Object(
  {
    password: Type.Optional(Type.String({ maxLength: 200 })),
    totp: Type.Optional(Type.String({ maxLength: 20 })),
  },
  { additionalProperties: false },
);
const StepUpResponse = Type.Object({
  freshUntil: Type.String({ format: 'date-time' }),
});
const ImportSchoolConfigurationDraftBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    expectedDraftVersion: Type.Integer({ minimum: 0 }),
    candidate: Type.Unknown(),
  },
  { additionalProperties: false },
);
const ExactResourceResponse = Type.Object({
  resourceId: Type.String({ format: 'uuid' }),
  revisionNumber: Type.Integer({ minimum: 1 }),
});
const ImportSchoolConfigurationDraftResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  draftVersion: Type.Integer({ minimum: 1 }),
  candidateFingerprint: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  affectedResources: Type.Array(ExactResourceResponse),
});
const SchoolConfigurationDraftResponse = Type.Object({
  workspaceId: Type.String({ format: 'uuid' }),
  draftVersion: Type.Integer({ minimum: 0 }),
  activeReleaseId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  candidateFingerprint: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  candidate: Type.Unknown(),
});
const PublishSchoolConfigurationReleaseBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    expectedActiveReleaseId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),
    expectedDraftVersion: Type.Integer({ minimum: 0 }),
    candidateFingerprint: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    changeDescription: Type.String({ maxLength: 2000 }),
  },
  { additionalProperties: false },
);
const PublishSchoolConfigurationReleaseResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  releaseId: Type.String({ format: 'uuid' }),
  releaseNumber: Type.Integer({ minimum: 1 }),
  candidateFingerprint: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  activeReleaseId: Type.String({ format: 'uuid' }),
  draftVersion: Type.Integer({ minimum: 1 }),
  package: Type.Object({
    format: Type.Literal('school-configuration-package/v1'),
    digest: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    byteLength: Type.Integer({ minimum: 1 }),
  }),
  replayed: Type.Boolean(),
});

const ProblemDetails = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Integer(),
  code: Type.String(),
  draftVersion: Type.Optional(Type.Integer({ minimum: 0 })),
  activeReleaseId: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  ),
  candidateFingerprint: Type.Optional(Type.String()),
  affectedValue: Type.Optional(Type.String()),
});

const ProblemResponse = {
  content: {
    'application/problem+json': { schema: ProblemDetails },
  },
};

const LiveHealthResponse = Type.Object({ status: Type.Literal('ok') });
const ReadyHealthResponse = Type.Object({ status: Type.Literal('ready') });
const NotReadyHealthResponse = Type.Object({
  status: Type.Literal('not-ready'),
});
const BuildHealthResponse = Type.Object({
  commit: Type.String({ pattern: '^[0-9a-f]{40}$' }),
  tree: Type.String({ pattern: '^[0-9a-f]{40}$' }),
  sourceDigest: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  browserDigest: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  lockDigest: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  dependencyDigest: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  bunVersion: Type.String({ minLength: 1 }),
  artifactDigest: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  envelopeAdapter: Type.Literal('application-layer-envelope/v1'),
});
const GoldenJourneyOperatorEvidenceQuery = Type.Object({
  workspaceId: Type.String({ format: 'uuid' }),
  invitationId: Type.String({ format: 'uuid' }),
  publishOperationId: Type.String({ format: 'uuid' }),
  invitationOperationId: Type.String({ format: 'uuid' }),
  intakeOperationId: Type.String({ format: 'uuid' }),
  learningOperationId: Type.String({ format: 'uuid' }),
  isolationWorkspaceId: Type.String({ format: 'uuid' }),
  studentId: Type.String({ format: 'uuid' }),
  startedAt: Type.String({ format: 'date-time' }),
});
const GoldenJourneyCount = Type.Integer({ minimum: 0 });
const GoldenJourneyOperatorEvidenceResponse = Type.Object(
  {
    invitationStatus: Type.Union([Type.String(), Type.Null()]),
    workerArtifactDigest: Type.Union([
      Type.String({ pattern: '^[0-9a-f]{64}$' }),
      Type.Null(),
    ]),
    workerEnvelopeAdapter: Type.Union([
      Type.Literal('application-layer-envelope/v1'),
      Type.Null(),
    ]),
    workerRecordedAt: Type.Union([Type.String(), Type.Null()]),
    publishReleaseId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),
    publishPackageDigest: Type.Union([
      Type.String({ pattern: '^[0-9a-f]{64}$' }),
      Type.Null(),
    ]),
    publishReleaseNumber: Type.Union([
      Type.Integer({ minimum: 1 }),
      Type.Null(),
    ]),
    publishAuditCount: GoldenJourneyCount,
    publishOutboxCount: GoldenJourneyCount,
    publishReceiptCount: GoldenJourneyCount,
    publishOccurredAt: Type.Union([Type.String(), Type.Null()]),
    invitationAuditCount: GoldenJourneyCount,
    invitationOutboxCount: GoldenJourneyCount,
    invitationReceiptCount: GoldenJourneyCount,
    invitationOccurredAt: Type.Union([Type.String(), Type.Null()]),
    intakeReceiptCount: GoldenJourneyCount,
    intakeOutboxCount: GoldenJourneyCount,
    intakeEntityId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    intakeOccurredAt: Type.Union([Type.String(), Type.Null()]),
    learningReceiptCount: GoldenJourneyCount,
    learningOutboxCount: GoldenJourneyCount,
    learningEntityId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),
    learningOccurredAt: Type.Union([Type.String(), Type.Null()]),
    clinicalRevealAuditCount: GoldenJourneyCount,
    clinicalRevealOccurredAt: Type.Union([Type.String(), Type.Null()]),
    clinicalDenialAuditCount: GoldenJourneyCount,
    clinicalDenialOccurredAt: Type.Union([Type.String(), Type.Null()]),
    unattributedDenialCount: GoldenJourneyCount,
    unattributedDenialOccurredAt: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
const BuildUnavailableResponse = Type.Object({
  status: Type.Literal('unavailable'),
});

type OperatorAuthenticator = {
  authenticate(
    authorization: string | undefined,
  ): { type: 'technical_operator'; id: string } | undefined;
};

function createOperatorAuthenticator(credentials: {
  token: string;
  actorId: string;
}): OperatorAuthenticator {
  if (credentials.token.length < 32) {
    throw new Error(
      'OPERATOR_PROVISIONING_TOKEN must contain at least 32 characters',
    );
  }
  const expected = Buffer.from(`Bearer ${credentials.token}`);
  return {
    authenticate(authorization) {
      if (!authorization) return undefined;
      const provided = Buffer.from(authorization);
      if (
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
      ) {
        return undefined;
      }
      return { type: 'technical_operator', id: credentials.actorId };
    },
  };
}

export async function buildApp(
  identityAndAccess: IdentityAndAccess,
  options: {
    operatorAuthenticator: OperatorAuthenticator;
    publicOrigin: string;
    readiness?: () => Promise<void>;
    telemetry?: Telemetry;
    webRoot?: string;
    onClose?: () => Promise<void>;
    schoolConfiguration?: SchoolConfiguration;
    intake?: Intake;
    learningProgress?: LearningProgress;
    buildIdentity?: BuildAttestation;
    verifyBuildAttestation?: () => Promise<BuildAttestation | undefined>;
    queryGoldenJourneyEvidence?: (input: {
      workspaceId: string;
      invitationId: string;
      publishOperationId: string;
      invitationOperationId: string;
      intakeOperationId: string;
      learningOperationId: string;
      isolationWorkspaceId: string;
      studentId: string;
      startedAt: string;
    }) => Promise<unknown>;
  },
): Promise<FastifyInstance> {
  const publicOrigin = new URL(options.publicOrigin).origin;
  const telemetry = options.telemetry;
  const requestStartedAt = new WeakMap<object, number>();
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false } },
    bodyLimit: requestBodyLimit,
    logger: false,
  });
  if (options.onClose) app.addHook('onClose', options.onClose);

  async function recordClinicalRevealBoundaryDenial(
    request: FastifyRequest,
    reply: FastifyReply,
    outcome: UnattributedRevealOutcome,
  ): Promise<boolean> {
    if (
      request.method !== 'POST' ||
      request.routeOptions.url !== '/api/v1/clinical/intake-records/current'
    ) {
      return true;
    }
    try {
      if (!options.intake) {
        throw new Error('clinical reveal boundary audit requires intake');
      }
      await options.intake.reportUnauthenticatedReveal({ outcome });
      return true;
    } catch {
      reply.type('application/problem+json').code(500).send({
        type: 'https://preventive-care-literacy.example/problems/internal-error',
        title: 'Internal server error',
        status: 500,
        code: 'INTERNAL_ERROR',
      });
      return false;
    }
  }

  app.addHook('onRequest', async (request, reply) => {
    requestStartedAt.set(request, performance.now());
    for (const [name, value] of Object.entries(securityHeaders)) {
      reply.header(name, value);
    }

    if (!['DELETE', 'PATCH', 'POST', 'PUT'].includes(request.method)) return;
    if (
      request.headers.origin !== publicOrigin ||
      (request.headers['sec-fetch-site'] !== undefined &&
        request.headers['sec-fetch-site'] !== 'same-origin')
    ) {
      throw new UntrustedRequestOriginError();
    }
    if (request.headers['x-prevcare-csrf'] !== '1') {
      throw new UntrustedRequestCsrfError();
    }
  });
  if (telemetry) {
    app.addHook('onResponse', async (request, reply) => {
      const route = request.routeOptions.url ?? '';
      const routeName: Extract<
        TelemetryEvent,
        { name: 'http.request.completed' }
      >['route'] = route.startsWith('/health/')
        ? 'health'
        : route === '/api/v1/administration/school-workspaces'
          ? 'create-school-workspace'
          : route === '/api/v1/administration/staff-identities'
            ? 'staff-identities'
            : route === '/api/v1/auth/staff/sign-in'
              ? 'staff-sign-in'
              : route === '/api/v1/auth/staff/totp'
                ? 'staff-sign-in-totp'
                : route === '/api/v1/auth/staff/sign-out'
                  ? 'staff-sign-out'
                  : route === '/api/v1/staff/session'
                    ? 'staff-session'
                    : route === '/api/v1/clinical/review-directory'
                      ? 'clinical-directory'
                      : route === '/api/v1/clinical/intake-records/current'
                        ? 'clinical-intake-reveal'
                        : route === '/api/v1/administration/classes'
                          ? 'classes'
                          : route === '/api/v1/student/intake'
                            ? 'student-intake'
                            : route === '/api/v1/student/intake/draft'
                              ? 'student-intake-draft'
                              : route === '/api/v1/student/intake/submissions'
                                ? 'student-intake-submission'
                                : route === '/api/v1/student/learning'
                                  ? 'student-learning'
                                  : route ===
                                      '/api/v1/student/learning/acknowledgements'
                                    ? 'student-learning-acknowledgement'
                                    : 'unknown';
      telemetry.record({
        name: 'http.request.completed',
        method: ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'].includes(
          request.method,
        )
          ? (request.method as Extract<
              TelemetryEvent,
              { name: 'http.request.completed' }
            >['method'])
          : 'GET',
        route: routeName,
        statusCode: reply.statusCode,
        durationMs: Math.max(
          0,
          Math.round(performance.now() - (requestStartedAt.get(request) ?? 0)),
        ),
      });
    });
  }
  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof UntrustedRequestOriginError) {
      if (
        !(await recordClinicalRevealBoundaryDenial(
          request,
          reply,
          'denied_origin',
        ))
      ) {
        return;
      }
      return reply.type('application/problem+json').code(403).send({
        type: 'https://preventive-care-literacy.example/problems/request-origin',
        title: 'Trusted request origin required',
        status: 403,
        code: 'TRUSTED_ORIGIN_REQUIRED',
      });
    }
    if (error instanceof UntrustedRequestCsrfError) {
      if (
        !(await recordClinicalRevealBoundaryDenial(
          request,
          reply,
          'denied_csrf',
        ))
      ) {
        return;
      }
      return reply.type('application/problem+json').code(403).send({
        type: 'https://preventive-care-literacy.example/problems/request-origin',
        title: 'Trusted request origin required',
        status: 403,
        code: 'TRUSTED_ORIGIN_REQUIRED',
      });
    }
    if (error instanceof SchoolWorkspaceAlreadyExistsError) {
      return reply.type('application/problem+json').code(409).send({
        type: 'https://preventive-care-literacy.example/problems/school-workspace-exists',
        title: error.message,
        status: 409,
        code: error.code,
      });
    }
    if (error instanceof StaffIdentityAlreadyExistsError) {
      return reply.type('application/problem+json').code(409).send({
        type: 'https://preventive-care-literacy.example/problems/staff-identity-exists',
        title: error.message,
        status: 409,
        code: error.code,
      });
    }
    if (error instanceof StaffAuthenticationFailedError) {
      return reply.type('application/problem+json').code(401).send({
        type: 'https://preventive-care-literacy.example/problems/staff-authentication',
        title: error.message,
        status: 401,
        code: error.code,
      });
    }
    if (error instanceof StaffPermissionRequiredError) {
      return reply.type('application/problem+json').code(403).send({
        type: 'https://preventive-care-literacy.example/problems/staff-permission',
        title: error.message,
        status: 403,
        code: error.code,
      });
    }
    if (error instanceof AdministrativePermissionRequiredError) {
      return reply.type('application/problem+json').code(403).send({
        type: 'https://preventive-care-literacy.example/problems/administrative-permission',
        title: error.message,
        status: 403,
        code: error.code,
      });
    }
    if (error instanceof StaffAuthenticationStaleError) {
      return reply.type('application/problem+json').code(403).send({
        type: 'https://preventive-care-literacy.example/problems/staff-authentication-stale',
        title: error.message,
        status: 403,
        code: error.code,
      });
    }
    if (error instanceof StepUpIncompleteError) {
      return reply.type('application/problem+json').code(422).send({
        type: 'https://preventive-care-literacy.example/problems/step-up-incomplete',
        title: error.message,
        status: 422,
        code: error.code,
      });
    }
    if (error instanceof StepUpRejectedError) {
      return reply.type('application/problem+json').code(401).send({
        type: 'https://preventive-care-literacy.example/problems/step-up-rejected',
        title: error.message,
        status: 401,
        code: error.code,
      });
    }
    if (
      error instanceof StaffSessionExpiredError ||
      error instanceof StaffSessionRevokedError
    ) {
      return reply.type('application/problem+json').code(401).send({
        type: 'https://preventive-care-literacy.example/problems/staff-session',
        title: error.message,
        status: 401,
        code: error.code,
      });
    }
    if (error instanceof AuthenticationFreshnessRequiredError) {
      return reply.type('application/problem+json').code(409).send({
        type: 'https://preventive-care-literacy.example/problems/authentication-freshness',
        title: error.message,
        status: 409,
        code: error.code,
      });
    }
    if (
      error instanceof DraftVersionConflictError ||
      error instanceof ActiveReleaseConflictError ||
      error instanceof CandidateFingerprintConflictError ||
      error instanceof ResourceRevisionConflictError ||
      error instanceof OperationIdReusedError
    ) {
      return reply
        .type('application/problem+json')
        .code(409)
        .send({
          type: 'https://preventive-care-literacy.example/problems/school-configuration-conflict',
          title: error.message,
          status: 409,
          code: error.code,
          ...(error instanceof DraftVersionConflictError
            ? { draftVersion: error.draftVersion }
            : {}),
          ...(error instanceof ActiveReleaseConflictError
            ? { activeReleaseId: error.activeReleaseId }
            : {}),
          ...(error instanceof CandidateFingerprintConflictError
            ? { candidateFingerprint: error.candidateFingerprint }
            : {}),
        });
    }
    if (error instanceof InvalidSchoolConfigurationError) {
      return reply
        .type('application/problem+json')
        .code(422)
        .send({
          type: 'https://preventive-care-literacy.example/problems/school-configuration-invalid',
          title: error.message,
          status: 422,
          code: error.code,
          ...(error.affectedValue
            ? { affectedValue: error.affectedValue }
            : {}),
        });
    }
    if (error instanceof StudentAuthenticationFailedError) {
      return reply.type('application/problem+json').code(401).send({
        type: 'https://preventive-care-literacy.example/problems/student-authentication',
        title: error.message,
        status: 401,
        code: error.code,
      });
    }
    if (error instanceof IntakeUnavailableError) {
      return reply.type('application/problem+json').code(404).send({
        type: 'https://preventive-care-literacy.example/problems/intake-unavailable',
        title: error.message,
        status: 404,
        code: error.code,
      });
    }
    if (
      error instanceof IntakeRevisionConflictError ||
      error instanceof IntakeAlreadyAcceptedError ||
      error instanceof IntakeOperationReusedError
    ) {
      return reply.type('application/problem+json').code(409).send({
        type: 'https://preventive-care-literacy.example/problems/intake-conflict',
        title: error.message,
        status: 409,
        code: error.code,
      });
    }
    if (error instanceof IntakeIncompleteError) {
      return reply.type('application/problem+json').code(422).send({
        type: 'https://preventive-care-literacy.example/problems/intake-incomplete',
        title: error.message,
        status: 422,
        code: error.code,
      });
    }
    if (error instanceof IntakeRecordNotFoundError) {
      return reply.type('application/problem+json').code(404).send({
        type: 'https://preventive-care-literacy.example/problems/intake-record',
        title: error.message,
        status: 404,
        code: error.code,
      });
    }
    if (error instanceof LearningUnavailableError) {
      return reply.type('application/problem+json').code(404).send({
        type: 'https://preventive-care-literacy.example/problems/learning-unavailable',
        title: error.message,
        status: 404,
        code: error.code,
      });
    }
    if (error instanceof LearningLockedError) {
      return reply.type('application/problem+json').code(403).send({
        type: 'https://preventive-care-literacy.example/problems/learning-locked',
        title: error.message,
        status: 403,
        code: error.code,
      });
    }
    if (
      error instanceof LearningRevisionConflictError ||
      error instanceof LearningOperationReusedError
    ) {
      return reply.type('application/problem+json').code(409).send({
        type: 'https://preventive-care-literacy.example/problems/learning-conflict',
        title: error.message,
        status: 409,
        code: error.code,
      });
    }
    if (
      (typeof error === 'object' &&
        error !== null &&
        'validation' in error &&
        error.validation) ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
          error.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ||
          error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'))
    ) {
      if (
        !(await recordClinicalRevealBoundaryDenial(
          request,
          reply,
          'denied_invalid_request',
        ))
      ) {
        return;
      }
      return reply.type('application/problem+json').code(400).send({
        type: 'https://preventive-care-literacy.example/problems/invalid-request',
        title: 'Request validation failed',
        status: 400,
        code: 'INVALID_REQUEST',
      });
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
    ) {
      if (
        !(await recordClinicalRevealBoundaryDenial(
          request,
          reply,
          'denied_body_too_large',
        ))
      ) {
        return;
      }
      return reply.type('application/problem+json').code(413).send({
        type: 'https://preventive-care-literacy.example/problems/request-too-large',
        title: 'Request body is too large',
        status: 413,
        code: 'REQUEST_TOO_LARGE',
      });
    }
    return reply.type('application/problem+json').code(500).send({
      type: 'https://preventive-care-literacy.example/problems/internal-error',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL_ERROR',
    });
  });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Preventive Care Literacy API', version: '1.0.0' },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
          staffSession: {
            type: 'apiKey',
            in: 'cookie',
            name: '__Host-prevcare-staff-session',
          },
          studentSession: {
            type: 'apiKey',
            in: 'cookie',
            name: studentSessionCookie,
          },
        },
      },
    },
  });

  if (options.webRoot) {
    await app.register(fastifyStatic, {
      root: resolve(options.webRoot),
      wildcard: false,
    });
  }

  app.get(
    '/health/live',
    { schema: { response: { 200: LiveHealthResponse } } },
    async () => ({ status: 'ok' }),
  );
  app.get(
    '/health/ready',
    {
      schema: {
        response: { 200: ReadyHealthResponse, 503: NotReadyHealthResponse },
      },
    },
    async (_request, reply) => {
      try {
        await options.readiness?.();
        return { status: 'ready' } as const;
      } catch {
        return reply.code(503).send({ status: 'not-ready' });
      }
    },
  );
  app.get(
    '/health/security',
    { schema: { response: { 200: LiveHealthResponse } } },
    async (_request, reply) => {
      reply.header(
        'set-cookie',
        expireSecureOpaqueCookie('__Host-prevcare-security-check'),
      );
      return { status: 'ok' };
    },
  );
  app.get(
    '/health/build',
    {
      schema: {
        response: {
          200: BuildHealthResponse,
          503: BuildUnavailableResponse,
        },
      },
    },
    async (_request, reply) => {
      const identity = options.verifyBuildAttestation
        ? await options.verifyBuildAttestation()
        : options.buildIdentity;
      if (
        !identity ||
        identity.schemaVersion !== BUILD_ATTESTATION_SCHEMA_VERSION ||
        !/^[0-9a-f]{40}$/.test(identity.commit) ||
        !/^[0-9a-f]{40}$/.test(identity.tree) ||
        !/^[0-9a-f]{64}$/.test(identity.sourceDigest) ||
        !/^[0-9a-f]{64}$/.test(identity.browserDigest) ||
        !/^[0-9a-f]{64}$/.test(identity.lockDigest) ||
        !/^[0-9a-f]{64}$/.test(identity.dependencyDigest) ||
        typeof identity.bunVersion !== 'string' ||
        identity.bunVersion.length === 0 ||
        !/^[0-9a-f]{64}$/.test(identity.artifactDigest) ||
        identity.envelopeAdapter !== 'application-layer-envelope/v1'
      ) {
        return reply.code(503).send({ status: 'unavailable' });
      }
      return {
        commit: identity.commit,
        tree: identity.tree,
        sourceDigest: identity.sourceDigest,
        browserDigest: identity.browserDigest,
        lockDigest: identity.lockDigest,
        dependencyDigest: identity.dependencyDigest,
        bunVersion: identity.bunVersion,
        artifactDigest: identity.artifactDigest,
        envelopeAdapter: identity.envelopeAdapter,
      };
    },
  );

  app.post<{
    Body: Static<typeof CreateSchoolWorkspaceBody>;
    Headers: Static<typeof OperatorHeaders>;
  }>(
    '/api/v1/administration/school-workspaces',
    {
      schema: {
        operationId: 'createSchoolWorkspace',
        security: [{ bearerAuth: [] }],
        headers: OperatorHeaders,
        body: CreateSchoolWorkspaceBody,
        response: {
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          201: CreateSchoolWorkspaceResponse,
          409: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const actor = options.operatorAuthenticator.authenticate(
        request.headers.authorization,
      );
      if (!actor) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/operator-authentication',
          title: 'Operator authentication required',
          status: 401,
          code: 'OPERATOR_AUTHENTICATION_REQUIRED',
        });
      }
      const result = await identityAndAccess.createSchoolWorkspace({
        ...request.body,
        actor,
      });
      return reply.code(201).send(result);
    },
  );

  app.post<{
    Body: Static<typeof ProvisionStaffIdentityBody>;
    Headers: Static<typeof OperatorHeaders>;
  }>(
    '/api/v1/administration/staff-identities',
    {
      schema: {
        operationId: 'provisionStaffIdentity',
        security: [{ bearerAuth: [] }],
        headers: OperatorHeaders,
        body: ProvisionStaffIdentityBody,
        response: {
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          201: ProvisionStaffIdentityResponse,
          409: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const actor = options.operatorAuthenticator.authenticate(
        request.headers.authorization,
      );
      if (!actor) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/operator-authentication',
          title: 'Operator authentication required',
          status: 401,
          code: 'OPERATOR_AUTHENTICATION_REQUIRED',
        });
      }
      const result = await identityAndAccess.provisionStaffIdentity({
        ...request.body,
        actor,
      });
      return reply.code(201).send(result);
    },
  );

  app.get<{
    Querystring: Static<typeof GoldenJourneyOperatorEvidenceQuery>;
    Headers: Static<typeof OperatorHeaders>;
  }>(
    '/api/v1/operator/golden-journey-evidence',
    {
      schema: {
        operationId: 'goldenJourneyOperatorEvidence',
        security: [{ bearerAuth: [] }],
        headers: OperatorHeaders,
        querystring: GoldenJourneyOperatorEvidenceQuery,
        response: {
          200: GoldenJourneyOperatorEvidenceResponse,
          401: ProblemResponse,
          503: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const actor = options.operatorAuthenticator.authenticate(
        request.headers.authorization,
      );
      if (!actor) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/operator-authentication',
          title: 'Operator authentication required',
          status: 401,
          code: 'OPERATOR_AUTHENTICATION_REQUIRED',
        });
      }
      if (!options.queryGoldenJourneyEvidence) {
        return reply.type('application/problem+json').code(503).send({
          type: 'https://preventive-care-literacy.example/problems/operator-evidence',
          title: 'Operator evidence is unavailable',
          status: 503,
          code: 'OPERATOR_EVIDENCE_UNAVAILABLE',
        });
      }
      const evidence = await options.queryGoldenJourneyEvidence(request.query);
      return evidence;
    },
  );

  app.post<{ Body: Static<typeof StaffSignInBody> }>(
    '/api/v1/auth/staff/sign-in',
    {
      schema: {
        operationId: 'startStaffSignIn',
        body: StaffSignInBody,
        response: {
          200: StaffSignInChallengeResponse,
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request) => identityAndAccess.startStaffSignIn(request.body),
  );

  app.post<{ Body: Static<typeof StaffTotpBody> }>(
    '/api/v1/auth/staff/totp',
    {
      schema: {
        operationId: 'completeStaffSignIn',
        body: StaffTotpBody,
        response: {
          200: StaffSessionCreatedResponse,
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const grant = await identityAndAccess.completeStaffSignIn(request.body);
      reply.header(
        'set-cookie',
        setSecureOpaqueCookie(staffSessionCookie, grant.sessionHandle),
      );
      return { outcome: 'authenticated' as const };
    },
  );

  app.post(
    '/api/v1/auth/staff/sign-out',
    {
      schema: {
        operationId: 'endStaffSession',
        security: [{ staffSession: [] }],
        response: {
          200: StaffSessionEndedResponse,
          400: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        staffSessionCookie,
      );
      if (sessionHandle) {
        await identityAndAccess.endStaffSession({ sessionHandle });
      }
      reply.header('set-cookie', expireSecureOpaqueCookie(staffSessionCookie));
      return { outcome: 'ended' as const };
    },
  );

  app.get(
    '/api/v1/staff/session',
    {
      schema: {
        operationId: 'readStaffSession',
        security: [{ staffSession: [] }],
        response: {
          200: StaffSessionResponse,
          401: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        staffSessionCookie,
      );
      const session =
        sessionHandle &&
        (await identityAndAccess.resolveStaffSession({ sessionHandle }));
      if (!session) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/staff-session',
          title: 'Staff session required',
          status: 401,
          code: 'STAFF_SESSION_REQUIRED',
        });
      }
      return session;
    },
  );

  app.get(
    '/api/v1/administration/staff-identities',
    {
      schema: {
        operationId: 'listStaffIdentities',
        security: [{ staffSession: [] }],
        response: {
          200: StaffDirectoryResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        staffSessionCookie,
      );
      const session =
        sessionHandle &&
        (await identityAndAccess.resolveStaffSession({ sessionHandle }));
      if (!session) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/staff-session',
          title: 'Staff session required',
          status: 401,
          code: 'STAFF_SESSION_REQUIRED',
        });
      }
      const staffIdentities = await identityAndAccess.listStaffIdentities({
        sessionHandle: sessionHandle as string,
      });
      return { staffIdentities };
    },
  );

  app.get(
    '/api/v1/clinical/review-directory',
    {
      schema: {
        operationId: 'openClinicalDirectory',
        security: [{ staffSession: [] }],
        response: {
          200: ClinicalDirectoryResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        staffSessionCookie,
      );
      const session =
        sessionHandle &&
        (await identityAndAccess.resolveStaffSession({ sessionHandle }));
      if (!session) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/staff-session',
          title: 'Staff session required',
          status: 401,
          code: 'STAFF_SESSION_REQUIRED',
        });
      }
      const directory = await identityAndAccess.openClinicalDirectory({
        sessionHandle: sessionHandle as string,
      });
      return {
        freshUntil: directory.freshUntil.toISOString(),
        students: directory.students.map((student) => ({
          studentId: student.studentId,
          createdAt: student.createdAt.toISOString(),
          currentIntakeRecordVersion: student.currentIntakeRecordVersion && {
            intakeRecordVersionId:
              student.currentIntakeRecordVersion.intakeRecordVersionId,
            acceptedAt:
              student.currentIntakeRecordVersion.acceptedAt.toISOString(),
            locale: student.currentIntakeRecordVersion.locale,
          },
        })),
      };
    },
  );

  app.post<{ Body: Static<typeof RevealCurrentIntakeRecordBody> }>(
    '/api/v1/clinical/intake-records/current',
    {
      schema: {
        operationId: 'revealCurrentIntakeRecord',
        security: [{ staffSession: [] }],
        body: RevealCurrentIntakeRecordBody,
        response: {
          200: RevealedCurrentIntakeRecordResponse,
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          404: ProblemResponse,
          413: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        staffSessionCookie,
      );
      if (!sessionHandle) {
        if (!options.intake) {
          return reply.type('application/problem+json').code(401).send({
            type: 'https://preventive-care-literacy.example/problems/staff-session',
            title: 'Staff session required',
            status: 401,
            code: 'STAFF_SESSION_REQUIRED',
          });
        }
        await options.intake.reportUnauthenticatedReveal({
          outcome: 'denied_unauthenticated',
          studentId: request.body.studentId,
        });
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/staff-session',
          title: 'Staff session required',
          status: 401,
          code: 'STAFF_SESSION_REQUIRED',
        });
      }
      if (!options.intake) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/staff-session',
          title: 'Staff session required',
          status: 401,
          code: 'STAFF_SESSION_REQUIRED',
        });
      }
      reply.header('cache-control', 'no-store');
      return options.intake.revealCurrent({
        sessionHandle,
        studentId: request.body.studentId,
      });
    },
  );

  app.post<{ Body: Static<typeof CreateClassInvitationBody> }>(
    '/api/v1/administration/classes',
    {
      schema: {
        operationId: 'createClassInvitation',
        security: [{ staffSession: [] }],
        body: CreateClassInvitationBody,
        response: {
          201: CreateClassInvitationResponse,
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        staffSessionCookie,
      );
      if (!sessionHandle) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/staff-session',
          title: 'Staff session required',
          status: 401,
          code: 'STAFF_SESSION_REQUIRED',
        });
      }
      const result = await identityAndAccess.createClassInvitation({
        ...request.body,
        sessionHandle,
      });
      return reply.code(201).send(result);
    },
  );

  app.get(
    '/api/v1/administration/classes',
    {
      schema: {
        operationId: 'listClasses',
        security: [{ staffSession: [] }],
        response: {
          200: ClassDirectoryResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        staffSessionCookie,
      );
      if (!sessionHandle) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/staff-session',
          title: 'Staff session required',
          status: 401,
          code: 'STAFF_SESSION_REQUIRED',
        });
      }
      return {
        classes: await identityAndAccess.listClasses({ sessionHandle }),
      };
    },
  );

  if (options.schoolConfiguration) {
    const schoolConfiguration = options.schoolConfiguration;
    app.post<{ Body: Static<typeof StepUpBody> }>(
      '/api/v1/auth/staff/step-up',
      {
        schema: {
          operationId: 'stepUpStaffSession',
          security: [{ staffSession: [] }],
          body: StepUpBody,
          response: {
            200: StepUpResponse,
            400: ProblemResponse,
            401: ProblemResponse,
            403: ProblemResponse,
            413: ProblemResponse,
            422: ProblemResponse,
            500: ProblemResponse,
          },
        },
      },
      async (request, reply) => {
        const sessionHandle = readSecureOpaqueCookie(
          request.headers.cookie,
          staffSessionCookie,
        );
        if (!sessionHandle) throw new StaffAuthenticationFailedError();
        if (
          !request.body.password ||
          !request.body.totp ||
          !/^[0-9]{6}$/.test(request.body.totp)
        ) {
          throw new StepUpIncompleteError();
        }
        const result = await schoolConfiguration.stepUp({
          sessionHandle,
          password: request.body.password,
          totp: request.body.totp,
        });
        reply.header('cache-control', 'no-store');
        return { freshUntil: result.freshUntil.toISOString() };
      },
    );

    app.get(
      '/api/v1/administration/school-configuration',
      {
        schema: {
          operationId: 'readSchoolConfigurationDraft',
          security: [{ staffSession: [] }],
          response: {
            200: SchoolConfigurationDraftResponse,
            401: ProblemResponse,
            403: ProblemResponse,
            404: ProblemResponse,
            500: ProblemResponse,
          },
        },
      },
      async (request, reply) => {
        const sessionHandle = readSecureOpaqueCookie(
          request.headers.cookie,
          staffSessionCookie,
        );
        if (!sessionHandle) throw new StaffAuthenticationFailedError();
        const draft = await schoolConfiguration.readDraft({ sessionHandle });
        if (!draft) {
          return reply.type('application/problem+json').code(404).send({
            type: 'https://preventive-care-literacy.example/problems/school-configuration-draft',
            title: 'School Configuration Draft not found',
            status: 404,
            code: 'SCHOOL_CONFIGURATION_DRAFT_NOT_FOUND',
          });
        }
        return draft;
      },
    );

    app.post<{ Body: Static<typeof ImportSchoolConfigurationDraftBody> }>(
      '/api/v1/administration/school-configuration/draft-imports',
      {
        bodyLimit: 2 * 1024 * 1024,
        schema: {
          operationId: 'importSchoolConfigurationDraft',
          security: [{ staffSession: [] }],
          body: ImportSchoolConfigurationDraftBody,
          response: {
            201: ImportSchoolConfigurationDraftResponse,
            400: ProblemResponse,
            401: ProblemResponse,
            403: ProblemResponse,
            409: ProblemResponse,
            413: ProblemResponse,
            422: ProblemResponse,
            500: ProblemResponse,
          },
        },
      },
      async (request, reply) => {
        const sessionHandle = readSecureOpaqueCookie(
          request.headers.cookie,
          staffSessionCookie,
        );
        if (!sessionHandle) throw new StaffAuthenticationFailedError();
        const result = await schoolConfiguration.importDraft({
          ...request.body,
          sessionHandle,
        });
        return reply.code(201).send(result);
      },
    );

    app.post<{
      Body: Static<typeof PublishSchoolConfigurationReleaseBody>;
    }>(
      '/api/v1/administration/school-configuration/releases',
      {
        schema: {
          operationId: 'publishSchoolConfigurationRelease',
          security: [{ staffSession: [] }],
          body: PublishSchoolConfigurationReleaseBody,
          response: {
            201: PublishSchoolConfigurationReleaseResponse,
            400: ProblemResponse,
            401: ProblemResponse,
            403: ProblemResponse,
            409: ProblemResponse,
            413: ProblemResponse,
            422: ProblemResponse,
            500: ProblemResponse,
          },
        },
      },
      async (request, reply) => {
        const sessionHandle = readSecureOpaqueCookie(
          request.headers.cookie,
          staffSessionCookie,
        );
        if (!sessionHandle) throw new StaffAuthenticationFailedError();
        const result = await schoolConfiguration.publish({
          ...request.body,
          sessionHandle,
        });
        return reply.code(201).send(result);
      },
    );
  }

  app.post<{ Body: Static<typeof RedeemInvitationBody> }>(
    '/api/v1/auth/student/invitations/redeem',
    {
      schema: {
        operationId: 'redeemInvitation',
        body: RedeemInvitationBody,
        response: {
          200: StudentSessionCreatedResponse,
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const grant = await identityAndAccess.redeemInvitation(request.body);
      reply.header(
        'set-cookie',
        setSecureOpaqueCookie(studentSessionCookie, grant.sessionHandle),
      );
      return { outcome: 'authenticated' as const };
    },
  );

  app.get(
    '/api/v1/student/session',
    {
      schema: {
        operationId: 'readStudentSession',
        security: [{ studentSession: [] }],
        response: {
          200: StudentSessionResponse,
          401: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        studentSessionCookie,
      );
      const session =
        sessionHandle &&
        (await identityAndAccess.resolveStudentSession({ sessionHandle }));
      if (!session) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/student-session',
          title: 'Student session required',
          status: 401,
          code: 'STUDENT_SESSION_REQUIRED',
        });
      }
      return session;
    },
  );

  function studentSessionRequired(reply: {
    type(value: string): {
      code(status: number): { send(payload: unknown): unknown };
    };
  }) {
    return reply.type('application/problem+json').code(401).send({
      type: 'https://preventive-care-literacy.example/problems/student-session',
      title: 'Student session required',
      status: 401,
      code: 'STUDENT_SESSION_REQUIRED',
    });
  }

  app.get<{ Querystring: Static<typeof StudentIntakeQuery> }>(
    '/api/v1/student/intake',
    {
      schema: {
        operationId: 'readStudentIntake',
        security: [{ studentSession: [] }],
        querystring: StudentIntakeQuery,
        response: {
          200: StudentIntakeSnapshotResponse,
          401: ProblemResponse,
          404: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        studentSessionCookie,
      );
      if (!sessionHandle || !options.intake) {
        return studentSessionRequired(reply);
      }
      const snapshot = await options.intake.read({
        sessionHandle,
        locale: request.query.locale ?? 'en-US',
      });
      if (!snapshot) return studentSessionRequired(reply);
      return snapshot;
    },
  );

  app.put<{ Body: Static<typeof SaveIntakeDraftBody> }>(
    '/api/v1/student/intake/draft',
    {
      schema: {
        operationId: 'saveIntakeDraft',
        security: [{ studentSession: [] }],
        body: SaveIntakeDraftBody,
        response: {
          200: SaveIntakeDraftResponse,
          400: ProblemResponse,
          401: ProblemResponse,
          404: ProblemResponse,
          409: ProblemResponse,
          413: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        studentSessionCookie,
      );
      if (!sessionHandle || !options.intake) {
        return studentSessionRequired(reply);
      }
      const result = await options.intake.saveDraft({
        sessionHandle,
        ...request.body,
      });
      if (!result) return studentSessionRequired(reply);
      return result;
    },
  );

  app.post<{ Body: Static<typeof SubmitIntakeRecordVersionBody> }>(
    '/api/v1/student/intake/submissions',
    {
      schema: {
        operationId: 'submitIntakeRecordVersion',
        security: [{ studentSession: [] }],
        body: SubmitIntakeRecordVersionBody,
        response: {
          201: SubmitIntakeRecordVersionResponse,
          400: ProblemResponse,
          401: ProblemResponse,
          404: ProblemResponse,
          409: ProblemResponse,
          413: ProblemResponse,
          422: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        studentSessionCookie,
      );
      if (!sessionHandle || !options.intake) {
        return studentSessionRequired(reply);
      }
      const result = await options.intake.submit({
        sessionHandle,
        ...request.body,
      });
      if (!result) return studentSessionRequired(reply);
      return reply.code(201).send(result);
    },
  );

  app.get<{ Querystring: Static<typeof StudentLearningQuery> }>(
    '/api/v1/student/learning',
    {
      schema: {
        operationId: 'readStudentLearning',
        security: [{ studentSession: [] }],
        querystring: StudentLearningQuery,
        response: {
          200: StudentLearningSnapshotResponse,
          401: ProblemResponse,
          404: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        studentSessionCookie,
      );
      if (!sessionHandle || !options.learningProgress) {
        return studentSessionRequired(reply);
      }
      const snapshot = await options.learningProgress.read({
        sessionHandle,
        locale: request.query.locale ?? 'en-US',
      });
      if (!snapshot) return studentSessionRequired(reply);
      return snapshot;
    },
  );

  app.post<{ Body: Static<typeof AcknowledgeLearningItemBody> }>(
    '/api/v1/student/learning/acknowledgements',
    {
      schema: {
        operationId: 'acknowledgeLearningItem',
        security: [{ studentSession: [] }],
        body: AcknowledgeLearningItemBody,
        response: {
          201: AcknowledgeLearningItemResponse,
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          404: ProblemResponse,
          409: ProblemResponse,
          413: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        studentSessionCookie,
      );
      if (!sessionHandle || !options.learningProgress) {
        return studentSessionRequired(reply);
      }
      const result = await options.learningProgress.acknowledge({
        sessionHandle,
        ...request.body,
      });
      if (!result) return studentSessionRequired(reply);
      return reply.code(201).send(result);
    },
  );

  app.setNotFoundHandler((request, reply) => {
    if (
      options.webRoot &&
      request.method === 'GET' &&
      !request.url.startsWith('/api/') &&
      !request.url.startsWith('/internal/')
    ) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }
    return reply.type('application/problem+json').code(404).send({
      type: 'https://preventive-care-literacy.example/problems/not-found',
      title: 'Resource not found',
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  await app.ready();
  return app;
}

export async function createServer(options: {
  databaseUrl: string;
  databaseCaCertificate?: string;
  operatorCredentials: { token: string; actorId: string };
  staffAuth: StaffAuthProvider;
  publicOrigin: string;
  telemetry?: Telemetry;
  webRoot?: string;
  clock?: Clock;
  ids?: IdGenerator;
  invitationSecrets?: InvitationSecretKeys;
  wrappingKeys?: EnvelopeKeyMaterial;
  applicationKeys?: ApplicationKeyManagement;
  releasePackages?: ReleasePackageStorage;
  buildIdentity?: BuildAttestation;
}): Promise<FastifyInstance> {
  const connectionUrl = new URL(options.databaseUrl);
  if (options.databaseCaCertificate) {
    // A local sslrootcert path cannot exist in Railway, so use its PEM variable.
    connectionUrl.searchParams.delete('sslmode');
    connectionUrl.searchParams.delete('sslrootcert');
  }
  const pool = new Pool({
    connectionString: connectionUrl.toString(),
    ...(options.databaseCaCertificate
      ? {
          ssl: {
            ca: options.databaseCaCertificate,
            rejectUnauthorized: true,
          },
        }
      : {}),
  });
  try {
    await assertRestrictedDatabaseRole(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  const clock = options.clock ?? { now: () => new Date() };
  const ids = options.ids ?? { create: randomUUID };
  const identityAndAccess = createPostgresIdentityAndAccess({
    pool,
    staffAuth: options.staffAuth,
    clock,
    ids,
    handles: {
      create: () => randomBytes(32).toString('base64url'),
      hash: sha256SessionHandle,
    },
    invitationSecrets: createInvitationSecretProtector(
      options.invitationSecrets ?? {
        hmacKey: randomBytes(32),
        encryptionKeys: { ephemeral: randomBytes(32) },
        activeEncryptionKeyId: 'ephemeral',
      },
    ),
  });
  const schoolConfiguration = createSchoolConfiguration({
    identityAndAccess,
    store: createPostgresSchoolConfigurationStore({
      pool,
      hashSessionHandle: sha256SessionHandle,
    }),
    packages: options.releasePackages ?? createMemoryReleasePackageStorage(),
    clock,
    ids,
  });
  const intake = createIntake({
    resolveStudentSession: (command) =>
      identityAndAccess.resolveStudentSession(command),
    store: createPostgresIntakeStore({ pool }),
    keys:
      options.applicationKeys ??
      createEnvelopeKeyManagement(
        options.wrappingKeys ?? {
          wrappingKeys: { ephemeral: randomBytes(32) },
          activeWrappingKeyId: 'ephemeral',
          idempotencyKey: randomBytes(32),
        },
      ),
    clock,
    ids,
    hashSessionHandle: sha256SessionHandle,
  });
  const learningProgress = createLearningProgress({
    resolveStudentSession: (command) =>
      identityAndAccess.resolveStudentSession(command),
    store: createPostgresLearningProgressStore({ pool }),
    clock,
    ids,
  });
  return buildApp(identityAndAccess, {
    operatorAuthenticator: createOperatorAuthenticator(
      options.operatorCredentials,
    ),
    publicOrigin: options.publicOrigin,
    readiness: async () => {
      await pool.query('select 1');
    },
    telemetry:
      options.telemetry ?? createTelemetry((line) => console.log(line)),
    webRoot: options.webRoot,
    schoolConfiguration,
    intake,
    learningProgress,
    verifyBuildAttestation: async () => {
      try {
        return await verifyBuildAttestationForHealth(process.cwd());
      } catch {
        return undefined;
      }
    },
    queryGoldenJourneyEvidence: (input) =>
      queryGoldenJourneyOperatorEvidence(pool, input),
    onClose: () => pool.end(),
  });
}
