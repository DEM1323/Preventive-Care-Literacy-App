import type { Pool, PoolClient } from 'pg';
import type {
  DestructionEligibility,
  RecordAmendmentView,
  RecordConflictReviewView,
  RecordDispositionBlockingReason,
  RecordDispositionPrerequisites,
  RecordDispositionView,
  RecordHoldView,
  RecordLifecycleCaseView,
  RecordProductionMaterials,
  RecordProductionView,
  RecordsGovernanceDirectory,
  RecordsGovernanceStore,
  StudentRecordsGovernanceView,
} from '../../../modules/records-governance/index.ts';
import {
  authorizedProductionPortions,
  recordDispositionAdapters,
  recordDispositionCancellationWindowMs,
} from '../../../modules/records-governance/index.ts';

const recordsPolicyPayload = {
  schema: 'records-policy/v1',
  automaticHoldCaseTypes: ['access', 'amendment'],
  holdsBlock: ['destruction'],
  holdsDoNotBlock: ['access', 'amendment', 'transfer', 'disclosure'],
} as const;

async function setLocal(client: PoolClient, name: string, value: string) {
  await client.query(`select set_config($1, $2, true)`, [name, value]);
}

async function readReceipt<T>(
  client: PoolClient,
  workspaceId: string,
  operationId: string,
  commandName: string,
): Promise<T | undefined> {
  const receipt = await client.query<{ result: T }>(
    `select result from infrastructure.operation_receipts
      where workspace_id = $1 and operation_id = $2 and command_name = $3`,
    [workspaceId, operationId, commandName],
  );
  return receipt.rows[0]?.result;
}

async function writeReceipt(
  client: PoolClient,
  input: {
    workspaceId: string;
    operationId: string;
    commandName: string;
    result: unknown;
    occurredAt: Date;
  },
) {
  await client.query(
    `insert into infrastructure.operation_receipts
       (workspace_id, operation_id, command_name, result, recorded_at,
        record_owner, record_classification, disposal_class)
     values ($1, $2, $3, $4::jsonb, $5,
             'school', 'operational_evidence', 'operation_receipt')`,
    [
      input.workspaceId,
      input.operationId,
      input.commandName,
      JSON.stringify(input.result),
      input.occurredAt,
    ],
  );
}

async function writeAudit(
  client: PoolClient,
  input: {
    auditId: string;
    workspaceId: string;
    operationId: string;
    eventType: string;
    actorId: string;
    occurredAt: Date;
    details: unknown;
    actorType?: 'staff' | 'recipient';
  },
) {
  await client.query(
    `insert into audit.evidence
       (audit_id, workspace_id, operation_id, event_type, actor_type,
        actor_id, occurred_at, details, record_owner, record_classification,
        disposal_class)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb,
             'school', 'audit_evidence', 'workspace_audit_evidence')`,
    [
      input.auditId,
      input.workspaceId,
      input.operationId,
      input.eventType,
      input.actorType ?? 'staff',
      input.actorId,
      input.occurredAt,
      JSON.stringify(input.details),
    ],
  );
}

async function writeOutbox(
  client: PoolClient,
  input: {
    outboxId: string;
    workspaceId: string;
    operationId: string;
    topic: string;
    payload: unknown;
    occurredAt: Date;
  },
) {
  await client.query(
    `insert into infrastructure.outbox
       (outbox_id, workspace_id, operation_id, topic, payload, status,
        recorded_at, record_owner, record_classification, disposal_class)
     values ($1, $2, $3, $4, $5::jsonb, 'pending', $6,
             'school', 'operational_evidence', 'transactional_outbox')`,
    [
      input.outboxId,
      input.workspaceId,
      input.operationId,
      input.topic,
      JSON.stringify(input.payload),
      input.occurredAt,
    ],
  );
}

async function ensurePolicyRevision(
  client: PoolClient,
  workspaceId: string,
  occurredAt: Date,
): Promise<string> {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${workspaceId}:records-policy`,
  ]);
  const current = await client.query<{ policy_revision_id: string }>(
    `select policy_revision_id
       from records_governance.records_policy_revisions
      where workspace_id = $1
      order by revision_number desc
      limit 1
      for update`,
    [workspaceId],
  );
  if (current.rows[0]) return current.rows[0].policy_revision_id;
  const policyRevisionId = crypto.randomUUID();
  await client.query(
    `insert into records_governance.records_policy_revisions
       (policy_revision_id, workspace_id, revision_number, payload,
        activated_at, record_owner, record_classification, disposal_class)
     values ($1, $2, 1, $3::jsonb, $4, 'school', 'school_administrative',
             'records_policy_revision')`,
    [
      policyRevisionId,
      workspaceId,
      JSON.stringify(recordsPolicyPayload),
      occurredAt,
    ],
  );
  return policyRevisionId;
}

async function lockStudent(
  client: PoolClient,
  workspaceId: string,
  studentId: string,
): Promise<{ presence: 'enrolled' | 'departed' } | undefined> {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${workspaceId}:student:${studentId}`,
  ]);
  const student = await client.query<{ presence: 'enrolled' | 'departed' }>(
    `select presence from identity_access.students
      where student_id = $1 and workspace_id = $2 for update`,
    [studentId, workspaceId],
  );
  return student.rows[0];
}

