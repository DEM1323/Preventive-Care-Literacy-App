import { expect, test } from 'bun:test';
import {
  deployRenderService,
  deployRenderTopology,
  runRenderJob,
} from '../../packages/render/src/index.ts';

test('Render deployment promotes and verifies the requested image digest', async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const responses = [
    [],
    { id: 'deploy-1', status: 'update_in_progress' },
    { id: 'deploy-1', status: 'update_in_progress' },
    {
      id: 'deploy-1',
      status: 'live',
      image: {
        ref: 'ghcr.io/dem1323/preventive-care-literacy-app',
        sha: 'sha256:abc123',
      },
    },
  ];

  const result = await deployRenderService({
    apiKey: 'render-secret',
    serviceId: 'srv-web',
    imageRef: 'ghcr.io/dem1323/preventive-care-literacy-app@sha256:abc123',
    request: async (input, init) => {
      calls.push({
        url: input.toString(),
        method: init?.method ?? 'GET',
        ...(init?.body ? { body: String(init.body) } : {}),
      });
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    },
    sleep: async () => undefined,
  });

  expect(result).toEqual({ deployId: 'deploy-1', digest: 'sha256:abc123' });
  expect(calls).toEqual([
    {
      url: 'https://api.render.com/v1/services/srv-web/deploys?limit=20',
      method: 'GET',
    },
    {
      url: 'https://api.render.com/v1/services/srv-web/deploys',
      method: 'POST',
      body: JSON.stringify({
        imageUrl: 'ghcr.io/dem1323/preventive-care-literacy-app@sha256:abc123',
      }),
    },
    {
      url: 'https://api.render.com/v1/services/srv-web/deploys/deploy-1',
      method: 'GET',
    },
    {
      url: 'https://api.render.com/v1/services/srv-web/deploys/deploy-1',
      method: 'GET',
    },
  ]);
});

test('Render deployment rejects failed or substituted artifacts', async () => {
  const baseOptions = {
    apiKey: 'render-secret',
    serviceId: 'srv-worker',
    imageRef: 'ghcr.io/dem1323/preventive-care-literacy-app@sha256:deadbeef',
    sleep: async () => undefined,
  };
  const failedResponses = [
    [],
    { id: 'deploy-2', status: 'update_in_progress' },
    { id: 'deploy-2', status: 'update_failed' },
  ];
  await expect(
    deployRenderService({
      ...baseOptions,
      request: async () =>
        new Response(JSON.stringify(failedResponses.shift()), { status: 200 }),
    }),
  ).rejects.toThrow('Render deployment failed');

  const substitutedResponses = [
    [],
    { id: 'deploy-3', status: 'update_in_progress' },
    {
      id: 'deploy-3',
      status: 'live',
      image: { sha: 'sha256:badc0de' },
    },
  ];
  await expect(
    deployRenderService({
      ...baseOptions,
      request: async () =>
        new Response(JSON.stringify(substitutedResponses.shift()), {
          status: 200,
        }),
    }),
  ).rejects.toThrow('Render deployed an unexpected artifact digest');
});

test('Render deployment discovers an accepted queued deployment', async () => {
  const responses = [
    new Response(JSON.stringify([]), { status: 200 }),
    new Response(undefined, { status: 202 }),
    new Response(
      JSON.stringify([{ deploy: { id: 'deploy-queued', status: 'queued' } }]),
      { status: 200 },
    ),
    new Response(
      JSON.stringify({
        id: 'deploy-queued',
        status: 'live',
        image: { sha: 'feedface' },
      }),
      { status: 200 },
    ),
  ];

  await expect(
    deployRenderService({
      apiKey: 'render-secret',
      serviceId: 'srv-worker',
      imageRef: 'ghcr.io/dem1323/app@sha256:feedface',
      request: async () => responses.shift()!,
      sleep: async () => undefined,
    }),
  ).resolves.toEqual({
    deployId: 'deploy-queued',
    digest: 'sha256:feedface',
  });
});

