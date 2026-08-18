import swagger from '@fastify/swagger';
import { Type, type Static } from '@sinclair/typebox';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';
import type {
  Clock,
  IdGenerator,
  IdentityAndAccess,
} from '../../../modules/identity-access/index.ts';
import { SchoolWorkspaceAlreadyExistsError } from '../../../modules/identity-access/index.ts';
import {
  assertRestrictedDatabaseRole,
  createPostgresIdentityAndAccess,
} from '../../../packages/postgres/src/identity-access.ts';

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
});

const CreateSchoolWorkspaceResponse = Type.Object({
  operationId: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  outcome: Type.Literal('created'),
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
    onClose?: () => Promise<void>;
  },
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  if (options.onClose) app.addHook('onClose', options.onClose);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SchoolWorkspaceAlreadyExistsError) {
      return reply.type('application/problem+json').code(409).send({
        type: 'https://preventive-care-literacy.example/problems/school-workspace-exists',
        title: error.message,
        status: 409,
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
        },
      },
    },
  });

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

  await app.ready();
  return app;
}

export async function createServer(options: {
  databaseUrl: string;
  operatorCredentials: { token: string; actorId: string };
  clock?: Clock;
  ids?: IdGenerator;
}): Promise<FastifyInstance> {
  const pool = new Pool({ connectionString: options.databaseUrl });
  try {
    await assertRestrictedDatabaseRole(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return buildApp(
    createPostgresIdentityAndAccess({
      pool,
      clock: options.clock ?? { now: () => new Date() },
      ids: options.ids ?? { create: randomUUID },
    }),
    {
      operatorAuthenticator: createOperatorAuthenticator(
        options.operatorCredentials,
      ),
      onClose: () => pool.end(),
    },
  );
}
