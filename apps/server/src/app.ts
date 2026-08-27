import swagger from '@fastify/swagger';
import fastifyStatic from '@fastify/static';
import { Type, type Static } from '@sinclair/typebox';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
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
  StudentClassAccessRequiredError,
  StaffSessionExpiredError,
  StaffSessionRevokedError,
  StepUpIncompleteError,
  StepUpRejectedError,
  AdministrativePermissionRequiredError,
  FirstAdministratorRequiredError,
  LastAdministratorRequiredError,
  StaffIdentityNotFoundError,
  ClassNotFoundError,
  ClassClosedError,
  InvitationNotFoundError,
  ClassMembershipNotFoundError,
  InvitationNotSendableError,
  InvitationCsvRejectedError,
  StudentNotFoundError,
  StudentIdentityReviewRequiredError,
} from '../../../modules/identity-access/index.ts';
import type {
  Intake,
  UnattributedRevealOutcome,
} from '../../../modules/intake/index.ts';
import {
  IntakeAlreadyAcceptedError,
  IntakeCurrentRevisionConflictError,
  IntakeDraftRevisionConflictError,
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
import type {
  DraftEdit,
  SchoolConfiguration,
} from '../../../modules/school-configuration/index.ts';
import {
  ActiveReleaseConflictError,
  AuthenticationFreshnessRequiredError,
  CandidateFingerprintConflictError,
  DraftVersionConflictError,
  InvalidSchoolConfigurationError,
  OperationIdReusedError,
  ResourceRevisionConflictError,
  TranslationAdapterRejectedError,
  TranslationProviderUnavailableError,
  UnsafeGeneratedTranslationError,
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
import type { TranslationAdapter } from '../../../modules/school-configuration/index.ts';
import {
  createPostgresSchoolConfigurationStore,
  sha256SessionHandle,
} from '../../../packages/postgres/src/school-configuration.ts';
import { translationAdapterFromEnvironment } from '../../../packages/translation-adapter/src/index.ts';
import { createMemoryReleasePackageStorage } from '../../../packages/release-package-storage/src/index.ts';
import type { ReleasePackageStorage } from '../../../modules/school-configuration/index.ts';
import { createPostgresIntakeStore } from '../../../packages/postgres/src/intake.ts';
import { createPostgresLearningProgressStore } from '../../../packages/postgres/src/learning-progress.ts';
import { queryGoldenJourneyOperatorEvidence } from '../../../packages/postgres/src/golden-journey-evidence.ts';
import {
  listOperatorWorkspaces,
  type OperatorWorkspaceSummary,
} from '../../../packages/postgres/src/operator-workspaces.ts';
import {
  BUILD_ATTESTATION_SCHEMA_VERSION,
  verifyBuildAttestationForHealth,
  type BuildAttestation,
} from '../../../packages/build-attestation/src/index.ts';

const staffSessionCookie = '__Host-prevcare-staff-session' as const;
const studentSessionCookie = '__Host-prevcare-student-session' as const;
const operatorSessionCookie = '__Host-prevcare-operator-session' as const;
const operatorSessionLifetimeSeconds = 60 * 60;

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

const OperatorAuthenticationHeaders = Type.Object({
  authorization: Type.Optional(Type.String()),
});

const OperatorSignInBody = Type.Object(
  { token: Type.String({ minLength: 1, maxLength: 4096 }) },
  { additionalProperties: false },
);

const OperatorSessionCreatedResponse = Type.Object({
  outcome: Type.Literal('authenticated'),
});

const OperatorSessionEndedResponse = Type.Object({
  outcome: Type.Literal('ended'),
});

const OperatorSessionResponse = Type.Object({ actorId: Type.String() });

const StaffPermissionSchema = Type.Union([
  Type.Literal('administrative'),
  Type.Literal('clinical'),
]);

const OperatorStaffIdentitySummaryResponse = Type.Object(
  {
    staffIdentityId: Type.String({ format: 'uuid' }),
    displayName: Type.String(),
    email: Type.String(),
    permissions: Type.Array(StaffPermissionSchema),
    status: Type.Union([Type.Literal('active'), Type.Literal('disabled')]),
    createdAt: Type.String({ format: 'date-time' }),
    activatedAt: Type.Union([
      Type.String({ format: 'date-time' }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

const OperatorWorkspaceSummaryResponse = Type.Object(
  {
    workspaceId: Type.String({ format: 'uuid' }),
    displayName: Type.String(),
    createdAt: Type.String({ format: 'date-time' }),
    staffCount: Type.Integer({ minimum: 0 }),
    configurationState: Type.Union([
      Type.Literal('uninitialized'),
      Type.Literal('draft'),
      Type.Literal('active'),
    ]),
    draftVersion: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    activeReleaseId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    staffIdentities: Type.Array(OperatorStaffIdentitySummaryResponse),
  },
  { additionalProperties: false },
);

const OperatorWorkspaceCatalogResponse = Type.Array(
  OperatorWorkspaceSummaryResponse,
  { maxItems: 500 },
);

const CreateSchoolWorkspaceResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('created'),
});

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

const StaffLifecycleActorBody = {
  operationId: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  staffIdentityId: Type.String({ format: 'uuid' }),
  schoolApprover: Type.String({ minLength: 1, maxLength: 200 }),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
} as const;

const RecoverStaffIdentityBody = Type.Object(
  {
    ...StaffLifecycleActorBody,
    newPassword: Type.String({ minLength: 12, maxLength: 200 }),
  },
  { additionalProperties: false },
);

const RecoverStaffIdentityResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  staffIdentityId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('recovered'),
});

const DisableStaffIdentityBody = Type.Object(StaffLifecycleActorBody, {
  additionalProperties: false,
});

const DisableStaffIdentityResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  staffIdentityId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('disabled'),
});

const ReplaceStaffPermissionsBody = Type.Object(
  {
    ...StaffLifecycleActorBody,
    permissions: Type.Array(StaffPermissionSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

const ReplaceStaffPermissionsResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  staffIdentityId: Type.String({ format: 'uuid' }),
  permissions: Type.Array(StaffPermissionSchema),
  outcome: Type.Literal('replaced'),
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
const InvitationRecipientSchema = Type.String({
  maxLength: 322,
  pattern: '^\\s*[^\\s@]+@[^\\s@]+\\s*$',
});
const InvitationStatusSchema = Type.Union([
  Type.Literal('pending_delivery'),
  Type.Literal('delivered'),
  Type.Literal('delivery_failed'),
  Type.Literal('expired'),
  Type.Literal('completed'),
  Type.Literal('revoked'),
  Type.Literal('superseded'),
]);
const CreateClassInvitationResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  classId: Type.String({ format: 'uuid' }),
  invitationId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('created'),
});
const CreateClassBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    classId: Type.String({ format: 'uuid' }),
    name: Type.String({ minLength: 1, maxLength: 200, pattern: '.*\\S.*' }),
  },
  { additionalProperties: false },
);
const CreateClassResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  classId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('created'),
});
const PreviewClassInvitationBody = Type.Object(
  {
    classId: Type.String({ format: 'uuid' }),
    recipient: InvitationRecipientSchema,
  },
  { additionalProperties: false },
);
const PreviewClassInvitationResponse = Type.Union([
  Type.Object({
    outcome: Type.Literal('ready'),
    reuse: Type.Union([
      Type.Literal('none'),
      Type.Literal('existing_student'),
      Type.Literal('inactive_membership'),
    ]),
  }),
  Type.Object({ outcome: Type.Literal('already_a_member') }),
  Type.Object({ outcome: Type.Literal('already_invited') }),
  Type.Object({
    outcome: Type.Literal('identity_review'),
    reason: Type.Literal('historical_binding'),
  }),
  Type.Object({ outcome: Type.Literal('class_closed') }),
]);
const InvitationCsvReuseSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('existing_student'),
  Type.Literal('inactive_membership'),
]);
const PreviewClassInvitationCsvBody = Type.Object(
  {
    classId: Type.String({ format: 'uuid' }),
    csv: Type.String({ maxLength: 64 * 1024 }),
  },
  { additionalProperties: false },
);
const ClassInvitationCsvPreviewRow = Type.Union([
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('ready'),
    reuse: InvitationCsvReuseSchema,
  }),
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('malformed'),
  }),
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('duplicate_in_file'),
  }),
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('already_a_member'),
  }),
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('already_invited'),
  }),
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('identity_review'),
    reason: Type.Literal('historical_binding'),
  }),
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('class_closed'),
  }),
]);
const PreviewClassInvitationCsvResponse = Type.Object({
  classId: Type.String({ format: 'uuid' }),
  rows: Type.Array(ClassInvitationCsvPreviewRow, { maxItems: 500 }),
  summary: Type.Object({
    ready: Type.Integer({ minimum: 0 }),
    skipped: Type.Integer({ minimum: 0 }),
  }),
});
const SendClassInvitationCsvBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    classId: Type.String({ format: 'uuid' }),
    csv: Type.String({ maxLength: 64 * 1024 }),
    selectedLineNumbers: Type.Array(Type.Integer({ minimum: 1 }), {
      maxItems: 500,
    }),
  },
  { additionalProperties: false },
);
const ClassInvitationCsvSendRow = Type.Union([
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('sent'),
    invitationId: Type.String({ format: 'uuid' }),
    reuse: InvitationCsvReuseSchema,
  }),
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('malformed'),
  }),
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('duplicate_in_file'),
  }),
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('already_a_member'),
  }),
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('already_invited'),
  }),
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('identity_review'),
    reason: Type.Literal('historical_binding'),
  }),
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('class_closed'),
  }),
  Type.Object({
    lineNumber: Type.Integer({ minimum: 1 }),
    field: Type.String({ maxLength: 322 }),
    outcome: Type.Literal('not_selected'),
  }),
]);
const SendClassInvitationCsvResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  classId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('applied'),
  summary: Type.Object({
    sent: Type.Integer({ minimum: 0 }),
    skipped: Type.Integer({ minimum: 0 }),
    deliveryProblems: Type.Integer({ minimum: 0 }),
  }),
  rows: Type.Array(ClassInvitationCsvSendRow, { maxItems: 500 }),
});
const SendClassInvitationBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    classId: Type.String({ format: 'uuid' }),
    invitationId: Type.String({ format: 'uuid' }),
    recipient: InvitationRecipientSchema,
  },
  { additionalProperties: false },
);
const ResendClassInvitationBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    invitationId: Type.String({ format: 'uuid' }),
    replacementInvitationId: Type.String({ format: 'uuid' }),
  },
  { additionalProperties: false },
);
const ResendClassInvitationResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  classId: Type.String({ format: 'uuid' }),
  invitationId: Type.String({ format: 'uuid' }),
  supersededInvitationId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('superseded'),
});
const RevokeClassInvitationBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    invitationId: Type.String({ format: 'uuid' }),
  },
  { additionalProperties: false },
);
const RevokeClassInvitationResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  invitationId: Type.String({ format: 'uuid' }),
  outcome: Type.Union([
    Type.Literal('revoked'),
    Type.Literal('unchanged_redeemed'),
  ]),
});
const DeactivateClassMembershipBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    classMembershipId: Type.String({ format: 'uuid' }),
  },
  { additionalProperties: false },
);
const DeactivateClassMembershipResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  classMembershipId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('deactivated'),
});
const CloseClassBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    classId: Type.String({ format: 'uuid' }),
  },
  { additionalProperties: false },
);
const CloseClassResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  classId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('closed'),
  revokedInvitationCount: Type.Integer({ minimum: 0 }),
  deactivatedMembershipCount: Type.Integer({ minimum: 0 }),
});
const StudentVerifiedEmailReplacementReasonSchema = Type.Union([
  Type.Literal('mailbox_loss'),
  Type.Literal('school_issued_address_change'),
  Type.Literal('incorrect_address'),
]);
const StudentIdentityVerificationSchema = Type.Union([
  Type.Literal('in_person_school_id'),
  Type.Literal('guardian_confirmed'),
  Type.Literal('school_record_match'),
]);
const ReplaceStudentVerifiedEmailBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    studentId: Type.String({ format: 'uuid' }),
    recipient: InvitationRecipientSchema,
    reason: StudentVerifiedEmailReplacementReasonSchema,
    identityVerification: StudentIdentityVerificationSchema,
  },
  { additionalProperties: false },
);
const ReplaceStudentVerifiedEmailResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  studentId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('replaced'),
});
const StudentDisablementReasonSchema = Type.Union([
  Type.Literal('compromised_access'),
  Type.Literal('safety_hold'),
  Type.Literal('school_directed'),
]);
const DisableStudentAccessBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    studentId: Type.String({ format: 'uuid' }),
    reason: StudentDisablementReasonSchema,
  },
  { additionalProperties: false },
);
const DisableStudentAccessResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  studentId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('disabled'),
});
const StudentReenablementReasonSchema = Type.Union([
  Type.Literal('access_restored'),
  Type.Literal('hold_released'),
]);
const EnableStudentAccessBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    studentId: Type.String({ format: 'uuid' }),
    reason: StudentReenablementReasonSchema,
  },
  { additionalProperties: false },
);
const EnableStudentAccessResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  studentId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('enabled'),
});
const ClassDirectoryResponse = Type.Object({
  classes: Type.Array(
    Type.Object({
      classId: Type.String({ format: 'uuid' }),
      name: Type.String(),
      createdAt: Type.String({ format: 'date-time' }),
      status: Type.Union([Type.Literal('open'), Type.Literal('closed')]),
      closedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
      invitations: Type.Array(
        Type.Object({
          invitationId: Type.String({ format: 'uuid' }),
          purpose: Type.Literal('join_class'),
          generation: Type.Integer({ minimum: 1 }),
          status: InvitationStatusSchema,
          expiresAt: Type.String({ format: 'date-time' }),
        }),
      ),
      relationships: Type.Array(
        Type.Object({
          recipient: Type.String(),
          studentId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
          classMembershipId: Type.Union([
            Type.String({ format: 'uuid' }),
            Type.Null(),
          ]),
          membershipStatus: Type.Union([
            Type.Literal('none'),
            Type.Literal('active'),
            Type.Literal('inactive'),
          ]),
          studentAccessStatus: Type.Union([
            Type.Literal('active'),
            Type.Literal('disabled'),
            Type.Null(),
          ]),
          currentVerifiedEmail: Type.Union([Type.String(), Type.Null()]),
          verifiedEmailHistory: Type.Array(
            Type.Object({
              recipient: Type.String(),
              status: Type.Union([
                Type.Literal('current'),
                Type.Literal('historical'),
              ]),
              verifiedAt: Type.String({ format: 'date-time' }),
              retiredAt: Type.Union([
                Type.String({ format: 'date-time' }),
                Type.Null(),
              ]),
            }),
          ),
          identityCollision: Type.Union([
            Type.Literal('none'),
            Type.Literal('historical_binding'),
          ]),
          latestInvitation: Type.Object({
            invitationId: Type.String({ format: 'uuid' }),
            purpose: Type.Literal('join_class'),
            generation: Type.Integer({ minimum: 1 }),
            status: InvitationStatusSchema,
            expiresAt: Type.String({ format: 'date-time' }),
          }),
          deliveryStatus: Type.Union([
            Type.Literal('delivered'),
            Type.Literal('delayed'),
            Type.Literal('failed'),
          ]),
          history: Type.Array(
            Type.Object({
              invitationId: Type.String({ format: 'uuid' }),
              status: InvitationStatusSchema,
              generation: Type.Integer({ minimum: 1 }),
              createdAt: Type.String({ format: 'date-time' }),
            }),
          ),
        }),
      ),
    }),
  ),
});

