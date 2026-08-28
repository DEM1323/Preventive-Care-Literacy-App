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
import type {
  ApplicationKeyManagement,
  SealedRecord,
} from '../intake/index.ts';

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

export const recordAmendmentDecisions = [
  'correction_authorized',
  'challenge_denied',
] as const;
export type RecordAmendmentDecision = (typeof recordAmendmentDecisions)[number];

export const recordAmendmentReasonCodes = [
  'factual_inaccuracy',
  'identity_dispute',
  'intake_inaccuracy',
  'requester_statement_only',
  'insufficient_evidence',
  'outside_authority',
] as const;
export type RecordAmendmentReasonCode =
  (typeof recordAmendmentReasonCodes)[number];

export const recordAmendmentFactKinds = [
  'identity',
  'intake_record_version',
  'membership',
  'learning_progress',
] as const;
export type RecordAmendmentFactKind = (typeof recordAmendmentFactKinds)[number];

export const recordConflictKinds = [
  'student_identity',
  'intake_record',
] as const;
export type RecordConflictKind = (typeof recordConflictKinds)[number];

export const recordConflictOutcomes = [
  'keep_distinct',
  'referred_for_amendment',
] as const;
export type RecordConflictOutcome = (typeof recordConflictOutcomes)[number];

export const recordProductionStatuses = [
  'pending_delivery',
  'delivered',
  'retrieved',
  'expired',
  'delivery_failed',
] as const;
export type RecordProductionStatus = (typeof recordProductionStatuses)[number];

export const recordProductionCleanupStatuses = [
  'pending',
  'removed',
  'failed',
] as const;
export type RecordProductionCleanupStatus =
  (typeof recordProductionCleanupStatuses)[number];

export const recordProductionTtlMs = 10 * 60 * 1000;
export const recordDispositionCancellationWindowMs = 7 * 24 * 60 * 60 * 1000;

export const recordDispositionStatuses = [
  'scheduled',
  'executing',
  'cancelled',
  'failed',
  'purged',
] as const;
export type RecordDispositionStatus =
  (typeof recordDispositionStatuses)[number];

export const recordDispositionBlockingReasons = [
  'missing_policy',
  'missing_student_departure',
  'open_hold',
  'incomplete_notice',
  'incomplete_copy_opportunity',
  'missing_structured_authority',
  'open_lifecycle_case',
] as const;
export type RecordDispositionBlockingReason =
  (typeof recordDispositionBlockingReasons)[number];

export const recordDispositionAdapters = [
  'identity_access',
  'memberships',
  'intake',
  'learning_progress',
  'clinical_access_evidence',
  'productions',
  'projections',
] as const;
export type RecordDispositionAdapter =
  (typeof recordDispositionAdapters)[number];

export type RecordDispositionPurgeEntry = {
  location: string;
  adapter: RecordDispositionAdapter;
  status: 'pending' | 'purged' | 'failed';
  count: number;
  verification: 'pending' | 'verified' | 'failed';
};

export type RecordDispositionView = {
  dispositionId: string;
  caseId: string;
  status: RecordDispositionStatus;
  version: number;
  scheduledAt: string;
  cancellationDeadlineAt: string;
  cancelledAt: string | null;
  executionStartedAt: string | null;
  completedAt: string | null;
  policyRevisionId: string;
  purgeManifest: RecordDispositionPurgeEntry[];
};

export type RecordDispositionPrerequisites = {
  blockingReasons: RecordDispositionBlockingReason[];
  noticeCompleted: boolean;
  copyOpportunityCompleted: boolean;
  hasPolicy: boolean;
  hasQualifyingDeparture: boolean;
  hasStructuredAuthority: boolean;
  openHold: boolean;
  openLifecycleCase: boolean;
};

export const recordProductionCaseTypes = [
  'access',
  'transfer',
  'disclosure',
] as const;

export type RecordAmendmentEffectiveCorrection = {
  projectionKind: RecordAmendmentFactKind;
  summaryCode: RecordAmendmentReasonCode;
  challengedFactId: string;
};

export type RecordAmendmentView = {
  amendmentId: string;
  caseId: string;
  challengedFactKind: RecordAmendmentFactKind;
  challengedFactId: string;
  decision: RecordAmendmentDecision;
  reasonCode: RecordAmendmentReasonCode;
  authorityKind: RecordLifecycleAuthorityKind;
  effectiveCorrection: RecordAmendmentEffectiveCorrection | null;
  requesterStatementPreserved: boolean;
  recordedAt: string;
};

