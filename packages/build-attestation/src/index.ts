import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APPLICATION_LAYER_ENVELOPE_V1 } from '../../application-keys/src/index.ts';

export const BUILD_ATTESTATION_FILENAME = 'build-attestation.json';
export const BUILD_ATTESTATION_SCHEMA_VERSION = 1 as const;

const skippedDirectoryNames = new Set([
  'node_modules',
  '.git',
  'artifacts',
  '.vite',
]);

const sourceRoots = ['apps', 'modules', 'packages', 'scripts'] as const;

export class BuildAttestationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildAttestationError';
  }
}

export class BuildAttestationTamperError extends BuildAttestationError {
  constructor() {
    super('Build attestation does not match on-disk artifacts');
    this.name = 'BuildAttestationTamperError';
  }
}

export type BuildAttestation = {
  schemaVersion: typeof BUILD_ATTESTATION_SCHEMA_VERSION;
  commit: string;
  tree: string;
  sourceDigest: string;
  browserDigest: string;
  artifactDigest: string;
  envelopeAdapter: typeof APPLICATION_LAYER_ENVELOPE_V1;
};

const commitPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function collectFiles(
  root: string,
  relativeDirectory: string,
): Promise<string[]> {
  const directory = join(root, relativeDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  const ordered = [...entries].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of ordered) {
    if (skippedDirectoryNames.has(entry.name)) continue;
    if (entry.name === BUILD_ATTESTATION_FILENAME) continue;
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, relativePath)));
      continue;
    }
    if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

async function digestFiles(root: string, files: string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    const content = await readFile(join(root, file));
    const fileDigest = createHash('sha256').update(content).digest('hex');
    hash.update(`${file}\0${fileDigest}\n`);
  }
  return hash.digest('hex');
}

export async function hashSourceArtifacts(root: string): Promise<string> {
  const files: string[] = [];
  for (const directory of sourceRoots) {
    files.push(...(await collectFiles(root, directory)));
  }
  try {
    await readFile(join(root, 'package.json'));
    files.push('package.json');
  } catch {
    throw new BuildAttestationError('source artifact tree is missing');
  }
  if (files.length === 0) {
    throw new BuildAttestationError('source artifact tree is missing');
  }
  return digestFiles(root, files);
}

export async function hashBrowserArtifacts(root: string): Promise<string> {
  const files = await collectFiles(root, 'dist');
  if (files.length === 0) {
    throw new BuildAttestationError('browser artifact tree is missing');
  }
  return digestFiles(root, files);
}

export function artifactDigestFromParts(input: {
  sourceDigest: string;
  browserDigest: string;
  envelopeAdapter: string;
}): string {
  if (
    !digestPattern.test(input.sourceDigest) ||
    !digestPattern.test(input.browserDigest)
  ) {
    throw new BuildAttestationError('artifact digest parts are malformed');
  }
  return createHash('sha256')
    .update(
      `v1\n${input.sourceDigest}\n${input.browserDigest}\n${input.envelopeAdapter}\n`,
    )
    .digest('hex');
}

export async function createBuildAttestation(
  root: string,
  input: { commit: string; tree: string },
): Promise<BuildAttestation> {
  if (!commitPattern.test(input.commit)) {
    throw new BuildAttestationError('SOURCE_COMMIT is malformed');
  }
  if (!commitPattern.test(input.tree)) {
    throw new BuildAttestationError('SOURCE_TREE is malformed');
  }
  const sourceDigest = await hashSourceArtifacts(root);
  const browserDigest = await hashBrowserArtifacts(root);
  const envelopeAdapter = APPLICATION_LAYER_ENVELOPE_V1;
  return {
    schemaVersion: BUILD_ATTESTATION_SCHEMA_VERSION,
    commit: input.commit,
    tree: input.tree,
    sourceDigest,
    browserDigest,
    artifactDigest: artifactDigestFromParts({
      sourceDigest,
      browserDigest,
      envelopeAdapter,
    }),
    envelopeAdapter,
  };
}

export async function writeBuildAttestation(
  root: string,
  input: { commit: string; tree: string },
): Promise<BuildAttestation> {
  const attestation = await createBuildAttestation(root, input);
  await writeFile(
    join(root, BUILD_ATTESTATION_FILENAME),
    `${JSON.stringify(attestation, null, 2)}\n`,
  );
  return attestation;
}

export function parseBuildAttestation(value: unknown): BuildAttestation {
  if (!isRecord(value)) {
    throw new BuildAttestationTamperError();
  }
  if (value.schemaVersion !== BUILD_ATTESTATION_SCHEMA_VERSION) {
    throw new BuildAttestationTamperError();
  }
  if (
    typeof value.commit !== 'string' ||
    typeof value.tree !== 'string' ||
    typeof value.sourceDigest !== 'string' ||
    typeof value.browserDigest !== 'string' ||
    typeof value.artifactDigest !== 'string' ||
    value.envelopeAdapter !== APPLICATION_LAYER_ENVELOPE_V1 ||
    !commitPattern.test(value.commit) ||
    !commitPattern.test(value.tree) ||
    !digestPattern.test(value.sourceDigest) ||
    !digestPattern.test(value.browserDigest) ||
    !digestPattern.test(value.artifactDigest)
  ) {
    throw new BuildAttestationTamperError();
  }
  const expectedDigest = artifactDigestFromParts({
    sourceDigest: value.sourceDigest,
    browserDigest: value.browserDigest,
    envelopeAdapter: APPLICATION_LAYER_ENVELOPE_V1,
  });
  if (expectedDigest !== value.artifactDigest) {
    throw new BuildAttestationTamperError();
  }
  return {
    schemaVersion: BUILD_ATTESTATION_SCHEMA_VERSION,
    commit: value.commit,
    tree: value.tree,
    sourceDigest: value.sourceDigest,
    browserDigest: value.browserDigest,
    artifactDigest: value.artifactDigest,
    envelopeAdapter: APPLICATION_LAYER_ENVELOPE_V1,
  };
}

export async function readAndVerifyBuildAttestation(
  root: string,
): Promise<BuildAttestation> {
  let raw: string;
  try {
    raw = await readFile(join(root, BUILD_ATTESTATION_FILENAME), 'utf8');
  } catch {
    throw new BuildAttestationTamperError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new BuildAttestationTamperError();
  }
  const attestation = parseBuildAttestation(parsed);
  const sourceDigest = await hashSourceArtifacts(root);
  const browserDigest = await hashBrowserArtifacts(root);
  if (
    sourceDigest !== attestation.sourceDigest ||
    browserDigest !== attestation.browserDigest
  ) {
    throw new BuildAttestationTamperError();
  }
  return attestation;
}
