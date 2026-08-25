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

test('build stage declares SOURCE_COMMIT and SOURCE_TREE as ARGs and runtime does not trust them', async () => {
  const dockerfile = await readFile(
    new URL('../../Dockerfile', import.meta.url),
    'utf8',
  );
  const build = stageBody(dockerfile, 'build');
  const runtime = stageBody(dockerfile, 'runtime');

  expect(build).toContain('ARG SOURCE_COMMIT');
  expect(build).toContain('ARG SOURCE_TREE');
  expect(build).toContain(
    'RUN test -n "$SOURCE_COMMIT" && test -n "$SOURCE_TREE"',
  );
  expect(build).toContain('bun scripts/write-build-attestation.ts');
  expect(runtime).not.toContain('ARG SOURCE_COMMIT');
  expect(runtime).not.toContain('ARG SOURCE_TREE');
  expect(runtime).not.toContain('ENV SOURCE_COMMIT');
  expect(runtime).toContain(
    'COPY --from=build --chown=bun:bun /app/build-attestation.json',
  );
});

test('dummy commit and tree values are well-formed bake inputs, not runtime health truth', () => {
  expect(dummyCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(dummyTree).toMatch(/^[0-9a-f]{40}$/);
});
