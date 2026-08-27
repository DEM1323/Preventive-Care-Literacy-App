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
  href: string | null;
  moduleId: string;
  moduleTitle: string;
};

export type ItemCompletionView = {
  itemCompletionId: string;
  itemId: string;
  revisionNumber: number;
  schoolConfigurationReleaseId: string;
  completedAt: string;
};

export type ProjectedLearningItem = DisplayedLearningItem & {
  completion: ItemCompletionView | null;
};

export type LearningSectionProjection = {
  kind: LearningItemKind;
  completedCount: number;
  totalCount: number;
  percentComplete: number;
  items: ProjectedLearningItem[];
};

export type LearningBadgeProjection = {
  key: string;
  name: string;
  earned: boolean;
};

export type LearningModuleProjection = {
  moduleId: string;
  title: string;
  completed: boolean;
  badge: LearningBadgeProjection | null;
  sections: LearningSectionProjection[];
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
  modules: LearningModuleProjection[];
  item: DisplayedLearningItem | null;
  completion: ItemCompletionView | null;
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

const sectionCollections = [
  ['knowledgeItems', 'knowledge'],
  ['skillItems', 'skill'],
  ['applicationItems', 'application'],
] as const;

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

function localizedTextWithFallback(
  value: unknown,
  locale: LearningLocale,
): string | undefined {
  return (
    localizedText(value, locale) ??
    (locale === 'en-US' ? undefined : localizedText(value, 'en-US'))
  );
}

function authoredItems(
  module: Record<string, unknown>,
  collection: 'knowledgeItems' | 'skillItems' | 'applicationItems',
): Record<string, unknown>[] {
  const items = module[collection];
  if (!Array.isArray(items)) return [];
  return items
    .flatMap((item) => (isRecord(item) ? [item] : []))
    .filter((item) => Number.isInteger(item.order))
    .sort((left, right) => Number(left.order) - Number(right.order));
}

function releasedModules(release: ActiveLearningRelease) {
  return release.modules
    .map((module) => module.payload)
    .filter(
      (payload): payload is Record<string, unknown> & { id: string } =>
        typeof payload.id === 'string' && Number.isInteger(payload.order),
    )
    .sort((left, right) => Number(left.order) - Number(right.order));
}

function itemHref(item: Record<string, unknown>): string | null {
  return typeof item.href === 'string' && item.href.length > 0
    ? item.href
    : null;
}

function projectItem(
  item: Record<string, unknown>,
  kind: LearningItemKind,
  moduleId: string,
  moduleTitle: string,
  locale: LearningLocale,
): DisplayedLearningItem | undefined {
  if (typeof item.id !== 'string' || !Number.isInteger(item.revision)) {
    return undefined;
  }
  const text = localizedTextWithFallback(item.text, locale) ?? '';
  return {
    itemId: item.id,
    revisionNumber: Number(item.revision),
    kind,
    text,
    href: itemHref(item),
    moduleId,
    moduleTitle,
  };
}

function percentComplete(completedCount: number, totalCount: number): number {
  if (totalCount === 0) return 0;
  return Math.floor((completedCount * 100) / totalCount);
}

function completionView(completion: StoredItemCompletion): ItemCompletionView {
  return {
    itemCompletionId: completion.itemCompletionId,
    itemId: completion.itemId,
    revisionNumber: completion.revisionNumber,
    schoolConfigurationReleaseId: completion.schoolConfigurationReleaseId,
    completedAt: completion.completedAt.toISOString(),
  };
}

function matchingCompletion(
  completions: StoredItemCompletion[],
  item: DisplayedLearningItem,
): ItemCompletionView | null {
  const completion = completions.find(
    (record) =>
      record.itemId === item.itemId &&
      record.revisionNumber === item.revisionNumber,
  );
  return completion ? completionView(completion) : null;
}

function projectBadge(
  module: Record<string, unknown>,
  locale: LearningLocale,
  earned: boolean,
): LearningBadgeProjection | null {
  if (!isRecord(module.badge) || typeof module.badge.key !== 'string') {
    return null;
  }
  const name = localizedTextWithFallback(module.badge.name, locale);
  if (!name) return null;
  return { key: module.badge.key, name, earned };
}

export function projectLearningProgress(
  release: ActiveLearningRelease,
  locale: LearningLocale,
  completions: StoredItemCompletion[],
): {
  modules: LearningModuleProjection[];
  item: DisplayedLearningItem | null;
  completion: ItemCompletionView | null;
} {
  const modules = releasedModules(release).flatMap((module) => {
    const moduleTitle = localizedTextWithFallback(module.title, locale);
    if (!moduleTitle) return [];
    const sections = sectionCollections.map(([collection, kind]) => {
      const items = authoredItems(module, collection).flatMap((item) => {
        const displayed = projectItem(
          item,
          kind,
          module.id,
          moduleTitle,
          locale,
        );
        if (!displayed) return [];
        return [
          {
            ...displayed,
            completion: matchingCompletion(completions, displayed),
          } satisfies ProjectedLearningItem,
        ];
      });
      const completedCount = items.filter(
        (item) => item.completion !== null,
      ).length;
      return {
        kind,
        completedCount,
        totalCount: items.length,
        percentComplete: percentComplete(completedCount, items.length),
        items,
      } satisfies LearningSectionProjection;
    });
    const completed = sections.every(
      (section) => section.completedCount === section.totalCount,
    );
    return [
      {
        moduleId: module.id,
        title: moduleTitle,
        completed,
        badge: projectBadge(module, locale, completed),
        sections,
      } satisfies LearningModuleProjection,
    ];
  });
  const resume = modules
    .flatMap((module) => module.sections.flatMap((section) => section.items))
    .find((item) => item.completion === null);
  if (!resume) {
    return { modules, item: null, completion: null };
  }
  return {
    modules,
    item: {
      itemId: resume.itemId,
      revisionNumber: resume.revisionNumber,
      kind: resume.kind,
      text: resume.text,
      href: resume.href,
      moduleId: resume.moduleId,
      moduleTitle: resume.moduleTitle,
    },
    completion: null,
  };
}

export function releasedItemMatches(
  release: ActiveLearningRelease,
  itemId: string,
  revisionNumber: number,
): boolean {
  return releasedModules(release).some((module) =>
    sectionCollections.some(([collection]) =>
      authoredItems(module, collection).some(
        (item) =>
          item.id === itemId && Number(item.revision) === revisionNumber,
      ),
    ),
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
    !releasedItemMatches(input.release, input.itemId, input.revisionNumber)
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
      const projection = state.learningUnlocked
        ? projectLearningProgress(
            state.release,
            command.locale,
            state.completions,
          )
        : { modules: [], item: null, completion: null };
      return {
        learningUnlocked: state.learningUnlocked,
        schoolConfigurationReleaseId:
          state.release.schoolConfigurationReleaseId,
        locale: command.locale,
        modules: projection.modules,
        item: projection.item,
        completion: projection.completion,
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
