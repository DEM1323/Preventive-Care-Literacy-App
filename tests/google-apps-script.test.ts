import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

interface TextOutput {
  content: string;
  setMimeType: () => TextOutput;
}

function loadAppsScript(properties: Record<string, string> = {}) {
  const context = vm.createContext({
    ContentService: {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
      createTextOutput(content: string): TextOutput {
        return {
          content,
          setMimeType() {
            return this;
          },
        };
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name: string) => properties[name] ?? null,
      }),
    },
  });

  vm.runInContext(
    readFileSync(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8'),
    context
  );

  return context as typeof context & {
    doGet: (event: { parameter: Record<string, string> }) => TextOutput;
    doPost: (event: { postData: { contents: string } }) => TextOutput;
  };
}

function responseJson(output: TextOutput): Record<string, unknown> {
  return JSON.parse(output.content) as Record<string, unknown>;
}

describe('prototype Apps Script request boundary', () => {
  test('fails closed when the environment is not explicitly synthetic-only', () => {
    const script = loadAppsScript({ EXECUTION_TOKEN: 'previously-exposed-browser-token' });

    const response = responseJson(
      script.doGet({
        parameter: { action: 'health', token: 'previously-exposed-browser-token' },
      })
    );

    expect(response).toEqual({
      error: 'Prototype backend is retired unless DATA_POLICY is synthetic-only',
    });
  });

  test('rejects a real Student email address in a synthetic-only environment', () => {
    const script = loadAppsScript({ DATA_POLICY: 'synthetic-only' });

    const response = responseJson(
      script.doPost({
        postData: {
          contents: JSON.stringify({
            action: 'requestCode',
            email: 'student@school.edu',
          }),
        },
      })
    );

    expect(response).toEqual({
      success: false,
      error: 'Prototype Student access is disabled',
    });
  });

  test('rejects intake submissions in a synthetic-only environment', () => {
    const script = loadAppsScript({ DATA_POLICY: 'synthetic-only' });

    const response = responseJson(
      script.doPost({
        postData: {
          contents: JSON.stringify({
            action: 'submitUpdate',
            encryptedPayload: 'opaque-payload',
            sessionToken: 'synthetic-session',
          }),
        },
      })
    );

    expect(response).toEqual({
      success: false,
      error: 'Prototype intake submissions are disabled',
    });
  });

  test('rejects the legacy submission shape without touching storage', () => {
    const script = loadAppsScript({ DATA_POLICY: 'synthetic-only' });

    const response = responseJson(
      script.doPost({
        postData: {
          contents: JSON.stringify({
            emailHash: 'synthetic-email-hash',
            studentIdHash: 'synthetic-student-hash',
            encryptedPayload: 'opaque-payload',
          }),
        },
      })
    );

    expect(response).toEqual({ success: false, error: 'Unknown action' });
  });

  test('rejects the browser-facing bulk submission read action', () => {
    const script = loadAppsScript({
      DATA_POLICY: 'synthetic-only',
      EXECUTION_TOKEN: 'previously-exposed-browser-token',
    });

    const response = responseJson(
      script.doGet({
        parameter: {
          action: 'submissions',
          token: 'previously-exposed-browser-token',
        },
      })
    );

    expect(response).toEqual({ error: 'Unknown action' });
  });

  test('health check requires the environment policy but no shared browser credential', () => {
    const script = loadAppsScript({ DATA_POLICY: 'synthetic-only' });

    const response = responseJson(
      script.doGet({ parameter: { action: 'health' } })
    );

    expect(response).toEqual({ status: 'ok', dataPolicy: 'synthetic-only' });
  });

  test('does not trust a caller-supplied synthetic classification', () => {
    const script = loadAppsScript({ DATA_POLICY: 'synthetic-only' });

    const response = responseJson(
      script.doPost({
        postData: {
          contents: JSON.stringify({
            action: 'submitUpdate',
            dataClassification: 'synthetic',
            encryptedPayload: 'opaque-payload',
            sessionToken: 'expired-synthetic-session',
          }),
        },
      })
    );

    expect(response).toEqual({
      success: false,
      error: 'Prototype intake submissions are disabled',
    });
  });
});
