import { createHash } from 'node:crypto';
import type {
  Clock,
  IdGenerator,
  StudentSessionContext,
} from '../identity-access/index.ts';
import { StudentClassAccessRequiredError } from '../identity-access/index.ts';
import {
  canonicalJson,
  supportedLocales,
} from '../school-configuration/index.ts';

export const supportedLearningLocales = supportedLocales;
export type LearningLocale = (typeof supportedLearningLocales)[number];
export type LearningItemKind = 'knowledge' | 'skill' | 'application';

export type DisplayedLearningItem = {
  itemId: string;
  revisionNumber: number;
  kind: LearningItemKind;
  text: string;
  moduleTitle: string;
};

export type StoredItemCompletion = {
  itemCompletionId: string;
  itemId: string;
  revisionNumber: number;
  schoolConfigurationReleaseId: string;
  completedAt: Date;
  operationId: string;
};

export type StudentLearningSnapshot = {
  learningUnlocked: boolean;
  schoolConfigurationReleaseId: string | null;
  locale: LearningLocale;
  item: DisplayedLearningItem | null;
  completion: {
    itemCompletionId: string;
    itemId: string;
    revisionNumber: number;
    schoolConfigurationReleaseId: string;
    completedAt: string;
  } | null;
};

export type AcknowledgeLearningItemCommand = {
  sessionHandle: string;
  operationId: string;
  expectedSchoolConfigurationReleaseId: string;
  itemId: string;
  revisionNumber: number;
};

export type AcknowledgeLearningItemResult = {
  operationId: string;
  itemCompletionId: string;
  itemId: string;
  revisionNumber: number;
  schoolConfigurationReleaseId: string;
  completedAt: string;
  replayed: boolean;
};

export class LearningUnavailableError extends Error {
  readonly code = 'LEARNING_UNAVAILABLE';
  constructor() {
    super('An active School Configuration Release is required');
    this.name = 'LearningUnavailableError';
  }
}

export class LearningLockedError extends Error {
  readonly code = 'LEARNING_LOCKED';
  constructor() {
    super('Learning unlocks after an accepted Intake Record Version');
    this.name = 'LearningLockedError';
  }
}

export class LearningRevisionConflictError extends Error {
  readonly code = 'LEARNING_REVISION_CONFLICT';
  constructor() {
    super('The expected configuration or item revision changed');
    this.name = 'LearningRevisionConflictError';
  }
}

export class LearningOperationReusedError extends Error {
  readonly code = 'OPERATION_ID_REUSED';
  constructor() {
    super('The operation ID is already bound to different input');
    this.name = 'LearningOperationReusedError';
  }
}

export type ReleaseLearningModule = {
  payload: Record<string, unknown>;
};

export type ActiveLearningRelease = {
  schoolConfigurationReleaseId: string;
  modules: ReleaseLearningModule[];
};

export type LearningProgressStore = {
  readWorkspaceLearning(input: {
    studentId: string;
    workspaceId: string;
  }): Promise<{
    learningUnlocked: boolean;
    release: ActiveLearningRelease | undefined;
    completions: StoredItemCompletion[];
  }>;
  acknowledge(input: {
    studentId: string;
    workspaceId: string;
    operationId: string;
    requestBinding: string;
    proposedCompletionId: string;
    expectedSchoolConfigurationReleaseId: string;
    itemId: string;
    revisionNumber: number;
    completedAt: Date;
    auditId: string;
    outboxId: string;
  }): Promise<
    | { outcome: 'accepted'; completion: StoredItemCompletion }
    | { outcome: 'replayed'; result: AcknowledgeLearningItemResult }
  >;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function localizedText(
  value: unknown,
  locale: LearningLocale,
): string | undefined {
  if (!isRecord(value) || !isRecord(value[locale])) return undefined;
  const localized = value[locale];
  return typeof localized.value === 'string' ? localized.value : undefined;
}

function authoredItems(
  module: Record<string, unknown>,
  collection: 'knowledgeItems' | 'skillItems' | 'applicationItems',
): Record<string, unknown>[] {
  const items = module[collection];
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => (isRecord(item) ? [item] : []));
}

function projectItem(
  item: Record<string, unknown>,
  kind: LearningItemKind,
  moduleTitle: string,
  locale: LearningLocale,
): DisplayedLearningItem | undefined {
  if (typeof item.id !== 'string' || !Number.isInteger(item.revision)) {
    return undefined;
  }
  const text = localizedText(item.text, locale);
  if (!text) return undefined;
  return {
    itemId: item.id,
    revisionNumber: Number(item.revision),
    kind,
    text,
    moduleTitle,
  };
}

function selectDisplayedKnowledgeItem(release: ActiveLearningRelease):
  | {
      item: Record<string, unknown>;
      module: Record<string, unknown>;
    }
  | undefined {
  const modules = release.modules
    .map((module) => module.payload)
    .filter((payload) => Number.isInteger(payload.order))
    .sort((left, right) => Number(left.order) - Number(right.order));
  const module = modules[0];
  if (!module) return undefined;
  const items = authoredItems(module, 'knowledgeItems')
    .filter((item) => Number.isInteger(item.order))
    .sort((left, right) => Number(left.order) - Number(right.order));
  const item = items[0];
  return item ? { item, module } : undefined;
}