export type RecordConflictReviewView = {
  reviewId: string;
  conflictKind: RecordConflictKind;
  subjectStudentId: string;
  conflictingStudentId: string;
  status: 'open' | 'resolved';
  outcome: RecordConflictOutcome | null;
  openedAt: string;
  resolvedAt: string | null;
};

export type RecordProductionView = {
  productionId: string;
  caseId: string;
  status: RecordProductionStatus;
  cleanupStatus: RecordProductionCleanupStatus;
  portions: RecordLifecycleScopePortion[];
  purpose: RecordLifecycleScopePurpose;
  expiresAt: string;
  deliveredAt: string | null;
  retrievedAt: string | null;
  removedAt: string | null;
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
  amendments: RecordAmendmentView[];
  conflictReviews: RecordConflictReviewView[];
  productions: RecordProductionView[];
  dispositions: RecordDispositionView[];
  dispositionPrerequisites: RecordDispositionPrerequisites;
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

export class RecordAmendmentNotApplicableError extends Error {
  readonly code = 'RECORD_AMENDMENT_NOT_APPLICABLE';

  constructor() {
    super(
      'Record Amendment can only resolve an open amendment Record Lifecycle Case',
    );
    this.name = 'RecordAmendmentNotApplicableError';
  }
}

export class RecordAmendmentDecisionMismatchError extends Error {
  readonly code = 'RECORD_AMENDMENT_DECISION_MISMATCH';

  constructor() {
    super(
      'Record Amendment decision must match the Record Lifecycle Case decision',
    );
    this.name = 'RecordAmendmentDecisionMismatchError';
  }
}

export class RecordConflictReviewRequiredError extends Error {
  readonly code = 'RECORD_CONFLICT_REVIEW_REQUIRED';
  readonly reviewId: string;

  constructor(reviewId: string) {
    super(
      'Conflicting Student identities or Intake Records need explicit audited review',
    );
    this.name = 'RecordConflictReviewRequiredError';
    this.reviewId = reviewId;
  }
}

export class RecordConflictReviewNotFoundError extends Error {
  readonly code = 'RECORD_CONFLICT_REVIEW_NOT_FOUND';

  constructor() {
    super('Record Conflict Review was not found');
    this.name = 'RecordConflictReviewNotFoundError';
  }
}

export class RecordConflictReviewNotOpenError extends Error {
  readonly code = 'RECORD_CONFLICT_REVIEW_NOT_OPEN';

  constructor() {
    super('Record Conflict Review is not open');
    this.name = 'RecordConflictReviewNotOpenError';
  }
}

export class RecordProductionNotAuthorizedError extends Error {
  readonly code = 'RECORD_PRODUCTION_NOT_AUTHORIZED';

  constructor() {
    super(
      'Record Production requires an authorized access, transfer, or disclosure Record Lifecycle Case',
    );
    this.name = 'RecordProductionNotAuthorizedError';
  }
}

export class RecordProductionUnavailableError extends Error {
  readonly code = 'RECORD_PRODUCTION_UNAVAILABLE';

  constructor() {
    super('Record Production is unavailable');
    this.name = 'RecordProductionUnavailableError';
  }
}

export class RecordProductionCleanupFailedError extends Error {
  readonly code = 'RECORD_PRODUCTION_CLEANUP_FAILED';

  constructor() {
    super('Record Production package removal is incomplete');
    this.name = 'RecordProductionCleanupFailedError';
  }
}

export class RecordDispositionNotSchedulableError extends Error {
  readonly code = 'RECORD_DISPOSITION_NOT_SCHEDULABLE';
  readonly blockingReasons: RecordDispositionBlockingReason[];

  constructor(blockingReasons: RecordDispositionBlockingReason[]) {
    super('Record Disposition cannot be scheduled');
    this.name = 'RecordDispositionNotSchedulableError';
    this.blockingReasons = blockingReasons;
  }
}

export class RecordDispositionNotFoundError extends Error {
  readonly code = 'RECORD_DISPOSITION_NOT_FOUND';

  constructor() {
    super('Record Disposition was not found');
    this.name = 'RecordDispositionNotFoundError';
  }
}

export class RecordDispositionNotCancellableError extends Error {
  readonly code = 'RECORD_DISPOSITION_NOT_CANCELLABLE';

  constructor() {
    super('Record Disposition cannot be cancelled');
    this.name = 'RecordDispositionNotCancellableError';
  }
}

export class RecordDispositionCancellationWindowOpenError extends Error {
  readonly code = 'RECORD_DISPOSITION_CANCELLATION_WINDOW_OPEN';

  constructor() {
    super('Record Disposition cancellation window is still open');
    this.name = 'RecordDispositionCancellationWindowOpenError';
  }
}

export class RecordDispositionNotExecutableError extends Error {
  readonly code = 'RECORD_DISPOSITION_NOT_EXECUTABLE';

  constructor() {
    super('Record Disposition cannot be executed');
    this.name = 'RecordDispositionNotExecutableError';
  }
}

export class RecordDispositionNotRepairableError extends Error {
  readonly code = 'RECORD_DISPOSITION_NOT_REPAIRABLE';

  constructor() {
    super('Record Disposition cannot be retried');
    this.name = 'RecordDispositionNotRepairableError';
  }
}

export class RecordDispositionVersionConflictError extends Error {
  readonly code = 'RECORD_DISPOSITION_VERSION_CONFLICT';

  constructor() {
    super('Record Disposition version does not match');
    this.name = 'RecordDispositionVersionConflictError';
  }
}

export class RecordDispositionConfirmationRequiredError extends Error {
  readonly code = 'RECORD_DISPOSITION_CONFIRMATION_REQUIRED';

  constructor() {
    super('Record Disposition requires structured confirmation');
    this.name = 'RecordDispositionConfirmationRequiredError';
  }
}

export type ResolveRecordAmendmentCommand = {
  sessionHandle: string;
  operationId: string;
  caseId: string;
  challengedFactKind: RecordAmendmentFactKind;
  challengedFactId: string;
  decision: RecordAmendmentDecision;
  reasonCode: RecordAmendmentReasonCode;
  effectiveCorrection?: RecordAmendmentEffectiveCorrection;
  requesterStatement?: string;
  relatedStudentId?: string;
};

export type ResolveRecordAmendmentResult = {
  operationId: string;
  caseId: string;
  amendmentId: string;
  outcome: 'recorded';
};

export type OpenRecordConflictReviewCommand = {
  sessionHandle: string;
  operationId: string;
  conflictKind: RecordConflictKind;
  subjectStudentId: string;
  conflictingStudentId: string;
};

export type OpenRecordConflictReviewResult = {
  operationId: string;
  reviewId: string;
  outcome: 'opened';
};

export type DecideRecordConflictReviewCommand = {
  sessionHandle: string;
  operationId: string;
  reviewId: string;
  outcome: RecordConflictOutcome;
};

export type DecideRecordConflictReviewResult = {
  operationId: string;
  reviewId: string;
  outcome: 'resolved';
};

export type AuthorizeRecordProductionCommand = {
  sessionHandle: string;
  operationId: string;
  caseId: string;
  recipient: string;
};

export type AuthorizeRecordProductionResult = {
  operationId: string;
  caseId: string;
  productionId: string;
  outcome: 'authorized';
};

export type RetrieveRecordProductionCommand = {
  capability: string;
};

export type RetrieveRecordProductionResult = {
  productionId: string;
  purpose: RecordLifecycleScopePurpose;
  portions: RecordLifecycleScopePortion[];
  package: Record<string, unknown>;
};

export type RepairRecordProductionCleanupCommand = {
  sessionHandle: string;
  operationId: string;
  productionId: string;
};

export type RepairRecordProductionCleanupResult = {
  operationId: string;
  productionId: string;
  outcome: 'removed' | 'failed';
};

export type CompleteRecordDispositionNoticeCommand = {
  sessionHandle: string;
  operationId: string;
  studentId: string;
};

export type CompleteRecordDispositionNoticeResult = {
  operationId: string;
  studentId: string;
  noticeId: string;
  outcome: 'completed';
};

export type CompleteRecordDispositionCopyOpportunityCommand = {
  sessionHandle: string;
  operationId: string;
  studentId: string;
};

export type CompleteRecordDispositionCopyOpportunityResult = {
  operationId: string;
  studentId: string;
  copyOpportunityId: string;
  outcome: 'completed';
};

export type ScheduleRecordDispositionCommand = {
  sessionHandle: string;
  operationId: string;
  studentId: string;
  caseId: string;
  confirmation: 'schedule_destruction';
};

export type ScheduleRecordDispositionResult = {
  operationId: string;
  studentId: string;
  dispositionId: string;
  cancellationDeadlineAt: string;
  outcome: 'scheduled';
};

export type CancelRecordDispositionCommand = {
  sessionHandle: string;
  operationId: string;
  dispositionId: string;
  expectedVersion: number;
};

export type CancelRecordDispositionResult = {
  operationId: string;
  dispositionId: string;
  outcome: 'cancelled';
};

export type ExecuteRecordDispositionCommand = {
  sessionHandle: string;
  operationId: string;
  dispositionId: string;
  expectedVersion: number;
  confirmation: 'execute_destruction';
};

export type ExecuteRecordDispositionResult = {
  operationId: string;
  dispositionId: string;
  outcome: 'purged' | 'failed';
};

export type RetryRecordDispositionCommand = {
  sessionHandle: string;
  operationId: string;
  dispositionId: string;
  expectedVersion: number;
  confirmation: 'execute_destruction';
};

export type RetryRecordDispositionResult = {
  operationId: string;
  dispositionId: string;
  outcome: 'purged' | 'failed';
};

export type RecordProductionSecrets = {
  createCapability(): string;
  digestCapability(capability: string): string;
  digestRecipient(recipient: string): string;
  protectDelivery(input: {
    productionId: string;
    recipient: string;
    capability: string;
  }): { keyId: string; ciphertext: string };
  revealVerifiedEmailRecipient(input: {
    workspaceId: string;
    studentId: string;
    keyId: string;
    ciphertext: string;
  }): string;
};

export type RecordProductionMaterials = {
  studentId: string;
  identity?: {
    studentId: string;
    presence: StudentPresence;
    accessStatus: 'active' | 'disabled';
    emails: {
      status: 'current' | 'historical';
      keyId: string;
      ciphertext: string;
    }[];
  };
  membership?: {
    classId: string;
    status: 'active' | 'inactive';
    activatedAt: string;
  }[];
  intake?: {
    versions: {
      intakeRecordVersionId: string;
      versionNumber: number;
      acceptedAt: string;
      supersededAt: string | null;
      wrappingKeyId: string;
      wrappedDataKey: string;
      ciphertext: string;
    }[];
    draft?: {
      wrappingKeyId: string;
      wrappedDataKey: string;
      ciphertext: string;
      updatedAt: string;
    } | null;
  };
  learningProgress?: {
    itemId: string;
    itemRevisionNumber: number;
    completedAt: string;
  }[];
  auditEvidence?: {
    occurredAt: string;
    actorType: string;
    eventType: string;
  }[];
};

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
  resolveAmendment(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    caseId: string;
    challengedFactKind: RecordAmendmentFactKind;
    challengedFactId: string;
    decision: RecordAmendmentDecision;
    reasonCode: RecordAmendmentReasonCode;
    authorityKind: RecordLifecycleAuthorityKind;
    effectiveCorrection: RecordAmendmentEffectiveCorrection | null;
    requesterStatementPreserved: boolean;
    sealSensitive: (studentId: string) => {
      statementSealed: SealedRecord | null;
      correctionSealed: SealedRecord | null;
    };
    relatedStudentId: string | null;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    amendmentId: string;
    reviewId: string;
    result: ResolveRecordAmendmentResult;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; result: ResolveRecordAmendmentResult }
    | { outcome: 'not_found' }
    | { outcome: 'not_applicable' }
    | { outcome: 'decision_mismatch' }
    | { outcome: 'conflict'; reviewId: string }
  >;
  openConflictReview(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    conflictKind: RecordConflictKind;
    subjectStudentId: string;
    conflictingStudentId: string;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    reviewId: string;
    result: OpenRecordConflictReviewResult;
  }): Promise<
    | {
        outcome: 'applied' | 'replayed';
        result: OpenRecordConflictReviewResult;
      }
    | { outcome: 'not_found' }
  >;
  decideConflictReview(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    reviewId: string;
    reviewOutcome: RecordConflictOutcome;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    result: DecideRecordConflictReviewResult;
  }): Promise<
    | {
        outcome: 'applied' | 'replayed';
        result: DecideRecordConflictReviewResult;
      }
    | { outcome: 'not_found' }
    | { outcome: 'not_open' }
  >;
  authorizeProduction(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    caseId: string;
    recipientDigest: string;
    capabilityDigest: string;
    delivery: { keyId: string; ciphertext: string };
    productionId: string;
    expiresAt: Date;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    result: AuthorizeRecordProductionResult;
    buildPackage: (
      materials: RecordProductionMaterials,
    ) => Promise<SealedRecord>;
  }): Promise<
    | {
        outcome: 'applied' | 'replayed';
        result: AuthorizeRecordProductionResult;
      }
    | { outcome: 'not_found' }
    | { outcome: 'not_authorized' }
  >;
  retrieveProduction(request: {
    capabilityDigest: string;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    openPackage: (input: {
      sealed: SealedRecord;
      workspaceId: string;
      studentId: string;
    }) => Promise<Record<string, unknown>>;
  }): Promise<
    | { outcome: 'retrieved'; result: RetrieveRecordProductionResult }
    | { outcome: 'unavailable' }
    | { outcome: 'cleanup_failed' }
  >;
  repairProductionCleanup(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    productionId: string;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    result: RepairRecordProductionCleanupResult;
  }): Promise<
    | {
        outcome: 'applied' | 'replayed';
        result: RepairRecordProductionCleanupResult;
      }
    | { outcome: 'not_found' }
  >;
  completeNotice(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    studentId: string;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    noticeId: string;
    result: CompleteRecordDispositionNoticeResult;
  }): Promise<
    | {
        outcome: 'applied' | 'replayed';
        result: CompleteRecordDispositionNoticeResult;
      }
    | { outcome: 'not_found' }
  >;
  completeCopyOpportunity(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    studentId: string;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    copyOpportunityId: string;
    result: CompleteRecordDispositionCopyOpportunityResult;
  }): Promise<
    | {
        outcome: 'applied' | 'replayed';
        result: CompleteRecordDispositionCopyOpportunityResult;
      }
    | { outcome: 'not_found' }
  >;
  scheduleDisposition(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    studentId: string;
    caseId: string;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    dispositionId: string;
    result: ScheduleRecordDispositionResult;
  }): Promise<
    | {
        outcome: 'applied' | 'replayed';
        result: ScheduleRecordDispositionResult;
      }
    | { outcome: 'not_found' }
    | {
        outcome: 'not_schedulable';
        blockingReasons: RecordDispositionBlockingReason[];
      }
  >;
  cancelDisposition(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    dispositionId: string;
    expectedVersion: number;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    result: CancelRecordDispositionResult;
  }): Promise<
    | {
        outcome: 'applied' | 'replayed';
        result: CancelRecordDispositionResult;
      }
    | { outcome: 'not_found' }
    | { outcome: 'not_cancellable' }
    | { outcome: 'version_conflict' }
  >;
  executeDisposition(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    dispositionId: string;
    expectedVersion: number;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    result: ExecuteRecordDispositionResult;
  }): Promise<
    | {
        outcome: 'applied' | 'replayed';
        result: ExecuteRecordDispositionResult;
      }
    | { outcome: 'not_found' }
    | { outcome: 'window_open' }
    | { outcome: 'not_executable' }
    | { outcome: 'version_conflict' }
  >;
  retryDisposition(request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    dispositionId: string;
    expectedVersion: number;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    result: RetryRecordDispositionResult;
  }): Promise<
    | {
        outcome: 'applied' | 'replayed';
        result: RetryRecordDispositionResult;
      }
    | { outcome: 'not_found' }
    | { outcome: 'not_repairable' }
    | { outcome: 'version_conflict' }
  >;
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
  resolveRecordAmendment(
    command: ResolveRecordAmendmentCommand,
  ): Promise<ResolveRecordAmendmentResult>;
  openRecordConflictReview(
    command: OpenRecordConflictReviewCommand,
  ): Promise<OpenRecordConflictReviewResult>;
  decideRecordConflictReview(
    command: DecideRecordConflictReviewCommand,
  ): Promise<DecideRecordConflictReviewResult>;
  authorizeRecordProduction(
    command: AuthorizeRecordProductionCommand,
  ): Promise<AuthorizeRecordProductionResult>;
  retrieveRecordProduction(
    command: RetrieveRecordProductionCommand,
  ): Promise<RetrieveRecordProductionResult>;
  repairRecordProductionCleanup(
    command: RepairRecordProductionCleanupCommand,
  ): Promise<RepairRecordProductionCleanupResult>;
  completeRecordDispositionNotice(
    command: CompleteRecordDispositionNoticeCommand,
  ): Promise<CompleteRecordDispositionNoticeResult>;
  completeRecordDispositionCopyOpportunity(
    command: CompleteRecordDispositionCopyOpportunityCommand,
  ): Promise<CompleteRecordDispositionCopyOpportunityResult>;
  scheduleRecordDisposition(
    command: ScheduleRecordDispositionCommand,
  ): Promise<ScheduleRecordDispositionResult>;
  cancelRecordDisposition(
    command: CancelRecordDispositionCommand,
  ): Promise<CancelRecordDispositionResult>;
  executeRecordDisposition(
    command: ExecuteRecordDispositionCommand,
  ): Promise<ExecuteRecordDispositionResult>;
  retryRecordDisposition(
    command: RetryRecordDispositionCommand,
  ): Promise<RetryRecordDispositionResult>;
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

