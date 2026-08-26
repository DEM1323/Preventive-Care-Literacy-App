import { expect, test } from 'bun:test';
import {
  createTelemetry,
  type TelemetryEvent,
} from '../../packages/observability/src/index.ts';

test('telemetry emits only allowlisted operational fields', () => {
  const lines: string[] = [];
  const telemetry = createTelemetry((line) => lines.push(line));

  telemetry.record({
    name: 'http.request.completed',
    method: 'POST',
    route: 'create-school-workspace',
    statusCode: 201,
    durationMs: 12,
    email: 'student@example.test',
    code: '123456',
    sessionHandle: 'opaque-session-handle',
    answers: { health: 'private' },
    requestBody: 'private body',
    generatedContent: 'private translation',
  } as TelemetryEvent);
  telemetry.record({
    name: 'provider.smoke.completed',
    provider: 'attacker-controlled-provider',
    outcome: 'ok',
    durationMs: 1,
  } as TelemetryEvent);

  telemetry.record({
    name: 'translation.generation.completed',
    adapter: 'google-cloud-translation-advanced',
    adapterVersion: 'managed-translation-adapter/v1',
    glossaryRevision: 'school-health-glossary/v1',
    locale: 'es-US',
    segmentCount: 2,
    rejectedCount: 0,
    outcome: 'ok',
    durationMs: 9,
    sourceText: 'private source',
    translatedText: 'private translation',
  } as TelemetryEvent);

  expect(lines).toEqual([
    '{"name":"http.request.completed","method":"POST","route":"create-school-workspace","statusCode":201,"durationMs":12}',
    '{"name":"translation.generation.completed","adapter":"google-cloud-translation-advanced","adapterVersion":"managed-translation-adapter/v1","glossaryRevision":"school-health-glossary/v1","locale":"es-US","segmentCount":2,"rejectedCount":0,"outcome":"ok","durationMs":9}',
  ]);
  expect(`${JSON.stringify(lines)}`).not.toContain('private source');
  expect(`${JSON.stringify(lines)}`).not.toContain('student@example.test');
});