export function projectDisplayedLearningItem(
  release: ActiveLearningRelease,
  locale: LearningLocale,
): DisplayedLearningItem | undefined {
  const selected = selectDisplayedKnowledgeItem(release);
  if (!selected) return undefined;
  const moduleTitle = localizedText(selected.module.title, locale);
  if (!moduleTitle) return undefined;
  return projectItem(selected.item, 'knowledge', moduleTitle, locale);
}

export function displayedItemMatches(
  release: ActiveLearningRelease,
  itemId: string,
  revisionNumber: number,
): boolean {
  const selected = selectDisplayedKnowledgeItem(release);
  return (
    typeof selected?.item.id === 'string' &&
    Number(selected.item.revision) === revisionNumber &&
    selected.item.id === itemId
  );
}

export function assertAcknowledgeable(input: {
  learningUnlocked: boolean;
  release: ActiveLearningRelease | undefined;
  expectedSchoolConfigurationReleaseId: string;
  itemId: string;
  revisionNumber: number;
}): ActiveLearningRelease {
  if (!input.release) throw new LearningUnavailableError();
  if (!input.learningUnlocked) throw new LearningLockedError();
  if (
    input.release.schoolConfigurationReleaseId !==
      input.expectedSchoolConfigurationReleaseId ||
    !displayedItemMatches(input.release, input.itemId, input.revisionNumber)
  ) {
    throw new LearningRevisionConflictError();
  }
  return input.release;
}

function requestBinding(command: {
  expectedSchoolConfigurationReleaseId: string;
  itemId: string;
  revisionNumber: number;
}): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        expectedSchoolConfigurationReleaseId:
          command.expectedSchoolConfigurationReleaseId,
        itemId: command.itemId,
        revisionNumber: command.revisionNumber,
      }),
    )
    .digest('hex');
}

function completionView(completion: StoredItemCompletion) {
  return {
    itemCompletionId: completion.itemCompletionId,
    itemId: completion.itemId,
    revisionNumber: completion.revisionNumber,
    schoolConfigurationReleaseId: completion.schoolConfigurationReleaseId,
    completedAt: completion.completedAt.toISOString(),
  };
}

export function createLearningProgress(dependencies: {
  resolveStudentSession: (command: {
    sessionHandle: string;
  }) => Promise<StudentSessionContext | undefined>;
  store: LearningProgressStore;
  clock: Clock;
  ids: IdGenerator;
}) {
  return {
    async read(command: { sessionHandle: string; locale: LearningLocale }) {
      const session = await dependencies.resolveStudentSession({
        sessionHandle: command.sessionHandle,
      });
      if (!session) return undefined;
      if (session.activeClassMemberships.length === 0) {
        throw new StudentClassAccessRequiredError();
      }
      const state = await dependencies.store.readWorkspaceLearning({
        studentId: session.studentId,
        workspaceId: session.workspaceId,
      });
      if (!state.release) throw new LearningUnavailableError();
      const item = state.learningUnlocked
        ? (projectDisplayedLearningItem(state.release, command.locale) ?? null)
        : null;
      const completion = item
        ? (state.completions.find(
            (record) =>
              record.itemId === item.itemId &&
              record.revisionNumber === item.revisionNumber,
          ) ?? null)
        : null;
      return {
        learningUnlocked: state.learningUnlocked,
        schoolConfigurationReleaseId:
          state.release.schoolConfigurationReleaseId,
        locale: command.locale,
        item,
        completion: completion ? completionView(completion) : null,
      } satisfies StudentLearningSnapshot;
    },

    async acknowledge(command: AcknowledgeLearningItemCommand) {
      const session = await dependencies.resolveStudentSession({
        sessionHandle: command.sessionHandle,
      });
      if (!session) return undefined;
      if (session.activeClassMemberships.length === 0) {
        throw new StudentClassAccessRequiredError();
      }
      const submitted = await dependencies.store.acknowledge({
        studentId: session.studentId,
        workspaceId: session.workspaceId,
        operationId: command.operationId,
        requestBinding: requestBinding(command),
        proposedCompletionId: dependencies.ids.create(),
        expectedSchoolConfigurationReleaseId:
          command.expectedSchoolConfigurationReleaseId,
        itemId: command.itemId,
        revisionNumber: command.revisionNumber,
        completedAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
      });
      if (submitted.outcome === 'replayed') return submitted.result;
      return {
        operationId: command.operationId,
        itemCompletionId: submitted.completion.itemCompletionId,
        itemId: submitted.completion.itemId,
        revisionNumber: submitted.completion.revisionNumber,
        schoolConfigurationReleaseId:
          submitted.completion.schoolConfigurationReleaseId,
        completedAt: submitted.completion.completedAt.toISOString(),
        replayed: false,
      };
    },
  };
}

export type LearningProgress = ReturnType<typeof createLearningProgress>;
