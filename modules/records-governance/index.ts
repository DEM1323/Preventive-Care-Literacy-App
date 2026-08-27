import type {
  Clock,
  IdGenerator,
  IdentityAndAccess,
} from '../identity-access/index.ts';
import {
  AuthenticationFreshnessRequiredError,
  staffAuthenticationFreshnessMs,
  StudentNotFoundError,
  type StudentPresence,
} from '../identity-access/index.ts';

export { AuthenticationFreshnessRequiredError, StudentNotFoundError };
export type { StudentPresence };

export const studentDepartureReasons = [
  'transferred',
  'graduated',
  'withdrew',
] as const;
export type StudentDepartureReason = (typeof studentDepartureReasons)[number];

export const recordLifecycleCaseTypes = [
  'access',
  'amendment',
  'transfer',
  'disclosure',
  'hold',
  'disposition',
] as const;
export type RecordLifecycleCaseType = (typeof recordLifecycleCaseTypes)[number];

export const recordLifecycleRequestCodes = [
  'lawful_access',
  'amendment_challenge',
  'transfer',
  'disclosure',
  'preservation',
  'scheduled_destruction',
] as const;
export type RecordLifecycleRequestCode =
  (typeof recordLifecycleRequestCodes)[number];

export const recordLifecycleRequesterKinds = [
  'school_administrator',
  'school_nurse',
  'legal_custodian',
  'student',
  'parent_guardian',
] as const;
export type RecordLifecycleRequesterKind =
  (typeof recordLifecycleRequesterKinds)[number];

export const recordLifecycleAuthorityKinds = [
  'school_administrator',
  'school_nurse',
  'legal_custodian',
] as const;
export type RecordLifecycleAuthorityKind =
  (typeof recordLifecycleAuthorityKinds)[number];

export const recordLifecycleScopePortions = [
  'identity',
  'membership',
  'intake',
  'learning_progress',
  'audit_evidence',
  'complete_bundle',
] as const;
export type RecordLifecycleScopePortion =
  (typeof recordLifecycleScopePortions)[number];

export const recordLifecycleScopePurposes = [
  'lawful_access',
  'amendment_challenge',
  'transfer',
  'disclosure',
  'preservation',
  'scheduled_destruction',
] as const;
export type RecordLifecycleScopePurpose =
  (typeof recordLifecycleScopePurposes)[number];

export type RecordLifecycleScope = {
  portions: RecordLifecycleScopePortion[];
  purpose: RecordLifecycleScopePurpose;
};

export const recordLifecycleDecisions = [
  'pending',
  'authorized',
  'denied',
  'withdrawn',
] as const;
export type RecordLifecycleDecision = (typeof recordLifecycleDecisions)[number];

export const recordLifecycleOutcomes = [
  'open',
  'completed',
  'cancelled',
] as const;
export type RecordLifecycleOutcome = (typeof recordLifecycleOutcomes)[number];

export const recordHoldReasons = ['school_preservation'] as const;
export type RecordHoldReason = (typeof recordHoldReasons)[number];

export const recordHoldStoredReasons = [
  'school_preservation',
  'open_access_case',
  'open_amendment_case',
  'hold_case',
] as const;
export type RecordHoldStoredReason = (typeof recordHoldStoredReasons)[number];

export const recordHoldSources = [
  'manual',
  'automatic_access_case',
  'automatic_amendment_case',
  'hold_case',
] as const;
export type RecordHoldSource = (typeof recordHoldSources)[number];

export const destructionEligibilityStates = [
  'not_eligible',
  'eligible_after_departure',
  'blocked_by_hold',
] as const;
export type DestructionEligibility =
  (typeof destructionEligibilityStates)[number];

export type RecordStudentDepartureCommand = {
  sessionHandle: string;
  operationId: string;
  studentId: string;
  reason: StudentDepartureReason;
  effectiveOn: string;
};

export type RecordStudentDepartureResult = {
  operationId: string;
  studentId: string;
  outcome: 'departed';
};

