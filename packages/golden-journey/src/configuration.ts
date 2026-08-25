export function normalizeGoldenJourneyEnvironment(
  environment: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...environment,
    STAGING_WEB_URL:
      environment.STAGING_WEB_URL || environment.RAILWAY_STAGING_ORIGIN,
    RAILWAY_STAGING_ORIGIN:
      environment.RAILWAY_STAGING_ORIGIN || environment.STAGING_WEB_URL,
    GOLDEN_JOURNEY_REF:
      environment.GOLDEN_JOURNEY_REF || environment.GITHUB_REF,
    EXPECTED_COMMIT: environment.EXPECTED_COMMIT || environment.GITHUB_SHA,
    DATABASE_URL:
      environment.DATABASE_URL || environment.SUPABASE_RUNTIME_DATABASE_URL,
  };
}

export function environmentHostFromOrigin(origin: string): string {
  return new URL(origin).hostname;
}
