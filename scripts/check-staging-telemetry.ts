import { readFile } from 'node:fs/promises';
import { providerNames } from '../packages/observability/src/index.ts';
import { assertNoProhibitedData } from './staging-data-policy.ts';

const telemetryPath = process.env.STAGING_TELEMETRY_PATH;
if (!telemetryPath) throw new Error('STAGING_TELEMETRY_PATH is required');

const entries: unknown = JSON.parse(await readFile(telemetryPath, 'utf8'));
if (!Array.isArray(entries))
  throw new Error('Telemetry export must be an array');

const providerResults = new Set<string>();
let httpResultCount = 0;

for (const entry of entries) {
  if (
    typeof entry !== 'object' ||
    entry === null ||
    !('jsonPayload' in entry) ||
    typeof entry.jsonPayload !== 'object' ||
    entry.jsonPayload === null ||
    !('name' in entry.jsonPayload)
  ) {
    throw new Error('Telemetry entry has an invalid shape');
  }
  const event = entry.jsonPayload;
  if (event.name === 'http.request.completed') {
    if (
      Object.keys(event).sort().join(',') !==
      'durationMs,method,name,route,statusCode'
    ) {
      throw new Error('HTTP telemetry contains non-allowlisted fields');
    }
    httpResultCount += 1;
    continue;
  }
  if (event.name === 'provider.smoke.completed') {
    if (
      Object.keys(event).sort().join(',') !==
        'durationMs,name,outcome,provider' ||
      !('provider' in event) ||
      typeof event.provider !== 'string' ||
      !('outcome' in event) ||
      event.outcome !== 'ok'
    ) {
      throw new Error('Provider telemetry contains non-allowlisted fields');
    }
    providerResults.add(event.provider);
    continue;
  }
  throw new Error('Telemetry contains a non-allowlisted event');
}

if (httpResultCount === 0)
  throw new Error('No deployed HTTP telemetry was found');
for (const provider of providerNames) {
  if (!providerResults.has(provider)) {
    throw new Error('A required provider telemetry event was not found');
  }
}

const serialized = JSON.stringify(entries.map((entry) => entry.jsonPayload));
assertNoProhibitedData(serialized, 'Deployed telemetry');

console.log('Deployed telemetry allowlist check passed.');
