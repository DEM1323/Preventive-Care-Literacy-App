import { parseInvitationCsv } from './invitation-csv.ts';

export {
  invitationCsvMaxBytes,
  invitationCsvMaxFieldLength,
  invitationCsvMaxRows,
  parseInvitationCsv,
} from './invitation-csv.ts';

export type StaffPermission = 'administrative' | 'clinical';

export type CreateSchoolWorkspaceCommand = {
  operationId: string;
  workspaceId: string;
  displayName: string;
  actor: {
    type: 'technical_operator';
    id: string;
  };
};

export type CreateSchoolWorkspaceResult = {
  operationId: string;
  workspaceId: string;
  outcome: 'created';
};

export type Clock = {
  now(): Date;
};

export type IdGenerator = {
  create(): string;
};

export type IdentityAndAccess = {
  createSchoolWorkspace(
    command: CreateSchoolWorkspaceCommand,
  ): Promise<CreateSchoolWorkspaceResult>;
  provisionStaffIdentity(
    command: ProvisionStaffIdentityCommand,
  ): Promise<ProvisionStaffIdentityResult>;
  recoverStaffIdentity(
    command: RecoverStaffIdentityCommand,
  ): Promise<RecoverStaffIdentityResult>;
  disableStaffIdentity(
    command: DisableStaffIdentityCommand,
  ): Promise<DisableStaffIdentityResult>;
  replaceStaffPermissions(
    command: ReplaceStaffPermissionsCommand,
  ): Promise<ReplaceStaffPermissionsResult>;
  startStaffSignIn(
    command: StartStaffSignInCommand,
  ): Promise<StaffSignInChallenge>;
  completeStaffSignIn(
    command: CompleteStaffSignInCommand,
  ): Promise<StaffSessionGrant>;
  resolveStaffSession(
    command: ResolveStaffSessionCommand,
  ): Promise<StaffSessionContext | undefined>;
  requireAdministrativeSession(
    command: StaffSessionCommand,
  ): Promise<AdministrativeSessionContext>;
  stepUpStaffSession(
    command: StepUpStaffSessionCommand,
  ): Promise<StepUpStaffSessionResult>;
  endStaffSession(
    command: EndStaffSessionCommand,
  ): Promise<{ outcome: 'ended' }>;
  listStaffIdentities(
    command: StaffSessionCommand,
  ): Promise<StaffDirectoryEntry[]>;
  requireFreshClinicalSession(
    command: StaffSessionCommand,
  ): Promise<ClinicalSessionContext>;
  openClinicalDirectory(
    command: StaffSessionCommand,
  ): Promise<ClinicalDirectory>;
  createClass(command: CreateClassCommand): Promise<CreateClassResult>;
  createClassInvitation(
    command: CreateClassInvitationCommand,
  ): Promise<CreateClassInvitationResult>;
  previewClassInvitation(
    command: PreviewClassInvitationCommand,
  ): Promise<InvitationPreview>;
  previewClassInvitationCsv(
    command: PreviewClassInvitationCsvCommand,
  ): Promise<ClassInvitationCsvPreview>;
  sendClassInvitation(
    command: SendClassInvitationCommand,
  ): Promise<CreateClassInvitationResult>;
  sendClassInvitationCsv(
    command: SendClassInvitationCsvCommand,
  ): Promise<SendClassInvitationCsvResult>;
  resendClassInvitation(
    command: ResendClassInvitationCommand,
  ): Promise<ResendClassInvitationResult>;
  revokeClassInvitation(
    command: RevokeClassInvitationCommand,
  ): Promise<RevokeClassInvitationResult>;
  deactivateClassMembership(
    command: DeactivateClassMembershipCommand,
  ): Promise<DeactivateClassMembershipResult>;
  closeClass(command: CloseClassCommand): Promise<CloseClassResult>;
  listClasses(command: StaffSessionCommand): Promise<ClassDirectoryEntry[]>;
  redeemInvitation(
    command: RedeemInvitationCommand,
  ): Promise<StudentSessionGrant>;
  resolveStudentSession(
    command: ResolveStudentSessionCommand,
  ): Promise<StudentSessionContext | undefined>;
};

export type RedeemInvitationCommand = {
  recipient: string;
  code: string;
};

export type StudentSessionGrant = {
  sessionHandle: string;
  absoluteExpiresAt: Date;
};

export type ResolveStudentSessionCommand = {
  sessionHandle: string;
};

export type StudentSessionContext = {
  studentId: string;
  workspaceId: string;
  activeClassMemberships: { classId: string; name: string }[];
};

export type CreateClassInvitationCommand = {
  operationId: string;
  classId: string;
  invitationId: string;
  name: string;
  recipient: string;
  sessionHandle: string;
};

export type CreateClassInvitationResult = {
  operationId: string;
  classId: string;
  invitationId: string;
  outcome: 'created';
};

export type InvitationStatus =
  | 'pending_delivery'
  | 'delivered'
  | 'delivery_failed'
  | 'expired'
  | 'completed'
  | 'revoked'
  | 'superseded';

export type InvitationDeliveryStatus = 'delivered' | 'delayed' | 'failed';

export type MembershipStatus = 'none' | 'active' | 'inactive';

export type ClassDirectoryRelationship = {
  recipient: string;
  studentId: string | null;
  classMembershipId: string | null;
  membershipStatus: MembershipStatus;
  latestInvitation: {
    invitationId: string;
    purpose: 'join_class';
    generation: number;
    status: InvitationStatus;
    expiresAt: Date;
  };
  deliveryStatus: InvitationDeliveryStatus;
  history: {
    invitationId: string;
    status: InvitationStatus;
    generation: number;
    createdAt: Date;
  }[];
};

export type ClassDirectoryEntry = {
  classId: string;
  name: string;
  createdAt: Date;
  status: 'open' | 'closed';
  closedAt: Date | null;
  invitations: {
    invitationId: string;
    purpose: 'join_class';
    generation: number;
    status: InvitationStatus;
    expiresAt: Date;
  }[];
  relationships: ClassDirectoryRelationship[];
};

export type CreateClassCommand = {
  operationId: string;
  classId: string;
  name: string;
  sessionHandle: string;
};

export type CreateClassResult = {
  operationId: string;
  classId: string;
  outcome: 'created';
};

export type PreviewClassInvitationCommand = {
  classId: string;
  recipient: string;
  sessionHandle: string;
};

export type InvitationPreview =
  | {
      outcome: 'ready';
      reuse: 'none' | 'existing_student' | 'inactive_membership';
    }
  | { outcome: 'already_a_member' }
  | { outcome: 'already_invited' }
  | { outcome: 'identity_review'; reason: 'historical_binding' }
  | { outcome: 'class_closed' };

export type PreviewClassInvitationCsvCommand = {
  classId: string;
  csv: string;
  sessionHandle: string;
};

export type ClassInvitationCsvPreviewRow =
  | {
      lineNumber: number;
      field: string;
      outcome: 'ready';
      reuse: 'none' | 'existing_student' | 'inactive_membership';
    }
  | { lineNumber: number; field: string; outcome: 'malformed' }
  | { lineNumber: number; field: string; outcome: 'duplicate_in_file' }
  | { lineNumber: number; field: string; outcome: 'already_a_member' }
  | { lineNumber: number; field: string; outcome: 'already_invited' }
  | {
      lineNumber: number;
      field: string;
      outcome: 'identity_review';
      reason: 'historical_binding';
    }
  | { lineNumber: number; field: string; outcome: 'class_closed' };

export type ClassInvitationCsvPreview = {
  classId: string;
  rows: ClassInvitationCsvPreviewRow[];
  summary: { ready: number; skipped: number };
};

export type SendClassInvitationCsvCommand = {
  operationId: string;
  classId: string;
  csv: string;
  selectedLineNumbers: readonly number[];
  sessionHandle: string;
};

export type ClassInvitationCsvSendRow =
  | {
      lineNumber: number;
      field: string;
      outcome: 'sent';
      invitationId: string;
      reuse: 'none' | 'existing_student' | 'inactive_membership';
    }
  | { lineNumber: number; field: string; outcome: 'malformed' }
  | { lineNumber: number; field: string; outcome: 'duplicate_in_file' }
  | { lineNumber: number; field: string; outcome: 'already_a_member' }
  | { lineNumber: number; field: string; outcome: 'already_invited' }
  | {
      lineNumber: number;
      field: string;
      outcome: 'identity_review';
      reason: 'historical_binding';
    }
  | { lineNumber: number; field: string; outcome: 'class_closed' }
  | { lineNumber: number; field: string; outcome: 'not_selected' };

export type SendClassInvitationCsvResult = {
  operationId: string;
  classId: string;
  outcome: 'applied';
  summary: { sent: number; skipped: number; deliveryProblems: number };
  rows: ClassInvitationCsvSendRow[];
};

export type SendClassInvitationCommand = {
  operationId: string;
  classId: string;
  invitationId: string;
  recipient: string;
  sessionHandle: string;
};

export type ResendClassInvitationCommand = {
  operationId: string;
  invitationId: string;
  replacementInvitationId: string;
  sessionHandle: string;
};

export type ResendClassInvitationResult = {
  operationId: string;
  classId: string;
  invitationId: string;
  supersededInvitationId: string;
  outcome: 'superseded';
};

export type RevokeClassInvitationCommand = {
  operationId: string;
  invitationId: string;
  sessionHandle: string;
};

export type RevokeClassInvitationResult = {
  operationId: string;
  invitationId: string;
  outcome: 'revoked' | 'unchanged_redeemed';
};

export type DeactivateClassMembershipCommand = {
  operationId: string;
  classMembershipId: string;
  sessionHandle: string;
};

export type DeactivateClassMembershipResult = {
  operationId: string;
  classMembershipId: string;
  outcome: 'deactivated';
};

export type CloseClassCommand = {
  operationId: string;
  classId: string;
  sessionHandle: string;
};

export type CloseClassResult = {
  operationId: string;
  classId: string;
  outcome: 'closed';
  revokedInvitationCount: number;
  deactivatedMembershipCount: number;
};

export type InvitationSecretProtector = {
  createCode(): string;
  digestRecipient(recipient: string): string;
  digestInvitationLookup(input: { recipient: string; code: string }): string;
  digestCode(input: {
    invitationId: string;
    purpose: 'join_class';
    generation: number;
    code: string;
  }): string;
  codeMatches(input: {
    invitationId: string;
    purpose: 'join_class';
    generation: number;
    code: string;
    expectedDigest: string;
  }): boolean;
  protectRecipient(input: {
    workspaceId: string;
    studentId: string;
    recipient: string;
  }): { keyId: string; ciphertext: string };
  protect(input: {
    invitationId: string;
    purpose: 'join_class';
    generation: number;
    recipient: string;
    code: string;
  }): {
    recipientDigest: string;
    codeDigest: string;
    lookupDigest: string;
    keyId: string;
    ciphertext: string;
  };
  revealInvitationRecipient(input: {
    invitationId: string;
    purpose: 'join_class';
    generation: number;
    keyId: string;
    ciphertext: string;
  }): string;
};

