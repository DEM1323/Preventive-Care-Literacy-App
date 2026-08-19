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
      route: 'create-school-workspace' | 'health' | 'unknown';
      statusCode: number;
      durationMs: number;
    }
  | {
      name: 'provider.smoke.completed';
      provider: ProviderName;
      outcome: 'error' | 'ok';
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
const routes = new Set(['create-school-workspace', 'health', 'unknown']);
const providers = new Set<string>(providerNames);

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
