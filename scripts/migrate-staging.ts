import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { migrate } from '../packages/postgres/src/migrate.ts';
import { assertSupabaseDatabaseTarget } from '../packages/providers/src/index.ts';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const databaseUrl = requiredEnvironment('DATABASE_URL');
const runtimeDatabaseUrl = requiredEnvironment('RUNTIME_DATABASE_URL');
const workerDatabaseUrl = requiredEnvironment('WORKER_DATABASE_URL');
const projectRef = requiredEnvironment('SUPABASE_PROJECT_REF');
const supabaseUrl = requiredEnvironment('SUPABASE_URL');
const databaseCaCertificate = requiredEnvironment('DATABASE_CA_CERT');
assertSupabaseDatabaseTarget({
  databaseUrl,
  projectRef,
  supabaseUrl,
});
assertSupabaseDatabaseTarget({
  databaseUrl: workerDatabaseUrl,
  projectRef,
  supabaseUrl,
});
assertSupabaseDatabaseTarget({
  databaseUrl: runtimeDatabaseUrl,
  projectRef,
  supabaseUrl,
});
const connectionUrl = new URL(databaseUrl);
connectionUrl.searchParams.delete('sslmode');
connectionUrl.searchParams.delete('sslrootcert');
const client = new Client({
  connectionString: connectionUrl.toString(),
  ssl: { ca: databaseCaCertificate, rejectUnauthorized: true },
});
await client.connect();
try {
  await migrate(databaseUrl, databaseCaCertificate);

  const runtimeConnection = new URL(runtimeDatabaseUrl);
  const poolerSuffix = `.${projectRef}`;
  const decodedUsername = decodeURIComponent(runtimeConnection.username);
  const runtimeRole = decodedUsername.endsWith(poolerSuffix)
    ? decodedUsername.slice(0, -poolerSuffix.length)
    : decodedUsername;
  if (!/^[a-z_][a-z0-9_]*$/.test(runtimeRole)) {
    throw new Error('Runtime database role has an invalid name');
  }
  const runtimeRoleIdentifier = `"${runtimeRole}"`;
  const workerConnection = new URL(workerDatabaseUrl);
  const decodedWorkerUsername = decodeURIComponent(workerConnection.username);
  const workerRole = decodedWorkerUsername.endsWith(poolerSuffix)
    ? decodedWorkerUsername.slice(0, -poolerSuffix.length)
    : decodedWorkerUsername;
  if (!/^[a-z_][a-z0-9_]*$/.test(workerRole)) {
    throw new Error('Worker database role has an invalid name');
  }
  const workerRoleIdentifier = `"${workerRole}"`;
  const platformSql = (
    await readFile(
      new URL('../packages/postgres/supabase/staging.sql', import.meta.url),
      'utf8',
    )
  )
    .replaceAll('__RUNTIME_ROLE__', runtimeRoleIdentifier)
    .replaceAll('__WORKER_ROLE__', workerRoleIdentifier);
  await client.query(platformSql);
  await client.query(
    `grant usage on schema identity_access, infrastructure, audit
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant select, insert on all tables in schema identity_access
         to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant select, insert, update on identity_access.staff_sessions,
          identity_access.staff_auth_flows, identity_access.invitations,
          identity_access.invitation_challenges,
          identity_access.class_memberships, identity_access.student_sessions
          to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant execute on function identity_access.current_staff_has_permission(text)
         to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant select, insert on all tables in schema infrastructure
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant select, insert on all tables in schema audit
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant select, usage on all sequences in schema infrastructure
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant select, usage on all sequences in schema audit
       to ${runtimeRoleIdentifier}`,
  );
} finally {
  await client.end();
}
