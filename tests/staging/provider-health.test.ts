import { expect, test } from 'bun:test';
import { buildWorker } from '../../apps/server/src/worker.ts';
import { createTelemetry } from '../../packages/observability/src/index.ts';
import { createProviderProbes } from '../../packages/providers/src/index.ts';

const configuration = {
  databaseUrl: 'postgresql://runtime:secret@db.project-ref.supabase.co/app',
  projectRef: 'project-ref',
  supabaseUrl: 'https://project-ref.supabase.co',
  supabaseSecretKey: 'supabase-secret',
  storageBucket: 'private-records',
  queueName: 'provider-smoke',
  cronJobName: 'provider-smoke',
  resendApiKey: 'resend-secret',
  smokeEmailSender: 'Staging <sender@example.test>',
  smokeEmailRecipient: 'controlled-mailbox@example.test',
  smokeAuthEmail: 'auth-smoke@example.test',
  smokeAuthPassword: 'auth-smoke-password',
  smokeAuthTotpSecret: 'JBSWY3DPEHPK3PXP',
};

test('private provider smoke checks expose only allowlisted status', async () => {
  const telemetryLines: string[] = [];
  const worker = await buildWorker({
    probes: [
      { name: 'auth', check: async () => undefined },
      {
        name: 'email',
        check: async () => {
          throw new Error(
            'student@example.test code 123456 body private session-handle',
          );
        },
      },
    ],
    clock: { now: () => 0 },
    telemetry: createTelemetry((line) => telemetryLines.push(line)),
  });

  const response = await worker.inject({
    method: 'GET',
    url: '/internal/provider-health',
  });
  await worker.close();

  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({
    providers: [
      { name: 'auth', status: 'ok' },
      { name: 'email', status: 'error' },
    ],
  });
  expect(telemetryLines.map((line) => JSON.parse(line))).toEqual([
    {
      name: 'provider.smoke.completed',
      provider: 'auth',
      outcome: 'ok',
      durationMs: 0,
    },
    {
      name: 'provider.smoke.completed',
      provider: 'email',
      outcome: 'error',
      durationMs: 0,
    },
  ]);
  expect(`${response.body}\n${telemetryLines.join('\n')}`).not.toContain(
    'student@example.test',
  );
  expect(`${response.body}\n${telemetryLines.join('\n')}`).not.toContain(
    '123456',
  );
});

