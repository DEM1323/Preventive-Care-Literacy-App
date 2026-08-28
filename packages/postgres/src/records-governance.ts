import type { Pool, PoolClient } from 'pg';
import type {
  DestructionEligibility,
  RecordAmendmentView,
  RecordConflictReviewView,
  RecordHoldView,
  RecordLifecycleCaseView,
  RecordProductionMaterials,
  RecordProductionView,
  RecordsGovernanceDirectory,
  RecordsGovernanceStore,
  StudentRecordsGovernanceView,
} from '../../../modules/records-governance/index.ts';
import { authorizedProductionPortions } from '../../../modules/records-governance/index.ts';

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
            const activeHolds = Number(row.active_hold_count);
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
