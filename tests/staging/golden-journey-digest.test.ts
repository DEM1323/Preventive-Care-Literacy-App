import { expect, test } from 'bun:test';
import {
  GoldenJourneyDigestMismatchError,
  assertDeployedSourceIdentity,
  assertWorkerArtifactDigest,
} from '../../packages/golden-journey/src/index.ts';

const commit = 'beda69fca3f7954a0200a3209cb44aac7ade4a72';
const tree = '89abcdef0123456789abcdef0123456789abcdef';
const sourceDigest =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const browserDigest =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const artifactDigest =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const expected = {
  commit,
  tree,
  sourceDigest,
  browserDigest,
  artifactDigest,
};

const deployed = {
  ...expected,
  envelopeAdapter: 'application-layer-envelope/v1',
};

test('digest gate accepts an exact baked commit, tree, and content digests', () => {
  expect(() => assertDeployedSourceIdentity(deployed, expected)).not.toThrow();
});

test('digest gate fails closed when any baked content digest differs from the checkout', () => {
  expect(() =>
    assertDeployedSourceIdentity(
      { ...deployed, commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      expected,
    ),
  ).toThrow(GoldenJourneyDigestMismatchError);

  expect(() =>
    assertDeployedSourceIdentity(
      { ...deployed, artifactDigest: 'f'.repeat(64) },
      expected,
    ),
  ).toThrow(GoldenJourneyDigestMismatchError);

  expect(() =>
    assertDeployedSourceIdentity(
      { ...deployed, sourceDigest: 'c'.repeat(64) },
      expected,
    ),
  ).toThrow(GoldenJourneyDigestMismatchError);

  expect(() =>
    assertDeployedSourceIdentity(
      { ...deployed, tree: 'c'.repeat(40) },
      expected,
    ),
  ).toThrow(GoldenJourneyDigestMismatchError);
});

test('digest gate rejects an unexpected envelope adapter without recording key material', () => {
  expect(() =>
    assertDeployedSourceIdentity(
      { ...deployed, envelopeAdapter: 'supabase-vault' },
      expected,
    ),
  ).toThrow('selected envelope adapter');
});

test('worker digest comparison fails closed for a missing or stale worker attestation', () => {
  expect(() =>
    assertWorkerArtifactDigest({
      publicDigest: artifactDigest,
      workerDigest: undefined,
      expectedDigest: artifactDigest,
    }),
  ).toThrow('Invitation worker attestation was not observed');

  try {
    assertWorkerArtifactDigest({
      publicDigest: artifactDigest,
      workerDigest: 'd'.repeat(64),
      expectedDigest: artifactDigest,
    });
  } catch (error) {
    expect(error).toBeInstanceOf(GoldenJourneyDigestMismatchError);
    expect((error as GoldenJourneyDigestMismatchError).code).toBe(
      'WORKER_DIGEST_MISMATCH',
    );
    return;
  }
  throw new Error('expected worker digest mismatch');
});

test('worker digest comparison requires the public, worker, and expected digests to match', () => {
  expect(() =>
    assertWorkerArtifactDigest({
      publicDigest: artifactDigest,
      workerDigest: artifactDigest,
      expectedDigest: artifactDigest,
    }),
  ).not.toThrow();
});
