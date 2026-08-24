import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import {
  StaffIdentityAlreadyExistsError,
  type StaffAccessStore,
  type StaffDirectoryEntry,
  type StaffPermission,
} from '../../../modules/identity-access/index.ts';
import type { Database } from './database.ts';

type Transaction = Kysely<Database>;

async function setWorkspaceScope(
  transaction: Transaction,
  workspaceId: string,
): Promise<void> {
  await sql`select set_config('app.workspace_id', ${workspaceId}, true)`.execute(
    transaction,
  );
}

export function createPostgresStaffAccessStore(options: {
  pool: Pool;
}): StaffAccessStore {
  const database = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: options.pool }),
  });

  return {
    async findStaffProvisioningReceipt(request) {
      return database.transaction().execute(async (transaction) => {
        await setWorkspaceScope(transaction, request.workspaceId);
        const receipt = await transaction
          .selectFrom('infrastructure.operation_receipts')
          .select('result')
          .where('workspace_id', '=', request.workspaceId)
          .where('operation_id', '=', request.operationId)
          .where('command_name', '=', 'provisionStaffIdentity')
          .executeTakeFirst();
        return receipt?.result as
          | Awaited<ReturnType<StaffAccessStore['commitStaffProvisioning']>>
          | undefined;
      });
    },

    commitStaffProvisioning(request) {
      return database
        .transaction()
        .execute(async (transaction) => {
          await setWorkspaceScope(transaction, request.workspaceId);
          await sql`select pg_advisory_xact_lock(hashtextextended(${`${request.workspaceId}:${request.operationId}`}, 0))`.execute(
            transaction,
          );

          const receipt = await transaction
            .selectFrom('infrastructure.operation_receipts')
            .select('result')
            .where('workspace_id', '=', request.workspaceId)
            .where('operation_id', '=', request.operationId)
            .where('command_name', '=', 'provisionStaffIdentity')
            .executeTakeFirst();
          if (receipt) {
            return receipt.result as Awaited<
              ReturnType<StaffAccessStore['commitStaffProvisioning']>
            >;
          }

          const records = await request.createRecords();

          await transaction
            .insertInto('identity_access.staff_identities')
            .values({
              staff_identity_id: records.staffIdentity.staffIdentityId,
              workspace_id: records.staffIdentity.workspaceId,
              display_name: records.staffIdentity.displayName,
              email: records.staffIdentity.email,
              supabase_user_id: records.staffIdentity.supabaseUserId,
              status: records.staffIdentity.status,
              school_approver: records.staffIdentity.schoolApprover,
              provisioning_reason: records.staffIdentity.provisioningReason,
              created_at: records.staffIdentity.createdAt,
              record_owner: records.staffIdentity.recordOwner,
              record_classification: records.staffIdentity.recordClassification,
              disposal_class: records.staffIdentity.disposalClass,
            })
            .execute();
          if (records.grants.length > 0) {
            await transaction
              .insertInto('identity_access.staff_permission_grants')
              .values(
                records.grants.map((grant) => ({
                  workspace_id: grant.workspaceId,
                  staff_identity_id: grant.staffIdentityId,
                  permission: grant.permission,
                  granted_at: grant.grantedAt,
                  grant_reason: grant.grantReason,
                  record_owner: grant.recordOwner,
                  record_classification: grant.recordClassification,
                  disposal_class: grant.disposalClass,
                })),
              )
              .execute();
          }
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
            (error.constraint === 'staff_identities_workspace_id_email_key' ||
              error.constraint === 'staff_identities_pkey' ||
              error.constraint === 'staff_identities_supabase_user_id_key')
          ) {
            throw new StaffIdentityAlreadyExistsError();
          }
          throw error;
        });
    },

    async findStaffBySupabaseUserId(request) {
      return database.transaction().execute(async (transaction) => {
        await sql`select set_config('app.supabase_user_id', ${request.supabaseUserId}, true)`.execute(
          transaction,
        );
        const row = await transaction
          .selectFrom('identity_access.staff_identities')
          .select([
            'staff_identity_id',
            'workspace_id',
            'display_name',
            'email',
            'supabase_user_id',
            'status',
          ])
          .where('supabase_user_id', '=', request.supabaseUserId)
          .executeTakeFirst();
        if (!row) return undefined;
        return {
          staffIdentityId: row.staff_identity_id,
          workspaceId: row.workspace_id,
          displayName: row.display_name,
          email: row.email,
          supabaseUserId: row.supabase_user_id,
          status: row.status as 'active' | 'disabled',
        };
      });
    },

    async recordStaffAudit(request) {
      await database.transaction().execute(async (transaction) => {
        await setWorkspaceScope(transaction, request.workspaceId);
        await transaction
          .insertInto('audit.evidence')
          .values({
            audit_id: request.auditId,
            workspace_id: request.workspaceId,
            operation_id: request.operationId,
            event_type: request.eventType,
            actor_type: request.actorType,
            actor_id: request.actorId,
            occurred_at: request.occurredAt,
            record_owner: 'school',
            record_classification: 'audit_evidence',
            disposal_class: 'workspace_audit_evidence',
          })
          .execute();
      });
    },

    async createStaffAuthFlow(flow) {
      await database.transaction().execute(async (transaction) => {
        await setWorkspaceScope(transaction, flow.workspaceId);
        await transaction
          .insertInto('identity_access.staff_auth_flows')
          .values({
            flow_id: flow.flowId,
            workspace_id: flow.workspaceId,
            staff_identity_id: flow.staffIdentityId,
            flow_handle_hash: flow.flowHandleHash,
            supabase_access_token: flow.supabaseAccessToken,
            factor_id: flow.factorId,
            challenge_id: flow.challengeId,
            expires_at: flow.expiresAt,
            consumed_at: null,
            created_at: flow.createdAt,
            record_owner: 'school',
            record_classification: 'operational_evidence',
            disposal_class: 'staff_auth_flow',
          })
          .execute();
      });
    },

    async withStaffAuthenticationLock(request) {
      return database.transaction().execute(async (transaction) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`staff-authentication:${request.staffIdentityId}`}, 0))`.execute(
          transaction,
        );
        return request.run();
      });
    },

    async readStaffAuthFlow(request) {
      return database.transaction().execute(async (transaction) => {
        await sql`select set_config('app.flow_handle_hash', ${request.flowHandleHash}, true)`.execute(
          transaction,
        );
        const flow = await transaction
          .selectFrom('identity_access.staff_auth_flows')
          .selectAll()
          .where('flow_handle_hash', '=', request.flowHandleHash)
          .executeTakeFirst();
        if (!flow) return undefined;
        await setWorkspaceScope(transaction, flow.workspace_id);
        await sql`select set_config('app.staff_identity_id', ${flow.staff_identity_id}, true)`.execute(
          transaction,
        );
        const identity = await transaction
          .selectFrom('identity_access.staff_identities')
          .select('status')
          .where('staff_identity_id', '=', flow.staff_identity_id)
          .executeTakeFirst();
        if (!identity) return undefined;
        return {
          flowId: flow.flow_id,
          flowHandleHash: flow.flow_handle_hash,
          staffIdentityId: flow.staff_identity_id,
          workspaceId: flow.workspace_id,
          supabaseAccessToken: flow.supabase_access_token,
          factorId: flow.factor_id,
          challengeId: flow.challenge_id,
          createdAt: flow.created_at,
          expiresAt: flow.expires_at,
          consumedAt: flow.consumed_at ?? undefined,
          status: identity.status as 'active' | 'disabled',
        };
      });
    },

    async consumeStaffAuthFlowAndCreateSession(request) {
      return database.transaction().execute(async (transaction) => {
        await sql`select set_config('app.flow_handle_hash', ${request.flowHandleHash}, true)`.execute(
          transaction,
        );
        await setWorkspaceScope(transaction, request.session.workspaceId);
        const consumed = await transaction
          .updateTable('identity_access.staff_auth_flows')
          .set({ consumed_at: request.session.authenticatedAt })
          .where('flow_id', '=', request.flowId)
          .where('consumed_at', 'is', null)
          .returning('flow_id')
          .executeTakeFirst();
        if (!consumed) return 'unavailable';
        await transaction
          .insertInto('identity_access.staff_sessions')
          .values({
            session_id: request.session.sessionId,
            workspace_id: request.session.workspaceId,
            staff_identity_id: request.session.staffIdentityId,
            session_handle_hash: request.session.sessionHandleHash,
            authentication_assurance: request.session.authenticationAssurance,
            authenticated_at: request.session.authenticatedAt,
            expires_at: request.session.expiresAt,
            revoked_at: null,
            created_at: request.session.authenticatedAt,
            record_owner: 'school',
            record_classification: 'operational_evidence',
            disposal_class: 'staff_session',
          })
          .execute();
        await transaction
          .insertInto('audit.evidence')
          .values({
            audit_id: request.audit.auditId,
            workspace_id: request.session.workspaceId,
            operation_id: request.audit.operationId,
            event_type: request.audit.eventType,
            actor_type: 'staff',
            actor_id: request.session.staffIdentityId,
            occurred_at: request.audit.occurredAt,
            record_owner: 'school',
            record_classification: 'audit_evidence',
            disposal_class: 'workspace_audit_evidence',
          })
          .execute();
        return 'created';
      });
    },

    async resolveStaffSession(request) {
      return database.transaction().execute(async (transaction) => {
        await sql`select set_config('app.session_handle_hash', ${request.sessionHandleHash}, true)`.execute(
          transaction,
        );
        const session = await transaction
          .selectFrom('identity_access.staff_sessions')
          .selectAll()
          .where('session_handle_hash', '=', request.sessionHandleHash)
          .executeTakeFirst();
        if (!session) return undefined;
        await setWorkspaceScope(transaction, session.workspace_id);
        await sql`select set_config('app.staff_identity_id', ${session.staff_identity_id}, true)`.execute(
          transaction,
        );
        const identity = await transaction
          .selectFrom('identity_access.staff_identities')
          .select(['display_name', 'status'])
          .where('staff_identity_id', '=', session.staff_identity_id)
          .executeTakeFirst();
        if (!identity) return undefined;
        const grants = await transaction
          .selectFrom('identity_access.staff_permission_grants')
          .select('permission')
          .where('staff_identity_id', '=', session.staff_identity_id)
          .orderBy('permission')
          .execute();
        return {
          sessionId: session.session_id,
          staffIdentityId: session.staff_identity_id,
          workspaceId: session.workspace_id,
          displayName: identity.display_name,
          permissions: grants.map(
            (grant) => grant.permission as StaffPermission,
          ),
          authenticationAssurance: session.authentication_assurance as 'aal2',
          authenticatedAt: session.authenticated_at,
          expiresAt: session.expires_at,
          revokedAt: session.revoked_at ?? undefined,
          status: identity.status as 'active' | 'disabled',
        };
      });
    },

    async revokeStaffSession(request) {
      return database.transaction().execute(async (transaction) => {
        await sql`select set_config('app.session_handle_hash', ${request.sessionHandleHash}, true)`.execute(
          transaction,
        );
        const session = await transaction
          .selectFrom('identity_access.staff_sessions')
          .select(['session_id', 'workspace_id', 'staff_identity_id'])
          .where('session_handle_hash', '=', request.sessionHandleHash)
          .executeTakeFirst();
        if (!session) return false;
        await setWorkspaceScope(transaction, session.workspace_id);
        const revoked = await transaction
          .updateTable('identity_access.staff_sessions')
          .set({ revoked_at: request.revokedAt })
          .where('session_id', '=', session.session_id)
          .where('revoked_at', 'is', null)
          .returning('session_id')
          .executeTakeFirst();
        if (!revoked) return false;
        await transaction
          .insertInto('audit.evidence')
          .values({
            audit_id: request.audit.auditId,
            workspace_id: session.workspace_id,
            operation_id: request.audit.operationId,
            event_type: request.audit.eventType,
            actor_type: 'staff',
            actor_id: session.staff_identity_id,
            occurred_at: request.audit.occurredAt,
            record_owner: 'school',
            record_classification: 'audit_evidence',
            disposal_class: 'workspace_audit_evidence',
          })
          .execute();
        return true;
      });
    },

    async staffHasPermission(request) {
      return database.transaction().execute(async (transaction) => {
        await setWorkspaceScope(transaction, request.workspaceId);
        await sql`select set_config('app.staff_identity_id', ${request.staffIdentityId}, true)`.execute(
          transaction,
        );
        const result = await sql<{
          has_permission: boolean;
        }>`select identity_access.current_staff_has_permission(${request.permission}) as has_permission`.execute(
          transaction,
        );
        return result.rows[0]?.has_permission ?? false;
      });
    },

    async listStaffDirectory(request) {
      return database.transaction().execute(async (transaction) => {
        await setWorkspaceScope(transaction, request.workspaceId);
        await sql`select set_config('app.staff_identity_id', ${request.staffIdentityId}, true)`.execute(
          transaction,
        );
        const identities = await transaction
          .selectFrom('identity_access.staff_identities')
          .select([
            'staff_identity_id',
            'display_name',
            'email',
            'status',
            'created_at',
          ])
          .orderBy('created_at')
          .execute();
        const grants = await transaction
          .selectFrom('identity_access.staff_permission_grants')
          .select(['staff_identity_id', 'permission'])
          .where('workspace_id', '=', request.workspaceId)
          .execute();
        const permissionsByIdentity = new Map<string, StaffPermission[]>();
        for (const grant of grants) {
          const permissions =
            permissionsByIdentity.get(grant.staff_identity_id) ?? [];
          permissions.push(grant.permission as StaffPermission);
          permissionsByIdentity.set(grant.staff_identity_id, permissions);
        }
        return identities.map((identity): StaffDirectoryEntry => ({
          staffIdentityId: identity.staff_identity_id,
          displayName: identity.display_name,
          email: identity.email,
          permissions: (
            permissionsByIdentity.get(identity.staff_identity_id) ?? []
          ).sort(),
          status: identity.status as 'active' | 'disabled',
          createdAt: identity.created_at,
        }));
      });
    },
  };
}
