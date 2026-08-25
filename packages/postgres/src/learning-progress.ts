import type { Pool, PoolClient } from 'pg';
import {
  LearningOperationReusedError,
  assertAcknowledgeable,
  type AcknowledgeLearningItemResult,
  type ActiveLearningRelease,
  type LearningProgressStore,
  type StoredItemCompletion,
} from '../../../modules/learning-progress/index.ts';
import { schoolConfigurationWorkspaceLockKey } from './workspace-locks.ts';

async function setStudentScope(
  client: PoolClient,
  input: { workspaceId: string; studentId: string },
): Promise<void> {
  await client.query("select set_config('app.workspace_id', $1, true)", [
    input.workspaceId,
  ]);
  await client.query("select set_config('app.student_id', $1, true)", [
    input.studentId,
  ]);
}

async function transaction<Result>(
  pool: Pool,
  run: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function readActiveLearningRelease(
  client: PoolClient,
  workspaceId: string,
): Promise<ActiveLearningRelease | undefined> {
  const release = await client.query<{
    release_id: string;
    payload: Record<string, unknown>;
  }>(
    `select state.active_release_id as release_id, revision.payload
       from school_configuration.configuration_states state
       join school_configuration.release_components component
         on component.release_id = state.active_release_id
        and component.workspace_id = state.workspace_id
        and component.slot = 'candidate.release.modules'
       join school_configuration.authored_revisions revision
         on revision.workspace_id = component.workspace_id
        and revision.resource_id = component.resource_id
        and revision.revision_number = component.revision_number
      where state.workspace_id = $1 and state.active_release_id is not null
      order by component.position nulls last`,
    [workspaceId],
  );
  if (release.rows.length === 0) {
    const active = await client.query(
      `select active_release_id from school_configuration.configuration_states
        where workspace_id = $1 and active_release_id is not null`,
      [workspaceId],
    );
    if (active.rowCount !== 1) return undefined;
    return {
      schoolConfigurationReleaseId: String(active.rows[0]?.active_release_id),
      modules: [],
    };
  }
  return {
    schoolConfigurationReleaseId: release.rows[0]?.release_id as string,
    modules: release.rows.map((row) => ({ payload: row.payload })),
  };
}

async function learningUnlocked(
  client: PoolClient,
  input: { studentId: string; workspaceId: string },
): Promise<boolean> {
  const accepted = await client.query(
    `select 1 from intake.intake_record_versions
      where student_id = $1 and workspace_id = $2 and superseded_at is null`,
    [input.studentId, input.workspaceId],
  );
  return accepted.rowCount === 1;
}

async function readCompletions(
  client: PoolClient,
  input: { studentId: string; workspaceId: string },
): Promise<StoredItemCompletion[]> {
  const rows = await client.query<{
    item_completion_id: string;
    item_id: string;
    item_revision_number: number;
    school_configuration_release_id: string;
    completed_at: Date;
    operation_id: string;
  }>(
    `select item_completion_id, item_id, item_revision_number,
            school_configuration_release_id, completed_at, operation_id
       from learning_progress.item_completions
      where student_id = $1 and workspace_id = $2`,
    [input.studentId, input.workspaceId],
  );
  return rows.rows.map((row) => ({
    itemCompletionId: row.item_completion_id,
    itemId: row.item_id,
    revisionNumber: row.item_revision_number,
    schoolConfigurationReleaseId: row.school_configuration_release_id,
    completedAt: row.completed_at,
    operationId: row.operation_id,
  }));
}

function replayedResult(
  operationId: string,
  completion: StoredItemCompletion,
): AcknowledgeLearningItemResult {
  return {
    operationId,
    itemCompletionId: completion.itemCompletionId,
    itemId: completion.itemId,
    revisionNumber: completion.revisionNumber,
    schoolConfigurationReleaseId: completion.schoolConfigurationReleaseId,
    completedAt: completion.completedAt.toISOString(),
    replayed: true,
  };
}

export function createPostgresLearningProgressStore(options: {
  pool: Pool;
}): LearningProgressStore {
  return {
    async readWorkspaceLearning(input) {
      return transaction(options.pool, async (client) => {
        await setStudentScope(client, input);
        return {
          learningUnlocked: await learningUnlocked(client, input),
          release: await readActiveLearningRelease(client, input.workspaceId),
          completions: await readCompletions(client, input),
        };
      });
    },

    async acknowledge(input) {
      return transaction(options.pool, async (client) => {
        await setStudentScope(client, input);
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`learning-progress:${input.studentId}`],
        );
        const receipt = await client.query<{
          request_binding: string;
          result: AcknowledgeLearningItemResult;
        }>(
          `select request_binding, result
             from learning_progress.item_completion_receipts
            where workspace_id = $1 and student_id = $2 and operation_id = $3`,
          [input.workspaceId, input.studentId, input.operationId],
        );
        if (receipt.rows[0]) {
          if (receipt.rows[0].request_binding !== input.requestBinding) {
            throw new LearningOperationReusedError();
          }
          return {
            outcome: 'replayed' as const,
            result: receipt.rows[0].result,
          };
        }
        await client.query(
          'select pg_advisory_xact_lock(hashtextextended($1, 0))',
          [schoolConfigurationWorkspaceLockKey(input.workspaceId)],
        );
        const release = assertAcknowledgeable({
          learningUnlocked: await learningUnlocked(client, input),
          release: await readActiveLearningRelease(client, input.workspaceId),
          expectedSchoolConfigurationReleaseId:
            input.expectedSchoolConfigurationReleaseId,
          itemId: input.itemId,
          revisionNumber: input.revisionNumber,
        });
        const existing = (await readCompletions(client, input)).find(
          (completion) =>
            completion.itemId === input.itemId &&
            completion.revisionNumber === input.revisionNumber,
        );
        const completion = existing ?? {
          itemCompletionId: input.proposedCompletionId,
          itemId: input.itemId,
          revisionNumber: input.revisionNumber,
          schoolConfigurationReleaseId: release.schoolConfigurationReleaseId,
          completedAt: input.completedAt,
          operationId: input.operationId,
        };
        const result = replayedResult(input.operationId, completion);
        if (!existing) {
          await client.query(
            `insert into learning_progress.item_completions
               (item_completion_id, student_id, workspace_id, item_id,
                item_revision_number, school_configuration_release_id,
                operation_id, completed_at, record_owner,
                record_classification, disposal_class)
             values ($1, $2, $3, $4, $5, $6, $7, $8,
                     'school', 'student_record', 'item_completion')`,
            [
              completion.itemCompletionId,
              input.studentId,
              input.workspaceId,
              completion.itemId,
              completion.revisionNumber,
              completion.schoolConfigurationReleaseId,
              input.operationId,
              completion.completedAt,
            ],
          );
          await client.query(
            `insert into audit.evidence
               (audit_id, workspace_id, operation_id, event_type, actor_type,
                actor_id, occurred_at, details, record_owner,
                record_classification, disposal_class)
             values ($1, $2, $3, 'item_completion.accepted', 'student', $4,
                     $5, $6, 'school', 'audit_evidence', 'workspace_audit_evidence')`,
            [
              input.auditId,
              input.workspaceId,
              input.operationId,
              input.studentId,
              input.completedAt,
              {
                itemCompletionId: completion.itemCompletionId,
                itemId: completion.itemId,
                revisionNumber: completion.revisionNumber,
                schoolConfigurationReleaseId:
                  completion.schoolConfigurationReleaseId,
              },
            ],
          );
          await client.query(
            `insert into infrastructure.outbox
               (outbox_id, workspace_id, operation_id, topic, payload, status,
                recorded_at, record_owner, record_classification, disposal_class)
             values ($1, $2, $3, 'item_completion.accepted', $4, 'pending',
                     $5, 'school', 'operational_evidence', 'transactional_outbox')`,
            [
              input.outboxId,
              input.workspaceId,
              input.operationId,
              {
                studentId: input.studentId,
                itemCompletionId: completion.itemCompletionId,
                itemId: completion.itemId,
                revisionNumber: completion.revisionNumber,
                schoolConfigurationReleaseId:
                  completion.schoolConfigurationReleaseId,
              },
              input.completedAt,
            ],
          );
        }
        await client.query(
          `insert into learning_progress.item_completion_receipts
             (workspace_id, student_id, operation_id, command_name, result,
              request_binding, recorded_at, record_owner,
              record_classification, disposal_class)
           values ($1, $2, $3, 'acknowledgeLearningItem', $4, $5, $6,
                   'school', 'operational_evidence', 'operation_receipt')`,
          [
            input.workspaceId,
            input.studentId,
            input.operationId,
            result,
            input.requestBinding,
            existing ? existing.completedAt : input.completedAt,
          ],
        );
        if (existing) {
          return { outcome: 'replayed' as const, result };
        }
        return { outcome: 'accepted' as const, completion };
      });
    },
  };
}
