import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BuildAttestationError,
  BuildAttestationTamperError,
  artifactDigestFromParts,
  createBuildAttestation,
  hashProductionDependencies,
  readAndVerifyBuildAttestation,
  resetBuildAttestationCache,
  runtimeBunVersion,
  verifyBuildAttestationAtStartup,
  verifyBuildAttestationForHealth,
  writeBuildAttestation,
} from '../../packages/build-attestation/src/index.ts';

const commit = 'beda69fca3f7954a0200a3209cb44aac7ade4a72';
const tree = '89abcdef0123456789abcdef0123456789abcdef';

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), 'build-attestation-'));
  await mkdir(join(root, 'apps'), { recursive: true });
  await mkdir(join(root, 'modules'), { recursive: true });
  await mkdir(join(root, 'packages'), { recursive: true });
  await mkdir(join(root, 'scripts'), { recursive: true });
  await mkdir(join(root, 'dist'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'prettier'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      dependencies: { 'left-pad': '1.0.0' },
      devDependencies: { prettier: '3.0.0' },
    }) + '\n',
  );
  await writeFile(
    join(root, 'bun.lock'),
    `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "dependencies": { "left-pad": "1.0.0", },
      "devDependencies": { "prettier": "3.0.0", },
    },
  },
  "packages": {
    "left-pad": ["left-pad@1.0.0", "", { "dependencies": {}, }, "sha512-prod"],
    "prettier": ["prettier@3.0.0", "", { "dependencies": {}, }, "sha512-dev"],
  },
}
`,
  );
  await writeFile(join(root, 'apps', 'api.ts'), 'export const runtime = 1;\n');
  await writeFile(join(root, 'dist', 'index.js'), 'console.log("browser");\n');
  await writeFile(join(root, 'node_modules', 'left-pad', 'index.js'), 'prod\n');
  await writeFile(join(root, 'node_modules', 'prettier', 'index.js'), 'dev\n');
  return root;
}