export function authorizedProductionPortions(
  scope: RecordLifecycleScope,
): RecordLifecycleScopePortion[] {
  if (scope.portions.includes('complete_bundle')) {
    return [
      'identity',
      'membership',
      'intake',
      'learning_progress',
      'audit_evidence',
    ];
  }
  return [...scope.portions];
}

async function bytesOf(
  value: Uint8Array | Promise<Uint8Array>,
): Promise<Uint8Array> {
  return value;
}

export function createRecordsGovernance(dependencies: {
  identityAndAccess: Pick<IdentityAndAccess, 'requireAdministrativeSession'>;
  store: RecordsGovernanceStore;
  clock: Clock;
  ids: IdGenerator;
  keys: ApplicationKeyManagement;
  productionSecrets: RecordProductionSecrets;
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

    async resolveRecordAmendment(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const amendmentId = dependencies.ids.create();
      const statement = command.requesterStatement?.trim() ?? '';
      const result: ResolveRecordAmendmentResult = {
        operationId: command.operationId,
        caseId: command.caseId,
        amendmentId,
        outcome: 'recorded',
      };
      const recorded = await dependencies.store.resolveAmendment({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        caseId: command.caseId,
        challengedFactKind: command.challengedFactKind,
        challengedFactId: command.challengedFactId,
        decision: command.decision,
        reasonCode: command.reasonCode,
        authorityKind: 'school_administrator',
        effectiveCorrection: command.effectiveCorrection ?? null,
        requesterStatementPreserved: statement.length > 0,
        sealSensitive: (studentId) => ({
          statementSealed:
            statement.length > 0
              ? dependencies.keys.seal(Buffer.from(statement, 'utf8'), {
                  purpose: 'record-amendment',
                  workspaceId: session.workspaceId,
                  studentId,
                })
              : null,
          correctionSealed: command.effectiveCorrection
            ? dependencies.keys.seal(
                Buffer.from(
                  JSON.stringify(command.effectiveCorrection),
                  'utf8',
                ),
                {
                  purpose: 'record-amendment',
                  workspaceId: session.workspaceId,
                  studentId,
                },
              )
            : null,
        }),
        relatedStudentId: command.relatedStudentId ?? null,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        amendmentId,
        reviewId: dependencies.ids.create(),
        result,
      });
      if (recorded.outcome === 'not_found') {
        throw new RecordLifecycleCaseNotFoundError();
      }
      if (recorded.outcome === 'not_applicable') {
        throw new RecordAmendmentNotApplicableError();
      }
      if (recorded.outcome === 'decision_mismatch') {
        throw new RecordAmendmentDecisionMismatchError();
      }
      if (recorded.outcome === 'conflict') {
        throw new RecordConflictReviewRequiredError(recorded.reviewId);
      }
      return recorded.result;
    },

    async openRecordConflictReview(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const reviewId = dependencies.ids.create();
      const result: OpenRecordConflictReviewResult = {
        operationId: command.operationId,
        reviewId,
        outcome: 'opened',
      };
      const opened = await dependencies.store.openConflictReview({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        conflictKind: command.conflictKind,
        subjectStudentId: command.subjectStudentId,
        conflictingStudentId: command.conflictingStudentId,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        reviewId,
        result,
      });
      if (opened.outcome === 'not_found') throw new StudentNotFoundError();
      return opened.result;
    },

    async decideRecordConflictReview(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const result: DecideRecordConflictReviewResult = {
        operationId: command.operationId,
        reviewId: command.reviewId,
        outcome: 'resolved',
      };
      const decided = await dependencies.store.decideConflictReview({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        reviewId: command.reviewId,
        reviewOutcome: command.outcome,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        result,
      });
      if (decided.outcome === 'not_found') {
        throw new RecordConflictReviewNotFoundError();
      }
      if (decided.outcome === 'not_open') {
        throw new RecordConflictReviewNotOpenError();
      }
      return decided.result;
    },

    async authorizeRecordProduction(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const productionId = dependencies.ids.create();
      const capability = dependencies.productionSecrets.createCapability();
      const delivery = dependencies.productionSecrets.protectDelivery({
        productionId,
        recipient: command.recipient,
        capability,
      });
      const result: AuthorizeRecordProductionResult = {
        operationId: command.operationId,
        caseId: command.caseId,
        productionId,
        outcome: 'authorized',
      };
      const authorized = await dependencies.store.authorizeProduction({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        caseId: command.caseId,
        recipientDigest: dependencies.productionSecrets.digestRecipient(
          command.recipient,
        ),
        capabilityDigest:
          dependencies.productionSecrets.digestCapability(capability),
        delivery,
        productionId,
        expiresAt: new Date(
          dependencies.clock.now().getTime() + recordProductionTtlMs,
        ),
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        result,
        async buildPackage(materials) {
          const produced = await assembleRecordProductionPackage({
            keys: dependencies.keys,
            secrets: dependencies.productionSecrets,
            workspaceId: session.workspaceId,
            materials,
          });
          return dependencies.keys.seal(
            Buffer.from(JSON.stringify(produced), 'utf8'),
            {
              purpose: 'record-production',
              workspaceId: session.workspaceId,
              studentId: materials.studentId,
            },
          );
        },
      });
      if (authorized.outcome === 'not_found') {
        throw new RecordLifecycleCaseNotFoundError();
      }
      if (authorized.outcome === 'not_authorized') {
        throw new RecordProductionNotAuthorizedError();
      }
      return authorized.result;
    },

    async retrieveRecordProduction(command) {
      const retrieved = await dependencies.store.retrieveProduction({
        capabilityDigest: dependencies.productionSecrets.digestCapability(
          command.capability,
        ),
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        async openPackage(input) {
          const opened = await bytesOf(
            dependencies.keys.open(input.sealed, {
              purpose: 'record-production',
              workspaceId: input.workspaceId,
              studentId: input.studentId,
            }),
          );
          return JSON.parse(Buffer.from(opened).toString('utf8')) as Record<
            string,
            unknown
          >;
        },
      });
      if (retrieved.outcome === 'unavailable') {
        throw new RecordProductionUnavailableError();
      }
      if (retrieved.outcome === 'cleanup_failed') {
        throw new RecordProductionCleanupFailedError();
      }
      return retrieved.result;
    },

    async repairRecordProductionCleanup(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const result: RepairRecordProductionCleanupResult = {
        operationId: command.operationId,
        productionId: command.productionId,
        outcome: 'removed',
      };
      const repaired = await dependencies.store.repairProductionCleanup({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        productionId: command.productionId,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        result,
      });
      if (repaired.outcome === 'not_found') {
        throw new RecordProductionUnavailableError();
      }
      return repaired.result;
    },

    async completeRecordDispositionNotice(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const noticeId = dependencies.ids.create();
      const result: CompleteRecordDispositionNoticeResult = {
        operationId: command.operationId,
        studentId: command.studentId,
        noticeId,
        outcome: 'completed',
      };
      const completed = await dependencies.store.completeNotice({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        studentId: command.studentId,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        noticeId,
        result,
      });
      if (completed.outcome === 'not_found') throw new StudentNotFoundError();
      return completed.result;
    },

    async completeRecordDispositionCopyOpportunity(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const copyOpportunityId = dependencies.ids.create();
      const result: CompleteRecordDispositionCopyOpportunityResult = {
        operationId: command.operationId,
        studentId: command.studentId,
        copyOpportunityId,
        outcome: 'completed',
      };
      const completed = await dependencies.store.completeCopyOpportunity({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        studentId: command.studentId,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        copyOpportunityId,
        result,
      });
      if (completed.outcome === 'not_found') throw new StudentNotFoundError();
      return completed.result;
    },

    async scheduleRecordDisposition(command) {
      if (command.confirmation !== 'schedule_destruction') {
        throw new RecordDispositionConfirmationRequiredError();
      }
      const session = await requireFreshAdministrator(command.sessionHandle);
      const dispositionId = dependencies.ids.create();
      const cancellationDeadlineAt = new Date(
        dependencies.clock.now().getTime() +
          recordDispositionCancellationWindowMs,
      ).toISOString();
      const result: ScheduleRecordDispositionResult = {
        operationId: command.operationId,
        studentId: command.studentId,
        dispositionId,
        cancellationDeadlineAt,
        outcome: 'scheduled',
      };
      const scheduled = await dependencies.store.scheduleDisposition({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        studentId: command.studentId,
        caseId: command.caseId,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        dispositionId,
        result,
      });
      if (scheduled.outcome === 'not_found') throw new StudentNotFoundError();
      if (scheduled.outcome === 'not_schedulable') {
        throw new RecordDispositionNotSchedulableError(
          scheduled.blockingReasons,
        );
      }
      return scheduled.result;
    },

    async cancelRecordDisposition(command) {
      const session = await requireFreshAdministrator(command.sessionHandle);
      const result: CancelRecordDispositionResult = {
        operationId: command.operationId,
        dispositionId: command.dispositionId,
        outcome: 'cancelled',
      };
      const cancelled = await dependencies.store.cancelDisposition({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        dispositionId: command.dispositionId,
        expectedVersion: command.expectedVersion,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        result,
      });
      if (cancelled.outcome === 'not_found') {
        throw new RecordDispositionNotFoundError();
      }
      if (cancelled.outcome === 'not_cancellable') {
        throw new RecordDispositionNotCancellableError();
      }
      if (cancelled.outcome === 'version_conflict') {
        throw new RecordDispositionVersionConflictError();
      }
      return cancelled.result;
    },

    async executeRecordDisposition(command) {
      if (command.confirmation !== 'execute_destruction') {
        throw new RecordDispositionConfirmationRequiredError();
      }
      const session = await requireFreshAdministrator(command.sessionHandle);
      const result: ExecuteRecordDispositionResult = {
        operationId: command.operationId,
        dispositionId: command.dispositionId,
        outcome: 'purged',
      };
      const executed = await dependencies.store.executeDisposition({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        dispositionId: command.dispositionId,
        expectedVersion: command.expectedVersion,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        result,
      });
      if (executed.outcome === 'not_found') {
        throw new RecordDispositionNotFoundError();
      }
      if (executed.outcome === 'window_open') {
        throw new RecordDispositionCancellationWindowOpenError();
      }
      if (executed.outcome === 'not_executable') {
        throw new RecordDispositionNotExecutableError();
      }
      if (executed.outcome === 'version_conflict') {
        throw new RecordDispositionVersionConflictError();
      }
      return executed.result;
    },

    async retryRecordDisposition(command) {
      if (command.confirmation !== 'execute_destruction') {
        throw new RecordDispositionConfirmationRequiredError();
      }
      const session = await requireFreshAdministrator(command.sessionHandle);
      const result: RetryRecordDispositionResult = {
        operationId: command.operationId,
        dispositionId: command.dispositionId,
        outcome: 'purged',
      };
      const retried = await dependencies.store.retryDisposition({
        workspaceId: session.workspaceId,
        staffIdentityId: session.staffIdentityId,
        operationId: command.operationId,
        dispositionId: command.dispositionId,
        expectedVersion: command.expectedVersion,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        result,
      });
      if (retried.outcome === 'not_found') {
        throw new RecordDispositionNotFoundError();
      }
      if (retried.outcome === 'not_repairable') {
        throw new RecordDispositionNotRepairableError();
      }
      if (retried.outcome === 'version_conflict') {
        throw new RecordDispositionVersionConflictError();
      }
      return retried.result;
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

async function assembleRecordProductionPackage(input: {
  keys: ApplicationKeyManagement;
  secrets: RecordProductionSecrets;
  workspaceId: string;
  materials: RecordProductionMaterials;
}): Promise<Record<string, unknown>> {
  const packageBody: Record<string, unknown> = {
    schema: 'record-production/v1',
  };
  const materials = input.materials;
  if (materials.identity) {
    const identity = materials.identity;
    packageBody.identity = {
      studentId: identity.studentId,
      presence: identity.presence,
      accessStatus: identity.accessStatus,
      emails: identity.emails.map((email) => ({
        status: email.status,
        address: input.secrets.revealVerifiedEmailRecipient({
          workspaceId: input.workspaceId,
          studentId: identity.studentId,
          keyId: email.keyId,
          ciphertext: email.ciphertext,
        }),
      })),
    };
  }
  if (materials.membership) {
    packageBody.membership = materials.membership;
  }
  if (materials.intake) {
    const studentId = materials.studentId;
    const versions = [];
    for (const version of materials.intake.versions) {
      const opened = studentId
        ? await bytesOf(
            input.keys.open(
              {
                wrappingKeyId: version.wrappingKeyId,
                wrappedDataKey: version.wrappedDataKey,
                ciphertext: version.ciphertext,
              },
              {
                purpose: 'intake-record-version',
                workspaceId: input.workspaceId,
                studentId,
              },
            ),
          )
        : undefined;
      versions.push({
        intakeRecordVersionId: version.intakeRecordVersionId,
        versionNumber: version.versionNumber,
        acceptedAt: version.acceptedAt,
        supersededAt: version.supersededAt,
        current: version.supersededAt === null,
        answers: opened
          ? (JSON.parse(Buffer.from(opened).toString('utf8')) as unknown)
          : undefined,
      });
    }
    let draft: unknown;
    if (materials.intake.draft && studentId) {
      const opened = await bytesOf(
        input.keys.open(
          {
            wrappingKeyId: materials.intake.draft.wrappingKeyId,
            wrappedDataKey: materials.intake.draft.wrappedDataKey,
            ciphertext: materials.intake.draft.ciphertext,
          },
          {
            purpose: 'intake-draft',
            workspaceId: input.workspaceId,
            studentId,
          },
        ),
      );
      draft = {
        updatedAt: materials.intake.draft.updatedAt,
        answers: JSON.parse(Buffer.from(opened).toString('utf8')) as unknown,
      };
    }
    packageBody.intake = { versions, draft: draft ?? null };
  }
  if (materials.learningProgress) {
    packageBody.learningProgress = materials.learningProgress;
  }
  if (materials.auditEvidence) {
    packageBody.auditEvidence = materials.auditEvidence;
  }
  return packageBody;
}
