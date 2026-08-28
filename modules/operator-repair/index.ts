export const operatorRepairCommandName = 'repairOperatorWork' as const;
export const operatorRepairConfirmation = 'resume_failed_work' as const;

export const operatorRepairKinds = [
  'invitation_delivery',
  'sign_in_delivery',
  'record_production_delivery',
  'record_production_cleanup',
  'disposition_task',
  'purge_verification',
  'publication_attempt',
] as const;

export type OperatorRepairKind = (typeof operatorRepairKinds)[number];

export const operatorRepairGuidance = [
  'RESUME_FAILED_INVITATION_DELIVERY',
  'RESUME_DELAYED_INVITATION_DELIVERY',
  'RESUME_FAILED_SIGN_IN_DELIVERY',
  'RESUME_DELAYED_SIGN_IN_DELIVERY',
  'RESUME_FAILED_RECORD_PRODUCTION_DELIVERY',
  'RESUME_DELAYED_RECORD_PRODUCTION_DELIVERY',
  'RESUME_FAILED_RECORD_PRODUCTION_CLEANUP',
  'RESUME_FAILED_DISPOSITION_TASK',
  'RESUME_FAILED_PURGE_VERIFICATION',
  'RETRY_PUBLICATION_WITH_NEW_OPERATION',
] as const;

export type OperatorRepairGuidance = (typeof operatorRepairGuidance)[number];

export type RepairableWorkItem = {
  workspaceId: string;
  kind: OperatorRepairKind;
  workId: string;
  failedOperationId: string;
  status: 'failed' | 'delayed' | 'cleanup_failed';
  recordedAt: string;
  guidance: OperatorRepairGuidance;
};

export type RepairOperatorWorkCommand = {
  operationId: string;
  workspaceId: string;
  kind: OperatorRepairKind;
  workId: string;
  failedOperationId: string;
  confirmation: typeof operatorRepairConfirmation;
  actor: { type: 'technical_operator'; id: string };
};

export type RepairOperatorWorkResult = {
  operationId: string;
  workspaceId: string;
  kind: OperatorRepairKind;
  workId: string;
  failedOperationId: string;
  outcome: 'resumed';
  replayed?: true;
  guidance: OperatorRepairGuidance;
};

export type OperatorRepair = {
  listRepairableWork(): Promise<RepairableWorkItem[]>;
  repairWork(
    command: RepairOperatorWorkCommand,
  ): Promise<RepairOperatorWorkResult>;
};

export class OperatorRepairNotFoundError extends Error {
  readonly code = 'REPAIR_NOT_FOUND';
  constructor() {
    super('Repairable work was not found');
    this.name = 'OperatorRepairNotFoundError';
  }
}

export class OperatorRepairNotRepairableError extends Error {
  readonly code = 'REPAIR_NOT_REPAIRABLE';
  constructor() {
    super('Work cannot be repaired without bypassing invariants');
    this.name = 'OperatorRepairNotRepairableError';
  }
}

export class OperatorRepairPreconditionConflictError extends Error {
  readonly code = 'REPAIR_PRECONDITION_CONFLICT';
  constructor() {
    super('Repair named a different failed operation than the stored work');
    this.name = 'OperatorRepairPreconditionConflictError';
  }
}

export class OperatorRepairConfirmationRequiredError extends Error {
  readonly code = 'REPAIR_CONFIRMATION_REQUIRED';
  constructor() {
    super('Repair requires explicit confirmation to resume failed work');
    this.name = 'OperatorRepairConfirmationRequiredError';
  }
}

export class OperatorRepairOperationReusedError extends Error {
  readonly code = 'OPERATION_ID_REUSED';
  constructor() {
    super('Operation ID was reused with a different repair body');
    this.name = 'OperatorRepairOperationReusedError';
  }
}

export type OperatorRepairStore = {
  list(): Promise<RepairableWorkItem[]>;
  repair(request: {
    command: RepairOperatorWorkCommand;
    occurredAt: Date;
    auditId: string;
    outboxId: string;
    result: RepairOperatorWorkResult;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; result: RepairOperatorWorkResult }
    | { outcome: 'not_found' }
    | { outcome: 'not_repairable' }
    | { outcome: 'conflict' }
    | { outcome: 'operation_reused' }
  >;
};

export function createOperatorRepair(dependencies: {
  store: OperatorRepairStore;
  clock: { now(): Date };
  ids: { create(): string };
}): OperatorRepair {
  return {
    listRepairableWork() {
      return dependencies.store.list();
    },
    async repairWork(command) {
      if (command.confirmation !== operatorRepairConfirmation) {
        throw new OperatorRepairConfirmationRequiredError();
      }
      const result: RepairOperatorWorkResult = {
        operationId: command.operationId,
        workspaceId: command.workspaceId,
        kind: command.kind,
        workId: command.workId,
        failedOperationId: command.failedOperationId,
        outcome: 'resumed',
        guidance: guidanceFor(command.kind, 'failed'),
      };
      const repaired = await dependencies.store.repair({
        command,
        occurredAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        result,
      });
      if (repaired.outcome === 'replayed') {
        return { ...repaired.result, replayed: true };
      }
      if (repaired.outcome === 'applied') return repaired.result;
      if (repaired.outcome === 'not_found') {
        throw new OperatorRepairNotFoundError();
      }
      if (repaired.outcome === 'conflict') {
        throw new OperatorRepairPreconditionConflictError();
      }
      if (repaired.outcome === 'operation_reused') {
        throw new OperatorRepairOperationReusedError();
      }
      throw new OperatorRepairNotRepairableError();
    },
  };
}

function guidanceFor(
  kind: OperatorRepairKind,
  status: RepairableWorkItem['status'],
): OperatorRepairGuidance {
  if (kind === 'invitation_delivery') {
    return status === 'delayed'
      ? 'RESUME_DELAYED_INVITATION_DELIVERY'
      : 'RESUME_FAILED_INVITATION_DELIVERY';
  }
  if (kind === 'sign_in_delivery') {
    return status === 'delayed'
      ? 'RESUME_DELAYED_SIGN_IN_DELIVERY'
      : 'RESUME_FAILED_SIGN_IN_DELIVERY';
  }
  if (kind === 'record_production_delivery') {
    return status === 'delayed'
      ? 'RESUME_DELAYED_RECORD_PRODUCTION_DELIVERY'
      : 'RESUME_FAILED_RECORD_PRODUCTION_DELIVERY';
  }
  if (kind === 'record_production_cleanup') {
    return 'RESUME_FAILED_RECORD_PRODUCTION_CLEANUP';
  }
  if (kind === 'disposition_task') return 'RESUME_FAILED_DISPOSITION_TASK';
  if (kind === 'purge_verification') return 'RESUME_FAILED_PURGE_VERIFICATION';
  return 'RETRY_PUBLICATION_WITH_NEW_OPERATION';
}
