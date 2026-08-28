export const RELEASE_CANDIDATE_EVIDENCE_SCHEMA_VERSION = 1 as const;

export const requiredJourneyChecks = [
  'success.staff_auth',
  'success.release_publication',
  'success.class_invitation',
  'success.controlled_email',
  'success.invitation_redemption',
  'success.intake_submission',
  'success.learning_acknowledgement',
  'success.clinical_reveal',
  'denial.authorization',
  'denial.workspace_isolation',
  'revocation.freshness_loss',
  'conflict.expected_revision',
  'retry.idempotent_operation',
  'retry.provider_delay',
  'restoration.fresh_browser',
  'content_change.intake_form',
  'content_change.learning_item',
  'clinical_clearing.reveal_then_clear',
  'governance.records_lifecycle',
  'governance.record_production',
  'governance.record_disposition',
  'governance.purge',
  'operational.restore_readiness',
  'operational.alerts_incident_stop_resume',
  'operational.backup_configuration',
] as const;

export const requiredLocales = [
  'en-US',
  'es-US',
  'pt-BR',
  'fr-CA',
  'ht-HT',
] as const;

export const requiredBrowserMatrixCells = [
  'chrome_desktop',
  'chrome_mobile',
  'edge_desktop',
  'edge_mobile',
  'safari_desktop',
  'safari_mobile',
  'firefox_desktop',
  'firefox_mobile',
] as const;

export const requiredWcagChecks = [
  'keyboard_focus_order',
  'focus_restoration',
  'accessible_names',
  'accessible_errors',
  'live_announcements',
  'dialogs',
  'contrast',
  'zoom_reflow',
  'reduced_motion',
  'responsive',
  'print_suppression',
  'clinical_clearing',
] as const;

export const nonWaivableCategories = [
  'authorization_bypass',
  'cross_workspace_disclosure',
  'sensitive_data_leak',
  'stale_publication',
  'false_success',
  'history_atomicity_loss',
  'failed_required_operation',
  'journey_blocking_accessibility',
] as const;

export type JourneyCheckId = (typeof requiredJourneyChecks)[number];
export type SupportedLocale = (typeof requiredLocales)[number];
export type BrowserMatrixCell = (typeof requiredBrowserMatrixCells)[number];
export type WcagCheckId = (typeof requiredWcagChecks)[number];
export type NonWaivableCategory = (typeof nonWaivableCategories)[number];
export type CheckKind = 'journey' | 'locale' | 'matrix' | 'wcag';
export type CheckOutcome = 'pass' | 'fail' | 'pending' | 'exception';
export type EvidenceSource =
  | 'automated_synthetic'
  | 'automation_proxy'
  | 'live_staging_pending'
  | 'provider_dashboard_pending'
  | 'provider_dashboard'
  | 'school_nurse_pending'
  | 'school_nurse_recorded'
  | 'human_browser_pending'
  | 'human_browser_recorded';
export type ActorType = 'technical_operator' | 'school_nurse' | 'automation';

export type CampaignPin = {
  artifactDigest: string;
  environment: 'staging';
  environmentHost: string;
  environmentIdentity: string;
  schemaMigrations: readonly string[];
  schoolConfigurationReleaseId: string;
  syntheticIdentitySetId: string;
  commit: string;
};

export type SyntheticIdentifiers = {
  workspaceId: string;
  staffIdentityId: string;
  classId: string;
  studentId: string;
  invitationId: string;
};

export type ObservedBrowser = {
  browser?: string;
  browserVersion?: string;
  device?: string;
  viewport?: string;
  locale?: string;
  automationProxy?: 'chromium' | 'webkit' | 'firefox';
};

export type CheckRecord = {
  outcome: CheckOutcome;
  source: EvidenceSource;
  recordedAt: string;
  actorType: ActorType;
  nonWaivableCategory?: NonWaivableCategory;
  observed?: ObservedBrowser;
};

export type LowerRiskException = {
  checkKind: CheckKind;
  checkId: string;
  requirement: string;
  evidence: string;
  impact: string;
  mitigation: string;
  owner: string;
  expiry: string;
  reasonOutsideNonWaivable: string;
};

export type SchoolNurseAcceptance = {
  status: 'recorded' | 'missing';
  recordedAt?: string;
  actorId?: string;
};

