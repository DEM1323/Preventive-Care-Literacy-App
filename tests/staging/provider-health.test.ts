import { expect, test } from 'bun:test';
import { buildWorker } from '../../apps/server/src/worker.ts';
import { createTelemetry } from '../../packages/observability/src/index.ts';
import { createProviderProbes } from '../../packages/providers/src/index.ts';

test('private provider smoke checks expose only allowlisted status', async () => {
  const telemetryLines: string[] = [];
  const worker = await buildWorker({
    probes: [
      { name: 'identity-platform', check: async () => undefined },
      {
        name: 'resend',
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
      { name: 'identity-platform', status: 'ok' },
      { name: 'resend', status: 'error' },
    ],
  });
  expect(telemetryLines.map((line) => JSON.parse(line))).toEqual([
    {
      name: 'provider.smoke.completed',
      provider: 'identity-platform',
      outcome: 'ok',
      durationMs: 0,
    },
    {
      name: 'provider.smoke.completed',
      provider: 'resend',
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

test('provider probes use fixed metadata and provider endpoints without reading content', async () => {
  const requests: Array<{ url: string; authorization?: string }> = [];
  const probes = createProviderProbes(
    {
      projectId: 'staging-project',
      kmsKeyResource:
        'projects/staging-project/locations/us-central1/keyRings/app/cryptoKeys/data',
      storageBucket: 'staging-private-bucket',
      tasksQueueResource:
        'projects/staging-project/locations/us-central1/queues/default',
      schedulerJobResource:
        'projects/staging-project/locations/us-central1/jobs/repair',
      resendApiKey: 'resend-secret',
    },
    async (input, init) => {
      const url = input.toString();
      const authorization = new Headers(init?.headers).get('authorization');
      requests.push({
        url,
        ...(authorization ? { authorization } : {}),
      });
      if (url.startsWith('http://metadata.google.internal/')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'google-token' }),
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
  );

  for (const probe of probes) await probe.check();

  expect(
    requests
      .filter(({ url }) => !url.startsWith('http://metadata.google.internal/'))
      .map(({ url }) => url),
  ).toEqual([
    'https://identitytoolkit.googleapis.com/v2/projects/staging-project/config',
    'https://cloudkms.googleapis.com/v1/projects/staging-project/locations/us-central1/keyRings/app/cryptoKeys/data',
    'https://storage.googleapis.com/storage/v1/b/staging-private-bucket',
    'https://cloudtasks.googleapis.com/v2/projects/staging-project/locations/us-central1/queues/default',
    'https://cloudscheduler.googleapis.com/v1/projects/staging-project/locations/us-central1/jobs/repair',
    'https://translation.googleapis.com/v3/projects/staging-project/locations/global/supportedLanguages',
    'https://api.resend.com/domains?limit=1',
  ]);
  expect(requests.at(-1)?.authorization).toBe('Bearer resend-secret');
});
