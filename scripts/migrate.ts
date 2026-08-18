import { migrate } from '../packages/postgres/src/migrate.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

await migrate(databaseUrl);
