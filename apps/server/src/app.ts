import swagger from '@fastify/swagger';
import fastifyStatic from '@fastify/static';
import { Type, type Static } from '@sinclair/typebox';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type {
  Clock,
  IdGenerator,
  IdentityAndAccess,
  StaffAuthProvider,
} from '../../../modules/identity-access/index.ts';
import {
  SchoolWorkspaceAlreadyExistsError,
  StaffAuthenticationFailedError,
  StaffAuthenticationStaleError,
  StaffIdentityAlreadyExistsError,
  StaffPermissionRequiredError,
} from '../../../modules/identity-access/index.ts';
import {
  createTelemetry,
  type Telemetry,
  type TelemetryEvent,
} from '../../../packages/observability/src/index.ts';
import {
  expireSecureOpaqueCookie,
  readSecureOpaqueCookie,
  setSecureOpaqueCookie,
} from '../../../packages/http-security/src/index.ts';
import {
  assertRestrictedDatabaseRole,
  createPostgresIdentityAndAccess,
} from '../../../packages/postgres/src/identity-access.ts';

const staffSessionCookie = '__Host-prevcare-staff-session' as const;

const requestBodyLimit = 64 * 1024;
const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
  ].join('; '),
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy':
    'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const;

class UntrustedRequestOriginError extends Error {}

const CreateSchoolWorkspaceBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    workspaceId: Type.String({ format: 'uuid' }),
    displayName: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: '.*\\S.*',
    }),
  },
  { additionalProperties: false },
);

const OperatorHeaders = Type.Object({
  authorization: Type.Optional(Type.String()),
  'x-prevcare-csrf': Type.Literal('1'),
});

const CreateSchoolWorkspaceResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('created'),
});

const StaffPermissionSchema = Type.Union([
  Type.Literal('administrative'),
  Type.Literal('clinical'),
]);

const ProvisionStaffIdentityBody = Type.Object(
  {
    operationId: Type.String({ format: 'uuid' }),
    workspaceId: Type.String({ format: 'uuid' }),
    staffIdentityId: Type.String({ format: 'uuid' }),
    displayName: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: '.*\\S.*',
    }),
    email: Type.String({ format: 'email', maxLength: 320 }),
    permissions: Type.Array(StaffPermissionSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    schoolApprover: Type.String({ minLength: 1, maxLength: 200 }),
    reason: Type.String({ minLength: 1, maxLength: 2000 }),
    initialPassword: Type.String({ minLength: 12, maxLength: 200 }),
  },
  { additionalProperties: false },
);

const ProvisionStaffIdentityResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  staffIdentityId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('provisioned'),
});

const StaffSignInBody = Type.Object(
  {
    email: Type.String({ format: 'email', maxLength: 320 }),
    password: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

const StaffSignInChallengeResponse = Type.Object({
  flowHandle: Type.String(),
  flowExpiresAt: Type.String({ format: 'date-time' }),
  stage: Type.Union([Type.Literal('enroll'), Type.Literal('totp')]),
  otpauthUri: Type.Optional(Type.String()),
});

const StaffTotpBody = Type.Object(
  {
    flowHandle: Type.String({ minLength: 1, maxLength: 200 }),
    code: Type.String({ pattern: '^[0-9]{6}$' }),
  },
  { additionalProperties: false },
);

const StaffSessionCreatedResponse = Type.Object({
  outcome: Type.Literal('authenticated'),
});

const StaffSessionEndedResponse = Type.Object({
  outcome: Type.Literal('ended'),
});

const StaffSessionResponse = Type.Object({
  staffIdentityId: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  displayName: Type.String(),
  permissions: Type.Array(StaffPermissionSchema),
  authenticatedAt: Type.String({ format: 'date-time' }),
});

const StaffDirectoryEntryResponse = Type.Object({
  staffIdentityId: Type.String({ format: 'uuid' }),
  displayName: Type.String(),
  email: Type.String(),
  permissions: Type.Array(StaffPermissionSchema),
  status: Type.Union([Type.Literal('active'), Type.Literal('disabled')]),
  createdAt: Type.String({ format: 'date-time' }),
});

const StaffDirectoryResponse = Type.Object({
  staffIdentities: Type.Array(StaffDirectoryEntryResponse),
});

const ClinicalDirectoryResponse = Type.Object({
  students: Type.Array(Type.Unknown(), { maxItems: 0 }),
});

const ProblemDetails = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Integer(),
  code: Type.String(),
});

