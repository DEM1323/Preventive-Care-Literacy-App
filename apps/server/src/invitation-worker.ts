import { Pool } from 'pg';
import { serviceCaps } from '../../../modules/operational-readiness/index.ts';
import {
  runInvitationDeliveryCycle,
  runSignInCodeDeliveryCycle,
  runRecordProductionDeliveryCycle,
  type InvitationDeliveryDependencies,
  type SignInCodeDeliveryDependencies,
} from '../../../modules/invitation-delivery/index.ts';
import { APPLICATION_LAYER_ENVELOPE_V1 } from '../../../packages/application-keys/src/index.ts';
import { verifyBuildAttestationAtStartup } from '../../../packages/build-attestation/src/index.ts';
import { createResendInvitationMail } from '../../../packages/invitation-mail/src/index.ts';
import {
  decryptInvitationDelivery,
  decryptRecordProductionDelivery,
  decryptSignInDelivery,
} from '../../../packages/invitation-secrets/src/index.ts';
import {
  recordInvitationDeliveryAttestation,
  recordWorkerArtifactHeartbeat,
} from '../../../packages/postgres/src/golden-journey-evidence.ts';
import {
  createPostgresInvitationDeliveryPorts,
  createPostgresRecordProductionDeliveryPorts,
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
  max: serviceCaps.databasePoolMax,
  idleTimeoutMillis: serviceCaps.databasePoolIdleTimeoutMs,
  connectionTimeoutMillis: serviceCaps.databasePoolConnectionTimeoutMs,
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

const productionPorts = createPostgresRecordProductionDeliveryPorts(pool);
const productionJobs: {
  messageId: string;
  outboxId: string;
  attempt: number;
}[] = [];
const productionDependencies = {
  ...productionPorts,
  queue: {
    async send(payload: { outboxId: string }) {
      if (!productionJobs.some((job) => job.outboxId === payload.outboxId)) {
        productionJobs.push({
          messageId: payload.outboxId,
          outboxId: payload.outboxId,
          attempt: 1,
        });
      }
    },
    async receive() {
      return productionJobs[0];
    },
    async complete() {
      productionJobs.shift();
    },
    async retry(_messageId: string, _delaySeconds: number) {
      const job = productionJobs[0];
      if (job) job.attempt += 1;
    },
  },
  mail,
  decrypt: (input: {
    productionId: string;
    keyId: string;
    ciphertext: string;
  }) =>
    decryptRecordProductionDelivery({
      keys,
      keyId: input.keyId,
      ciphertext: input.ciphertext,
      productionId: input.productionId,
    }),
  clock: { now: () => new Date() },
};

await recordWorkerArtifactHeartbeat(pool, {
  artifactDigest: attestation.artifactDigest,
  envelopeAdapter: APPLICATION_LAYER_ENVELOPE_V1,
  recordedAt: new Date(),
});

async function activityIsStopped() {
  const listed = await pool.query<{ activity_is_stopped: boolean }>(
    'select infrastructure.activity_is_stopped()',
  );
  return listed.rows[0]?.activity_is_stopped === true;
}

for (;;) {
  try {
    if (await activityIsStopped()) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      continue;
    }
  } catch {
    console.error('Incident stop gate failed');
  }
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
  try {
    await runRecordProductionDeliveryCycle(productionDependencies);
  } catch {
    console.error('Record Production delivery cycle failed');
  }
  try {
    await pool.query(
      'select * from infrastructure.expire_record_productions($1)',
      [new Date()],
    );
  } catch {
    console.error('Record Production expiry cleanup failed');
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
