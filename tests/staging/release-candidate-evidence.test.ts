import { expect, test } from 'bun:test';
import {
  RELEASE_CANDIDATE_EVIDENCE_SCHEMA_VERSION,
  applyCampaignCheck,
  applyLowerRiskException,
  applySchoolNurseAcceptance,
  assertSafeReleaseCandidateEvidence,
  createPinnedCampaign,
  evaluateGoNoGo,
  exportReleaseCandidateEvidence,
  requiredBrowserMatrixCells,
  requiredJourneyChecks,
  requiredLocales,
  requiredWcagChecks,
} from '../../modules/release-candidate-evidence/index.ts';

const digest = 'ab'.repeat(32);
const otherDigest = 'cd'.repeat(32);
const commit = 'beda69fca3f7954a0200a3209cb44aac7ade4a72';
const campaignId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0053';
const releaseId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0153';
const identitySetId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0253';
const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0353';
const staffIdentityId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf0453';
const recordedAt = '2026-08-28T16:00:00.000Z';

function pin(overrides: { artifactDigest?: string } = {}) {
  return {
    artifactDigest: overrides.artifactDigest ?? digest,
    environment: 'staging' as const,
    environmentHost: 'staging.up.railway.app',
    environmentIdentity: 'railway-staging-public',
    schemaMigrations: [
      '001_audited_spine.sql',
      '033_operational_readiness.sql',
      '034_release_candidate_evidence.sql',
    ],
    schoolConfigurationReleaseId: releaseId,
    syntheticIdentitySetId: identitySetId,
    commit,
  };
}

function identifiers() {
  return {
    workspaceId,
    staffIdentityId,
    classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf0553',
    studentId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf0653',
    invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf0753',
  };
}

function campaign() {
  return createPinnedCampaign({
    campaignId,
    pin: pin(),
    syntheticIdentifiers: identifiers(),
    startedAt: recordedAt,
  });
}

function passAllPending(
  snapshot: ReturnType<typeof createPinnedCampaign>,
  options: { omitJourney?: string } = {},
) {
  let next = snapshot;
  for (const checkId of requiredJourneyChecks) {
    if (checkId === options.omitJourney) continue;
    next = applyCampaignCheck(next, {
      kind: 'journey',
      checkId,
      outcome: 'pass',
      source:
        checkId === 'success.clinical_reveal' ||
        checkId === 'clinical_clearing.reveal_then_clear'
          ? 'school_nurse_recorded'
          : checkId === 'operational.backup_configuration'
            ? 'provider_dashboard'
            : 'automated_synthetic',
      recordedAt,
      actorType:
        checkId === 'success.clinical_reveal' ||
        checkId === 'clinical_clearing.reveal_then_clear'
          ? 'school_nurse'
          : 'automation',
    });
  }
  for (const locale of requiredLocales) {
    next = applyCampaignCheck(next, {
      kind: 'locale',
      checkId: locale,
      outcome: 'pass',
      source: 'automated_synthetic',
      recordedAt,
      actorType: 'automation',
      observed: { locale },
    });
  }
  for (const cell of requiredBrowserMatrixCells) {
    next = applyCampaignCheck(next, {
      kind: 'matrix',
      checkId: cell,
      outcome: 'pass',
      source:
        cell.startsWith('edge_') || cell.startsWith('safari_')
          ? 'automation_proxy'
          : 'automated_synthetic',
      recordedAt,
      actorType: 'automation',
      observed: {
        browser: cell.split('_')[0]!,
        device: cell.endsWith('mobile') ? 'mobile' : 'desktop',
        automationProxy: cell.startsWith('safari_')
          ? 'webkit'
          : cell.startsWith('firefox_')
            ? 'firefox'
            : 'chromium',
      },
    });
  }
  for (const checkId of requiredWcagChecks) {
    next = applyCampaignCheck(next, {
      kind: 'wcag',
      checkId,
      outcome: 'pass',
      source: 'automated_synthetic',
      recordedAt,
      actorType: 'automation',
    });
  }
  return next;
}

test('pinned campaign records digest, environment, schema, release, and synthetic identities', () => {
  const snapshot = campaign();
  expect(snapshot.campaignId).toBe(campaignId);
  expect(snapshot.pin.artifactDigest).toBe(digest);
  expect(snapshot.pin.environment).toBe('staging');
  expect(snapshot.pin.environmentHost).toBe('staging.up.railway.app');
  expect(snapshot.pin.schoolConfigurationReleaseId).toBe(releaseId);
  expect(snapshot.pin.syntheticIdentitySetId).toBe(identitySetId);
  expect(snapshot.pin.schemaMigrations).toContain(
    '034_release_candidate_evidence.sql',
  );
  expect(snapshot.syntheticIdentifiers.workspaceId).toBe(workspaceId);
  expect(snapshot.schoolNurseAcceptance.status).toBe('missing');
});