export class SchoolWorkspaceAlreadyExistsError extends Error {
  readonly code = 'SCHOOL_WORKSPACE_EXISTS';

  constructor() {
    super('School Workspace already exists');
    this.name = 'SchoolWorkspaceAlreadyExistsError';
  }
}

export class StaffIdentityAlreadyExistsError extends Error {
  readonly code = 'STAFF_IDENTITY_EXISTS';

  constructor() {
    super('Staff Identity already exists');
    this.name = 'StaffIdentityAlreadyExistsError';
  }
}

/**
 * Raised by the staff credential provider when the mailbox already has
 * credentials. Mapped to StaffIdentityAlreadyExistsError by the module.
 */
export class StaffCredentialsAlreadyExistError extends Error {
  readonly code = 'STAFF_CREDENTIALS_EXIST';

  constructor() {
    super('Staff credentials already exist for this address');
    this.name = 'StaffCredentialsAlreadyExistError';
  }
}

export class StaffAuthenticationFailedError extends Error {
  readonly code = 'STAFF_AUTHENTICATION_FAILED';

  constructor() {
    super('Staff authentication failed');
    this.name = 'StaffAuthenticationFailedError';
  }
}

export class StaffPermissionRequiredError extends Error {
  readonly code = 'STAFF_PERMISSION_REQUIRED';

  constructor(readonly permission: StaffPermission) {
    super(`Staff ${permission} Permission is required`);
    this.name = 'StaffPermissionRequiredError';
  }
}

export class AdministrativePermissionRequiredError extends Error {
  readonly code = 'ADMINISTRATIVE_PERMISSION_REQUIRED';

  constructor() {
    super('Administrative Permission is required');
    this.name = 'AdministrativePermissionRequiredError';
  }
}

export class StaffAuthenticationStaleError extends Error {
  readonly code = 'STAFF_AUTHENTICATION_STALE';

  constructor() {
    super('Fresh staff authentication is required');
    this.name = 'StaffAuthenticationStaleError';
  }
}

export class AuthenticationFreshnessRequiredError extends Error {
  readonly code = 'AUTHENTICATION_FRESHNESS_REQUIRED';

  constructor() {
    super('Fresh password and authenticator verification is required');
    this.name = 'AuthenticationFreshnessRequiredError';
  }
}

export class StepUpRejectedError extends Error {
  readonly code = 'STEP_UP_REJECTED';

  constructor() {
    super('Password and authenticator code were not accepted');
    this.name = 'StepUpRejectedError';
  }
}

export class StepUpIncompleteError extends Error {
  readonly code = 'STEP_UP_INCOMPLETE';

  constructor() {
    super('Password and a six-digit authenticator code are required');
    this.name = 'StepUpIncompleteError';
  }
}

export class StaffSessionExpiredError extends Error {
  readonly code = 'STAFF_SESSION_EXPIRED';

  constructor() {
    super('Staff Session expired');
    this.name = 'StaffSessionExpiredError';
  }
}

export class StaffSessionRevokedError extends Error {
  readonly code = 'STAFF_SESSION_REVOKED';

  constructor() {
    super('Staff Session was revoked');
    this.name = 'StaffSessionRevokedError';
  }
}

export class FirstAdministratorRequiredError extends Error {
  readonly code = 'FIRST_ADMINISTRATOR_REQUIRED';

  constructor() {
    super(
      'The first Staff Identity in a School Workspace must hold Administrative Permission',
    );
    this.name = 'FirstAdministratorRequiredError';
  }
}

export class StaffIdentityNotFoundError extends Error {
  readonly code = 'STAFF_IDENTITY_NOT_FOUND';

  constructor() {
    super('Staff Identity was not found');
    this.name = 'StaffIdentityNotFoundError';
  }
}

export class LastAdministratorRequiredError extends Error {
  readonly code = 'LAST_ADMINISTRATOR_REQUIRED';

  constructor() {
    super(
      'The last Administrative Permission in a School Workspace cannot be removed',
    );
    this.name = 'LastAdministratorRequiredError';
  }
}

export class StudentAuthenticationFailedError extends Error {
  readonly code = 'STUDENT_AUTHENTICATION_FAILED';

  constructor() {
    super('Student authentication failed');
    this.name = 'StudentAuthenticationFailedError';
  }
}

export class ClassNotFoundError extends Error {
  readonly code = 'CLASS_NOT_FOUND';

  constructor() {
    super('Class was not found');
    this.name = 'ClassNotFoundError';
  }
}

export class ClassClosedError extends Error {
  readonly code = 'CLASS_CLOSED';

  constructor() {
    super('Class is closed');
    this.name = 'ClassClosedError';
  }
}

export class InvitationNotFoundError extends Error {
  readonly code = 'INVITATION_NOT_FOUND';

  constructor() {
    super('Invitation was not found');
    this.name = 'InvitationNotFoundError';
  }
}

export class ClassMembershipNotFoundError extends Error {
  readonly code = 'CLASS_MEMBERSHIP_NOT_FOUND';

  constructor() {
    super('Class Membership was not found');
    this.name = 'ClassMembershipNotFoundError';
  }
}

export class InvitationNotSendableError extends Error {
  readonly code = 'INVITATION_NOT_SENDABLE';

  constructor(readonly outcome: InvitationPreview['outcome']) {
    super('Invitation cannot be sent');
    this.name = 'InvitationNotSendableError';
  }
}

export class InvitationCsvRejectedError extends Error {
  readonly code = 'INVITATION_CSV_REJECTED';

  constructor(readonly reason: 'too_large' | 'too_many_rows' | 'empty') {
    super('Invitation CSV cannot be imported');
    this.name = 'InvitationCsvRejectedError';
  }
}

export type ProvisionStaffIdentityCommand = {
  operationId: string;
  workspaceId: string;
  staffIdentityId: string;
  displayName: string;
  email: string;
  permissions: readonly StaffPermission[];
  schoolApprover: string;
  reason: string;
  initialPassword: string;
  actor: {
    type: 'technical_operator';
    id: string;
  };
};

export type ProvisionStaffIdentityResult = {
  operationId: string;
  staffIdentityId: string;
  supabaseUserId: string;
  outcome: 'provisioned';
};

export type RecoverStaffIdentityCommand = {
  operationId: string;
  workspaceId: string;
  staffIdentityId: string;
  newPassword: string;
  schoolApprover: string;
  reason: string;
  actor: {
    type: 'technical_operator';
    id: string;
  };
};

export type RecoverStaffIdentityResult = {
  operationId: string;
  staffIdentityId: string;
  outcome: 'recovered';
};

export type DisableStaffIdentityCommand = {
  operationId: string;
  workspaceId: string;
  staffIdentityId: string;
  schoolApprover: string;
  reason: string;
  actor: {
    type: 'technical_operator';
    id: string;
  };
};

export type DisableStaffIdentityResult = {
  operationId: string;
  staffIdentityId: string;
  outcome: 'disabled';
};

export type ReplaceStaffPermissionsCommand = {
  operationId: string;
  workspaceId: string;
  staffIdentityId: string;
  permissions: readonly StaffPermission[];
  schoolApprover: string;
  reason: string;
  actor: {
    type: 'technical_operator';
    id: string;
  };
};

export type ReplaceStaffPermissionsResult = {
  operationId: string;
  staffIdentityId: string;
  permissions: StaffPermission[];
  outcome: 'replaced';
};

export type StartStaffSignInCommand = {
  email: string;
  password: string;
};

export type StaffSignInChallenge = {
  flowHandle: string;
  flowExpiresAt: Date;
  stage: 'enroll' | 'totp';
  otpauthUri?: string;
};

export type CompleteStaffSignInCommand = {
  flowHandle: string;
  code: string;
};

export type StaffSessionGrant = {
  sessionHandle: string;
  expiresAt: Date;
};

export type ResolveStaffSessionCommand = {
  sessionHandle: string;
};

export type StaffSessionContext = {
  sessionId: string;
  staffIdentityId: string;
  workspaceId: string;
  displayName: string;
  permissions: StaffPermission[];
  authenticatedAt: Date;
};

export type AdministrativeSessionContext = StaffSessionContext & {
  authenticationFreshAt: Date;
};

export type StepUpStaffSessionCommand = {
  sessionHandle: string;
  password: string;
  totp: string;
};

export type StepUpStaffSessionResult = {
  freshUntil: Date;
};

export type EndStaffSessionCommand = {
  sessionHandle: string;
};

export type StaffSessionCommand = {
  sessionHandle: string;
};

export type StaffDirectoryEntry = {
  staffIdentityId: string;
  displayName: string;
  email: string;
  permissions: StaffPermission[];
  status: 'active' | 'disabled';
  createdAt: Date;
};

export type ClinicalDirectoryStudent = {
  studentId: string;
  createdAt: Date;
  currentIntakeRecordVersion: {
    intakeRecordVersionId: string;
    acceptedAt: Date;
    locale: 'en-US' | 'es-US' | 'pt-BR' | 'fr-CA' | 'ht-HT';
  } | null;
};

export type ClinicalDirectory = {
  students: ClinicalDirectoryStudent[];
  freshUntil: Date;
};

export type ClinicalSessionContext = StaffSessionContext & {
  authenticationFreshAt: Date;
};

/**
 * The provider-neutral staff credential seam. Supabase Auth is the alpha
 * adapter; it proves control of credentials only and never substitutes for
 * the application-owned Staff Identity or permission grants.
 */
export type StaffAuthProvider = {
  createCredentials(input: {
    email: string;
    password: string;
  }): Promise<{ supabaseUserId: string }>;
  deleteCredentials(supabaseUserId: string): Promise<void>;
  verifyPassword(input: {
    email: string;
    password: string;
  }): Promise<{ supabaseUserId: string; accessToken: string } | 'invalid'>;
  prepareTotpChallenge(accessToken: string): Promise<
    | { stage: 'totp'; factorId: string; challengeId: string }
    | {
        stage: 'enroll';
        factorId: string;
        challengeId: string;
        otpauthUri: string;
      }
  >;
  verifyTotp(input: {
    accessToken: string;
    factorId: string;
    challengeId: string;
    code: string;
  }): Promise<{ assurance: 'aal1' | 'aal2' } | 'invalid'>;
  replacePassword(input: {
    supabaseUserId: string;
    password: string;
  }): Promise<void>;
  resetTotpFactors(supabaseUserId: string): Promise<void>;
};