const StudentEmailCodeBody = Type.Object(
  {
    recipient: Type.String({
      maxLength: 322,
      pattern: '^\\s*[^\\s@]+@[^\\s@]+\\s*$',
    }),
    code: Type.String({ pattern: '^[0-9]{6}$' }),
  },
  { additionalProperties: false },
);
const RedeemInvitationBody = StudentEmailCodeBody;
const StudentSignInVerifyBody = StudentEmailCodeBody;
const StudentSignInRequestBody = Type.Object(
  {
    recipient: Type.String({
      maxLength: 322,
      pattern: '^\\s*[^\\s@]+@[^\\s@]+\\s*$',
    }),
  },
  { additionalProperties: false },
);
const StudentSignInAcceptedResponse = Type.Object({
  outcome: Type.Literal('accepted'),
});
const StudentSessionCreatedResponse = Type.Object({
  outcome: Type.Literal('authenticated'),
});
const IntakeLocaleSchema = Type.Union([
  Type.Literal('en-US'),
  Type.Literal('es-US'),
  Type.Literal('pt-BR'),
  Type.Literal('fr-CA'),
  Type.Literal('ht-HT'),
]);
const SaveStudentLanguageBody = Type.Object(
  {
    languageChoice: IntakeLocaleSchema,
  },
  { additionalProperties: false },
);
const SaveStudentLanguageResponse = Type.Object({
  languageChoice: IntakeLocaleSchema,
});
const StudentSessionResponse = Type.Object({
  studentId: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  languageChoice: IntakeLocaleSchema,
  activeClassMemberships: Type.Array(
    Type.Object({
      classId: Type.String({ format: 'uuid' }),
      name: Type.String(),
    }),
  ),
});
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
          Type.Literal('email'),
          Type.Literal('single-choice'),
          Type.Literal('multiple-choice'),
          Type.Literal('acknowledgement'),
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
  intakeUpdateRequirement: Type.Union([
    Type.Null(),
    Type.Object({
      currentIntakeRecordVersionId: Type.String({ format: 'uuid' }),
      currentSchoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
      currentIntakeForm: ExactResourceRevisionSchema,
      currentSubmissionAttestation: ExactResourceRevisionSchema,
      activeSchoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
      activeIntakeForm: ExactResourceRevisionSchema,
      activeSubmissionAttestation: ExactResourceRevisionSchema,
      impactedFieldIds: Type.Array(Type.String({ format: 'uuid' })),
    }),
  ]),
  draft: Type.Union([
    Type.Null(),
    Type.Object({
      draftRevision: Type.Integer({ minimum: 1 }),
      locale: IntakeLocaleSchema,
      updatedAt: Type.String({ format: 'date-time' }),
      schoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
      intakeForm: ExactResourceRevisionSchema,
      answers: IntakeAnswersSchema,
      compatibility: Type.Union([
        Type.Literal('current'),
        Type.Literal('presentation-equivalent'),
        Type.Literal('canonical-change'),
      ]),
      reviewFieldIds: Type.Array(Type.String({ format: 'uuid' })),
    }),
  ]),
  form: StudentIntakeFormResponse,
});
const SaveIntakeDraftBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    expectedDraftRevision: Type.Integer({ minimum: 0 }),
    expectedSchoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
    expectedIntakeForm: ExactResourceRevisionSchema,
    locale: IntakeLocaleSchema,
    answers: IntakeAnswersSchema,
  },
  { additionalProperties: false },
);
const SaveIntakeDraftResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  locale: IntakeLocaleSchema,
  updatedAt: Type.String({ format: 'date-time' }),
  draftRevision: Type.Integer({ minimum: 1 }),
  replayed: Type.Boolean(),
});
const ReopenIntakeRecordBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    expectedCurrentIntakeRecordVersionId: Type.String({ format: 'uuid' }),
    locale: IntakeLocaleSchema,
  },
  { additionalProperties: false },
);
const ReopenIntakeRecordResponse = SaveIntakeDraftResponse;
const RebaseIntakeDraftBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    expectedDraftRevision: Type.Integer({ minimum: 1 }),
    locale: IntakeLocaleSchema,
  },
  { additionalProperties: false },
);
const RebaseIntakeDraftResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  locale: IntakeLocaleSchema,
  updatedAt: Type.String({ format: 'date-time' }),
  draftRevision: Type.Integer({ minimum: 1 }),
  replayed: Type.Boolean(),
  reviewFieldIds: Type.Array(Type.String({ format: 'uuid' })),
  omittedFieldIds: Type.Array(Type.String({ format: 'uuid' })),
});
const SubmitIntakeRecordVersionBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    expectedSchoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
    expectedIntakeForm: ExactResourceRevisionSchema,
    expectedSubmissionAttestation: ExactResourceRevisionSchema,
    expectedDraftRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    expectedCurrentIntakeRecordVersionId: Type.Optional(
      Type.String({ format: 'uuid' }),
    ),
    locale: IntakeLocaleSchema,
    answers: IntakeAnswersSchema,
    attestation: Type.Object({
      locale: IntakeLocaleSchema,
      notice: ExactResourceRevisionSchema,
    }),
  },
  { additionalProperties: false },
);
const IntakeChangedFieldResponse = Type.Object({
  fieldId: Type.String({ format: 'uuid' }),
  change: Type.Union([
    Type.Literal('added'),
    Type.Literal('removed'),
    Type.Literal('changed'),
  ]),
});
const SubmitIntakeRecordVersionResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  intakeRecordVersionId: Type.String({ format: 'uuid' }),
  acceptedAt: Type.String({ format: 'date-time' }),
  learningUnlocked: Type.Literal(true),
  replayed: Type.Boolean(),
  predecessorIntakeRecordVersionId: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
  changedFields: Type.Array(IntakeChangedFieldResponse),
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
  intakeUpdateRequirement: Type.Union([
    Type.Null(),
    Type.Object({
      currentIntakeRecordVersionId: Type.String({ format: 'uuid' }),
      currentSchoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
      currentIntakeForm: ExactResourceRevisionSchema,
      currentSubmissionAttestation: ExactResourceRevisionSchema,
      activeSchoolConfigurationReleaseId: Type.String({ format: 'uuid' }),
      activeIntakeForm: ExactResourceRevisionSchema,
      activeSubmissionAttestation: ExactResourceRevisionSchema,
      impactedFieldIds: Type.Array(Type.String({ format: 'uuid' })),
    }),
  ]),
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
  activeReleaseNumber: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  candidateFingerprint: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  candidate: Type.Unknown(),
  unpublishedChanges: Type.Boolean(),
  validation: Type.Object({
    blockers: Type.Array(
      Type.Object({
        code: Type.String(),
        path: Type.String(),
        message: Type.String(),
        severity: Type.Literal('blocker'),
        location: Type.Object({
          editorResource: Type.Union([
            Type.Literal('branding'),
            Type.Literal('modules'),
            Type.Literal('intake'),
            Type.Literal('translations'),
          ]),
          previewScreen: Type.Union([
            Type.Literal('home'),
            Type.Literal('module'),
            Type.Literal('intake'),
          ]),
          locale: Type.Optional(
            Type.Union([
              Type.Literal('en-US'),
              Type.Literal('es-US'),
              Type.Literal('pt-BR'),
              Type.Literal('fr-CA'),
              Type.Literal('ht-HT'),
            ]),
          ),
          moduleId: Type.Optional(Type.String({ format: 'uuid' })),
          resourceId: Type.Optional(Type.String({ format: 'uuid' })),
        }),
      }),
    ),
    warnings: Type.Array(
      Type.Object({
        code: Type.String(),
        path: Type.String(),
        message: Type.String(),
        severity: Type.Literal('warning'),
        location: Type.Object({
          editorResource: Type.Union([
            Type.Literal('branding'),
            Type.Literal('modules'),
            Type.Literal('intake'),
            Type.Literal('translations'),
          ]),
          previewScreen: Type.Union([
            Type.Literal('home'),
            Type.Literal('module'),
            Type.Literal('intake'),
          ]),
          locale: Type.Optional(
            Type.Union([
              Type.Literal('en-US'),
              Type.Literal('es-US'),
              Type.Literal('pt-BR'),
              Type.Literal('fr-CA'),
              Type.Literal('ht-HT'),
            ]),
          ),
          moduleId: Type.Optional(Type.String({ format: 'uuid' })),
          resourceId: Type.Optional(Type.String({ format: 'uuid' })),
        }),
      }),
    ),
  }),
  comparisons: Type.Array(
    Type.Object({
      resourceId: Type.String({ format: 'uuid' }),
      kind: Type.String(),
      slot: Type.String(),
      label: Type.String(),
      draftRevision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      activeRevision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      differs: Type.Boolean(),
      change: Type.Union([
        Type.Literal('added'),
        Type.Literal('removed'),
        Type.Literal('changed'),
        Type.Literal('unchanged'),
      ]),
      discardEligible: Type.Boolean(),
      archiveEligible: Type.Boolean(),
    }),
  ),
  managedTranslations: Type.Object({
    locales: Type.Array(
      Type.Object({
        locale: Type.Union([
          Type.Literal('es-US'),
          Type.Literal('pt-BR'),
          Type.Literal('fr-CA'),
          Type.Literal('ht-HT'),
        ]),
        missing: Type.Integer({ minimum: 0 }),
        stale: Type.Integer({ minimum: 0 }),
        generated: Type.Integer({ minimum: 0 }),
        reviewed: Type.Integer({ minimum: 0 }),
      }),
    ),
    items: Type.Array(
      Type.Object({
        path: Type.String(),
        locale: Type.Union([
          Type.Literal('es-US'),
          Type.Literal('pt-BR'),
          Type.Literal('fr-CA'),
          Type.Literal('ht-HT'),
        ]),
        kind: Type.Union([
          Type.Literal('interface_string'),
          Type.Literal('learning_module_field'),
          Type.Literal('intake_question'),
          Type.Literal('intake_answer_option'),
        ]),
        sourceResourceId: Type.String({ format: 'uuid' }),
        translationResourceId: Type.Optional(Type.String({ format: 'uuid' })),
        sourceRevision: Type.Integer({ minimum: 1 }),
        status: Type.Union([
          Type.Literal('missing'),
          Type.Literal('stale'),
          Type.Literal('generated'),
          Type.Literal('reviewed'),
        ]),
        schoolEditable: Type.Boolean(),
        provenance: Type.Optional(
          Type.Object({
            adapter: Type.Optional(Type.String()),
            adapterVersion: Type.Optional(Type.String()),
            model: Type.Optional(Type.String()),
            glossaryRevision: Type.Optional(Type.String()),
            sourceRevision: Type.Integer({ minimum: 1 }),
            generatedAt: Type.Optional(Type.String()),
            reviewer: Type.Optional(Type.String()),
            reviewedAt: Type.Optional(Type.String()),
          }),
        ),
      }),
    ),
  }),
});
const BrandingAssetBody = Type.Object(
  {
    mediaType: Type.String({ maxLength: 100 }),
    width: Type.Integer({ minimum: 1, maximum: 1024 }),
    height: Type.Integer({ minimum: 1, maximum: 1024 }),
    byteLength: Type.Integer({ minimum: 1, maximum: 262144 }),
    src: Type.String({ maxLength: 300000 }),
  },
  { additionalProperties: false },
);
const DraftEditBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    expectedDraftVersion: Type.Integer({ minimum: 0 }),
    expectedResourceRevisions: Type.Array(ExactResourceResponse),
    type: Type.Union([
      Type.Literal('save-workspace-branding'),
      Type.Literal('save-learning-module'),
      Type.Literal('save-learning-module-item'),
      Type.Literal('reorder-learning-modules'),
      Type.Literal('reorder-learning-module-items'),
      Type.Literal('create-learning-module'),
      Type.Literal('create-learning-module-item'),
      Type.Literal('save-intake-form'),
      Type.Literal('save-intake-section'),
      Type.Literal('save-intake-field'),
      Type.Literal('save-intake-option'),
      Type.Literal('reorder-intake-sections'),
      Type.Literal('reorder-intake-fields'),
      Type.Literal('reorder-intake-options'),
      Type.Literal('create-intake-section'),
      Type.Literal('create-intake-field'),
      Type.Literal('create-intake-option'),
      Type.Literal('restore-active-revision'),
      Type.Literal('discard-authored-resource'),
      Type.Literal('archive-authored-resource'),
      Type.Literal('restore-release-assembly'),
      Type.Literal('save-managed-translation'),
      Type.Literal('review-managed-translation'),
    ]),
    resourceId: Type.Optional(Type.String({ format: 'uuid' })),
    releaseId: Type.Optional(Type.String({ format: 'uuid' })),
    moduleId: Type.Optional(Type.String({ format: 'uuid' })),
    fieldId: Type.Optional(Type.String({ format: 'uuid' })),
    sectionId: Type.Optional(Type.String({ format: 'uuid' })),
    collection: Type.Optional(
      Type.Union([
        Type.Literal('knowledgeItems'),
        Type.Literal('skillItems'),
        Type.Literal('applicationItems'),
      ]),
    ),
    orderedResourceIds: Type.Optional(
      Type.Array(Type.String({ format: 'uuid' })),
    ),
    displayName: Type.Optional(Type.String({ maxLength: 200 })),
    shortName: Type.Optional(Type.String({ maxLength: 40 })),
    generatedTextMark: Type.Optional(Type.String({ maxLength: 4 })),
    primaryColor: Type.Optional(Type.String({ maxLength: 7 })),
    accentColor: Type.Optional(Type.String({ maxLength: 7 })),
    logo: Type.Optional(Type.Union([BrandingAssetBody, Type.Null()])),
    secondaryMark: Type.Optional(Type.Union([BrandingAssetBody, Type.Null()])),
    title: Type.Optional(Type.String({ maxLength: 200 })),
    description: Type.Optional(Type.String({ maxLength: 4000 })),
    knowledgeIntroduction: Type.Optional(Type.String({ maxLength: 8000 })),
    text: Type.Optional(Type.String({ maxLength: 8000 })),
    label: Type.Optional(Type.String({ maxLength: 8000 })),
    helpText: Type.Optional(
      Type.Union([Type.String({ maxLength: 8000 }), Type.Null()]),
    ),
    href: Type.Optional(
      Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    ),
    fieldType: Type.Optional(Type.String({ maxLength: 40 })),
    code: Type.Optional(Type.String({ maxLength: 64 })),
    required: Type.Optional(Type.Boolean()),
    requiredWhenVisible: Type.Optional(Type.Boolean()),
    visibility: Type.Optional(
      Type.Union([
        Type.Null(),
        Type.Object({
          fieldId: Type.String({ format: 'uuid' }),
          equalsOptionCode: Type.String({ maxLength: 64 }),
        }),
      ]),
    ),
    locale: Type.Optional(
      Type.Union([
        Type.Literal('es-US'),
        Type.Literal('pt-BR'),
        Type.Literal('fr-CA'),
        Type.Literal('ht-HT'),
      ]),
    ),
  },
  { additionalProperties: false },
);
const EditSchoolConfigurationDraftResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  affectedResources: Type.Array(ExactResourceResponse),
  workspaceId: Type.String({ format: 'uuid' }),
  draftVersion: Type.Integer({ minimum: 0 }),
  activeReleaseId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  activeReleaseNumber: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  candidateFingerprint: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  candidate: Type.Unknown(),
  unpublishedChanges: Type.Boolean(),
  validation: SchoolConfigurationDraftResponse.properties.validation,
  comparisons: SchoolConfigurationDraftResponse.properties.comparisons,
  managedTranslations:
    SchoolConfigurationDraftResponse.properties.managedTranslations,
});
const GenerateManagedTranslationsBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    expectedDraftVersion: Type.Integer({ minimum: 0 }),
    locale: Type.Union([
      Type.Literal('es-US'),
      Type.Literal('pt-BR'),
      Type.Literal('fr-CA'),
      Type.Literal('ht-HT'),
    ]),
    sourceResourceIds: Type.Optional(
      Type.Array(Type.String({ format: 'uuid' })),
    ),
  },
  { additionalProperties: false },
);
const GenerateManagedTranslationsResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  affectedResources: Type.Array(ExactResourceResponse),
  workspaceId: Type.String({ format: 'uuid' }),
  draftVersion: Type.Integer({ minimum: 0 }),
  activeReleaseId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  activeReleaseNumber: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  candidateFingerprint: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  candidate: Type.Unknown(),
  unpublishedChanges: Type.Boolean(),
  validation: SchoolConfigurationDraftResponse.properties.validation,
  comparisons: SchoolConfigurationDraftResponse.properties.comparisons,
  managedTranslations:
    SchoolConfigurationDraftResponse.properties.managedTranslations,
  rejected: Type.Array(
    Type.Object({
      sourceResourceId: Type.String({ format: 'uuid' }),
      locale: Type.Union([
        Type.Literal('es-US'),
        Type.Literal('pt-BR'),
        Type.Literal('fr-CA'),
        Type.Literal('ht-HT'),
      ]),
      code: Type.String(),
    }),
  ),
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
const SchoolConfigurationReleaseComponentResponse = Type.Object({
  resourceId: Type.String({ format: 'uuid' }),
  revisionNumber: Type.Integer({ minimum: 1 }),
  slot: Type.String(),
  kind: Type.String(),
  position: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});