export type CampaignSnapshot = {
  campaignId: string;
  pin: CampaignPin;
  syntheticIdentifiers: SyntheticIdentifiers;
  startedAt: string;
  journeys: Record<JourneyCheckId, CheckRecord>;
  locales: Record<SupportedLocale, CheckRecord>;
  matrix: Record<BrowserMatrixCell, CheckRecord>;
  wcag: Record<WcagCheckId, CheckRecord>;
  exceptions: LowerRiskException[];
  schoolNurseAcceptance: SchoolNurseAcceptance;
};

export type GoNoGoDecision = {
  decision: 'go' | 'no-go' | 'pending';
  reasons: string[];
  schoolNurseAcceptance: 'recorded' | 'missing';
};

export type ReleaseCandidateEvidence = {
  schemaVersion: typeof RELEASE_CANDIDATE_EVIDENCE_SCHEMA_VERSION;
  campaignId: string;
  pin: CampaignPin;
  syntheticIdentifiers: SyntheticIdentifiers;
  startedAt: string;
  completedAt: string;
  journeys: Record<JourneyCheckId, CheckRecord>;
  locales: Record<SupportedLocale, CheckRecord>;
  matrix: Record<BrowserMatrixCell, CheckRecord>;
  wcag: Record<WcagCheckId, CheckRecord>;
  exceptions: LowerRiskException[];
  schoolNurseAcceptance: SchoolNurseAcceptance;
  decision: GoNoGoDecision;
};

export type CampaignCheckInput = {
  kind: CheckKind;
  checkId: string;
  outcome: CheckOutcome;
  source: EvidenceSource;
  recordedAt: string;
  actorType: ActorType;
  nonWaivableCategory?: NonWaivableCategory;
  observed?: ObservedBrowser;
  pin?: CampaignPin;
};

export class ReleaseCandidateEvidenceError extends Error {
  readonly code:
    | 'PROHIBITED_DATA'
    | 'PIN_MISMATCH'
    | 'CHECK_CONFLICT'
    | 'INCOMPLETE_EXCEPTION'
    | 'NON_WAIVABLE_EXCEPTION'
    | 'UNKNOWN_CHECK'
    | 'MALFORMED_PIN';

  constructor(message: string, code: ReleaseCandidateEvidenceError['code']) {
    super(message);
    this.name = 'ReleaseCandidateEvidenceError';
    this.code = code;
  }
}

export class ReleaseCandidateEvidenceOperationReusedError extends Error {
  readonly code = 'OPERATION_ID_REUSED';
  constructor() {
    super(
      'Operation ID was reused with a different release-candidate evidence body',
    );
    this.name = 'ReleaseCandidateEvidenceOperationReusedError';
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digestPattern = /^[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;
const hostPattern =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const prohibitedEvidencePatterns = [
  /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,
  /"(?:address|answers|generatedContent|invitationCode|requestBody|responseBody|sessionHandle|signInCode|password|totpSecret|renderedClinicalContent|exception|stack|message)"/i,
  /\b\d{6}\b/,
  /otpauth:/i,
  /Bearer\s+/i,
  /UNIQUE-ANSWER/i,
];

const schoolNurseJourneyChecks = new Set<JourneyCheckId>([
  'success.clinical_reveal',
  'clinical_clearing.reveal_then_clear',
]);

const providerJourneyChecks = new Set<JourneyCheckId>([
  'operational.backup_configuration',
]);

const liveStagingJourneyChecks = new Set<JourneyCheckId>([
  'success.controlled_email',
]);

const humanBrowserCells = new Set<BrowserMatrixCell>([
  'edge_desktop',
  'edge_mobile',
  'safari_desktop',
  'safari_mobile',
]);

const evidenceKeys = [
  'schemaVersion',
  'campaignId',
  'pin',
  'syntheticIdentifiers',
  'startedAt',
  'completedAt',
  'journeys',
  'locales',
  'matrix',
  'wcag',
  'exceptions',
  'schoolNurseAcceptance',
  'decision',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSafeText(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (prohibitedEvidencePatterns.some((pattern) => pattern.test(serialized))) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate evidence contained a prohibited data class',
      'PROHIBITED_DATA',
    );
  }
}

function requireUuid(value: string, label: string): string {
  if (!uuidPattern.test(value)) {
    throw new ReleaseCandidateEvidenceError(
      `Release candidate evidence ${label} must be an opaque uuid`,
      'MALFORMED_PIN',
    );
  }
  return value;
}

function requireDigest(value: string): string {
  if (!digestPattern.test(value)) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate evidence artifact digest is malformed',
      'MALFORMED_PIN',
    );
  }
  return value;
}