export type ReverseStudentDepartureCommand = {
  sessionHandle: string;
  operationId: string;
  studentId: string;
};

export type ReverseStudentDepartureResult = {
  operationId: string;
  studentId: string;
  outcome: 'reversed';
};

export type OpenRecordLifecycleCaseCommand = {
  sessionHandle: string;
  operationId: string;
  studentId: string;
  caseType: RecordLifecycleCaseType;
  requestCode: RecordLifecycleRequestCode;
  requesterKind: RecordLifecycleRequesterKind;
  authorityKind: RecordLifecycleAuthorityKind;
  scope: RecordLifecycleScope;
  deadlineAt: string;
};

export type OpenRecordLifecycleCaseResult = {
  operationId: string;
  studentId: string;
  caseId: string;
  caseType: RecordLifecycleCaseType;
  policyRevisionId: string;
  outcome: 'opened';
};

export type DecideRecordLifecycleCaseCommand = {
  sessionHandle: string;
  operationId: string;
  caseId: string;
  decision: Exclude<RecordLifecycleDecision, 'pending'>;
};

export type DecideRecordLifecycleCaseResult = {
  operationId: string;
  caseId: string;
  outcome: 'decided';
};

export type RecordRecordLifecycleCaseOutcomeCommand = {
  sessionHandle: string;
  operationId: string;
  caseId: string;
  outcome: Exclude<RecordLifecycleOutcome, 'open'>;
};

export type RecordRecordLifecycleCaseOutcomeResult = {
  operationId: string;
  caseId: string;
  outcome: 'recorded';
};

export type EstablishRecordHoldCommand = {
  sessionHandle: string;
  operationId: string;
  studentId: string;
  reason: RecordHoldReason;
};

export type EstablishRecordHoldResult = {
  operationId: string;
  studentId: string;
  holdId: string;
  outcome: 'established';
};

export type ReleaseRecordHoldCommand = {
  sessionHandle: string;
  operationId: string;
  holdId: string;
};

export type ReleaseRecordHoldResult = {
  operationId: string;
  holdId: string;
  outcome: 'released';
};

export type RecordLifecycleCaseView = {
  caseId: string;
  caseType: RecordLifecycleCaseType;
  requestCode: RecordLifecycleRequestCode;
  requesterKind: RecordLifecycleRequesterKind;
  authorityKind: RecordLifecycleAuthorityKind;
  scope: RecordLifecycleScope;
  deadlineAt: string;
  decision: RecordLifecycleDecision;
  outcome: RecordLifecycleOutcome;
  policyRevisionId: string;
  openedAt: string;
  closedAt: string | null;
};

export type RecordHoldView = {
  holdId: string;
  source: RecordHoldSource;
  reason: RecordHoldStoredReason;
  status: 'active' | 'released';
  caseId: string | null;
  establishedAt: string;
  releasedAt: string | null;
};

export type StudentRecordsGovernanceView = {
  studentId: string;
  presence: StudentPresence;
  accessStatus: 'active' | 'disabled';
  departure: {
    reason: StudentDepartureReason;
    effectiveOn: string;
    recordedAt: string;
  } | null;
  cases: RecordLifecycleCaseView[];
  holds: RecordHoldView[];
  destructionEligibility: DestructionEligibility;
  policyRevisionId: string;
};

export type RecordsGovernanceDirectory = {
  students: StudentRecordsGovernanceView[];
};

export class StudentAlreadyDepartedError extends Error {
  readonly code = 'STUDENT_ALREADY_DEPARTED';

  constructor() {
    super('Student Departure is already recorded');
    this.name = 'StudentAlreadyDepartedError';
  }
}

export class StudentNotDepartedError extends Error {
  readonly code = 'STUDENT_NOT_DEPARTED';

  constructor() {
    super('Student Departure is not recorded');
    this.name = 'StudentNotDepartedError';
  }
}

export class RecordLifecycleCaseNotFoundError extends Error {
  readonly code = 'RECORD_LIFECYCLE_CASE_NOT_FOUND';