test('attestation hashes on-disk source, browser, lock, bun version, and production dependencies', async () => {
  const root = await fixtureRoot();
  const first = await createBuildAttestation(root, { commit, tree });

  expect(first.commit).toBe(commit);
  expect(first.tree).toBe(tree);
  expect(first.schemaVersion).toBe(2);
  expect(first.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(first.browserDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(first.lockDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(first.dependencyDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(first.bunVersion).toBe(runtimeBunVersion());
  expect(first.artifactDigest).toBe(
    artifactDigestFromParts({
      sourceDigest: first.sourceDigest,
      browserDigest: first.browserDigest,
      lockDigest: first.lockDigest,
      dependencyDigest: first.dependencyDigest,
      bunVersion: first.bunVersion,
      envelopeAdapter: 'application-layer-envelope/v1',
    }),
  );
  expect(first.artifactDigest).not.toBe(first.sourceDigest);
  expect(first.envelopeAdapter).toBe('application-layer-envelope/v1');

  await writeFile(join(root, 'apps', 'api.ts'), 'export const runtime = 2;\n');
  const tamperedSource = await createBuildAttestation(root, { commit, tree });
  expect(tamperedSource.sourceDigest).not.toBe(first.sourceDigest);
  expect(tamperedSource.artifactDigest).not.toBe(first.artifactDigest);

  await writeFile(join(root, 'apps', 'api.ts'), 'export const runtime = 1;\n');
  await writeFile(join(root, 'dist', 'index.js'), 'console.log("changed");\n');
  const tamperedBrowser = await createBuildAttestation(root, { commit, tree });
  expect(tamperedBrowser.browserDigest).not.toBe(first.browserDigest);
});

test('production dependency digest hashes the installed tree and ignores only known non-runtime noise', async () => {
  const root = await fixtureRoot();
  await mkdir(join(root, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(root, 'node_modules', '.bin', 'left-pad'), 'bin\n');
  const first = await hashProductionDependencies(root);
  await writeFile(
    join(root, 'node_modules', '.bin', 'left-pad'),
    'tampered-bin\n',
  );
  expect(await hashProductionDependencies(root)).toBe(first);
  await writeFile(
    join(root, 'node_modules', 'prettier', 'index.js'),
    'tampered-extra\n',
  );
  const afterExtra = await hashProductionDependencies(root);
  expect(afterExtra).not.toBe(first);
  await writeFile(
    join(root, 'node_modules', 'left-pad', 'index.js'),
    'tampered-prod\n',
  );
  expect(await hashProductionDependencies(root)).not.toBe(afterExtra);
});

function nestedProductionLockfile() {
  return `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "dependencies": { "parent-runtime": "1.0.0", },
    },
  },
  "packages": {
    "parent-runtime": ["parent-runtime@1.0.0", "", { "dependencies": { "nested-runtime": "1.0.0", }, }, "sha512-parent"],
    "nested-runtime": ["nested-runtime@1.0.0", "", { "dependencies": {}, }, "sha512-nested"],
  },
}
`;
}

async function nestedProductionFixture() {
  const root = await mkdtemp(join(tmpdir(), 'build-attestation-nested-'));
  await mkdir(join(root, 'node_modules', 'parent-runtime', 'node_modules'), {
    recursive: true,
  });
  await writeFile(join(root, 'package.json'), '{"name":"fixture"}\n');
  await writeFile(join(root, 'bun.lock'), nestedProductionLockfile());
  await writeFile(
    join(root, 'node_modules', 'parent-runtime', 'package.json'),
    '{"name":"parent-runtime"}\n',
  );
  await writeFile(
    join(root, 'node_modules', 'parent-runtime', 'index.js'),
    'parent\n',
  );
  await mkdir(
    join(
      root,
      'node_modules',
      'parent-runtime',
      'node_modules',
      'nested-runtime',
    ),
    { recursive: true },
  );
  await writeFile(
    join(
      root,
      'node_modules',
      'parent-runtime',
      'node_modules',
      'nested-runtime',
      'package.json',
    ),
    '{"name":"nested-runtime"}\n',
  );
  await writeFile(
    join(
      root,
      'node_modules',
      'parent-runtime',
      'node_modules',
      'nested-runtime',
      'index.js',
    ),
    'nested\n',
  );
  return root;
}

test('production dependency digest attests nested transitive packages that are not root-hoisted', async () => {
  const root = await nestedProductionFixture();
  await expect(
    stat(join(root, 'node_modules', 'nested-runtime')),
  ).rejects.toThrow();

  const first = await hashProductionDependencies(root);
  expect(first).toMatch(/^[0-9a-f]{64}$/);

  await writeFile(
    join(
      root,
      'node_modules',
      'parent-runtime',
      'node_modules',
      'nested-runtime',
      'index.js',
    ),
    'tampered-nested\n',
  );
  expect(await hashProductionDependencies(root)).not.toBe(first);
});

test('production dependency digest fails closed when a nested transitive package is missing', async () => {
  const root = await nestedProductionFixture();
  await rm(
    join(
      root,
      'node_modules',
      'parent-runtime',
      'node_modules',
      'nested-runtime',
    ),
    { recursive: true, force: true },
  );
  await expect(hashProductionDependencies(root)).rejects.toBeInstanceOf(
    BuildAttestationError,
  );
});

test('production dependency digest attests a symlinked isolated .bun production layout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'build-attestation-bun-'));
  await writeFile(join(root, 'package.json'), '{"name":"fixture"}\n');
  await writeFile(join(root, 'bun.lock'), nestedProductionLockfile());

  const parentReal = join(
    root,
    'node_modules',
    '.bun',
    'parent-runtime@1.0.0',
    'node_modules',
    'parent-runtime',
  );
  const nestedReal = join(
    root,
    'node_modules',
    '.bun',
    'nested-runtime@1.0.0',
    'node_modules',
    'nested-runtime',
  );
  await mkdir(parentReal, { recursive: true });
  await mkdir(nestedReal, { recursive: true });
  await mkdir(
    join(root, 'node_modules', '.bun', 'parent-runtime@1.0.0', 'node_modules'),
    { recursive: true },
  );
  await writeFile(
    join(parentReal, 'package.json'),
    '{"name":"parent-runtime"}\n',
  );
  await writeFile(join(parentReal, 'index.js'), 'parent\n');
  await writeFile(
    join(nestedReal, 'package.json'),
    '{"name":"nested-runtime"}\n',
  );
  await writeFile(join(nestedReal, 'index.js'), 'nested\n');
  await symlink(
    '../../../nested-runtime@1.0.0/node_modules/nested-runtime',
    join(
      root,
      'node_modules',
      '.bun',
      'parent-runtime@1.0.0',
      'node_modules',
      'nested-runtime',
    ),
  );
  await symlink(
    '.bun/parent-runtime@1.0.0/node_modules/parent-runtime',
    join(root, 'node_modules', 'parent-runtime'),
  );

  await expect(
    stat(join(root, 'node_modules', 'nested-runtime')),
  ).rejects.toThrow();
  const first = await hashProductionDependencies(root);
  expect(first).toMatch(/^[0-9a-f]{64}$/);

  await writeFile(join(nestedReal, 'index.js'), 'tampered-isolated\n');
  expect(await hashProductionDependencies(root)).not.toBe(first);
});

test('production dependency digest fails closed for an empty production install and skips symlink cycles', async () => {
  const emptyRoot = await mkdtemp(join(tmpdir(), 'build-attestation-empty-'));
  await mkdir(join(emptyRoot, 'node_modules'), { recursive: true });
  await writeFile(join(emptyRoot, 'package.json'), '{"name":"fixture"}\n');
  await writeFile(join(emptyRoot, 'bun.lock'), nestedProductionLockfile());
  await expect(hashProductionDependencies(emptyRoot)).rejects.toBeInstanceOf(
    BuildAttestationError,
  );

  const root = await nestedProductionFixture();
  await symlink('..', join(root, 'node_modules', 'parent-runtime', 'cycle'));
  const digest = await hashProductionDependencies(root);
  expect(digest).toMatch(/^[0-9a-f]{64}$/);
  expect(await hashProductionDependencies(root)).toBe(digest);
});

test('runtime verification accepts a baked attestation and fails closed on source tampering', async () => {
  const root = await fixtureRoot();
  await writeBuildAttestation(root, { commit, tree });
  const verified = await readAndVerifyBuildAttestation(root);
  expect(verified.commit).toBe(commit);

  await writeFile(join(root, 'apps', 'api.ts'), 'export const runtime = 9;\n');
  await expect(readAndVerifyBuildAttestation(root)).rejects.toBeInstanceOf(
    BuildAttestationTamperError,
  );
});

test('runtime verification fails closed when the baked digest is rewritten', async () => {
  const root = await fixtureRoot();
  const attestation = await writeBuildAttestation(root, { commit, tree });
  await writeFile(
    join(root, 'build-attestation.json'),
    `${JSON.stringify({
      ...attestation,
      artifactDigest: 'f'.repeat(64),
      sourceDigest: attestation.sourceDigest,
      browserDigest: attestation.browserDigest,
    })}\n`,
  );
  await expect(readAndVerifyBuildAttestation(root)).rejects.toBeInstanceOf(
    BuildAttestationTamperError,
  );
});

test('startup verifies installed production dependencies once and health uses the cached digest', async () => {
  resetBuildAttestationCache();
  const root = await fixtureRoot();
  const baked = await writeBuildAttestation(root, { commit, tree });
  const started = await verifyBuildAttestationAtStartup(root);
  expect(started.dependencyDigest).toBe(baked.dependencyDigest);

  await writeFile(
    join(root, 'node_modules', 'left-pad', 'index.js'),
    'tampered-after-start\n',
  );
  const health = await verifyBuildAttestationForHealth(root);
  expect(health.artifactDigest).toBe(baked.artifactDigest);

  resetBuildAttestationCache();
  await expect(verifyBuildAttestationAtStartup(root)).rejects.toBeInstanceOf(
    BuildAttestationTamperError,
  );
});

test('health still detects source tampering after dependency verification is cached', async () => {
  resetBuildAttestationCache();
  const root = await fixtureRoot();
  await writeBuildAttestation(root, { commit, tree });
  await verifyBuildAttestationAtStartup(root);
  await writeFile(join(root, 'apps', 'api.ts'), 'export const runtime = 9;\n');
  await expect(verifyBuildAttestationForHealth(root)).rejects.toBeInstanceOf(
    BuildAttestationTamperError,
  );
});