test('Render topology rolls the web service back when worker promotion fails', async () => {
  const deployments: Array<{ serviceId: string; imageRef: string }> = [];
  await expect(
    deployRenderTopology(
      {
        apiKey: 'render-secret',
        webServiceId: 'srv-web',
        workerServiceId: 'srv-worker',
        imageRef: 'ghcr.io/dem1323/app@sha256:feedface',
      },
      {
        currentImage: async () => 'ghcr.io/dem1323/app@sha256:deadbeef',
        deploy: async ({ serviceId, imageRef }) => {
          deployments.push({ serviceId, imageRef });
          if (serviceId === 'srv-worker') throw new Error('failed');
          return {
            deployId: 'deploy',
            digest: imageRef.slice(imageRef.lastIndexOf('@') + 1),
          };
        },
      },
    ),
  ).rejects.toThrow('Render topology verification failed; rollback completed');
  expect(deployments).toEqual([
    {
      serviceId: 'srv-web',
      imageRef: 'ghcr.io/dem1323/app@sha256:feedface',
    },
    {
      serviceId: 'srv-worker',
      imageRef: 'ghcr.io/dem1323/app@sha256:feedface',
    },
    {
      serviceId: 'srv-web',
      imageRef: 'ghcr.io/dem1323/app@sha256:deadbeef',
    },
  ]);
});

test('Render topology rolls both services back when verification fails', async () => {
  const deployments: Array<{ serviceId: string; imageRef: string }> = [];
  await expect(
    deployRenderTopology(
      {
        apiKey: 'render-secret',
        webServiceId: 'srv-web',
        workerServiceId: 'srv-worker',
        imageRef: 'ghcr.io/dem1323/app@sha256:feedface',
        verify: async () => {
          throw new Error('provider failed');
        },
      },
      {
        currentImage: async ({ serviceId }) =>
          `ghcr.io/dem1323/app@sha256:${serviceId === 'srv-web' ? 'aaaa' : 'bbbb'}`,
        deploy: async ({ serviceId, imageRef }) => {
          deployments.push({ serviceId, imageRef });
          return {
            deployId: 'deploy',
            digest: imageRef.slice(imageRef.lastIndexOf('@') + 1),
          };
        },
      },
    ),
  ).rejects.toThrow('Render topology verification failed; rollback completed');
  expect(deployments).toEqual([
    {
      serviceId: 'srv-web',
      imageRef: 'ghcr.io/dem1323/app@sha256:feedface',
    },
    {
      serviceId: 'srv-worker',
      imageRef: 'ghcr.io/dem1323/app@sha256:feedface',
    },
    {
      serviceId: 'srv-worker',
      imageRef: 'ghcr.io/dem1323/app@sha256:bbbb',
    },
    {
      serviceId: 'srv-web',
      imageRef: 'ghcr.io/dem1323/app@sha256:aaaa',
    },
  ]);
});

test('Render provider smoke runs against the deployed worker artifact', async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const responses = [
    { id: 'job-1', status: 'pending' },
    { id: 'job-1', status: 'running' },
    { id: 'job-1', status: 'succeeded' },
  ];

  await expect(
    runRenderJob({
      apiKey: 'render-secret',
      serviceId: 'srv-worker',
      startCommand: 'bun scripts/check-providers.ts',
      request: async (input, init) => {
        calls.push({
          url: input.toString(),
          method: init?.method ?? 'GET',
          ...(init?.body ? { body: String(init.body) } : {}),
        });
        return new Response(JSON.stringify(responses.shift()), { status: 200 });
      },
      sleep: async () => undefined,
    }),
  ).resolves.toEqual({ jobId: 'job-1' });
  expect(calls).toEqual([
    {
      url: 'https://api.render.com/v1/services/srv-worker/jobs',
      method: 'POST',
      body: JSON.stringify({ startCommand: 'bun scripts/check-providers.ts' }),
    },
    {
      url: 'https://api.render.com/v1/services/srv-worker/jobs/job-1',
      method: 'GET',
    },
    {
      url: 'https://api.render.com/v1/services/srv-worker/jobs/job-1',
      method: 'GET',
    },
  ]);
});