  constructor() {
    super('Record Lifecycle Case was not found');
    this.name = 'RecordLifecycleCaseNotFoundError';
  }
}

export class RecordLifecycleCaseNotOpenError extends Error {
  readonly code = 'RECORD_LIFECYCLE_CASE_NOT_OPEN';

  constructor() {
    super('Record Lifecycle Case is not open');
    this.name = 'RecordLifecycleCaseNotOpenError';
  }
}

export class RecordHoldNotFoundError extends Error {
  readonly code = 'RECORD_HOLD_NOT_FOUND';

  constructor() {
    super('Record Hold was not found');
    this.name = 'RecordHoldNotFoundError';
  }
}

export class RecordHoldNotActiveError extends Error {
  readonly code = 'RECORD_HOLD_NOT_ACTIVE';

  constructor() {
    super('Record Hold is not active');
    this.name = 'RecordHoldNotActiveError';
  }
}

export class RecordLifecycleCaseRequestMismatchError extends Error {
  readonly code = 'RECORD_LIFECYCLE_CASE_REQUEST_MISMATCH';

  constructor() {
    super('Record Lifecycle Case type does not match the request code');
    this.name = 'RecordLifecycleCaseRequestMismatchError';
  }
}

export class RecordLifecycleCaseDecisionRequiredError extends Error {
  readonly code = 'RECORD_LIFECYCLE_CASE_DECISION_REQUIRED';

  constructor() {
    super('Record Lifecycle Case needs a decision before an outcome');
    this.name = 'RecordLifecycleCaseDecisionRequiredError';
  }
}

export class RecordHoldNotReleasableError extends Error {
  readonly code = 'RECORD_HOLD_NOT_RELEASABLE';

  constructor() {
    super(
      'Automatic Record Holds release when the Record Lifecycle Case closes',
    );
    this.name = 'RecordHoldNotReleasableError';
  }
}

export const recordLifecycleRequestByType = {
  access: 'lawful_access',
  amendment: 'amendment_challenge',
  transfer: 'transfer',
  disclosure: 'disclosure',
  hold: 'preservation',
  disposition: 'scheduled_destruction',
} as const satisfies Record<
  RecordLifecycleCaseType,
  RecordLifecycleRequestCode
>;

export function requestCodeMatchesCaseType(
  caseType: RecordLifecycleCaseType,
  requestCode: RecordLifecycleRequestCode,
): boolean {
  return recordLifecycleRequestByType[caseType] === requestCode;
}

export type RecordsGovernanceStore = {
  recordDeparture(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    studentId: string;
    reason: StudentDepartureReason;
    effectiveOn: string;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    departureFactId: string;
    result: RecordStudentDepartureResult;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; result: RecordStudentDepartureResult }
    | { outcome: 'not_found' }
    | { outcome: 'already_departed' }
  >;
  reverseDeparture(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    studentId: string;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    departureFactId: string;
    result: ReverseStudentDepartureResult;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; result: ReverseStudentDepartureResult }
    | { outcome: 'not_found' }
    | { outcome: 'not_departed' }
  >;
  openCase(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    studentId: string;
    caseType: RecordLifecycleCaseType;
    requestCode: RecordLifecycleRequestCode;
    requesterKind: RecordLifecycleRequesterKind;
    authorityKind: RecordLifecycleAuthorityKind;
    scope: RecordLifecycleScope;
    deadlineAt: Date;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    caseId: string;
    caseEventId: string;
    holdId: string;
    result: OpenRecordLifecycleCaseResult;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; result: OpenRecordLifecycleCaseResult }
    | { outcome: 'not_found' }
  >;
  decideCase(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    caseId: string;
    decision: Exclude<RecordLifecycleDecision, 'pending'>;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    caseEventId: string;
    result: DecideRecordLifecycleCaseResult;
  }): Promise<
    | {
        outcome: 'applied' | 'replayed';
        result: DecideRecordLifecycleCaseResult;
      }
    | { outcome: 'not_found' }
    | { outcome: 'not_open' }
  >;
  recordCaseOutcome(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    caseId: string;
    caseOutcome: Exclude<RecordLifecycleOutcome, 'open'>;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    caseEventId: string;
    result: RecordRecordLifecycleCaseOutcomeResult;
  }): Promise<
    | {
        outcome: 'applied' | 'replayed';
        result: RecordRecordLifecycleCaseOutcomeResult;
      }
    | { outcome: 'not_found' }
    | { outcome: 'not_open' }
    | { outcome: 'decision_required' }
  >;
  establishHold(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    studentId: string;
    reason: RecordHoldReason;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    holdId: string;
    result: EstablishRecordHoldResult;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; result: EstablishRecordHoldResult }
    | { outcome: 'not_found' }
  >;
  releaseHold(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    holdId: string;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    result: ReleaseRecordHoldResult;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; result: ReleaseRecordHoldResult }
    | { outcome: 'not_found' }
    | { outcome: 'not_active' }
    | { outcome: 'not_releasable' }
  >;
  list(request: {
    workspaceId: string;
    staffIdentityId: string;
  }): Promise<RecordsGovernanceDirectory>;
};

