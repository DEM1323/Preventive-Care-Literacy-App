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

  expect(lines).toEqual([
    '{"name":"http.request.completed","method":"POST","route":"create-school-workspace","statusCode":201,"durationMs":12}',
  ]);
});