const SchoolConfigurationReleaseSummaryResponse = Type.Object({
  releaseId: Type.String({ format: 'uuid' }),
  releaseNumber: Type.Integer({ minimum: 1 }),
  candidateFingerprint: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  changeDescription: Type.String(),
  publishedAt: Type.String({ format: 'date-time' }),
  publishedBy: Type.String({ format: 'uuid' }),
  active: Type.Boolean(),
  components: Type.Array(SchoolConfigurationReleaseComponentResponse),
});
const ListSchoolConfigurationReleasesResponse = Type.Object({
  releases: Type.Array(SchoolConfigurationReleaseSummaryResponse),
});
const SchoolConfigurationReleaseDetailResponse = Type.Object({
  ...SchoolConfigurationReleaseSummaryResponse.properties,
  candidate: Type.Unknown(),
  comparisons: SchoolConfigurationDraftResponse.properties.comparisons,
});
const SchoolConfigurationReleaseParams = Type.Object({
  releaseId: Type.String({ format: 'uuid' }),
});

const ProblemDetails = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Integer(),
  code: Type.String(),
  draftVersion: Type.Optional(Type.Integer({ minimum: 0 })),
  draftRevision: Type.Optional(Type.Integer({ minimum: 0 })),
  currentIntakeRecordVersionId: Type.Optional(Type.String({ format: 'uuid' })),
  activeReleaseId: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  ),
  activeSchoolConfigurationReleaseId: Type.Optional(
    Type.String({ format: 'uuid' }),
  ),
  activeIntakeForm: Type.Optional(ExactResourceRevisionSchema),
  activeSubmissionAttestation: Type.Optional(ExactResourceRevisionSchema),
  compatibility: Type.Optional(
    Type.Union([
      Type.Literal('presentation-equivalent'),
      Type.Literal('canonical-change'),
    ]),
  ),
  rebaseRequired: Type.Optional(Type.Boolean()),
  impactedFieldIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
  candidateFingerprint: Type.Optional(Type.String()),
  affectedValue: Type.Optional(Type.String()),
  outcome: Type.Optional(Type.String()),
  reason: Type.Optional(Type.String()),
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
    cookieHeader?: string,
  ): { type: 'technical_operator'; id: string } | undefined;
  createSession(token: string): string | undefined;
};

