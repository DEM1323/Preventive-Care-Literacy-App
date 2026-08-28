import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import {
  applyCampaignCheck,
  applySchoolNurseAcceptance,
  assertSafeReleaseCandidateEvidence,
  createPinnedCampaign,
  exportReleaseCandidateEvidence,
  requiredBrowserMatrixCells,
  requiredLocales,
  type CampaignSnapshot,
} from '../modules/release-candidate-evidence/index.ts';

const evidencePath =
  process.env.RELEASE_CANDIDATE_EVIDENCE_PATH ??
  resolve('artifacts/release-candidate-evidence.json');

const migrationsDirectory = new URL(
  '../packages/postgres/migrations/',
  import.meta.url,
);

function required(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function uuidOrCreate(name: string): string {
  return required(name) ?? randomUUID();
}

async function schemaMigrations(): Promise<string[]> {
  return (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

function recordWizardMatrix(
  snapshot: CampaignSnapshot,
  cellPrefix: 'edge' | 'safari',
  recorded: string | undefined,
): CampaignSnapshot {
  if (recorded !== 'recorded_pass') return snapshot;
  let next = snapshot;
  for (const cell of requiredBrowserMatrixCells) {
    if (!cell.startsWith(`${cellPrefix}_`)) continue;
    next = applyCampaignCheck(next, {
      kind: 'matrix',
      checkId: cell,
      outcome: 'pass',
      source: 'human_browser_recorded',
      recordedAt: snapshot.startedAt,
      actorType: 'school_nurse',
      observed: {
        browser: cellPrefix,
        device: cell.endsWith('mobile') ? 'mobile' : 'desktop',
      },
    });
  }
  return next;
}

async function writeBundle(snapshot: CampaignSnapshot) {
  const evidence = exportReleaseCandidateEvidence(snapshot, {
    completedAt: new Date().toISOString(),
  });
  assertSafeReleaseCandidateEvidence(evidence);
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const digest = required('ACCEPTANCE_ARTIFACT_DIGEST');
const commit = required('ACCEPTANCE_COMMIT');
const host = required('ACCEPTANCE_ENVIRONMENT_HOST');
const releaseId = required('ACCEPTANCE_RELEASE_ID');
const identitySetId = required('ACCEPTANCE_IDENTITY_SET_ID');

if (!digest || !commit || !host || !releaseId || !identitySetId) {
  console.error(
    'Pin ACCEPTANCE_ARTIFACT_DIGEST, ACCEPTANCE_COMMIT, ACCEPTANCE_ENVIRONMENT_HOST, ACCEPTANCE_RELEASE_ID, and ACCEPTANCE_IDENTITY_SET_ID before running.',
  );
  console.error(
    'Human browser and School Nurse steps: scripts/run-release-candidate-acceptance-wizard.sh',
  );
  process.exit(1);
}

let snapshot = createPinnedCampaign({
  campaignId: uuidOrCreate('ACCEPTANCE_CAMPAIGN_ID'),
  pin: {
    artifactDigest: digest,
    environment: 'staging',
    environmentHost: host,
    environmentIdentity:
      required('ACCEPTANCE_ENVIRONMENT_IDENTITY') ?? 'railway-staging-public',
    schemaMigrations: await schemaMigrations(),
    schoolConfigurationReleaseId: releaseId,
    syntheticIdentitySetId: identitySetId,
    commit,
  },
  syntheticIdentifiers: {
    workspaceId: uuidOrCreate('ACCEPTANCE_WORKSPACE_ID'),
    staffIdentityId: uuidOrCreate('ACCEPTANCE_SCHOOL_NURSE_STAFF_ID'),
    classId: uuidOrCreate('ACCEPTANCE_CLASS_ID'),
    studentId: uuidOrCreate('ACCEPTANCE_STUDENT_ID'),
    invitationId: uuidOrCreate('ACCEPTANCE_INVITATION_ID'),
  },
  startedAt: new Date().toISOString(),
});

if (process.env.ACCEPTANCE_LOCALES === 'recorded_pass') {
  for (const locale of requiredLocales) {
    snapshot = applyCampaignCheck(snapshot, {
      kind: 'locale',
      checkId: locale,
      outcome: 'pass',
      source: 'human_browser_recorded',
      recordedAt: snapshot.startedAt,
      actorType: 'school_nurse',
      observed: { locale },
    });
  }
}

snapshot = recordWizardMatrix(
  snapshot,
  'edge',
  process.env.ACCEPTANCE_EDGE_NATIVE,
);
snapshot = recordWizardMatrix(
  snapshot,
  'safari',
  process.env.ACCEPTANCE_SAFARI_NATIVE,
);

if (process.env.ACCEPTANCE_SCHOOL_NURSE_JOURNEYS === 'recorded_pass') {
  snapshot = applyCampaignCheck(snapshot, {
    kind: 'journey',
    checkId: 'success.clinical_reveal',
    outcome: 'pass',
    source: 'school_nurse_recorded',
    recordedAt: snapshot.startedAt,
    actorType: 'school_nurse',
  });
  snapshot = applyCampaignCheck(snapshot, {
    kind: 'journey',
    checkId: 'clinical_clearing.reveal_then_clear',
    outcome: 'pass',
    source: 'school_nurse_recorded',
    recordedAt: snapshot.startedAt,
    actorType: 'school_nurse',
  });
}

if (process.env.ACCEPTANCE_SCHOOL_NURSE_STATUS === 'recorded') {
  snapshot = applySchoolNurseAcceptance(snapshot, {
    recordedAt: snapshot.startedAt,
    actorId: snapshot.syntheticIdentifiers.staffIdentityId,
  });
}

const origin = required('PUBLIC_ORIGIN');
const token = required('OPERATOR_PROVISIONING_TOKEN');
if (origin && token) {
  const headers = {
    authorization: `Bearer ${token}`,
    origin,
    'x-prevcare-csrf': '1',
    'content-type': 'application/json',
  };
  const started = await fetch(
    `${origin}/api/v1/operator/acceptance-campaigns`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operationId: randomUUID(),
        campaignId: snapshot.campaignId,
        pin: snapshot.pin,
        syntheticIdentifiers: snapshot.syntheticIdentifiers,
        replaceExisting: process.env.ACCEPTANCE_REPLACE_EXISTING === '1',
      }),
    },
  );
  if (!started.ok) {
    console.error(
      `Staging campaign pin failed (${started.status}). Local pending evidence will still be written.`,
    );
  }
}

const evidence = await writeBundle(snapshot);
console.log(
  JSON.stringify(
    {
      evidencePath,
      decision: evidence.decision.decision,
      reasons: evidence.decision.reasons,
      schoolNurseAcceptance: evidence.schoolNurseAcceptance.status,
    },
    null,
    2,
  ),
);
if (evidence.decision.decision !== 'go') {
  console.error(
    'Campaign is not go. Automated journeys, live staging, provider evidence, and human browser/School Nurse steps stay pending until recorded.',
  );
  process.exit(2);
}
