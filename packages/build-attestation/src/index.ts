import { createHash } from 'node:crypto';
import {
  lstat,
  readdir,
  readFile,
  readlink,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { APPLICATION_LAYER_ENVELOPE_V1 } from '../../application-keys/src/index.ts';

export const BUILD_ATTESTATION_FILENAME = 'build-attestation.json';
export const BUILD_ATTESTATION_SCHEMA_VERSION = 2 as const;

const skippedDirectoryNames = new Set([
  'node_modules',
  '.git',
  'artifacts',
  '.vite',
]);

const skippedDependencyDirectoryNames = new Set(['.bin', '.cache', '.tmp']);

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
  lockDigest: string;
  dependencyDigest: string;
  bunVersion: string;
  artifactDigest: string;
  envelopeAdapter: typeof APPLICATION_LAYER_ENVELOPE_V1;
};

const commitPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const bunVersionPattern = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function collectFiles(
  root: string,
  relativeDirectory: string,
  skipDirectories: ReadonlySet<string> = skippedDirectoryNames,
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
    if (skipDirectories.has(entry.name)) continue;
    if (entry.name === BUILD_ATTESTATION_FILENAME) continue;
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, relativePath, skipDirectories)));
      continue;
    }
    if (entry.isFile() || entry.isSymbolicLink()) files.push(relativePath);
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

export function runtimeBunVersion(): string {
  const versions = process.versions as Record<string, string | undefined>;
  const version = versions.bun;
  if (typeof version === 'string' && bunVersionPattern.test(version)) {
    return version;
  }
  throw new BuildAttestationError('Bun runtime version is unavailable');
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

export async function hashLockfile(root: string): Promise<string> {
  try {
    await readFile(join(root, 'bun.lock'));
  } catch {
    throw new BuildAttestationError('lockfile is missing');
  }
  return digestFiles(root, ['bun.lock']);
}

type BunLockfile = {
  workspaces?: Record<string, { dependencies?: Record<string, string> }>;
  packages?: Record<string, unknown>;
};

function parseBunLockfile(text: string): unknown {
  const stripped = text.replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(stripped);
  } catch {
    throw new BuildAttestationError('lockfile is malformed');
  }
}

function npmIdentityFromSpec(spec: string): string | undefined {
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/');
    const at = spec.lastIndexOf('@');
    if (slash === -1 || at <= slash || at === spec.length - 1) {
      return undefined;
    }
    return spec;
  }
  const at = spec.lastIndexOf('@');
  if (at <= 0 || at === spec.length - 1) return undefined;
  return spec;
}

function lockKeyForDependency(
  parentLockKey: string,
  depName: string,
  packages: Record<string, unknown>,
): string {
  const nested = parentLockKey ? `${parentLockKey}/${depName}` : depName;
  return Object.prototype.hasOwnProperty.call(packages, nested)
    ? nested
    : depName;
}

function productionPackageIdentities(lock: BunLockfile): string[] {
  const packages = lock.packages ?? {};
  const seenKeys = new Set<string>();
  const identities = new Set<string>();
  const queue = Object.keys(lock.workspaces?.['']?.dependencies ?? {}).map(
    (name) => lockKeyForDependency('', name, packages),
  );
  while (queue.length > 0) {
    const lockKey = queue.pop();
    if (!lockKey || seenKeys.has(lockKey)) continue;
    seenKeys.add(lockKey);
    const entry = packages[lockKey];
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') {
      throw new BuildAttestationError('production dependency graph is missing');
    }
    const identity = npmIdentityFromSpec(entry[0]);
    if (!identity) {
      throw new BuildAttestationError('production dependency graph is missing');
    }
    identities.add(identity);
    const meta = entry.length > 2 && isRecord(entry[2]) ? entry[2] : undefined;
    const dependencies =
      meta && isRecord(meta.dependencies) ? meta.dependencies : undefined;
    if (!dependencies) continue;
    for (const depName of Object.keys(dependencies)) {
      queue.push(lockKeyForDependency(lockKey, depName, packages));
    }
  }
  return [...identities].sort();
}

type InstalledLayoutEntry =
  | { path: string; kind: 'file'; digest: string }
  | { path: string; kind: 'symlink'; target: string };

function digestInstalledLayout(entries: InstalledLayoutEntry[]): string {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    if (entry.kind === 'file') {
      hash.update(`${entry.path}\0file\0${entry.digest}\n`);
      continue;
    }
    hash.update(`${entry.path}\0symlink\0${entry.target}\n`);
  }
  return hash.digest('hex');
}

