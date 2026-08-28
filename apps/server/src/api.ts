import { createSupabaseStaffAuth } from '../../../packages/supabase-auth/src/index.ts';
import { verifyBuildAttestationAtStartup } from '../../../packages/build-attestation/src/index.ts';
import { createServer } from './app.ts';
import { createSupabaseReleasePackageStorage } from '../../../packages/release-package-storage/src/index.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const operatorToken = process.env.OPERATOR_PROVISIONING_TOKEN;
if (!operatorToken) throw new Error('OPERATOR_PROVISIONING_TOKEN is required');
const operatorId = process.env.OPERATOR_ID;
if (!operatorId) throw new Error('OPERATOR_ID is required');
const publicOrigin = process.env.PUBLIC_ORIGIN;
if (!publicOrigin) throw new Error('PUBLIC_ORIGIN is required');
const supabaseUrl = process.env.SUPABASE_URL;
if (!supabaseUrl) throw new Error('SUPABASE_URL is required');
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseSecretKey) throw new Error('SUPABASE_SECRET_KEY is required');
const invitationHmacKey = process.env.INVITATION_HMAC_KEY;
if (!invitationHmacKey) throw new Error('INVITATION_HMAC_KEY is required');
const invitationDeliveryKey = process.env.INVITATION_DELIVERY_KEY;
if (!invitationDeliveryKey)
  throw new Error('INVITATION_DELIVERY_KEY is required');
const invitationDeliveryKeyId = process.env.INVITATION_DELIVERY_KEY_ID;
if (!invitationDeliveryKeyId)
  throw new Error('INVITATION_DELIVERY_KEY_ID is required');
const applicationWrappingKey = process.env.APPLICATION_WRAPPING_KEY;
if (!applicationWrappingKey)
  throw new Error('APPLICATION_WRAPPING_KEY is required');
const applicationWrappingKeyId = process.env.APPLICATION_WRAPPING_KEY_ID;
if (!applicationWrappingKeyId)
  throw new Error('APPLICATION_WRAPPING_KEY_ID is required');
const applicationIdempotencyKey = process.env.APPLICATION_IDEMPOTENCY_KEY;
if (!applicationIdempotencyKey)
  throw new Error('APPLICATION_IDEMPOTENCY_KEY is required');

await verifyBuildAttestationAtStartup(process.cwd());
const server = await createServer({
  databaseUrl,
  databaseCaCertificate: process.env.DATABASE_CA_CERT,
  operatorCredentials: { token: operatorToken, actorId: operatorId },
  staffAuth: createSupabaseStaffAuth({
    supabaseUrl,
    secretKey: supabaseSecretKey,
  }),
  releasePackages: createSupabaseReleasePackageStorage({
    supabaseUrl,
    secretKey: supabaseSecretKey,
  }),
  publicOrigin,
  invitationSecrets: {
    hmacKey: Buffer.from(invitationHmacKey, 'base64'),
    encryptionKeys: {
      [invitationDeliveryKeyId]: Buffer.from(invitationDeliveryKey, 'base64'),
    },
    activeEncryptionKeyId: invitationDeliveryKeyId,
  },
  wrappingKeys: {
    wrappingKeys: {
      [applicationWrappingKeyId]: Buffer.from(applicationWrappingKey, 'base64'),
    },
    activeWrappingKeyId: applicationWrappingKeyId,
    idempotencyKey: Buffer.from(applicationIdempotencyKey, 'base64'),
  },
  webRoot: process.env.WEB_ROOT ?? 'dist',
  purgeRestoreRequired: process.env.PURGE_RESTORE_REQUIRED === '1',
});
await server.listen({
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3000),
});
