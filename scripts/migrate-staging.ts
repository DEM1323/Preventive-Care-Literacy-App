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
    `grant usage on schema identity_access, school_configuration, intake, learning_progress, records_governance, infrastructure, audit
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
          identity_access.invitation_deliveries,
          identity_access.classes,
           identity_access.class_memberships, identity_access.student_sessions,
           identity_access.students,
           identity_access.verified_email_addresses,
           identity_access.sign_in_challenges,
           identity_access.sign_in_challenge_codes
           to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant select, insert, update, delete on all tables in schema school_configuration
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant select, insert, update on all tables in schema records_governance
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant select, insert, update on identity_access.staff_session_freshness
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant execute on function identity_access.current_staff_has_permission(text)
         to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant execute on function identity_access.operator_workspace_catalog()
         to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant execute on function identity_access.workspace_staff_count()
         to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant execute on function identity_access.read_staff_identity(uuid, uuid)
         to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant execute on function identity_access.apply_staff_lifecycle(uuid, uuid, text, text[], timestamptz)
         to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant select, insert, update, delete on intake.intake_drafts
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant select, insert, update on intake.intake_record_versions
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant select, insert on intake.intake_operation_receipts
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant select, insert on learning_progress.item_completions,
          learning_progress.item_completion_receipts
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant delete on identity_access.verified_email_addresses,
          identity_access.student_sessions, identity_access.class_memberships,
          identity_access.invitations, identity_access.invitation_challenges,
          identity_access.invitation_deliveries,
          identity_access.sign_in_challenges,
          identity_access.sign_in_challenge_codes,
          identity_access.sign_in_deliveries,
          identity_access.sign_in_send_attempts,
          intake.intake_record_versions, intake.intake_operation_receipts,
          learning_progress.item_completions,
          learning_progress.item_completion_receipts
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant execute on function records_governance.disposition_purge_authorized(uuid, uuid)
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
    `revoke select, insert, update, delete on audit.security_events
       from ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant execute on function audit.record_unattributed_reveal_attempt(uuid, uuid, timestamptz, text, jsonb)
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant execute on function identity_access.lock_clinical_reveal_authority(text)
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant execute on function infrastructure.golden_journey_operator_evidence(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz)
       to ${runtimeRoleIdentifier}`,
  );
  await client.query(
    `grant execute on function learning_progress.prior_release_items(uuid, uuid)
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
  await client.query(
    `grant select, usage on all sequences in schema records_governance
       to ${runtimeRoleIdentifier}`,
  );
} finally {
  await client.end();
}