export function createOperatorAuthenticator(
  credentials: { token: string; actorId: string },
  clock: { now(): Date } = { now: () => new Date() },
): OperatorAuthenticator {
  if (credentials.token.length < 32) {
    throw new Error(
      'OPERATOR_PROVISIONING_TOKEN must contain at least 32 characters',
    );
  }
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expectedBearer = digest(`Bearer ${credentials.token}`);
  const expectedToken = digest(credentials.token);
  const actor = {
    type: 'technical_operator',
    id: credentials.actorId,
  } as const;
  const signatureFor = (message: string) =>
    createHmac('sha256', credentials.token)
      .update('prevcare-operator-session/v1\0')
      .update(message)
      .digest('base64url');

  function matches(providedValue: string, expected: Buffer): boolean {
    return timingSafeEqual(digest(providedValue), expected);
  }

  function resolveSession(cookieHeader: string | undefined) {
    const value = readSecureOpaqueCookie(cookieHeader, operatorSessionCookie);
    if (!value) return undefined;
    const parts = value.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return undefined;
    const [version, expiresAtValue, nonce, providedSignature] = parts;
    if (
      !expiresAtValue ||
      !nonce ||
      !providedSignature ||
      !/^\d+$/.test(expiresAtValue)
    ) {
      return undefined;
    }
    const expiresAt = Number(expiresAtValue);
    const now = Math.floor(clock.now().getTime() / 1000);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return undefined;
    const message = `${version}.${expiresAtValue}.${nonce}`;
    if (!matches(providedSignature, digest(signatureFor(message)))) {
      return undefined;
    }
    return actor;
  }

  return {
    authenticate(authorization, cookieHeader) {
      if (authorization && matches(authorization, expectedBearer)) {
        return actor;
      }
      return resolveSession(cookieHeader);
    },
    createSession(token) {
      if (!matches(token, expectedToken)) return undefined;
      const expiresAt =
        Math.floor(clock.now().getTime() / 1000) +
        operatorSessionLifetimeSeconds;
      const message = `v1.${expiresAt}.${randomBytes(24).toString('base64url')}`;
      return `${message}.${signatureFor(message)}`;
    },
  };
}

