import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const deployWorkflow = readFileSync(
  new URL('../../.github/workflows/deploy-staging.yml', import.meta.url),
  'utf8',
);
const goldenWorkflow = readFileSync(
  new URL('../../.github/workflows/golden-journey.yml', import.meta.url),
  'utf8',
);
const bakeScript = readFileSync(
  new URL('../../scripts/bake-production-attestation.ts', import.meta.url),
  'utf8',
);
const goldenScript = readFileSync(
  new URL('../../scripts/run-golden-journey.ts', import.meta.url),
  'utf8',
);
const stagingDoc = readFileSync(
  new URL('../../docs/operations/staging.md', import.meta.url),
  'utf8',
);

function namedStep(workflow: string, name: string): string {
  const marker = `\n      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  if (start === -1) throw new Error(`missing workflow step: ${name}`);
  const after = start + marker.length;
  const next = workflow.indexOf('\n      - name: ', after);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

test('deploy staging publishes the GitHub operator token to the public Railway service without an intermediate release', () => {
  const publicSync = namedStep(deployWorkflow, 'Synchronize Railway variables');
  const workerSync = namedStep(
    deployWorkflow,
    'Synchronize private worker variables',
  );

  expect(publicSync).toContain('--skip-deploys');
  expect(publicSync).toContain(
    'OPERATOR_PROVISIONING_TOKEN: ${{ secrets.OPERATOR_PROVISIONING_TOKEN }}',
  );
  expect(publicSync).toContain(
    '"OPERATOR_PROVISIONING_TOKEN=$OPERATOR_PROVISIONING_TOKEN"',
  );
  expect(workerSync).not.toContain('OPERATOR_PROVISIONING_TOKEN');
});

test('missing operator token fails before Railway variable sync or source deploy and is never logged', () => {
  const preflight = namedStep(
    deployWorkflow,
    'Verify required deployment secrets',
  );
  const publicSyncIndex = deployWorkflow.indexOf(
    'Synchronize Railway variables',
  );
  const deployIndex = deployWorkflow.indexOf('Deploy merged source to Railway');
  const workerDeployIndex = deployWorkflow.indexOf(
    'Deploy private worker to Railway',
  );
  const preflightIndex = deployWorkflow.indexOf(
    'Verify required deployment secrets',
  );

  expect(preflight).toContain(
    'OPERATOR_PROVISIONING_TOKEN: ${{ secrets.OPERATOR_PROVISIONING_TOKEN }}',
  );
  expect(preflight).toContain('bun scripts/preflight-deploy-staging.ts');
  expect(preflightIndex).toBeGreaterThan(-1);
  expect(preflightIndex).toBeLessThan(publicSyncIndex);
  expect(preflightIndex).toBeLessThan(deployIndex);
  expect(preflightIndex).toBeLessThan(workerDeployIndex);
  expect(preflight).not.toMatch(/echo|printf|console\.log/);
  expect(deployWorkflow).not.toMatch(
    /echo[^\n]*OPERATOR_PROVISIONING_TOKEN|printf[^\n]*OPERATOR_PROVISIONING_TOKEN/,
  );
  expect(goldenWorkflow).not.toMatch(
    /echo[^\n]*OPERATOR_PROVISIONING_TOKEN|printf[^\n]*OPERATOR_PROVISIONING_TOKEN/,
  );
});

test('temporary Railway setup credentials are still deleted and the operator token is retained', () => {
  const cleanup = namedStep(
    deployWorkflow,
    'Remove temporary deployment credentials',
  );

  expect(cleanup).toContain('if: always()');
  expect(cleanup).toContain('RAILWAY_CONFIG_B64 DEPLOY_SETUP_GH_TOKEN');
  expect(cleanup).not.toContain('OPERATOR_PROVISIONING_TOKEN');
});

test('golden journey authenticates with the same GitHub staging operator token name', () => {
  expect(goldenWorkflow).toContain(
    'OPERATOR_PROVISIONING_TOKEN: ${{ secrets.OPERATOR_PROVISIONING_TOKEN }}',
  );
  expect(stagingDoc).toContain('OPERATOR_PROVISIONING_TOKEN');
  const githubSecretsBullet = stagingDoc
    .split('\n')
    .find((line) => line.includes('GitHub `staging` secrets for'));
  expect(githubSecretsBullet).toContain('OPERATOR_PROVISIONING_TOKEN');
  expect(stagingDoc).toContain(
    'synchronizes `OPERATOR_PROVISIONING_TOKEN` from that GitHub secret to the public Railway service',
  );
  expect(stagingDoc).not.toContain(
    'synchronizes `OPERATOR_PROVISIONING_TOKEN` from that GitHub secret to the private worker',
  );
});

test('deploy and golden journey bake the pinned Docker runtime attestation before Railway upload or digest comparison', () => {
  const deployBake = namedStep(deployWorkflow, 'Bake production attestation');
  const goldenBake = namedStep(goldenWorkflow, 'Bake production attestation');
  const bakeIndex = deployWorkflow.indexOf('Bake production attestation');
  const railwayIndex = deployWorkflow.indexOf(
    'Restore temporary Railway session',
  );
  const deployIndex = deployWorkflow.indexOf('Deploy merged source to Railway');
  const goldenBakeIndex = goldenWorkflow.indexOf('Bake production attestation');
  const goldenRunIndex = goldenWorkflow.indexOf(
    'Run golden journey against deployed staging',
  );

  expect(deployBake).toContain('bun scripts/bake-production-attestation.ts');
  expect(deployBake).toContain(
    'SOURCE_COMMIT: ${{ steps.source.outputs.commit }}',
  );
  expect(deployBake).toContain('SOURCE_TREE: ${{ steps.source.outputs.tree }}');
  expect(goldenBake).toContain('bun scripts/bake-production-attestation.ts');
  expect(goldenWorkflow).toContain(
    'PRODUCTION_ATTESTATION_PATH: artifacts/production-attestation.json',
  );
  expect(goldenWorkflow).not.toContain(
    'Build browser artifacts for attestation comparison',
  );
  expect(bakeIndex).toBeGreaterThan(-1);
  expect(bakeIndex).toBeLessThan(railwayIndex);
  expect(bakeIndex).toBeLessThan(deployIndex);
  expect(goldenBakeIndex).toBeGreaterThan(-1);
  expect(goldenBakeIndex).toBeLessThan(goldenRunIndex);
  expect(deployWorkflow).toContain('bun-version: 1.3.14');
  expect(goldenWorkflow).toContain('bun-version: 1.3.14');
});

test('production attestation bake uses explicit Docker build args and prints only the artifact digest', () => {
  expect(bakeScript).toContain("'--file'");
  expect(bakeScript).toContain("'Dockerfile'");
  expect(bakeScript).toContain("'--target'");
  expect(bakeScript).toContain("'runtime'");
  expect(bakeScript).toContain("'--build-arg'");
  expect(bakeScript).toContain('SOURCE_COMMIT=${commit}');
  expect(bakeScript).toContain('SOURCE_TREE=${tree}');
  expect(bakeScript).toContain('/app/build-attestation.json');
  expect(bakeScript).toContain(
    'process.stdout.write(`${attestation.artifactDigest}\\n`)',
  );
  expect(bakeScript).not.toMatch(/JSON\.stringify\(attestation/);
  expect(goldenScript).toContain('PRODUCTION_ATTESTATION_PATH');
  expect(goldenScript).toContain('parseBuildAttestation');
  expect(goldenScript).not.toContain('createBuildAttestation(process.cwd()');
  expect(deployWorkflow).not.toMatch(
    /cat[^\n]*build-attestation|jq[^\n]*build-attestation/,
  );
  expect(goldenWorkflow).not.toMatch(
    /cat[^\n]*build-attestation|jq[^\n]*build-attestation/,
  );
});
