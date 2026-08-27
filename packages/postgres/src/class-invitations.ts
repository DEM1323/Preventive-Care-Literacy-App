import { Kysely, PostgresDialect, sql } from 'kysely';
import {
  invitationIsSendable,
  invitationPreviewFrom,
  type ClassDefinitionCommit,
  type ClassDirectorySnapshot,
  type ClassInvitationStore,
  type CloseClassResult,
  type CreateClassInvitationResult,
  type CreateClassResult,
  type InvitationPreviewFacts,
  type InvitationStatus,
  type ResendClassInvitationResult,
  type RevokeClassInvitationResult,
  type SendClassInvitationCommit,
  type SendClassInvitationCsvResult,
  type ClassInvitationCsvSendRow,
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

  async function readReceipt<Result>(
    transaction: Kysely<Database>,
    request: { workspaceId: string; operationId: string; commandName: string },
  ) {
    const existing = await transaction
      .selectFrom('infrastructure.operation_receipts')
      .select('result')
      .where('workspace_id', '=', request.workspaceId)
      .where('operation_id', '=', request.operationId)
      .where('command_name', '=', request.commandName)
      .executeTakeFirst();
    return existing?.result as Result | undefined;
  }

  async function insertInvitationRecords(
    transaction: Kysely<Database>,
    request: {
      workspaceId: string;
      operationId: string;
      commandName: string;
      eventType: string;
      records: SendClassInvitationCommit;
      includeReceipt?: boolean;
    },
  ) {
    await transaction
      .insertInto('identity_access.invitations')
      .values({
        invitation_id: request.records.invitation.invitationId,
        workspace_id: request.records.invitation.workspaceId,
        class_id: request.records.invitation.classId,
        purpose: request.records.invitation.purpose,
        recipient_digest: request.records.invitation.recipientDigest,
        current_generation: request.records.invitation.currentGeneration,
        status: request.records.invitation.status,
        created_at: request.records.invitation.createdAt,
        authorization_expires_at:
          request.records.invitation.authorizationExpiresAt,
        record_owner: 'school',
        record_classification: 'school_administrative',
        disposal_class: 'invitation',
      })
      .execute();
    await transaction
      .insertInto('identity_access.invitation_challenges')
      .values({
        invitation_id: request.records.challenge.invitationId,
        generation: request.records.challenge.generation,
        purpose: request.records.challenge.purpose,
        code_digest: request.records.challenge.codeDigest,
        lookup_digest: request.records.challenge.lookupDigest,
        expires_at: request.records.challenge.expiresAt,
        completed_at: null,
        failed_attempts: request.records.challenge.failedAttempts,
      })
      .execute();
    await transaction
      .insertInto('identity_access.invitation_deliveries')
      .values({
        invitation_id: request.records.delivery.invitationId,
        generation: request.records.delivery.generation,
        key_id: request.records.delivery.keyId,
        ciphertext: request.records.delivery.ciphertext,
        status: request.records.delivery.status,
        provider_idempotency_key:
          request.records.delivery.providerIdempotencyKey,
        provider_message_id: null,
        delivered_at: null,
      })
      .execute();
    if (request.includeReceipt !== false) {
      await transaction
        .insertInto('infrastructure.operation_receipts')
        .values({
          workspace_id: request.workspaceId,
          operation_id: request.operationId,
          command_name: request.commandName,
          result: request.records.receipt.result,
          recorded_at: request.records.receipt.recordedAt,
          record_owner: 'school',
          record_classification: 'operational_evidence',
          disposal_class: 'operation_receipt',
        })
        .execute();
    }
    await transaction
      .insertInto('audit.evidence')
      .values({
        audit_id: request.records.auditId,
        workspace_id: request.workspaceId,
        operation_id: request.operationId,
        event_type: request.eventType,
        actor_type: 'staff',
        actor_id: request.records.actorId,
        occurred_at: request.records.receipt.recordedAt,
        record_owner: 'school',
        record_classification: 'audit_evidence',
        disposal_class: 'workspace_audit_evidence',
      })
      .execute();
    await transaction
      .insertInto('infrastructure.outbox')
      .values({
        outbox_id: request.records.outboxId,
        workspace_id: request.workspaceId,
        operation_id: request.operationId,
        topic: 'invitation.delivery_requested',
        payload: {
          invitationId: request.records.invitation.invitationId,
          generation: request.records.invitation.currentGeneration,
        },
        status: 'pending',
        recorded_at: request.records.receipt.recordedAt,
        record_owner: 'school',
        record_classification: 'operational_evidence',
        disposal_class: 'transactional_outbox',
      })
      .execute();
  }

  async function loadPreviewFacts(
    transaction: Kysely<Database>,
    request: {
      workspaceId: string;
      classId: string;
      recipientDigest: string;
      now: Date;
    },
  ): Promise<InvitationPreviewFacts> {
    const classRow = await transaction
      .selectFrom('identity_access.classes')
      .select(['status'])
      .where('class_id', '=', request.classId)
      .where('workspace_id', '=', request.workspaceId)
      .executeTakeFirst();
    if (!classRow) {
      return {
        classStatus: 'missing',
        activeMembership: false,
        inactiveMembership: false,
        pendingInvitation: false,
        currentStudentId: undefined,
        historicalBinding: false,
      };
    }
    const membership = await sql<{
      class_membership_id: string;
      status: 'active' | 'inactive';
      student_id: string;
    }>`
      select membership.class_membership_id, membership.status, membership.student_id
        from identity_access.class_memberships membership
        join identity_access.verified_email_addresses email
          on email.student_id = membership.student_id
       where membership.class_id = ${request.classId}
         and membership.workspace_id = ${request.workspaceId}
         and email.recipient_digest = ${request.recipientDigest}
       order by membership.created_at
       limit 1
    `.execute(transaction);
    const current = await sql<{ student_id: string }>`
      select student_id
        from identity_access.verified_email_addresses
       where workspace_id = ${request.workspaceId}
         and recipient_digest = ${request.recipientDigest}
         and status = 'current'
       limit 1
    `.execute(transaction);
    const historical = await sql<{ exists: boolean }>`
      select exists(
        select 1
          from identity_access.verified_email_addresses
         where workspace_id = ${request.workspaceId}
           and recipient_digest = ${request.recipientDigest}
           and status = 'historical'
      ) as exists
    `.execute(transaction);
    const pending = await transaction
      .selectFrom('identity_access.invitations')
      .select('invitation_id')
      .where('class_id', '=', request.classId)
      .where('workspace_id', '=', request.workspaceId)
      .where('recipient_digest', '=', request.recipientDigest)
      .where('status', 'in', ['pending_delivery', 'delivered'])
      .where('authorization_expires_at', '>', request.now)
      .executeTakeFirst();
    const membershipRow = membership.rows[0];
    return {
      classStatus: classRow.status === 'closed' ? 'closed' : 'open',
      activeMembership: membershipRow?.status === 'active',
      inactiveMembership: membershipRow?.status === 'inactive',
      pendingInvitation: pending !== undefined,
      currentStudentId: current.rows[0]?.student_id,
      historicalBinding: historical.rows[0]?.exists === true,
    };
  }

  return {
    commit(request) {
      return database.transaction().execute(async (transaction) => {
        await scope(transaction, request.workspaceId, request.staffIdentityId);
        await sql`select pg_advisory_xact_lock(hashtextextended(${`${request.workspaceId}:${request.operationId}`}, 0))`.execute(
          transaction,
        );
        const existing = await readReceipt<CreateClassInvitationResult>(
          transaction,
          {
            workspaceId: request.workspaceId,
            operationId: request.operationId,
            commandName: 'createClassInvitation',
          },
        );
        if (existing) return existing;

        const records = request.createRecords();
        await transaction
          .insertInto('identity_access.classes')
          .values({
            class_id: records.classRecord.classId,
            workspace_id: records.classRecord.workspaceId,
            name: records.classRecord.name,
            created_at: records.classRecord.createdAt,
            status: records.classRecord.status,
            record_owner: 'school',
            record_classification: 'school_administrative',
            disposal_class: 'class',
          })
          .execute();
        await insertInvitationRecords(transaction, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'createClassInvitation',
          eventType: 'class_invitation.created',
          records: {
            invitation: records.invitation,
            challenge: records.challenge,
            delivery: records.delivery,
            receipt: records.receipt,
            auditId: records.auditId,
            outboxId: records.outboxId,
            actorId: records.actorId,
          },
        });
        return records.receipt.result;
      });
    },

    createClass(request) {
      return database.transaction().execute(async (transaction) => {
        await scope(transaction, request.workspaceId, request.staffIdentityId);
        await sql`select pg_advisory_xact_lock(hashtextextended(${`${request.workspaceId}:${request.operationId}`}, 0))`.execute(
          transaction,
        );
        const existing = await readReceipt<CreateClassResult>(transaction, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'createClass',
        });
        if (existing) return existing;
        const records: ClassDefinitionCommit = request.createRecords();
        await transaction
          .insertInto('identity_access.classes')
          .values({
            class_id: records.classRecord.classId,
            workspace_id: records.classRecord.workspaceId,
            name: records.classRecord.name,
            created_at: records.classRecord.createdAt,
            status: records.classRecord.status,
            record_owner: 'school',
            record_classification: 'school_administrative',
            disposal_class: 'class',
          })
          .execute();
        await transaction
          .insertInto('infrastructure.operation_receipts')
          .values({
            workspace_id: request.workspaceId,
            operation_id: request.operationId,
            command_name: 'createClass',
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
            event_type: 'class.created',
            actor_type: 'staff',
            actor_id: records.actorId,
            occurred_at: records.receipt.recordedAt,
            record_owner: 'school',
            record_classification: 'audit_evidence',
            disposal_class: 'workspace_audit_evidence',
          })
          .execute();
        return records.receipt.result;
      });
    },

    preview(request) {
      return database.transaction().execute(async (transaction) => {
        await scope(transaction, request.workspaceId, request.staffIdentityId);
        return loadPreviewFacts(transaction, {
          workspaceId: request.workspaceId,
          classId: request.classId,
          recipientDigest: request.recipientDigest,
          now: request.now,
        });
      });
    },

    send(request) {
      return database.transaction().execute(async (transaction) => {
        await scope(transaction, request.workspaceId, request.staffIdentityId);
        await sql`select pg_advisory_xact_lock(hashtextextended(${`${request.workspaceId}:${request.operationId}`}, 0))`.execute(
          transaction,
        );
        const existing = await readReceipt<CreateClassInvitationResult>(
          transaction,
          {
            workspaceId: request.workspaceId,
            operationId: request.operationId,
            commandName: 'sendClassInvitation',
          },
        );
        if (existing) return { outcome: 'replayed' as const, result: existing };
        await sql`select pg_advisory_xact_lock(hashtextextended(${`${request.workspaceId}:${request.classId}:${request.recipientDigest}`}, 0))`.execute(
          transaction,
        );
        const preview = await loadPreviewFacts(transaction, {
          workspaceId: request.workspaceId,
          classId: request.classId,
          recipientDigest: request.recipientDigest,
          now: request.now,
        });
        if (!invitationIsSendable(preview)) {
          return { outcome: 'not_sendable' as const, preview };
        }
        const records = request.createRecords();
        await insertInvitationRecords(transaction, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'sendClassInvitation',
          eventType: 'class_invitation.created',
          records,
        });
        return {
          outcome: 'created' as const,
          result: records.receipt.result as CreateClassInvitationResult,
        };
      });
    },

    sendMany(request) {
      return database.transaction().execute(async (transaction) => {
        await scope(transaction, request.workspaceId, request.staffIdentityId);
        await sql`select pg_advisory_xact_lock(hashtextextended(${`${request.workspaceId}:${request.operationId}`}, 0))`.execute(
          transaction,
        );
        const existing = await readReceipt<SendClassInvitationCsvResult>(
          transaction,
          {
            workspaceId: request.workspaceId,
            operationId: request.operationId,
            commandName: 'sendClassInvitationCsv',
          },
        );
        if (existing) {
          return { outcome: 'replayed' as const, result: existing };
        }
        const classRow = await transaction
          .selectFrom('identity_access.classes')
          .select(['status'])
          .where('class_id', '=', request.classId)
          .where('workspace_id', '=', request.workspaceId)
          .executeTakeFirst();
        if (!classRow) return { outcome: 'class_missing' as const };

        const rows: ClassInvitationCsvSendRow[] = [];
        let recordedAt = request.now;
        for (const row of request.rows) {
          if (row.kind === 'malformed') {
            rows.push({
              lineNumber: row.lineNumber,
              field: row.field,
              outcome: 'malformed',
            });
            continue;
          }
          if (row.kind === 'duplicate_in_file') {
            rows.push({
              lineNumber: row.lineNumber,
              field: row.field,
              outcome: 'duplicate_in_file',
            });
            continue;
          }
          if (!row.selected) {
            rows.push({
              lineNumber: row.lineNumber,
              field: row.field,
              outcome: 'not_selected',
            });
            continue;
          }
          if (!row.recipient || !row.recipientDigest) {
            rows.push({
              lineNumber: row.lineNumber,
              field: row.field,
              outcome: 'malformed',
            });
            continue;
          }
          await sql`select pg_advisory_xact_lock(hashtextextended(${`${request.workspaceId}:${request.classId}:${row.recipientDigest}`}, 0))`.execute(
            transaction,
          );
          const facts = await loadPreviewFacts(transaction, {
            workspaceId: request.workspaceId,
            classId: request.classId,
            recipientDigest: row.recipientDigest,
            now: request.now,
          });
          const preview = invitationPreviewFrom(facts);
          if (!invitationIsSendable(facts) || preview.outcome !== 'ready') {
            if (preview.outcome === 'identity_review') {
              rows.push({
                lineNumber: row.lineNumber,
                field: row.field,
                outcome: 'identity_review',
                reason: preview.reason,
              });
            } else if (
              preview.outcome === 'already_a_member' ||
              preview.outcome === 'already_invited' ||
              preview.outcome === 'class_closed'
            ) {
              rows.push({
                lineNumber: row.lineNumber,
                field: row.field,
                outcome: preview.outcome,
              });
            } else {
              rows.push({
                lineNumber: row.lineNumber,
                field: row.field,
                outcome: 'malformed',
              });
            }
            continue;
          }
          const records = request.createInvitation(row.recipient);
          recordedAt = records.receipt.recordedAt;
          await insertInvitationRecords(transaction, {
            workspaceId: request.workspaceId,
            operationId: request.operationId,
            commandName: 'sendClassInvitationCsv',
            eventType: 'class_invitation.created',
            records,
            includeReceipt: false,
          });
          rows.push({
            lineNumber: row.lineNumber,
            field: row.field,
            outcome: 'sent',
            invitationId: records.invitation.invitationId,
            reuse: preview.reuse,
          });
        }
        const sentCount = rows.filter((row) => row.outcome === 'sent').length;
        const result: SendClassInvitationCsvResult = {
          operationId: request.operationId,
          classId: request.classId,
          outcome: 'applied',
          summary: {
            sent: sentCount,
            skipped: rows.length - sentCount,
            deliveryProblems: 0,
          },
          rows,
        };
        await transaction
          .insertInto('infrastructure.operation_receipts')
          .values({
            workspace_id: request.workspaceId,
            operation_id: request.operationId,
            command_name: 'sendClassInvitationCsv',
            result,
            recorded_at: recordedAt,
            record_owner: 'school',
            record_classification: 'operational_evidence',
            disposal_class: 'operation_receipt',
          })
          .execute();
        await transaction
          .insertInto('audit.evidence')
          .values({
            audit_id: request.auditId,
            workspace_id: request.workspaceId,
            operation_id: request.operationId,
            event_type: 'class_invitation.csv_sent',
            actor_type: 'staff',
            actor_id: request.actorId,
            occurred_at: recordedAt,
            record_owner: 'school',
            record_classification: 'audit_evidence',
            disposal_class: 'workspace_audit_evidence',
          })
          .execute();
        return { outcome: 'applied' as const, result };
      });
    },

    readInvitation(request) {
      return database.transaction().execute(async (transaction) => {
        await scope(transaction, request.workspaceId, request.staffIdentityId);
        const row = await sql<{
          invitation_id: string;
          class_id: string;
          status: InvitationStatus;
          current_generation: number;
          purpose: 'join_class';
          recipient_digest: string;
          key_id: string;
          ciphertext: string;
          class_status: 'open' | 'closed';
        }>`
          select invitation.invitation_id, invitation.class_id, invitation.status,
                 invitation.current_generation, invitation.purpose,
                 invitation.recipient_digest, delivery.key_id, delivery.ciphertext,
                 class.status as class_status
            from identity_access.invitations invitation
            join identity_access.classes class
              on class.class_id = invitation.class_id
            join identity_access.invitation_deliveries delivery
              on delivery.invitation_id = invitation.invitation_id
             and delivery.generation = invitation.current_generation
           where invitation.invitation_id = ${request.invitationId}
             and invitation.workspace_id = ${request.workspaceId}
        `.execute(transaction);
        const selected = row.rows[0];
        if (!selected) return undefined;
        return {
          invitationId: selected.invitation_id,
          classId: selected.class_id,
          status: selected.status,
          generation: selected.current_generation,
          purpose: selected.purpose,
          recipientDigest: selected.recipient_digest,
          keyId: selected.key_id,
          ciphertext: selected.ciphertext,
          classStatus: selected.class_status,
        };
      });
    },

    resend(request) {
      return database.transaction().execute(async (transaction) => {
        await scope(transaction, request.workspaceId, request.staffIdentityId);
        await sql`select pg_advisory_xact_lock(hashtextextended(${`${request.workspaceId}:${request.operationId}`}, 0))`.execute(
          transaction,
        );
        const existing = await readReceipt<ResendClassInvitationResult>(
          transaction,
          {
            workspaceId: request.workspaceId,
            operationId: request.operationId,
            commandName: 'resendClassInvitation',
          },
        );
        if (existing) return { outcome: 'replayed' as const, result: existing };
        const current = await sql<{
          status: InvitationStatus;
          class_status: 'open' | 'closed';
        }>`
          select invitation.status, class.status as class_status
            from identity_access.invitations invitation
            join identity_access.classes class
              on class.class_id = invitation.class_id
           where invitation.invitation_id = ${request.invitationId}
             and invitation.workspace_id = ${request.workspaceId}
           for update of invitation, class
        `.execute(transaction);
        const selected = current.rows[0];
        if (!selected) return { outcome: 'not_found' as const };
        if (selected.class_status === 'closed') {
          return { outcome: 'class_closed' as const };
        }
        if (
          selected.status === 'completed' ||
          selected.status === 'revoked' ||
          selected.status === 'superseded'
        ) {
          return {
            outcome: 'not_resendable' as const,
            status: selected.status,
          };
        }
        const records = request.createRecords();
        await transaction
          .updateTable('identity_access.invitations')
          .set({ status: 'superseded' })
          .where('invitation_id', '=', request.invitationId)
          .execute();
        await transaction
          .updateTable('identity_access.invitation_deliveries')
          .set({ status: 'suppressed' })
          .where('invitation_id', '=', request.invitationId)
          .where('status', '<>', 'delivered')
          .execute();
        await insertInvitationRecords(transaction, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'resendClassInvitation',
          eventType: 'class_invitation.superseded',
          records,
        });
        return {
          outcome: 'superseded' as const,
          result: records.receipt.result as ResendClassInvitationResult,
        };
      });
    },

    revoke(request) {
      return database.transaction().execute(async (transaction) => {
        await scope(transaction, request.workspaceId, request.staffIdentityId);
        await sql`select pg_advisory_xact_lock(hashtextextended(${`${request.workspaceId}:${request.operationId}`}, 0))`.execute(
          transaction,
        );
        const existing = await readReceipt<RevokeClassInvitationResult>(
          transaction,
          {
            workspaceId: request.workspaceId,
            operationId: request.operationId,
            commandName: 'revokeClassInvitation',
          },
        );
        if (existing) return { outcome: 'replayed' as const, result: existing };
        const current = await transaction
          .selectFrom('identity_access.invitations')
          .select('status')
          .where('invitation_id', '=', request.invitationId)
          .where('workspace_id', '=', request.workspaceId)
          .executeTakeFirst();
        if (!current) return { outcome: 'not_found' as const };
        const result: RevokeClassInvitationResult =
          current.status === 'completed'
            ? { ...request.result, outcome: 'unchanged_redeemed' }
            : { ...request.result, outcome: 'revoked' };
        if (current.status !== 'completed' && current.status !== 'revoked') {
          await transaction
            .updateTable('identity_access.invitations')
            .set({ status: 'revoked' })
            .where('invitation_id', '=', request.invitationId)
            .execute();
          await transaction
            .updateTable('identity_access.invitation_deliveries')
            .set({ status: 'suppressed' })
            .where('invitation_id', '=', request.invitationId)
            .where('status', '<>', 'delivered')
            .execute();
        }
        await transaction
          .insertInto('infrastructure.operation_receipts')
          .values({
            workspace_id: request.workspaceId,
            operation_id: request.operationId,
            command_name: 'revokeClassInvitation',
            result,
            recorded_at: request.occurredAt,
            record_owner: 'school',
            record_classification: 'operational_evidence',
            disposal_class: 'operation_receipt',
          })
          .execute();
        await transaction
          .insertInto('audit.evidence')
          .values({
            audit_id: request.auditId,
            workspace_id: request.workspaceId,
            operation_id: request.operationId,
            event_type: 'class_invitation.revoked',
            actor_type: 'staff',
            actor_id: request.staffIdentityId,
            occurred_at: request.occurredAt,
            record_owner: 'school',
            record_classification: 'audit_evidence',
            disposal_class: 'workspace_audit_evidence',
          })
          .execute();
        return { outcome: 'applied' as const, result };
      });
    },

    deactivateMembership(request) {
      return database.transaction().execute(async (transaction) => {
        await scope(transaction, request.workspaceId, request.staffIdentityId);
        await sql`select pg_advisory_xact_lock(hashtextextended(${`${request.workspaceId}:${request.operationId}`}, 0))`.execute(
          transaction,
        );
        const existing = await readReceipt<typeof request.result>(transaction, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'deactivateClassMembership',
        });
        if (existing) return { outcome: 'replayed' as const, result: existing };
        const membership = await sql<{ class_membership_id: string }>`
          select class_membership_id
            from identity_access.class_memberships
           where class_membership_id = ${request.classMembershipId}
             and workspace_id = ${request.workspaceId}
           for update
        `.execute(transaction);
        if (!membership.rows[0]) return { outcome: 'not_found' as const };
        await sql`
          update identity_access.class_memberships
             set status = 'inactive', deactivated_at = ${request.occurredAt}
           where class_membership_id = ${request.classMembershipId}
             and status = 'active'
        `.execute(transaction);
        await transaction
          .insertInto('infrastructure.operation_receipts')
          .values({
            workspace_id: request.workspaceId,
            operation_id: request.operationId,
            command_name: 'deactivateClassMembership',
            result: request.result,
            recorded_at: request.occurredAt,
            record_owner: 'school',
            record_classification: 'operational_evidence',
            disposal_class: 'operation_receipt',
          })
          .execute();
        await transaction
          .insertInto('audit.evidence')
          .values({
            audit_id: request.auditId,
            workspace_id: request.workspaceId,
            operation_id: request.operationId,
            event_type: 'class_membership.deactivated',
            actor_type: 'staff',
            actor_id: request.staffIdentityId,
            occurred_at: request.occurredAt,
            record_owner: 'school',
            record_classification: 'audit_evidence',
            disposal_class: 'workspace_audit_evidence',
          })
          .execute();
        return { outcome: 'applied' as const, result: request.result };
      });
    },

    closeClass(request) {
      return database.transaction().execute(async (transaction) => {
        await scope(transaction, request.workspaceId, request.staffIdentityId);
        await sql`select pg_advisory_xact_lock(hashtextextended(${`${request.workspaceId}:${request.operationId}`}, 0))`.execute(
          transaction,
        );
        const existing = await readReceipt<CloseClassResult>(transaction, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'closeClass',
        });
        if (existing) return { outcome: 'replayed' as const, result: existing };
        const current = await transaction
          .selectFrom('identity_access.classes')
          .select(['status'])
          .where('class_id', '=', request.classId)
          .where('workspace_id', '=', request.workspaceId)
          .executeTakeFirst();
        if (!current) return { outcome: 'not_found' as const };
        if (current.status === 'closed') {
          return { outcome: 'already_closed' as const };
        }
        const revoked = await sql<{ count: string }>`
          with revoked as (
            update identity_access.invitations
               set status = 'revoked'
             where class_id = ${request.classId}
               and workspace_id = ${request.workspaceId}
               and status in ('pending_delivery', 'delivered', 'delivery_failed')
         returning invitation_id
          )
          select count(*)::text as count from revoked
        `.execute(transaction);
        await sql`
          update identity_access.invitation_deliveries delivery
             set status = 'suppressed'
            from identity_access.invitations invitation
           where invitation.invitation_id = delivery.invitation_id
             and invitation.class_id = ${request.classId}
             and invitation.status = 'revoked'
             and delivery.status <> 'delivered'
        `.execute(transaction);
        const deactivated = await sql<{ count: string }>`
          with deactivated as (
            update identity_access.class_memberships
               set status = 'inactive', deactivated_at = ${request.occurredAt}
             where class_id = ${request.classId}
               and workspace_id = ${request.workspaceId}
               and status = 'active'
         returning class_membership_id
          )
          select count(*)::text as count from deactivated
        `.execute(transaction);
        await transaction
          .updateTable('identity_access.classes')
          .set({
            status: 'closed',
            closed_at: request.occurredAt,
            closed_by: request.actorId,
          })
          .where('class_id', '=', request.classId)
          .execute();
        const result: CloseClassResult = {
          operationId: request.operationId,
          classId: request.classId,
          outcome: 'closed',
          revokedInvitationCount: Number(revoked.rows[0]?.count ?? 0),
          deactivatedMembershipCount: Number(deactivated.rows[0]?.count ?? 0),
        };
        await transaction
          .insertInto('infrastructure.operation_receipts')
          .values({
            workspace_id: request.workspaceId,
            operation_id: request.operationId,
            command_name: 'closeClass',
            result,
            recorded_at: request.occurredAt,
            record_owner: 'school',
            record_classification: 'operational_evidence',
            disposal_class: 'operation_receipt',
          })
          .execute();
        await transaction
          .insertInto('audit.evidence')
          .values({
            audit_id: request.auditId,
            workspace_id: request.workspaceId,
            operation_id: request.operationId,
            event_type: 'class.closed',
            actor_type: 'staff',
            actor_id: request.actorId,
            occurred_at: request.occurredAt,
            record_owner: 'school',
            record_classification: 'audit_evidence',
            disposal_class: 'workspace_audit_evidence',
          })
          .execute();
        return { outcome: 'applied' as const, result };
      });
    },

    list(request) {
      return database.transaction().execute(async (transaction) => {
        await scope(transaction, request.workspaceId, request.staffIdentityId);
        const classes = await transaction
          .selectFrom('identity_access.classes')
          .select(['class_id', 'name', 'created_at', 'status', 'closed_at'])
          .orderBy('created_at')
          .execute();
        const invitations = await sql<{
          class_id: string;
          invitation_id: string;
          purpose: 'join_class';
          current_generation: number;
          status: InvitationStatus;
          authorization_expires_at: Date;
          created_at: Date;
          recipient_digest: string;
          key_id: string;
          ciphertext: string;
          delivery_status: 'pending' | 'sending' | 'delivered' | 'suppressed';
        }>`
          select invitation.class_id, invitation.invitation_id, invitation.purpose,
                 invitation.current_generation, invitation.status,
                 invitation.authorization_expires_at, invitation.created_at,
                 invitation.recipient_digest, delivery.key_id, delivery.ciphertext,
                 delivery.status as delivery_status
            from identity_access.invitations invitation
            join identity_access.invitation_deliveries delivery
              on delivery.invitation_id = invitation.invitation_id
             and delivery.generation = invitation.current_generation
           where invitation.workspace_id = ${request.workspaceId}
           order by invitation.created_at
        `.execute(transaction);
        const memberships = await sql<{
          class_id: string;
          class_membership_id: string;
          student_id: string;
          status: 'active' | 'inactive';
          email_digests: string[] | null;
        }>`
          select membership.class_id, membership.class_membership_id,
                 membership.student_id, membership.status,
                 coalesce(
                   array_agg(email.recipient_digest)
                     filter (where email.recipient_digest is not null),
                   '{}'
                 ) as email_digests
            from identity_access.class_memberships membership
            left join identity_access.verified_email_addresses email
              on email.student_id = membership.student_id
           where membership.workspace_id = ${request.workspaceId}
           group by membership.class_id, membership.class_membership_id,
                    membership.student_id, membership.status
        `.execute(transaction);
        const students = await sql<{
          student_id: string;
          status: 'active' | 'disabled';
          presence: 'enrolled' | 'departed';
        }>`
          select student_id, status, presence
            from identity_access.students
           where workspace_id = ${request.workspaceId}
           order by created_at, student_id
        `.execute(transaction);
        const emails = await sql<{
          student_id: string;
          recipient_digest: string;
          status: 'current' | 'historical';
          verified_at: Date;
          retired_at: Date | null;
          key_id: string;
          ciphertext: string;
        }>`
          select student_id, recipient_digest, status, verified_at, retired_at,
                 key_id, ciphertext
            from identity_access.verified_email_addresses
           where workspace_id = ${request.workspaceId}
           order by verified_at desc, recipient_digest
        `.execute(transaction);
        const snapshot: ClassDirectorySnapshot = {
          classes: classes.map((row) => ({
            classId: row.class_id,
            name: row.name,
            createdAt: row.created_at,
            status: row.status === 'closed' ? 'closed' : 'open',
            closedAt: row.closed_at ?? null,
          })),
          invitations: invitations.rows.map((row) => ({
            classId: row.class_id,
            invitationId: row.invitation_id,
            purpose: row.purpose,
            generation: row.current_generation,
            status: row.status,
            expiresAt: row.authorization_expires_at,
            createdAt: row.created_at,
            recipientDigest: row.recipient_digest,
            keyId: row.key_id,
            ciphertext: row.ciphertext,
            deliveryStatus: row.delivery_status,
          })),
          memberships: memberships.rows.map((row) => ({
            classId: row.class_id,
            classMembershipId: row.class_membership_id,
            studentId: row.student_id,
            status: row.status,
            emailDigests: row.email_digests ?? [],
          })),
          studentAccess: students.rows.map((student) => ({
            studentId: student.student_id,
            status: student.status,
            presence: student.presence,
            emails: emails.rows
              .filter((email) => email.student_id === student.student_id)
              .map((email) => ({
                recipientDigest: email.recipient_digest,
                status: email.status,
                verifiedAt: email.verified_at,
                retiredAt: email.retired_at,
                keyId: email.key_id,
                ciphertext: email.ciphertext,
              })),
          })),
        };
        return snapshot;
      });
    },
  };
}
