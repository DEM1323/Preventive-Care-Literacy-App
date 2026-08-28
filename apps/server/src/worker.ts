import Fastify, { type FastifyInstance } from 'fastify';
import {
  createTelemetry,
  recordProviderChecks,
  type Telemetry,
} from '../../../packages/observability/src/index.ts';
import { serviceCaps } from '../../../modules/operational-readiness/index.ts';
import {
  checkProviderProbes,
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
  const app = Fastify({
    bodyLimit: serviceCaps.workerRequestBodyLimitBytes,
    logger: false,
  });

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/internal/provider-health', async (_request, reply) => {
    const providers = await checkProviderProbes(options.probes, clock);
    recordProviderChecks(options.telemetry, providers);

    const statusCode = providers.every(({ status }) => status === 'ok')
      ? 200
      : 503;
    return reply.code(statusCode).send({
      providers: providers.map(({ name, status }) => ({ name, status })),
    });
  });

  await app.ready();
  return app;
}

export async function startWorker(options: {
  probes: readonly ProviderProbe[];
  telemetry?: Telemetry;
}): Promise<FastifyInstance> {
  const telemetry =
    options.telemetry ?? createTelemetry((line) => console.log(line));
  const app = await buildWorker({
    probes: options.probes,
    telemetry,
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
