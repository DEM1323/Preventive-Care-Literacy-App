import type { Pool, PoolClient } from 'pg';
import {
  studentSignInHourlySendLimit,
  studentSignInSendIntervalMs,
  type InvitationRedemptionCandidate,
  type StudentAccessStore,
  type StudentSessionContext,
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
        const language = await client.query<{
          language_choice: StudentSessionContext['languageChoice'];
        }>(
          `select language_choice from identity_access.students
            where student_id = $1`,
          [studentId],
        );
        await client.query('commit');
        return {
          studentId,
          workspaceId: selected.workspace_id,
          languageChoice: language.rows[0]?.language_choice ?? 'en-US',
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

    async issueSignInCode(request) {
      const client = await options.pool.connect();
      try {
        await client.query('begin');
        await setLocal(
          client,
          'app.sign_in_recipient_digest',
          request.recipientDigest,
        );
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`sign-in-send:${request.recipientDigest}`],
        );
        await client.query(
          `insert into identity_access.sign_in_send_attempts
             (send_attempt_id, recipient_digest, attempted_at, record_owner,
              record_classification, disposal_class)
           values ($1, $2, $3, 'school', 'operational_evidence',
                   'student_sign_in_send_attempt')`,
          [request.sendAttemptId, request.recipientDigest, request.attemptedAt],
        );
        const minuteAgo = new Date(
          request.attemptedAt.getTime() - studentSignInSendIntervalMs,
        );
        const hourAgo = new Date(
          request.attemptedAt.getTime() - 60 * 60 * 1000,
        );
        const window = await client.query<{
          minute_count: string;
          hour_count: string;
        }>(
          `select
             count(*) filter (where attempted_at > $2)::text as minute_count,
             count(*) filter (where attempted_at > $3)::text as hour_count
             from identity_access.sign_in_send_attempts
            where recipient_digest = $1`,
          [request.recipientDigest, minuteAgo, hourAgo],
        );
        const minuteCount = Number(window.rows[0]?.minute_count ?? '0');
        const hourCount = Number(window.rows[0]?.hour_count ?? '0');
        if (minuteCount > 1 || hourCount > studentSignInHourlySendLimit) {
          await client.query('commit');
          return;
        }

        const email = await client.query<{
          student_id: string;
          workspace_id: string;
        }>(
          `select student_id, workspace_id
             from identity_access.verified_email_addresses
            where recipient_digest = $1 and status = 'current'`,
          [request.recipientDigest],
        );
        if (email.rowCount !== 1) {
          await client.query('commit');
          return;
        }
        const selected = email.rows[0]!;
        await setLocal(client, 'app.workspace_id', selected.workspace_id);
        await setLocal(client, 'app.student_id', selected.student_id);
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`sign-in:${selected.workspace_id}:${request.recipientDigest}`],
        );
        const student = await client.query(
          `select 1 from identity_access.students
            where student_id = $1 and workspace_id = $2 and status = 'active'`,
          [selected.student_id, selected.workspace_id],
        );
        if (student.rowCount !== 1) {
          await client.query('commit');
          return;
        }

        const existing = await client.query<{
          sign_in_challenge_id: string;
          current_generation: number;
        }>(
          `select sign_in_challenge_id, current_generation
             from identity_access.sign_in_challenges
            where workspace_id = $1 and recipient_digest = $2 and purpose = 'sign_in'
            for update`,
          [selected.workspace_id, request.recipientDigest],
        );
        const challengeId =
          existing.rows[0]?.sign_in_challenge_id ?? request.proposedChallengeId;
        const generation = (existing.rows[0]?.current_generation ?? 0) + 1;
        const secrets = request.createSecrets({
          challengeId,
          generation,
          workspaceId: selected.workspace_id,
          studentId: selected.student_id,
        });

        if (!existing.rows[0]) {
          await client.query(
            `insert into identity_access.sign_in_challenges
               (sign_in_challenge_id, workspace_id, student_id, recipient_digest,
                purpose, current_generation, created_at, record_owner,
                record_classification, disposal_class)
             values ($1, $2, $3, $4, 'sign_in', $5, $6, 'school',
                     'operational_evidence', 'student_sign_in_challenge')`,
            [
              challengeId,
              selected.workspace_id,
              selected.student_id,
              request.recipientDigest,
              generation,
              request.attemptedAt,
            ],
          );
        } else {
          await client.query(
            `update identity_access.sign_in_challenges
                set current_generation = $2
              where sign_in_challenge_id = $1`,
            [challengeId, generation],
          );
        }

        await client.query(
          `insert into identity_access.sign_in_challenge_codes
             (sign_in_challenge_id, generation, purpose, code_digest, lookup_digest,
              expires_at, completed_at, failed_attempts)
           values ($1, $2, 'sign_in', $3, $4, $5, null, 0)`,
          [
            challengeId,
            generation,
            secrets.codeDigest,
            secrets.lookupDigest,
            secrets.expiresAt,
          ],
        );
        await client.query(
          `insert into identity_access.sign_in_deliveries
             (sign_in_challenge_id, generation, key_id, ciphertext, status,
              provider_idempotency_key, provider_message_id, delivered_at)
           values ($1, $2, $3, $4, 'pending', $5, null, null)`,
          [
            challengeId,
            generation,
            secrets.keyId,
            secrets.ciphertext,
            secrets.providerIdempotencyKey,
          ],
        );
        await client.query(
          `insert into audit.evidence
             (audit_id, workspace_id, operation_id, event_type, actor_type,
              actor_id, occurred_at, record_owner, record_classification,
              disposal_class)
           values ($1, $2, $3, 'student_sign_in.requested', 'student', $4, $5,
                   'school', 'audit_evidence', 'workspace_audit_evidence')`,
          [
            request.auditId,
            selected.workspace_id,
            request.outboxId,
            selected.student_id,
            request.attemptedAt,
          ],
        );
        await client.query(
          `insert into infrastructure.outbox
             (outbox_id, workspace_id, operation_id, topic, payload, status,
              recorded_at, record_owner, record_classification, disposal_class)
           values ($1, $2, $3, 'sign_in.delivery_requested', $4::jsonb, 'pending',
                   $5, 'school', 'operational_evidence', 'transactional_outbox')`,
          [
            request.outboxId,
            selected.workspace_id,
            request.outboxId,
            JSON.stringify({ challengeId, generation }),
            request.attemptedAt,
          ],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async claimSignInAttempt(request) {
      const client = await options.pool.connect();
      try {
        await client.query('begin');
        await setLocal(
          client,
          'app.sign_in_recipient_digest',
          request.recipientDigest,
        );
        const result = await client.query<{
          sign_in_challenge_id: string;
          workspace_id: string;
          student_id: string;
          generation: number;
          code_digest: string;
        }>(
          `select challenge.sign_in_challenge_id, challenge.workspace_id,
                  challenge.student_id, code.generation, code.code_digest
             from identity_access.sign_in_challenges challenge
             join identity_access.sign_in_challenge_codes code
               on code.sign_in_challenge_id = challenge.sign_in_challenge_id
              and code.generation = challenge.current_generation
             join identity_access.sign_in_deliveries delivery
               on delivery.sign_in_challenge_id = challenge.sign_in_challenge_id
              and delivery.generation = challenge.current_generation
            where challenge.recipient_digest = $1
              and challenge.purpose = 'sign_in'
              and delivery.status = 'delivered'
              and code.expires_at > $2
              and code.completed_at is null
              and code.failed_attempts < 5
            order by (code.lookup_digest = $3) desc nulls last,
                     challenge.created_at desc
            limit 1
            for update of challenge, code`,
          [request.recipientDigest, request.attemptedAt, request.lookupDigest],
        );
        const candidate = result.rows[0];
        if (candidate) {
          await client.query(
            `update identity_access.sign_in_challenge_codes
                set failed_attempts = failed_attempts + 1
              where sign_in_challenge_id = $1 and generation = $2`,
            [candidate.sign_in_challenge_id, candidate.generation],
          );
        }
        await client.query('commit');
        return candidate
          ? {
              challengeId: candidate.sign_in_challenge_id,
              workspaceId: candidate.workspace_id,
              studentId: candidate.student_id,
              generation: candidate.generation,
              codeDigest: candidate.code_digest,
            }
          : undefined;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async completeStudentSignIn(request) {
      const client = await options.pool.connect();
      try {
        await client.query('begin');
        await setLocal(
          client,
          'app.sign_in_recipient_digest',
          request.recipientDigest,
        );
        const challenge = await client.query<{
          workspace_id: string;
          student_id: string;
        }>(
          `select challenge.workspace_id, challenge.student_id
             from identity_access.sign_in_challenges challenge
             join identity_access.sign_in_challenge_codes code
               on code.sign_in_challenge_id = challenge.sign_in_challenge_id
              and code.generation = challenge.current_generation
             join identity_access.sign_in_deliveries delivery
               on delivery.sign_in_challenge_id = challenge.sign_in_challenge_id
              and delivery.generation = challenge.current_generation
            where challenge.sign_in_challenge_id = $1
              and challenge.workspace_id = $2
              and challenge.student_id = $3
              and challenge.recipient_digest = $4
              and challenge.current_generation = $5
              and challenge.purpose = 'sign_in'
              and delivery.status = 'delivered'
              and code.code_digest = $6
              and code.expires_at > $7
              and code.completed_at is null
              and code.failed_attempts <= 5
            for update of challenge, code`,
          [
            request.candidate.challengeId,
            request.candidate.workspaceId,
            request.candidate.studentId,
            request.recipientDigest,
            request.candidate.generation,
            request.codeDigest,
            request.attemptedAt,
          ],
        );
        const selected = challenge.rows[0];
        if (!selected) {
          await client.query('rollback');
          return 'unavailable';
        }

        await setLocal(client, 'app.workspace_id', selected.workspace_id);
        await setLocal(client, 'app.student_id', selected.student_id);
        const student = await client.query<{
          language_choice: StudentSessionContext['languageChoice'];
        }>(
          `select language_choice from identity_access.students
            where student_id = $1 and workspace_id = $2 and status = 'active'`,
          [selected.student_id, selected.workspace_id],
        );
        if (student.rowCount !== 1) {
          await client.query('rollback');
          return 'unavailable';
        }

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
            selected.student_id,
            request.session.sessionHandleHash,
            request.attemptedAt,
            request.session.idleExpiresAt,
            request.session.absoluteExpiresAt,
          ],
        );
        await client.query(
          `update identity_access.sign_in_challenge_codes
              set completed_at = $3
            where sign_in_challenge_id = $1 and generation = $2`,
          [
            request.candidate.challengeId,
            request.candidate.generation,
            request.attemptedAt,
          ],
        );
        await client.query(
          `insert into audit.evidence
             (audit_id, workspace_id, operation_id, event_type, actor_type,
              actor_id, occurred_at, record_owner, record_classification,
              disposal_class)
           values ($1, $2, $3, 'student_sign_in.authenticated', 'student', $4, $5,
                   'school', 'audit_evidence', 'workspace_audit_evidence')`,
          [
            request.audit.auditId,
            selected.workspace_id,
            request.audit.operationId,
            selected.student_id,
            request.attemptedAt,
          ],
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
          [selected.student_id],
        );
        await client.query('commit');
        return {
          studentId: selected.student_id,
          workspaceId: selected.workspace_id,
          languageChoice: student.rows[0]!.language_choice,
          activeClassMemberships: memberships.rows.map((membership) => ({
            classId: membership.class_id,
            name: membership.name,
          })),
        } satisfies StudentSessionContext;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async saveStudentLanguage(request) {
      const session = await this.resolveStudentSession({
        sessionHandleHash: request.sessionHandleHash,
        resolvedAt: request.resolvedAt,
        idleExpiresAt: request.idleExpiresAt,
      });
      if (!session) return undefined;
      const client = await options.pool.connect();
      try {
        await client.query('begin');
        await setLocal(client, 'app.workspace_id', session.workspaceId);
        await setLocal(client, 'app.student_id', session.studentId);
        await client.query(
          `update identity_access.students
              set language_choice = $2
            where student_id = $1 and status = 'active'`,
          [session.studentId, request.languageChoice],
        );
        await client.query('commit');
        return request.languageChoice;
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
        const student = await client.query<{
          language_choice: StudentSessionContext['languageChoice'];
        }>(
          `select language_choice from identity_access.students
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
          languageChoice: student.rows[0]!.language_choice,
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

    async replaceVerifiedEmail(request) {
      const client = await options.pool.connect();
      try {
        await client.query('begin');
        await setLocal(client, 'app.workspace_id', request.workspaceId);
        await setLocal(
          client,
          'app.staff_identity_id',
          request.staffIdentityId,
        );
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${request.workspaceId}:${request.operationId}`],
        );
        const receipt = await client.query<{ result: unknown }>(
          `select result from infrastructure.operation_receipts
            where workspace_id = $1 and operation_id = $2
              and command_name = 'replaceStudentVerifiedEmail'`,
          [request.workspaceId, request.operationId],
        );
        if (receipt.rows[0]) {
          await client.query('commit');
          return {
            outcome: 'replayed' as const,
            result: receipt.rows[0].result as typeof request.result,
          };
        }
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${request.workspaceId}:student:${request.studentId}`],
        );
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${request.workspaceId}:verified-email:${request.recipientDigest}`],
        );
        const student = await client.query<{ student_id: string }>(
          `select student_id from identity_access.students
            where student_id = $1 and workspace_id = $2 for update`,
          [request.studentId, request.workspaceId],
        );
        if (!student.rows[0]) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        await setLocal(client, 'app.student_id', request.studentId);
        const recordIdentityReview = async (
          reason:
            'historical_binding' | 'current_binding' | 'pending_invitation',
        ) => {
          await client.query(
            `insert into audit.evidence
               (audit_id, workspace_id, operation_id, event_type, actor_type,
                actor_id, occurred_at, details, record_owner, record_classification,
                disposal_class)
             values ($1, $2, $3, 'student_verified_email.identity_review', 'staff',
                     $4, $5, $6::jsonb, 'school', 'audit_evidence',
                     'workspace_audit_evidence')`,
            [
              request.auditId,
              request.workspaceId,
              request.operationId,
              request.staffIdentityId,
              request.occurredAt,
              JSON.stringify({
                studentId: request.studentId,
                reason: request.reason,
                identityVerification: request.identityVerification,
                reviewReason: reason,
              }),
            ],
          );
          await client.query('commit');
          return { outcome: 'identity_review' as const, reason };
        };
        const collision = await client.query<{
          student_id: string;
          status: 'current' | 'historical';
        }>(
          `select student_id, status
             from identity_access.verified_email_addresses
            where workspace_id = $1 and recipient_digest = $2
            for update`,
          [request.workspaceId, request.recipientDigest],
        );
        const bound = collision.rows[0];
        if (bound) {
          return await recordIdentityReview(
            bound.status === 'historical'
              ? 'historical_binding'
              : 'current_binding',
          );
        }
        const pending = await client.query(
          `select invitation_id from identity_access.invitations
            where workspace_id = $1 and recipient_digest = $2
              and status in ('pending_delivery', 'delivered')
              and authorization_expires_at > $3
            limit 1`,
          [request.workspaceId, request.recipientDigest, request.occurredAt],
        );
        if (pending.rowCount !== 0) {
          return await recordIdentityReview('pending_invitation');
        }

        const currentEmail = await client.query<{
          recipient_digest: string;
        }>(
          `select recipient_digest
             from identity_access.verified_email_addresses
            where workspace_id = $1 and student_id = $2 and status = 'current'
            for update`,
          [request.workspaceId, request.studentId],
        );
        const oldDigest = currentEmail.rows[0]?.recipient_digest;
        if (oldDigest) {
          await client.query(
            `update identity_access.verified_email_addresses
                set status = 'historical', retired_at = $3
              where workspace_id = $1 and student_id = $2 and status = 'current'`,
            [request.workspaceId, request.studentId, request.occurredAt],
          );
        }
        await client.query(
          `insert into identity_access.verified_email_addresses
             (verified_email_address_id, workspace_id, student_id,
              recipient_digest, key_id, ciphertext, status, verified_at,
              retired_at, record_owner, record_classification, disposal_class)
           values ($1, $2, $3, $4, $5, $6, 'current', $7, null,
                   'school', 'student_record', 'verified_email_address')`,
          [
            request.verifiedEmailAddressId,
            request.workspaceId,
            request.studentId,
            request.recipientDigest,
            request.protectedRecipient.keyId,
            request.protectedRecipient.ciphertext,
            request.occurredAt,
          ],
        );

        const sessions = await client.query<{ count: string }>(
          `with revoked as (
             update identity_access.student_sessions
                set revoked_at = $3
              where workspace_id = $1 and student_id = $2 and revoked_at is null
          returning session_id
           )
           select count(*)::text as count from revoked`,
          [request.workspaceId, request.studentId, request.occurredAt],
        );
        if (oldDigest) {
          await client.query(
            `update identity_access.sign_in_challenge_codes code
                set completed_at = $3
               from identity_access.sign_in_challenges challenge
              where challenge.sign_in_challenge_id = code.sign_in_challenge_id
                and challenge.workspace_id = $1
                and challenge.recipient_digest = $2
                and code.completed_at is null`,
            [request.workspaceId, oldDigest, request.occurredAt],
          );
        }
        const invitations = await client.query<{ count: string }>(
          `with revoked as (
             update identity_access.invitations
                set status = 'revoked'
              where workspace_id = $1
                and recipient_digest = $2
                and status in ('pending_delivery', 'delivered', 'delivery_failed')
          returning invitation_id
           )
           select count(*)::text as count from revoked`,
          [request.workspaceId, oldDigest ?? ''],
        );
        await client.query(
          `update identity_access.invitation_challenges challenge
              set completed_at = $2
             from identity_access.invitations invitation
            where invitation.invitation_id = challenge.invitation_id
              and invitation.workspace_id = $1
              and invitation.status = 'revoked'
              and challenge.completed_at is null`,
          [request.workspaceId, request.occurredAt],
        );
        await client.query(
          `update identity_access.invitation_deliveries delivery
              set status = 'suppressed'
             from identity_access.invitations invitation
            where invitation.invitation_id = delivery.invitation_id
              and invitation.workspace_id = $1
              and invitation.status = 'revoked'
              and delivery.status <> 'delivered'`,
          [request.workspaceId],
        );

        await client.query(
          `insert into infrastructure.operation_receipts
             (workspace_id, operation_id, command_name, result, recorded_at,
              record_owner, record_classification, disposal_class)
           values ($1, $2, 'replaceStudentVerifiedEmail', $3::jsonb, $4,
                   'school', 'operational_evidence', 'operation_receipt')`,
          [
            request.workspaceId,
            request.operationId,
            JSON.stringify(request.result),
            request.occurredAt,
          ],
        );
        await client.query(
          `insert into audit.evidence
             (audit_id, workspace_id, operation_id, event_type, actor_type,
              actor_id, occurred_at, details, record_owner, record_classification,
              disposal_class)
           values ($1, $2, $3, 'student_verified_email.replaced', 'staff', $4, $5,
                   $6::jsonb, 'school', 'audit_evidence', 'workspace_audit_evidence')`,
          [
            request.auditId,
            request.workspaceId,
            request.operationId,
            request.staffIdentityId,
            request.occurredAt,
            JSON.stringify({
              studentId: request.studentId,
              reason: request.reason,
              identityVerification: request.identityVerification,
              revokedSessionCount: Number(sessions.rows[0]?.count ?? 0),
              revokedInvitationCount: Number(invitations.rows[0]?.count ?? 0),
            }),
          ],
        );
        await client.query('commit');
        return { outcome: 'applied', result: request.result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async disableStudentAccess(request) {
      const client = await options.pool.connect();
      try {
        await client.query('begin');
        await setLocal(client, 'app.workspace_id', request.workspaceId);
        await setLocal(
          client,
          'app.staff_identity_id',
          request.staffIdentityId,
        );
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${request.workspaceId}:${request.operationId}`],
        );
        const receipt = await client.query<{ result: unknown }>(
          `select result from infrastructure.operation_receipts
            where workspace_id = $1 and operation_id = $2
              and command_name = 'disableStudentAccess'`,
          [request.workspaceId, request.operationId],
        );
        if (receipt.rows[0]) {
          await client.query('commit');
          return {
            outcome: 'replayed' as const,
            result: receipt.rows[0].result as typeof request.result,
          };
        }
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${request.workspaceId}:student:${request.studentId}`],
        );
        const student = await client.query<{ student_id: string }>(
          `select student_id from identity_access.students
            where student_id = $1 and workspace_id = $2 for update`,
          [request.studentId, request.workspaceId],
        );
        if (!student.rows[0]) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        await setLocal(client, 'app.student_id', request.studentId);
        await client.query(
          `update identity_access.students
              set status = 'disabled'
            where student_id = $1 and workspace_id = $2`,
          [request.studentId, request.workspaceId],
        );
        const sessions = await client.query<{ count: string }>(
          `with revoked as (
             update identity_access.student_sessions
                set revoked_at = $3
              where workspace_id = $1 and student_id = $2 and revoked_at is null
          returning session_id
           )
           select count(*)::text as count from revoked`,
          [request.workspaceId, request.studentId, request.occurredAt],
        );
        await client.query(
          `update identity_access.sign_in_challenge_codes code
              set completed_at = $3
             from identity_access.sign_in_challenges challenge
            where challenge.sign_in_challenge_id = code.sign_in_challenge_id
              and challenge.workspace_id = $1
              and challenge.student_id = $2
              and code.completed_at is null`,
          [request.workspaceId, request.studentId, request.occurredAt],
        );
        await client.query(
          `update identity_access.invitation_challenges challenge
              set completed_at = $3
             from identity_access.invitations invitation
             join identity_access.verified_email_addresses email
               on email.workspace_id = invitation.workspace_id
              and email.recipient_digest = invitation.recipient_digest
            where invitation.invitation_id = challenge.invitation_id
              and email.student_id = $2
              and invitation.workspace_id = $1
              and invitation.status in ('pending_delivery', 'delivered', 'delivery_failed')
              and challenge.completed_at is null`,
          [request.workspaceId, request.studentId, request.occurredAt],
        );
        await client.query(
          `insert into infrastructure.operation_receipts
             (workspace_id, operation_id, command_name, result, recorded_at,
              record_owner, record_classification, disposal_class)
           values ($1, $2, 'disableStudentAccess', $3::jsonb, $4,
                   'school', 'operational_evidence', 'operation_receipt')`,
          [
            request.workspaceId,
            request.operationId,
            JSON.stringify(request.result),
            request.occurredAt,
          ],
        );
        await client.query(
          `insert into audit.evidence
             (audit_id, workspace_id, operation_id, event_type, actor_type,
              actor_id, occurred_at, details, record_owner, record_classification,
              disposal_class)
           values ($1, $2, $3, 'student_access.disabled', 'staff', $4, $5,
                   $6::jsonb, 'school', 'audit_evidence', 'workspace_audit_evidence')`,
          [
            request.auditId,
            request.workspaceId,
            request.operationId,
            request.staffIdentityId,
            request.occurredAt,
            JSON.stringify({
              studentId: request.studentId,
              reason: request.reason,
              revokedSessionCount: Number(sessions.rows[0]?.count ?? 0),
            }),
          ],
        );
        await client.query('commit');
        return { outcome: 'applied', result: request.result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async enableStudentAccess(request) {
      const client = await options.pool.connect();
      try {
        await client.query('begin');
        await setLocal(client, 'app.workspace_id', request.workspaceId);
        await setLocal(
          client,
          'app.staff_identity_id',
          request.staffIdentityId,
        );
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${request.workspaceId}:${request.operationId}`],
        );
        const receipt = await client.query<{ result: unknown }>(
          `select result from infrastructure.operation_receipts
            where workspace_id = $1 and operation_id = $2
              and command_name = 'enableStudentAccess'`,
          [request.workspaceId, request.operationId],
        );
        if (receipt.rows[0]) {
          await client.query('commit');
          return {
            outcome: 'replayed' as const,
            result: receipt.rows[0].result as typeof request.result,
          };
        }
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${request.workspaceId}:student:${request.studentId}`],
        );
        const student = await client.query<{ student_id: string }>(
          `select student_id from identity_access.students
            where student_id = $1 and workspace_id = $2 for update`,
          [request.studentId, request.workspaceId],
        );
        if (!student.rows[0]) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        await client.query(
          `update identity_access.students
              set status = 'active'
            where student_id = $1 and workspace_id = $2`,
          [request.studentId, request.workspaceId],
        );
        await client.query(
          `insert into infrastructure.operation_receipts
             (workspace_id, operation_id, command_name, result, recorded_at,
              record_owner, record_classification, disposal_class)
           values ($1, $2, 'enableStudentAccess', $3::jsonb, $4,
                   'school', 'operational_evidence', 'operation_receipt')`,
          [
            request.workspaceId,
            request.operationId,
            JSON.stringify(request.result),
            request.occurredAt,
          ],
        );
        await client.query(
          `insert into audit.evidence
             (audit_id, workspace_id, operation_id, event_type, actor_type,
              actor_id, occurred_at, details, record_owner, record_classification,
              disposal_class)
           values ($1, $2, $3, 'student_access.enabled', 'staff', $4, $5,
                   $6::jsonb, 'school', 'audit_evidence', 'workspace_audit_evidence')`,
          [
            request.auditId,
            request.workspaceId,
            request.operationId,
            request.staffIdentityId,
            request.occurredAt,
            JSON.stringify({
              studentId: request.studentId,
              reason: request.reason,
            }),
          ],
        );
        await client.query('commit');
        return { outcome: 'applied', result: request.result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
