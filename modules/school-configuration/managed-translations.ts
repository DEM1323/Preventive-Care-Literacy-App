export const translationAdapterId = 'google-cloud-translation-advanced';
export const translationAdapterVersion = 'managed-translation-adapter/v1';
export const translationGlossaryRevision = 'school-health-glossary/v1';
export const translationSegmentKinds = [
  'interface_string',
  'learning_module_field',
  'intake_question',
  'intake_answer_option',
] as const;
export const managedLocales = ['es-US', 'pt-BR', 'fr-CA', 'ht-HT'] as const;
export const canonicalLocale = 'en-US' as const;

export type TranslationSegmentKind = (typeof translationSegmentKinds)[number];
export type ManagedLocale = (typeof managedLocales)[number];
export type TranslationStatus = 'missing' | 'stale' | 'generated' | 'reviewed';
export type TranslationSafetyCode =
  | 'PLACEHOLDER'
  | 'NUMBER'
  | 'EMERGENCY_NUMBER'
  | 'DATE'
  | 'URL'
  | 'OPTION_COUNT'
  | 'STABLE_CODE'
  | 'REQUIRED_TERM'
  | 'NEGATION';

export type TranslationSegment = {
  kind: TranslationSegmentKind;
  path: string;
  sourceResourceId: string;
  sourceRevision: number;
  sourceText: string;
  locale: ManagedLocale;
  requiredTerms: string[];
  optionCodes: string[];
  optionCount: number | null;
  schoolEditable: boolean;
};

export type TranslationAdapterRequest = {
  segments: readonly TranslationSegment[];
};

export type TranslationAdapterOutput = {
  sourceResourceId: string;
  locale: ManagedLocale;
  text: string;
  model?: string;
};

export type TranslationAdapter = {
  readonly id: string;
  readonly version: string;
  readonly model: string | undefined;
  readonly glossaryRevision: string;
  translate(
    request: TranslationAdapterRequest,
  ): Promise<{ outputs: TranslationAdapterOutput[] }>;
};

export type ManagedTranslationProvenance = {
  adapter?: string;
  adapterVersion?: string;
  model?: string;
  glossaryRevision?: string;
  sourceRevision: number;
  generatedAt?: string;
  reviewer?: string;
  reviewedAt?: string;
};

export type ManagedTranslationItem = {
  path: string;
  locale: ManagedLocale;
  kind: TranslationSegmentKind;
  sourceResourceId: string;
  translationResourceId?: string;
  sourceRevision: number;
  status: TranslationStatus;
  schoolEditable: boolean;
  provenance?: ManagedTranslationProvenance;
};

export type ManagedTranslationSummary = {
  locale: ManagedLocale;
  missing: number;
  stale: number;
  generated: number;
  reviewed: number;
};

export type ManagedTranslationWork = {
  locales: ManagedTranslationSummary[];
  items: ManagedTranslationItem[];
};

export type TranslationGenerationRejection = {
  sourceResourceId: string;
  locale: ManagedLocale;
  code: TranslationSafetyCode | 'ADAPTER_REJECTED';
};

export type TranslationGenerationTelemetry = {
  adapter: string;
  adapterVersion: string;
  model?: string;
  glossaryRevision: string;
  locale: ManagedLocale;
  segmentCount: number;
  rejectedCount: number;
  outcome: 'ok' | 'rejected' | 'error';
};

export class UnsafeGeneratedTranslationError extends Error {
  readonly code = 'UNSAFE_GENERATED_TRANSLATION';
  constructor(readonly affectedValue?: string) {
    super('Generated Managed Translation output failed safety checks');
    this.name = 'UnsafeGeneratedTranslationError';
  }
}

export class TranslationProviderUnavailableError extends Error {
  readonly code = 'TRANSLATION_PROVIDER_UNAVAILABLE';
  constructor() {
    super('Managed Translation generation is unavailable');
    this.name = 'TranslationProviderUnavailableError';
  }
}

