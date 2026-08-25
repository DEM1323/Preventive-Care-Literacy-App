export const goldenJourneyRequiredConfigurationNames = [
  'STAGING_WEB_URL',
  'RAILWAY_STAGING_ORIGIN',
  'EXPECTED_COMMIT',
  'EXPECTED_GIT_TREE',
  'OPERATOR_PROVISIONING_TOKEN',
  'INVITATION_CONTROLLED_MAILBOX',
  'DATABASE_URL',
  'DATABASE_CA_CERT',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'SUPABASE_QUEUE_NAME',
  'SUPABASE_CRON_JOB_NAME',
  'RESEND_API_KEY',
  'PROVIDER_SMOKE_EMAIL',
  'PROVIDER_SMOKE_EMAIL_FROM',
  'PROVIDER_SMOKE_AUTH_EMAIL',
  'PROVIDER_SMOKE_AUTH_PASSWORD',
  'PROVIDER_SMOKE_AUTH_TOTP_SECRET',
] as const;

export type GoldenJourneyConfigurationName =
  (typeof goldenJourneyRequiredConfigurationNames)[number];

export class GoldenJourneyPreflightError extends Error {
  readonly missingNames: readonly string[];
  readonly code: 'PREFLIGHT_MISSING' | 'PREFLIGHT_REF' | 'PREFLIGHT_ORIGIN';

  constructor(
    missingNames: readonly string[],
    code:
      | 'PREFLIGHT_MISSING'
      | 'PREFLIGHT_REF'
      | 'PREFLIGHT_ORIGIN' = 'PREFLIGHT_MISSING',
  ) {
    super(
      code === 'PREFLIGHT_MISSING'
        ? `Golden journey preflight missing configuration: ${missingNames.join(', ')}`
        : 'Golden journey preflight rejected the launch gate',
    );
    this.name = 'GoldenJourneyPreflightError';
    this.missingNames = missingNames;
    this.code = code;
  }
}

export type GoldenJourneyPreflightResult =
  | { ok: true; missingNames: [] }
  | { ok: false; missingNames: GoldenJourneyConfigurationName[] };

function httpsUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function assertGoldenJourneyLaunchGate(
  environment: Record<string, string | undefined>,
): void {
  const ref = environment.GOLDEN_JOURNEY_REF ?? environment.GITHUB_REF;
  if (ref !== 'refs/heads/main') {
    throw new GoldenJourneyPreflightError([], 'PREFLIGHT_REF');
  }
  const staging = httpsUrl(environment.STAGING_WEB_URL);
  const railway = httpsUrl(environment.RAILWAY_STAGING_ORIGIN);
  if (!staging || !railway || staging.host !== railway.host) {
    throw new GoldenJourneyPreflightError([], 'PREFLIGHT_ORIGIN');
  }
}

export function reportGoldenJourneyPreflight(
  environment: Record<string, string | undefined>,
  options: { failClosed?: boolean } = {},
): GoldenJourneyPreflightResult {
  const missingNames = goldenJourneyRequiredConfigurationNames.filter(
    (name) => !environment[name]?.trim(),
  );
  if (missingNames.length === 0) {
    if (options.failClosed) assertGoldenJourneyLaunchGate(environment);
    return { ok: true, missingNames: [] };
  }
  if (options.failClosed) {
    throw new GoldenJourneyPreflightError(missingNames);
  }
  return { ok: false, missingNames: [...missingNames] };
}
