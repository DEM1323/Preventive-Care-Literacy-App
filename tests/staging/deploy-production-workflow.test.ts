import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../../.github/workflows/deploy-production.yml', import.meta.url),
  'utf8',
);
const platformSql = readFileSync(
  new URL('../../packages/postgres/supabase/staging.sql', import.meta.url),
  'utf8',
);
const migrationScript = readFileSync(
  new URL('../../scripts/migrate-staging.ts', import.meta.url),
  'utf8',
);

test('production deploy uses isolated provider and Railway configuration', () => {
  expect(workflow).toContain('environment: production');
  expect(workflow).toContain('bun scripts/migrate-production.ts');
  expect(workflow).toContain('${{ vars.RAILWAY_PROJECT_ID }}');
  expect(workflow).toContain('${{ vars.RAILWAY_PUBLIC_SERVICE_ID }}');
  expect(workflow).toContain('${{ vars.RAILWAY_WORKER_SERVICE_ID }}');
  expect(workflow).toContain('${{ vars.PRODUCTION_ORIGIN }}');
  expect(workflow).toContain('"SERVICE_ROLE=invitation-worker"');
  expect(workflow).toContain('${{ secrets.RAILWAY_CONFIG_B64 }}');
  expect(workflow).toContain(
    'EXPECTED_ARTIFACT_DIGEST: ${{ steps.attestation.outputs.artifact_digest }}',
  );
  expect(workflow).toContain('bun scripts/check-production.ts');
  expect(workflow).not.toContain('INVITATION_CONTROLLED_MAILBOX');
  expect(workflow).not.toContain('PROVIDER_SMOKE');
});

test('production migration does not create staging smoke queue or cron data', () => {
  expect(platformSql).toContain(
    "current_setting('app.deployment_environment', true) <> 'production'",
  );
});

test('production migration requires separate owner, runtime, and worker roles', () => {
  expect(migrationScript).toContain(
    'new Set([migrationRole, runtimeRole, workerRole]).size !== 3',
  );
  expect(migrationScript).toContain(
    'Migration, runtime, and worker database roles must be distinct',
  );
});
