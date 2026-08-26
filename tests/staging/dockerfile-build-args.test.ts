import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const dummyCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const dummyTree = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function stageBody(dockerfile: string, stage: string): string {
  const pattern = new RegExp(
    `FROM [^\\n]+ AS ${stage}\\n([\\s\\S]*?)(?=\\nFROM |$)`,
  );
  const match = pattern.exec(dockerfile);
  if (!match?.[1]) throw new Error(`Dockerfile is missing the ${stage} stage`);
  return match[1];
}

test('attest stage hashes production dependencies with SOURCE_COMMIT and runtime does not trust them', async () => {
  const dockerfile = await readFile(
    new URL('../../Dockerfile', import.meta.url),
    'utf8',
  );
  const dependencies = stageBody(dockerfile, 'dependencies');
  const productionDependencies = stageBody(
    dockerfile,
    'production-dependencies',
  );
  const build = stageBody(dockerfile, 'build');
  const attest = stageBody(dockerfile, 'attest');
  const runtime = stageBody(dockerfile, 'runtime');

  expect(dockerfile).toMatch(
    /^FROM oven\/bun:1\.3\.14-alpine AS dependencies/m,
  );
  expect(dockerfile).toContain(
    'FROM oven/bun:1.3.14-alpine AS production-dependencies',
  );
  expect(dockerfile).toContain('FROM oven/bun:1.3.14-alpine AS runtime');
  expect(dockerfile).not.toMatch(/FROM oven\/bun:(?!1\.3\.14-alpine)/);
  expect(dependencies).toContain('bun install --frozen-lockfile');
  expect(productionDependencies).toContain(
    'bun install --frozen-lockfile --production',
  );
  expect(build).toContain('ARG SOURCE_COMMIT');
  expect(build).toContain('ARG SOURCE_TREE');
  expect(build).toContain(
    'RUN test -n "$SOURCE_COMMIT" && test -n "$SOURCE_TREE"',
  );
  expect(attest).toContain('ARG SOURCE_COMMIT');
  expect(attest).toContain('ARG SOURCE_TREE');
  expect(attest).toContain('bun scripts/write-build-attestation.ts');
  expect(runtime).not.toContain('ARG SOURCE_COMMIT');
  expect(runtime).not.toContain('ARG SOURCE_TREE');
  expect(runtime).not.toContain('ENV SOURCE_COMMIT');
  expect(runtime).toContain(
    'COPY --from=attest --chown=bun:bun /app/build-attestation.json',
  );
  expect(runtime).toContain(
    'COPY --from=production-dependencies --chown=bun:bun /app/bun.lock',
  );
  expect(runtime).toContain(
    'COPY --from=production-dependencies --chown=bun:bun /app/node_modules',
  );
});

test('dummy commit and tree values are well-formed bake inputs, not runtime health truth', () => {
  expect(dummyCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(dummyTree).toMatch(/^[0-9a-f]{40}$/);
});

test('Docker build context includes the synthetic configuration fixture used by Vite', async () => {
  const dockerignore = await readFile(
    new URL('../../.dockerignore', import.meta.url),
    'utf8',
  );
  expect(dockerignore.split('\n')).not.toContain('docs');
});