export type RecordsGovernance = {
  recordStudentDeparture(
    command: RecordStudentDepartureCommand,
  ): Promise<RecordStudentDepartureResult>;
  reverseStudentDeparture(
    command: ReverseStudentDepartureCommand,
  ): Promise<ReverseStudentDepartureResult>;
  openRecordLifecycleCase(
    command: OpenRecordLifecycleCaseCommand,
  ): Promise<OpenRecordLifecycleCaseResult>;
  decideRecordLifecycleCase(
    command: DecideRecordLifecycleCaseCommand,
  ): Promise<DecideRecordLifecycleCaseResult>;
  recordRecordLifecycleCaseOutcome(
    command: RecordRecordLifecycleCaseOutcomeCommand,
  ): Promise<RecordRecordLifecycleCaseOutcomeResult>;
  establishRecordHold(
    command: EstablishRecordHoldCommand,
  ): Promise<EstablishRecordHoldResult>;
  releaseRecordHold(
    command: ReleaseRecordHoldCommand,
  ): Promise<ReleaseRecordHoldResult>;
  listRecordsGovernance(command: {
    sessionHandle: string;
  }): Promise<RecordsGovernanceDirectory>;
};

function requireFresh(session: {
  authenticationFreshAt: Date;
  now: Date;
}): void {
  if (
    session.now.getTime() - session.authenticationFreshAt.getTime() >=
    staffAuthenticationFreshnessMs
  ) {
    throw new AuthenticationFreshnessRequiredError();
  }
}

