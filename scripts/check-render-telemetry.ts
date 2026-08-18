import { readFile } from 'node:fs/promises';
import { providerNames } from '../packages/observability/src/index.ts';
import { assertNoProhibitedData } from './staging-data-policy.ts';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const apiKey = requiredEnvironment('RENDER_API_KEY');
const ownerId = requiredEnvironment('RENDER_OWNER_ID');
const releaseStartedAt = requiredEnvironment('RELEASE_STARTED_AT');
const serviceIds = [
  requiredEnvironment('RENDER_WEB_SERVICE_ID'),
  requiredEnvironment('RENDER_WORKER_SERVICE_ID'),
];
const releasePath = requiredEnvironment('RENDER_RELEASE_PATH');
const release: unknown = JSON.parse(await readFile(releasePath, 'utf8'));
if (
  typeof release !== 'object' ||
  release === null ||
  !('providerSmoke' in release) ||
  typeof release.providerSmoke !== 'object' ||
  release.providerSmoke === null ||
  !('jobId' in release.providerSmoke) ||
  typeof release.providerSmoke.jobId !== 'string'
) {
  throw new Error('Render release record has an invalid shape');
}
serviceIds.push(release.providerSmoke.jobId);

function validate(messages: readonly string[]): boolean {
  assertNoProhibitedData(messages.join('\n'), 'Deployed Render telemetry');
  const providerResults = new Set<string>();
  let healthResultFound = false;
  for (const message of messages) {
    if (!message.trim().startsWith('{')) {
      throw new Error('Render emitted non-JSON application output');
    }
    const event: unknown = JSON.parse(message);
    if (typeof event !== 'object' || event === null || !('name' in event)) {
      throw new Error('Render emitted invalid structured telemetry');
    }
    if (event.name === 'provider.smoke.completed') {
      if (
        Object.keys(event).sort().join(',') !==
          'durationMs,name,outcome,provider' ||
        !('provider' in event) ||
        typeof event.provider !== 'string' ||
        !providerNames.includes(
          event.provider as (typeof providerNames)[number],
        ) ||
        !('outcome' in event) ||
        event.outcome !== 'ok'
      ) {
        throw new Error('Render provider telemetry is not allowlisted');
      }
      providerResults.add(event.provider);
      continue;
    }
    if (event.name === 'http.request.completed') {
      if (
        Object.keys(event).sort().join(',') !==
          'durationMs,method,name,route,statusCode' ||
        !('route' in event) ||
        !['create-school-workspace', 'health'].includes(String(event.route))
      ) {
        throw new Error('Render HTTP telemetry is not allowlisted');
      }
      if (event.route === 'health') healthResultFound = true;
      continue;
    }
    throw new Error('Render emitted a non-allowlisted telemetry event');
  }
  return (
    healthResultFound &&
    providerNames.every((provider) => providerResults.has(provider))
  );
}

async function readAllMessages(): Promise<string[]> {
  const messages: string[] = [];
  let startTime = releaseStartedAt;
  let endTime: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({
      ownerId,
      startTime,
      direction: 'forward',
      type: 'app',
      limit: '100',
    });
    if (endTime) query.set('endTime', endTime);
    for (const serviceId of serviceIds) query.append('resource', serviceId);
    const response = await fetch(`https://api.render.com/v1/logs?${query}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Render log request failed');
    const body: unknown = await response.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('logs' in body) ||
      !Array.isArray(body.logs) ||
      !('hasMore' in body) ||
      typeof body.hasMore !== 'boolean'
    ) {
      throw new Error('Render log response has an invalid shape');
    }
    for (const entry of body.logs) {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        !('message' in entry) ||
        typeof entry.message !== 'string'
      ) {
        throw new Error('Render log response has an invalid shape');
      }
      messages.push(entry.message);
    }
    if (!body.hasMore) return messages;
    if (
      !('nextStartTime' in body) ||
      typeof body.nextStartTime !== 'string' ||
      !('nextEndTime' in body) ||
      typeof body.nextEndTime !== 'string'
    ) {
      throw new Error('Render log pagination is invalid');
    }
    startTime = body.nextStartTime;
    endTime = body.nextEndTime;
  }
  throw new Error('Render log pagination exceeded its safety limit');
}

for (let attempt = 0; attempt < 6; attempt += 1) {
  const messages = await readAllMessages();
  if (validate(messages)) {
    console.log('Deployed Render telemetry allowlist check passed.');
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

throw new Error('Required deployed Render telemetry was not found');