export function assertSafeReleaseCandidateEvidence(
  value: unknown,
): asserts value is ReleaseCandidateEvidence {
  const serialized = JSON.stringify(value);
  if (prohibitedEvidencePatterns.some((pattern) => pattern.test(serialized))) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate evidence contained a prohibited data class',
      'PROHIBITED_DATA',
    );
  }
  if (!isRecord(value)) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate evidence is malformed',
      'MALFORMED_PIN',
    );
  }
  for (const key of Object.keys(value)) {
    if (!(evidenceKeys as readonly string[]).includes(key)) {
      throw new ReleaseCandidateEvidenceError(
        'Release candidate evidence contained a prohibited data class',
        'PROHIBITED_DATA',
      );
    }
  }
}

function pendingRecord(
  source: EvidenceSource,
  startedAt: string,
  actorType: ActorType = 'automation',
): CheckRecord {
  return {
    outcome: 'pending',
    source,
    recordedAt: startedAt,
    actorType,
  };
}

function validatePin(pin: CampaignPin): CampaignPin {
  assertSafeText(pin);
  if (pin.environment !== 'staging') {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate evidence environment is unexpected',
      'MALFORMED_PIN',
    );
  }
  if (!hostPattern.test(pin.environmentHost)) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate evidence contained a prohibited data class',
      'PROHIBITED_DATA',
    );
  }
  if (!commitPattern.test(pin.commit)) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate evidence commit is malformed',
      'MALFORMED_PIN',
    );
  }
  if (pin.schemaMigrations.length === 0) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate evidence schema pin is incomplete',
      'MALFORMED_PIN',
    );
  }
  return {
    artifactDigest: requireDigest(pin.artifactDigest),
    environment: 'staging',
    environmentHost: pin.environmentHost,
    environmentIdentity: pin.environmentIdentity,
    schemaMigrations: [...pin.schemaMigrations],
    schoolConfigurationReleaseId: requireUuid(
      pin.schoolConfigurationReleaseId,
      'schoolConfigurationReleaseId',
    ),
    syntheticIdentitySetId: requireUuid(
      pin.syntheticIdentitySetId,
      'syntheticIdentitySetId',
    ),
    commit: pin.commit,
  };
}

function pinsMatch(left: CampaignPin, right: CampaignPin): boolean {
  return (
    left.artifactDigest === right.artifactDigest &&
    left.environment === right.environment &&
    left.environmentHost === right.environmentHost &&
    left.environmentIdentity === right.environmentIdentity &&
    left.schoolConfigurationReleaseId === right.schoolConfigurationReleaseId &&
    left.syntheticIdentitySetId === right.syntheticIdentitySetId &&
    left.commit === right.commit &&
    left.schemaMigrations.length === right.schemaMigrations.length &&
    left.schemaMigrations.every(
      (name, index) => name === right.schemaMigrations[index],
    )
  );
}

