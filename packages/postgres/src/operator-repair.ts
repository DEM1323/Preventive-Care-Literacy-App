import type { Pool } from 'pg';
import type {
  OperatorRepairStore,
  RepairableWorkItem,
  RepairOperatorWorkResult,
} from '../../../modules/operator-repair/index.ts';

export function createPostgresOperatorRepairStore(options: {
  pool: Pool;
}): OperatorRepairStore {
  return {
    async list() {
      const listed = await options.pool.query<{
        list_repairable_work: RepairableWorkItem[] | string;
      }>('select infrastructure.list_repairable_work()');
      const value = listed.rows[0]?.list_repairable_work ?? [];
      return typeof value === 'string'
        ? (JSON.parse(value) as RepairableWorkItem[])
        : value;
    },

    async repair(request) {
      const repaired = await options.pool.query<{
        repair_operator_work: {
          outcome:
            | 'applied'
            | 'replayed'
            | 'not_found'
            | 'not_repairable'
            | 'conflict'
            | 'operation_reused';
          result?: RepairOperatorWorkResult;
        };
      }>(
        'select infrastructure.repair_operator_work($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',
        [
          request.command.workspaceId,
          request.command.operationId,
          request.command.kind,
          request.command.workId,
          request.command.failedOperationId,
          request.command.actor.id,
          request.auditId,
          request.outboxId,
          request.occurredAt,
          JSON.stringify(request.result),
        ],
      );
      const payload = repaired.rows[0]?.repair_operator_work;
      if (!payload) return { outcome: 'not_found' };
      if (payload.outcome === 'applied' || payload.outcome === 'replayed') {
        if (!payload.result) return { outcome: 'not_found' };
        return { outcome: payload.outcome, result: payload.result };
      }
      return { outcome: payload.outcome };
    },
  };
}
