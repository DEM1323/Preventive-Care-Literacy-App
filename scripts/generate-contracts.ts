import { readFile, writeFile } from 'node:fs/promises';
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';
import { format } from 'prettier';
import { buildApp } from '../apps/server/src/app.ts';

const openapiPath = new URL(
  '../packages/http-contract/openapi.json',
  import.meta.url,
);
const clientSchemaPath = new URL(
  '../packages/api-client/src/schema.ts',
  import.meta.url,
);

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortDeep(child)]),
    );
  }
  return value;
}

async function renderContracts() {
  const app = await buildApp(
    {
      createSchoolWorkspace: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      provisionStaffIdentity: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      startStaffSignIn: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      completeStaffSignIn: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      resolveStaffSession: async () => undefined,
      endStaffSession: async () => ({ outcome: 'ended' }),
      listStaffIdentities: async () => {
        throw new Error('Contract generation does not execute queries');
      },
      openClinicalDirectory: async () => {
        throw new Error('Contract generation does not execute queries');
      },
      createClassInvitation: async () => {
        throw new Error('Contract generation does not execute commands');
      },
      listClasses: async () => {
        throw new Error('Contract generation does not execute queries');
      },
    },
    {
      publicOrigin: 'https://contract-generator.example',
      operatorAuthenticator: {
        authenticate: () => ({
          type: 'technical_operator',
          id: 'contract-generator',
        }),
      },
    },
  );
  const document = sortDeep(app.swagger());
  await app.close();

  const openapi = await format(JSON.stringify(document), { parser: 'json' });
  const clientSchema = await format(
    `${COMMENT_HEADER}${astToString(
      await openapiTS(document as Parameters<typeof openapiTS>[0], {
        alphabetize: true,
      }),
    )}`,
    { parser: 'typescript', singleQuote: true },
  );
  return { openapi, clientSchema };
}

const rendered = await renderContracts();
if (process.argv.includes('--check')) {
  const [committedOpenapi, committedClientSchema] = await Promise.all([
    readFile(openapiPath, 'utf8'),
    readFile(clientSchemaPath, 'utf8'),
  ]);
  if (
    committedOpenapi !== rendered.openapi ||
    committedClientSchema !== rendered.clientSchema
  ) {
    throw new Error(
      'Generated API contracts are stale. Run bun run generate:contracts.',
    );
  }
} else {
  await Promise.all([
    writeFile(openapiPath, rendered.openapi),
    writeFile(clientSchemaPath, rendered.clientSchema),
  ]);
}