function parseDraftEdit(body: Static<typeof DraftEditBody>): DraftEdit {
  if (body.type === 'save-workspace-branding') {
    if (
      !body.resourceId ||
      body.displayName === undefined ||
      body.shortName === undefined ||
      body.generatedTextMark === undefined ||
      body.primaryColor === undefined ||
      body.accentColor === undefined
    ) {
      throw new InvalidSchoolConfigurationError('workspace.branding');
    }
    return {
      type: body.type,
      resourceId: body.resourceId,
      displayName: body.displayName,
      shortName: body.shortName,
      generatedTextMark: body.generatedTextMark,
      primaryColor: body.primaryColor,
      accentColor: body.accentColor,
      logo: body.logo,
      secondaryMark: body.secondaryMark,
    };
  }
  if (body.type === 'save-learning-module') {
    if (
      !body.resourceId ||
      body.title === undefined ||
      body.description === undefined ||
      body.knowledgeIntroduction === undefined
    ) {
      throw new InvalidSchoolConfigurationError('release.modules');
    }
    return {
      type: body.type,
      resourceId: body.resourceId,
      title: body.title,
      description: body.description,
      knowledgeIntroduction: body.knowledgeIntroduction,
    };
  }
  if (body.type === 'save-learning-module-item') {
    if (!body.resourceId || body.text === undefined) {
      throw new InvalidSchoolConfigurationError('release.modules');
    }
    return {
      type: body.type,
      resourceId: body.resourceId,
      text: body.text,
      href: body.href,
    };
  }
  if (body.type === 'reorder-learning-modules') {
    if (!body.orderedResourceIds) {
      throw new InvalidSchoolConfigurationError('release.modules');
    }
    return { type: body.type, orderedResourceIds: body.orderedResourceIds };
  }
  if (body.type === 'reorder-learning-module-items') {
    if (!body.moduleId || !body.collection || !body.orderedResourceIds) {
      throw new InvalidSchoolConfigurationError('release.modules');
    }
    return {
      type: body.type,
      moduleId: body.moduleId,
      collection: body.collection,
      orderedResourceIds: body.orderedResourceIds,
    };
  }
  if (body.type === 'create-learning-module') {
    if (body.title === undefined || body.description === undefined) {
      throw new InvalidSchoolConfigurationError('release.modules');
    }
    return {
      type: body.type,
      title: body.title,
      description: body.description,
    };
  }
  if (body.type === 'create-learning-module-item') {
    if (!body.moduleId || !body.collection || body.text === undefined) {
      throw new InvalidSchoolConfigurationError('release.modules');
    }
    return {
      type: body.type,
      moduleId: body.moduleId,
      collection: body.collection,
      text: body.text,
      href: body.href,
    };
  }
  if (body.type === 'save-intake-form') {
    if (
      !body.resourceId ||
      body.title === undefined ||
      body.text === undefined
    ) {
      throw new InvalidSchoolConfigurationError('release.intakeForm');
    }
    return {
      type: body.type,
      resourceId: body.resourceId,
      title: body.title,
      text: body.text,
    };
  }
  if (body.type === 'save-intake-section') {
    if (!body.resourceId || body.title === undefined) {
      throw new InvalidSchoolConfigurationError('release.intakeForm.sections');
    }
    return {
      type: body.type,
      resourceId: body.resourceId,
      title: body.title,
    };
  }
  if (body.type === 'save-intake-field') {
    if (
      !body.resourceId ||
      !body.sectionId ||
      body.fieldType === undefined ||
      body.label === undefined ||
      body.required === undefined ||
      body.requiredWhenVisible === undefined
    ) {
      throw new InvalidSchoolConfigurationError('release.intakeForm.fields');
    }
    return {
      type: body.type,
      resourceId: body.resourceId,
      sectionId: body.sectionId,
      fieldType: body.fieldType,
      label: body.label,
      helpText: body.helpText,
      required: body.required,
      requiredWhenVisible: body.requiredWhenVisible,
      visibility: body.visibility ?? null,
    };
  }
  if (body.type === 'save-intake-option') {
    if (
      !body.resourceId ||
      body.code === undefined ||
      body.label === undefined
    ) {
      throw new InvalidSchoolConfigurationError('release.intakeForm.options');
    }
    return {
      type: body.type,
      resourceId: body.resourceId,
      code: body.code,
      label: body.label,
    };
  }
  if (body.type === 'reorder-intake-sections') {
    if (!body.orderedResourceIds) {
      throw new InvalidSchoolConfigurationError('release.intakeForm.sections');
    }
    return { type: body.type, orderedResourceIds: body.orderedResourceIds };
  }
  if (body.type === 'reorder-intake-fields') {
    if (!body.orderedResourceIds) {
      throw new InvalidSchoolConfigurationError('release.intakeForm.fields');
    }
    return { type: body.type, orderedResourceIds: body.orderedResourceIds };
  }
  if (body.type === 'reorder-intake-options') {
    if (!body.fieldId || !body.orderedResourceIds) {
      throw new InvalidSchoolConfigurationError('release.intakeForm.options');
    }
    return {
      type: body.type,
      fieldId: body.fieldId,
      orderedResourceIds: body.orderedResourceIds,
    };
  }
  if (body.type === 'create-intake-section') {
    if (body.title === undefined) {
      throw new InvalidSchoolConfigurationError('release.intakeForm.sections');
    }
    return { type: body.type, title: body.title };
  }
  if (body.type === 'create-intake-field') {
    if (
      !body.sectionId ||
      body.fieldType === undefined ||
      body.label === undefined
    ) {
      throw new InvalidSchoolConfigurationError('release.intakeForm.fields');
    }
    return {
      type: body.type,
      sectionId: body.sectionId,
      fieldType: body.fieldType,
      label: body.label,
    };
  }
  if (body.type === 'create-intake-option') {
    if (!body.fieldId || body.code === undefined || body.label === undefined) {
      throw new InvalidSchoolConfigurationError('release.intakeForm.options');
    }
    return {
      type: body.type,
      fieldId: body.fieldId,
      code: body.code,
      label: body.label,
    };
  }
  if (body.type === 'restore-active-revision') {
    if (!body.resourceId) {
      throw new InvalidSchoolConfigurationError('activeRevision');
    }
    return { type: body.type, resourceId: body.resourceId };
  }
  if (body.type === 'archive-authored-resource') {
    if (!body.resourceId) {
      throw new InvalidSchoolConfigurationError('archive');
    }
    return { type: body.type, resourceId: body.resourceId };
  }
  if (body.type === 'restore-release-assembly') {
    if (!body.releaseId) {
      throw new InvalidSchoolConfigurationError('release');
    }
    return { type: body.type, releaseId: body.releaseId };
  }
  if (body.type === 'save-managed-translation') {
    if (!body.resourceId || !body.locale || body.text === undefined) {
      throw new InvalidSchoolConfigurationError('managedTranslation');
    }
    return {
      type: body.type,
      resourceId: body.resourceId,
      locale: body.locale,
      text: body.text,
    };
  }
  if (body.type === 'review-managed-translation') {
    if (!body.resourceId || !body.locale) {
      throw new InvalidSchoolConfigurationError('managedTranslation');
    }
    return {
      type: body.type,
      resourceId: body.resourceId,
      locale: body.locale,
    };
  }
  if (!body.resourceId) {
    throw new InvalidSchoolConfigurationError('discard');
  }
  return { type: 'discard-authored-resource', resourceId: body.resourceId };
}