test('required coverage includes every journey category, five locales, browser matrix, and WCAG checks', () => {
  expect(requiredJourneyChecks).toEqual([
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
  ]);
  expect(requiredLocales).toEqual([
    'en-US',
    'es-US',
    'pt-BR',
    'fr-CA',
    'ht-HT',
  ]);
  expect(requiredBrowserMatrixCells).toEqual([
    'chrome_desktop',
    'chrome_mobile',
    'edge_desktop',
    'edge_mobile',
    'safari_desktop',
    'safari_mobile',
    'firefox_desktop',
    'firefox_mobile',
  ]);
  expect(requiredWcagChecks).toEqual([
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
  ]);

  const snapshot = campaign();
  expect(Object.keys(snapshot.journeys).sort()).toEqual(
    [...requiredJourneyChecks].sort(),
  );
  expect(
    Object.values(snapshot.journeys).every((row) => row.outcome === 'pending'),
  ).toBe(true);
  expect(
    Object.values(snapshot.journeys).every((row) =>
      [
        'automated_synthetic',
        'live_staging_pending',
        'school_nurse_pending',
        'provider_dashboard_pending',
      ].includes(row.source),
    ),
  ).toBe(true);
});

test('a new campaign starts with pending human and live-staging evidence, never silent pass', () => {
  const snapshot = campaign();
  expect(snapshot.journeys['success.clinical_reveal']?.source).toBe(
    'school_nurse_pending',
  );
  expect(snapshot.journeys['operational.backup_configuration']?.source).toBe(
    'provider_dashboard_pending',
  );
  expect(snapshot.matrix.edge_desktop?.source).toBe('human_browser_pending');
  expect(snapshot.matrix.safari_desktop?.source).toBe('human_browser_pending');
  expect(snapshot.matrix.chrome_desktop?.source).toBe('automated_synthetic');
  expect(evaluateGoNoGo(snapshot)).toEqual({
    decision: 'pending',
    reasons: ['required_checks_pending', 'school_nurse_acceptance_missing'],
    schoolNurseAcceptance: 'missing',
  });
});

test('pending required checks cannot produce go', () => {
  let snapshot = passAllPending(campaign(), {
    omitJourney: 'success.clinical_reveal',
  });
  snapshot = applySchoolNurseAcceptance(snapshot, {
    recordedAt,
    actorId: staffIdentityId,
  });
  expect(evaluateGoNoGo(snapshot).decision).toBe('pending');
});

test('authorization bypass and other non-waivable failures produce no-go', () => {
  const categories = [
    {
      checkId: 'denial.authorization' as const,
      category: 'authorization_bypass' as const,
    },
    {
      checkId: 'denial.workspace_isolation' as const,
      category: 'cross_workspace_disclosure' as const,
    },
    {
      checkId: 'success.clinical_reveal' as const,
      category: 'sensitive_data_leak' as const,
    },
    {
      checkId: 'success.release_publication' as const,
      category: 'stale_publication' as const,
    },
    {
      checkId: 'success.intake_submission' as const,
      category: 'false_success' as const,
    },
    {
      checkId: 'retry.idempotent_operation' as const,
      category: 'history_atomicity_loss' as const,
    },
    {
      checkId: 'operational.restore_readiness' as const,
      category: 'failed_required_operation' as const,
    },
    {
      checkId: 'keyboard_focus_order' as const,
      category: 'journey_blocking_accessibility' as const,
      kind: 'wcag' as const,
    },
  ];

  for (const failure of categories) {
    const snapshot = applyCampaignCheck(campaign(), {
      kind: failure.kind ?? 'journey',
      checkId: failure.checkId,
      outcome: 'fail',
      source: 'automated_synthetic',
      recordedAt,
      actorType: 'automation',
      nonWaivableCategory: failure.category,
    });
    const decision = evaluateGoNoGo(snapshot);
    expect(decision.decision).toBe('no-go');
    expect(decision.reasons).toContain(failure.category);
  }
});

test('lower-risk exceptions require structured fields and cannot waive non-waivable failures', () => {
  const valid = {
    checkKind: 'matrix' as const,
    checkId: 'edge_mobile' as const,
    requirement: 'Native Edge mobile observation',
    evidence: 'Chromium desktop proxy recorded the same journey controls',
    impact: 'Native Edge mobile remains unobserved in this campaign',
    mitigation:
      'School Nurse will confirm Edge mobile before production cutover',
    owner: 'technical_operator',
    expiry: '2026-09-30',
    reasonOutsideNonWaivable:
      'Unsupported native browser gap is outside authorization, disclosure, and atomicity failures',
  };
  const withException = applyLowerRiskException(campaign(), valid);
  expect(withException.exceptions).toHaveLength(1);

  expect(() =>
    applyLowerRiskException(campaign(), { ...valid, owner: '' }),
  ).toThrow('Release candidate exception is incomplete');

  const failed = applyCampaignCheck(campaign(), {
    kind: 'journey',
    checkId: 'denial.authorization',
    outcome: 'fail',
    source: 'automated_synthetic',
    recordedAt,
    actorType: 'automation',
    nonWaivableCategory: 'authorization_bypass',
  });
  expect(() =>
    applyLowerRiskException(failed, {
      ...valid,
      checkKind: 'journey',
      checkId: 'denial.authorization',
    }),
  ).toThrow('Release candidate exception cannot waive a non-waivable finding');
});

