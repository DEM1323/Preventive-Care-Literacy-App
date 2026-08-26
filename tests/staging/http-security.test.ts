import { describe, expect, test } from 'bun:test';
import {
  buildApp,
  createOperatorAuthenticator,
} from '../../apps/server/src/app.ts';
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
    async provisionStaffIdentity(command) {
      return {
        operationId: command.operationId,
        staffIdentityId: command.staffIdentityId,
        supabaseUserId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf1099',
        outcome: 'provisioned',
      };
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
      createSession: () => 'operator-session',
    },
    listOperatorWorkspaces: async () => [],
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
    expect(response.headers['content-security-policy']).toContain(
      "script-src 'self'",
    );
    expect(response.headers['content-security-policy']).not.toContain(
      'unsafe-eval',
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
        createSession: () => 'operator-session',
      },
      listOperatorWorkspaces: async () => [],
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

  test('issues a signed short-lived operator cookie without exposing the credential', async () => {
    const token = 'operator-secret-with-more-than-thirty-two-characters';
    let now = new Date('2026-08-25T10:00:00.000Z');
    const app = await buildApp(createStubIdentityAndAccess(), {
      publicOrigin,
      operatorAuthenticator: createOperatorAuthenticator(
        { token, actorId: 'operator@example.test' },
        { now: () => now },
      ),
      listOperatorWorkspaces: async () => [
        {
          workspaceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf1001',
          displayName: 'Synthetic School',
          createdAt: '2026-08-25T09:00:00.000Z',
          staffCount: 2,
          configurationState: 'draft',
          draftVersion: 3,
          activeReleaseId: null,
        },
      ],
    });
    const commandHeaders = {
      origin: publicOrigin,
      'x-prevcare-csrf': '1',
    };

    const unauthorizedList = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/workspaces',
    });
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/operator/sign-in',
      headers: commandHeaders,
      payload: { token: `${token}-wrong` },
    });
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/operator/sign-in',
      headers: commandHeaders,
      payload: { token },
    });
    const setCookie = String(signedIn.headers['set-cookie']);
    const cookie = setCookie.split(';')[0] ?? '';
    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/session',
      headers: { cookie },
    });
    const listedWithCookie = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/workspaces',
      headers: { cookie },
    });
    const listedWithBearer = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/workspaces',
      headers: { authorization: `Bearer ${token}` },
    });
    const createdWithCookie = await app.inject({
      method: 'POST',
      url: '/api/v1/administration/school-workspaces',
      headers: { ...commandHeaders, cookie },
      payload: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf1002',
        workspaceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf1001',
        displayName: 'Synthetic School',
      },
    });
    const provisionedWithCookie = await app.inject({
      method: 'POST',
      url: '/api/v1/administration/staff-identities',
      headers: { ...commandHeaders, cookie },
      payload: {
        operationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf1003',
        workspaceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf1001',
        staffIdentityId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf1004',
        displayName: 'Synthetic Staff',
        email: 'staff@example.test',
        permissions: ['administrative'],
        schoolApprover: 'Synthetic Approver',
        reason: 'Operator console provisioning test',
        initialPassword: 'correct horse battery staple',
      },
    });
    const tampered = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/session',
      headers: { cookie: `${cookie.slice(0, -1)}x` },
    });
    now = new Date('2026-08-25T11:00:01.000Z');
    const expired = await app.inject({
      method: 'GET',
      url: '/api/v1/operator/session',
      headers: { cookie },
    });
    const signedOut = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/operator/sign-out',
      headers: commandHeaders,
    });
    await app.close();

    expect(unauthorizedList.statusCode).toBe(401);
    expect(rejected.statusCode).toBe(401);
    expect(rejected.body).not.toContain(token);
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json()).toEqual({ outcome: 'authenticated' });
    expect(setCookie).toContain('__Host-prevcare-operator-session=');
    expect(setCookie).toContain('Path=/; HttpOnly; Secure; SameSite=Strict');
    expect(setCookie).not.toContain(token);
    expect(session.json()).toEqual({ actorId: 'operator@example.test' });
    expect(listedWithCookie.statusCode).toBe(200);
    expect(listedWithCookie.json()).toEqual(listedWithBearer.json());
    expect(createdWithCookie.statusCode).toBe(201);
    expect(provisionedWithCookie.statusCode).toBe(201);
    expect(tampered.statusCode).toBe(401);
    expect(expired.statusCode).toBe(401);
    expect(
      Array.isArray(signedOut.headers['set-cookie'])
        ? signedOut.headers['set-cookie'][0]
        : signedOut.headers['set-cookie'],
    ).toBe(
      '__Host-prevcare-operator-session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict',
    );
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
        createSession: () => 'operator-session',
      },
      listOperatorWorkspaces: async () => [],
      buildIdentity: {
        schemaVersion: 2 as const,
        commit: 'beda69fca3f7954a0200a3209cb44aac7ade4a72',
        tree: '89abcdef0123456789abcdef0123456789abcdef',
        sourceDigest:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        browserDigest:
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        lockDigest:
          'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        dependencyDigest:
          'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        bunVersion: '1.3.14',
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
      lockDigest:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      dependencyDigest:
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      bunVersion: '1.3.14',
      artifactDigest:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      envelopeAdapter: 'application-layer-envelope/v1',
    });
  });
});
