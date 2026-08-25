export const goldenJourneyRequiredConfigurationNames = [
  'STAGING_WEB_URL',
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

  constructor(missingNames: readonly string[]) {
    super(
      `Golden journey preflight missing configuration: ${missingNames.join(', ')}`,
    );
    this.name = 'GoldenJourneyPreflightError';
    this.missingNames = missingNames;
  }
}

export type GoldenJourneyPreflightResult =
  | { ok: true; missingNames: [] }
  | { ok: false; missingNames: GoldenJourneyConfigurationName[] };

export function reportGoldenJourneyPreflight(
  environment: Record<string, string | undefined>,
  options: { failClosed?: boolean } = {},
): GoldenJourneyPreflightResult {
  const missingNames = goldenJourneyRequiredConfigurationNames.filter(
    (name) => !environment[name]?.trim(),
  );
  if (missingNames.length === 0) {
    return { ok: true, missingNames: [] };
  }
  if (options.failClosed) {
    throw new GoldenJourneyPreflightError(missingNames);
  }
  return { ok: false, missingNames: [...missingNames] };
}