test('exact digest, environment, and release pins reject mixed or rebuilt evidence', () => {
  const snapshot = campaign();
  expect(() =>
    applyCampaignCheck(snapshot, {
      kind: 'journey',
      checkId: 'success.staff_auth',
      outcome: 'pass',
      source: 'automated_synthetic',
      recordedAt,
      actorType: 'automation',
      pin: pin({ artifactDigest: otherDigest }),
    }),
  ).toThrow(
    'Release candidate evidence is pinned to a different artifact digest',
  );

  expect(() =>
    createPinnedCampaign({
      campaignId,
      pin: {
        ...pin(),
        environmentHost: 'nurse@school.example',
      },
      syntheticIdentifiers: identifiers(),
      startedAt: recordedAt,
    }),
  ).toThrow('Release candidate evidence contained a prohibited data class');
});

test('idempotent reruns replay the same outcome and reject a conflicting rewrite', () => {
  const first = applyCampaignCheck(campaign(), {
    kind: 'journey',
    checkId: 'success.staff_auth',
    outcome: 'pass',
    source: 'automated_synthetic',
    recordedAt,
    actorType: 'automation',
  });
  const replayed = applyCampaignCheck(first, {
    kind: 'journey',
    checkId: 'success.staff_auth',
    outcome: 'pass',
    source: 'automated_synthetic',
    recordedAt: '2026-08-28T16:05:00.000Z',
    actorType: 'automation',
  });
  expect(replayed.journeys['success.staff_auth']?.recordedAt).toBe(recordedAt);

  expect(() =>
    applyCampaignCheck(first, {
      kind: 'journey',
      checkId: 'success.staff_auth',
      outcome: 'fail',
      source: 'automated_synthetic',
      recordedAt: '2026-08-28T16:05:00.000Z',
      actorType: 'automation',
    }),
  ).toThrow('Release candidate check was reused with a different outcome');
});

test('evidence export records coverage without intake answers or secrets', () => {
  let snapshot = passAllPending(campaign());
  snapshot = applySchoolNurseAcceptance(snapshot, {
    recordedAt,
    actorId: staffIdentityId,
  });
  snapshot = applyLowerRiskException(snapshot, {
    checkKind: 'matrix',
    checkId: 'edge_mobile',
    requirement: 'Native Edge mobile observation',
    evidence: 'Chromium mobile proxy recorded the same journey controls',
    impact: 'Native Edge mobile remains unobserved',
    mitigation: 'Accepted as lower-risk automation proxy for this campaign',
    owner: 'technical_operator',
    expiry: '2026-09-30',
    reasonOutsideNonWaivable:
      'Browser proxy gap is outside the non-waivable authorization and disclosure set',
  });
  const evidence = exportReleaseCandidateEvidence(snapshot, {
    completedAt: '2026-08-28T16:12:00.000Z',
  });
  expect(evidence.schemaVersion).toBe(
    RELEASE_CANDIDATE_EVIDENCE_SCHEMA_VERSION,
  );
  expect(evidence.decision.decision).toBe('go');
  expect(evidence.pin.artifactDigest).toBe(digest);
  expect(evidence.schoolNurseAcceptance.status).toBe('recorded');
  expect(Object.keys(evidence)).toEqual([
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
  ]);
  expect(() => assertSafeReleaseCandidateEvidence(evidence)).not.toThrow();

  expect(() =>
    assertSafeReleaseCandidateEvidence({
      ...evidence,
      answers: { asthma: 'yes' },
    }),
  ).toThrow('Release candidate evidence contained a prohibited data class');
});

test('go requires every required check, School Nurse acceptance, and no non-waivable failure', () => {
  let snapshot = passAllPending(campaign());
  expect(evaluateGoNoGo(snapshot).decision).toBe('pending');
  snapshot = applySchoolNurseAcceptance(snapshot, {
    recordedAt,
    actorId: staffIdentityId,
  });
  expect(evaluateGoNoGo(snapshot)).toEqual({
    decision: 'go',
    reasons: [],
    schoolNurseAcceptance: 'recorded',
  });
});