export type StaffSessionHandles = {
  create(): string;
  hash(handle: string): string;
};

export const staffSessionDurationMs = 8 * 60 * 60 * 1000;
export const staffSessionInactivityMs = 15 * 60 * 1000;
export const staffAuthFlowDurationMs = 10 * 60 * 1000;
export const staffAuthenticationFreshnessMs = 15 * 60 * 1000;

function nextStaffIdleExpiresAt(now: Date, absoluteExpiresAt: Date): Date {
  const idleExpiresAt = new Date(now.getTime() + staffSessionInactivityMs);
  return idleExpiresAt < absoluteExpiresAt ? idleExpiresAt : absoluteExpiresAt;
}

function staffSessionHasExpired(
  session: { expiresAt: Date; idleExpiresAt: Date },
  now: Date,
): boolean {
  return session.expiresAt <= now || session.idleExpiresAt <= now;
}

type ProvisionedStaffIdentity = {
  staffIdentityId: string;
  workspaceId: string;
  displayName: string;
  email: string;
  supabaseUserId: string;
  status: 'active' | 'disabled';
};

type StaffAuthFlow = {
  flowId: string;
  flowHandleHash: string;
  staffIdentityId: string;
  workspaceId: string;
  supabaseAccessToken: string;
  factorId: string;
  challengeId: string;
  createdAt: Date;
  expiresAt: Date;
};

export type StaffAccessStore = {
  findStaffProvisioningReceipt(request: {
    workspaceId: string;
    operationId: string;
  }): Promise<ProvisionStaffIdentityResult | undefined>;
  commitStaffProvisioning(request: {
    workspaceId: string;
    operationId: string;
    permissions: readonly StaffPermission[];
    createRecords(): Promise<StaffProvisioningCommit>;
  }): Promise<ProvisionStaffIdentityResult>;
  findStaffBySupabaseUserId(request: {
    supabaseUserId: string;
  }): Promise<ProvisionedStaffIdentity | undefined>;
  readStaffIdentity(request: {
    workspaceId: string;
    staffIdentityId: string;
  }): Promise<
    | (ProvisionedStaffIdentity & {
        permissions: StaffPermission[];
      })
    | undefined
  >;
  findStaffLifecycleReceipt(request: {
    workspaceId: string;
    operationId: string;
    commandName:
      | 'recoverStaffIdentity'
      | 'disableStaffIdentity'
      | 'replaceStaffPermissions';
  }): Promise<
    | RecoverStaffIdentityResult
    | DisableStaffIdentityResult
    | ReplaceStaffPermissionsResult
    | undefined
  >;
  applyStaffLifecycle(request: {
    workspaceId: string;
    operationId: string;
    staffIdentityId: string;
    commandName:
      | 'recoverStaffIdentity'
      | 'disableStaffIdentity'
      | 'replaceStaffPermissions';
    change: 'disable' | 'replace_permissions' | 'revoke_sessions';
    permissions: readonly StaffPermission[] | null;
    actor: { type: 'technical_operator'; id: string };
    reason: string;
    occurredAt: Date;
    auditId: string;
    result:
      | RecoverStaffIdentityResult
      | DisableStaffIdentityResult
      | ReplaceStaffPermissionsResult;
    eventType:
      | 'staff_identity.recovered'
      | 'staff_identity.disabled'
      | 'staff_permission.replaced';
  }): Promise<
    | {
        outcome: 'applied';
        revokedSessionCount: number;
        status: 'active' | 'disabled';
        permissions: StaffPermission[];
        supabaseUserId: string;
        displayName: string;
        email: string;
      }
    | { outcome: 'not_found' }
    | { outcome: 'last_administrator' }
  >;
  recordStaffAudit(request: {
    auditId: string;
    workspaceId: string;
    operationId: string;
    eventType:
      | 'staff_authentication.failed'
      | 'staff_authentication.step_up_failed'
      | 'staff_authentication.denied';
    actorType: 'staff';
    actorId: string;
    occurredAt: Date;
    details?: {
      purpose?: 'publish_school_configuration_release';
      outcome?:
        | 'rejected'
        | 'session_expired'
        | 'session_revoked'
        | 'permission_required';
      staffSessionId?: string;
      permission?: StaffPermission;
    };
  }): Promise<void>;
  createStaffAuthFlow(flow: StaffAuthFlow): Promise<void>;
  withStaffAuthenticationLock<Result>(request: {
    staffIdentityId: string;
    run(): Promise<Result>;
  }): Promise<Result>;
  readStaffAuthFlow(request: { flowHandleHash: string }): Promise<
    | (StaffAuthFlow & {
        status: 'active' | 'disabled';
        consumedAt: Date | undefined;
      })
    | undefined
  >;
  consumeStaffAuthFlowAndCreateSession(request: {
    flowId: string;
    flowHandleHash: string;
    session: {
      sessionId: string;
      sessionHandleHash: string;
      staffIdentityId: string;
      workspaceId: string;
      authenticationAssurance: 'aal2';
      authenticatedAt: Date;
      lastSeenAt: Date;
      idleExpiresAt: Date;
      expiresAt: Date;
    };
    audit: {
      auditId: string;
      operationId: string;
      eventType: 'staff_session.created';
      occurredAt: Date;
    };
  }): Promise<'created' | 'unavailable'>;
  resolveStaffSession(request: {
    sessionHandleHash: string;
    now: Date;
    idleExpiresAt: Date;
  }): Promise<
    | (StaffSessionContext & {
        email: string;
        supabaseUserId: string;
        authenticationFreshAt: Date;
        authenticationAssurance: 'aal2';
        idleExpiresAt: Date;
        expiresAt: Date;
        revokedAt: Date | undefined;
        status: 'active' | 'disabled';
      })
    | undefined
  >;
  refreshStaffAuthentication(request: {
    sessionHandleHash: string;
    sessionId: string;
    workspaceId: string;
    staffIdentityId: string;
    refreshedAt: Date;
    audit: {
      auditId: string;
      operationId: string;
      eventType: 'staff_authentication.step_up_succeeded';
    };
  }): Promise<boolean>;
  revokeStaffSession(request: {
    sessionHandleHash: string;
    revokedAt: Date;
    audit: {
      auditId: string;
      operationId: string;
      eventType: 'staff_session.revoked';
      occurredAt: Date;
    };
  }): Promise<boolean>;
  staffHasPermission(request: {
    staffIdentityId: string;
    workspaceId: string;
    permission: StaffPermission;
  }): Promise<boolean>;
  listStaffDirectory(request: {
    staffIdentityId: string;
    workspaceId: string;
  }): Promise<StaffDirectoryEntry[]>;
  listClinicalDirectory(request: {
    staffIdentityId: string;
    workspaceId: string;
  }): Promise<ClinicalDirectoryStudent[]>;
};

export type InvitationPreviewFacts = {
  classStatus: 'open' | 'closed' | 'missing';
  activeMembership: boolean;
  inactiveMembership: boolean;
  pendingInvitation: boolean;
  currentStudentId: string | undefined;
  historicalBinding: boolean;
};

export function invitationPreviewFrom(
  facts: InvitationPreviewFacts,
): InvitationPreview {
  if (facts.classStatus === 'closed') return { outcome: 'class_closed' };
  if (facts.activeMembership) return { outcome: 'already_a_member' };
  if (facts.historicalBinding) {
    return { outcome: 'identity_review', reason: 'historical_binding' };
  }
  if (facts.pendingInvitation) return { outcome: 'already_invited' };
  if (facts.inactiveMembership) {
    return { outcome: 'ready', reuse: 'inactive_membership' };
  }
  if (facts.currentStudentId) {
    return { outcome: 'ready', reuse: 'existing_student' };
  }
  return { outcome: 'ready', reuse: 'none' };
}

export function invitationIsSendable(facts: InvitationPreviewFacts): boolean {
  return invitationPreviewFrom(facts).outcome === 'ready';
}

export type ClassDirectorySnapshot = {
  classes: {
    classId: string;
    name: string;
    createdAt: Date;
    status: 'open' | 'closed';
    closedAt: Date | null;
  }[];
  invitations: {
    classId: string;
    invitationId: string;
    purpose: 'join_class';
    generation: number;
    status: InvitationStatus;
    expiresAt: Date;
    createdAt: Date;
    recipientDigest: string;
    keyId: string;
    ciphertext: string;
    deliveryStatus: 'pending' | 'sending' | 'delivered' | 'suppressed';
  }[];
  memberships: {
    classId: string;
    classMembershipId: string;
    studentId: string;
    status: 'active' | 'inactive';
    emailDigests: string[];
  }[];
};

export type ClassInvitationStore = {
  commit(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    createRecords(): ClassInvitationCommit;
  }): Promise<CreateClassInvitationResult>;
  createClass(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    createRecords(): ClassDefinitionCommit;
  }): Promise<CreateClassResult>;
  preview(request: {
    workspaceId: string;
    staffIdentityId: string;
    classId: string;
    recipientDigest: string;
    now: Date;
  }): Promise<InvitationPreviewFacts>;
  send(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    classId: string;
    recipientDigest: string;
    now: Date;
    createRecords(): SendClassInvitationCommit;
  }): Promise<
    | { outcome: 'created'; result: CreateClassInvitationResult }
    | { outcome: 'replayed'; result: CreateClassInvitationResult }
    | { outcome: 'not_sendable'; preview: InvitationPreviewFacts }
  >;
  sendMany(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    classId: string;
    now: Date;
    actorId: string;
    auditId: string;
    rows: {
      lineNumber: number;
      field: string;
      kind: 'malformed' | 'duplicate_in_file' | 'candidate';
      recipient?: string;
      recipientDigest?: string;
      selected: boolean;
    }[];
    createInvitation(recipient: string): SendClassInvitationCommit;
  }): Promise<
    | { outcome: 'replayed'; result: SendClassInvitationCsvResult }
    | { outcome: 'applied'; result: SendClassInvitationCsvResult }
    | { outcome: 'class_missing' }
  >;
  readInvitation(request: {
    workspaceId: string;
    staffIdentityId: string;
    invitationId: string;
  }): Promise<
    | {
        invitationId: string;
        classId: string;
        status: InvitationStatus;
        generation: number;
        purpose: 'join_class';
        recipientDigest: string;
        keyId: string;
        ciphertext: string;
        classStatus: 'open' | 'closed';
      }
    | undefined
  >;
  resend(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    invitationId: string;
    createRecords(): SendClassInvitationCommit;
  }): Promise<
    | { outcome: 'superseded'; result: ResendClassInvitationResult }
    | { outcome: 'replayed'; result: ResendClassInvitationResult }
    | { outcome: 'not_found' }
    | { outcome: 'class_closed' }
    | { outcome: 'not_resendable'; status: InvitationStatus }
  >;
  revoke(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    invitationId: string;
    auditId: string;
    occurredAt: Date;
    result: RevokeClassInvitationResult;
  }): Promise<
    | { outcome: 'applied'; result: RevokeClassInvitationResult }
    | { outcome: 'replayed'; result: RevokeClassInvitationResult }
    | { outcome: 'not_found' }
  >;
  deactivateMembership(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    classMembershipId: string;
    auditId: string;
    occurredAt: Date;
    result: DeactivateClassMembershipResult;
  }): Promise<
    | { outcome: 'applied'; result: DeactivateClassMembershipResult }
    | { outcome: 'replayed'; result: DeactivateClassMembershipResult }
    | { outcome: 'not_found' }
  >;
  closeClass(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    classId: string;
    auditId: string;
    occurredAt: Date;
    actorId: string;
  }): Promise<
    | { outcome: 'applied'; result: CloseClassResult }
    | { outcome: 'replayed'; result: CloseClassResult }
    | { outcome: 'not_found' }
    | { outcome: 'already_closed' }
  >;
  list(request: {
    workspaceId: string;
    staffIdentityId: string;
  }): Promise<ClassDirectorySnapshot>;
};

