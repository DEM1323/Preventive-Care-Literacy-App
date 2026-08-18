import Fastify, { type FastifyInstance } from 'fastify';
import {
  createTelemetry,
  type Telemetry,
} from '../../../packages/observability/src/index.ts';
import {
  createProviderProbes,
  providerConfigurationFromEnvironment,
  type ProviderProbe,
} from '../../../packages/providers/src/index.ts';

export async function buildWorker(options: {
  probes: readonly ProviderProbe[];
  telemetry: Telemetry;
  clock?: { now(): number };
}): Promise<FastifyInstance> {
  const clock = options.clock ?? { now: performance.now.bind(performance) };
  const app = Fastify({ bodyLimit: 1024, logger: false });

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/internal/provider-health', async (_request, reply) => {
    const providers = [];
    for (const probe of options.probes) {
      const startedAt = clock.now();
      let status: 'error' | 'ok' = 'ok';
      try {
        await probe.check();
      } catch {
        status = 'error';
      }
      options.telemetry.record({
        name: 'provider.smoke.completed',
        provider: probe.name,
        outcome: status,
        durationMs: Math.max(0, Math.round(clock.now() - startedAt)),
      });
      providers.push({ name: probe.name, status });
    }

    const statusCode = providers.every(({ status }) => status === 'ok')
      ? 200
      : 503;
    return reply.code(statusCode).send({ providers });
  });

  await app.ready();
  return app;
}

export async function startWorker(options: {
  probes: readonly ProviderProbe[];
  telemetry?: Telemetry;
}): Promise<FastifyInstance> {
  const app = await buildWorker({
    probes: options.probes,
    telemetry:
      options.telemetry ?? createTelemetry((line) => console.log(line)),
  });
  await app.listen({
    host: process.env.HOST ?? '0.0.0.0',
    port: Number(process.env.PORT ?? 3000),
  });
  return app;
}

if (import.meta.main) {
  await startWorker({
    probes: createProviderProbes(providerConfigurationFromEnvironment()),
  });
}
