import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';

export type EphemeralPostgres = {
  connectionString: string;
  stop(): Promise<void>;
};

export async function startEphemeralPostgres(): Promise<EphemeralPostgres> {
  const databaseDir = await mkdtemp(join(tmpdir(), 'prevcare-postgres-'));
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const user = 'postgres';
  const password = crypto.randomUUID();
  const database = 'prevcare_test';
  const postgres = new EmbeddedPostgres({
    databaseDir,
    port,
    user,
    password,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(database);

  return {
    connectionString: `postgres://${user}:${password}@127.0.0.1:${port}/${database}`,
    stop: () => postgres.stop(),
  };
}

export async function createRuntimeDatabaseUser(
  databaseUrl: string,
  options: { mayAssumeOwnerRole?: boolean } = {},
): Promise<string> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const suffix = crypto.randomUUID().replaceAll('-', '');
    const role = `prevcare_app_${suffix}`;
    const password = crypto.randomUUID();
    const database = await client.query<{ name: string }>(
      'select current_database() as name',
    );
    await client.query(
      `create role ${role} login password '${password}' nosuperuser nocreatedb nocreaterole noinherit nobypassrls`,
    );
    if (options.mayAssumeOwnerRole) {
      const ownerRole = `prevcare_owner_${suffix}`;
      const probeView = `runtime_role_ownership_probe_${suffix}`;
      await client.query(
        `create role ${ownerRole} nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls`,
      );
      await client.query(
        `create view identity_access.${probeView} as select 1 as value`,
      );
      await client.query(
        `alter view identity_access.${probeView} owner to ${ownerRole}`,
      );
      await client.query(`grant ${ownerRole} to ${role}`);
    }
    await client.query(
      `grant connect on database ${database.rows[0]?.name} to ${role}`,
    );
    await client.query(
      `grant usage on schema identity_access, school_configuration, intake, learning_progress, audit, infrastructure to ${role}`,
    );
    await client.query(
      `grant select, insert on identity_access.school_workspaces,
         identity_access.staff_identities, identity_access.staff_permission_grants,
          identity_access.classes, identity_access.invitations,
          identity_access.invitation_challenges, identity_access.invitation_deliveries,
          identity_access.students, identity_access.verified_email_addresses,
           identity_access.class_memberships, identity_access.student_sessions,
           identity_access.staff_session_freshness,
           infrastructure.operation_receipts, audit.evidence to ${role}`,
    );
    await client.query(
      `grant execute on function audit.record_unattributed_reveal_attempt(uuid, uuid, timestamptz, text, jsonb) to ${role}`,
    );
    await client.query(
      `grant select, insert, update on identity_access.staff_sessions,
          identity_access.staff_auth_flows, identity_access.invitations,
           identity_access.invitation_challenges,
           identity_access.class_memberships, identity_access.student_sessions,
           identity_access.staff_session_freshness to ${role}`,
    );
    await client.query(
      `grant execute on function identity_access.current_staff_has_permission(text) to ${role}`,
    );
    await client.query(
      'grant select, insert, update on infrastructure.outbox to ' + role,
    );
    await client.query(
      `grant select, insert, update, delete on intake.intake_drafts to ${role}`,
    );
    await client.query(
      `grant select, insert on intake.intake_record_versions to ${role}`,
    );
    await client.query(
      `grant select, insert on intake.intake_operation_receipts to ${role}`,
    );
    await client.query(
      `grant select, insert on learning_progress.item_completions,
         learning_progress.item_completion_receipts to ${role}`,
    );
    await client.query(
      `grant select, insert, update, delete on all tables in schema school_configuration to ${role}`,
    );
    await client.query(
      `grant usage, select on all sequences in schema audit, infrastructure to ${role}`,
    );
    return `postgres://${role}:${password}@127.0.0.1:${new URL(databaseUrl).port}/${database.rows[0]?.name}`;
  } finally {
    await client.end();
  }
}

export async function inspectSpineOperation(
  databaseUrl: string,
  operationId: string,
) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const workspaceResult = await client.query(
      `select workspace_id, display_name, record_owner, record_classification, disposal_class
         from identity_access.school_workspaces
         where workspace_id = (
           select workspace_id from infrastructure.operation_receipts where operation_id = $1
         )`,
      [operationId],
    );
    const receiptResult = await client.query(
      `select workspace_id, operation_id, command_name, record_owner, record_classification,
                disposal_class
         from infrastructure.operation_receipts where operation_id = $1`,
      [operationId],
    );
    const auditResult = await client.query(
      `select audit_id, workspace_id, operation_id, event_type, actor_type, actor_id,
                occurred_at, record_owner, record_classification, disposal_class
         from audit.evidence where operation_id = $1`,
      [operationId],
    );
    const outboxResult = await client.query(
      `select outbox_id, workspace_id, operation_id, topic, status, record_owner,
                record_classification, disposal_class
         from infrastructure.outbox where operation_id = $1`,
      [operationId],
    );

    const workspace = workspaceResult.rows[0];
    const receipt = receiptResult.rows[0];
    const audit = auditResult.rows[0];
    const outbox = outboxResult.rows[0];
    return {
      workspace: workspace && {
        workspaceId: workspace.workspace_id,
        displayName: workspace.display_name,
        recordOwner: workspace.record_owner,
        recordClassification: workspace.record_classification,
        disposalClass: workspace.disposal_class,
      },
      receipt: receipt && {
        workspaceId: receipt.workspace_id,
        operationId: receipt.operation_id,
        commandName: receipt.command_name,
        recordOwner: receipt.record_owner,
        recordClassification: receipt.record_classification,
        disposalClass: receipt.disposal_class,
      },
      audit: audit && {
        auditId: audit.audit_id,
        workspaceId: audit.workspace_id,
        operationId: audit.operation_id,
        eventType: audit.event_type,
        actorType: audit.actor_type,
        actorId: audit.actor_id,
        occurredAt: new Date(audit.occurred_at).toISOString(),
        recordOwner: audit.record_owner,
        recordClassification: audit.record_classification,
        disposalClass: audit.disposal_class,
      },
      outbox: outbox && {
        outboxId: outbox.outbox_id,
        workspaceId: outbox.workspace_id,
        operationId: outbox.operation_id,
        topic: outbox.topic,
        status: outbox.status,
        recordOwner: outbox.record_owner,
        recordClassification: outbox.record_classification,
        disposalClass: outbox.disposal_class,
      },
    };
  } finally {
    await client.end();
  }
}

export async function schoolWorkspaceExists(
  databaseUrl: string,
  workspaceId: string,
): Promise<boolean> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ exists: boolean }>(
      `select exists(
         select 1 from identity_access.school_workspaces where workspace_id = $1
       ) as exists`,
      [workspaceId],
    );
    return result.rows[0]?.exists ?? false;
  } finally {
    await client.end();
  }
}

export async function countVisibleSchoolWorkspaces(
  databaseUrl: string,
): Promise<number> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      'select count(*) as count from identity_access.school_workspaces',
    );
    return Number(result.rows[0]?.count ?? 0);
  } finally {
    await client.end();
  }
}
