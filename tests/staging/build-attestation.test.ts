import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BuildAttestationTamperError,
  artifactDigestFromParts,
  createBuildAttestation,
  readAndVerifyBuildAttestation,
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
  await writeFile(join(root, 'package.json'), '{"name":"fixture"}\n');
  await writeFile(join(root, 'apps', 'api.ts'), 'export const runtime = 1;\n');
  await writeFile(join(root, 'dist', 'index.js'), 'console.log("browser");\n');
  return root;
}

test('attestation hashes on-disk source and browser artifacts, not a git-tree label', async () => {
  const root = await fixtureRoot();
  const first = await createBuildAttestation(root, { commit, tree });

  expect(first.commit).toBe(commit);
  expect(first.tree).toBe(tree);
  expect(first.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(first.browserDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(first.artifactDigest).toBe(
    artifactDigestFromParts({
      sourceDigest: first.sourceDigest,
      browserDigest: first.browserDigest,
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

test('runtime verification accepts a baked attestation and fails closed on tampering', async () => {
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
