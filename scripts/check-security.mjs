import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const root = process.cwd();
const failures = [];
const browserCredentialMarkers = [
  'VITE_GAS_SUBMIT_URL',
  'VITE_GAS_EXECUTION_TOKEN',
  'VITE_MODULES_SHEET_URL',
  'VITE_INTAKE_SHEET_URL',
  'VITE_DISTRICT_ENCRYPTION_PASSCODE',
  'VITE_NURSE_DASHBOARD_PASSCODE',
  'district-default-key',
  'nurse123',
  'BEGIN PRIVATE KEY',
  '"private_key"',
];
const serverOnlyMarkers = [
  'SUPABASE_SECRET_KEY',
  'SUPABASE_MIGRATION_DATABASE_URL',
  'SUPABASE_RUNTIME_DATABASE_URL',
  'PROVIDER_SMOKE_EMAIL',
];

function filesUnder(path, excludedDirectories = new Set()) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) return [];
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(child, excludedDirectories) : [child];
  });
}

function scanForMarkers(paths, label) {
  for (const path of paths.flatMap((scanPath) => filesUnder(scanPath))) {
    const content = readFileSync(path, 'utf8');
    if (browserCredentialMarkers.some((marker) => content.includes(marker))) {
      failures.push(`${label}: ${relative(root, path)}`);
    }
  }
}

function scanForServerOnlyMarkers(paths, label) {
  for (const path of paths.flatMap((scanPath) => filesUnder(scanPath))) {
    const content = readFileSync(path, 'utf8');
    if (serverOnlyMarkers.some((marker) => content.includes(marker))) {
      failures.push(`${label}: ${relative(root, path)}`);
    }
  }
}

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const credentialFilePattern = /(?:^|\/)(?:\.env(?:\.(?!example$).*)?|.*(?:credential|service-account).*\.json|.*\.(?:key|pem|p12))$/i;

for (const path of trackedFiles) {
  if (credentialFilePattern.test(path)) failures.push(`tracked credential-like file: ${path}`);
  if (
    existsSync(join(root, path)) &&
    (path.startsWith('google-apps-script/') || path.endsWith('.gs') || basename(path) === 'appsscript.json')
  ) {
    failures.push(`tracked Google Apps Script file: ${path}`);
  }
}

const ignoredLocalDirectories = new Set(['.git', 'node_modules', 'dist', '.vite']);
for (const path of filesUnder(root, ignoredLocalDirectories)) {
  const relativePath = relative(root, path);
  if (relativePath === '.env.example') continue;
  if (
    relativePath.startsWith('.secrets/') ||
    credentialFilePattern.test(relativePath) ||
    /^[a-z0-9-]+-[a-f0-9]{12}\.json$/i.test(basename(relativePath))
  ) {
    failures.push(`local credential-like file inside repository: ${relativePath}`);
  }
}

scanForMarkers(
  [join(root, 'src'), join(root, '.env.example'), join(root, '.github/workflows')],
  'browser source contains retired credential marker'
);
scanForServerOnlyMarkers(
  [join(root, 'src')],
  'browser source contains server-only Supabase configuration',
);

if (existsSync(join(root, 'dist'))) {
  scanForMarkers([join(root, 'dist')], 'browser artifact contains retired credential marker');
  scanForServerOnlyMarkers(
    [join(root, 'dist')],
    'browser artifact contains server-only Supabase configuration',
  );
}

if (failures.length > 0) {
  console.error('Security control check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Security control check passed: credentials are outside the repo and browser markers are absent.');
