import { Kysely, PostgresDialect, sql } from 'kysely';
import type {
  ClassDirectoryEntry,
  ClassInvitationStore,
  CreateClassInvitationResult,
} from '../../../modules/identity-access/index.ts';
import type { Pool } from 'pg';
import type { Database } from './database.ts';

export function createPostgresClassInvitationStore(options: {
  pool: Pool;
}): ClassInvitationStore {
  const database = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: options.pool }),
  });
  const scope = async (
    transaction: Kysely<Database>,
    workspaceId: string,
    staffIdentityId: string,
  ) => {
    await sql`select set_config('app.workspace_id', ${workspaceId}, true)`.execute(
      transaction,
    );
    await sql`select set_config('app.staff_identity_id', ${staffIdentityId}, true)`.execute(
      transaction,
    );
  };

  return {
    commit(request) {
      return database.transaction().execute(async (transaction) => {
        await scope(transaction, request.workspaceId, request.staffIdentityId);
        await sql`select pg_advisory_xact_lock(hashtextextended(${`${request.workspaceId}:${request.operationId}`}, 0))`.execute(
          transaction,
        );
        const existing = await transaction
          .selectFrom('infrastructure.operation_receipts')
          .select('result')
          .where('workspace_id', '=', request.workspaceId)
          .where('operation_id', '=', request.operationId)
          .where('command_name', '=', 'createClassInvitation')
          .executeTakeFirst();
        if (existing) return existing.result as CreateClassInvitationResult;

        const records = request.createRecords();
        await transaction
          .insertInto('identity_access.classes')
          .values({
            class_id: records.classRecord.classId,
            workspace_id: records.classRecord.workspaceId,
            name: records.classRecord.name,
            created_at: records.classRecord.createdAt,
            record_owner: 'school',
            record_classification: 'school_administrative',
            disposal_class: 'class',
          })
          .execute();
        await transaction
          .insertInto('identity_access.invitations')
          .values({
            invitation_id: records.invitation.invitationId,
            workspace_id: records.invitation.workspaceId,
            class_id: records.invitation.classId,
            purpose: records.invitation.purpose,
            recipient_digest: records.invitation.recipientDigest,
            current_generation: records.invitation.currentGeneration,
            status: records.invitation.status,
            created_at: records.invitation.createdAt,
            record_owner: 'school',
            record_classification: 'school_administrative',
            disposal_class: 'invitation',
          })
          .execute();
        await transaction
          .insertInto('identity_access.invitation_challenges')
          .values({
            invitation_id: records.challenge.invitationId,
            generation: records.challenge.generation,
            purpose: records.challenge.purpose,
            code_digest: records.challenge.codeDigest,
            expires_at: records.challenge.expiresAt,
            completed_at: null,
          })
          .execute();
        await transaction
          .insertInto('identity_access.invitation_deliveries')
          .values({
            invitation_id: records.delivery.invitationId,
            generation: records.delivery.generation,
            key_id: records.delivery.keyId,
            ciphertext: records.delivery.ciphertext,
            status: records.delivery.status,
            provider_idempotency_key: records.delivery.providerIdempotencyKey,
            provider_message_id: null,
            delivered_at: null,
          })
          .execute();
        await transaction
          .insertInto('infrastructure.operation_receipts')
          .values({
            workspace_id: request.workspaceId,
            operation_id: request.operationId,
            command_name: 'createClassInvitation',
            result: records.receipt.result,
            recorded_at: records.receipt.recordedAt,
            record_owner: 'school',
            record_classification: 'operational_evidence',
            disposal_class: 'operation_receipt',
          })
          .execute();
        await transaction
          .insertInto('audit.evidence')
          .values({
            audit_id: records.auditId,
            workspace_id: request.workspaceId,
            operation_id: request.operationId,
            event_type: 'class_invitation.created',
            actor_type: 'staff',
            actor_id: records.actorId,
            occurred_at: records.receipt.recordedAt,
            record_owner: 'school',
            record_classification: 'audit_evidence',
            disposal_class: 'workspace_audit_evidence',
          })
          .execute();
        await transaction
          .insertInto('infrastructure.outbox')
          .values({
            outbox_id: records.outboxId,
            workspace_id: request.workspaceId,
            operation_id: request.operationId,
            topic: 'invitation.delivery_requested',
            payload: {
              invitationId: records.invitation.invitationId,
              generation: records.invitation.currentGeneration,
            },
            status: 'pending',
            recorded_at: records.receipt.recordedAt,
            record_owner: 'school',
            record_classification: 'operational_evidence',
            disposal_class: 'transactional_outbox',
          })
          .execute();
        return records.receipt.result;
      });
    },

    list(request) {
      return database.transaction().execute(async (transaction) => {
        await scope(transaction, request.workspaceId, request.staffIdentityId);
        const rows = await transaction
          .selectFrom('identity_access.classes as class')
          .innerJoin(
            'identity_access.invitations as invitation',
            'invitation.class_id',
            'class.class_id',
          )
          .innerJoin(
            'identity_access.invitation_challenges as challenge',
            (join) =>
              join
                .onRef(
                  'challenge.invitation_id',
                  '=',
                  'invitation.invitation_id',
                )
                .onRef(
                  'challenge.generation',
                  '=',
                  'invitation.current_generation',
                ),
          )
          .select([
            'class.class_id',
            'class.name',
            'class.created_at',
            'invitation.invitation_id',
            'invitation.purpose',
            'invitation.current_generation',
            'invitation.status',
            'challenge.expires_at',
          ])
          .orderBy('class.created_at')
          .execute();
        const classes = new Map<string, ClassDirectoryEntry>();
        for (const row of rows) {
          const entry = classes.get(row.class_id) ?? {
            classId: row.class_id,
            name: row.name,
            createdAt: row.created_at,
            invitations: [],
          };
          entry.invitations.push({
            invitationId: row.invitation_id,
            purpose: row.purpose as 'join_class',
            generation: row.current_generation,
            status:
              row.status as ClassDirectoryEntry['invitations'][number]['status'],
            expiresAt: row.expires_at,
          });
          classes.set(row.class_id, entry);
        }
        return [...classes.values()];
      });
    },
  };
}
