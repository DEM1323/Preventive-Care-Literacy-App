import type { Pool, PoolClient } from 'pg';
import type {
  InvitationRedemptionCandidate,
  StudentAccessStore,
  StudentSessionContext,
} from '../../../modules/identity-access/index.ts';

async function setLocal(client: PoolClient, name: string, value: string) {
  await client.query(`select set_config($1, $2, true)`, [name, value]);
}

export function createPostgresStudentAccessStore(options: {
  pool: Pool;
}): StudentAccessStore {
  return {
    async claimInvitationAttempt(request) {
      const client = await options.pool.connect();
      try {
        await client.query('begin');
        await setLocal(
          client,
          'app.invitation_recipient_digest',
          request.recipientDigest,
        );
        const result = await client.query<{
          invitation_id: string;
          workspace_id: string;
          class_id: string;
          generation: number;
          purpose: 'join_class';
          code_digest: string;
        }>(
          `select invitation.invitation_id, invitation.workspace_id,
                  invitation.class_id, challenge.generation,
                  challenge.purpose, challenge.code_digest
             from identity_access.invitations invitation
             join identity_access.invitation_challenges challenge
               on challenge.invitation_id = invitation.invitation_id
              and challenge.generation = invitation.current_generation
            where invitation.recipient_digest = $1
              and invitation.status = 'delivered'
              and invitation.authorization_expires_at > $2
              and challenge.expires_at > $2
              and challenge.completed_at is null
              and challenge.failed_attempts < 5
            order by (challenge.lookup_digest = $3) desc nulls last,
                     invitation.created_at desc
            limit 1
            for update of invitation, challenge`,
          [request.recipientDigest, request.attemptedAt, request.lookupDigest],
        );
        const candidate = result.rows[0];
        if (candidate) {
          await client.query(
            `update identity_access.invitation_challenges
                set failed_attempts = failed_attempts + 1
              where invitation_id = $1 and generation = $2`,
            [candidate.invitation_id, candidate.generation],
          );
        }
        await client.query('commit');
        return candidate
          ? ({
              invitationId: candidate.invitation_id,
              workspaceId: candidate.workspace_id,
              classId: candidate.class_id,
              generation: candidate.generation,
              purpose: candidate.purpose,
              codeDigest: candidate.code_digest,
            } satisfies InvitationRedemptionCandidate)
          : undefined;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async redeemInvitation(request) {
      const client = await options.pool.connect();
      try {
        await client.query('begin');
        await setLocal(
          client,
          'app.invitation_recipient_digest',
          request.recipientDigest,
        );
        const invitation = await client.query<{
          workspace_id: string;
          class_id: string;
        }>(
          `select invitation.workspace_id, invitation.class_id
             from identity_access.invitations invitation
             join identity_access.invitation_challenges challenge
               on challenge.invitation_id = invitation.invitation_id
              and challenge.generation = invitation.current_generation
            where invitation.invitation_id = $1
              and invitation.workspace_id = $2
              and invitation.class_id = $3
              and invitation.recipient_digest = $4
              and invitation.current_generation = $5
              and invitation.status = 'delivered'
              and invitation.authorization_expires_at > $6
              and challenge.purpose = 'join_class'
              and challenge.code_digest = $7
              and challenge.expires_at > $6
              and challenge.completed_at is null
              and challenge.failed_attempts <= 5
            for update of invitation, challenge`,
          [
            request.candidate.invitationId,
            request.candidate.workspaceId,
            request.candidate.classId,
            request.recipientDigest,
            request.candidate.generation,
            request.attemptedAt,
            request.codeDigest,
          ],
        );
        const selected = invitation.rows[0];
        if (!selected) {
          await client.query('rollback');
          return 'unavailable';
        }

        await setLocal(client, 'app.workspace_id', selected.workspace_id);
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${selected.workspace_id}:${request.recipientDigest}`],
        );
        const email = await client.query<{
          student_id: string;
          status: 'current' | 'historical';
        }>(
          `select student_id, status
             from identity_access.verified_email_addresses
            where workspace_id = $1 and recipient_digest = $2`,
          [selected.workspace_id, request.recipientDigest],
        );
        if (email.rows[0]?.status === 'historical') {
          await client.query('rollback');
          return 'unavailable';
        }
        const studentId =
          email.rows[0]?.student_id ?? request.proposedStudentId;
        await setLocal(client, 'app.student_id', studentId);

        if (!email.rows[0]) {
          await client.query(
            `insert into identity_access.students
               (student_id, workspace_id, status, created_at, record_owner,
                record_classification, disposal_class)
             values ($1, $2, 'active', $3, 'school', 'student_record', 'student_identity')`,
            [studentId, selected.workspace_id, request.attemptedAt],
          );
          await client.query(
            `insert into identity_access.verified_email_addresses
               (verified_email_address_id, workspace_id, student_id,
                recipient_digest, key_id, ciphertext, status, verified_at,
                retired_at, record_owner, record_classification, disposal_class)
             values ($1, $2, $3, $4, $5, $6, 'current', $7, null,
                     'school', 'student_record', 'verified_email_address')`,
            [
              request.verifiedEmailAddressId,
              selected.workspace_id,
              studentId,
              request.recipientDigest,
              request.protectedRecipient.keyId,
              request.protectedRecipient.ciphertext,
              request.attemptedAt,
            ],
          );
        } else {
          const active = await client.query(
            `select 1 from identity_access.students
              where student_id = $1 and workspace_id = $2 and status = 'active'`,
            [studentId, selected.workspace_id],
          );
          if (active.rowCount !== 1) {
            await client.query('rollback');
            return 'unavailable';
          }
        }

        await client.query(
          `insert into identity_access.class_memberships
             (class_membership_id, workspace_id, student_id, class_id, status,
              activated_at, deactivated_at, created_at, record_owner,
              record_classification, disposal_class)
           values ($1, $2, $3, $4, 'active', $5, null, $5,
                   'school', 'student_record', 'class_membership')
           on conflict (student_id, class_id) do update
             set status = 'active', activated_at = excluded.activated_at,
                 deactivated_at = null`,
          [
            request.classMembershipId,
            selected.workspace_id,
            studentId,
            selected.class_id,
            request.attemptedAt,
          ],
        );
        await setLocal(
          client,
          'app.student_session_handle_hash',
          request.session.sessionHandleHash,
        );
        await client.query(
          `insert into identity_access.student_sessions
             (session_id, workspace_id, student_id, session_handle_hash,
              authenticated_at, last_seen_at, idle_expires_at,
              absolute_expires_at, revoked_at, created_at, record_owner,
              record_classification, disposal_class)
           values ($1, $2, $3, $4, $5, $5, $6, $7, null, $5,
                   'school', 'operational_evidence', 'student_session')`,
          [
            request.session.sessionId,
            selected.workspace_id,
            studentId,
            request.session.sessionHandleHash,
            request.attemptedAt,
            request.session.idleExpiresAt,
            request.session.absoluteExpiresAt,
          ],
        );
        await client.query(
          `update identity_access.invitation_challenges
              set completed_at = $3
            where invitation_id = $1 and generation = $2`,
          [
            request.candidate.invitationId,
            request.candidate.generation,
            request.attemptedAt,
          ],
        );
        await client.query(
          `update identity_access.invitations set status = 'completed'
            where invitation_id = $1`,
          [request.candidate.invitationId],
        );
        await client.query(
          `insert into audit.evidence
             (audit_id, workspace_id, operation_id, event_type, actor_type,
              actor_id, occurred_at, record_owner, record_classification,
              disposal_class)
           values ($1, $2, $3, 'class_invitation.redeemed', 'student', $4, $5,
                   'school', 'audit_evidence', 'workspace_audit_evidence')`,
          [
            request.audit.auditId,
            selected.workspace_id,
            request.audit.operationId,
            studentId,
            request.attemptedAt,
          ],
        );

        const classResult = await client.query<{ name: string }>(
          'select name from identity_access.classes where class_id = $1',
          [selected.class_id],
        );
        await client.query('commit');
        return {
          studentId,
          workspaceId: selected.workspace_id,
          activeClassMemberships: [
            {
              classId: selected.class_id,
              name: classResult.rows[0]?.name ?? '',
            },
          ],
        } satisfies StudentSessionContext;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async resolveStudentSession(request) {
      const client = await options.pool.connect();
      try {
        await client.query('begin');
        await setLocal(
          client,
          'app.student_session_handle_hash',
          request.sessionHandleHash,
        );
        const session = await client.query<{
          workspace_id: string;
          student_id: string;
          idle_expires_at: Date;
          absolute_expires_at: Date;
          revoked_at: Date | null;
        }>(
          `select workspace_id, student_id, idle_expires_at,
                  absolute_expires_at, revoked_at
             from identity_access.student_sessions
            where session_handle_hash = $1 for update`,
          [request.sessionHandleHash],
        );
        const current = session.rows[0];
        if (
          !current ||
          current.revoked_at !== null ||
          current.idle_expires_at <= request.resolvedAt ||
          current.absolute_expires_at <= request.resolvedAt
        ) {
          await client.query('rollback');
          return undefined;
        }

        await setLocal(client, 'app.workspace_id', current.workspace_id);
        await setLocal(client, 'app.student_id', current.student_id);
        const student = await client.query(
          `select 1 from identity_access.students
            where student_id = $1 and status = 'active'`,
          [current.student_id],
        );
        if (student.rowCount !== 1) {
          await client.query('rollback');
          return undefined;
        }
        const idleExpiresAt =
          request.idleExpiresAt < current.absolute_expires_at
            ? request.idleExpiresAt
            : current.absolute_expires_at;
        await client.query(
          `update identity_access.student_sessions
              set last_seen_at = $2, idle_expires_at = $3
            where session_handle_hash = $1`,
          [request.sessionHandleHash, request.resolvedAt, idleExpiresAt],
        );
        const memberships = await client.query<{
          class_id: string;
          name: string;
        }>(
          `select class.class_id, class.name
             from identity_access.class_memberships membership
             join identity_access.classes class on class.class_id = membership.class_id
            where membership.student_id = $1 and membership.status = 'active'
            order by membership.activated_at, class.class_id`,
          [current.student_id],
        );
        await client.query('commit');
        return {
          studentId: current.student_id,
          workspaceId: current.workspace_id,
          activeClassMemberships: memberships.rows.map((membership) => ({
            classId: membership.class_id,
            name: membership.name,
          })),
        };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