export class TranslationAdapterRejectedError extends Error {
  readonly code = 'TRANSLATION_ADAPTER_REJECTED';
  constructor(readonly affectedValue?: string) {
    super('The translation adapter rejected the request');
    this.name = 'TranslationAdapterRejectedError';
  }
}

export const productOwnedInterfaceCatalog = [
  {
    key: 'student.back',
    resourceId: '3b6c1d8e-2f47-4a91-9c0d-1e8a5b7c4d20',
    sourceResourceId: '9a4d2c1b-6e70-4f83-b1a2-0c5d8e7f6a31',
    source: 'Back',
  },
  {
    key: 'student.stepProgress',
    resourceId: '5e8f0a12-34b6-4c78-9d01-2f3a4b5c6d7e',
    sourceResourceId: '6f9a1b23-45c7-4d89-ae12-3a4b5c6d7e8f',
    source: 'Step {current} of {total}',
  },
  {
    key: 'student.submitIntake',
    resourceId: '7a0b2c34-56d8-4e90-bf23-4b5c6d7e8f90',
    sourceResourceId: '8b1c3d45-67e9-4f01-c034-5c6d7e8f9012',
    source: 'Submit intake',
  },
  {
    key: 'student.backToLearning',
    resourceId: '9c2d4e56-78f0-4012-d145-6d7e8f901234',
    sourceResourceId: '0d3e5f67-8901-4123-e256-7e8f90123456',
    source: 'Back to learning space',
  },
] as const;

const glossaryTerms = ['911', 'Massachusetts', 'School Nurse'] as const;
const placeholderPattern = /\{[A-Za-z][A-Za-z0-9]*\}/g;
const numberPattern = /\d+(?:\.\d+)?/g;
const datePattern = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;
const urlPattern = /https:\/\/[^\s<>]+/g;
const emergencyNumberPattern = /\b911\b/g;
const substitutedEmergencyPattern = /\b(?:112|192)\b/;
const sourceNegationPattern =
  /\b(?:do not|don't|does not|doesn't|never|not|no)\b/i;
const generatedNegationPattern =
  /\b(?:do not|don't|does not|doesn't|never|not|no|non|jamais|não|nao|nunca|pas|pa)\b/i;

