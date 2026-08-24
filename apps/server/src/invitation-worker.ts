import { Pool } from 'pg';
import {
  runInvitationDeliveryCycle,
  type InvitationDeliveryDependencies,
} from '../../../modules/invitation-delivery/index.ts';
import { createResendInvitationMail } from '../../../packages/invitation-mail/src/index.ts';
import { decryptInvitationDelivery } from '../../../packages/invitation-secrets/src/index.ts';
import { createPostgresInvitationDeliveryPorts } from '../../../packages/postgres/src/invitation-delivery.ts';
import { assertRestrictedDatabaseRole } from '../../../packages/postgres/src/identity-access.ts';
import { createSupabaseInvitationQueue } from '../../../packages/supabase-queue/src/index.ts';

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
const keyId = required('INVITATION_DELIVERY_KEY_ID');
const keys = {
  encryptionKeys: {
    [keyId]: Buffer.from(required('INVITATION_DELIVERY_KEY'), 'base64'),
  },
};
const ports = createPostgresInvitationDeliveryPorts(pool);
const dependencies = {
  ...ports,
  queue: createSupabaseInvitationQueue(pool),
  mail: createResendInvitationMail({
    apiKey: required('RESEND_API_KEY'),
    sender: required('INVITATION_EMAIL_FROM'),
    controlledRecipient: required('INVITATION_CONTROLLED_MAILBOX'),
  }),
  decrypt: (input: Parameters<InvitationDeliveryDependencies['decrypt']>[0]) =>
    decryptInvitationDelivery({ ...input, keys }),
  clock: { now: () => new Date() },
};

for (;;) {
  try {
    await runInvitationDeliveryCycle(dependencies);
  } catch {
    // Never include provider errors or delivery material in worker logs.
    console.error('Invitation delivery cycle failed');
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