const ProblemResponse = {
  content: {
    'application/problem+json': { schema: ProblemDetails },
  },
};

const LiveHealthResponse = Type.Object({ status: Type.Literal('ok') });
const ReadyHealthResponse = Type.Object({ status: Type.Literal('ready') });
const NotReadyHealthResponse = Type.Object({
  status: Type.Literal('not-ready'),
});

type OperatorAuthenticator = {
  authenticate(
    authorization: string | undefined,
  ): { type: 'technical_operator'; id: string } | undefined;
};

function createOperatorAuthenticator(credentials: {
  token: string;
  actorId: string;
}): OperatorAuthenticator {
  if (credentials.token.length < 32) {
    throw new Error(
      'OPERATOR_PROVISIONING_TOKEN must contain at least 32 characters',
    );
  }
  const expected = Buffer.from(`Bearer ${credentials.token}`);
  return {
    authenticate(authorization) {
      if (!authorization) return undefined;
      const provided = Buffer.from(authorization);
      if (
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
      ) {
        return undefined;
      }
      return { type: 'technical_operator', id: credentials.actorId };
    },
  };
}

export async function buildApp(
  identityAndAccess: IdentityAndAccess,
  options: {
    operatorAuthenticator: OperatorAuthenticator;
    publicOrigin: string;
    readiness?: () => Promise<void>;
    telemetry?: Telemetry;
    webRoot?: string;
    onClose?: () => Promise<void>;
  },
): Promise<FastifyInstance> {
  const publicOrigin = new URL(options.publicOrigin).origin;
  const telemetry = options.telemetry;
  const requestStartedAt = new WeakMap<object, number>();
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false } },
    bodyLimit: requestBodyLimit,
    logger: false,
  });
  if (options.onClose) app.addHook('onClose', options.onClose);
  app.addHook('onRequest', async (request, reply) => {
    requestStartedAt.set(request, performance.now());
    for (const [name, value] of Object.entries(securityHeaders)) {
      reply.header(name, value);
    }

    if (!['DELETE', 'PATCH', 'POST', 'PUT'].includes(request.method)) return;
    if (
      request.headers.origin !== publicOrigin ||
      request.headers['x-prevcare-csrf'] !== '1' ||
      (request.headers['sec-fetch-site'] !== undefined &&
        request.headers['sec-fetch-site'] !== 'same-origin')
    ) {
      throw new UntrustedRequestOriginError();
    }
  });
  if (telemetry) {
    app.addHook('onResponse', async (request, reply) => {
      const route = request.routeOptions.url ?? '';
      const routeName: Extract<
        TelemetryEvent,
        { name: 'http.request.completed' }
      >['route'] = route.startsWith('/health/')
        ? 'health'
        : route === '/api/v1/administration/school-workspaces'
          ? 'create-school-workspace'
          : route === '/api/v1/administration/staff-identities'
            ? 'staff-identities'
            : route === '/api/v1/auth/staff/sign-in'
              ? 'staff-sign-in'
              : route === '/api/v1/auth/staff/totp'
                ? 'staff-sign-in-totp'
                : route === '/api/v1/auth/staff/sign-out'
                  ? 'staff-sign-out'
                  : route === '/api/v1/staff/session'
                    ? 'staff-session'
                    : route === '/api/v1/clinical/review-directory'
                      ? 'clinical-directory'
                      : 'unknown';
      telemetry.record({
        name: 'http.request.completed',
        method: ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'].includes(
          request.method,
        )
          ? (request.method as Extract<
              TelemetryEvent,
              { name: 'http.request.completed' }
            >['method'])
          : 'GET',
        route: routeName,
        statusCode: reply.statusCode,
        durationMs: Math.max(
          0,
          Math.round(performance.now() - (requestStartedAt.get(request) ?? 0)),
        ),
      });
    });
  }
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof UntrustedRequestOriginError) {
      return reply.type('application/problem+json').code(403).send({
        type: 'https://preventive-care-literacy.example/problems/request-origin',
        title: 'Trusted request origin required',
        status: 403,
        code: 'TRUSTED_ORIGIN_REQUIRED',
      });
    }
    if (error instanceof SchoolWorkspaceAlreadyExistsError) {
      return reply.type('application/problem+json').code(409).send({
        type: 'https://preventive-care-literacy.example/problems/school-workspace-exists',
        title: error.message,
        status: 409,
        code: error.code,
      });
    }
    if (error instanceof StaffIdentityAlreadyExistsError) {
      return reply.type('application/problem+json').code(409).send({
        type: 'https://preventive-care-literacy.example/problems/staff-identity-exists',
        title: error.message,
        status: 409,
        code: error.code,
      });
    }
    if (error instanceof StaffAuthenticationFailedError) {
      return reply.type('application/problem+json').code(401).send({
        type: 'https://preventive-care-literacy.example/problems/staff-authentication',
        title: error.message,
        status: 401,
        code: error.code,
      });
    }
    if (error instanceof StaffPermissionRequiredError) {
      return reply.type('application/problem+json').code(403).send({
        type: 'https://preventive-care-literacy.example/problems/staff-permission',
        title: error.message,
        status: 403,
        code: error.code,
      });
    }
    if (error instanceof StaffAuthenticationStaleError) {
      return reply.type('application/problem+json').code(403).send({
        type: 'https://preventive-care-literacy.example/problems/staff-authentication-stale',
        title: error.message,
        status: 403,
        code: error.code,
      });
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'validation' in error &&
      error.validation
    ) {
      return reply.type('application/problem+json').code(400).send({
        type: 'https://preventive-care-literacy.example/problems/invalid-request',
        title: 'Request validation failed',
        status: 400,
        code: 'INVALID_REQUEST',
      });
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
    ) {
      return reply.type('application/problem+json').code(413).send({
        type: 'https://preventive-care-literacy.example/problems/request-too-large',
        title: 'Request body is too large',
        status: 413,
        code: 'REQUEST_TOO_LARGE',
      });
    }
    return reply.type('application/problem+json').code(500).send({
      type: 'https://preventive-care-literacy.example/problems/internal-error',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL_ERROR',
    });
  });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Preventive Care Literacy API', version: '1.0.0' },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
          staffSession: {
            type: 'apiKey',
            in: 'cookie',
            name: '__Host-prevcare-staff-session',
          },
        },
      },
    },
  });

  if (options.webRoot) {
    await app.register(fastifyStatic, {
      root: resolve(options.webRoot),
      wildcard: false,
    });
  }

  app.get(
    '/health/live',
    { schema: { response: { 200: LiveHealthResponse } } },
    async () => ({ status: 'ok' }),
  );
  app.get(
    '/health/ready',
    {
      schema: {
        response: { 200: ReadyHealthResponse, 503: NotReadyHealthResponse },
      },
    },
    async (_request, reply) => {
      try {
        await options.readiness?.();
        return { status: 'ready' } as const;
      } catch {
        return reply.code(503).send({ status: 'not-ready' });
      }
    },
  );
  app.get(
    '/health/security',
    { schema: { response: { 200: LiveHealthResponse } } },
    async (_request, reply) => {
      reply.header(
        'set-cookie',
        expireSecureOpaqueCookie('__Host-prevcare-security-check'),
      );
      return { status: 'ok' };
    },
  );

  app.post<{
    Body: Static<typeof CreateSchoolWorkspaceBody>;
    Headers: Static<typeof OperatorHeaders>;
  }>(
    '/api/v1/administration/school-workspaces',
    {
      schema: {
        operationId: 'createSchoolWorkspace',
        security: [{ bearerAuth: [] }],
        headers: OperatorHeaders,
        body: CreateSchoolWorkspaceBody,
        response: {
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          201: CreateSchoolWorkspaceResponse,
          409: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const actor = options.operatorAuthenticator.authenticate(
        request.headers.authorization,
      );
      if (!actor) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/operator-authentication',
          title: 'Operator authentication required',
          status: 401,
          code: 'OPERATOR_AUTHENTICATION_REQUIRED',
        });
      }
      const result = await identityAndAccess.createSchoolWorkspace({
        ...request.body,
        actor,
      });
      return reply.code(201).send(result);
    },
  );

  app.post<{
    Body: Static<typeof ProvisionStaffIdentityBody>;
    Headers: Static<typeof OperatorHeaders>;
  }>(
    '/api/v1/administration/staff-identities',
    {
      schema: {
        operationId: 'provisionStaffIdentity',
        security: [{ bearerAuth: [] }],
        headers: OperatorHeaders,
        body: ProvisionStaffIdentityBody,
        response: {
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          201: ProvisionStaffIdentityResponse,
          409: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const actor = options.operatorAuthenticator.authenticate(
        request.headers.authorization,
      );
      if (!actor) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/operator-authentication',
          title: 'Operator authentication required',
          status: 401,
          code: 'OPERATOR_AUTHENTICATION_REQUIRED',
        });
      }
      const result = await identityAndAccess.provisionStaffIdentity({
        ...request.body,
        actor,
      });
      return reply.code(201).send(result);
    },
  );

  app.post<{ Body: Static<typeof StaffSignInBody> }>(
    '/api/v1/auth/staff/sign-in',
    {
      schema: {
        operationId: 'startStaffSignIn',
        body: StaffSignInBody,
        response: {
          200: StaffSignInChallengeResponse,
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request) => identityAndAccess.startStaffSignIn(request.body),
  );

  app.post<{ Body: Static<typeof StaffTotpBody> }>(
    '/api/v1/auth/staff/totp',
    {
      schema: {
        operationId: 'completeStaffSignIn',
        body: StaffTotpBody,
        response: {
          200: StaffSessionCreatedResponse,
          400: ProblemResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const grant = await identityAndAccess.completeStaffSignIn(request.body);
      reply.header(
        'set-cookie',
        setSecureOpaqueCookie(staffSessionCookie, grant.sessionHandle),
      );
      return { outcome: 'authenticated' as const };
    },
  );

  app.post(
    '/api/v1/auth/staff/sign-out',
    {
      schema: {
        operationId: 'endStaffSession',
        security: [{ staffSession: [] }],
        response: {
          200: StaffSessionEndedResponse,
          400: ProblemResponse,
          403: ProblemResponse,
          413: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        staffSessionCookie,
      );
      if (sessionHandle) {
        await identityAndAccess.endStaffSession({ sessionHandle });
      }
      reply.header('set-cookie', expireSecureOpaqueCookie(staffSessionCookie));
      return { outcome: 'ended' as const };
    },
  );

  app.get(
    '/api/v1/staff/session',
    {
      schema: {
        operationId: 'readStaffSession',
        security: [{ staffSession: [] }],
        response: {
          200: StaffSessionResponse,
          401: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        staffSessionCookie,
      );
      const session =
        sessionHandle &&
        (await identityAndAccess.resolveStaffSession({ sessionHandle }));
      if (!session) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/staff-session',
          title: 'Staff session required',
          status: 401,
          code: 'STAFF_SESSION_REQUIRED',
        });
      }
      return session;
    },
  );

  app.get(
    '/api/v1/administration/staff-identities',
    {
      schema: {
        operationId: 'listStaffIdentities',
        security: [{ staffSession: [] }],
        response: {
          200: StaffDirectoryResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        staffSessionCookie,
      );
      const session =
        sessionHandle &&
        (await identityAndAccess.resolveStaffSession({ sessionHandle }));
      if (!session) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/staff-session',
          title: 'Staff session required',
          status: 401,
          code: 'STAFF_SESSION_REQUIRED',
        });
      }
      const staffIdentities = await identityAndAccess.listStaffIdentities({
        sessionHandle: sessionHandle as string,
      });
      return { staffIdentities };
    },
  );

  app.get(
    '/api/v1/clinical/review-directory',
    {
      schema: {
        operationId: 'openClinicalDirectory',
        security: [{ staffSession: [] }],
        response: {
          200: ClinicalDirectoryResponse,
          401: ProblemResponse,
          403: ProblemResponse,
          500: ProblemResponse,
        },
      },
    },
    async (request, reply) => {
      const sessionHandle = readSecureOpaqueCookie(
        request.headers.cookie,
        staffSessionCookie,
      );
      const session =
        sessionHandle &&
        (await identityAndAccess.resolveStaffSession({ sessionHandle }));
      if (!session) {
        return reply.type('application/problem+json').code(401).send({
          type: 'https://preventive-care-literacy.example/problems/staff-session',
          title: 'Staff session required',
          status: 401,
          code: 'STAFF_SESSION_REQUIRED',
        });
      }
      return identityAndAccess.openClinicalDirectory({
        sessionHandle: sessionHandle as string,
      });
    },
  );

  app.setNotFoundHandler((request, reply) => {
    if (
      options.webRoot &&
      request.method === 'GET' &&
      !request.url.startsWith('/api/') &&
      !request.url.startsWith('/internal/')
    ) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }
    return reply.type('application/problem+json').code(404).send({
      type: 'https://preventive-care-literacy.example/problems/not-found',
      title: 'Resource not found',
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  await app.ready();
  return app;
}

export async function createServer(options: {
  databaseUrl: string;
  databaseCaCertificate?: string;
  operatorCredentials: { token: string; actorId: string };
  staffAuth: StaffAuthProvider;
  publicOrigin: string;
  telemetry?: Telemetry;
  webRoot?: string;
  clock?: Clock;
  ids?: IdGenerator;
}): Promise<FastifyInstance> {
  const connectionUrl = new URL(options.databaseUrl);
  if (options.databaseCaCertificate) {
    // A local sslrootcert path cannot exist in Railway, so use its PEM variable.
    connectionUrl.searchParams.delete('sslmode');
    connectionUrl.searchParams.delete('sslrootcert');
  }
  const pool = new Pool({
    connectionString: connectionUrl.toString(),
    ...(options.databaseCaCertificate
      ? {
          ssl: {
            ca: options.databaseCaCertificate,
            rejectUnauthorized: true,
          },
        }
      : {}),
  });
  try {
    await assertRestrictedDatabaseRole(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return buildApp(
    createPostgresIdentityAndAccess({
      pool,
      staffAuth: options.staffAuth,
      clock: options.clock ?? { now: () => new Date() },
      ids: options.ids ?? { create: randomUUID },
      handles: {
        create: () => randomBytes(32).toString('base64url'),
        hash: (handle) => createHash('sha256').update(handle).digest('hex'),
      },
    }),
    {
      operatorAuthenticator: createOperatorAuthenticator(
        options.operatorCredentials,
      ),
      publicOrigin: options.publicOrigin,
      readiness: async () => {
        await pool.query('select 1');
      },
      telemetry:
        options.telemetry ?? createTelemetry((line) => console.log(line)),
      webRoot: options.webRoot,
      onClose: () => pool.end(),
    },
  );
}
