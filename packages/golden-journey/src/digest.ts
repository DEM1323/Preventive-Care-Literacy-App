import { createHash } from 'node:crypto';
import { APPLICATION_LAYER_ENVELOPE_V1 } from '../../application-keys/src/index.ts';

export class GoldenJourneyDigestMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoldenJourneyDigestMismatchError';
  }
}

export type DeployedSourceIdentity = {
  commit: string;
  artifactDigest: string;
  envelopeAdapter: string;
};

export type ExpectedSourceIdentity = {
  commit: string;
  artifactDigest: string;
};

export function artifactDigestForGitTree(tree: string): string {
  if (!/^[0-9a-f]{40}$/.test(tree)) {
    throw new Error('EXPECTED_GIT_TREE must be a 40-character git tree SHA');
  }
  return createHash('sha256').update(`git-tree:${tree}`).digest('hex');
}

export function assertDeployedSourceIdentity(
  deployed: DeployedSourceIdentity,
  expected: ExpectedSourceIdentity,
): void {
  if (deployed.envelopeAdapter !== APPLICATION_LAYER_ENVELOPE_V1) {
    throw new GoldenJourneyDigestMismatchError(
      'Deployed process is not using the selected envelope adapter',
    );
  }
  if (
    deployed.commit !== expected.commit ||
    deployed.artifactDigest !== expected.artifactDigest
  ) {
    throw new GoldenJourneyDigestMismatchError(
      `Deployed digest differs from the expected main commit ${expected.commit} (deployed ${deployed.commit})`,
    );
  }
}