export function createRecordsGovernance(dependencies: {
  identityAndAccess: Pick<IdentityAndAccess, 'requireAdministrativeSession'>;
  store: RecordsGovernanceStore;
  clock: Clock;
  ids: IdGenerator;
}): RecordsGovernance {
  async function requireFreshAdministrator(sessionHandle: string) {
    const session =
      await dependencies.identityAndAccess.requireAdministrativeSession({
        sessionHandle,
      });
    requireFresh({
      authenticationFreshAt: session.authenticationFreshAt,
      now: dependencies.clock.now(),
    });
    return session;
  }

  return {
    async recordStudentDeparture(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const result: RecordStudentDepartureResult = {
        operationId: command.operationId,
        studentId: command.studentId,
        outcome: 'departed',
      };
      const recorded = await dependencies.store.recordDeparture({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        studentId: command.studentId,
        reason: command.reason,
        effectiveOn: command.effectiveOn,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        departureFactId: dependencies.ids.create(),
        result,
      });
      if (recorded.outcome === 'not_found') throw new StudentNotFoundError();
      if (recorded.outcome === 'already_departed') {
        throw new StudentAlreadyDepartedError();
      }
      return recorded.result;
    },

    async reverseStudentDeparture(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const result: ReverseStudentDepartureResult = {
        operationId: command.operationId,
        studentId: command.studentId,
        outcome: 'reversed',
      };
      const reversed = await dependencies.store.reverseDeparture({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        studentId: command.studentId,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        departureFactId: dependencies.ids.create(),
        result,
      });
      if (reversed.outcome === 'not_found') throw new StudentNotFoundError();
      if (reversed.outcome === 'not_departed') {
        throw new StudentNotDepartedError();
      }
      return reversed.result;
    },

    async openRecordLifecycleCase(command) {
      if (!requestCodeMatchesCaseType(command.caseType, command.requestCode)) {
        throw new RecordLifecycleCaseRequestMismatchError();
      }
      const session = await requireFreshAdministrator(command.sessionHandle);
      const caseId = dependencies.ids.create();
      const result: OpenRecordLifecycleCaseResult = {
        operationId: command.operationId,
        studentId: command.studentId,
        caseId,
        caseType: command.caseType,
        policyRevisionId: '',
        outcome: 'opened',
      };
      const opened = await dependencies.store.openCase({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        studentId: command.studentId,
        caseType: command.caseType,
        requestCode: command.requestCode,
        requesterKind: command.requesterKind,
        authorityKind: command.authorityKind,
        scope: command.scope,
        deadlineAt: new Date(command.deadlineAt),
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        caseId,
        caseEventId: dependencies.ids.create(),
        holdId: dependencies.ids.create(),
        result,
      });
      if (opened.outcome === 'not_found') throw new StudentNotFoundError();
      return opened.result;
    },

    async decideRecordLifecycleCase(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const result: DecideRecordLifecycleCaseResult = {
        operationId: command.operationId,
        caseId: command.caseId,
        outcome: 'decided',
      };
      const decided = await dependencies.store.decideCase({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        caseId: command.caseId,
        decision: command.decision,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        caseEventId: dependencies.ids.create(),
        result,
      });
      if (decided.outcome === 'not_found') {
        throw new RecordLifecycleCaseNotFoundError();
      }
      if (decided.outcome === 'not_open') {
        throw new RecordLifecycleCaseNotOpenError();
      }
      return decided.result;
    },

    async recordRecordLifecycleCaseOutcome(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const result: RecordRecordLifecycleCaseOutcomeResult = {
        operationId: command.operationId,
        caseId: command.caseId,
        outcome: 'recorded',
      };
      const recorded = await dependencies.store.recordCaseOutcome({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        caseId: command.caseId,
        caseOutcome: command.outcome,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        caseEventId: dependencies.ids.create(),
        result,
      });
      if (recorded.outcome === 'not_found') {
        throw new RecordLifecycleCaseNotFoundError();
      }
      if (recorded.outcome === 'not_open') {
        throw new RecordLifecycleCaseNotOpenError();
      }
      if (recorded.outcome === 'decision_required') {
        throw new RecordLifecycleCaseDecisionRequiredError();
      }
      return recorded.result;
    },

    async establishRecordHold(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const holdId = dependencies.ids.create();
      const result: EstablishRecordHoldResult = {
        operationId: command.operationId,
        studentId: command.studentId,
        holdId,
        outcome: 'established',
      };
      const established = await dependencies.store.establishHold({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        studentId: command.studentId,
        reason: command.reason,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        holdId,
        result,
      });
      if (established.outcome === 'not_found') throw new StudentNotFoundError();
      return established.result;
    },

    async releaseRecordHold(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const result: ReleaseRecordHoldResult = {
        operationId: command.operationId,
        holdId: command.holdId,
        outcome: 'released',
      };
      const released = await dependencies.store.releaseHold({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        holdId: command.holdId,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        result,
      });
      if (released.outcome === 'not_found') throw new RecordHoldNotFoundError();
      if (released.outcome === 'not_active')
        throw new RecordHoldNotActiveError();
      if (released.outcome === 'not_releasable') {
        throw new RecordHoldNotReleasableError();
      }
      return released.result;
    },

    async listRecordsGovernance(command) {
      const session =
        await dependencies.identityAndAccess.requireAdministrativeSession({
          sessionHandle: command.sessionHandle,
        });
      return dependencies.store.list({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
      });
    },
  };
}
