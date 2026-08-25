import { expect, test } from 'bun:test';
import {
  GoldenJourneyDigestMismatchError,
  artifactDigestForGitTree,
  assertDeployedSourceIdentity,
} from '../../packages/golden-journey/src/index.ts';

const commit = 'beda69fca3f7954a0200a3209cb44aac7ade4a72';
const tree = '89abcdef0123456789abcdef0123456789abcdef';
const artifactDigest = artifactDigestForGitTree(tree);

test('artifact digest is a 64-character hex identity of the git tree', () => {
  expect(artifactDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(artifactDigestForGitTree(tree)).toBe(artifactDigest);
  expect(artifactDigestForGitTree('0'.repeat(40))).not.toBe(artifactDigest);
});

test('digest gate accepts an exact deployed commit and artifact digest', () => {
  expect(() =>
    assertDeployedSourceIdentity(
      {
        commit,
        artifactDigest,
        envelopeAdapter: 'application-layer-envelope/v1',
      },
      { commit, artifactDigest },
    ),
  ).not.toThrow();
});

test('digest gate fails closed when the deployed commit or artifact digest differs', () => {
  expect(() =>
    assertDeployedSourceIdentity(
      {
        commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        artifactDigest,
        envelopeAdapter: 'application-layer-envelope/v1',
      },
      { commit, artifactDigest },
    ),
  ).toThrow(GoldenJourneyDigestMismatchError);

  expect(() =>
    assertDeployedSourceIdentity(
      {
        commit,
        artifactDigest: 'f'.repeat(64),
        envelopeAdapter: 'application-layer-envelope/v1',
      },
      { commit, artifactDigest },
    ),
  ).toThrow(GoldenJourneyDigestMismatchError);

  try {
    assertDeployedSourceIdentity(
      {
        commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        artifactDigest: 'c'.repeat(64),
        envelopeAdapter: 'application-layer-envelope/v1',
      },
      { commit, artifactDigest },
    );
  } catch (error) {
    const message = String(error);
    expect(message).toContain('Deployed digest differs');
    expect(message).toContain('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(message).toContain(commit);
    return;
  }
  throw new Error('expected digest mismatch to throw');
});

test('digest gate rejects an unexpected envelope adapter without recording key material', () => {
  expect(() =>
    assertDeployedSourceIdentity(
      {
        commit,
        artifactDigest,
        envelopeAdapter: 'supabase-vault',
      },
      { commit, artifactDigest },
    ),
  ).toThrow('selected envelope adapter');
});
