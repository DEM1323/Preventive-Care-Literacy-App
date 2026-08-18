import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerNames } from '../../packages/observability/src/index.ts';

async function runTelemetryCheck(path: string): Promise<number> {
  const subprocess = Bun.spawn(['bun', 'scripts/check-staging-telemetry.ts'], {
    env: { ...process.env, STAGING_TELEMETRY_PATH: path },
    stderr: 'ignore',
    stdout: 'ignore',
  });
  return subprocess.exited;
}

test('deployed telemetry check accepts only complete allowlisted events', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prevcare-telemetry-'));
  try {
    const validPath = join(directory, 'valid.json');
    const invalidPath = join(directory, 'invalid.json');
    const validEntries = [
      {
        jsonPayload: {
          name: 'http.request.completed',
          method: 'GET',
          route: 'health',
          statusCode: 200,
          durationMs: 1,
        },
      },
      ...providerNames.map((provider) => ({
        jsonPayload: {
          name: 'provider.smoke.completed',
          provider,
          outcome: 'ok',
          durationMs: 1,
        },
      })),
    ];
    await writeFile(validPath, JSON.stringify(validEntries));
    await writeFile(
      invalidPath,
      JSON.stringify([
        ...validEntries,
        { jsonPayload: { name: 'unexpected', requestBody: 'private' } },
      ]),
    );

    expect(await runTelemetryCheck(validPath)).toBe(0);
    expect(await runTelemetryCheck(invalidPath)).toBe(1);
  } finally {
    await rm(directory, { recursive: true });
  }
});
