import type { Pool, PoolClient } from 'pg';
import type {
  DestructionEligibility,
  RecordHoldView,
  RecordLifecycleCaseView,
  RecordsGovernanceDirectory,
  RecordsGovernanceStore,
  StudentRecordsGovernanceView,
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
  },
) {
  await client.query(
    `insert into audit.evidence
       (audit_id, workspace_id, operation_id, event_type, actor_type,
        actor_id, occurred_at, details, record_owner, record_classification,
        disposal_class)
     values ($1, $2, $3, $4, 'staff', $5, $6, $7::jsonb,
             'school', 'audit_evidence', 'workspace_audit_evidence')`,
    [
      input.auditId,
      input.workspaceId,
      input.operationId,
      input.eventType,
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

function parseJsonArray<T>(value: unknown): T[] {
  const parsed =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function dateOnly(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