test('provider probes exercise fixed Supabase seams without exposing content', async () => {
  const requests: Array<{
    url: string;
    method: string;
    apikey?: string;
    authorization?: string;
  }> = [];
  const queries: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  let authRequestsHaveTimeout = true;
  const probes = createProviderProbes(configuration, {
    sleep: async () => undefined,
    query: async (sql, parameters = []) => {
      queries.push({ sql, parameters });
      if (sql === 'select 1 as ok') return { rows: [{ ok: 1 }] };
      if (sql.includes('as bypasses_rls')) {
        return {
          rows: [{ bypasses_rls: false, owns_protected_objects: false }],
        };
      }
      if (sql.includes("set_config('app.supabase_user_id'")) {
        return { rows: [{ linked: false }] };
      }
      return { rows: [{ available: true }] };
    },
    request: async (input, init) => {
      const url = input.toString();
      if (url.includes('/auth/v1/')) {
        authRequestsHaveTimeout &&= Boolean(init?.signal);
      }
      const headers = new Headers(init?.headers);
      const apikey = headers.get('apikey');
      const authorization = headers.get('authorization');
      requests.push({
        url,
        method: init?.method ?? 'GET',
        ...(apikey ? { apikey } : {}),
        ...(authorization ? { authorization } : {}),
      });
      if (url.endsWith('/auth/v1/token?grant_type=password')) {
        return Response.json({
          access_token: 'provider-smoke-access-token',
          user: { id: '018f1f5e-7b76-7f70-8f4d-9dc17ecf2999' },
        });
      }
      if (url.endsWith('/auth/v1/user') && !init?.method) {
        return Response.json({
          factors: [
            {
              id: 'provider-smoke-factor',
              status: 'verified',
              factor_type: 'totp',
            },
          ],
        });
      }
      if (url.endsWith('/auth/v1/factors/provider-smoke-factor/challenge')) {
        return Response.json({ id: 'provider-smoke-challenge' });
      }
      if (url.endsWith('/auth/v1/factors/provider-smoke-factor/verify')) {
        const claims = Buffer.from(JSON.stringify({ aal: 'aal2' })).toString(
          'base64url',
        );
        return Response.json({ access_token: `header.${claims}.signature` });
      }
      if (url.endsWith('/storage/v1/bucket/private-records')) {
        return {
          ok: true,
          json: async () => ({ public: false }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => {
          throw new Error('Provider response content must not be read');
        },
        text: async () => {
          throw new Error('Provider response content must not be read');
        },
      } as Response;
    },
  });

  for (const probe of probes) await probe.check();
  expect(authRequestsHaveTimeout).toBe(true);

  expect(probes.map(({ name }) => name)).toEqual([
    'postgres',
    'auth',
    'storage',
    'queue',
    'cron',
    'email',
  ]);
  expect(requests).toEqual([
    {
      url: 'https://project-ref.supabase.co/auth/v1/token?grant_type=password',
      method: 'POST',
      apikey: 'supabase-secret',
      authorization: 'Bearer supabase-secret',
    },
    {
      url: 'https://project-ref.supabase.co/auth/v1/user',
      method: 'GET',
      apikey: 'supabase-secret',
      authorization: 'Bearer provider-smoke-access-token',
    },
    {
      url: 'https://project-ref.supabase.co/auth/v1/factors/provider-smoke-factor/challenge',
      method: 'POST',
      apikey: 'supabase-secret',
      authorization: 'Bearer provider-smoke-access-token',
    },
    {
      url: 'https://project-ref.supabase.co/auth/v1/factors/provider-smoke-factor/verify',
      method: 'POST',
      apikey: 'supabase-secret',
      authorization: 'Bearer provider-smoke-access-token',
    },
    {
      url: 'https://project-ref.supabase.co/storage/v1/bucket/private-records',
      method: 'GET',
      apikey: 'supabase-secret',
    },
    {
      url: 'https://project-ref.supabase.co/storage/v1/object/private-records/provider-smoke/health.txt',
      method: 'POST',
      apikey: 'supabase-secret',
    },
    {
      url: 'https://project-ref.supabase.co/storage/v1/object/private-records/provider-smoke/health.txt',
      method: 'DELETE',
      apikey: 'supabase-secret',
    },
    {
      url: 'https://api.resend.com/emails',
      method: 'POST',
      authorization: 'Bearer resend-secret',
    },
  ]);
  expect(
    queries.map(({ sql, parameters }) => ({
      operation: sql.includes('provider_queue_healthy')
        ? 'queue'
        : sql.includes('provider_cron_healthy')
          ? 'cron'
          : sql.includes("set_config('app.supabase_user_id'")
            ? 'auth-link'
            : sql.includes('bypasses_rls')
              ? 'role'
              : 'connect',
      parameters,
    })),
  ).toEqual([
    { operation: 'connect', parameters: [] },
    { operation: 'role', parameters: [] },
    {
      operation: 'auth-link',
      parameters: ['018f1f5e-7b76-7f70-8f4d-9dc17ecf2999'],
    },
    { operation: 'queue', parameters: ['provider-smoke'] },
    { operation: 'cron', parameters: ['provider-smoke'] },
  ]);
});

test('provider probes reject unavailable capabilities without exposing details', async () => {
  const probes = createProviderProbes(configuration, {
    sleep: async () => undefined,
    query: async () => ({ rows: [{ available: false }] }),
    request: async () => ({ ok: false, status: 403 }) as Response,
  });

  for (const probe of probes) {
    await expect(probe.check()).rejects.toThrow('Provider smoke check failed');
  }
});

test('auth probe rejects a Supabase user linked to a Staff Identity before MFA', async () => {
  const requests: string[] = [];
  const probes = createProviderProbes(configuration, {
    query: async (sql) => ({
      rows: sql.includes("set_config('app.supabase_user_id'")
        ? [{ linked: true }]
        : [{ available: true }],
    }),
    request: async (input) => {
      const url = input.toString();
      requests.push(url);
      return Response.json({
        access_token: 'provider-smoke-access-token',
        user: { id: '018f1f5e-7b76-7f70-8f4d-9dc17ecf2999' },
      });
    },
  });
  const authProbe = probes.find(({ name }) => name === 'auth')!;

  await expect(authProbe.check()).rejects.toThrow(
    'Provider smoke check failed',
  );
  expect(requests).toEqual([
    'https://project-ref.supabase.co/auth/v1/token?grant_type=password',
  ]);
});

test('provider probes reject a database outside the staging project', () => {
  expect(() =>
    createProviderProbes({
      ...configuration,
      databaseUrl: 'postgresql://runtime:private@db.production.supabase.co/app',
    }),
  ).toThrow('DATABASE_URL does not target the configured Supabase project');
});
