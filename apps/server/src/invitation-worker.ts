import { Pool } from 'pg';
import {
  runInvitationDeliveryCycle,
  runSignInCodeDeliveryCycle,
  type InvitationDeliveryDependencies,
  type SignInCodeDeliveryDependencies,
} from '../../../modules/invitation-delivery/index.ts';
import { APPLICATION_LAYER_ENVELOPE_V1 } from '../../../packages/application-keys/src/index.ts';
import { verifyBuildAttestationAtStartup } from '../../../packages/build-attestation/src/index.ts';
import { createResendInvitationMail } from '../../../packages/invitation-mail/src/index.ts';
import {
  decryptInvitationDelivery,
  decryptSignInDelivery,
} from '../../../packages/invitation-secrets/src/index.ts';
import {
  recordInvitationDeliveryAttestation,
  recordWorkerArtifactHeartbeat,
} from '../../../packages/postgres/src/golden-journey-evidence.ts';
import {
  createPostgresInvitationDeliveryPorts,
  createPostgresSignInDeliveryPorts,
} from '../../../packages/postgres/src/invitation-delivery.ts';
import { assertRestrictedDatabaseRole } from '../../../packages/postgres/src/identity-access.ts';
import {
  createSupabaseInvitationQueue,
  createSupabaseSignInQueue,
} from '../../../packages/supabase-queue/src/index.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const connectionUrl = new URL(required('WORKER_DATABASE_URL'));
const databaseCaCertificate = required('DATABASE_CA_CERT');
connectionUrl.searchParams.delete('sslmode');
connectionUrl.searchParams.delete('sslrootcert');
const pool = new Pool({
  connectionString: connectionUrl.toString(),
  ssl: { ca: databaseCaCertificate, rejectUnauthorized: true },
});
await assertRestrictedDatabaseRole(pool);
const attestation = await verifyBuildAttestationAtStartup(process.cwd());
const keyId = required('INVITATION_DELIVERY_KEY_ID');
const keys = {
  encryptionKeys: {
    [keyId]: Buffer.from(required('INVITATION_DELIVERY_KEY'), 'base64'),
  },
};
const ports = createPostgresInvitationDeliveryPorts(pool);
const signInPorts = createPostgresSignInDeliveryPorts(pool);
const deliveries: InvitationDeliveryDependencies['deliveries'] = {
  claim: (outboxId, now) => ports.deliveries.claim(outboxId, now),
  suppress: (input) => ports.deliveries.suppress(input),
  async complete(input) {
    await ports.deliveries.complete(input);
    await recordInvitationDeliveryAttestation(pool, {
      invitationId: input.invitationId,
      artifactDigest: attestation.artifactDigest,
      envelopeAdapter: APPLICATION_LAYER_ENVELOPE_V1,
      recordedAt: new Date(),
    });
  },
};
const mail = createResendInvitationMail({
  apiKey: required('RESEND_API_KEY'),
  sender: required('INVITATION_EMAIL_FROM'),
  controlledRecipient: process.env.INVITATION_CONTROLLED_MAILBOX,
});
const invitationDependencies = {
  ...ports,
  deliveries,
  queue: createSupabaseInvitationQueue(pool),
  mail,
  decrypt: (input: Parameters<InvitationDeliveryDependencies['decrypt']>[0]) =>
    decryptInvitationDelivery({ ...input, keys }),
  clock: { now: () => new Date() },
};
const signInDependencies: SignInCodeDeliveryDependencies = {
  ...signInPorts,
  queue: createSupabaseSignInQueue(pool),
  mail,
  decrypt: (input) =>
    decryptSignInDelivery({
      keys,
      keyId: input.keyId,
      ciphertext: input.ciphertext,
      challengeId: input.challengeId,
      generation: input.generation,
    }),
  clock: { now: () => new Date() },
};

await recordWorkerArtifactHeartbeat(pool, {
  artifactDigest: attestation.artifactDigest,
  envelopeAdapter: APPLICATION_LAYER_ENVELOPE_V1,
  recordedAt: new Date(),
});

for (;;) {
  try {
    await runInvitationDeliveryCycle(invitationDependencies);
  } catch {
    // Never include provider errors or delivery material in worker logs.
    console.error('Invitation delivery cycle failed');
  }
  try {
    await runSignInCodeDeliveryCycle(signInDependencies);
  } catch {
    console.error('Sign-In Code delivery cycle failed');
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
