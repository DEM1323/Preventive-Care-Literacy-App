import { expect, test } from 'bun:test';
import {
  DeployStagingPreflightError,
  deployStagingRequiredSecretNames,
  goldenJourneyRequiredConfigurationNames,
  GoldenJourneyPreflightError,
  reportDeployStagingPreflight,
  reportGoldenJourneyPreflight,
} from '../../packages/golden-journey/src/index.ts';

const present = {
  STAGING_WEB_URL: 'https://staging.up.railway.app',
  RAILWAY_STAGING_ORIGIN: 'https://staging.up.railway.app',
  GOLDEN_JOURNEY_REF: 'refs/heads/main',
  EXPECTED_COMMIT: 'beda69fca3f7954a0200a3209cb44aac7ade4a72',
  EXPECTED_GIT_TREE: '0123456789abcdef0123456789abcdef01234567',
  OPERATOR_PROVISIONING_TOKEN: 'operator-token-with-more-than-32-chars',
  INVITATION_CONTROLLED_MAILBOX: 'controlled@example.test',
  DATABASE_URL: 'postgresql://runtime:secret@db.project-ref.supabase.co/app',
  DATABASE_CA_CERT:
    '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
  SUPABASE_PROJECT_REF: 'project-ref',
  SUPABASE_URL: 'https://project-ref.supabase.co',
  SUPABASE_SECRET_KEY: 'supabase-secret',
  SUPABASE_STORAGE_BUCKET: 'private-records',
  SUPABASE_QUEUE_NAME: 'provider-smoke',
  SUPABASE_CRON_JOB_NAME: 'provider-smoke',
  RESEND_API_KEY: 're-secret',
  PROVIDER_SMOKE_EMAIL: 'smoke@example.test',
  PROVIDER_SMOKE_EMAIL_FROM: 'Staging <sender@example.test>',
  PROVIDER_SMOKE_AUTH_EMAIL: 'auth-smoke@example.test',
  PROVIDER_SMOKE_AUTH_PASSWORD: 'auth-smoke-password',
  PROVIDER_SMOKE_AUTH_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
};

test('preflight reports only missing configuration names and does not emit values', () => {
  const result = reportGoldenJourneyPreflight({
    STAGING_WEB_URL: present.STAGING_WEB_URL,
    EXPECTED_COMMIT: present.EXPECTED_COMMIT,
  });

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected failure');
  expect(result.missingNames).toContain('OPERATOR_PROVISIONING_TOKEN');
  expect(result.missingNames).toContain('INVITATION_CONTROLLED_MAILBOX');
  expect(result.missingNames).toContain('RESEND_API_KEY');
  expect(JSON.stringify(result)).not.toContain(
    'https://staging.up.railway.app',
  );
  expect(JSON.stringify(result)).not.toContain(
    'beda69fca3f7954a0200a3209cb44aac7ade4a72',
  );
  expect(JSON.stringify(result)).not.toContain('controlled@example.test');
});

test('preflight fails closed before any partial journey when required names are absent', () => {
  expect(() =>
    reportGoldenJourneyPreflight(
      { STAGING_WEB_URL: present.STAGING_WEB_URL },
      { failClosed: true },
    ),
  ).toThrow(GoldenJourneyPreflightError);

  try {
    reportGoldenJourneyPreflight({}, { failClosed: true });
  } catch (error) {
    expect(error).toBeInstanceOf(GoldenJourneyPreflightError);
    const message = String(error);
    expect(message).toContain('OPERATOR_PROVISIONING_TOKEN');
    expect(message).toContain('STAGING_WEB_URL');
    expect(message).not.toContain('secret');
    expect(message).not.toContain('password');
    return;
  }
  throw new Error('expected fail-closed preflight to throw');
});

test('preflight accepts a complete configuration by name without returning secret values', () => {
  const result = reportGoldenJourneyPreflight(present, { failClosed: true });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected success');
  expect(result.missingNames).toEqual([]);
  expect(JSON.stringify(result)).not.toContain('re-secret');
  expect(JSON.stringify(result)).not.toContain('auth-smoke-password');
  expect(JSON.stringify(result)).not.toContain('JBSWY3DPEHPK3PXP');
});

test('deploy and golden journey share the operator token name and fail closed without logging its value', () => {
  const tokenValue = 'operator-token-with-more-than-32-chars';

  expect(deployStagingRequiredSecretNames).toEqual([
    'OPERATOR_PROVISIONING_TOKEN',
  ]);
  expect(goldenJourneyRequiredConfigurationNames).toContain(
    'OPERATOR_PROVISIONING_TOKEN',
  );

  const missing = reportDeployStagingPreflight({
    OPERATOR_PROVISIONING_TOKEN: '   ',
  });
  expect(missing.ok).toBe(false);
  if (missing.ok) throw new Error('expected failure');
  expect(missing.missingNames).toEqual(['OPERATOR_PROVISIONING_TOKEN']);
  expect(JSON.stringify(missing)).not.toContain(tokenValue);

  try {
    reportDeployStagingPreflight({}, { failClosed: true });
  } catch (error) {
    expect(error).toBeInstanceOf(DeployStagingPreflightError);
    const message = String(error);
    expect(message).toContain('OPERATOR_PROVISIONING_TOKEN');
    expect(message).toContain('Deploy staging');
    expect(message).not.toContain(tokenValue);
    expect(message).not.toContain('secret');

    const present = reportDeployStagingPreflight(
      { OPERATOR_PROVISIONING_TOKEN: tokenValue },
      { failClosed: true },
    );
    expect(present.ok).toBe(true);
    if (!present.ok) throw new Error('expected success');
    expect(present.missingNames).toEqual([]);
    expect(JSON.stringify(present)).not.toContain(tokenValue);
    return;
  }
  throw new Error('expected fail-closed deploy preflight to throw');
});

test('preflight rejects a non-main ref or a non-https Railway origin before mutation', () => {
  expect(() =>
    reportGoldenJourneyPreflight(
      {
        ...present,
        GOLDEN_JOURNEY_REF: 'refs/heads/verify/golden-staging-journey',
      },
      { failClosed: true },
    ),
  ).toThrow('launch gate');

  expect(() =>
    reportGoldenJourneyPreflight(
      { ...present, STAGING_WEB_URL: 'http://staging.up.railway.app' },
      { failClosed: true },
    ),
  ).toThrow('launch gate');

  expect(() =>
    reportGoldenJourneyPreflight(
      {
        ...present,
        RAILWAY_STAGING_ORIGIN: 'https://other.up.railway.app',
      },
      { failClosed: true },
    ),
  ).toThrow('launch gate');
});
