import { createServer } from './app.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const operatorToken = process.env.OPERATOR_PROVISIONING_TOKEN;
if (!operatorToken) throw new Error('OPERATOR_PROVISIONING_TOKEN is required');
const operatorId = process.env.OPERATOR_ID;
if (!operatorId) throw new Error('OPERATOR_ID is required');
const publicOrigin = process.env.PUBLIC_ORIGIN;
if (!publicOrigin) throw new Error('PUBLIC_ORIGIN is required');

const server = await createServer({
  databaseUrl,
  operatorCredentials: { token: operatorToken, actorId: operatorId },
  publicOrigin,
  webRoot: process.env.WEB_ROOT ?? 'dist',
});
await server.listen({
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3000),
});