export function createPinnedCampaign(input: {
  campaignId: string;
  pin: CampaignPin;
  syntheticIdentifiers: SyntheticIdentifiers;
  startedAt: string;
}): CampaignSnapshot {
  const pin = validatePin(input.pin);
  if (!isoPattern.test(input.startedAt)) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate evidence timestamps are malformed',
      'MALFORMED_PIN',
    );
  }
  assertSafeText(input.syntheticIdentifiers);
  const journeys = Object.fromEntries(
    requiredJourneyChecks.map((checkId) => {
      if (schoolNurseJourneyChecks.has(checkId)) {
        return [
          checkId,
          pendingRecord(
            'school_nurse_pending',
            input.startedAt,
            'school_nurse',
          ),
        ];
      }
      if (providerJourneyChecks.has(checkId)) {
        return [
          checkId,
          pendingRecord('provider_dashboard_pending', input.startedAt),
        ];
      }
      if (liveStagingJourneyChecks.has(checkId)) {
        return [
          checkId,
          pendingRecord('live_staging_pending', input.startedAt),
        ];
      }
      return [checkId, pendingRecord('automated_synthetic', input.startedAt)];
    }),
  ) as Record<JourneyCheckId, CheckRecord>;
  const locales = Object.fromEntries(
    requiredLocales.map((locale) => [
      locale,
      pendingRecord('automated_synthetic', input.startedAt),
    ]),
  ) as Record<SupportedLocale, CheckRecord>;
  const matrix = Object.fromEntries(
    requiredBrowserMatrixCells.map((cell) => [
      cell,
      pendingRecord(
        humanBrowserCells.has(cell)
          ? 'human_browser_pending'
          : 'automated_synthetic',
        input.startedAt,
        humanBrowserCells.has(cell) ? 'school_nurse' : 'automation',
      ),
    ]),
  ) as Record<BrowserMatrixCell, CheckRecord>;
  const wcag = Object.fromEntries(
    requiredWcagChecks.map((checkId) => [
      checkId,
      pendingRecord('automated_synthetic', input.startedAt),
    ]),
  ) as Record<WcagCheckId, CheckRecord>;
  return {
    campaignId: requireUuid(input.campaignId, 'campaignId'),
    pin,
    syntheticIdentifiers: {
      workspaceId: requireUuid(
        input.syntheticIdentifiers.workspaceId,
        'workspaceId',
      ),
      staffIdentityId: requireUuid(
        input.syntheticIdentifiers.staffIdentityId,
        'staffIdentityId',
      ),
      classId: requireUuid(input.syntheticIdentifiers.classId, 'classId'),
      studentId: requireUuid(input.syntheticIdentifiers.studentId, 'studentId'),
      invitationId: requireUuid(
        input.syntheticIdentifiers.invitationId,
        'invitationId',
      ),
    },
    startedAt: input.startedAt,
    journeys,
    locales,
    matrix,
    wcag,
    exceptions: [],
    schoolNurseAcceptance: { status: 'missing' },
  };
}

function collectionFor(
  snapshot: CampaignSnapshot,
  kind: CheckKind,
): Record<string, CheckRecord> {
  if (kind === 'journey') return snapshot.journeys;
  if (kind === 'locale') return snapshot.locales;
  if (kind === 'matrix') return snapshot.matrix;
  return snapshot.wcag;
}

function knownCheck(kind: CheckKind, checkId: string): boolean {
  if (kind === 'journey') {
    return (requiredJourneyChecks as readonly string[]).includes(checkId);
  }
  if (kind === 'locale') {
    return (requiredLocales as readonly string[]).includes(checkId);
  }
  if (kind === 'matrix') {
    return (requiredBrowserMatrixCells as readonly string[]).includes(checkId);
  }
  return (requiredWcagChecks as readonly string[]).includes(checkId);
}

export function applyCampaignCheck(
  snapshot: CampaignSnapshot,
  input: CampaignCheckInput,
): CampaignSnapshot {
  assertSafeText(input);
  if (input.pin && !pinsMatch(snapshot.pin, validatePin(input.pin))) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate evidence is pinned to a different artifact digest',
      'PIN_MISMATCH',
    );
  }
  if (!knownCheck(input.kind, input.checkId)) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate check is unknown',
      'UNKNOWN_CHECK',
    );
  }
  if (!isoPattern.test(input.recordedAt)) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate evidence timestamps are malformed',
      'MALFORMED_PIN',
    );
  }
  const current = collectionFor(snapshot, input.kind)[input.checkId];
  if (!current) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate check is unknown',
      'UNKNOWN_CHECK',
    );
  }
  const nextRecord: CheckRecord = {
    outcome: input.outcome,
    source: input.source,
    recordedAt:
      current.outcome === 'pending' ? input.recordedAt : current.recordedAt,
    actorType: input.actorType,
    ...(input.nonWaivableCategory
      ? { nonWaivableCategory: input.nonWaivableCategory }
      : {}),
    ...(input.observed ? { observed: input.observed } : {}),
  };
  if (current.outcome !== 'pending') {
    const same =
      current.outcome === nextRecord.outcome &&
      current.source === nextRecord.source &&
      current.nonWaivableCategory === nextRecord.nonWaivableCategory;
    if (!same) {
      throw new ReleaseCandidateEvidenceError(
        'Release candidate check was reused with a different outcome',
        'CHECK_CONFLICT',
      );
    }
    return snapshot;
  }
  const next = {
    ...snapshot,
    journeys: { ...snapshot.journeys },
    locales: { ...snapshot.locales },
    matrix: { ...snapshot.matrix },
    wcag: { ...snapshot.wcag },
  };
  collectionFor(next, input.kind)[input.checkId] = nextRecord;
  return next;
}