export function createPostgresRecordsGovernanceStore(options: {
  pool: Pool;
}): RecordsGovernanceStore {
  return {
    async recordDeparture(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'recordStudentDeparture',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const student = await lockStudent(
          client,
          request.workspaceId,
          request.studentId,
        );
        if (!student) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        if (student.presence === 'departed') {
          await client.query('rollback');
          return { outcome: 'already_departed' };
        }
        await setLocal(client, 'app.student_id', request.studentId);
        await client.query(
          `update identity_access.students
              set presence = 'departed'
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
        const invitations = await client.query<{ count: string }>(
          `with superseded as (
             update identity_access.invitations invitation
                set status = 'superseded'
               from identity_access.verified_email_addresses email
              where email.workspace_id = invitation.workspace_id
                and email.recipient_digest = invitation.recipient_digest
                and email.student_id = $2
                and invitation.workspace_id = $1
                and invitation.status in ('pending_delivery', 'delivered', 'delivery_failed')
          returning invitation.invitation_id
           )
           select count(*)::text as count from superseded`,
          [request.workspaceId, request.studentId],
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
              and invitation.status = 'superseded'
              and challenge.completed_at is null`,
          [request.workspaceId, request.studentId, request.occurredAt],
        );
        await client.query(
          `update identity_access.invitation_deliveries delivery
              set status = 'suppressed'
             from identity_access.invitations invitation
            where invitation.invitation_id = delivery.invitation_id
              and invitation.workspace_id = $1
              and invitation.status = 'superseded'
              and delivery.status <> 'delivered'`,
          [request.workspaceId],
        );
        const memberships = await client.query<{ count: string }>(
          `with deactivated as (
             update identity_access.class_memberships
                set status = 'inactive', deactivated_at = $3
              where workspace_id = $1 and student_id = $2 and status = 'active'
          returning class_membership_id
           )
           select count(*)::text as count from deactivated`,
          [request.workspaceId, request.studentId, request.occurredAt],
        );
        await client.query(
          `insert into records_governance.student_departure_facts
             (departure_fact_id, workspace_id, student_id, kind, reason,
              effective_on, occurred_at, actor_staff_identity_id, operation_id,
              record_owner, record_classification, disposal_class)
           values ($1, $2, $3, 'departed', $4, $5::date, $6, $7, $8,
                   'school', 'student_record', 'student_departure_fact')`,
          [
            request.departureFactId,
            request.workspaceId,
            request.studentId,
            request.reason,
            request.effectiveOn,
            request.occurredAt,
            request.staffIdentityId,
            request.operationId,
          ],
        );
        const details = {
          studentId: request.studentId,
          reason: request.reason,
          effectiveOn: request.effectiveOn,
          revokedSessionCount: Number(sessions.rows[0]?.count ?? 0),
          supersededInvitationCount: Number(invitations.rows[0]?.count ?? 0),
          deactivatedMembershipCount: Number(memberships.rows[0]?.count ?? 0),
        };
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'recordStudentDeparture',
          result: request.result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'student_departure.recorded',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details,
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'student_departure.recorded',
          payload: details,
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result: request.result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async reverseDeparture(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'reverseStudentDeparture',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const student = await lockStudent(
          client,
          request.workspaceId,
          request.studentId,
        );
        if (!student) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        if (student.presence !== 'departed') {
          await client.query('rollback');
          return { outcome: 'not_departed' };
        }
        await setLocal(client, 'app.student_id', request.studentId);
        await client.query(
          `update identity_access.students
              set presence = 'enrolled'
            where student_id = $1 and workspace_id = $2`,
          [request.studentId, request.workspaceId],
        );
        await client.query(
          `insert into records_governance.student_departure_facts
             (departure_fact_id, workspace_id, student_id, kind, reason,
              effective_on, occurred_at, actor_staff_identity_id, operation_id,
              record_owner, record_classification, disposal_class)
           values ($1, $2, $3, 'reversed', null, null, $4, $5, $6,
                   'school', 'student_record', 'student_departure_fact')`,
          [
            request.departureFactId,
            request.workspaceId,
            request.studentId,
            request.occurredAt,
            request.staffIdentityId,
            request.operationId,
          ],
        );
        const details = { studentId: request.studentId };
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'reverseStudentDeparture',
          result: request.result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'student_departure.reversed',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details,
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'student_departure.reversed',
          payload: details,
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result: request.result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async openCase(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'openRecordLifecycleCase',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const student = await lockStudent(
          client,
          request.workspaceId,
          request.studentId,
        );
        if (!student) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        await setLocal(client, 'app.student_id', request.studentId);
        const policyRevisionId = await ensurePolicyRevision(
          client,
          request.workspaceId,
          request.occurredAt,
        );
        const result = {
          ...request.result,
          policyRevisionId,
        };
        await client.query(
          `insert into records_governance.record_lifecycle_cases
             (case_id, workspace_id, student_id, case_type, request_code,
              requester_kind, authority_kind, scope, deadline_at,
              policy_revision_id, decision, outcome, opened_at, closed_at,
              record_owner, record_classification, disposal_class)
           values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, 'pending',
                   'open', $11, null, 'school', 'student_record',
                   'record_lifecycle_case')`,
          [
            request.caseId,
            request.workspaceId,
            request.studentId,
            request.caseType,
            request.requestCode,
            request.requesterKind,
            request.authorityKind,
            JSON.stringify(request.scope),
            request.deadlineAt,
            policyRevisionId,
            request.occurredAt,
          ],
        );
        await client.query(
          `insert into records_governance.record_lifecycle_case_events
             (case_event_id, case_id, workspace_id, student_id, event_kind,
              decision, outcome, occurred_at, actor_staff_identity_id,
              operation_id, details, record_owner, record_classification,
              disposal_class)
           values ($1, $2, $3, $4, 'opened', 'pending', 'open', $5, $6, $7,
                   $8::jsonb, 'school', 'student_record',
                   'record_lifecycle_case_event')`,
          [
            request.caseEventId,
            request.caseId,
            request.workspaceId,
            request.studentId,
            request.occurredAt,
            request.staffIdentityId,
            request.operationId,
            JSON.stringify({
              caseType: request.caseType,
              requestCode: request.requestCode,
              scope: request.scope,
              policyRevisionId,
            }),
          ],
        );
        if (
          request.caseType === 'access' ||
          request.caseType === 'amendment' ||
          request.caseType === 'hold'
        ) {
          const source =
            request.caseType === 'access'
              ? 'automatic_access_case'
              : request.caseType === 'amendment'
                ? 'automatic_amendment_case'
                : 'hold_case';
          const reason =
            request.caseType === 'access'
              ? 'open_access_case'
              : request.caseType === 'amendment'
                ? 'open_amendment_case'
                : 'hold_case';
          await client.query(
            `insert into records_governance.record_holds
               (hold_id, workspace_id, student_id, source, reason, case_id,
                status, established_at, released_at, record_owner,
                record_classification, disposal_class)
             values ($1, $2, $3, $4, $5, $6, 'active', $7, null, 'school',
                     'student_record', 'record_hold')`,
            [
              request.holdId,
              request.workspaceId,
              request.studentId,
              source,
              reason,
              request.caseId,
              request.occurredAt,
            ],
          );
        }
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'openRecordLifecycleCase',
          result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'record_lifecycle_case.opened',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details: {
            studentId: request.studentId,
            caseId: request.caseId,
            caseType: request.caseType,
            requestCode: request.requestCode,
            policyRevisionId,
          },
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'record_lifecycle_case.opened',
          payload: {
            studentId: request.studentId,
            caseId: request.caseId,
            caseType: request.caseType,
          },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async decideCase(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'decideRecordLifecycleCase',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const current = await client.query<{
          student_id: string;
          outcome: string;
        }>(
          `select student_id, outcome
             from records_governance.record_lifecycle_cases
            where case_id = $1 and workspace_id = $2 for update`,
          [request.caseId, request.workspaceId],
        );
        const selected = current.rows[0];
        if (!selected) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        if (selected.outcome !== 'open') {
          await client.query('rollback');
          return { outcome: 'not_open' };
        }
        await client.query(
          `update records_governance.record_lifecycle_cases
              set decision = $2
            where case_id = $1`,
          [request.caseId, request.decision],
        );
        await client.query(
          `insert into records_governance.record_lifecycle_case_events
             (case_event_id, case_id, workspace_id, student_id, event_kind,
              decision, outcome, occurred_at, actor_staff_identity_id,
              operation_id, details, record_owner, record_classification,
              disposal_class)
           values ($1, $2, $3, $4, 'decided', $5, 'open', $6, $7, $8,
                   $9::jsonb, 'school', 'student_record',
                   'record_lifecycle_case_event')`,
          [
            request.caseEventId,
            request.caseId,
            request.workspaceId,
            selected.student_id,
            request.decision,
            request.occurredAt,
            request.staffIdentityId,
            request.operationId,
            JSON.stringify({ decision: request.decision }),
          ],
        );
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'decideRecordLifecycleCase',
          result: request.result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'record_lifecycle_case.decided',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details: {
            caseId: request.caseId,
            studentId: selected.student_id,
            decision: request.decision,
          },
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'record_lifecycle_case.decided',
          payload: {
            caseId: request.caseId,
            studentId: selected.student_id,
            decision: request.decision,
          },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result: request.result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async recordCaseOutcome(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'recordRecordLifecycleCaseOutcome',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const current = await client.query<{
          student_id: string;
          outcome: string;
          decision: string;
        }>(
          `select student_id, outcome, decision
             from records_governance.record_lifecycle_cases
            where case_id = $1 and workspace_id = $2 for update`,
          [request.caseId, request.workspaceId],
        );
        const selected = current.rows[0];
        if (!selected) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        if (selected.outcome !== 'open') {
          await client.query('rollback');
          return { outcome: 'not_open' };
        }
        if (selected.decision === 'pending') {
          await client.query('rollback');
          return { outcome: 'decision_required' };
        }
        await client.query(
          `update records_governance.record_lifecycle_cases
              set outcome = $2, closed_at = $3
            where case_id = $1`,
          [request.caseId, request.caseOutcome, request.occurredAt],
        );
        await client.query(
          `insert into records_governance.record_lifecycle_case_events
             (case_event_id, case_id, workspace_id, student_id, event_kind,
              decision, outcome, occurred_at, actor_staff_identity_id,
              operation_id, details, record_owner, record_classification,
              disposal_class)
           values ($1, $2, $3, $4, 'outcome_recorded', $5, $6, $7, $8, $9,
                   $10::jsonb, 'school', 'student_record',
                   'record_lifecycle_case_event')`,
          [
            request.caseEventId,
            request.caseId,
            request.workspaceId,
            selected.student_id,
            selected.decision,
            request.caseOutcome,
            request.occurredAt,
            request.staffIdentityId,
            request.operationId,
            JSON.stringify({ outcome: request.caseOutcome }),
          ],
        );
        await client.query(
          `update records_governance.record_holds
              set status = 'released', released_at = $3
            where case_id = $1
              and workspace_id = $2
              and status = 'active'
              and source in ('automatic_access_case', 'automatic_amendment_case',
                             'hold_case')`,
          [request.caseId, request.workspaceId, request.occurredAt],
        );
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'recordRecordLifecycleCaseOutcome',
          result: request.result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'record_lifecycle_case.outcome_recorded',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details: {
            caseId: request.caseId,
            studentId: selected.student_id,
            outcome: request.caseOutcome,
          },
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'record_lifecycle_case.outcome_recorded',
          payload: {
            caseId: request.caseId,
            studentId: selected.student_id,
            outcome: request.caseOutcome,
          },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result: request.result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async establishHold(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'establishRecordHold',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const student = await lockStudent(
          client,
          request.workspaceId,
          request.studentId,
        );
        if (!student) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        await setLocal(client, 'app.student_id', request.studentId);
        await ensurePolicyRevision(
          client,
          request.workspaceId,
          request.occurredAt,
        );
        await client.query(
          `insert into records_governance.record_holds
             (hold_id, workspace_id, student_id, source, reason, case_id,
              status, established_at, released_at, record_owner,
              record_classification, disposal_class)
           values ($1, $2, $3, 'manual', $4, null, 'active', $5, null, 'school',
                   'student_record', 'record_hold')`,
          [
            request.holdId,
            request.workspaceId,
            request.studentId,
            request.reason,
            request.occurredAt,
          ],
        );
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'establishRecordHold',
          result: request.result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'record_hold.established',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details: {
            studentId: request.studentId,
            holdId: request.holdId,
            reason: request.reason,
          },
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'record_hold.established',
          payload: {
            studentId: request.studentId,
            holdId: request.holdId,
          },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result: request.result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async releaseHold(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'releaseRecordHold',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const current = await client.query<{
          student_id: string;
          status: string;
          source: string;
        }>(
          `select student_id, status, source
             from records_governance.record_holds
            where hold_id = $1 and workspace_id = $2 for update`,
          [request.holdId, request.workspaceId],
        );
        const selected = current.rows[0];
        if (!selected) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        if (selected.status !== 'active') {
          await client.query('rollback');
          return { outcome: 'not_active' };
        }
        if (selected.source !== 'manual') {
          await client.query('rollback');
          return { outcome: 'not_releasable' };
        }
        await client.query(
          `update records_governance.record_holds
              set status = 'released', released_at = $2
            where hold_id = $1`,
          [request.holdId, request.occurredAt],
        );
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'releaseRecordHold',
          result: request.result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'record_hold.released',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details: {
            holdId: request.holdId,
            studentId: selected.student_id,
          },
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'record_hold.released',
          payload: {
            holdId: request.holdId,
            studentId: selected.student_id,
          },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result: request.result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async resolveAmendment(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'resolveRecordAmendment',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const existingReview = await client.query<{ review_id: string }>(
          `select review_id from records_governance.record_conflict_reviews
            where workspace_id = $1 and operation_id = $2`,
          [request.workspaceId, request.operationId],
        );
        if (existingReview.rows[0]) {
          await client.query('commit');
          return {
            outcome: 'conflict' as const,
            reviewId: existingReview.rows[0].review_id,
          };
        }
        const current = await client.query<{
          student_id: string;
          case_type: string;
          decision: string;
          outcome: string;
          authority_kind:
            'school_administrator' | 'school_nurse' | 'legal_custodian';
        }>(
          `select student_id, case_type, decision, outcome, authority_kind
             from records_governance.record_lifecycle_cases
            where case_id = $1 and workspace_id = $2 for update`,
          [request.caseId, request.workspaceId],
        );
        const selected = current.rows[0];
        if (!selected) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        if (selected.case_type !== 'amendment' || selected.outcome !== 'open') {
          await client.query('rollback');
          return { outcome: 'not_applicable' };
        }
        const expectedDecision =
          request.decision === 'correction_authorized'
            ? 'authorized'
            : 'denied';
        if (selected.decision !== expectedDecision) {
          await client.query('rollback');
          return { outcome: 'decision_mismatch' };
        }
        await setLocal(client, 'app.student_id', selected.student_id);
        if (
          request.relatedStudentId &&
          request.relatedStudentId !== selected.student_id
        ) {
          const related = await client.query<{ student_id: string }>(
            `select student_id from identity_access.students
              where student_id = $1 and workspace_id = $2 for update`,
            [request.relatedStudentId, request.workspaceId],
          );
          if (!related.rows[0]) {
            await client.query('rollback');
            return { outcome: 'not_found' };
          }
          await client.query(
            `insert into records_governance.record_conflict_reviews
               (review_id, workspace_id, conflict_kind, subject_student_id,
                conflicting_student_id, status, outcome, opened_at, resolved_at,
                actor_staff_identity_id, operation_id, record_owner,
                record_classification, disposal_class)
             values ($1, $2, $3, $4, $5, 'open', null, $6, null, $7, $8,
                     'school', 'student_record', 'record_conflict_review')`,
            [
              request.reviewId,
              request.workspaceId,
              request.challengedFactKind === 'intake_record_version'
                ? 'intake_record'
                : 'student_identity',
              selected.student_id,
              request.relatedStudentId,
              request.occurredAt,
              request.staffIdentityId,
              request.operationId,
            ],
          );
          await client.query(
            `insert into records_governance.record_conflict_review_events
               (review_event_id, review_id, workspace_id, event_kind, outcome,
                occurred_at, actor_staff_identity_id, operation_id, details,
                record_owner, record_classification, disposal_class)
             values ($1, $2, $3, 'opened', null, $4, $5, $6, $7::jsonb,
                     'school', 'student_record', 'record_conflict_review_event')`,
            [
              crypto.randomUUID(),
              request.reviewId,
              request.workspaceId,
              request.occurredAt,
              request.staffIdentityId,
              request.operationId,
              JSON.stringify({ caseId: request.caseId }),
            ],
          );
          await writeAudit(client, {
            auditId: request.auditId,
            workspaceId: request.workspaceId,
            operationId: request.operationId,
            eventType: 'record_conflict_review.opened',
            actorId: request.staffIdentityId,
            occurredAt: request.occurredAt,
            details: {
              reviewId: request.reviewId,
              caseId: request.caseId,
            },
          });
          await writeOutbox(client, {
            outboxId: request.outboxId,
            workspaceId: request.workspaceId,
            operationId: request.operationId,
            topic: 'record_conflict_review.opened',
            payload: { reviewId: request.reviewId, caseId: request.caseId },
            occurredAt: request.occurredAt,
          });
          await client.query('commit');
          return { outcome: 'conflict', reviewId: request.reviewId };
        }
        const sealed = request.sealSensitive(selected.student_id);
        await client.query(
          `insert into records_governance.record_amendments
             (amendment_id, case_id, workspace_id, student_id,
              challenged_fact_kind, challenged_fact_id, decision, reason_code,
              authority_kind, effective_correction, requester_statement_preserved,
              statement_wrapping_key_id, statement_wrapped_data_key,
              statement_ciphertext, correction_wrapping_key_id,
              correction_wrapped_data_key, correction_ciphertext, recorded_at,
              actor_staff_identity_id, operation_id, record_owner,
              record_classification, disposal_class)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13,
                   $14, $15, $16, $17, $18, $19, $20, 'school', 'student_record',
                   'record_amendment')`,
          [
            request.amendmentId,
            request.caseId,
            request.workspaceId,
            selected.student_id,
            request.challengedFactKind,
            request.challengedFactId,
            request.decision,
            request.reasonCode,
            selected.authority_kind,
            request.effectiveCorrection
              ? JSON.stringify(request.effectiveCorrection)
              : null,
            request.requesterStatementPreserved,
            sealed.statementSealed?.wrappingKeyId ?? null,
            sealed.statementSealed?.wrappedDataKey ?? null,
            sealed.statementSealed?.ciphertext ?? null,
            sealed.correctionSealed?.wrappingKeyId ?? null,
            sealed.correctionSealed?.wrappedDataKey ?? null,
            sealed.correctionSealed?.ciphertext ?? null,
            request.occurredAt,
            request.staffIdentityId,
            request.operationId,
          ],
        );
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'resolveRecordAmendment',
          result: request.result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'record_amendment.recorded',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details: {
            amendmentId: request.amendmentId,
            caseId: request.caseId,
            studentId: selected.student_id,
            decision: request.decision,
            reasonCode: request.reasonCode,
            challengedFactKind: request.challengedFactKind,
            requesterStatementPreserved: request.requesterStatementPreserved,
          },
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'record_amendment.recorded',
          payload: {
            amendmentId: request.amendmentId,
            caseId: request.caseId,
            studentId: selected.student_id,
            decision: request.decision,
          },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result: request.result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async openConflictReview(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'openRecordConflictReview',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const students = await client.query<{ student_id: string }>(
          `select student_id from identity_access.students
            where workspace_id = $1 and student_id in ($2, $3) for update`,
          [
            request.workspaceId,
            request.subjectStudentId,
            request.conflictingStudentId,
          ],
        );
        if (students.rows.length !== 2) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        await client.query(
          `insert into records_governance.record_conflict_reviews
             (review_id, workspace_id, conflict_kind, subject_student_id,
              conflicting_student_id, status, outcome, opened_at, resolved_at,
              actor_staff_identity_id, operation_id, record_owner,
              record_classification, disposal_class)
           values ($1, $2, $3, $4, $5, 'open', null, $6, null, $7, $8, 'school',
                   'student_record', 'record_conflict_review')`,
          [
            request.reviewId,
            request.workspaceId,
            request.conflictKind,
            request.subjectStudentId,
            request.conflictingStudentId,
            request.occurredAt,
            request.staffIdentityId,
            request.operationId,
          ],
        );
        await client.query(
          `insert into records_governance.record_conflict_review_events
             (review_event_id, review_id, workspace_id, event_kind, outcome,
              occurred_at, actor_staff_identity_id, operation_id, details,
              record_owner, record_classification, disposal_class)
           values ($1, $2, $3, 'opened', null, $4, $5, $6, $7::jsonb, 'school',
                   'student_record', 'record_conflict_review_event')`,
          [
            crypto.randomUUID(),
            request.reviewId,
            request.workspaceId,
            request.occurredAt,
            request.staffIdentityId,
            request.operationId,
            JSON.stringify({ conflictKind: request.conflictKind }),
          ],
        );
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'openRecordConflictReview',
          result: request.result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'record_conflict_review.opened',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details: {
            reviewId: request.reviewId,
            conflictKind: request.conflictKind,
          },
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'record_conflict_review.opened',
          payload: { reviewId: request.reviewId },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result: request.result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async decideConflictReview(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'decideRecordConflictReview',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const current = await client.query<{ status: string }>(
          `select status from records_governance.record_conflict_reviews
            where review_id = $1 and workspace_id = $2 for update`,
          [request.reviewId, request.workspaceId],
        );
        const selected = current.rows[0];
        if (!selected) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        if (selected.status !== 'open') {
          await client.query('rollback');
          return { outcome: 'not_open' };
        }
        await client.query(
          `update records_governance.record_conflict_reviews
              set status = 'resolved', outcome = $2, resolved_at = $3
            where review_id = $1`,
          [request.reviewId, request.reviewOutcome, request.occurredAt],
        );
        await client.query(
          `insert into records_governance.record_conflict_review_events
             (review_event_id, review_id, workspace_id, event_kind, outcome,
              occurred_at, actor_staff_identity_id, operation_id, details,
              record_owner, record_classification, disposal_class)
           values ($1, $2, $3, 'resolved', $4, $5, $6, $7, $8::jsonb, 'school',
                   'student_record', 'record_conflict_review_event')`,
          [
            crypto.randomUUID(),
            request.reviewId,
            request.workspaceId,
            request.reviewOutcome,
            request.occurredAt,
            request.staffIdentityId,
            request.operationId,
            JSON.stringify({ outcome: request.reviewOutcome }),
          ],
        );
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'decideRecordConflictReview',
          result: request.result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'record_conflict_review.resolved',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details: {
            reviewId: request.reviewId,
            outcome: request.reviewOutcome,
          },
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'record_conflict_review.resolved',
          payload: {
            reviewId: request.reviewId,
            outcome: request.reviewOutcome,
          },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result: request.result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async authorizeProduction(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'authorizeRecordProduction',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const current = await client.query<{
          student_id: string;
          case_type: string;
          decision: string;
          outcome: string;
          scope: RecordProductionMaterials extends never
            ? never
            : {
                portions: (
                  | 'identity'
                  | 'membership'
                  | 'intake'
                  | 'learning_progress'
                  | 'audit_evidence'
                  | 'complete_bundle'
                )[];
                purpose:
                  | 'lawful_access'
                  | 'amendment_challenge'
                  | 'transfer'
                  | 'disclosure'
                  | 'preservation'
                  | 'scheduled_destruction';
              };
        }>(
          `select student_id, case_type, decision, outcome, scope
             from records_governance.record_lifecycle_cases
            where case_id = $1 and workspace_id = $2 for update`,
          [request.caseId, request.workspaceId],
        );
        const selected = current.rows[0];
        if (!selected) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        if (
          selected.outcome !== 'open' ||
          selected.decision !== 'authorized' ||
          !['access', 'transfer', 'disclosure'].includes(selected.case_type)
        ) {
          await client.query('rollback');
          return { outcome: 'not_authorized' };
        }
        await setLocal(client, 'app.student_id', selected.student_id);
        await setLocal(client, 'app.record_production_case_id', request.caseId);
        const portions = authorizedProductionPortions(selected.scope);
        const materials = await loadProductionMaterials(client, {
          workspaceId: request.workspaceId,
          studentId: selected.student_id,
          portions,
          includeDraft: selected.scope.portions.includes('complete_bundle'),
        });
        const sealed = await request.buildPackage(materials);
        await client.query(
          `insert into records_governance.record_productions
             (production_id, workspace_id, student_id, case_id, status,
              cleanup_status, portions, purpose, recipient_digest,
              capability_digest, wrapping_key_id, wrapped_data_key, ciphertext,
              delivery_key_id, delivery_ciphertext, expires_at, authorized_at,
              actor_staff_identity_id, operation_id, record_owner,
              record_classification, disposal_class)
           values ($1, $2, $3, $4, 'pending_delivery', 'pending', $5::jsonb, $6,
                   $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'school',
                   'student_record', 'record_production')`,
          [
            request.productionId,
            request.workspaceId,
            selected.student_id,
            request.caseId,
            JSON.stringify(portions),
            selected.scope.purpose,
            request.recipientDigest,
            request.capabilityDigest,
            sealed.wrappingKeyId,
            sealed.wrappedDataKey,
            sealed.ciphertext,
            request.delivery.keyId,
            request.delivery.ciphertext,
            request.expiresAt,
            request.occurredAt,
            request.staffIdentityId,
            request.operationId,
          ],
        );
        await client.query(
          `insert into records_governance.record_production_events
             (production_event_id, production_id, workspace_id, student_id,
              event_kind, occurred_at, actor_staff_identity_id, operation_id,
              details, record_owner, record_classification, disposal_class)
           values ($1, $2, $3, $4, 'authorized', $5, $6, $7, $8::jsonb, 'school',
                   'student_record', 'record_production_event')`,
          [
            crypto.randomUUID(),
            request.productionId,
            request.workspaceId,
            selected.student_id,
            request.occurredAt,
            request.staffIdentityId,
            request.operationId,
            JSON.stringify({ portions, purpose: selected.scope.purpose }),
          ],
        );
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'authorizeRecordProduction',
          result: request.result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'record_production.authorized',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details: {
            productionId: request.productionId,
            caseId: request.caseId,
            studentId: selected.student_id,
            portions,
            purpose: selected.scope.purpose,
          },
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'record_production.delivery_requested',
          payload: { productionId: request.productionId },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result: request.result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async retrieveProduction(request) {
      const client = await options.pool.connect();
      try {
        await client.query('begin');
        await setLocal(
          client,
          'app.record_production_capability_digest',
          request.capabilityDigest,
        );
        const current = await client.query<{
          production_id: string;
          workspace_id: string;
          student_id: string;
          status: string;
          cleanup_status: string;
          portions: unknown;
          purpose:
            | 'lawful_access'
            | 'amendment_challenge'
            | 'transfer'
            | 'disclosure'
            | 'preservation'
            | 'scheduled_destruction';
          wrapping_key_id: string | null;
          wrapped_data_key: string | null;
          ciphertext: string | null;
          expires_at: Date;
        }>(
          `select production_id, workspace_id, student_id, status, cleanup_status,
                  portions, purpose, wrapping_key_id, wrapped_data_key, ciphertext,
                  expires_at
             from records_governance.record_productions
            where capability_digest = $1
            for update`,
          [request.capabilityDigest],
        );
        const selected = current.rows[0];
        if (!selected) {
          await client.query('rollback');
          return { outcome: 'unavailable' };
        }
        await setLocal(client, 'app.workspace_id', selected.workspace_id);
        const expired =
          selected.expires_at.getTime() <= request.occurredAt.getTime();
        if (
          expired ||
          selected.status === 'retrieved' ||
          selected.status === 'expired' ||
          selected.ciphertext === null
        ) {
          if (selected.ciphertext !== null) {
            try {
              await clearProductionArtifacts(client, {
                productionId: selected.production_id,
                workspaceId: selected.workspace_id,
                studentId: selected.student_id,
                occurredAt: request.occurredAt,
                operationId: request.auditId,
                status: 'expired',
                eventKind: 'expired',
              });
            } catch {
              await client.query('rollback');
              return { outcome: 'cleanup_failed' };
            }
          }
          await writeAudit(client, {
            auditId: request.auditId,
            workspaceId: selected.workspace_id,
            operationId: request.auditId,
            eventType: 'record_production.unavailable',
            actorId: 'record-production-recipient',
            occurredAt: request.occurredAt,
            details: { productionId: selected.production_id },
            actorType: 'recipient',
          });
          await client.query('commit');
          return { outcome: 'unavailable' };
        }
        const pack = await request.openPackage({
          sealed: {
            wrappingKeyId: selected.wrapping_key_id!,
            wrappedDataKey: selected.wrapped_data_key!,
            ciphertext: selected.ciphertext,
          },
          workspaceId: selected.workspace_id,
          studentId: selected.student_id,
        });
        try {
          await clearProductionArtifacts(client, {
            productionId: selected.production_id,
            workspaceId: selected.workspace_id,
            studentId: selected.student_id,
            occurredAt: request.occurredAt,
            operationId: request.auditId,
            status: 'retrieved',
            eventKind: 'retrieved',
          });
        } catch {
          await client.query('rollback');
          return { outcome: 'cleanup_failed' };
        }
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: selected.workspace_id,
          operationId: request.auditId,
          eventType: 'record_production.retrieved',
          actorId: 'record-production-recipient',
          occurredAt: request.occurredAt,
          details: { productionId: selected.production_id },
          actorType: 'recipient',
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: selected.workspace_id,
          operationId: request.auditId,
          topic: 'record_production.retrieved',
          payload: { productionId: selected.production_id },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return {
          outcome: 'retrieved',
          result: {
            productionId: selected.production_id,
            purpose: selected.purpose,
            portions: parseJsonArray<
              | 'identity'
              | 'membership'
              | 'intake'
              | 'learning_progress'
              | 'audit_evidence'
              | 'complete_bundle'
            >(selected.portions),
            package: pack,
          },
        };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async repairProductionCleanup(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'repairRecordProductionCleanup',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const current = await client.query<{
          student_id: string;
          cleanup_status: string;
          ciphertext: string | null;
        }>(
          `select student_id, cleanup_status, ciphertext
             from records_governance.record_productions
            where production_id = $1 and workspace_id = $2 for update`,
          [request.productionId, request.workspaceId],
        );
        const selected = current.rows[0];
        if (!selected) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        let outcome: 'removed' | 'failed' = 'removed';
        if (
          selected.ciphertext !== null ||
          selected.cleanup_status !== 'removed'
        ) {
          try {
            await clearProductionArtifacts(client, {
              productionId: request.productionId,
              workspaceId: request.workspaceId,
              studentId: selected.student_id,
              occurredAt: request.occurredAt,
              operationId: request.operationId,
              status: 'expired',
              eventKind: 'removed',
            });
          } catch {
            await client.query(
              `update records_governance.record_productions
                  set cleanup_status = 'failed'
                where production_id = $1`,
              [request.productionId],
            );
            outcome = 'failed';
          }
        }
        const result = { ...request.result, outcome };
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'repairRecordProductionCleanup',
          result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType:
            outcome === 'removed'
              ? 'record_production.removed'
              : 'record_production.cleanup_failed',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details: { productionId: request.productionId, outcome },
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic:
            outcome === 'removed'
              ? 'record_production.removed'
              : 'record_production.cleanup_failed',
          payload: { productionId: request.productionId, outcome },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async completeNotice(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'completeRecordDispositionNotice',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const student = await lockStudent(
          client,
          request.workspaceId,
          request.studentId,
        );
        if (!student) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        const already = await client.query<{ notice_id: string }>(
          `select notice_id from records_governance.record_disposition_notices
            where workspace_id = $1 and student_id = $2`,
          [request.workspaceId, request.studentId],
        );
        const noticeId = already.rows[0]?.notice_id ?? request.noticeId;
        if (!already.rows[0]) {
          await client.query(
            `insert into records_governance.record_disposition_notices
               (notice_id, workspace_id, student_id, completed_at,
                actor_staff_identity_id, operation_id, record_owner,
                record_classification, disposal_class)
             values ($1, $2, $3, $4, $5, $6, 'school', 'student_record',
                     'record_disposition_notice')`,
            [
              noticeId,
              request.workspaceId,
              request.studentId,
              request.occurredAt,
              request.staffIdentityId,
              request.operationId,
            ],
          );
        }
        const result = { ...request.result, noticeId };
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'completeRecordDispositionNotice',
          result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'record_disposition.notice_completed',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details: { studentId: request.studentId, noticeId },
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'record_disposition.notice_completed',
          payload: { studentId: request.studentId, noticeId },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async completeCopyOpportunity(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'completeRecordDispositionCopyOpportunity',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const student = await lockStudent(
          client,
          request.workspaceId,
          request.studentId,
        );
        if (!student) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        const already = await client.query<{ copy_opportunity_id: string }>(
          `select copy_opportunity_id
             from records_governance.record_disposition_copy_opportunities
            where workspace_id = $1 and student_id = $2`,
          [request.workspaceId, request.studentId],
        );
        const copyOpportunityId =
          already.rows[0]?.copy_opportunity_id ?? request.copyOpportunityId;
        if (!already.rows[0]) {
          await client.query(
            `insert into records_governance.record_disposition_copy_opportunities
               (copy_opportunity_id, workspace_id, student_id, completed_at,
                actor_staff_identity_id, operation_id, record_owner,
                record_classification, disposal_class)
             values ($1, $2, $3, $4, $5, $6, 'school', 'student_record',
                     'record_disposition_copy_opportunity')`,
            [
              copyOpportunityId,
              request.workspaceId,
              request.studentId,
              request.occurredAt,
              request.staffIdentityId,
              request.operationId,
            ],
          );
        }
        const result = { ...request.result, copyOpportunityId };
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'completeRecordDispositionCopyOpportunity',
          result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'record_disposition.copy_opportunity_completed',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details: { studentId: request.studentId, copyOpportunityId },
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'record_disposition.copy_opportunity_completed',
          payload: { studentId: request.studentId, copyOpportunityId },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async scheduleDisposition(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'scheduleRecordDisposition',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const student = await lockStudent(
          client,
          request.workspaceId,
          request.studentId,
        );
        if (!student) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        const prerequisites = await evaluateDispositionPrerequisites(
          client,
          request.workspaceId,
          request.studentId,
          request.caseId,
        );
        if (prerequisites.blockingReasons.length > 0) {
          await client.query('rollback');
          return {
            outcome: 'not_schedulable',
            blockingReasons: prerequisites.blockingReasons,
          };
        }
        const cancellationDeadlineAt = new Date(
          request.occurredAt.getTime() + recordDispositionCancellationWindowMs,
        );
        const result = {
          ...request.result,
          cancellationDeadlineAt: cancellationDeadlineAt.toISOString(),
        };
        await client.query(
          `insert into records_governance.record_dispositions
             (disposition_id, workspace_id, student_id, case_id,
              policy_revision_id, status, version, scheduled_at,
              cancellation_deadline_at, authority_kind, notice_id,
              copy_opportunity_id, actor_staff_identity_id, operation_id,
              record_owner, record_classification, disposal_class)
           values ($1, $2, $3, $4, $5, 'scheduled', 1, $6, $7, $8, $9, $10, $11,
                   $12, 'school', 'student_record', 'record_disposition')`,
          [
            request.dispositionId,
            request.workspaceId,
            request.studentId,
            request.caseId,
            prerequisites.policyRevisionId,
            request.occurredAt,
            cancellationDeadlineAt,
            prerequisites.authorityKind,
            prerequisites.noticeId,
            prerequisites.copyOpportunityId,
            request.staffIdentityId,
            request.operationId,
          ],
        );
        await insertDispositionEvent(client, {
          dispositionId: request.dispositionId,
          workspaceId: request.workspaceId,
          studentId: request.studentId,
          eventKind: 'scheduled',
          occurredAt: request.occurredAt,
          actorStaffIdentityId: request.staffIdentityId,
          operationId: request.operationId,
          details: {
            caseId: request.caseId,
            policyRevisionId: prerequisites.policyRevisionId,
          },
        });
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'scheduleRecordDisposition',
          result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'record_disposition.scheduled',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details: {
            studentId: request.studentId,
            dispositionId: request.dispositionId,
            caseId: request.caseId,
          },
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'record_disposition.scheduled',
          payload: {
            studentId: request.studentId,
            dispositionId: request.dispositionId,
          },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async cancelDisposition(request) {
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
        const existing = await readReceipt<typeof request.result>(
          client,
          request.workspaceId,
          request.operationId,
          'cancelRecordDisposition',
        );
        if (existing) {
          await client.query('commit');
          return { outcome: 'replayed' as const, result: existing };
        }
        const locked = await lockDisposition(
          client,
          request.workspaceId,
          request.dispositionId,
        );
        if (!locked) {
          await client.query('rollback');
          return { outcome: 'not_found' };
        }
        if (locked.version !== request.expectedVersion) {
          await client.query('rollback');
          return { outcome: 'version_conflict' };
        }
        if (
          locked.status !== 'scheduled' ||
          locked.cancellationDeadlineAt.getTime() <=
            request.occurredAt.getTime()
        ) {
          await client.query('rollback');
          return { outcome: 'not_cancellable' };
        }
        await client.query(
          `update records_governance.record_dispositions
              set status = 'cancelled', cancelled_at = $2, version = version + 1
            where disposition_id = $1`,
          [request.dispositionId, request.occurredAt],
        );
        await insertDispositionEvent(client, {
          dispositionId: request.dispositionId,
          workspaceId: request.workspaceId,
          studentId: locked.studentId,
          eventKind: 'cancelled',
          occurredAt: request.occurredAt,
          actorStaffIdentityId: request.staffIdentityId,
          operationId: request.operationId,
          details: {},
        });
        await writeReceipt(client, {
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          commandName: 'cancelRecordDisposition',
          result: request.result,
          occurredAt: request.occurredAt,
        });
        await writeAudit(client, {
          auditId: request.auditId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          eventType: 'record_disposition.cancelled',
          actorId: request.staffIdentityId,
          occurredAt: request.occurredAt,
          details: { dispositionId: request.dispositionId },
        });
        await writeOutbox(client, {
          outboxId: request.outboxId,
          workspaceId: request.workspaceId,
          operationId: request.operationId,
          topic: 'record_disposition.cancelled',
          payload: { dispositionId: request.dispositionId },
          occurredAt: request.occurredAt,
        });
        await client.query('commit');
        return { outcome: 'applied', result: request.result };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async executeDisposition(request) {
      const executed = await runDispositionPurge(options.pool, {
        ...request,
        commandName: 'executeRecordDisposition',
        startFrom: 'scheduled',
      });
      if (executed.outcome === 'not_repairable') {
        return { outcome: 'not_executable' };
      }
      return executed;
    },

    async retryDisposition(request) {
      const retried = await runDispositionPurge(options.pool, {
        ...request,
        commandName: 'retryRecordDisposition',
        startFrom: 'failed',
      });
      if (
        retried.outcome === 'window_open' ||
        retried.outcome === 'not_executable'
      ) {
        return { outcome: 'not_repairable' };
      }
      return retried;
    },

    async list(request) {
      const client = await options.pool.connect();
      try {
        await client.query('begin');
        await setLocal(client, 'app.workspace_id', request.workspaceId);
        await setLocal(
          client,
          'app.staff_identity_id',
          request.staffIdentityId,
        );
        const policyRevisionId = await ensurePolicyRevision(
          client,
          request.workspaceId,
          new Date(),
        );
        const students = await client.query<{
          student_id: string;
          presence: 'enrolled' | 'departed';
          status: 'active' | 'disabled';
          departure_reason: 'transferred' | 'graduated' | 'withdrew' | null;
          departure_effective_on: string | null;
          departure_recorded_at: Date | null;
          cases: unknown;
          holds: unknown;
          amendments: unknown;
          conflict_reviews: unknown;
          productions: unknown;
          dispositions: unknown;
          notice_completed: boolean;
          copy_opportunity_completed: boolean;
          has_structured_authority: boolean;
          open_lifecycle_case: boolean;
          active_hold_count: string;
        }>(
          `select student.student_id, student.presence, student.status,
                  departure.reason as departure_reason,
                  to_char(departure.effective_on, 'YYYY-MM-DD') as departure_effective_on,
                  departure.occurred_at as departure_recorded_at,
                  coalesce((
                    select json_agg(json_build_object(
                      'caseId', lifecycle.case_id,
                      'caseType', lifecycle.case_type,
                      'requestCode', lifecycle.request_code,
                      'requesterKind', lifecycle.requester_kind,
                      'authorityKind', lifecycle.authority_kind,
                      'scope', lifecycle.scope,
                      'deadlineAt', to_char(lifecycle.deadline_at at time zone 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                      'decision', lifecycle.decision,
                      'outcome', lifecycle.outcome,
                      'policyRevisionId', lifecycle.policy_revision_id,
                      'openedAt', to_char(lifecycle.opened_at at time zone 'UTC',
                                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                      'closedAt', case when lifecycle.closed_at is null then null
                        else to_char(lifecycle.closed_at at time zone 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
                    ) order by lifecycle.opened_at, lifecycle.case_id)
                      from records_governance.record_lifecycle_cases lifecycle
                     where lifecycle.student_id = student.student_id
                       and lifecycle.workspace_id = student.workspace_id
                  ), '[]'::json) as cases,
                  coalesce((
                    select json_agg(json_build_object(
                      'holdId', hold.hold_id,
                      'source', hold.source,
                      'reason', hold.reason,
                      'status', hold.status,
                      'caseId', hold.case_id,
                      'establishedAt', to_char(hold.established_at at time zone 'UTC',
                                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                      'releasedAt', case when hold.released_at is null then null
                        else to_char(hold.released_at at time zone 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
                    ) order by hold.established_at, hold.hold_id)
                      from records_governance.record_holds hold
                     where hold.student_id = student.student_id
                       and hold.workspace_id = student.workspace_id
                  ), '[]'::json) as holds,
                  coalesce((
                    select json_agg(json_build_object(
                      'amendmentId', amendment.amendment_id,
                      'caseId', amendment.case_id,
                      'challengedFactKind', amendment.challenged_fact_kind,
                      'challengedFactId', amendment.challenged_fact_id,
                      'decision', amendment.decision,
                      'reasonCode', amendment.reason_code,
                      'authorityKind', amendment.authority_kind,
                      'effectiveCorrection', amendment.effective_correction,
                      'requesterStatementPreserved',
                        amendment.requester_statement_preserved,
                      'recordedAt', to_char(amendment.recorded_at at time zone 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                    ) order by amendment.recorded_at, amendment.amendment_id)
                      from records_governance.record_amendments amendment
                     where amendment.student_id = student.student_id
                       and amendment.workspace_id = student.workspace_id
                  ), '[]'::json) as amendments,
                  coalesce((
                    select json_agg(json_build_object(
                      'reviewId', review.review_id,
                      'conflictKind', review.conflict_kind,
                      'subjectStudentId', review.subject_student_id,
                      'conflictingStudentId', review.conflicting_student_id,
                      'status', review.status,
                      'outcome', review.outcome,
                      'openedAt', to_char(review.opened_at at time zone 'UTC',
                                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                      'resolvedAt', case when review.resolved_at is null then null
                        else to_char(review.resolved_at at time zone 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
                    ) order by review.opened_at, review.review_id)
                      from records_governance.record_conflict_reviews review
                     where review.workspace_id = student.workspace_id
                       and student.student_id in (
                         review.subject_student_id, review.conflicting_student_id
                       )
                  ), '[]'::json) as conflict_reviews,
                  coalesce((
                    select json_agg(json_build_object(
                      'productionId', production.production_id,
                      'caseId', production.case_id,
                      'status', production.status,
                      'cleanupStatus', production.cleanup_status,
                      'portions', production.portions,
                      'purpose', production.purpose,
                      'expiresAt', to_char(production.expires_at at time zone 'UTC',
                                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                      'deliveredAt', case when production.delivered_at is null then null
                        else to_char(production.delivered_at at time zone 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
                      'retrievedAt', case when production.retrieved_at is null then null
                        else to_char(production.retrieved_at at time zone 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
                      'removedAt', case when production.removed_at is null then null
                        else to_char(production.removed_at at time zone 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
                    ) order by production.authorized_at, production.production_id)
                      from records_governance.record_productions production
                     where production.student_id = student.student_id
                       and production.workspace_id = student.workspace_id
                  ), '[]'::json) as productions,
                  coalesce((
                    select json_agg(json_build_object(
                      'dispositionId', disposition.disposition_id,
                      'caseId', disposition.case_id,
                      'status', disposition.status,
                      'version', disposition.version,
                      'scheduledAt', to_char(disposition.scheduled_at at time zone 'UTC',
                                             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                      'cancellationDeadlineAt', to_char(
                        disposition.cancellation_deadline_at at time zone 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                      'cancelledAt', case when disposition.cancelled_at is null then null
                        else to_char(disposition.cancelled_at at time zone 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
                      'executionStartedAt', case when disposition.execution_started_at is null then null
                        else to_char(disposition.execution_started_at at time zone 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
                      'completedAt', case when disposition.completed_at is null then null
                        else to_char(disposition.completed_at at time zone 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
                      'policyRevisionId', disposition.policy_revision_id,
                      'purgeManifest', coalesce((
                        select json_agg(json_build_object(
                          'location', task.location,
                          'adapter', task.adapter,
                          'status', task.status,
                          'count', task.purged_count,
                          'verification', task.verification
                        ) order by task.adapter)
                          from records_governance.record_disposition_tasks task
                         where task.disposition_id = disposition.disposition_id
                      ), '[]'::json)
                    ) order by disposition.scheduled_at, disposition.disposition_id)
                      from records_governance.record_dispositions disposition
                     where disposition.student_id = student.student_id
                       and disposition.workspace_id = student.workspace_id
                  ), '[]'::json) as dispositions,
                  exists (
                    select 1 from records_governance.record_disposition_notices notice
                     where notice.student_id = student.student_id
                       and notice.workspace_id = student.workspace_id
                  ) as notice_completed,
                  exists (
                    select 1 from records_governance.record_disposition_copy_opportunities copy
                     where copy.student_id = student.student_id
                       and copy.workspace_id = student.workspace_id
                  ) as copy_opportunity_completed,
                  exists (
                    select 1 from records_governance.record_lifecycle_cases lifecycle
                     where lifecycle.student_id = student.student_id
                       and lifecycle.workspace_id = student.workspace_id
                       and lifecycle.case_type = 'disposition'
                       and lifecycle.decision = 'authorized'
                       and lifecycle.outcome = 'open'
                  ) as has_structured_authority,
                  exists (
                    select 1 from records_governance.record_lifecycle_cases lifecycle
                     where lifecycle.student_id = student.student_id
                       and lifecycle.workspace_id = student.workspace_id
                       and lifecycle.outcome = 'open'
                       and lifecycle.case_type <> 'disposition'
                  ) as open_lifecycle_case,
                  (select count(*) from records_governance.record_holds hold
                    where hold.student_id = student.student_id
                      and hold.workspace_id = student.workspace_id
                      and hold.status = 'active')::text as active_hold_count
             from identity_access.students student
             left join lateral (
               select fact.reason, fact.effective_on, fact.occurred_at
                 from records_governance.student_departure_facts fact
                where fact.student_id = student.student_id
                  and fact.workspace_id = student.workspace_id
                  and fact.kind = 'departed'
                order by fact.occurred_at desc, fact.departure_fact_id desc
                limit 1
             ) departure on student.presence = 'departed'
            where student.workspace_id = $1
            order by student.created_at, student.student_id`,
          [request.workspaceId],
        );
        await client.query('commit');
        const directory: RecordsGovernanceDirectory = {
          students: students.rows.map((row) => {
            const cases = parseJsonArray<RecordLifecycleCaseView>(row.cases);
            const holds = parseJsonArray<RecordHoldView>(row.holds);
            const amendments = parseJsonArray<RecordAmendmentView>(
              row.amendments,
            );
            const conflictReviews = parseJsonArray<RecordConflictReviewView>(
              row.conflict_reviews,
            );
            const productions = parseJsonArray<RecordProductionView>(
              row.productions,
            );
            const dispositions = parseJsonArray<RecordDispositionView>(
              row.dispositions,
            );
            const activeHolds = Number(row.active_hold_count);
            const dispositionPrerequisites = dispositionPrerequisitesFrom({
              hasPolicy: true,
              presence: row.presence,
              openHold: activeHolds > 0,
              noticeCompleted: row.notice_completed,
              copyOpportunityCompleted: row.copy_opportunity_completed,
              hasStructuredAuthority: row.has_structured_authority,
              openLifecycleCase: row.open_lifecycle_case,
            });
            const destructionEligibility: DestructionEligibility =
              activeHolds > 0
                ? 'blocked_by_hold'
                : row.presence === 'departed'
                  ? 'eligible_after_departure'
                  : 'not_eligible';
            const view: StudentRecordsGovernanceView = {
              studentId: row.student_id,
              presence: row.presence,
              accessStatus: row.status,
              departure:
                row.presence === 'departed' &&
                row.departure_reason &&
                row.departure_effective_on &&
                row.departure_recorded_at
                  ? {
                      reason: row.departure_reason,
                      effectiveOn: dateOnly(row.departure_effective_on),
                      recordedAt: row.departure_recorded_at.toISOString(),
                    }
                  : null,
              cases,
              holds,
              amendments,
              conflictReviews,
              productions,
              dispositions,
              dispositionPrerequisites,
              destructionEligibility,
              policyRevisionId,
            };
            return view;
          }),
        };
        return directory;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function loadProductionMaterials(
  client: PoolClient,
  input: {
    workspaceId: string;
    studentId: string;
    portions: (
      | 'identity'
      | 'membership'
      | 'intake'
      | 'learning_progress'
      | 'audit_evidence'
      | 'complete_bundle'
    )[];
    includeDraft?: boolean;
  },
): Promise<RecordProductionMaterials> {
  const materials: RecordProductionMaterials = { studentId: input.studentId };
  const include = new Set(input.portions);
  const student = await client.query<{
    presence: 'enrolled' | 'departed';
    status: 'active' | 'disabled';
  }>(
    `select presence, status from identity_access.students
      where student_id = $1 and workspace_id = $2`,
    [input.studentId, input.workspaceId],
  );
  const selected = student.rows[0];
  if (include.has('identity') && selected) {
    const emails = await client.query<{
      status: 'current' | 'historical';
      key_id: string;
      ciphertext: string;
    }>(
      `select status, key_id, ciphertext
         from identity_access.verified_email_addresses
        where student_id = $1 and workspace_id = $2
        order by verified_at, verified_email_address_id`,
      [input.studentId, input.workspaceId],
    );
    materials.identity = {
      studentId: input.studentId,
      presence: selected.presence,
      accessStatus: selected.status,
      emails: emails.rows.map((row) => ({
        status: row.status,
        keyId: row.key_id,
        ciphertext: row.ciphertext,
      })),
    };
  }
  if (include.has('membership')) {
    const memberships = await client.query<{
      class_id: string;
      status: 'active' | 'inactive';
      activated_at: Date;
    }>(
      `select class_id, status, activated_at
         from identity_access.class_memberships
        where student_id = $1 and workspace_id = $2
        order by activated_at, class_membership_id`,
      [input.studentId, input.workspaceId],
    );
    materials.membership = memberships.rows.map((row) => ({
      classId: row.class_id,
      status: row.status,
      activatedAt: row.activated_at.toISOString(),
    }));
  }
  if (include.has('intake')) {
    const versions = await client.query<{
      intake_record_version_id: string;
      version_number: number;
      accepted_at: Date;
      superseded_at: Date | null;
      wrapping_key_id: string;
      wrapped_data_key: string;
      ciphertext: string;
    }>(
      `select intake_record_version_id, version_number, accepted_at, superseded_at,
              wrapping_key_id, wrapped_data_key, ciphertext
         from intake.intake_record_versions
        where student_id = $1 and workspace_id = $2
        order by version_number`,
      [input.studentId, input.workspaceId],
    );
    materials.intake = {
      versions: versions.rows.map((row) => ({
        intakeRecordVersionId: row.intake_record_version_id,
        versionNumber: row.version_number,
        acceptedAt: row.accepted_at.toISOString(),
        supersededAt: row.superseded_at?.toISOString() ?? null,
        wrappingKeyId: row.wrapping_key_id,
        wrappedDataKey: row.wrapped_data_key,
        ciphertext: row.ciphertext,
      })),
      draft: null,
    };
  }
  if (input.includeDraft) {
    const draft = await client.query<{
      wrapping_key_id: string;
      wrapped_data_key: string;
      ciphertext: string;
      updated_at: Date;
    }>(
      `select wrapping_key_id, wrapped_data_key, ciphertext, updated_at
         from intake.intake_drafts
        where student_id = $1 and workspace_id = $2`,
      [input.studentId, input.workspaceId],
    );
    const row = draft.rows[0];
    if (!materials.intake) {
      materials.intake = { versions: [], draft: null };
    }
    if (row) {
      materials.intake.draft = {
        wrappingKeyId: row.wrapping_key_id,
        wrappedDataKey: row.wrapped_data_key,
        ciphertext: row.ciphertext,
        updatedAt: row.updated_at.toISOString(),
      };
    }
  }
  if (include.has('learning_progress')) {
    const completions = await client.query<{
      item_id: string;
      item_revision_number: number;
      completed_at: Date;
    }>(
      `select item_id, item_revision_number, completed_at
         from learning_progress.item_completions
        where student_id = $1 and workspace_id = $2
        order by completed_at, item_completion_id`,
      [input.studentId, input.workspaceId],
    );
    materials.learningProgress = completions.rows.map((row) => ({
      itemId: row.item_id,
      itemRevisionNumber: row.item_revision_number,
      completedAt: row.completed_at.toISOString(),
    }));
  }
  if (include.has('audit_evidence')) {
    const evidence = await client.query<{
      occurred_at: Date;
      actor_type: string;
      event_type: string;
    }>(
      `select occurred_at, actor_type, event_type
         from audit.evidence
        where workspace_id = $1
          and details->>'studentId' = $2
        order by occurred_at, audit_id
        limit 100`,
      [input.workspaceId, input.studentId],
    );
    materials.auditEvidence = evidence.rows.map((row) => ({
      occurredAt: row.occurred_at.toISOString(),
      actorType: row.actor_type,
      eventType: row.event_type,
    }));
  }
  return materials;
}

async function clearProductionArtifacts(
  client: PoolClient,
  input: {
    productionId: string;
    workspaceId: string;
    studentId: string;
    occurredAt: Date;
    operationId: string;
    status: 'retrieved' | 'expired';
    eventKind: 'retrieved' | 'expired' | 'removed';
  },
) {
  await client.query(
    `update records_governance.record_productions
        set wrapping_key_id = null,
            wrapped_data_key = null,
            ciphertext = null,
            delivery_key_id = null,
            delivery_ciphertext = null,
            status = $2,
            cleanup_status = 'removed',
            retrieved_at = case when $2 = 'retrieved' then $3 else retrieved_at end,
            removed_at = $3
      where production_id = $1`,
    [input.productionId, input.status, input.occurredAt],
  );
  await client.query(
    `insert into records_governance.record_production_events
       (production_event_id, production_id, workspace_id, student_id, event_kind,
        occurred_at, actor_staff_identity_id, operation_id, details, record_owner,
        record_classification, disposal_class)
     values ($1, $2, $3, $4, $5, $6, null, $7, $8::jsonb, 'school',
             'student_record', 'record_production_event')`,
    [
      crypto.randomUUID(),
      input.productionId,
      input.workspaceId,
      input.studentId,
      input.eventKind,
      input.occurredAt,
      input.operationId,
      JSON.stringify({ cleanup: 'removed' }),
    ],
  );
}

function parseJsonArray<T>(value: unknown): T[] {
  const parsed =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function dateOnly(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function dispositionPrerequisitesFrom(input: {
  hasPolicy: boolean;
  presence: 'enrolled' | 'departed';
  openHold: boolean;
  noticeCompleted: boolean;
  copyOpportunityCompleted: boolean;
  hasStructuredAuthority: boolean;
  openLifecycleCase: boolean;
}): RecordDispositionPrerequisites {
  const blockingReasons: RecordDispositionBlockingReason[] = [];
  if (!input.hasPolicy) blockingReasons.push('missing_policy');
  if (input.presence !== 'departed') {
    blockingReasons.push('missing_student_departure');
  }
  if (input.openHold) blockingReasons.push('open_hold');
  if (!input.noticeCompleted) blockingReasons.push('incomplete_notice');
  if (!input.copyOpportunityCompleted) {
    blockingReasons.push('incomplete_copy_opportunity');
  }
  if (!input.hasStructuredAuthority) {
    blockingReasons.push('missing_structured_authority');
  }
  if (input.openLifecycleCase) blockingReasons.push('open_lifecycle_case');
  return {
    blockingReasons,
    noticeCompleted: input.noticeCompleted,
    copyOpportunityCompleted: input.copyOpportunityCompleted,
    hasPolicy: input.hasPolicy,
    hasQualifyingDeparture: input.presence === 'departed',
    hasStructuredAuthority: input.hasStructuredAuthority,
    openHold: input.openHold,
    openLifecycleCase: input.openLifecycleCase,
  };
}

async function evaluateDispositionPrerequisites(
  client: PoolClient,
  workspaceId: string,
  studentId: string,
  caseId: string,
): Promise<{
  blockingReasons: RecordDispositionBlockingReason[];
  policyRevisionId?: string;
  noticeId?: string;
  copyOpportunityId?: string;
  authorityKind?: string;
}> {
  const student = await client.query<{ presence: 'enrolled' | 'departed' }>(
    `select presence from identity_access.students
      where student_id = $1 and workspace_id = $2`,
    [studentId, workspaceId],
  );
  const policy = await client.query<{ policy_revision_id: string }>(
    `select policy_revision_id from records_governance.records_policy_revisions
      where workspace_id = $1
      order by revision_number desc limit 1`,
    [workspaceId],
  );
  const holds = await client.query<{ count: string }>(
    `select count(*)::text as count from records_governance.record_holds
      where student_id = $1 and workspace_id = $2 and status = 'active'`,
    [studentId, workspaceId],
  );
  const notice = await client.query<{ notice_id: string }>(
    `select notice_id from records_governance.record_disposition_notices
      where student_id = $1 and workspace_id = $2`,
    [studentId, workspaceId],
  );
  const copy = await client.query<{ copy_opportunity_id: string }>(
    `select copy_opportunity_id
       from records_governance.record_disposition_copy_opportunities
      where student_id = $1 and workspace_id = $2`,
    [studentId, workspaceId],
  );
  const authority = await client.query<{ authority_kind: string }>(
    `select authority_kind from records_governance.record_lifecycle_cases
      where case_id = $1 and workspace_id = $2 and student_id = $3
        and case_type = 'disposition' and decision = 'authorized'
        and outcome = 'open'`,
    [caseId, workspaceId, studentId],
  );
  const openCases = await client.query<{ count: string }>(
    `select count(*)::text as count from records_governance.record_lifecycle_cases
      where student_id = $1 and workspace_id = $2 and outcome = 'open'
        and case_type <> 'disposition'`,
    [studentId, workspaceId],
  );
  const prerequisites = dispositionPrerequisitesFrom({
    hasPolicy: Boolean(policy.rows[0]),
    presence: student.rows[0]?.presence ?? 'enrolled',
    openHold: Number(holds.rows[0]?.count ?? '0') > 0,
    noticeCompleted: Boolean(notice.rows[0]),
    copyOpportunityCompleted: Boolean(copy.rows[0]),
    hasStructuredAuthority: Boolean(authority.rows[0]),
    openLifecycleCase: Number(openCases.rows[0]?.count ?? '0') > 0,
  });
  return {
    blockingReasons: prerequisites.blockingReasons,
    policyRevisionId: policy.rows[0]?.policy_revision_id,
    noticeId: notice.rows[0]?.notice_id,
    copyOpportunityId: copy.rows[0]?.copy_opportunity_id,
    authorityKind: authority.rows[0]?.authority_kind,
  };
}

async function lockDisposition(
  client: PoolClient,
  workspaceId: string,
  dispositionId: string,
): Promise<
  | {
      studentId: string;
      status: string;
      version: number;
      cancellationDeadlineAt: Date;
      caseId: string;
    }
  | undefined
> {
  const row = await client.query<{
    student_id: string;
    status: string;
    version: number;
    cancellation_deadline_at: Date;
    case_id: string;
  }>(
    `select student_id, status, version, cancellation_deadline_at, case_id
       from records_governance.record_dispositions
      where disposition_id = $1 and workspace_id = $2
      for update`,
    [dispositionId, workspaceId],
  );
  const selected = row.rows[0];
  if (!selected) return undefined;
  return {
    studentId: selected.student_id,
    status: selected.status,
    version: selected.version,
    cancellationDeadlineAt: selected.cancellation_deadline_at,
    caseId: selected.case_id,
  };
}

async function insertDispositionEvent(
  client: PoolClient,
  input: {
    dispositionId: string;
    workspaceId: string;
    studentId: string;
    eventKind: string;
    occurredAt: Date;
    actorStaffIdentityId: string | null;
    operationId: string;
    details: unknown;
  },
) {
  await client.query(
    `insert into records_governance.record_disposition_events
       (disposition_event_id, disposition_id, workspace_id, student_id,
        event_kind, occurred_at, actor_staff_identity_id, operation_id, details,
        record_owner, record_classification, disposal_class)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
             'school', 'student_record', 'record_disposition_event')`,
    [
      crypto.randomUUID(),
      input.dispositionId,
      input.workspaceId,
      input.studentId,
      input.eventKind,
      input.occurredAt,
      input.actorStaffIdentityId,
      input.operationId,
      JSON.stringify(input.details),
    ],
  );
}

const disposalAdapters: {
  adapter: (typeof recordDispositionAdapters)[number];
  location: string;
  purge: (
    client: PoolClient,
    workspaceId: string,
    studentId: string,
  ) => Promise<number>;
}[] = [
  {
    adapter: 'memberships',
    location: 'memberships_invitations_codes',
    purge: purgeMemberships,
  },
  {
    adapter: 'identity_access',
    location: 'identity_sessions_emails_codes',
    purge: purgeIdentityAccess,
  },
  {
    adapter: 'intake',
    location: 'intake_drafts_and_versions',
    purge: purgeIntake,
  },
  {
    adapter: 'learning_progress',
    location: 'learning_item_completions',
    purge: purgeLearningProgress,
  },
  {
    adapter: 'clinical_access_evidence',
    location: 'clinical_access_copies',
    purge: async () => 0,
  },
  {
    adapter: 'productions',
    location: 'generated_production_artifacts',
    purge: purgeProductions,
  },
  {
    adapter: 'projections',
    location: 'owned_projections_and_history',
    purge: purgeProjections,
  },
];

async function countDeleted(
  client: PoolClient,
  sql: string,
  values: unknown[],
): Promise<number> {
  const result = await client.query(sql, values);
  return result.rowCount ?? 0;
}

async function purgeMemberships(
  client: PoolClient,
  workspaceId: string,
  studentId: string,
): Promise<number> {
  const invitations = await client.query<{ invitation_id: string }>(
    `select invitation.invitation_id
       from identity_access.invitations invitation
      where invitation.workspace_id = $1
        and invitation.recipient_digest in (
          select email.recipient_digest
            from identity_access.verified_email_addresses email
           where email.student_id = $2 and email.workspace_id = $1
        )`,
    [workspaceId, studentId],
  );
  const invitationIds = invitations.rows.map((row) => row.invitation_id);
  let removed = await countDeleted(
    client,
    `delete from identity_access.class_memberships
      where student_id = $1 and workspace_id = $2`,
    [studentId, workspaceId],
  );
  if (invitationIds.length > 0) {
    removed += await countDeleted(
      client,
      `delete from identity_access.invitation_deliveries
        where invitation_id = any($1::uuid[])`,
      [invitationIds],
    );
    removed += await countDeleted(
      client,
      `delete from identity_access.invitation_challenges
        where invitation_id = any($1::uuid[])`,
      [invitationIds],
    );
    removed += await countDeleted(
      client,
      `delete from identity_access.invitations
        where invitation_id = any($1::uuid[])`,
      [invitationIds],
    );
  }
  return removed;
}

async function purgeIdentityAccess(
  client: PoolClient,
  workspaceId: string,
  studentId: string,
): Promise<number> {
  const challenges = await client.query<{ sign_in_challenge_id: string }>(
    `select sign_in_challenge_id from identity_access.sign_in_challenges
      where student_id = $1 and workspace_id = $2`,
    [studentId, workspaceId],
  );
  const challengeIds = challenges.rows.map((row) => row.sign_in_challenge_id);
  let removed = 0;
  if (challengeIds.length > 0) {
    removed += await countDeleted(
      client,
      `delete from identity_access.sign_in_deliveries
        where sign_in_challenge_id = any($1::uuid[])`,
      [challengeIds],
    );
    removed += await countDeleted(
      client,
      `delete from identity_access.sign_in_challenge_codes
        where sign_in_challenge_id = any($1::uuid[])`,
      [challengeIds],
    );
    removed += await countDeleted(
      client,
      `delete from identity_access.sign_in_challenges
        where sign_in_challenge_id = any($1::uuid[])`,
      [challengeIds],
    );
  }
  removed += await countDeleted(
    client,
    `delete from identity_access.sign_in_send_attempts
      where recipient_digest in (
        select email.recipient_digest
          from identity_access.verified_email_addresses email
         where email.student_id = $1 and email.workspace_id = $2
      )`,
    [studentId, workspaceId],
  );
  removed += await countDeleted(
    client,
    `delete from identity_access.student_sessions
      where student_id = $1 and workspace_id = $2`,
    [studentId, workspaceId],
  );
  removed += await countDeleted(
    client,
    `delete from identity_access.verified_email_addresses
      where student_id = $1 and workspace_id = $2`,
    [studentId, workspaceId],
  );
  return removed;
}

async function purgeIntake(
  client: PoolClient,
  workspaceId: string,
  studentId: string,
): Promise<number> {
  let removed = await countDeleted(
    client,
    `delete from intake.intake_drafts
      where student_id = $1 and workspace_id = $2`,
    [studentId, workspaceId],
  );
  removed += await countDeleted(
    client,
    `delete from intake.intake_record_versions
      where student_id = $1 and workspace_id = $2`,
    [studentId, workspaceId],
  );
  return removed;
}

async function purgeLearningProgress(
  client: PoolClient,
  workspaceId: string,
  studentId: string,
): Promise<number> {
  return countDeleted(
    client,
    `delete from learning_progress.item_completions
      where student_id = $1 and workspace_id = $2`,
    [studentId, workspaceId],
  );
}

async function purgeProductions(
  client: PoolClient,
  workspaceId: string,
  studentId: string,
): Promise<number> {
  const productions = await client.query(
    `update records_governance.record_productions
        set wrapping_key_id = null, wrapped_data_key = null, ciphertext = null,
            delivery_key_id = null, delivery_ciphertext = null,
            cleanup_status = 'removed',
            removed_at = coalesce(removed_at, clock_timestamp())
      where student_id = $1 and workspace_id = $2
        and (ciphertext is not null or delivery_ciphertext is not null)`,
    [studentId, workspaceId],
  );
  const amendments = await client.query(
    `update records_governance.record_amendments
        set statement_wrapping_key_id = null, statement_wrapped_data_key = null,
            statement_ciphertext = null, correction_wrapping_key_id = null,
            correction_wrapped_data_key = null, correction_ciphertext = null
      where student_id = $1 and workspace_id = $2
        and (statement_ciphertext is not null or correction_ciphertext is not null)`,
    [studentId, workspaceId],
  );
  return (productions.rowCount ?? 0) + (amendments.rowCount ?? 0);
}

async function purgeProjections(
  client: PoolClient,
  workspaceId: string,
  studentId: string,
): Promise<number> {
  let removed = await countDeleted(
    client,
    `delete from intake.intake_operation_receipts
      where student_id = $1 and workspace_id = $2`,
    [studentId, workspaceId],
  );
  removed += await countDeleted(
    client,
    `delete from learning_progress.item_completion_receipts
      where student_id = $1 and workspace_id = $2`,
    [studentId, workspaceId],
  );
  await client.query(
    `update identity_access.students
        set language_choice = 'en-US', status = 'disabled'
      where student_id = $1 and workspace_id = $2`,
    [studentId, workspaceId],
  );
  return removed;
}

async function runDispositionPurge(
  pool: Pool,
  request: {
    workspaceId: string;
    staffIdentityId: string;
    operationId: string;
    dispositionId: string;
    expectedVersion: number;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    result: {
      operationId: string;
      dispositionId: string;
      outcome: 'purged' | 'failed';
    };
    commandName: string;
    startFrom: 'scheduled' | 'failed';
  },
): Promise<
  | {
      outcome: 'applied' | 'replayed';
      result: {
        operationId: string;
        dispositionId: string;
        outcome: 'purged' | 'failed';
      };
    }
  | { outcome: 'not_found' }
  | { outcome: 'window_open' }
  | { outcome: 'not_executable' }
  | { outcome: 'not_repairable' }
  | { outcome: 'version_conflict' }
> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [
      `${request.workspaceId}:disposition:${request.dispositionId}`,
    ]);
    await client.query('begin');
    await setLocal(client, 'app.workspace_id', request.workspaceId);
    await setLocal(client, 'app.staff_identity_id', request.staffIdentityId);
    const existing = await readReceipt<typeof request.result>(
      client,
      request.workspaceId,
      request.operationId,
      request.commandName,
    );
    if (existing) {
      await client.query('commit');
      return { outcome: 'replayed', result: existing };
    }
    const locked = await lockDisposition(
      client,
      request.workspaceId,
      request.dispositionId,
    );
    if (!locked) {
      await client.query('rollback');
      return { outcome: 'not_found' };
    }
    if (locked.version !== request.expectedVersion) {
      await client.query('rollback');
      return { outcome: 'version_conflict' };
    }
    const openHold = await client.query<{ count: string }>(
      `select count(*)::text as count from records_governance.record_holds
        where student_id = $1 and workspace_id = $2 and status = 'active'`,
      [locked.studentId, request.workspaceId],
    );
    if (Number(openHold.rows[0]?.count ?? '0') > 0) {
      await client.query('rollback');
      return request.startFrom === 'scheduled'
        ? { outcome: 'not_executable' }
        : { outcome: 'not_repairable' };
    }
    if (request.startFrom === 'scheduled') {
      if (locked.status !== 'scheduled') {
        await client.query('rollback');
        return { outcome: 'not_executable' };
      }
      if (
        locked.cancellationDeadlineAt.getTime() > request.occurredAt.getTime()
      ) {
        await client.query('rollback');
        return { outcome: 'window_open' };
      }
      await client.query(
        `update records_governance.record_dispositions
            set status = 'executing', execution_started_at = $2,
                version = version + 1
          where disposition_id = $1`,
        [request.dispositionId, request.occurredAt],
      );
      for (const adapter of disposalAdapters) {
        await client.query(
          `insert into records_governance.record_disposition_tasks
             (task_id, disposition_id, workspace_id, student_id, adapter,
              location, status, purged_count, verification, record_owner,
              record_classification, disposal_class)
           values ($1, $2, $3, $4, $5, $6, 'pending', 0, 'pending',
                   'school', 'student_record', 'record_disposition_task')
           on conflict (disposition_id, adapter) do nothing`,
          [
            crypto.randomUUID(),
            request.dispositionId,
            request.workspaceId,
            locked.studentId,
            adapter.adapter,
            adapter.location,
          ],
        );
      }
      await insertDispositionEvent(client, {
        dispositionId: request.dispositionId,
        workspaceId: request.workspaceId,
        studentId: locked.studentId,
        eventKind: 'execution_started',
        occurredAt: request.occurredAt,
        actorStaffIdentityId: request.staffIdentityId,
        operationId: request.operationId,
        details: {},
      });
    } else {
      if (locked.status !== 'failed') {
        await client.query('rollback');
        return { outcome: 'not_repairable' };
      }
      await client.query(
        `update records_governance.record_dispositions
            set status = 'executing', version = version + 1
          where disposition_id = $1`,
        [request.dispositionId],
      );
      await insertDispositionEvent(client, {
        dispositionId: request.dispositionId,
        workspaceId: request.workspaceId,
        studentId: locked.studentId,
        eventKind: 'retry_started',
        occurredAt: request.occurredAt,
        actorStaffIdentityId: request.staffIdentityId,
        operationId: request.operationId,
        details: {},
      });
    }
    await client.query('commit');

    for (const adapter of disposalAdapters) {
      await client.query('begin');
      await setLocal(client, 'app.workspace_id', request.workspaceId);
      await setLocal(client, 'app.staff_identity_id', request.staffIdentityId);
      const task = await client.query<{ status: string }>(
        `select status from records_governance.record_disposition_tasks
          where disposition_id = $1 and adapter = $2`,
        [request.dispositionId, adapter.adapter],
      );
      if (task.rows[0]?.status === 'purged') {
        await client.query('rollback');
        continue;
      }
      try {
        await setLocal(
          client,
          'app.record_disposition_id',
          request.dispositionId,
        );
        const count = await adapter.purge(
          client,
          request.workspaceId,
          locked.studentId,
        );
        await client.query(
          `update records_governance.record_disposition_tasks
              set status = 'purged', purged_count = $3, verification = 'verified',
                  last_error_code = null
            where disposition_id = $1 and adapter = $2`,
          [request.dispositionId, adapter.adapter, count],
        );
        await insertDispositionEvent(client, {
          dispositionId: request.dispositionId,
          workspaceId: request.workspaceId,
          studentId: locked.studentId,
          eventKind: 'adapter_purged',
          occurredAt: request.occurredAt,
          actorStaffIdentityId: request.staffIdentityId,
          operationId: request.operationId,
          details: { adapter: adapter.adapter, count },
        });
        await client.query('commit');
      } catch {
        await client.query('rollback');
        await client.query('begin');
        await setLocal(client, 'app.workspace_id', request.workspaceId);
        await setLocal(
          client,
          'app.staff_identity_id',
          request.staffIdentityId,
        );
        await client.query(
          `update records_governance.record_disposition_tasks
              set status = 'failed', verification = 'failed',
                  last_error_code = 'ADAPTER_PURGE_FAILED'
            where disposition_id = $1 and adapter = $2`,
          [request.dispositionId, adapter.adapter],
        );
        await insertDispositionEvent(client, {
          dispositionId: request.dispositionId,
          workspaceId: request.workspaceId,
          studentId: locked.studentId,
          eventKind: 'adapter_failed',
          occurredAt: request.occurredAt,
          actorStaffIdentityId: request.staffIdentityId,
          operationId: request.operationId,
          details: { adapter: adapter.adapter },
        });
        await client.query('commit');
      }
    }

    await client.query('begin');
    await setLocal(client, 'app.workspace_id', request.workspaceId);
    await setLocal(client, 'app.staff_identity_id', request.staffIdentityId);
    const remaining = await client.query<{ count: string }>(
      `select count(*)::text as count
         from records_governance.record_disposition_tasks
        where disposition_id = $1 and status <> 'purged'`,
      [request.dispositionId],
    );
    const purged = Number(remaining.rows[0]?.count ?? '1') === 0;
    const result = {
      ...request.result,
      outcome: purged ? ('purged' as const) : ('failed' as const),
    };
    if (purged) {
      await client.query(
        `update records_governance.record_dispositions
            set status = 'purged', completed_at = $2, version = version + 1
          where disposition_id = $1`,
        [request.dispositionId, request.occurredAt],
      );
      await client.query(
        `update records_governance.record_lifecycle_cases
            set outcome = 'completed', closed_at = $2
          where case_id = $1 and outcome = 'open'`,
        [locked.caseId, request.occurredAt],
      );
      await insertDispositionEvent(client, {
        dispositionId: request.dispositionId,
        workspaceId: request.workspaceId,
        studentId: locked.studentId,
        eventKind: 'purged',
        occurredAt: request.occurredAt,
        actorStaffIdentityId: request.staffIdentityId,
        operationId: request.operationId,
        details: {},
      });
    } else {
      await client.query(
        `update records_governance.record_dispositions
            set status = 'failed', version = version + 1
          where disposition_id = $1`,
        [request.dispositionId],
      );
      await insertDispositionEvent(client, {
        dispositionId: request.dispositionId,
        workspaceId: request.workspaceId,
        studentId: locked.studentId,
        eventKind: 'failed',
        occurredAt: request.occurredAt,
        actorStaffIdentityId: request.staffIdentityId,
        operationId: request.operationId,
        details: {},
      });
    }
    await writeReceipt(client, {
      workspaceId: request.workspaceId,
      operationId: request.operationId,
      commandName: request.commandName,
      result,
      occurredAt: request.occurredAt,
    });
    await writeAudit(client, {
      auditId: request.auditId,
      workspaceId: request.workspaceId,
      operationId: request.operationId,
      eventType: purged
        ? 'record_disposition.purged'
        : 'record_disposition.failed',
      actorId: request.staffIdentityId,
      occurredAt: request.occurredAt,
      details: {
        dispositionId: request.dispositionId,
        outcome: result.outcome,
      },
    });
    await writeOutbox(client, {
      outboxId: request.outboxId,
      workspaceId: request.workspaceId,
      operationId: request.operationId,
      topic: purged ? 'record_disposition.purged' : 'record_disposition.failed',
      payload: {
        dispositionId: request.dispositionId,
        outcome: result.outcome,
      },
      occurredAt: request.occurredAt,
    });
    await client.query('commit');
    return { outcome: 'applied', result };
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // The connection may already be idle after a committed adapter step.
    }
    throw error;
  } finally {
    try {
      await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [
        `${request.workspaceId}:disposition:${request.dispositionId}`,
      ]);
    } catch {
      // Unlock best-effort so the pool client can be released.
    }
    client.release();
  }
}