export type InvitationRedemptionCandidate = {
  invitationId: string;
  workspaceId: string;
  classId: string;
  generation: number;
  purpose: 'join_class';
  codeDigest: string;
};

export type StudentAccessStore = {
  claimInvitationAttempt(request: {
    recipientDigest: string;
    lookupDigest: string;
    attemptedAt: Date;
  }): Promise<InvitationRedemptionCandidate | undefined>;
  redeemInvitation(request: {
    recipientDigest: string;
    candidate: InvitationRedemptionCandidate;
    codeDigest: string;
    attemptedAt: Date;
    proposedStudentId: string;
    verifiedEmailAddressId: string;
    protectedRecipient: { keyId: string; ciphertext: string };
    classMembershipId: string;
    session: {
      sessionId: string;
      sessionHandleHash: string;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
    };
    audit: { auditId: string; operationId: string };
  }): Promise<StudentSessionContext | 'unavailable'>;
  resolveStudentSession(request: {
    sessionHandleHash: string;
    resolvedAt: Date;
    idleExpiresAt: Date;
  }): Promise<StudentSessionContext | undefined>;
};

export type ClassInvitationCommit = {
  classRecord: {
    classId: string;
    workspaceId: string;
    name: string;
    createdAt: Date;
    status: 'open';
  };
  invitation: {
    invitationId: string;
    workspaceId: string;
    classId: string;
    purpose: 'join_class';
    recipientDigest: string;
    currentGeneration: 1;
    status: 'pending_delivery';
    createdAt: Date;
    authorizationExpiresAt: Date;
  };
  challenge: {
    invitationId: string;
    generation: 1;
    purpose: 'join_class';
    codeDigest: string;
    lookupDigest: string;
    expiresAt: Date;
    failedAttempts: 0;
  };
  delivery: {
    invitationId: string;
    generation: 1;
    keyId: string;
    ciphertext: string;
    status: 'pending';
    providerIdempotencyKey: string;
  };
  receipt: {
    result: CreateClassInvitationResult;
    recordedAt: Date;
  };
  auditId: string;
  outboxId: string;
  actorId: string;
};

export type ClassDefinitionCommit = {
  classRecord: {
    classId: string;
    workspaceId: string;
    name: string;
    createdAt: Date;
    status: 'open';
  };
  receipt: {
    result: CreateClassResult;
    recordedAt: Date;
  };
  auditId: string;
  actorId: string;
};

export type SendClassInvitationCommit = {
  invitation: ClassInvitationCommit['invitation'];
  challenge: ClassInvitationCommit['challenge'];
  delivery: ClassInvitationCommit['delivery'];
  receipt: {
    result: CreateClassInvitationResult | ResendClassInvitationResult;
    recordedAt: Date;
  };
  auditId: string;
  outboxId: string;
  actorId: string;
  supersededInvitationId?: string;
};

type StaffProvisioningCommit = {
  staffIdentity: {
    staffIdentityId: string;
    workspaceId: string;
    displayName: string;
    email: string;
    supabaseUserId: string;
    status: 'active';
    schoolApprover: string;
    provisioningReason: string;
    createdAt: Date;
    recordOwner: 'school';
    recordClassification: 'school_administrative';
    disposalClass: 'staff_identity';
  };
  grants: readonly {
    workspaceId: string;
    staffIdentityId: string;
    permission: StaffPermission;
    grantedAt: Date;
    grantReason: string;
    recordOwner: 'school';
    recordClassification: 'school_administrative';
    disposalClass: 'staff_permission_grant';
  }[];
  receipt: {
    workspaceId: string;
    operationId: string;
    commandName: 'provisionStaffIdentity';
    result: ProvisionStaffIdentityResult;
    recordedAt: Date;
    recordOwner: 'school';
    recordClassification: 'operational_evidence';
    disposalClass: 'operation_receipt';
  };
  audit: {
    auditId: string;
    workspaceId: string;
    operationId: string;
    eventType: 'staff_identity.provisioned';
    actorType: 'technical_operator';
    actorId: string;
    occurredAt: Date;
    recordOwner: 'school';
    recordClassification: 'audit_evidence';
    disposalClass: 'workspace_audit_evidence';
  };
  outbox: {
    outboxId: string;
    workspaceId: string;
    operationId: string;
    topic: 'staff_identity.provisioned';
    payload: { staffIdentityId: string; workspaceId: string };
    status: 'pending';
    recordedAt: Date;
    recordOwner: 'school';
    recordClassification: 'operational_evidence';
    disposalClass: 'transactional_outbox';
  };
};

