import { createSupabaseStaffAuth } from '../../../packages/supabase-auth/src/index.ts';
import { createServer } from './app.ts';

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

const server = await createServer({
  databaseUrl,
  databaseCaCertificate: process.env.DATABASE_CA_CERT,
  operatorCredentials: { token: operatorToken, actorId: operatorId },
  staffAuth: createSupabaseStaffAuth({
    supabaseUrl,
    secretKey: supabaseSecretKey,
  }),
  publicOrigin,
  webRoot: process.env.WEB_ROOT ?? 'dist',
});
await server.listen({
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3000),
});