export const translationSafetyRegressionFixtures: ReadonlyArray<{
  name: string;
  source: string;
  generated: string;
  kind: TranslationSegmentKind;
  requiredTerms?: string[];
  optionCodes?: string[];
  optionCount?: number;
  receivedOptionCount?: number;
  code: TranslationSafetyCode | undefined;
}> = [
  {
    name: 'placeholders survive',
    source: 'Step {current} of {total}',
    generated: 'Paso {current} de {total}',
    kind: 'interface_string',
    code: undefined,
  },
  {
    name: 'placeholder mutation',
    source: 'Step {current} of {total}',
    generated: 'Paso actual de {total}',
    kind: 'interface_string',
    code: 'PLACEHOLDER',
  },
  {
    name: 'emergency number preserved',
    source:
      'For a life-threatening emergency, call 911 or go to an emergency room.',
    generated:
      'Para una emergencia que amenaza la vida, llame al 911 o vaya a una sala de emergencias.',
    kind: 'learning_module_field',
    requiredTerms: ['911'],
    code: undefined,
  },
  {
    name: 'emergency number substituted with 112',
    source:
      'For a life-threatening emergency, call 911 or go to an emergency room.',
    generated:
      'Para una emergencia que amenaza la vida, llame al 112 o vaya a una sala de emergencias.',
    kind: 'learning_module_field',
    requiredTerms: ['911'],
    code: 'EMERGENCY_NUMBER',
  },
  {
    name: 'emergency number substituted with 192',
    source:
      'For a life-threatening emergency, call 911 or go to an emergency room.',
    generated:
      'Para uma emergência com risco de vida, ligue 192 (or 911, depending on the region).',
    kind: 'learning_module_field',
    requiredTerms: ['911'],
    code: 'EMERGENCY_NUMBER',
  },
  {
    name: 'number mutation',
    source: 'Return in 7 days.',
    generated: 'Regrese en 8 días.',
    kind: 'learning_module_field',
    code: 'NUMBER',
  },
  {
    name: 'date mutation',
    source: 'The form opens on 2026-09-01.',
    generated: 'El formulario abre el 2026-09-02.',
    kind: 'intake_question',
    code: 'DATE',
  },
  {
    name: 'url mutation',
    source: 'Read more at https://www.mass.gov/info-details/school-health',
    generated: 'Lea más en https://example.invalid/school-health',
    kind: 'learning_module_field',
    code: 'URL',
  },
  {
    name: 'option count mutation',
    source: 'Yes',
    generated: 'Sí',
    kind: 'intake_answer_option',
    optionCount: 2,
    receivedOptionCount: 1,
    code: 'OPTION_COUNT',
  },
  {
    name: 'stable code leaked into generated text',
    source: 'Yes',
    generated: 'yes',
    kind: 'intake_answer_option',
    optionCodes: ['yes', 'no'],
    code: 'STABLE_CODE',
  },
  {
    name: 'required term dropped',
    source: 'Ask your School Nurse which Massachusetts records apply.',
    generated: 'Pregunte qué registros aplican.',
    kind: 'learning_module_field',
    requiredTerms: ['School Nurse', 'Massachusetts'],
    code: 'REQUIRED_TERM',
  },
  {
    name: 'negation-sensitive mutation',
    source: 'Do not wait for an urgent care appointment.',
    generated: 'Espere una cita de atención urgente.',
    kind: 'learning_module_field',
    code: 'NEGATION',
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sortedCopy(values: string[]): string[] {
  return [...values].sort();
}

export function shieldPlaceholders(text: string): {
  shielded: string;
  tokens: string[];
} {
  const tokens: string[] = [];
  const shielded = text.replace(placeholderPattern, (match) => {
    const token = `⟦PH${tokens.length}⟧`;
    tokens.push(match);
    return token;
  });
  return { shielded, tokens };
}

export function restorePlaceholders(text: string, tokens: string[]): string {
  return tokens.reduce(
    (current, token, index) => current.replaceAll(`⟦PH${index}⟧`, token),
    text,
  );
}

export function validateTranslationSafety(input: {
  source: string;
  generated: string;
  kind: TranslationSegmentKind;
  requiredTerms?: string[];
  optionCodes?: string[];
  optionCount?: number;
  receivedOptionCount?: number;
}): TranslationSafetyCode | undefined {
  const sourcePlaceholders = input.source.match(placeholderPattern) ?? [];
  const generatedPlaceholders = input.generated.match(placeholderPattern) ?? [];
  if (
    sortedCopy(sourcePlaceholders).join('\0') !==
    sortedCopy(generatedPlaceholders).join('\0')
  ) {
    return 'PLACEHOLDER';
  }
  const sourceWithoutPlaceholders = input.source.replace(
    placeholderPattern,
    ' ',
  );
  const generatedWithoutPlaceholders = input.generated.replace(
    placeholderPattern,
    ' ',
  );
  const sourceEmergencies =
    sourceWithoutPlaceholders.match(emergencyNumberPattern) ?? [];
  const generatedEmergencies =
    generatedWithoutPlaceholders.match(emergencyNumberPattern) ?? [];
  if (
    sourceEmergencies.length !== generatedEmergencies.length ||
    (sourceEmergencies.length > 0 &&
      substitutedEmergencyPattern.test(generatedWithoutPlaceholders))
  ) {
    return 'EMERGENCY_NUMBER';
  }
  const sourceDates = input.source.match(datePattern) ?? [];
  const generatedDates = input.generated.match(datePattern) ?? [];
  if (
    sortedCopy(sourceDates).join('\0') !== sortedCopy(generatedDates).join('\0')
  ) {
    return 'DATE';
  }
  const sourceForNumbers = sourceWithoutPlaceholders.replace(datePattern, ' ');
  const generatedForNumbers = generatedWithoutPlaceholders.replace(
    datePattern,
    ' ',
  );
  const sourceNumbers = sourceForNumbers.match(numberPattern) ?? [];
  const generatedNumbers = generatedForNumbers.match(numberPattern) ?? [];
  if (
    sortedCopy(sourceNumbers).join('\0') !==
    sortedCopy(generatedNumbers).join('\0')
  ) {
    return 'NUMBER';
  }
  const sourceUrls = input.source.match(urlPattern) ?? [];
  const generatedUrls = input.generated.match(urlPattern) ?? [];
  if (
    sortedCopy(sourceUrls).join('\0') !== sortedCopy(generatedUrls).join('\0')
  ) {
    return 'URL';
  }
  if (
    input.optionCount != null &&
    input.receivedOptionCount != null &&
    input.optionCount !== input.receivedOptionCount
  ) {
    return 'OPTION_COUNT';
  }
  if (
    input.kind === 'intake_answer_option' &&
    (input.optionCodes ?? []).includes(input.generated.trim())
  ) {
    return 'STABLE_CODE';
  }
  const requiredTerms = unique([
    ...(input.requiredTerms ?? []),
    ...glossaryTerms.filter((term) => input.source.includes(term)),
  ]);
  if (requiredTerms.some((term) => !input.generated.includes(term))) {
    return 'REQUIRED_TERM';
  }
  if (
    sourceNegationPattern.test(input.source) &&
    !generatedNegationPattern.test(input.generated)
  ) {
    return 'NEGATION';
  }
  return undefined;
}

export function assertApprovedTranslationRequest(
  request: TranslationAdapterRequest,
): void {
  if (request.segments.length === 0) {
    throw new TranslationAdapterRejectedError('segments');
  }
  for (const segment of request.segments) {
    if (
      !(translationSegmentKinds as readonly string[]).includes(segment.kind)
    ) {
      throw new TranslationAdapterRejectedError('kind');
    }
    if (!(managedLocales as readonly string[]).includes(segment.locale)) {
      throw new TranslationAdapterRejectedError('locale');
    }
    if (!segment.sourceResourceId || !segment.sourceText.trim()) {
      throw new TranslationAdapterRejectedError('source');
    }
  }
}

export function createUnavailableTranslationAdapter(): TranslationAdapter {
  return {
    id: translationAdapterId,
    version: translationAdapterVersion,
    model: undefined,
    glossaryRevision: translationGlossaryRevision,
    async translate() {
      throw new TranslationProviderUnavailableError();
    },
  };
}

export function classifyTranslationKind(
  path: string,
): TranslationSegmentKind | undefined {
  if (
    /\.options(?:\[[^\]]+\])?\.label$/.test(path) ||
    path.includes('.options[')
  ) {
    if (path.endsWith('.label') || path.endsWith('.label.en-US')) {
      return 'intake_answer_option';
    }
  }
  if (
    path.includes('interfaceStrings') ||
    path.includes('workspace.branding') ||
    path.includes('submissionAttestation')
  ) {
    return 'interface_string';
  }
  if (path.includes('intakeForm')) return 'intake_question';
  if (path.includes('release.modules')) return 'learning_module_field';
  return undefined;
}

export function translationBoundRevision(
  localized: Record<string, unknown>,
): number {
  return Number(localized.sourceRevision ?? 1);
}

export function translationStatusFor(
  english: Record<string, unknown> | undefined,
  localized: Record<string, unknown> | undefined,
): TranslationStatus {
  if (
    !localized ||
    typeof localized.value !== 'string' ||
    localized.value.trim().length === 0
  ) {
    return 'missing';
  }
  const sourceRevision = Number(english?.revision ?? 1);
  const boundRevision = translationBoundRevision(localized);
  if (boundRevision !== sourceRevision) return 'stale';
  if (typeof localized.reviewProvenanceId === 'string') return 'reviewed';
  return 'generated';
}

function localizedMapOf(
  value: unknown,
): Record<string, Record<string, unknown>> | undefined {
  if (!isRecord(value) || !isRecord(value['en-US'])) return undefined;
  const english = value['en-US'];
  if (typeof english.id !== 'string' || typeof english.value !== 'string') {
    return undefined;
  }
  return value as Record<string, Record<string, unknown>>;
}

export function extractTranslatableSegments(
  candidate: unknown,
  locale: ManagedLocale,
): TranslationSegment[] {
  const segments: TranslationSegment[] = [];
  const seen = new Set<string>();

  function visit(
    value: unknown,
    path: string,
    parent: Record<string, unknown> | undefined,
  ): void {
    if (Array.isArray(value)) {
      value.forEach((child, index) =>
        visit(child, `${path}[${index}]`, parent),
      );
      return;
    }
    const localized = localizedMapOf(value);
    if (localized) {
      const kind = classifyTranslationKind(path);
      if (!kind) return;
      const english = localized['en-US'];
      const optionCodes =
        kind === 'intake_answer_option' && typeof parent?.code === 'string'
          ? [parent.code]
          : [];
      const segment: TranslationSegment = {
        kind,
        path,
        sourceResourceId: String(english.id),
        sourceRevision: Number(english.revision ?? 1),
        sourceText: String(english.value),
        locale,
        requiredTerms: glossaryTerms.filter((term) =>
          String(english.value).includes(term),
        ),
        optionCodes,
        optionCount: kind === 'intake_answer_option' ? 1 : null,
        schoolEditable: !path.includes('interfaceStrings'),
      };
      const key = `${segment.sourceResourceId}:${locale}`;
      if (!seen.has(key)) {
        seen.add(key);
        segments.push(segment);
      }
      return;
    }
    if (!isRecord(value)) return;
    Object.entries(value).forEach(([childKey, child]) =>
      visit(child, path ? `${path}.${childKey}` : childKey, value),
    );
  }

  visit(candidate, '', undefined);
  for (const entry of productOwnedInterfaceCatalog) {
    const key = `${entry.sourceResourceId}:${locale}`;
    if (seen.has(key)) continue;
    seen.add(key);
    segments.push({
      kind: 'interface_string',
      path: `release.interfaceStrings.${entry.key}.text`,
      sourceResourceId: entry.sourceResourceId,
      sourceRevision: 1,
      sourceText: entry.source,
      locale,
      requiredTerms: glossaryTerms.filter((term) =>
        entry.source.includes(term),
      ),
      optionCodes: [],
      optionCount: null,
      schoolEditable: false,
    });
  }
  return segments;
}

function provenanceFrom(
  localized: Record<string, unknown> | undefined,
  sourceRevision: number,
): ManagedTranslationProvenance | undefined {
  if (!localized) return { sourceRevision };
  const generation = isRecord(localized.generation)
    ? localized.generation
    : undefined;
  return {
    adapter:
      typeof generation?.adapter === 'string' ? generation.adapter : undefined,
    adapterVersion:
      typeof generation?.adapterVersion === 'string'
        ? generation.adapterVersion
        : undefined,
    model: typeof generation?.model === 'string' ? generation.model : undefined,
    glossaryRevision:
      typeof generation?.glossaryRevision === 'string'
        ? generation.glossaryRevision
        : undefined,
    sourceRevision: translationBoundRevision(localized),
    generatedAt:
      typeof generation?.generatedAt === 'string'
        ? generation.generatedAt
        : undefined,
    reviewer:
      typeof localized.reviewer === 'string' ? localized.reviewer : undefined,
    reviewedAt:
      typeof localized.reviewedAt === 'string'
        ? localized.reviewedAt
        : undefined,
  };
}

export function presentManagedTranslations(
  candidate: unknown,
): ManagedTranslationWork {
  const items: ManagedTranslationItem[] = [];
  for (const locale of managedLocales) {
    const segments = extractTranslatableSegments(candidate, locale);
    for (const segment of segments) {
      const localized = findLocalizedValue(
        candidate,
        segment.sourceResourceId,
        locale,
      );
      const english = findLocalizedValue(
        candidate,
        segment.sourceResourceId,
        canonicalLocale,
      );
      const status = translationStatusFor(english, localized);
      items.push({
        path: `${segment.path}.${locale}`,
        locale,
        kind: segment.kind,
        sourceResourceId: segment.sourceResourceId,
        ...(localized && typeof localized.id === 'string'
          ? { translationResourceId: String(localized.id) }
          : {}),
        sourceRevision: segment.sourceRevision,
        status,
        schoolEditable: segment.schoolEditable,
        provenance: provenanceFrom(localized, segment.sourceRevision),
      });
    }
  }
  return {
    locales: managedLocales.map((locale) => {
      const localeItems = items.filter((item) => item.locale === locale);
      return {
        locale,
        missing: localeItems.filter((item) => item.status === 'missing').length,
        stale: localeItems.filter((item) => item.status === 'stale').length,
        generated: localeItems.filter((item) => item.status === 'generated')
          .length,
        reviewed: localeItems.filter((item) => item.status === 'reviewed')
          .length,
      };
    }),
    items,
  };
}

export function findLocalizedValue(
  candidate: unknown,
  sourceResourceId: string,
  locale: string,
): Record<string, unknown> | undefined {
  const map = findLocalizedMap(candidate, sourceResourceId);
  if (!map) return undefined;
  const localized = map[locale];
  return isRecord(localized) ? localized : undefined;
}

export function findLocalizedMap(
  candidate: unknown,
  sourceResourceId: string,
): Record<string, unknown> | undefined {
  function visit(value: unknown): Record<string, unknown> | undefined {
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = visit(child);
        if (found) return found;
      }
      return undefined;
    }
    const localized = localizedMapOf(value);
    if (localized && String(localized['en-US'].id) === sourceResourceId) {
      return value as Record<string, unknown>;
    }
    if (!isRecord(value)) return undefined;
    for (const child of Object.values(value)) {
      const found = visit(child);
      if (found) return found;
    }
    return undefined;
  }
  return visit(candidate);
}

