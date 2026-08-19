export type CreateSchoolWorkspaceCommand = {
  operationId: string;
  workspaceId: string;
  displayName: string;
  actor: {
    type: 'technical_operator';
    id: string;
  };
};

export type CreateSchoolWorkspaceResult = {
  operationId: string;
  workspaceId: string;
  outcome: 'created';
};

export type Clock = {
  now(): Date;
};

export type IdGenerator = {
  create(): string;
};

export type IdentityAndAccess = {
  createSchoolWorkspace(
    command: CreateSchoolWorkspaceCommand,
  ): Promise<CreateSchoolWorkspaceResult>;
};

export class SchoolWorkspaceAlreadyExistsError extends Error {
  readonly code = 'SCHOOL_WORKSPACE_EXISTS';

  constructor() {
    super('School Workspace already exists');
    this.name = 'SchoolWorkspaceAlreadyExistsError';
  }
}

type GovernanceMetadata = {
  recordOwner: 'school';
  recordClassification:
    'school_administrative' | 'operational_evidence' | 'audit_evidence';
  disposalClass:
    | 'school_workspace'
    | 'operation_receipt'
    | 'workspace_audit_evidence'
    | 'transactional_outbox';
};

type CreateSchoolWorkspaceCommit = {
  workspace: GovernanceMetadata & {
    workspaceId: string;
    displayName: string;
    createdAt: Date;
  };
  receipt: GovernanceMetadata & {
    workspaceId: string;
    operationId: string;
    commandName: 'createSchoolWorkspace';
    result: CreateSchoolWorkspaceResult;
    recordedAt: Date;
  };
  audit: GovernanceMetadata & {
    auditId: string;
    workspaceId: string;
    operationId: string;
    eventType: 'school_workspace.created';
    actorType: 'technical_operator';
    actorId: string;
    occurredAt: Date;
  };
  outbox: GovernanceMetadata & {
    outboxId: string;
    workspaceId: string;
    operationId: string;
    topic: 'school_workspace.created';
    payload: { workspaceId: string };
    status: 'pending';
    recordedAt: Date;
  };
};

type CreateSchoolWorkspaceCommitter = {
  commit(request: {
    workspaceId: string;
    operationId: string;
    createRecords(): CreateSchoolWorkspaceCommit;
  }): Promise<CreateSchoolWorkspaceResult>;
};

export function createIdentityAndAccess(dependencies: {
  committer: CreateSchoolWorkspaceCommitter;
  clock: Clock;
  ids: IdGenerator;
}): IdentityAndAccess {
  return {
    async createSchoolWorkspace(command) {
      const result: CreateSchoolWorkspaceResult = {
        operationId: command.operationId,
        workspaceId: command.workspaceId,
        outcome: 'created',
      };

      return dependencies.committer.commit({
        workspaceId: command.workspaceId,
        operationId: command.operationId,
        createRecords() {
          const recordedAt = dependencies.clock.now();
          return {
            workspace: {
              workspaceId: command.workspaceId,
              displayName: command.displayName,
              createdAt: recordedAt,
              recordOwner: 'school',
              recordClassification: 'school_administrative',
              disposalClass: 'school_workspace',
            },
            receipt: {
              ...result,
              commandName: 'createSchoolWorkspace',
              result,
              recordedAt,
              recordOwner: 'school',
              recordClassification: 'operational_evidence',
              disposalClass: 'operation_receipt',
            },
            audit: {
              auditId: dependencies.ids.create(),
              ...result,
              eventType: 'school_workspace.created',
              actorType: command.actor.type,
              actorId: command.actor.id,
              occurredAt: recordedAt,
              recordOwner: 'school',
              recordClassification: 'audit_evidence',
              disposalClass: 'workspace_audit_evidence',
            },
            outbox: {
              outboxId: dependencies.ids.create(),
              ...result,
              topic: 'school_workspace.created',
              payload: { workspaceId: command.workspaceId },
              status: 'pending',
              recordedAt,
              recordOwner: 'school',
              recordClassification: 'operational_evidence',
              disposalClass: 'transactional_outbox',
            },
          };
        },
      });
    },
  };
}