export function applyLowerRiskException(
  snapshot: CampaignSnapshot,
  exception: LowerRiskException,
): CampaignSnapshot {
  assertSafeText(exception);
  if (
    exception.requirement.trim() === '' ||
    exception.evidence.trim() === '' ||
    exception.impact.trim() === '' ||
    exception.mitigation.trim() === '' ||
    exception.owner.trim() === '' ||
    exception.reasonOutsideNonWaivable.trim() === '' ||
    !datePattern.test(exception.expiry)
  ) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate exception is incomplete',
      'INCOMPLETE_EXCEPTION',
    );
  }
  if (!knownCheck(exception.checkKind, exception.checkId)) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate check is unknown',
      'UNKNOWN_CHECK',
    );
  }
  const current = collectionFor(snapshot, exception.checkKind)[
    exception.checkId
  ];
  if (current?.nonWaivableCategory) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate exception cannot waive a non-waivable finding',
      'NON_WAIVABLE_EXCEPTION',
    );
  }
  if (current?.outcome === 'fail' && current.nonWaivableCategory) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate exception cannot waive a non-waivable finding',
      'NON_WAIVABLE_EXCEPTION',
    );
  }
  return {
    ...snapshot,
    exceptions: [
      ...snapshot.exceptions,
      {
        checkKind: exception.checkKind,
        checkId: exception.checkId,
        requirement: exception.requirement,
        evidence: exception.evidence,
        impact: exception.impact,
        mitigation: exception.mitigation,
        owner: exception.owner,
        expiry: exception.expiry,
        reasonOutsideNonWaivable: exception.reasonOutsideNonWaivable,
      },
    ],
  };
}

export function applySchoolNurseAcceptance(
  snapshot: CampaignSnapshot,
  input: { recordedAt: string; actorId: string },
): CampaignSnapshot {
  requireUuid(input.actorId, 'actorId');
  if (!isoPattern.test(input.recordedAt)) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate evidence timestamps are malformed',
      'MALFORMED_PIN',
    );
  }
  if (snapshot.schoolNurseAcceptance.status === 'recorded') {
    return snapshot;
  }
  return {
    ...snapshot,
    schoolNurseAcceptance: {
      status: 'recorded',
      recordedAt: input.recordedAt,
      actorId: input.actorId,
    },
  };
}

function allRecords(snapshot: CampaignSnapshot): CheckRecord[] {
  return [
    ...Object.values(snapshot.journeys),
    ...Object.values(snapshot.locales),
    ...Object.values(snapshot.matrix),
    ...Object.values(snapshot.wcag),
  ];
}

function exceptionCovers(
  snapshot: CampaignSnapshot,
  kind: CheckKind,
  checkId: string,
): boolean {
  return snapshot.exceptions.some(
    (exception) =>
      exception.checkKind === kind && exception.checkId === checkId,
  );
}

export function evaluateGoNoGo(snapshot: CampaignSnapshot): GoNoGoDecision {
  const reasons: string[] = [];
  for (const record of allRecords(snapshot)) {
    if (
      record.outcome === 'fail' &&
      record.nonWaivableCategory &&
      (nonWaivableCategories as readonly string[]).includes(
        record.nonWaivableCategory,
      )
    ) {
      if (!reasons.includes(record.nonWaivableCategory)) {
        reasons.push(record.nonWaivableCategory);
      }
    }
  }
  if (reasons.length > 0) {
    return {
      decision: 'no-go',
      reasons,
      schoolNurseAcceptance: snapshot.schoolNurseAcceptance.status,
    };
  }

  const pending =
    Object.entries(snapshot.journeys).some(
      ([checkId, record]) =>
        record.outcome === 'pending' &&
        !exceptionCovers(snapshot, 'journey', checkId),
    ) ||
    Object.entries(snapshot.locales).some(
      ([checkId, record]) =>
        record.outcome === 'pending' &&
        !exceptionCovers(snapshot, 'locale', checkId),
    ) ||
    Object.entries(snapshot.matrix).some(
      ([checkId, record]) =>
        record.outcome === 'pending' &&
        !exceptionCovers(snapshot, 'matrix', checkId),
    ) ||
    Object.entries(snapshot.wcag).some(
      ([checkId, record]) =>
        record.outcome === 'pending' &&
        !exceptionCovers(snapshot, 'wcag', checkId),
    );

  if (pending) reasons.push('required_checks_pending');
  if (snapshot.schoolNurseAcceptance.status !== 'recorded') {
    reasons.push('school_nurse_acceptance_missing');
  }
  if (reasons.length > 0) {
    return {
      decision: 'pending',
      reasons,
      schoolNurseAcceptance: snapshot.schoolNurseAcceptance.status,
    };
  }
  return {
    decision: 'go',
    reasons: [],
    schoolNurseAcceptance: 'recorded',
  };
}

