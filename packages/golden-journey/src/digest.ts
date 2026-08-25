import { APPLICATION_LAYER_ENVELOPE_V1 } from '../../application-keys/src/index.ts';

export class GoldenJourneyDigestMismatchError extends Error {
  readonly code: 'DIGEST_MISMATCH' | 'WORKER_DIGEST_MISMATCH' | 'STALE_WORKER';

  constructor(
    message: string,
    code:
      | 'DIGEST_MISMATCH'
      | 'WORKER_DIGEST_MISMATCH'
      | 'STALE_WORKER' = 'DIGEST_MISMATCH',
  ) {
    super(message);
    this.name = 'GoldenJourneyDigestMismatchError';
    this.code = code;
  }
}

export type DeployedSourceIdentity = {
  commit: string;
  tree: string;
  sourceDigest: string;
  browserDigest: string;
  artifactDigest: string;
  envelopeAdapter: string;
};

export type ExpectedSourceIdentity = {
  commit: string;
  tree: string;
  sourceDigest: string;
  browserDigest: string;
  artifactDigest: string;
};

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
    deployed.tree !== expected.tree ||
    deployed.sourceDigest !== expected.sourceDigest ||
    deployed.browserDigest !== expected.browserDigest ||
    deployed.artifactDigest !== expected.artifactDigest
  ) {
    throw new GoldenJourneyDigestMismatchError(
      `Deployed digest differs from the expected main commit ${expected.commit} (deployed ${deployed.commit})`,
    );
  }
}

export function assertWorkerArtifactDigest(input: {
  publicDigest: string;
  workerDigest: string | undefined;
  expectedDigest: string;
}): void {
  if (!input.workerDigest) {
    throw new GoldenJourneyDigestMismatchError(
      'Invitation worker attestation was not observed',
      'STALE_WORKER',
    );
  }
  if (
    input.workerDigest !== input.publicDigest ||
    input.workerDigest !== input.expectedDigest
  ) {
    throw new GoldenJourneyDigestMismatchError(
      'Invitation worker artifact digest differs from the public attestation',
      'WORKER_DIGEST_MISMATCH',
    );
  }
}