function assertInsideNodeModules(path: string, nodeModulesReal: string): void {
  const rel = relative(nodeModulesReal, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new BuildAttestationError('production dependency tree is missing');
  }
}

async function readPackageIdentity(
  packageDirectory: string,
): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(packageDirectory, 'package.json'), 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      isRecord(parsed) &&
      typeof parsed.name === 'string' &&
      parsed.name &&
      typeof parsed.version === 'string' &&
      parsed.version
    ) {
      return `${parsed.name}@${parsed.version}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function hashPackageContents(packageDirectory: string): Promise<string> {
  const entries: InstalledLayoutEntry[] = [];

  async function visit(
    directory: string,
    relativeDirectory: string,
  ): Promise<void> {
    const dirEntries = await readdir(directory, { withFileTypes: true });
    for (const entry of [...dirEntries].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (
        entry.name === 'node_modules' ||
        skippedDependencyDirectoryNames.has(entry.name)
      ) {
        continue;
      }
      const path = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath, path);
      } else if (entry.isSymbolicLink()) {
        entries.push({
          path,
          kind: 'symlink',
          target: await readlink(fullPath),
        });
      } else if (entry.isFile()) {
        const content = await readFile(fullPath);
        entries.push({
          path,
          kind: 'file',
          digest: createHash('sha256').update(content).digest('hex'),
        });
      }
    }
  }

  await visit(packageDirectory, '');
  if (entries.length === 0) {
    throw new BuildAttestationError('production dependency tree is missing');
  }
  return digestInstalledLayout(entries);
}

async function installedProductionPackageDigests(
  nodeModulesReal: string,
  requiredIdentities: ReadonlySet<string>,
): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>();
  const visitedContainers = new Set<string>();
  const visitedPackages = new Set<string>();

  async function visitContainer(directory: string): Promise<void> {
    let realDirectory: string;
    try {
      realDirectory = await realpath(directory);
    } catch {
      throw new BuildAttestationError('production dependency tree is missing');
    }
    assertInsideNodeModules(realDirectory, nodeModulesReal);
    if (visitedContainers.has(realDirectory)) return;
    visitedContainers.add(realDirectory);

    let entries;
    try {
      entries = await readdir(realDirectory, { withFileTypes: true });
    } catch {
      throw new BuildAttestationError('production dependency tree is missing');
    }
    for (const entry of entries) {
      if (skippedDependencyDirectoryNames.has(entry.name)) continue;
      const candidate = join(realDirectory, entry.name);
      let candidateReal: string;
      try {
        candidateReal = await realpath(candidate);
      } catch {
        throw new BuildAttestationError(
          'production dependency tree is missing',
        );
      }
      assertInsideNodeModules(candidateReal, nodeModulesReal);

      const identity = await readPackageIdentity(candidateReal);
      if (identity) {
        if (!visitedPackages.has(candidateReal)) {
          visitedPackages.add(candidateReal);
          if (requiredIdentities.has(identity)) {
            const digest = await hashPackageContents(candidateReal);
            const digests = found.get(identity) ?? new Set<string>();
            digests.add(digest);
            found.set(identity, digests);
          }
        }
        try {
          await visitContainer(join(candidateReal, 'node_modules'));
        } catch (error) {
          if (!(error instanceof BuildAttestationError)) throw error;
        }
        continue;
      }

      if (entry.name === '.bun' || entry.name.startsWith('@')) {
        await visitContainer(candidateReal);
        continue;
      }
      try {
        await visitContainer(join(candidateReal, 'node_modules'));
      } catch (error) {
        if (!(error instanceof BuildAttestationError)) throw error;
      }
    }
  }

  await visitContainer(nodeModulesReal);
  return found;
}

/**
 * Hashes each lockfile-reachable production package by identity and package
 * contents, independent of whether Bun hoists, nests, or isolates it. Extra
 * development packages do not affect the digest.
 */
export async function hashProductionDependencies(
  root: string,
): Promise<string> {
  let text: string;
  try {
    text = await readFile(join(root, 'bun.lock'), 'utf8');
  } catch {
    throw new BuildAttestationError('lockfile is missing');
  }
  const parsed = parseBunLockfile(text);
  if (!isRecord(parsed)) {
    throw new BuildAttestationError('lockfile is malformed');
  }
  const identities = productionPackageIdentities(parsed as BunLockfile);
  if (identities.length === 0) {
    throw new BuildAttestationError('production dependency graph is missing');
  }

  const nodeModules = join(root, 'node_modules');
  let nodeModulesReal: string;
  try {
    await lstat(nodeModules);
    nodeModulesReal = await realpath(nodeModules);
  } catch {
    throw new BuildAttestationError('production dependency tree is missing');
  }

  const required = new Set(identities);
  const installed = await installedProductionPackageDigests(
    nodeModulesReal,
    required,
  );
  const hash = createHash('sha256');
  for (const identity of identities) {
    const digests = installed.get(identity);
    if (!digests || digests.size !== 1) {
      throw new BuildAttestationError('production dependency tree is missing');
    }
    hash.update(`${identity}\0${[...digests][0]}\n`);
  }
  return hash.digest('hex');
}

export function artifactDigestFromParts(input: {
  sourceDigest: string;
  browserDigest: string;
  lockDigest: string;
  dependencyDigest: string;
  bunVersion: string;
  envelopeAdapter: string;
}): string {
  if (
    !digestPattern.test(input.sourceDigest) ||
    !digestPattern.test(input.browserDigest) ||
    !digestPattern.test(input.lockDigest) ||
    !digestPattern.test(input.dependencyDigest) ||
    !bunVersionPattern.test(input.bunVersion)
  ) {
    throw new BuildAttestationError('artifact digest parts are malformed');
  }
  return createHash('sha256')
    .update(
      `v2\n${input.sourceDigest}\n${input.browserDigest}\n${input.lockDigest}\n${input.dependencyDigest}\n${input.bunVersion}\n${input.envelopeAdapter}\n`,
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
  const lockDigest = await hashLockfile(root);
  const dependencyDigest = await hashProductionDependencies(root);
  const bunVersion = runtimeBunVersion();
  const envelopeAdapter = APPLICATION_LAYER_ENVELOPE_V1;
  return {
    schemaVersion: BUILD_ATTESTATION_SCHEMA_VERSION,
    commit: input.commit,
    tree: input.tree,
    sourceDigest,
    browserDigest,
    lockDigest,
    dependencyDigest,
    bunVersion,
    artifactDigest: artifactDigestFromParts({
      sourceDigest,
      browserDigest,
      lockDigest,
      dependencyDigest,
      bunVersion,
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
    typeof value.lockDigest !== 'string' ||
    typeof value.dependencyDigest !== 'string' ||
    typeof value.bunVersion !== 'string' ||
    typeof value.artifactDigest !== 'string' ||
    value.envelopeAdapter !== APPLICATION_LAYER_ENVELOPE_V1 ||
    !commitPattern.test(value.commit) ||
    !commitPattern.test(value.tree) ||
    !digestPattern.test(value.sourceDigest) ||
    !digestPattern.test(value.browserDigest) ||
    !digestPattern.test(value.lockDigest) ||
    !digestPattern.test(value.dependencyDigest) ||
    !bunVersionPattern.test(value.bunVersion) ||
    !digestPattern.test(value.artifactDigest)
  ) {
    throw new BuildAttestationTamperError();
  }
  const expectedDigest = artifactDigestFromParts({
    sourceDigest: value.sourceDigest,
    browserDigest: value.browserDigest,
    lockDigest: value.lockDigest,
    dependencyDigest: value.dependencyDigest,
    bunVersion: value.bunVersion,
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
    lockDigest: value.lockDigest,
    dependencyDigest: value.dependencyDigest,
    bunVersion: value.bunVersion,
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
  const lockDigest = await hashLockfile(root);
  const bunVersion = runtimeBunVersion();
  if (
    sourceDigest !== attestation.sourceDigest ||
    browserDigest !== attestation.browserDigest ||
    lockDigest !== attestation.lockDigest ||
    bunVersion !== attestation.bunVersion
  ) {
    throw new BuildAttestationTamperError();
  }
  return attestation;
}

let cachedDependencyDigest: string | undefined;

export function resetBuildAttestationCache(): void {
  cachedDependencyDigest = undefined;
}

export async function verifyBuildAttestationAtStartup(
  root: string,
): Promise<BuildAttestation> {
  const attestation = await readAndVerifyBuildAttestation(root);
  const dependencyDigest = await hashProductionDependencies(root);
  if (dependencyDigest !== attestation.dependencyDigest) {
    throw new BuildAttestationTamperError();
  }
  cachedDependencyDigest = dependencyDigest;
  return attestation;
}

export async function verifyBuildAttestationForHealth(
  root: string,
): Promise<BuildAttestation> {
  if (cachedDependencyDigest === undefined) {
    return verifyBuildAttestationAtStartup(root);
  }
  const attestation = await readAndVerifyBuildAttestation(root);
  if (attestation.dependencyDigest !== cachedDependencyDigest) {
    throw new BuildAttestationTamperError();
  }
  return attestation;
}