export function exportReleaseCandidateEvidence(
  snapshot: CampaignSnapshot,
  input: { completedAt: string },
): ReleaseCandidateEvidence {
  if (!isoPattern.test(input.completedAt)) {
    throw new ReleaseCandidateEvidenceError(
      'Release candidate evidence timestamps are malformed',
      'MALFORMED_PIN',
    );
  }
  const evidence: ReleaseCandidateEvidence = {
    schemaVersion: RELEASE_CANDIDATE_EVIDENCE_SCHEMA_VERSION,
    campaignId: snapshot.campaignId,
    pin: snapshot.pin,
    syntheticIdentifiers: snapshot.syntheticIdentifiers,
    startedAt: snapshot.startedAt,
    completedAt: input.completedAt,
    journeys: snapshot.journeys,
    locales: snapshot.locales,
    matrix: snapshot.matrix,
    wcag: snapshot.wcag,
    exceptions: snapshot.exceptions,
    schoolNurseAcceptance: snapshot.schoolNurseAcceptance,
    decision: evaluateGoNoGo(snapshot),
  };
  assertSafeReleaseCandidateEvidence(evidence);
  return evidence;
}

export type ReleaseCandidateEvidenceStore = {
  readCampaign(): Promise<CampaignSnapshot | undefined>;
  startCampaign(request: {
    operationId: string;
    actorId: string;
    campaign: CampaignSnapshot;
    replaceExisting: boolean;
    occurredAt: Date;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; campaign: CampaignSnapshot }
    | { outcome: 'operation_reused' }
    | { outcome: 'pin_mismatch' }
  >;
  recordCheck(request: {
    operationId: string;
    actorId: string;
    input: CampaignCheckInput;
    occurredAt: Date;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; campaign: CampaignSnapshot }
    | { outcome: 'operation_reused' }
    | { outcome: 'not_found' }
    | { outcome: 'pin_mismatch' }
    | { outcome: 'check_conflict' }
  >;
  recordException(request: {
    operationId: string;
    actorId: string;
    exception: LowerRiskException;
    occurredAt: Date;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; campaign: CampaignSnapshot }
    | { outcome: 'operation_reused' }
    | { outcome: 'not_found' }
    | { outcome: 'incomplete' }
    | { outcome: 'non_waivable' }
  >;
  recordSchoolNurseAcceptance(request: {
    operationId: string;
    actorId: string;
    staffIdentityId: string;
    occurredAt: Date;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; campaign: CampaignSnapshot }
    | { outcome: 'operation_reused' }
    | { outcome: 'not_found' }
  >;
};

export type ReleaseCandidateEvidencePort = {
  readCampaign(): Promise<CampaignSnapshot | undefined>;
  startCampaign(command: {
    operationId: string;
    actorId: string;
    campaignId: string;
    pin: CampaignPin;
    syntheticIdentifiers: SyntheticIdentifiers;
    replaceExisting?: boolean;
  }): Promise<CampaignSnapshot>;
  recordCheck(command: {
    operationId: string;
    actorId: string;
    input: CampaignCheckInput;
  }): Promise<CampaignSnapshot>;
  recordException(command: {
    operationId: string;
    actorId: string;
    exception: LowerRiskException;
  }): Promise<CampaignSnapshot>;
  recordSchoolNurseAcceptance(command: {
    operationId: string;
    actorId: string;
    staffIdentityId: string;
  }): Promise<CampaignSnapshot>;
  exportEvidence(): Promise<ReleaseCandidateEvidence>;
};

export function presentCampaign(
  snapshot: CampaignSnapshot,
): CampaignSnapshot & {
  decision: GoNoGoDecision;
} {
  return {
    ...snapshot,
    decision: evaluateGoNoGo(snapshot),
  };
}

export function createReleaseCandidateEvidence(dependencies: {
  store: ReleaseCandidateEvidenceStore;
  clock: { now(): Date };
}): ReleaseCandidateEvidencePort {
  return {
    readCampaign() {
      return dependencies.store.readCampaign();
    },
    async startCampaign(command) {
      const occurredAt = dependencies.clock.now();
      const campaign = createPinnedCampaign({
        campaignId: command.campaignId,
        pin: command.pin,
        syntheticIdentifiers: command.syntheticIdentifiers,
        startedAt: occurredAt.toISOString(),
      });
      const started = await dependencies.store.startCampaign({
        operationId: command.operationId,
        actorId: command.actorId,
        campaign,
        replaceExisting: command.replaceExisting === true,
        occurredAt,
      });
      if (started.outcome === 'operation_reused') {
        throw new ReleaseCandidateEvidenceOperationReusedError();
      }
      if (started.outcome === 'pin_mismatch') {
        throw new ReleaseCandidateEvidenceError(
          'Release candidate evidence is pinned to a different artifact digest',
          'PIN_MISMATCH',
        );
      }
      return started.campaign;
    },
    async recordCheck(command) {
      const occurredAt = dependencies.clock.now();
      const recorded = await dependencies.store.recordCheck({
        operationId: command.operationId,
        actorId: command.actorId,
        input: {
          ...command.input,
          recordedAt: occurredAt.toISOString(),
        },
        occurredAt,
      });
      if (recorded.outcome === 'not_found') {
        throw new ReleaseCandidateEvidenceError(
          'Release candidate campaign was not found',
          'UNKNOWN_CHECK',
        );
      }
      if (recorded.outcome === 'operation_reused') {
        throw new ReleaseCandidateEvidenceOperationReusedError();
      }
      if (recorded.outcome === 'pin_mismatch') {
        throw new ReleaseCandidateEvidenceError(
          'Release candidate evidence is pinned to a different artifact digest',
          'PIN_MISMATCH',
        );
      }
      if (recorded.outcome === 'check_conflict') {
        throw new ReleaseCandidateEvidenceError(
          'Release candidate check was reused with a different outcome',
          'CHECK_CONFLICT',
        );
      }
      return recorded.campaign;
    },
    async recordException(command) {
      const recorded = await dependencies.store.recordException({
        operationId: command.operationId,
        actorId: command.actorId,
        exception: command.exception,
        occurredAt: dependencies.clock.now(),
      });
      if (recorded.outcome === 'not_found') {
        throw new ReleaseCandidateEvidenceError(
          'Release candidate campaign was not found',
          'UNKNOWN_CHECK',
        );
      }
      if (recorded.outcome === 'operation_reused') {
        throw new ReleaseCandidateEvidenceOperationReusedError();
      }
      if (recorded.outcome === 'incomplete') {
        throw new ReleaseCandidateEvidenceError(
          'Release candidate exception is incomplete',
          'INCOMPLETE_EXCEPTION',
        );
      }
      if (recorded.outcome === 'non_waivable') {
        throw new ReleaseCandidateEvidenceError(
          'Release candidate exception cannot waive a non-waivable finding',
          'NON_WAIVABLE_EXCEPTION',
        );
      }
      return recorded.campaign;
    },
    async recordSchoolNurseAcceptance(command) {
      const recorded = await dependencies.store.recordSchoolNurseAcceptance({
        operationId: command.operationId,
        actorId: command.actorId,
        staffIdentityId: command.staffIdentityId,
        occurredAt: dependencies.clock.now(),
      });
      if (recorded.outcome === 'not_found') {
        throw new ReleaseCandidateEvidenceError(
          'Release candidate campaign was not found',
          'UNKNOWN_CHECK',
        );
      }
      if (recorded.outcome === 'operation_reused') {
        throw new ReleaseCandidateEvidenceOperationReusedError();
      }
      return recorded.campaign;
    },
    async exportEvidence() {
      const campaign = await dependencies.store.readCampaign();
      if (!campaign) {
        throw new ReleaseCandidateEvidenceError(
          'Release candidate campaign was not found',
          'UNKNOWN_CHECK',
        );
      }
      return exportReleaseCandidateEvidence(campaign, {
        completedAt: dependencies.clock.now().toISOString(),
      });
    },
  };
}