function ensureInterfaceString(
  candidate: unknown,
  sourceResourceId: string,
): Record<string, unknown> | undefined {
  const existing = findLocalizedMap(candidate, sourceResourceId);
  if (existing) return existing;
  const entry = productOwnedInterfaceCatalog.find(
    (item) => item.sourceResourceId === sourceResourceId,
  );
  if (!entry || !isRecord(candidate) || !isRecord(candidate.release)) {
    return undefined;
  }
  const text: Record<string, unknown> = {
    [canonicalLocale]: {
      id: entry.sourceResourceId,
      revision: 1,
      value: entry.source,
      origin: 'product-owned',
    },
  };
  const resource = {
    id: entry.resourceId,
    revision: 1,
    key: entry.key,
    schoolEditable: false,
    text,
  };
  const current = candidate.release.interfaceStrings;
  candidate.release.interfaceStrings = Array.isArray(current)
    ? [...current, resource]
    : [resource];
  return text;
}

export function applyGeneratedTranslations(input: {
  candidate: unknown;
  locale: ManagedLocale;
  outputs: TranslationAdapterOutput[];
  adapter: Pick<
    TranslationAdapter,
    'id' | 'version' | 'model' | 'glossaryRevision'
  >;
  generatedAt: Date;
  ids: { create(): string };
  requestedSourceIds?: string[];
}): {
  candidate: unknown;
  rejected: TranslationGenerationRejection[];
  written: number;
} {
  const next = structuredClone(input.candidate);
  const requested = new Set(
    (input.requestedSourceIds ?? []).filter((id) => id.length > 0),
  );
  const segments = extractTranslatableSegments(next, input.locale).filter(
    (segment) =>
      requested.size === 0 || requested.has(segment.sourceResourceId),
  );
  const bySource = new Map(
    input.outputs
      .filter((output) => output.locale === input.locale)
      .map((output) => [output.sourceResourceId, output]),
  );
  const rejected: TranslationGenerationRejection[] = [];
  let written = 0;
  for (const segment of segments) {
    const map =
      findLocalizedMap(next, segment.sourceResourceId) ??
      ensureInterfaceString(next, segment.sourceResourceId);
    if (!map) continue;
    const englishValue = map[canonicalLocale];
    const existingValue = map[input.locale];
    const english = isRecord(englishValue) ? englishValue : undefined;
    const existing = isRecord(existingValue) ? existingValue : undefined;
    if (translationStatusFor(english, existing) === 'reviewed') continue;
    const output = bySource.get(segment.sourceResourceId);
    if (!output) {
      rejected.push({
        sourceResourceId: segment.sourceResourceId,
        locale: input.locale,
        code: 'ADAPTER_REJECTED',
      });
      continue;
    }
    const restored = restorePlaceholders(
      output.text,
      shieldPlaceholders(segment.sourceText).tokens,
    );
    const code = validateTranslationSafety({
      source: segment.sourceText,
      generated: restored,
      kind: segment.kind,
      requiredTerms: segment.requiredTerms,
      optionCodes: segment.optionCodes,
      optionCount: segment.optionCount ?? undefined,
    });
    if (code) {
      rejected.push({
        sourceResourceId: segment.sourceResourceId,
        locale: input.locale,
        code,
      });
      continue;
    }
    map[input.locale] = {
      id:
        existing && typeof existing.id === 'string'
          ? existing.id
          : input.ids.create(),
      revision:
        existing && Number.isInteger(existing.revision) ? existing.revision : 1,
      value: restored,
      origin: 'generated',
      sourceRevision: Number(english?.revision ?? segment.sourceRevision),
      generation: {
        adapter: input.adapter.id,
        adapterVersion: input.adapter.version,
        model: output.model ?? input.adapter.model,
        glossaryRevision: input.adapter.glossaryRevision,
        generatedAt: input.generatedAt.toISOString(),
      },
    };
    written += 1;
  }
  return { candidate: next, rejected, written };
}

