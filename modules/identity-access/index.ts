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
  createClassInvitation(
    command: CreateClassInvitationCommand,
  ): Promise<CreateClassInvitationResult>;
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

export type ClassDirectoryEntry = {
  classId: string;
  name: string;
  createdAt: Date;
  invitations: {
    invitationId: string;
    purpose: 'join_class';
    generation: number;
    status:
      | 'pending_delivery'
      | 'delivered'
      | 'delivery_failed'
      | 'expired'
      | 'completed'
      | 'revoked'
      | 'superseded';
    expiresAt: Date;
  }[];
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

export class StudentAuthenticationFailedError extends Error {
  readonly code = 'STUDENT_AUTHENTICATION_FAILED';

  constructor() {
    super('Student authentication failed');
    this.name = 'StudentAuthenticationFailedError';
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
  outcome: 'provisioned';
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
};

export type StaffSessionHandles = {
  create(): string;
  hash(handle: string): string;
};

export const staffSessionDurationMs = 8 * 60 * 60 * 1000;
export const staffAuthFlowDurationMs = 10 * 60 * 1000;
export const staffAuthenticationFreshnessMs = 15 * 60 * 1000;

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
    createRecords(): Promise<StaffProvisioningCommit>;
  }): Promise<ProvisionStaffIdentityResult>;
  findStaffBySupabaseUserId(request: {
    supabaseUserId: string;
  }): Promise<ProvisionedStaffIdentity | undefined>;
  recordStaffAudit(request: {
    auditId: string;
    workspaceId: string;
    operationId: string;
    eventType:
      'staff_authentication.failed' | 'staff_authentication.step_up_failed';
    actorType: 'staff';
    actorId: string;
    occurredAt: Date;
    details?: {
      purpose: 'publish_school_configuration_release';
      outcome:
        | 'rejected'
        | 'session_expired'
        | 'session_revoked'
        | 'permission_required';
      staffSessionId: string;
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
      expiresAt: Date;
    };
    audit: {
      auditId: string;
      operationId: string;
      eventType: 'staff_session.created';
      occurredAt: Date;
    };
  }): Promise<'created' | 'unavailable'>;
  resolveStaffSession(request: { sessionHandleHash: string }): Promise<
    | (StaffSessionContext & {
        email: string;
        supabaseUserId: string;
        authenticationFreshAt: Date;
        authenticationAssurance: 'aal2';
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

export type ClassInvitationStore = {
  commit(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    createRecords(): ClassInvitationCommit;
  }): Promise<CreateClassInvitationResult>;
  list(request: {
    workspaceId: string;
    staffIdentityId: string;
  }): Promise<ClassDirectoryEntry[]>;
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

  async function requireSession(
    sessionHandle: string,
  ): Promise<StaffSessionContext> {
    const { staffStore, handles } = requireStaffSeams();
    const resolved = await staffStore.resolveStaffSession({
      sessionHandleHash: handles.hash(sessionHandle),
    });
    const now = dependencies.clock.now();
    if (
      !resolved ||
      resolved.revokedAt !== undefined ||
      resolved.expiresAt <= now ||
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
    const resolved = await staffStore.resolveStaffSession({
      sessionHandleHash: requireStaffSeams().handles.hash(sessionHandle),
    });
    if (!resolved) throw new StaffAuthenticationFailedError();
    return {
      ...session,
      authenticationFreshAt: resolved.authenticationFreshAt,
    };
  }

  async function requireFreshClinicalSession(
    sessionHandle: string,
  ): Promise<ClinicalSessionContext> {
    const { staffStore, handles } = requireStaffSeams();
    const resolved = await staffStore.resolveStaffSession({
      sessionHandleHash: handles.hash(sessionHandle),
    });
    const now = dependencies.clock.now();
    if (!resolved) throw new StaffAuthenticationFailedError();
    if (resolved.revokedAt !== undefined) throw new StaffSessionRevokedError();
    if (resolved.expiresAt <= now) throw new StaffSessionExpiredError();
    if (resolved.status !== 'active') {
      throw new StaffAuthenticationFailedError();
    }
    const current = await staffStore.staffHasPermission({
      staffIdentityId: resolved.staffIdentityId,
      workspaceId: resolved.workspaceId,
      permission: 'clinical',
    });
    if (!current) throw new StaffPermissionRequiredError('clinical');
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
    const { staffStore, handles } = requireStaffSeams();
    const resolved = await staffStore.resolveStaffSession({
      sessionHandleHash: handles.hash(sessionHandle),
    });
    const now = dependencies.clock.now();
    if (!resolved) throw new StaffAuthenticationFailedError();
    if (resolved.revokedAt !== undefined) throw new StaffSessionRevokedError();
    if (resolved.expiresAt <= now) throw new StaffSessionExpiredError();
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
      const { staffStore, handles } = requireStaffSeams();
      const resolved = await staffStore.resolveStaffSession({
        sessionHandleHash: handles.hash(command.sessionHandle),
      });
      const now = dependencies.clock.now();
      if (
        !resolved ||
        resolved.authenticationAssurance !== 'aal2' ||
        resolved.revokedAt !== undefined ||
        resolved.expiresAt <= now ||
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
      const resolved = await staffStore.resolveStaffSession({
        sessionHandleHash,
      });
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
      if (resolved.expiresAt <= now) {
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

    async listClasses(command) {
      const session = await requireAdministrator(command.sessionHandle);
      const { store } = requireClassInvitationSeams();
      return store.list({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
      });
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