export function createIdentityAndAccess(dependencies: {
  committer: CreateSchoolWorkspaceCommitter;
  staffStore?: StaffAccessStore;
  staffAuth?: StaffAuthProvider;
  handles?: StaffSessionHandles;
  clock: Clock;
  ids: IdGenerator;
  classInvitations?: ClassInvitationStore;
  invitationSecrets?: InvitationSecretProtector;
  studentAccess?: StudentAccessStore;
}): IdentityAndAccess {
  function requireStaffSeams(): {
    staffStore: StaffAccessStore;
    staffAuth: StaffAuthProvider;
    handles: StaffSessionHandles;
  } {
    if (
      !dependencies.staffStore ||
      !dependencies.staffAuth ||
      !dependencies.handles
    ) {
      throw new Error('Staff identity seams are not configured');
    }
    return {
      staffStore: dependencies.staffStore,
      staffAuth: dependencies.staffAuth,
      handles: dependencies.handles,
    };
  }

  async function loadStaffSession(sessionHandle: string) {
    const { staffStore, handles } = requireStaffSeams();
    const now = dependencies.clock.now();
    return staffStore.resolveStaffSession({
      sessionHandleHash: handles.hash(sessionHandle),
      now,
      idleExpiresAt: new Date(now.getTime() + staffSessionInactivityMs),
    });
  }

  async function requireSession(
    sessionHandle: string,
  ): Promise<StaffSessionContext> {
    const resolved = await loadStaffSession(sessionHandle);
    const now = dependencies.clock.now();
    if (
      !resolved ||
      resolved.revokedAt !== undefined ||
      staffSessionHasExpired(resolved, now) ||
      resolved.status !== 'active'
    ) {
      throw new StaffAuthenticationFailedError();
    }
    return {
      sessionId: resolved.sessionId,
      staffIdentityId: resolved.staffIdentityId,
      workspaceId: resolved.workspaceId,
      displayName: resolved.displayName,
      permissions: resolved.permissions,
      authenticatedAt: resolved.authenticatedAt,
    };
  }

  function requireClassInvitationSeams() {
    if (!dependencies.classInvitations || !dependencies.invitationSecrets) {
      throw new Error('Class Invitation seams are not configured');
    }
    return {
      store: dependencies.classInvitations,
      secrets: dependencies.invitationSecrets,
    };
  }

  function effectiveInvitationStatus(
    status: InvitationStatus,
    expiresAt: Date,
    now: Date,
  ): InvitationStatus {
    if (
      (status === 'pending_delivery' || status === 'delivered') &&
      expiresAt <= now
    ) {
      return 'expired';
    }
    return status;
  }

  function deliveryStatusFor(
    invitationStatus: InvitationStatus,
    deliveryStatus: 'pending' | 'sending' | 'delivered' | 'suppressed',
  ): InvitationDeliveryStatus {
    if (deliveryStatus === 'delivered') return 'delivered';
    if (
      invitationStatus === 'delivery_failed' ||
      deliveryStatus === 'suppressed'
    ) {
      return 'failed';
    }
    return 'delayed';
  }

  function protectInvitationSecrets(input: {
    invitationId: string;
    recipient: string;
    secrets: InvitationSecretProtector;
  }) {
    const createdAt = dependencies.clock.now();
    const code = input.secrets.createCode();
    const protectedSecrets = input.secrets.protect({
      invitationId: input.invitationId,
      purpose: 'join_class',
      generation: 1,
      recipient: input.recipient,
      code,
    });
    return {
      createdAt,
      invitation: {
        invitationId: input.invitationId,
        purpose: 'join_class' as const,
        recipientDigest: protectedSecrets.recipientDigest,
        currentGeneration: 1 as const,
        status: 'pending_delivery' as const,
        createdAt,
        authorizationExpiresAt: new Date(
          createdAt.getTime() + 7 * 24 * 60 * 60 * 1000,
        ),
      },
      challenge: {
        invitationId: input.invitationId,
        generation: 1 as const,
        purpose: 'join_class' as const,
        codeDigest: protectedSecrets.codeDigest,
        lookupDigest: protectedSecrets.lookupDigest,
        expiresAt: new Date(createdAt.getTime() + 10 * 60 * 1000),
        failedAttempts: 0 as const,
      },
      delivery: {
        invitationId: input.invitationId,
        generation: 1 as const,
        keyId: protectedSecrets.keyId,
        ciphertext: protectedSecrets.ciphertext,
        status: 'pending' as const,
        providerIdempotencyKey: `${input.invitationId}:1`,
      },
    };
  }

  function assembleClassDirectory(
    snapshot: ClassDirectorySnapshot,
    secrets: InvitationSecretProtector,
  ): ClassDirectoryEntry[] {
    const now = dependencies.clock.now();
    return snapshot.classes.map((classRecord) => {
      const invitations = snapshot.invitations.filter(
        (invitation) => invitation.classId === classRecord.classId,
      );
      const memberships = snapshot.memberships.filter(
        (membership) => membership.classId === classRecord.classId,
      );
      const grouped = new Map<string, typeof invitations>();
      for (const invitation of invitations) {
        const group = grouped.get(invitation.recipientDigest) ?? [];
        group.push(invitation);
        grouped.set(invitation.recipientDigest, group);
      }
      const relationships: ClassDirectoryRelationship[] = [];
      for (const group of grouped.values()) {
        const sorted = [...group].sort((left, right) => {
          const rank = (status: InvitationStatus) =>
            status === 'superseded' ? 1 : 0;
          const ranked = rank(left.status) - rank(right.status);
          if (ranked !== 0) return ranked;
          const created = right.createdAt.getTime() - left.createdAt.getTime();
          if (created !== 0) return created;
          return right.invitationId.localeCompare(left.invitationId);
        });
        const latest = sorted[0];
        if (!latest) continue;
        const membership = memberships.find((entry) =>
          entry.emailDigests.includes(latest.recipientDigest),
        );
        let recipient = latest.recipientDigest;
        try {
          recipient = secrets.revealInvitationRecipient(latest);
        } catch {
          recipient = latest.recipientDigest;
        }
        const status = effectiveInvitationStatus(
          latest.status,
          latest.expiresAt,
          now,
        );
        relationships.push({
          recipient,
          studentId: membership?.studentId ?? null,
          classMembershipId: membership?.classMembershipId ?? null,
          membershipStatus: membership?.status ?? 'none',
          latestInvitation: {
            invitationId: latest.invitationId,
            purpose: 'join_class',
            generation: latest.generation,
            status,
            expiresAt: latest.expiresAt,
          },
          deliveryStatus: deliveryStatusFor(status, latest.deliveryStatus),
          history: [...sorted].reverse().map((item) => ({
            invitationId: item.invitationId,
            status: effectiveInvitationStatus(item.status, item.expiresAt, now),
            generation: item.generation,
            createdAt: item.createdAt,
          })),
        });
      }
      return {
        classId: classRecord.classId,
        name: classRecord.name,
        createdAt: classRecord.createdAt,
        status: classRecord.status,
        closedAt: classRecord.closedAt,
        invitations: invitations.map((invitation) => ({
          invitationId: invitation.invitationId,
          purpose: invitation.purpose,
          generation: invitation.generation,
          status: effectiveInvitationStatus(
            invitation.status,
            invitation.expiresAt,
            now,
          ),
          expiresAt: invitation.expiresAt,
        })),
        relationships,
      };
    });
  }

  function requireStudentAccessSeams() {
    const { handles } = requireStaffSeams();
    if (!dependencies.studentAccess || !dependencies.invitationSecrets) {
      throw new Error('Student access seams are not configured');
    }
    return {
      store: dependencies.studentAccess,
      secrets: dependencies.invitationSecrets,
      handles,
    };
  }

  async function requireAdministrator(sessionHandle: string) {
    const { staffStore } = requireStaffSeams();
    const session = await requireSession(sessionHandle);
    const current = await staffStore.staffHasPermission({
      staffIdentityId: session.staffIdentityId,
      workspaceId: session.workspaceId,
      permission: 'administrative',
    });
    if (!session.permissions.includes('administrative') || !current) {
      throw new StaffPermissionRequiredError('administrative');
    }
    const resolved = await loadStaffSession(sessionHandle);
    if (!resolved) throw new StaffAuthenticationFailedError();
    return {
      ...session,
      authenticationFreshAt: resolved.authenticationFreshAt,
    };
  }

  async function requireFreshAdministrator(sessionHandle: string) {
    const session = await requireAdministrator(sessionHandle);
    const now = dependencies.clock.now();
    if (
      now.getTime() - session.authenticationFreshAt.getTime() >=
      staffAuthenticationFreshnessMs
    ) {
      throw new AuthenticationFreshnessRequiredError();
    }
    return session;
  }

  async function requireFreshClinicalSession(
    sessionHandle: string,
  ): Promise<ClinicalSessionContext> {
    const { staffStore } = requireStaffSeams();
    const resolved = await loadStaffSession(sessionHandle);
    const now = dependencies.clock.now();
    if (!resolved) throw new StaffAuthenticationFailedError();
    if (resolved.revokedAt !== undefined) throw new StaffSessionRevokedError();
    if (staffSessionHasExpired(resolved, now)) {
      throw new StaffSessionExpiredError();
    }
    if (resolved.status !== 'active') {
      throw new StaffAuthenticationFailedError();
    }
    const current = await staffStore.staffHasPermission({
      staffIdentityId: resolved.staffIdentityId,
      workspaceId: resolved.workspaceId,
      permission: 'clinical',
    });
    if (!current) {
      await staffStore.recordStaffAudit({
        auditId: dependencies.ids.create(),
        workspaceId: resolved.workspaceId,
        operationId: dependencies.ids.create(),
        eventType: 'staff_authentication.denied',
        actorType: 'staff',
        actorId: resolved.staffIdentityId,
        occurredAt: now,
        details: {
          outcome: 'permission_required',
          permission: 'clinical',
          staffSessionId: resolved.sessionId,
        },
      });
      throw new StaffPermissionRequiredError('clinical');
    }
    if (
      now.getTime() - resolved.authenticationFreshAt.getTime() >
      staffAuthenticationFreshnessMs
    ) {
      throw new StaffAuthenticationStaleError();
    }
    return {
      sessionId: resolved.sessionId,
      staffIdentityId: resolved.staffIdentityId,
      workspaceId: resolved.workspaceId,
      displayName: resolved.displayName,
      permissions: resolved.permissions,
      authenticatedAt: resolved.authenticatedAt,
      authenticationFreshAt: resolved.authenticationFreshAt,
    };
  }

  async function requireAdministrativeContext(
    sessionHandle: string,
  ): Promise<AdministrativeSessionContext> {
    const { staffStore } = requireStaffSeams();
    const resolved = await loadStaffSession(sessionHandle);
    const now = dependencies.clock.now();
    if (!resolved) throw new StaffAuthenticationFailedError();
    if (resolved.revokedAt !== undefined) throw new StaffSessionRevokedError();
    if (staffSessionHasExpired(resolved, now)) {
      throw new StaffSessionExpiredError();
    }
    if (resolved.status !== 'active')
      throw new StaffAuthenticationFailedError();
    const current = await staffStore.staffHasPermission({
      staffIdentityId: resolved.staffIdentityId,
      workspaceId: resolved.workspaceId,
      permission: 'administrative',
    });
    if (!current) throw new AdministrativePermissionRequiredError();
    return {
      sessionId: resolved.sessionId,
      staffIdentityId: resolved.staffIdentityId,
      workspaceId: resolved.workspaceId,
      displayName: resolved.displayName,
      permissions: resolved.permissions,
      authenticatedAt: resolved.authenticatedAt,
      authenticationFreshAt: resolved.authenticationFreshAt,
    };
  }

  return {
    async createSchoolWorkspace(command) {
      const result: CreateSchoolWorkspaceResult = {
        operationId: command.operationId,
        workspaceId: command.workspaceId,
        outcome: 'created',
      };

      return dependencies.committer.commit({
        workspaceId: command.workspaceId,
        operationId: command.operationId,
        createRecords() {
          const recordedAt = dependencies.clock.now();
          return {
            workspace: {
              workspaceId: command.workspaceId,
              displayName: command.displayName,
              createdAt: recordedAt,
              recordOwner: 'school',
              recordClassification: 'school_administrative',
              disposalClass: 'school_workspace',
            },
            receipt: {
              ...result,
              commandName: 'createSchoolWorkspace',
              result,
              recordedAt,
              recordOwner: 'school',
              recordClassification: 'operational_evidence',
              disposalClass: 'operation_receipt',
            },
            audit: {
              auditId: dependencies.ids.create(),
              ...result,
              eventType: 'school_workspace.created',
              actorType: command.actor.type,
              actorId: command.actor.id,
              occurredAt: recordedAt,
              recordOwner: 'school',
              recordClassification: 'audit_evidence',
              disposalClass: 'workspace_audit_evidence',
            },
            outbox: {
              outboxId: dependencies.ids.create(),
              ...result,
              topic: 'school_workspace.created',
              payload: { workspaceId: command.workspaceId },
              status: 'pending',
              recordedAt,
              recordOwner: 'school',
              recordClassification: 'operational_evidence',
              disposalClass: 'transactional_outbox',
            },
          };
        },
      });
    },

    async provisionStaffIdentity(command) {
      const { staffStore, staffAuth } = requireStaffSeams();
      let credentials: { supabaseUserId: string } | undefined;
      try {
        return await staffStore.commitStaffProvisioning({
          workspaceId: command.workspaceId,
          operationId: command.operationId,
          permissions: command.permissions,
          async createRecords() {
            try {
              credentials = await staffAuth.createCredentials({
                email: command.email,
                password: command.initialPassword,
              });
            } catch (error) {
              if (error instanceof StaffCredentialsAlreadyExistError) {
                throw new StaffIdentityAlreadyExistsError();
              }
              throw error;
            }
            const result: ProvisionStaffIdentityResult = {
              operationId: command.operationId,
              staffIdentityId: command.staffIdentityId,
              supabaseUserId: credentials.supabaseUserId,
              outcome: 'provisioned',
            };
            const recordedAt = dependencies.clock.now();
            return {
              staffIdentity: {
                staffIdentityId: command.staffIdentityId,
                workspaceId: command.workspaceId,
                displayName: command.displayName,
                email: command.email,
                supabaseUserId: credentials.supabaseUserId,
                status: 'active',
                schoolApprover: command.schoolApprover,
                provisioningReason: command.reason,
                createdAt: recordedAt,
                recordOwner: 'school',
                recordClassification: 'school_administrative',
                disposalClass: 'staff_identity',
              },
              grants: command.permissions.map((permission) => ({
                workspaceId: command.workspaceId,
                staffIdentityId: command.staffIdentityId,
                permission,
                grantedAt: recordedAt,
                grantReason: command.reason,
                recordOwner: 'school' as const,
                recordClassification: 'school_administrative' as const,
                disposalClass: 'staff_permission_grant' as const,
              })),
              receipt: {
                workspaceId: command.workspaceId,
                operationId: command.operationId,
                commandName: 'provisionStaffIdentity',
                result,
                recordedAt,
                recordOwner: 'school',
                recordClassification: 'operational_evidence',
                disposalClass: 'operation_receipt',
              },
              audit: {
                auditId: dependencies.ids.create(),
                workspaceId: command.workspaceId,
                operationId: command.operationId,
                eventType: 'staff_identity.provisioned',
                actorType: command.actor.type,
                actorId: command.actor.id,
                occurredAt: recordedAt,
                recordOwner: 'school',
                recordClassification: 'audit_evidence',
                disposalClass: 'workspace_audit_evidence',
              },
              outbox: {
                outboxId: dependencies.ids.create(),
                workspaceId: command.workspaceId,
                operationId: command.operationId,
                topic: 'staff_identity.provisioned',
                payload: {
                  staffIdentityId: command.staffIdentityId,
                  workspaceId: command.workspaceId,
                },
                status: 'pending',
                recordedAt,
                recordOwner: 'school',
                recordClassification: 'operational_evidence',
                disposalClass: 'transactional_outbox',
              },
            };
          },
        });
      } catch (error) {
        // A connection can fail after PostgreSQL commits. Re-read the receipt
        // before compensation so a committed Staff Identity never loses its
        // credentials because of an ambiguous transaction outcome.
        let receipt: ProvisionStaffIdentityResult | undefined;
        try {
          receipt = await staffStore.findStaffProvisioningReceipt({
            workspaceId: command.workspaceId,
            operationId: command.operationId,
          });
        } catch (receiptError) {
          // The transaction outcome is unknowable while PostgreSQL is
          // unavailable. Preserve credentials for operator reconciliation
          // rather than risk deleting a successfully committed identity.
          throw new AggregateError(
            [error, receiptError],
            'Staff provisioning outcome must be reconciled before credential cleanup',
          );
        }
        if (receipt) return receipt;
        if (credentials) {
          try {
            await staffAuth.deleteCredentials(credentials.supabaseUserId);
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              'Staff provisioning failed and credential cleanup must be reconciled',
            );
          }
        }
        throw error;
      }
    },

    async recoverStaffIdentity(command) {
      const { staffStore, staffAuth } = requireStaffSeams();
      const receipt = await staffStore.findStaffLifecycleReceipt({
        workspaceId: command.workspaceId,
        operationId: command.operationId,
        commandName: 'recoverStaffIdentity',
      });
      if (receipt && receipt.outcome === 'recovered') return receipt;
      const identity = await staffStore.readStaffIdentity({
        workspaceId: command.workspaceId,
        staffIdentityId: command.staffIdentityId,
      });
      if (!identity || identity.status !== 'active') {
        throw new StaffIdentityNotFoundError();
      }
      await staffAuth.replacePassword({
        supabaseUserId: identity.supabaseUserId,
        password: command.newPassword,
      });
      await staffAuth.resetTotpFactors(identity.supabaseUserId);
      const result: RecoverStaffIdentityResult = {
        operationId: command.operationId,
        staffIdentityId: command.staffIdentityId,
        outcome: 'recovered',
      };
      const applied = await staffStore.applyStaffLifecycle({
        workspaceId: command.workspaceId,
        operationId: command.operationId,
        staffIdentityId: command.staffIdentityId,
        commandName: 'recoverStaffIdentity',
        change: 'revoke_sessions',
        permissions: null,
        actor: command.actor,
        reason: command.reason,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        result,
        eventType: 'staff_identity.recovered',
      });
      if (applied.outcome === 'not_found') {
        throw new StaffIdentityNotFoundError();
      }
      if (applied.outcome === 'last_administrator') {
        throw new LastAdministratorRequiredError();
      }
      return result;
    },

    async disableStaffIdentity(command) {
      const { staffStore } = requireStaffSeams();
      const receipt = await staffStore.findStaffLifecycleReceipt({
        workspaceId: command.workspaceId,
        operationId: command.operationId,
        commandName: 'disableStaffIdentity',
      });
      if (receipt && receipt.outcome === 'disabled') return receipt;
      const result: DisableStaffIdentityResult = {
        operationId: command.operationId,
        staffIdentityId: command.staffIdentityId,
        outcome: 'disabled',
      };
      const applied = await staffStore.applyStaffLifecycle({
        workspaceId: command.workspaceId,
        operationId: command.operationId,
        staffIdentityId: command.staffIdentityId,
        commandName: 'disableStaffIdentity',
        change: 'disable',
        permissions: null,
        actor: command.actor,
        reason: command.reason,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        result,
        eventType: 'staff_identity.disabled',
      });
      if (applied.outcome === 'not_found') {
        throw new StaffIdentityNotFoundError();
      }
      if (applied.outcome === 'last_administrator') {
        throw new LastAdministratorRequiredError();
      }
      return result;
    },

    async replaceStaffPermissions(command) {
      const { staffStore } = requireStaffSeams();
      const receipt = await staffStore.findStaffLifecycleReceipt({
        workspaceId: command.workspaceId,
        operationId: command.operationId,
        commandName: 'replaceStaffPermissions',
      });
      if (receipt && receipt.outcome === 'replaced') return receipt;
      const result: ReplaceStaffPermissionsResult = {
        operationId: command.operationId,
        staffIdentityId: command.staffIdentityId,
        permissions: [...command.permissions].sort(),
        outcome: 'replaced',
      };
      const applied = await staffStore.applyStaffLifecycle({
        workspaceId: command.workspaceId,
        operationId: command.operationId,
        staffIdentityId: command.staffIdentityId,
        commandName: 'replaceStaffPermissions',
        change: 'replace_permissions',
        permissions: command.permissions,
        actor: command.actor,
        reason: command.reason,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        result,
        eventType: 'staff_permission.replaced',
      });
      if (applied.outcome === 'not_found') {
        throw new StaffIdentityNotFoundError();
      }
      if (applied.outcome === 'last_administrator') {
        throw new LastAdministratorRequiredError();
      }
      return result;
    },

    async startStaffSignIn(command) {
      const { staffStore, staffAuth, handles } = requireStaffSeams();
      const verified = await staffAuth.verifyPassword({
        email: command.email,
        password: command.password,
      });
      if (verified === 'invalid') throw new StaffAuthenticationFailedError();

      // The application-owned Staff Identity is resolved through the stored
      // Supabase user link; Supabase identity metadata never substitutes for it.
      const identity = await staffStore.findStaffBySupabaseUserId({
        supabaseUserId: verified.supabaseUserId,
      });
      if (!identity || identity.status !== 'active') {
        if (identity) {
          await staffStore.recordStaffAudit({
            auditId: dependencies.ids.create(),
            workspaceId: identity.workspaceId,
            operationId: dependencies.ids.create(),
            eventType: 'staff_authentication.failed',
            actorType: 'staff',
            actorId: identity.staffIdentityId,
            occurredAt: dependencies.clock.now(),
          });
        }
        throw new StaffAuthenticationFailedError();
      }

      const challenge = await staffStore.withStaffAuthenticationLock({
        staffIdentityId: identity.staffIdentityId,
        run: () => staffAuth.prepareTotpChallenge(verified.accessToken),
      });
      const flowHandle = handles.create();
      const flowExpiresAt = new Date(
        dependencies.clock.now().getTime() + staffAuthFlowDurationMs,
      );
      await staffStore.createStaffAuthFlow({
        flowId: dependencies.ids.create(),
        flowHandleHash: handles.hash(flowHandle),
        staffIdentityId: identity.staffIdentityId,
        workspaceId: identity.workspaceId,
        supabaseAccessToken: verified.accessToken,
        factorId: challenge.factorId,
        challengeId: challenge.challengeId,
        createdAt: dependencies.clock.now(),
        expiresAt: flowExpiresAt,
      });
      return {
        flowHandle,
        flowExpiresAt,
        stage: challenge.stage,
        ...(challenge.stage === 'enroll'
          ? { otpauthUri: challenge.otpauthUri }
          : {}),
      };
    },

    async completeStaffSignIn(command) {
      const { staffStore, staffAuth, handles } = requireStaffSeams();
      const flow = await staffStore.readStaffAuthFlow({
        flowHandleHash: handles.hash(command.flowHandle),
      });
      if (
        !flow ||
        flow.consumedAt !== undefined ||
        flow.expiresAt <= dependencies.clock.now()
      ) {
        throw new StaffAuthenticationFailedError();
      }
      const verification = await staffAuth.verifyTotp({
        accessToken: flow.supabaseAccessToken,
        factorId: flow.factorId,
        challengeId: flow.challengeId,
        code: command.code,
      });
      if (
        verification === 'invalid' ||
        verification.assurance !== 'aal2' ||
        flow.status !== 'active'
      ) {
        await staffStore.recordStaffAudit({
          auditId: dependencies.ids.create(),
          workspaceId: flow.workspaceId,
          operationId: dependencies.ids.create(),
          eventType: 'staff_authentication.failed',
          actorType: 'staff',
          actorId: flow.staffIdentityId,
          occurredAt: dependencies.clock.now(),
        });
        throw new StaffAuthenticationFailedError();
      }

      const sessionHandle = handles.create();
      const authenticatedAt = dependencies.clock.now();
      const expiresAt = new Date(
        authenticatedAt.getTime() + staffSessionDurationMs,
      );
      const created = await staffStore.consumeStaffAuthFlowAndCreateSession({
        flowId: flow.flowId,
        flowHandleHash: flow.flowHandleHash,
        session: {
          sessionId: dependencies.ids.create(),
          sessionHandleHash: handles.hash(sessionHandle),
          staffIdentityId: flow.staffIdentityId,
          workspaceId: flow.workspaceId,
          authenticationAssurance: 'aal2',
          authenticatedAt,
          lastSeenAt: authenticatedAt,
          idleExpiresAt: nextStaffIdleExpiresAt(authenticatedAt, expiresAt),
          expiresAt,
        },
        audit: {
          auditId: dependencies.ids.create(),
          operationId: dependencies.ids.create(),
          eventType: 'staff_session.created',
          occurredAt: authenticatedAt,
        },
      });
      if (created !== 'created') throw new StaffAuthenticationFailedError();
      return { sessionHandle, expiresAt };
    },

    async resolveStaffSession(command) {
      const resolved = await loadStaffSession(command.sessionHandle);
      const now = dependencies.clock.now();
      if (
        !resolved ||
        resolved.authenticationAssurance !== 'aal2' ||
        resolved.revokedAt !== undefined ||
        staffSessionHasExpired(resolved, now) ||
        resolved.status !== 'active'
      ) {
        return undefined;
      }
      return {
        sessionId: resolved.sessionId,
        staffIdentityId: resolved.staffIdentityId,
        workspaceId: resolved.workspaceId,
        displayName: resolved.displayName,
        permissions: resolved.permissions,
        authenticatedAt: resolved.authenticatedAt,
      };
    },

    async requireAdministrativeSession(command) {
      return requireAdministrativeContext(command.sessionHandle);
    },

    async requireFreshClinicalSession(command) {
      return requireFreshClinicalSession(command.sessionHandle);
    },

    async stepUpStaffSession(command) {
      const { staffStore, staffAuth, handles } = requireStaffSeams();
      const sessionHandleHash = handles.hash(command.sessionHandle);
      const resolved = await loadStaffSession(command.sessionHandle);
      const now = dependencies.clock.now();
      if (!resolved) throw new StaffAuthenticationFailedError();
      const auditStepUpFailure = async (
        outcome:
          | 'rejected'
          | 'session_expired'
          | 'session_revoked'
          | 'permission_required',
      ): Promise<void> => {
        await staffStore.recordStaffAudit({
          auditId: dependencies.ids.create(),
          workspaceId: resolved.workspaceId,
          operationId: dependencies.ids.create(),
          eventType: 'staff_authentication.step_up_failed',
          actorType: 'staff',
          actorId: resolved.staffIdentityId,
          occurredAt: dependencies.clock.now(),
          details: {
            purpose: 'publish_school_configuration_release',
            outcome,
            staffSessionId: resolved.sessionId,
          },
        });
      };
      if (resolved.revokedAt !== undefined) {
        await auditStepUpFailure('session_revoked');
        throw new StaffSessionRevokedError();
      }
      if (staffSessionHasExpired(resolved, now)) {
        await auditStepUpFailure('session_expired');
        throw new StaffSessionExpiredError();
      }
      if (resolved.status !== 'active')
        throw new StaffAuthenticationFailedError();
      const hasPermission = await staffStore.staffHasPermission({
        staffIdentityId: resolved.staffIdentityId,
        workspaceId: resolved.workspaceId,
        permission: 'administrative',
      });
      if (!hasPermission) {
        await auditStepUpFailure('permission_required');
        throw new AdministrativePermissionRequiredError();
      }

      const rejectStepUp = async (): Promise<never> => {
        await auditStepUpFailure('rejected');
        throw new StepUpRejectedError();
      };

      const password = await staffAuth.verifyPassword({
        email: resolved.email,
        password: command.password,
      });
      if (
        password === 'invalid' ||
        password.supabaseUserId !== resolved.supabaseUserId
      ) {
        return rejectStepUp();
      }
      const verified = await staffStore.withStaffAuthenticationLock({
        staffIdentityId: resolved.staffIdentityId,
        run: async () => {
          const challenge = await staffAuth.prepareTotpChallenge(
            password.accessToken,
          );
          if (challenge.stage !== 'totp') return 'invalid' as const;
          return staffAuth.verifyTotp({
            accessToken: password.accessToken,
            factorId: challenge.factorId,
            challengeId: challenge.challengeId,
            code: command.totp,
          });
        },
      });
      if (verified === 'invalid' || verified.assurance !== 'aal2') {
        return rejectStepUp();
      }
      const refreshed = await staffStore.refreshStaffAuthentication({
        sessionHandleHash,
        sessionId: resolved.sessionId,
        workspaceId: resolved.workspaceId,
        staffIdentityId: resolved.staffIdentityId,
        refreshedAt: now,
        audit: {
          auditId: dependencies.ids.create(),
          operationId: dependencies.ids.create(),
          eventType: 'staff_authentication.step_up_succeeded',
        },
      });
      if (!refreshed) throw new StaffAuthenticationFailedError();
      return {
        freshUntil: new Date(now.getTime() + staffAuthenticationFreshnessMs),
      };
    },

    async endStaffSession(command) {
      const { staffStore, handles } = requireStaffSeams();
      await staffStore.revokeStaffSession({
        sessionHandleHash: handles.hash(command.sessionHandle),
        revokedAt: dependencies.clock.now(),
        audit: {
          auditId: dependencies.ids.create(),
          operationId: dependencies.ids.create(),
          eventType: 'staff_session.revoked',
          occurredAt: dependencies.clock.now(),
        },
      });
      return { outcome: 'ended' };
    },

    async listStaffIdentities(command) {
      const { staffStore } = requireStaffSeams();
      const session = await requireSession(command.sessionHandle);
      if (!session.permissions.includes('administrative')) {
        throw new StaffPermissionRequiredError('administrative');
      }
      return staffStore.listStaffDirectory({
        staffIdentityId: session.staffIdentityId,
        workspaceId: session.workspaceId,
      });
    },

    async openClinicalDirectory(command) {
      const { staffStore } = requireStaffSeams();
      const session = await requireFreshClinicalSession(command.sessionHandle);
      return {
        students: await staffStore.listClinicalDirectory({
          staffIdentityId: session.staffIdentityId,
          workspaceId: session.workspaceId,
        }),
        freshUntil: new Date(
          session.authenticationFreshAt.getTime() +
            staffAuthenticationFreshnessMs,
        ),
      };
    },

    async createClass(command) {
      const session = await requireAdministrator(command.sessionHandle);
      const { store } = requireClassInvitationSeams();
      return store.createClass({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        createRecords() {
          const createdAt = dependencies.clock.now();
          const result: CreateClassResult = {
            operationId: command.operationId,
            classId: command.classId,
            outcome: 'created',
          };
          return {
            classRecord: {
              classId: command.classId,
              workspaceId: session.workspaceId,
              name: command.name,
              createdAt,
              status: 'open',
            },
            receipt: { result, recordedAt: createdAt },
            auditId: dependencies.ids.create(),
            actorId: session.staffIdentityId,
          };
        },
      });
    },

    async createClassInvitation(command) {
      const session = await requireAdministrator(command.sessionHandle);
      const { store, secrets } = requireClassInvitationSeams();
      return store.commit({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        createRecords() {
          const createdAt = dependencies.clock.now();
          const code = secrets.createCode();
          const protectedSecrets = secrets.protect({
            invitationId: command.invitationId,
            purpose: 'join_class',
            generation: 1,
            recipient: command.recipient,
            code,
          });
          const result: CreateClassInvitationResult = {
            operationId: command.operationId,
            classId: command.classId,
            invitationId: command.invitationId,
            outcome: 'created',
          };
          return {
            classRecord: {
              classId: command.classId,
              workspaceId: session.workspaceId,
              name: command.name,
              createdAt,
              status: 'open',
            },
            invitation: {
              invitationId: command.invitationId,
              workspaceId: session.workspaceId,
              classId: command.classId,
              purpose: 'join_class',
              recipientDigest: protectedSecrets.recipientDigest,
              currentGeneration: 1,
              status: 'pending_delivery',
              createdAt,
              authorizationExpiresAt: new Date(
                createdAt.getTime() + 7 * 24 * 60 * 60 * 1000,
              ),
            },
            challenge: {
              invitationId: command.invitationId,
              generation: 1,
              purpose: 'join_class',
              codeDigest: protectedSecrets.codeDigest,
              lookupDigest: protectedSecrets.lookupDigest,
              expiresAt: new Date(createdAt.getTime() + 10 * 60 * 1000),
              failedAttempts: 0,
            },
            delivery: {
              invitationId: command.invitationId,
              generation: 1,
              keyId: protectedSecrets.keyId,
              ciphertext: protectedSecrets.ciphertext,
              status: 'pending',
              providerIdempotencyKey: `${command.invitationId}:1`,
            },
            receipt: { result, recordedAt: createdAt },
            auditId: dependencies.ids.create(),
            outboxId: dependencies.ids.create(),
            actorId: session.staffIdentityId,
          };
        },
      });
    },

    async previewClassInvitation(command) {
      const session = await requireAdministrator(command.sessionHandle);
      const { store, secrets } = requireClassInvitationSeams();
      const facts = await store.preview({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        classId: command.classId,
        recipientDigest: secrets.digestRecipient(command.recipient),
        now: dependencies.clock.now(),
      });
      if (facts.classStatus === 'missing') throw new ClassNotFoundError();
      return invitationPreviewFrom(facts);
    },

    async previewClassInvitationCsv(command) {
      const session = await requireAdministrator(command.sessionHandle);
      const { store, secrets } = requireClassInvitationSeams();
      const parsed = parseInvitationCsv(command.csv);
      if (parsed.outcome === 'rejected') {
        throw new InvitationCsvRejectedError(parsed.reason);
      }
      const existence = await store.preview({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        classId: command.classId,
        recipientDigest: secrets.digestRecipient(''),
        now: dependencies.clock.now(),
      });
      if (existence.classStatus === 'missing') throw new ClassNotFoundError();
      const rows: ClassInvitationCsvPreviewRow[] = [];
      for (const row of parsed.rows) {
        if (row.kind === 'malformed') {
          rows.push({
            lineNumber: row.lineNumber,
            field: row.field,
            outcome: 'malformed',
          });
          continue;
        }
        if (row.kind === 'duplicate_in_file') {
          rows.push({
            lineNumber: row.lineNumber,
            field: row.field,
            outcome: 'duplicate_in_file',
          });
          continue;
        }
        const facts = await store.preview({
          workspaceId: session.workspaceId,
          staffIdentityId: session.staffIdentityId,
          classId: command.classId,
          recipientDigest: secrets.digestRecipient(row.recipient),
          now: dependencies.clock.now(),
        });
        const preview = invitationPreviewFrom(facts);
        if (preview.outcome === 'ready') {
          rows.push({
            lineNumber: row.lineNumber,
            field: row.field,
            outcome: 'ready',
            reuse: preview.reuse,
          });
          continue;
        }
        if (preview.outcome === 'identity_review') {
          rows.push({
            lineNumber: row.lineNumber,
            field: row.field,
            outcome: 'identity_review',
            reason: preview.reason,
          });
          continue;
        }
        rows.push({
          lineNumber: row.lineNumber,
          field: row.field,
          outcome: preview.outcome,
        });
      }
      const ready = rows.filter((row) => row.outcome === 'ready').length;
      return {
        classId: command.classId,
        rows,
        summary: { ready, skipped: rows.length - ready },
      };
    },

    async sendClassInvitationCsv(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const { store, secrets } = requireClassInvitationSeams();
      const parsed = parseInvitationCsv(command.csv);
      if (parsed.outcome === 'rejected') {
        throw new InvitationCsvRejectedError(parsed.reason);
      }
      const selected = new Set(command.selectedLineNumbers);
      const sent = await store.sendMany({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        classId: command.classId,
        now: dependencies.clock.now(),
        actorId: session.staffIdentityId,
        auditId: dependencies.ids.create(),
        rows: parsed.rows.map((row) => ({
          lineNumber: row.lineNumber,
          field: row.field,
          kind: row.kind,
          recipient: row.kind === 'malformed' ? undefined : row.recipient,
          recipientDigest:
            row.kind === 'malformed'
              ? undefined
              : secrets.digestRecipient(row.recipient),
          selected: selected.has(row.lineNumber),
        })),
        createInvitation(recipient) {
          const invitationId = dependencies.ids.create();
          const protectedSecrets = protectInvitationSecrets({
            invitationId,
            recipient,
            secrets,
          });
          const result: CreateClassInvitationResult = {
            operationId: command.operationId,
            classId: command.classId,
            invitationId,
            outcome: 'created',
          };
          return {
            invitation: {
              ...protectedSecrets.invitation,
              workspaceId: session.workspaceId,
              classId: command.classId,
            },
            challenge: protectedSecrets.challenge,
            delivery: protectedSecrets.delivery,
            receipt: { result, recordedAt: protectedSecrets.createdAt },
            auditId: dependencies.ids.create(),
            outboxId: dependencies.ids.create(),
            actorId: session.staffIdentityId,
          };
        },
      });
      if (sent.outcome === 'class_missing') throw new ClassNotFoundError();
      return sent.result;
    },

    async sendClassInvitation(command) {
      const session = await requireAdministrator(command.sessionHandle);
      const { store, secrets } = requireClassInvitationSeams();
      const recipientDigest = secrets.digestRecipient(command.recipient);
      const sent = await store.send({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        classId: command.classId,
        recipientDigest,
        now: dependencies.clock.now(),
        createRecords() {
          const protectedSecrets = protectInvitationSecrets({
            invitationId: command.invitationId,
            recipient: command.recipient,
            secrets,
          });
          const result: CreateClassInvitationResult = {
            operationId: command.operationId,
            classId: command.classId,
            invitationId: command.invitationId,
            outcome: 'created',
          };
          return {
            invitation: {
              ...protectedSecrets.invitation,
              workspaceId: session.workspaceId,
              classId: command.classId,
            },
            challenge: protectedSecrets.challenge,
            delivery: protectedSecrets.delivery,
            receipt: { result, recordedAt: protectedSecrets.createdAt },
            auditId: dependencies.ids.create(),
            outboxId: dependencies.ids.create(),
            actorId: session.staffIdentityId,
          };
        },
      });
      if (sent.outcome === 'replayed' || sent.outcome === 'created') {
        return sent.result;
      }
      if (sent.preview.classStatus === 'missing') {
        throw new ClassNotFoundError();
      }
      const preview = invitationPreviewFrom(sent.preview);
      if (preview.outcome === 'class_closed') throw new ClassClosedError();
      throw new InvitationNotSendableError(preview.outcome);
    },

    async resendClassInvitation(command) {
      const session = await requireAdministrator(command.sessionHandle);
      const { store, secrets } = requireClassInvitationSeams();
      const current = await store.readInvitation({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        invitationId: command.invitationId,
      });
      if (!current) throw new InvitationNotFoundError();
      if (current.classStatus === 'closed') throw new ClassClosedError();
      const recipient = secrets.revealInvitationRecipient(current);
      const resent = await store.resend({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        invitationId: command.invitationId,
        createRecords() {
          const protectedSecrets = protectInvitationSecrets({
            invitationId: command.replacementInvitationId,
            recipient,
            secrets,
          });
          const result: ResendClassInvitationResult = {
            operationId: command.operationId,
            classId: current.classId,
            invitationId: command.replacementInvitationId,
            supersededInvitationId: command.invitationId,
            outcome: 'superseded',
          };
          return {
            invitation: {
              ...protectedSecrets.invitation,
              workspaceId: session.workspaceId,
              classId: current.classId,
            },
            challenge: protectedSecrets.challenge,
            delivery: protectedSecrets.delivery,
            receipt: { result, recordedAt: protectedSecrets.createdAt },
            auditId: dependencies.ids.create(),
            outboxId: dependencies.ids.create(),
            actorId: session.staffIdentityId,
            supersededInvitationId: command.invitationId,
          };
        },
      });
      if (resent.outcome === 'replayed' || resent.outcome === 'superseded') {
        return resent.result;
      }
      if (resent.outcome === 'not_found') throw new InvitationNotFoundError();
      if (resent.outcome === 'class_closed') throw new ClassClosedError();
      throw new InvitationNotSendableError('already_invited');
    },

    async revokeClassInvitation(command) {
      const session = await requireAdministrator(command.sessionHandle);
      const { store } = requireClassInvitationSeams();
      const result: RevokeClassInvitationResult = {
        operationId: command.operationId,
        invitationId: command.invitationId,
        outcome: 'revoked',
      };
      const revoked = await store.revoke({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        invitationId: command.invitationId,
        auditId: dependencies.ids.create(),
        occurredAt: dependencies.clock.now(),
        result,
      });
      if (revoked.outcome === 'not_found') throw new InvitationNotFoundError();
      return revoked.result;
    },

    async deactivateClassMembership(command) {
      const session = await requireAdministrator(command.sessionHandle);
      const { store } = requireClassInvitationSeams();
      const result: DeactivateClassMembershipResult = {
        operationId: command.operationId,
        classMembershipId: command.classMembershipId,
        outcome: 'deactivated',
      };
      const deactivated = await store.deactivateMembership({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        classMembershipId: command.classMembershipId,
        auditId: dependencies.ids.create(),
        occurredAt: dependencies.clock.now(),
        result,
      });
      if (deactivated.outcome === 'not_found') {
        throw new ClassMembershipNotFoundError();
      }
      return deactivated.result;
    },

    async closeClass(command) {
      const session = await requireAdministrator(command.sessionHandle);
      const { store } = requireClassInvitationSeams();
      const closed = await store.closeClass({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        classId: command.classId,
        auditId: dependencies.ids.create(),
        occurredAt: dependencies.clock.now(),
        actorId: session.staffIdentityId,
      });
      if (closed.outcome === 'not_found') throw new ClassNotFoundError();
      if (closed.outcome === 'already_closed') throw new ClassClosedError();
      return closed.result;
    },

    async listClasses(command) {
      const session = await requireAdministrator(command.sessionHandle);
      const { store, secrets } = requireClassInvitationSeams();
      return assembleClassDirectory(
        await store.list({
          workspaceId: session.workspaceId,
          staffIdentityId: session.staffIdentityId,
        }),
        secrets,
      );
    },

    async redeemInvitation(command) {
      const { store, secrets, handles } = requireStudentAccessSeams();
      const attemptedAt = dependencies.clock.now();
      const recipientDigest = secrets.digestRecipient(command.recipient);
      const candidate = await store.claimInvitationAttempt({
        recipientDigest,
        lookupDigest: secrets.digestInvitationLookup(command),
        attemptedAt,
      });
      if (
        !candidate ||
        !secrets.codeMatches({
          invitationId: candidate.invitationId,
          purpose: candidate.purpose,
          generation: candidate.generation,
          code: command.code,
          expectedDigest: candidate.codeDigest,
        })
      ) {
        throw new StudentAuthenticationFailedError();
      }

      const proposedStudentId = dependencies.ids.create();
      const sessionHandle = handles.create();
      const absoluteExpiresAt = new Date(
        attemptedAt.getTime() + 8 * 60 * 60 * 1000,
      );
      const result = await store.redeemInvitation({
        recipientDigest,
        candidate,
        codeDigest: secrets.digestCode({
          invitationId: candidate.invitationId,
          purpose: candidate.purpose,
          generation: candidate.generation,
          code: command.code,
        }),
        attemptedAt,
        proposedStudentId,
        verifiedEmailAddressId: dependencies.ids.create(),
        protectedRecipient: secrets.protectRecipient({
          workspaceId: candidate.workspaceId,
          studentId: proposedStudentId,
          recipient: command.recipient,
        }),
        classMembershipId: dependencies.ids.create(),
        session: {
          sessionId: dependencies.ids.create(),
          sessionHandleHash: handles.hash(sessionHandle),
          idleExpiresAt: new Date(attemptedAt.getTime() + 30 * 60 * 1000),
          absoluteExpiresAt,
        },
        audit: {
          auditId: dependencies.ids.create(),
          operationId: dependencies.ids.create(),
        },
      });
      if (result === 'unavailable') {
        throw new StudentAuthenticationFailedError();
      }
      return { sessionHandle, absoluteExpiresAt };
    },

    async resolveStudentSession(command) {
      const { store, handles } = requireStudentAccessSeams();
      const resolvedAt = dependencies.clock.now();
      return store.resolveStudentSession({
        sessionHandleHash: handles.hash(command.sessionHandle),
        resolvedAt,
        idleExpiresAt: new Date(resolvedAt.getTime() + 30 * 60 * 1000),
      });
    },
  };
}

