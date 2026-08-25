import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import {
  createIdentityAndAccess,
  type Clock,
  type CreateSchoolWorkspaceResult,
  type IdGenerator,
  SchoolWorkspaceAlreadyExistsError,
  type StaffAuthProvider,
  type StaffSessionHandles,
} from '../../../modules/identity-access/index.ts';
import type { Database } from './database.ts';
import { createPostgresStaffAccessStore } from './staff-access.ts';
import { createPostgresClassInvitationStore } from './class-invitations.ts';
import { createPostgresStudentAccessStore } from './student-access.ts';
import type { InvitationSecretProtector } from '../../../modules/identity-access/index.ts';

export const restrictedDatabaseRoleSql = `select
  exists (
    select 1 from pg_roles inherited
    where (inherited.rolsuper or inherited.rolbypassrls)
      and pg_has_role(current_user, inherited.oid, 'member')
  ) as bypasses_rls,
  exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('identity_access', 'school_configuration', 'intake', 'learning_progress', 'audit', 'infrastructure')
      and pg_has_role(current_user, relation.relowner, 'member')
    union all
    select 1
    from pg_namespace namespace
    where namespace.nspname in ('identity_access', 'school_configuration', 'intake', 'learning_progress', 'audit', 'infrastructure')
      and pg_has_role(current_user, namespace.nspowner, 'member')
  ) as owns_protected_objects`;

export async function assertRestrictedDatabaseRole(pool: Pool): Promise<void> {
  const role = await pool.query<{
    bypasses_rls: boolean;
    owns_protected_objects: boolean;
  }>(restrictedDatabaseRoleSql);
  if (role.rows[0]?.bypasses_rls || role.rows[0]?.owns_protected_objects) {
    throw new Error(
      'The application database role must not own protected objects or bypass row-level security',
    );
  }
}

export function createPostgresIdentityAndAccess(options: {
  pool: Pool;
  staffAuth: StaffAuthProvider;
  handles: StaffSessionHandles;
  clock: Clock;
  ids: IdGenerator;
  invitationSecrets?: InvitationSecretProtector;
}) {
  const database = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: options.pool }),
  });

  return createIdentityAndAccess({
    clock: options.clock,
    ids: options.ids,
    staffAuth: options.staffAuth,
    handles: options.handles,
    staffStore: createPostgresStaffAccessStore({ pool: options.pool }),
    classInvitations: createPostgresClassInvitationStore({
      pool: options.pool,
    }),
    studentAccess: createPostgresStudentAccessStore({ pool: options.pool }),
    ...(options.invitationSecrets
      ? { invitationSecrets: options.invitationSecrets }
      : {}),
    committer: {
      commit(request) {
        return database
          .transaction()
          .execute(async (transaction) => {
            await sql`select set_config('app.workspace_id', ${request.workspaceId}, true)`.execute(
              transaction,
            );
            await sql`select pg_advisory_xact_lock(hashtextextended(${`${request.workspaceId}:${request.operationId}`}, 0))`.execute(
              transaction,
            );

            const receipt = await transaction
              .selectFrom('infrastructure.operation_receipts')
              .select('result')
              .where('workspace_id', '=', request.workspaceId)
              .where('operation_id', '=', request.operationId)
              .where('command_name', '=', 'createSchoolWorkspace')
              .executeTakeFirst();
            if (receipt) return receipt.result as CreateSchoolWorkspaceResult;

            const records = request.createRecords();

            await transaction
              .insertInto('identity_access.school_workspaces')
              .values({
                workspace_id: records.workspace.workspaceId,
                display_name: records.workspace.displayName,
                created_at: records.workspace.createdAt,
                record_owner: records.workspace.recordOwner,
                record_classification: records.workspace.recordClassification,
                disposal_class: records.workspace.disposalClass,
              })
              .execute();
            await transaction
              .insertInto('infrastructure.operation_receipts')
              .values({
                workspace_id: records.receipt.workspaceId,
                operation_id: records.receipt.operationId,
                command_name: records.receipt.commandName,
                result: records.receipt.result,
                recorded_at: records.receipt.recordedAt,
                record_owner: records.receipt.recordOwner,
                record_classification: records.receipt.recordClassification,
                disposal_class: records.receipt.disposalClass,
              })
              .execute();
            await transaction
              .insertInto('audit.evidence')
              .values({
                audit_id: records.audit.auditId,
                workspace_id: records.audit.workspaceId,
                operation_id: records.audit.operationId,
                event_type: records.audit.eventType,
                actor_type: records.audit.actorType,
                actor_id: records.audit.actorId,
                occurred_at: records.audit.occurredAt,
                record_owner: records.audit.recordOwner,
                record_classification: records.audit.recordClassification,
                disposal_class: records.audit.disposalClass,
              })
              .execute();
            await transaction
              .insertInto('infrastructure.outbox')
              .values({
                outbox_id: records.outbox.outboxId,
                workspace_id: records.outbox.workspaceId,
                operation_id: records.outbox.operationId,
                topic: records.outbox.topic,
                payload: records.outbox.payload,
                status: records.outbox.status,
                recorded_at: records.outbox.recordedAt,
                record_owner: records.outbox.recordOwner,
                record_classification: records.outbox.recordClassification,
                disposal_class: records.outbox.disposalClass,
              })
              .execute();

            return records.receipt.result;
          })
          .catch((error: unknown) => {
            if (
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === '23505' &&
              'constraint' in error &&
              error.constraint === 'school_workspaces_pkey'
            ) {
              throw new SchoolWorkspaceAlreadyExistsError();
            }
            throw error;
          });
      },
    },
  });
}
