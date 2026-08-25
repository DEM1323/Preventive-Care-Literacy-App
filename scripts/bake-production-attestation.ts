import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseBuildAttestation } from '../packages/build-attestation/src/index.ts';

const commit = process.env.SOURCE_COMMIT ?? process.env.EXPECTED_COMMIT;
const tree = process.env.SOURCE_TREE ?? process.env.EXPECTED_GIT_TREE;
const output = resolve(
  process.env.PRODUCTION_ATTESTATION_PATH ??
    'artifacts/production-attestation.json',
);

if (!commit || !tree) {
  console.error('SOURCE_COMMIT and SOURCE_TREE are required');
  process.exit(1);
}

const tag = `prevcare-production-attest:${commit}`;
execFileSync(
  'docker',
  [
    'build',
    '--file',
    'Dockerfile',
    '--target',
    'runtime',
    '--build-arg',
    `SOURCE_COMMIT=${commit}`,
    '--build-arg',
    `SOURCE_TREE=${tree}`,
    '--tag',
    tag,
    '.',
  ],
  { stdio: 'inherit' },
);

let container: string | undefined;
try {
  container = execFileSync('docker', ['create', tag], {
    encoding: 'utf8',
  }).trim();
  await mkdir(dirname(output), { recursive: true });
  execFileSync('docker', [
    'cp',
    `${container}:/app/build-attestation.json`,
    output,
  ]);
} finally {
  if (container) {
    execFileSync('docker', ['rm', container], { stdio: 'ignore' });
  }
}

const attestation = parseBuildAttestation(
  JSON.parse(await readFile(output, 'utf8')) as unknown,
);
if (attestation.commit !== commit || attestation.tree !== tree) {
  console.error(
    'baked production attestation labels do not match SOURCE_COMMIT/SOURCE_TREE',
  );
  process.exit(1);
}
process.stdout.write(`${attestation.artifactDigest}\n`);
