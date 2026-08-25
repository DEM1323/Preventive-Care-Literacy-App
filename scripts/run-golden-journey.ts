import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { createBuildAttestation } from '../packages/build-attestation/src/index.ts';
import {
  createFailedGoldenJourneyEvidence,
  createResendInvitationMailbox,
  GoldenJourneyRunError,
  normalizeGoldenJourneyEnvironment,
  reportGoldenJourneyPreflight,
  runGoldenJourney,
  runGoldenJourneyBrowser,
  type GoldenJourneyStep,
} from '../packages/golden-journey/src/index.ts';
import {
  checkProviderProbes,
  createProviderProbes,
  providerConfigurationFromEnvironment,
} from '../packages/providers/src/index.ts';

function gitSha(arg: string): string {
  return execFileSync('git', ['rev-parse', arg], {
    encoding: 'utf8',
  }).trim();
}

const environment = normalizeGoldenJourneyEnvironment({
  ...process.env,
  EXPECTED_COMMIT:
    process.env.EXPECTED_COMMIT || process.env.GITHUB_SHA || gitSha('HEAD'),
  EXPECTED_GIT_TREE: process.env.EXPECTED_GIT_TREE || gitSha('HEAD^{tree}'),
  GOLDEN_JOURNEY_REF: process.env.GOLDEN_JOURNEY_REF || process.env.GITHUB_REF,
});
for (const [name, value] of Object.entries(environment)) {
  if (value) process.env[name] = value;
}

const evidencePath =
  process.env.GOLDEN_JOURNEY_EVIDENCE_PATH ??
  resolve('artifacts/golden-journey-evidence.json');
const runId = randomUUID();
const startedAt = new Date().toISOString();
const ids = {
  runId,
  workspaceId: randomUUID(),
  staffIdentityId: randomUUID(),
  classId: randomUUID(),
  invitationId: randomUUID(),
  restorationClassId: randomUUID(),
  restorationInvitationId: randomUUID(),
  isolationWorkspaceId: randomUUID(),
  isolationStaffIdentityId: randomUUID(),
  operationIds: {
    workspace: randomUUID(),
    staff: randomUUID(),
    importDraft: randomUUID(),
    publish: randomUUID(),
    invitation: randomUUID(),
    restorationInvitation: randomUUID(),
    intake: randomUUID(),
    learning: randomUUID(),
    isolationWorkspace: randomUUID(),
    isolationStaff: randomUUID(),
  },
};

async function writeEvidence(value: unknown) {
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(value, null, 2)}\n`);
}

try {
  reportGoldenJourneyPreflight(environment, { failClosed: true });
  const commit = environment.EXPECTED_COMMIT as string;
  const tree = environment.EXPECTED_GIT_TREE as string;
  const expected = await createBuildAttestation(process.cwd(), {
    commit,
    tree,
  });
  const fixtureCandidate = JSON.parse(
    await readFile(
      new URL(
        '../docs/fixtures/umb-demo-school-configuration-release-1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as unknown;

  const evidence = await runGoldenJourney({
    environment,
    expectedSource: {
      commit: expected.commit,
      tree: expected.tree,
      sourceDigest: expected.sourceDigest,
      browserDigest: expected.browserDigest,
      artifactDigest: expected.artifactDigest,
    },
    fixtureCandidate,
    clock: { now: () => new Date() },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetch,
    checkProviders: () =>
      checkProviderProbes(
        createProviderProbes(providerConfigurationFromEnvironment()),
      ),
    mailbox: createResendInvitationMailbox({
      apiKey: environment.RESEND_API_KEY as string,
    }),
    runBrowser: (input) => runGoldenJourneyBrowser(input),
    ids,
    staffPassword: randomBytes(18).toString('base64url'),
    isolationStaffPassword: randomBytes(18).toString('base64url'),
  });

  await writeEvidence(evidence);
  console.log(
    JSON.stringify({
      outcome: 'completed',
      evidencePath,
      environment: evidence.environment,
      environmentHost: evidence.environmentHost,
      commit: evidence.commit,
      runId: evidence.runId,
      cleanupBoundary: evidence.cleanupBoundary,
    }),
  );
} catch (error) {
  let environmentHost: string | undefined;
  try {
    environmentHost = environment.STAGING_WEB_URL
      ? new URL(environment.STAGING_WEB_URL).hostname
      : undefined;
  } catch {
    environmentHost = undefined;
  }
  const failed = createFailedGoldenJourneyEvidence({
    environmentHost,
    commit: environment.EXPECTED_COMMIT,
    artifactDigest: undefined,
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    lastCompletedStep:
      error instanceof GoldenJourneyRunError
        ? error.lastCompletedStep
        : ('idle' as GoldenJourneyStep),
    errorCode:
      error instanceof GoldenJourneyRunError
        ? error.code
        : 'UNEXPECTED_FAILURE',
    syntheticIdentifiers: {
      workspaceId: ids.workspaceId,
      staffIdentityId: ids.staffIdentityId,
      classId: ids.classId,
      invitationId: ids.invitationId,
      restorationInvitationId: ids.restorationInvitationId,
      isolationWorkspaceId: ids.isolationWorkspaceId,
    },
    authCleanup: 'not-attempted',
  });
  await writeEvidence(failed);
  console.log(
    JSON.stringify({
      outcome: 'failed',
      evidencePath,
      errorCode: failed.errorCode,
      lastCompletedStep: failed.lastCompletedStep,
      runId: failed.runId,
    }),
  );
  process.exit(1);
}