function presentReleaseSummary(release: {
  releaseId: string;
  releaseNumber: number;
  candidateFingerprint: string;
  changeDescription: string;
  publishedAt: Date;
  publishedBy: string;
  active: boolean;
  components: {
    resourceId: string;
    revisionNumber: number;
    slot: string;
    kind: string;
    position: number | null;
  }[];
}) {
  return {
    ...release,
    publishedAt: release.publishedAt.toISOString(),
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
    listOperatorWorkspaces: () => Promise<OperatorWorkspaceSummary[]>;
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

  function authenticateOperator(request: FastifyRequest) {
    return options.operatorAuthenticator.authenticate(
      request.headers.authorization,
      request.headers.cookie,
    );
  }

  function operatorAuthenticationRequired(reply: FastifyReply) {
    return reply.type('application/problem+json').code(401).send({
      type: 'https://preventive-care-literacy.example/problems/operator-authentication',
      title: 'Operator authentication required',
      status: 401,
      code: 'OPERATOR_AUTHENTICATION_REQUIRED',
    });
  }

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
          : route === '/api/v1/administration/staff-identities' ||
              route === '/api/v1/administration/staff-identities/recoveries' ||
              route ===
                '/api/v1/administration/staff-identities/disablements' ||
              route ===
                '/api/v1/administration/staff-identities/permission-replacements'
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
                        : route.startsWith('/api/v1/administration/classes') ||
                            route.startsWith('/api/v1/administration/students')
                          ? 'classes'
                          : route === '/api/v1/auth/student/sign-in'
                            ? 'student-sign-in'
                            : route === '/api/v1/auth/student/sign-in/verify'
                              ? 'student-sign-in-verify'
                              : route === '/api/v1/student/session'
                                ? 'student-session'
                                : route === '/api/v1/student/language'
                                  ? 'student-language'
                                  : route === '/api/v1/student/intake'
                                    ? 'student-intake'
                                    : route === '/api/v1/student/intake/draft'
                                      ? 'student-intake-draft'
                                      : route ===
                                          '/api/v1/student/intake/reopen'
                                        ? 'student-intake-reopen'
                                        : route ===
                                            '/api/v1/student/intake/rebase'
                                          ? 'student-intake-rebase'
                                          : route ===
                                              '/api/v1/student/intake/submissions'
                                            ? 'student-intake-submission'
                                            : route ===
                                                '/api/v1/student/learning'
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
    if (error instanceof FirstAdministratorRequiredError) {
      return reply.type('application/problem+json').code(422).send({
        type: 'https://preventive-care-literacy.example/problems/first-administrator-required',
        title: error.message,
        status: 422,
        code: error.code,
      });
    }
    if (error instanceof StaffIdentityNotFoundError) {
      return reply.type('application/problem+json').code(404).send({
        type: 'https://preventive-care-literacy.example/problems/staff-identity-not-found',
        title: error.message,
        status: 404,
        code: error.code,
      });
    }
    if (error instanceof LastAdministratorRequiredError) {
      return reply.type('application/problem+json').code(422).send({
        type: 'https://preventive-care-literacy.example/problems/last-administrator-required',
        title: error.message,
        status: 422,
        code: error.code,
      });
    }
    if (error instanceof ClassNotFoundError) {
      return reply.type('application/problem+json').code(404).send({
        type: 'https://preventive-care-literacy.example/problems/class-not-found',
        title: error.message,
        status: 404,
        code: error.code,
      });
    }
    if (error instanceof InvitationNotFoundError) {
      return reply.type('application/problem+json').code(404).send({
        type: 'https://preventive-care-literacy.example/problems/invitation-not-found',
        title: error.message,
        status: 404,
        code: error.code,
      });
    }
    if (error instanceof ClassMembershipNotFoundError) {
      return reply.type('application/problem+json').code(404).send({
        type: 'https://preventive-care-literacy.example/problems/class-membership-not-found',
        title: error.message,
        status: 404,
        code: error.code,
      });
    }
    if (error instanceof ClassClosedError) {
      return reply.type('application/problem+json').code(409).send({
        type: 'https://preventive-care-literacy.example/problems/class-closed',
        title: error.message,
        status: 409,
        code: error.code,
      });
    }
    if (error instanceof InvitationNotSendableError) {
      return reply.type('application/problem+json').code(409).send({
        type: 'https://preventive-care-literacy.example/problems/invitation-not-sendable',
        title: error.message,
        status: 409,
        code: error.code,
        outcome: error.outcome,
      });
    }
    if (error instanceof InvitationCsvRejectedError) {
      return reply.type('application/problem+json').code(422).send({
        type: 'https://preventive-care-literacy.example/problems/invitation-csv-rejected',
        title: error.message,
        status: 422,
        code: error.code,
        reason: error.reason,
      });
    }
    if (error instanceof StudentNotFoundError) {
      return reply.type('application/problem+json').code(404).send({
        type: 'https://preventive-care-literacy.example/problems/student-not-found',
        title: error.message,
        status: 404,
        code: error.code,
      });
    }
    if (error instanceof StudentIdentityReviewRequiredError) {
      return reply.type('application/problem+json').code(409).send({
        type: 'https://preventive-care-literacy.example/problems/student-identity-review',
        title: error.message,
        status: 409,
        code: error.code,
        reason: error.reason,
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
    if (
      error instanceof UnsafeGeneratedTranslationError ||
      error instanceof TranslationAdapterRejectedError
    ) {
      return reply
        .type('application/problem+json')
        .code(422)
        .send({
          type: 'https://preventive-care-literacy.example/problems/managed-translation-rejected',
          title: error.message,
          status: 422,
          code: error.code,
          ...(error.affectedValue
            ? { affectedValue: error.affectedValue }
            : {}),
        });
    }
    if (error instanceof TranslationProviderUnavailableError) {
      return reply.type('application/problem+json').code(503).send({
        type: 'https://preventive-care-literacy.example/problems/managed-translation-unavailable',
        title: error.message,
        status: 503,
        code: error.code,
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
    if (error instanceof StudentClassAccessRequiredError) {
      return reply.type('application/problem+json').code(403).send({
        type: 'https://preventive-care-literacy.example/problems/student-class-access',
        title: error.message,
        status: 403,
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
      error instanceof IntakeDraftRevisionConflictError ||
      error instanceof IntakeCurrentRevisionConflictError ||
      error instanceof IntakeAlreadyAcceptedError ||
      error instanceof IntakeOperationReusedError
    ) {
      return reply
        .type('application/problem+json')
        .code(409)
        .send({
          type: 'https://preventive-care-literacy.example/problems/intake-conflict',
          title: error.message,
          status: 409,
          code: error.code,
          ...(error instanceof IntakeDraftRevisionConflictError
            ? { draftRevision: error.draftRevision }
            : {}),
          ...(error instanceof IntakeCurrentRevisionConflictError
            ? {
                currentIntakeRecordVersionId:
                  error.currentIntakeRecordVersionId,
              }
            : {}),
          ...(error instanceof IntakeRevisionConflictError && error.guidance
            ? error.guidance
            : {}),
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
          operatorSession: {
            type: 'apiKey',
            in: 'cookie',
            name: operatorSessionCookie,
          },
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

  app.post<{ Body: Static<typeof OperatorSignInBody> }>(
    '/api/v1/auth/operator/sign-in',
    {
      schema: {
        operationId: 'operatorSignIn',
        body: OperatorSignInBody,
        response: {
          200: OperatorSessionCreatedResponse,
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const session = options.operatorAuthenticator.createSession(
        request.body.token,
      );
      if (!session) return operatorAuthenticationRequired(reply);
      reply.header(
        'set-cookie',
        setSecureOpaqueCookie(operatorSessionCookie, session),
      );
      return { outcome: 'authenticated' as const };
    },
  );

  app.get<{ Headers: Static<typeof OperatorAuthenticationHeaders> }>(
    '/api/v1/operator/session',
    {
      schema: {
        operationId: 'operatorSession',
        security: [{ bearerAuth: [] }, { operatorSession: [] }],
        headers: OperatorAuthenticationHeaders,
        response: {
          200: OperatorSessionResponse,
          401: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const actor = authenticateOperator(request);
      if (!actor) return operatorAuthenticationRequired(reply);
      return { actorId: actor.id };
    },
  );

  app.post(
    '/api/v1/auth/operator/sign-out',
    {
      schema: {
        operationId: 'operatorSignOut',
        response: {
          200: OperatorSessionEndedResponse,
          403: ProblemResponse,
        },
      },
    },
    async (_request, reply) => {
      reply.header(
        'set-cookie',
        expireSecureOpaqueCookie(operatorSessionCookie),
      );
      return { outcome: 'ended' as const };
    },
  );

  app.get<{ Headers: Static<typeof OperatorAuthenticationHeaders> }>(
    '/api/v1/operator/workspaces',
    {
      schema: {
        operationId: 'listOperatorWorkspaces',
        security: [{ bearerAuth: [] }, { operatorSession: [] }],
        headers: OperatorAuthenticationHeaders,
        response: {
          200: OperatorWorkspaceCatalogResponse,
          401: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      if (!authenticateOperator(request)) {
        return operatorAuthenticationRequired(reply);
      }
      return options.listOperatorWorkspaces();
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
        security: [{ bearerAuth: [] }, { operatorSession: [] }],
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
      const actor = authenticateOperator(request);
      if (!actor) return operatorAuthenticationRequired(reply);
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
        security: [{ bearerAuth: [] }, { operatorSession: [] }],
        headers: OperatorHeaders,
        body: ProvisionStaffIdentityBody,
        response: {
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          201: ProvisionStaffIdentityResponse,
          409: ProblemResponse,
          422: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const actor = authenticateOperator(request);
      if (!actor) return operatorAuthenticationRequired(reply);
      const result = await identityAndAccess.provisionStaffIdentity({
        ...request.body,
        actor,
      });
      return reply.code(201).send(result);
    },
  );

  app.post<{
    Body: Static<typeof RecoverStaffIdentityBody>;
    Headers: Static<typeof OperatorHeaders>;
  }>(
    '/api/v1/administration/staff-identities/recoveries',
    {
      schema: {
        operationId: 'recoverStaffIdentity',
        security: [{ bearerAuth: [] }, { operatorSession: [] }],
        headers: OperatorHeaders,
        body: RecoverStaffIdentityBody,
        response: {
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          404: ProblemResponse,
          413: ProblemResponse,
          200: RecoverStaffIdentityResponse,
          409: ProblemResponse,
          422: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const actor = authenticateOperator(request);
      if (!actor) return operatorAuthenticationRequired(reply);
      return identityAndAccess.recoverStaffIdentity({
        ...request.body,
        actor,
      });
    },
  );

  app.post<{
    Body: Static<typeof DisableStaffIdentityBody>;
    Headers: Static<typeof OperatorHeaders>;
  }>(
    '/api/v1/administration/staff-identities/disablements',
    {
      schema: {
        operationId: 'disableStaffIdentity',
        security: [{ bearerAuth: [] }, { operatorSession: [] }],
        headers: OperatorHeaders,
        body: DisableStaffIdentityBody,
        response: {
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          404: ProblemResponse,
          413: ProblemResponse,
          200: DisableStaffIdentityResponse,
          409: ProblemResponse,
          422: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const actor = authenticateOperator(request);
      if (!actor) return operatorAuthenticationRequired(reply);
      return identityAndAccess.disableStaffIdentity({
        ...request.body,
        actor,
      });
    },
  );

  app.post<{
    Body: Static<typeof ReplaceStaffPermissionsBody>;
    Headers: Static<typeof OperatorHeaders>;
  }>(
    '/api/v1/administration/staff-identities/permission-replacements',
    {
      schema: {
        operationId: 'replaceStaffPermissions',
        security: [{ bearerAuth: [] }, { operatorSession: [] }],
        headers: OperatorHeaders,
        body: ReplaceStaffPermissionsBody,
        response: {
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          404: ProblemResponse,
          413: ProblemResponse,
          200: ReplaceStaffPermissionsResponse,
          409: ProblemResponse,
          422: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const actor = authenticateOperator(request);
      if (!actor) return operatorAuthenticationRequired(reply);
      return identityAndAccess.replaceStaffPermissions({
        ...request.body,
        actor,
      });
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

  function requireStaffCookie(
    request: FastifyRequest,
    reply: FastifyReply,
  ): string | FastifyReply {
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
    return sessionHandle;
  }

  app.post<{ Body: Static<typeof CreateClassBody> }>(
    '/api/v1/administration/classes/definitions',
    {
      schema: {
        operationId: 'createClass',
        security: [{ staffSession: [] }],
        body: CreateClassBody,
        response: {
          201: CreateClassResponse,
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = requireStaffCookie(request, reply);
      if (typeof sessionHandle !== 'string') return sessionHandle;
      const result = await identityAndAccess.createClass({
        ...request.body,
        sessionHandle,
      });
      return reply.code(201).send(result);
    },
  );

  app.post<{ Body: Static<typeof PreviewClassInvitationBody> }>(
    '/api/v1/administration/classes/invitation-previews',
    {
      schema: {
        operationId: 'previewClassInvitation',
        security: [{ staffSession: [] }],
        body: PreviewClassInvitationBody,
        response: {
          200: PreviewClassInvitationResponse,
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
      const sessionHandle = requireStaffCookie(request, reply);
      if (typeof sessionHandle !== 'string') return sessionHandle;
      return identityAndAccess.previewClassInvitation({
        ...request.body,
        sessionHandle,
      });
    },
  );

  app.post<{ Body: Static<typeof PreviewClassInvitationCsvBody> }>(
    '/api/v1/administration/classes/invitation-csv-previews',
    {
      schema: {
        operationId: 'previewClassInvitationCsv',
        security: [{ staffSession: [] }],
        body: PreviewClassInvitationCsvBody,
        response: {
          200: PreviewClassInvitationCsvResponse,
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          404: ProblemResponse,
          413: ProblemResponse,
          422: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = requireStaffCookie(request, reply);
      if (typeof sessionHandle !== 'string') return sessionHandle;
      return identityAndAccess.previewClassInvitationCsv({
        ...request.body,
        sessionHandle,
      });
    },
  );

  app.post<{ Body: Static<typeof SendClassInvitationCsvBody> }>(
    '/api/v1/administration/classes/invitation-csv-sends',
    {
      schema: {
        operationId: 'sendClassInvitationCsv',
        security: [{ staffSession: [] }],
        body: SendClassInvitationCsvBody,
        response: {
          201: SendClassInvitationCsvResponse,
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          404: ProblemResponse,
          409: ProblemResponse,
          413: ProblemResponse,
          422: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = requireStaffCookie(request, reply);
      if (typeof sessionHandle !== 'string') return sessionHandle;
      const result = await identityAndAccess.sendClassInvitationCsv({
        ...request.body,
        sessionHandle,
      });
      return reply.code(201).send(result);
    },
  );

  app.post<{ Body: Static<typeof SendClassInvitationBody> }>(
    '/api/v1/administration/classes/invitations',
    {
      schema: {
        operationId: 'sendClassInvitation',
        security: [{ staffSession: [] }],
        body: SendClassInvitationBody,
        response: {
          201: CreateClassInvitationResponse,
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
      const sessionHandle = requireStaffCookie(request, reply);
      if (typeof sessionHandle !== 'string') return sessionHandle;
      const result = await identityAndAccess.sendClassInvitation({
        ...request.body,
        sessionHandle,
      });
      return reply.code(201).send(result);
    },
  );

  app.post<{ Body: Static<typeof ResendClassInvitationBody> }>(
    '/api/v1/administration/classes/invitation-resends',
    {
      schema: {
        operationId: 'resendClassInvitation',
        security: [{ staffSession: [] }],
        body: ResendClassInvitationBody,
        response: {
          201: ResendClassInvitationResponse,
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
      const sessionHandle = requireStaffCookie(request, reply);
      if (typeof sessionHandle !== 'string') return sessionHandle;
      const result = await identityAndAccess.resendClassInvitation({
        ...request.body,
        sessionHandle,
      });
      return reply.code(201).send(result);
    },
  );

  app.post<{ Body: Static<typeof RevokeClassInvitationBody> }>(
    '/api/v1/administration/classes/invitation-revocations',
    {
      schema: {
        operationId: 'revokeClassInvitation',
        security: [{ staffSession: [] }],
        body: RevokeClassInvitationBody,
        response: {
          200: RevokeClassInvitationResponse,
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
      const sessionHandle = requireStaffCookie(request, reply);
      if (typeof sessionHandle !== 'string') return sessionHandle;
      return identityAndAccess.revokeClassInvitation({
        ...request.body,
        sessionHandle,
      });
    },
  );

  app.post<{ Body: Static<typeof DeactivateClassMembershipBody> }>(
    '/api/v1/administration/classes/membership-deactivations',
    {
      schema: {
        operationId: 'deactivateClassMembership',
        security: [{ staffSession: [] }],
        body: DeactivateClassMembershipBody,
        response: {
          200: DeactivateClassMembershipResponse,
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
      const sessionHandle = requireStaffCookie(request, reply);
      if (typeof sessionHandle !== 'string') return sessionHandle;
      return identityAndAccess.deactivateClassMembership({
        ...request.body,
        sessionHandle,
      });
    },
  );

  app.post<{ Body: Static<typeof CloseClassBody> }>(
    '/api/v1/administration/classes/closures',
    {
      schema: {
        operationId: 'closeClass',
        security: [{ staffSession: [] }],
        body: CloseClassBody,
        response: {
          200: CloseClassResponse,
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
      const sessionHandle = requireStaffCookie(request, reply);
      if (typeof sessionHandle !== 'string') return sessionHandle;
      return identityAndAccess.closeClass({
        ...request.body,
        sessionHandle,
      });
    },
  );

  app.post<{ Body: Static<typeof ReplaceStudentVerifiedEmailBody> }>(
    '/api/v1/administration/students/verified-email-replacements',
    {
      schema: {
        operationId: 'replaceStudentVerifiedEmail',
        security: [{ staffSession: [] }],
        body: ReplaceStudentVerifiedEmailBody,
        response: {
          200: ReplaceStudentVerifiedEmailResponse,
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
      const sessionHandle = requireStaffCookie(request, reply);
      if (typeof sessionHandle !== 'string') return sessionHandle;
      return identityAndAccess.replaceStudentVerifiedEmail({
        ...request.body,
        sessionHandle,
      });
    },
  );

  app.post<{ Body: Static<typeof DisableStudentAccessBody> }>(
    '/api/v1/administration/students/disablements',
    {
      schema: {
        operationId: 'disableStudentAccess',
        security: [{ staffSession: [] }],
        body: DisableStudentAccessBody,
        response: {
          200: DisableStudentAccessResponse,
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
      const sessionHandle = requireStaffCookie(request, reply);
      if (typeof sessionHandle !== 'string') return sessionHandle;
      return identityAndAccess.disableStudentAccess({
        ...request.body,
        sessionHandle,
      });
    },
  );

  app.post<{ Body: Static<typeof EnableStudentAccessBody> }>(
    '/api/v1/administration/students/re-enablements',
    {
      schema: {
        operationId: 'enableStudentAccess',
        security: [{ staffSession: [] }],
        body: EnableStudentAccessBody,
        response: {
          200: EnableStudentAccessResponse,
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
      const sessionHandle = requireStaffCookie(request, reply);
      if (typeof sessionHandle !== 'string') return sessionHandle;
      return identityAndAccess.enableStudentAccess({
        ...request.body,
        sessionHandle,
      });
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

    app.post<{ Body: Static<typeof DraftEditBody> }>(
      '/api/v1/administration/school-configuration/draft-edits',
      {
        bodyLimit: 2 * 1024 * 1024,
        schema: {
          operationId: 'editSchoolConfigurationDraft',
          security: [{ staffSession: [] }],
          body: DraftEditBody,
          response: {
            200: EditSchoolConfigurationDraftResponse,
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
      async (request) => {
        const sessionHandle = readSecureOpaqueCookie(
          request.headers.cookie,
          staffSessionCookie,
        );
        if (!sessionHandle) throw new StaffAuthenticationFailedError();
        return schoolConfiguration.editDraft({
          sessionHandle,
          operationId: request.body.operationId,
          expectedDraftVersion: request.body.expectedDraftVersion,
          expectedResourceRevisions: request.body.expectedResourceRevisions,
          edit: parseDraftEdit(request.body),
        });
      },
    );

    app.post<{ Body: Static<typeof GenerateManagedTranslationsBody> }>(
      '/api/v1/administration/school-configuration/managed-translation-generations',
      {
        schema: {
          operationId: 'generateManagedTranslations',
          security: [{ staffSession: [] }],
          body: GenerateManagedTranslationsBody,
          response: {
            200: GenerateManagedTranslationsResponse,
            400: ProblemResponse,
            401: ProblemResponse,
            403: ProblemResponse,
            409: ProblemResponse,
            422: ProblemResponse,
            503: ProblemResponse,
            500: ProblemResponse,
          },
        },
      },
      async (request) => {
        const sessionHandle = readSecureOpaqueCookie(
          request.headers.cookie,
          staffSessionCookie,
        );
        if (!sessionHandle) throw new StaffAuthenticationFailedError();
        const startedAt = performance.now();
        const result = await schoolConfiguration.generateTranslations({
          sessionHandle,
          operationId: request.body.operationId,
          expectedDraftVersion: request.body.expectedDraftVersion,
          locale: request.body.locale,
          sourceResourceIds: request.body.sourceResourceIds,
        });
        telemetry?.record({
          name: 'translation.generation.completed',
          adapter: 'google-cloud-translation-advanced',
          adapterVersion: result.telemetry.adapterVersion,
          model: result.telemetry.model,
          glossaryRevision: result.telemetry.glossaryRevision,
          locale: result.telemetry.locale,
          segmentCount: result.telemetry.segmentCount,
          rejectedCount: result.telemetry.rejectedCount,
          outcome: result.telemetry.outcome,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        });
        const { telemetry: recordedGeneration, ...response } = result;
        void recordedGeneration;
        return response;
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

    app.get(
      '/api/v1/administration/school-configuration/releases',
      {
        schema: {
          operationId: 'listSchoolConfigurationReleases',
          security: [{ staffSession: [] }],
          response: {
            200: ListSchoolConfigurationReleasesResponse,
            401: ProblemResponse,
            403: ProblemResponse,
            500: ProblemResponse,
          },
        },
      },
      async (request) => {
        const sessionHandle = readSecureOpaqueCookie(
          request.headers.cookie,
          staffSessionCookie,
        );
        if (!sessionHandle) throw new StaffAuthenticationFailedError();
        const result = await schoolConfiguration.listReleases({
          sessionHandle,
        });
        return {
          releases: result.releases.map(presentReleaseSummary),
        };
      },
    );

    app.get<{
      Params: Static<typeof SchoolConfigurationReleaseParams>;
    }>(
      '/api/v1/administration/school-configuration/releases/:releaseId',
      {
        schema: {
          operationId: 'readSchoolConfigurationRelease',
          security: [{ staffSession: [] }],
          params: SchoolConfigurationReleaseParams,
          response: {
            200: SchoolConfigurationReleaseDetailResponse,
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
        const release = await schoolConfiguration.readRelease({
          sessionHandle,
          releaseId: request.params.releaseId,
        });
        if (!release) {
          return reply.type('application/problem+json').code(404).send({
            type: 'https://preventive-care-literacy.example/problems/school-configuration-release',
            title: 'School Configuration Release not found',
            status: 404,
            code: 'SCHOOL_CONFIGURATION_RELEASE_NOT_FOUND',
          });
        }
        return {
          ...presentReleaseSummary(release),
          candidate: release.candidate,
          comparisons: release.comparisons,
        };
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

  app.post<{ Body: Static<typeof StudentSignInRequestBody> }>(
    '/api/v1/auth/student/sign-in',
    {
      schema: {
        operationId: 'requestStudentSignIn',
        body: StudentSignInRequestBody,
        response: {
          200: StudentSignInAcceptedResponse,
          400: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request) => {
      return identityAndAccess.requestStudentSignIn(request.body);
    },
  );

  app.post<{ Body: Static<typeof StudentSignInVerifyBody> }>(
    '/api/v1/auth/student/sign-in/verify',
    {
      schema: {
        operationId: 'completeStudentSignIn',
        body: StudentSignInVerifyBody,
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
      const grant = await identityAndAccess.completeStudentSignIn(request.body);
      reply.header(
        'set-cookie',
        setSecureOpaqueCookie(studentSessionCookie, grant.sessionHandle),
      );
      return { outcome: 'authenticated' as const };
    },
  );

  app.put<{ Body: Static<typeof SaveStudentLanguageBody> }>(
    '/api/v1/student/language',
    {
      schema: {
        operationId: 'saveStudentLanguage',
        security: [{ studentSession: [] }],
        body: SaveStudentLanguageBody,
        response: {
          200: SaveStudentLanguageResponse,
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
        studentSessionCookie,
      );
      if (!sessionHandle) {
        return studentSessionRequired(reply);
      }
      return identityAndAccess.saveStudentLanguage({
        sessionHandle,
        languageChoice: request.body.languageChoice,
      });
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
          403: ProblemResponse,
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

  app.post<{ Body: Static<typeof ReopenIntakeRecordBody> }>(
    '/api/v1/student/intake/reopen',
    {
      schema: {
        operationId: 'reopenIntakeRecord',
        security: [{ studentSession: [] }],
        body: ReopenIntakeRecordBody,
        response: {
          200: ReopenIntakeRecordResponse,
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
      if (!sessionHandle || !options.intake) {
        return studentSessionRequired(reply);
      }
      const result = await options.intake.reopen({
        sessionHandle,
        ...request.body,
      });
      if (!result) return studentSessionRequired(reply);
      return result;
    },
  );

  app.post<{ Body: Static<typeof RebaseIntakeDraftBody> }>(
    '/api/v1/student/intake/rebase',
    {
      schema: {
        operationId: 'rebaseIntakeDraft',
        security: [{ studentSession: [] }],
        body: RebaseIntakeDraftBody,
        response: {
          200: RebaseIntakeDraftResponse,
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
      if (!sessionHandle || !options.intake) {
        return studentSessionRequired(reply);
      }
      const result = await options.intake.rebase({
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
          403: ProblemResponse,
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
          403: ProblemResponse,
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
  translationAdapter?: TranslationAdapter;
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
    translationAdapter:
      options.translationAdapter ?? translationAdapterFromEnvironment(),
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
      clock,
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
    listOperatorWorkspaces: () => listOperatorWorkspaces(pool),
    onClose: () => pool.end(),
  });
}
