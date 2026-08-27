export const providerNames = [
  'auth',
  'cron',
  'email',
  'postgres',
  'queue',
  'storage',
] as const;

export type ProviderName = (typeof providerNames)[number];

export type TelemetryEvent =
  | {
      name: 'http.request.completed';
      method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
      route:
        | 'create-school-workspace'
        | 'health'
        | 'staff-identities'
        | 'staff-sign-in'
        | 'staff-sign-in-totp'
        | 'staff-sign-out'
        | 'staff-session'
        | 'clinical-directory'
        | 'clinical-intake-reveal'
        | 'classes'
        | 'student-sign-in'
        | 'student-sign-in-verify'
        | 'student-session'
        | 'student-language'
        | 'student-intake'
        | 'student-intake-draft'
        | 'student-intake-reopen'
        | 'student-intake-rebase'
        | 'student-intake-submission'
        | 'student-learning'
        | 'student-learning-acknowledgement'
        | 'unknown';
      statusCode: number;
      durationMs: number;
    }
  | {
      name: 'provider.smoke.completed';
      provider: ProviderName;
      outcome: 'error' | 'ok';
      durationMs: number;
    }
  | {
      name: 'translation.generation.completed';
      adapter: 'google-cloud-translation-advanced';
      adapterVersion: string;
      model?: string;
      glossaryRevision: string;
      locale: 'es-US' | 'pt-BR' | 'fr-CA' | 'ht-HT';
      segmentCount: number;
      rejectedCount: number;
      outcome: 'error' | 'ok' | 'rejected';
      durationMs: number;
    };

export type Telemetry = {
  record(event: TelemetryEvent): void;
};

export function recordProviderChecks(
  telemetry: Telemetry,
  checks: readonly {
    name: ProviderName;
    status: 'error' | 'ok';
    durationMs: number;
  }[],
): void {
  for (const check of checks) {
    telemetry.record({
      name: 'provider.smoke.completed',
      provider: check.name,
      outcome: check.status,
      durationMs: check.durationMs,
    });
  }
}

const methods = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);
const routes = new Set([
  'create-school-workspace',
  'health',
  'staff-identities',
  'staff-sign-in',
  'staff-sign-in-totp',
  'staff-sign-out',
  'staff-session',
  'clinical-directory',
  'clinical-intake-reveal',
  'classes',
  'student-sign-in',
  'student-sign-in-verify',
  'student-session',
  'student-language',
  'student-intake',
  'student-intake-draft',
  'student-intake-reopen',
  'student-intake-rebase',
  'student-intake-submission',
  'student-learning',
  'student-learning-acknowledgement',
  'unknown',
]);
const providers = new Set<string>(providerNames);
const adapters = new Set(['google-cloud-translation-advanced']);
const managedLocales = new Set(['es-US', 'pt-BR', 'fr-CA', 'ht-HT']);
const generationOutcomes = new Set(['error', 'ok', 'rejected']);

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

export function createTelemetry(write: (line: string) => void): Telemetry {
  return {
    record(event) {
      if (event.name === 'http.request.completed') {
        write(
          JSON.stringify({
            name: event.name,
            method: methods.has(event.method) ? event.method : 'GET',
            route: routes.has(event.route) ? event.route : 'unknown',
            statusCode: safeNumber(event.statusCode),
            durationMs: safeNumber(event.durationMs),
          }),
        );
        return;
      }

      if (event.name === 'translation.generation.completed') {
        if (!adapters.has(event.adapter)) return;
        write(
          JSON.stringify({
            name: event.name,
            adapter: event.adapter,
            adapterVersion:
              typeof event.adapterVersion === 'string'
                ? event.adapterVersion.slice(0, 80)
                : 'unknown',
            ...(typeof event.model === 'string'
              ? { model: event.model.slice(0, 80) }
              : {}),
            glossaryRevision:
              typeof event.glossaryRevision === 'string'
                ? event.glossaryRevision.slice(0, 80)
                : 'unknown',
            locale: managedLocales.has(event.locale) ? event.locale : 'es-US',
            segmentCount: safeNumber(event.segmentCount),
            rejectedCount: safeNumber(event.rejectedCount),
            outcome: generationOutcomes.has(event.outcome)
              ? event.outcome
              : 'error',
            durationMs: safeNumber(event.durationMs),
          }),
        );
        return;
      }

      if (event.name !== 'provider.smoke.completed') return;
      if (!providers.has(event.provider)) return;
      write(
        JSON.stringify({
          name: event.name,
          provider: event.provider,
          outcome: event.outcome === 'ok' ? 'ok' : 'error',
          durationMs: safeNumber(event.durationMs),
        }),
      );
    },
  };
}