export function applyManagedTranslationEdit(input: {
  candidate: unknown;
  sourceResourceId: string;
  locale: ManagedLocale;
  text: string;
  ids: { create(): string };
}): unknown {
  const next = structuredClone(input.candidate);
  const map = findLocalizedMap(next, input.sourceResourceId);
  if (!map || !isRecord(map[canonicalLocale])) {
    throw new UnsafeGeneratedTranslationError(input.sourceResourceId);
  }
  const existingValue = map[input.locale];
  const existing = isRecord(existingValue) ? existingValue : undefined;
  map[input.locale] = {
    id:
      existing && typeof existing.id === 'string'
        ? existing.id
        : input.ids.create(),
    revision: existing?.revision ?? 1,
    value: input.text,
    origin: 'reviewer-edited',
    sourceRevision: Number(map[canonicalLocale].revision ?? 1),
    ...(isRecord(existing?.generation)
      ? { generation: existing.generation }
      : {}),
  };
  return next;
}

export function applyManagedTranslationReview(input: {
  candidate: unknown;
  sourceResourceId: string;
  locale: ManagedLocale;
  reviewProvenanceId: string;
  reviewer: string;
  reviewedAt: Date;
}): unknown {
  const next = structuredClone(input.candidate);
  const map = findLocalizedMap(next, input.sourceResourceId);
  const existingValue = map?.[input.locale];
  const englishValue = map?.[canonicalLocale];
  const existing = isRecord(existingValue) ? existingValue : undefined;
  const english = isRecord(englishValue) ? englishValue : undefined;
  if (!map || !existing || typeof existing.value !== 'string' || !english) {
    throw new UnsafeGeneratedTranslationError(input.sourceResourceId);
  }
  if (translationStatusFor(english, existing) === 'stale') {
    throw new UnsafeGeneratedTranslationError(
      `${input.sourceResourceId}.${input.locale}`,
    );
  }
  map[input.locale] = {
    ...existing,
    sourceRevision: Number(english.revision ?? 1),
    reviewProvenanceId: input.reviewProvenanceId,
    reviewer: input.reviewer,
    reviewedAt: input.reviewedAt.toISOString(),
  };
  return next;
}
