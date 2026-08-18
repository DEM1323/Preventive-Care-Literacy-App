import { migrate } from '../packages/postgres/src/migrate.ts';
import { assertSupabaseDatabaseTarget } from '../packages/providers/src/index.ts';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const databaseUrl = requiredEnvironment('DATABASE_URL');
const runtimeDatabaseUrl = requiredEnvironment('RUNTIME_DATABASE_URL');
const projectRef = requiredEnvironment('SUPABASE_PROJECT_REF');
const supabaseUrl = requiredEnvironment('SUPABASE_URL');
assertSupabaseDatabaseTarget({
  databaseUrl,
  projectRef,
  supabaseUrl,
});
assertSupabaseDatabaseTarget({
  databaseUrl: runtimeDatabaseUrl,
  projectRef,
  supabaseUrl,
});
await migrate(databaseUrl);

const runtimeConnection = new URL(runtimeDatabaseUrl);
const poolerSuffix = `.${projectRef}`;
const decodedUsername = decodeURIComponent(runtimeConnection.username);
const runtimeRole = decodedUsername.endsWith(poolerSuffix)
  ? decodedUsername.slice(0, -poolerSuffix.length)
  : decodedUsername;
if (!/^[a-z_][a-z0-9_]*$/.test(runtimeRole)) {
  throw new Error('Runtime database role has an invalid name');
}
const platformSql = (
  await readFile(
    new URL('../packages/postgres/supabase/staging.sql', import.meta.url),
    'utf8',
  )
).replaceAll('__RUNTIME_ROLE__', `"${runtimeRole}"`);
const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query(platformSql);
} finally {
  await client.end();
}
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
