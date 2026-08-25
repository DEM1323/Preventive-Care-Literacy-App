import { describe, expect, test } from 'bun:test';
import { buildApp } from '../../apps/server/src/app.ts';
import type { IdentityAndAccess } from '../../modules/identity-access/index.ts';

function createStubIdentityAndAccess(): IdentityAndAccess {
  return {
    async createSchoolWorkspace(command) {
      return {
        operationId: command.operationId,
        workspaceId: command.workspaceId,
        outcome: 'created',
      };
    },
    async provisionStaffIdentity() {
      throw new Error('Not configured in this test');
    },
    async startStaffSignIn() {
      throw new Error('Not configured in this test');
    },
    async completeStaffSignIn() {
      throw new Error('Not configured in this test');
    },
    async resolveStaffSession() {
      return undefined;
    },
    async endStaffSession() {
      return { outcome: 'ended' };
    },
    async listStaffIdentities() {
      throw new Error('Not configured in this test');
    },
    async openClinicalDirectory() {
      throw new Error('Not configured in this test');
    },
    async requireFreshClinicalSession() {
      throw new Error('Not configured in this test');
    },
  };
}

const publicOrigin = 'https://staging.preventive-care-literacy.example';
const requestHeaders = {
  authorization: `Bearer ${'a'.repeat(32)}`,
  origin: publicOrigin,
  'x-prevcare-csrf': '1',
};

async function createApp() {
  return buildApp(createStubIdentityAndAccess(), {
    publicOrigin,
    operatorAuthenticator: {
      authenticate: () => ({
        type: 'technical_operator',
        id: 'operator@example.test',
      }),
    },
  });
}

describe.serial('staging HTTP security boundary', () => {
  test('serves security headers and no-store API responses', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    const cookiePolicy = await app.inject({
      method: 'GET',
      url: '/health/security',
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(response.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    );
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cache-control']).toBe('no-store');
    const setCookie = cookiePolicy.headers['set-cookie'];
    expect(Array.isArray(setCookie) ? setCookie : [setCookie]).toEqual([
      '__Host-prevcare-security-check=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict',
    ]);
  });

  test('reports not ready when the restricted database is unavailable', async () => {
    const app = await buildApp(createStubIdentityAndAccess(), {
      publicOrigin,
      readiness: async () => {
        throw new Error('private database detail');
      },
      operatorAuthenticator: {
        authenticate: () => ({
          type: 'technical_operator',
          id: 'operator@example.test',
        }),
      },
    });

    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not-ready' });
    expect(response.body).not.toContain('private database detail');
  });

  test('rejects cross-origin and non-CSRF-protected commands', async () => {
    const app = await createApp();
    const body = {
      operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf1002',
      workspaceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf1001',
      displayName: 'Synthetic School',
    };
    const crossOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/administration/school-workspaces',
      headers: { ...requestHeaders, origin: 'https://attacker.example' },
      payload: body,
    });
    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/administration/school-workspaces',
      headers: {
        authorization: requestHeaders.authorization,
        origin: publicOrigin,
      },
      payload: body,
    });
    await app.close();

    for (const response of [crossOrigin, missingCsrf]) {
      expect(response.statusCode).toBe(403);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.json()).toEqual({
        type: 'https://preventive-care-literacy.example/problems/request-origin',
        title: 'Trusted request origin required',
        status: 403,
        code: 'TRUSTED_ORIGIN_REQUIRED',
      });
    }
  });

  test('accepts protected commands and rejects oversized or unknown input', async () => {
    const app = await createApp();
    const body = {
      operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf1002',
      workspaceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf1001',
      displayName: 'Synthetic School',
    };
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/administration/school-workspaces',
      headers: requestHeaders,
      payload: body,
    });
    const unknownInput = await app.inject({
      method: 'POST',
      url: '/api/v1/administration/school-workspaces',
      headers: requestHeaders,
      payload: { ...body, unexpected: 'not accepted' },
    });
    const oversized = await app.inject({
      method: 'POST',
      url: '/api/v1/administration/school-workspaces',
      headers: requestHeaders,
      payload: { ...body, displayName: 'x'.repeat(70_000) },
    });
    await app.close();

    expect(accepted.statusCode).toBe(201);
    expect(unknownInput.statusCode).toBe(400);
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toEqual({
      type: 'https://preventive-care-literacy.example/problems/request-too-large',
      title: 'Request body is too large',
      status: 413,
      code: 'REQUEST_TOO_LARGE',
    });
  });

  test('build identity is unavailable until an exact commit and artifact digest are configured', async () => {
    const app = await createApp();
    const unavailable = await app.inject({
      method: 'GET',
      url: '/health/build',
    });
    await app.close();
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({ status: 'unavailable' });
  });

  test('build identity exposes only commit, artifact digest, and selected envelope adapter', async () => {
    const app = await buildApp(createStubIdentityAndAccess(), {
      publicOrigin,
      operatorAuthenticator: {
        authenticate: () => ({
          type: 'technical_operator',
          id: 'operator@example.test',
        }),
      },
      buildIdentity: {
        schemaVersion: 1 as const,
        commit: 'beda69fca3f7954a0200a3209cb44aac7ade4a72',
        tree: '89abcdef0123456789abcdef0123456789abcdef',
        sourceDigest:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        browserDigest:
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        artifactDigest:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        envelopeAdapter: 'application-layer-envelope/v1' as const,
      },
    });
    const response = await app.inject({ method: 'GET', url: '/health/build' });
    await app.close();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      commit: 'beda69fca3f7954a0200a3209cb44aac7ade4a72',
      tree: '89abcdef0123456789abcdef0123456789abcdef',
      sourceDigest:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      browserDigest:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      artifactDigest:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      envelopeAdapter: 'application-layer-envelope/v1',
    });
  });
});
