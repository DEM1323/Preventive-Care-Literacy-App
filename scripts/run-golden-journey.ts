import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import {
  artifactDigestForGitTree,
  createResendInvitationMailbox,
  normalizeGoldenJourneyEnvironment,
  reportGoldenJourneyPreflight,
  runGoldenJourney,
  runGoldenJourneyBrowser,
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
});
for (const [name, value] of Object.entries(environment)) {
  if (value) process.env[name] = value;
}
reportGoldenJourneyPreflight(environment, { failClosed: true });
const commit = environment.EXPECTED_COMMIT as string;
const tree = environment.EXPECTED_GIT_TREE as string;
const evidencePath =
  process.env.GOLDEN_JOURNEY_EVIDENCE_PATH ??
  resolve('artifacts/golden-journey-evidence.json');

const fixtureCandidate = JSON.parse(
  await readFile(
    new URL(
      '../docs/fixtures/umb-demo-school-configuration-release-1.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as unknown;

const runId = randomUUID();
const evidence = await runGoldenJourney({
  environment,
  expectedSource: {
    commit,
    artifactDigest: artifactDigestForGitTree(tree),
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
  ids: {
    runId,
    workspaceId: randomUUID(),
    staffIdentityId: randomUUID(),
    classId: randomUUID(),
    invitationId: randomUUID(),
    restorationClassId: randomUUID(),
    restorationInvitationId: randomUUID(),
    operationIds: {
      workspace: randomUUID(),
      staff: randomUUID(),
      importDraft: randomUUID(),
      publish: randomUUID(),
      invitation: randomUUID(),
      restorationInvitation: randomUUID(),
      intake: randomUUID(),
      learning: randomUUID(),
    },
  },
  staffPassword: randomBytes(18).toString('base64url'),
});

await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
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
