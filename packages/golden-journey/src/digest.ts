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
  lockDigest: string;
  dependencyDigest: string;
  bunVersion: string;
  artifactDigest: string;
  envelopeAdapter: string;
};

export type ExpectedSourceIdentity = {
  commit: string;
  tree: string;
  sourceDigest: string;
  browserDigest: string;
  lockDigest: string;
  dependencyDigest: string;
  bunVersion: string;
  artifactDigest: string;
};

export function expectedSourceIdentityFromProductionAttestation(
  attestation: ExpectedSourceIdentity,
  labels: { commit: string; tree: string },
): ExpectedSourceIdentity {
  if (
    attestation.commit !== labels.commit ||
    attestation.tree !== labels.tree
  ) {
    throw new GoldenJourneyDigestMismatchError(
      `Production attestation labels differ from the expected main commit ${labels.commit}`,
    );
  }
  return {
    commit: attestation.commit,
    tree: attestation.tree,
    sourceDigest: attestation.sourceDigest,
    browserDigest: attestation.browserDigest,
    lockDigest: attestation.lockDigest,
    dependencyDigest: attestation.dependencyDigest,
    bunVersion: attestation.bunVersion,
    artifactDigest: attestation.artifactDigest,
  };
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
    deployed.tree !== expected.tree ||
    deployed.sourceDigest !== expected.sourceDigest ||
    deployed.browserDigest !== expected.browserDigest ||
    deployed.lockDigest !== expected.lockDigest ||
    deployed.dependencyDigest !== expected.dependencyDigest ||
    deployed.bunVersion !== expected.bunVersion ||
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
  invitationId: string;
  invitationStatus: string | null;
  workerInvitationId?: string | null;
  workerRecordedAt?: string | null;
  runStartedAt: Date;
  runCompletedAt: Date;
  clockSkewMs?: number;
}): void {
  if (
    input.invitationStatus !== 'delivered' &&
    input.invitationStatus !== 'completed'
  ) {
    throw new GoldenJourneyDigestMismatchError(
      'Invitation worker attestation was not observed',
      'STALE_WORKER',
    );
  }
  if (!input.workerDigest) {
    throw new GoldenJourneyDigestMismatchError(
      'Invitation worker attestation was not observed',
      'STALE_WORKER',
    );
  }
  if (
    input.workerInvitationId &&
    input.workerInvitationId !== input.invitationId
  ) {
    throw new GoldenJourneyDigestMismatchError(
      'Invitation worker attestation was not observed',
      'STALE_WORKER',
    );
  }
  assertTimestampWithinRun(
    input.workerRecordedAt,
    input.runStartedAt,
    input.runCompletedAt,
    input.clockSkewMs,
    'STALE_WORKER',
  );
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

export function isTimestampWithinRun(
  value: string | null | undefined,
  startedAt: Date,
  completedAt: Date,
  skewMs = 30_000,
): boolean {
  if (!value) return false;
  const occurred = Date.parse(value);
  if (Number.isNaN(occurred)) return false;
  return (
    occurred >= startedAt.getTime() - skewMs &&
    occurred <= completedAt.getTime() + skewMs
  );
}

export function assertTimestampWithinRun(
  value: string | null | undefined,
  startedAt: Date,
  completedAt: Date,
  skewMs = 30_000,
  code: GoldenJourneyDigestMismatchError['code'] = 'STALE_WORKER',
): void {
  if (!value) {
    throw new GoldenJourneyDigestMismatchError(
      'Invitation worker attestation was not observed',
      code,
    );
  }
  const occurred = Date.parse(value);
  if (Number.isNaN(occurred)) {
    throw new GoldenJourneyDigestMismatchError(
      'Invitation worker attestation was not observed',
      code,
    );
  }
  if (
    occurred < startedAt.getTime() - skewMs ||
    occurred > completedAt.getTime() + skewMs
  ) {
    throw new GoldenJourneyDigestMismatchError(
      'Invitation worker attestation was not observed',
      code,
    );
  }
}