type GovernanceMetadata = {
  recordOwner: 'school';
  recordClassification:
    'school_administrative' | 'operational_evidence' | 'audit_evidence';
  disposalClass:
    | 'school_workspace'
    | 'operation_receipt'
    | 'workspace_audit_evidence'
    | 'transactional_outbox';
};

type CreateSchoolWorkspaceCommit = {
  workspace: GovernanceMetadata & {
    workspaceId: string;
    displayName: string;
    createdAt: Date;
  };
  receipt: GovernanceMetadata & {
    workspaceId: string;
    operationId: string;
    commandName: 'createSchoolWorkspace';
    result: CreateSchoolWorkspaceResult;
    recordedAt: Date;
  };
  audit: GovernanceMetadata & {
    auditId: string;
    workspaceId: string;
    operationId: string;
    eventType: 'school_workspace.created';
    actorType: 'technical_operator';
    actorId: string;
    occurredAt: Date;
  };
  outbox: GovernanceMetadata & {
    outboxId: string;
    workspaceId: string;
    operationId: string;
    topic: 'school_workspace.created';
    payload: { workspaceId: string };
    status: 'pending';
    recordedAt: Date;
  };
};

type CreateSchoolWorkspaceCommitter = {
  commit(request: {
    workspaceId: string;
    operationId: string;
    createRecords(): CreateSchoolWorkspaceCommit;
  }): Promise<CreateSchoolWorkspaceResult>;
};
