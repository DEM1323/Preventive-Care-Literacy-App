import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

test('repository contains no Google Apps Script implementation', () => {
  expect(existsSync(new URL('../google-apps-script', import.meta.url))).toBe(
    false,
  );

  const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .trim()
    .split('\n');
  expect(
    trackedFiles.filter(
      (path) =>
        existsSync(new URL(`../${path}`, import.meta.url)) &&
        (path.endsWith('.gs') || basename(path) === 'appsscript.json'),
    ),
  ).toEqual([]);
});

test('Student intake does not persist answers in browser storage', () => {
  const intakeSource = readFileSync(
    new URL('../src/features/intake/StudentIntakePage.tsx', import.meta.url),
    'utf8',
  );
  expect(intakeSource).not.toContain('localStorage');
  expect(intakeSource).not.toContain('sessionStorage');
  expect(intakeSource).not.toContain('searchParams');
});

test('Student learning shows Completed only from server-accepted Item Completion', () => {
  const learningSource = readFileSync(
    new URL(
      '../src/features/learning/StudentLearningPage.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  expect(learningSource).not.toContain('localStorage');
  expect(learningSource).not.toContain('sessionStorage');
  expect(learningSource).toContain("busy === 'save' ? 'Saving...'");
  expect(learningSource).toContain('snapshot?.completion');
  expect(learningSource).not.toContain('setCompleted(true)');
});

test('browser exposes only the server-authoritative Student access routes', () => {
  const appSource = readFileSync(
    new URL('../src/App.tsx', import.meta.url),
    'utf8',
  );
  const routes = [...appSource.matchAll(/path="([^"]+)"/g)].map(
    (match) => match[1],
  );

  expect(routes).toEqual([
    '/staff/sign-in',
    '/staff',
    '/student/invitation',
    '/student',
    '/student/intake',
    '/student/learning',
    '/staff/configuration',
    '*',
  ]);
});

test('clinical Intake Record reveal stays memory-only and suppresses application print', () => {
  const clinicalSource = readFileSync(
    new URL(
      '../src/features/staff/ClinicalReviewSection.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  const staffHomeSource = readFileSync(
    new URL('../src/features/staff/StaffHomePage.tsx', import.meta.url),
    'utf8',
  );
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const retirement = readFileSync(
    new URL('../docs/security/prototype-retirement.md', import.meta.url),
    'utf8',
  );
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

  expect(clinicalSource).not.toContain('localStorage');
  expect(clinicalSource).not.toContain('sessionStorage');
  expect(clinicalSource).not.toContain('searchParams');
  expect(clinicalSource).not.toContain('navigate(`/');
  expect(clinicalSource).toContain("'/api/v1/clinical/intake-records/current'");
  expect(clinicalSource).toContain('clinical-sensitive');
  expect(clinicalSource).toContain('visibilitychange');
  expect(clinicalSource).toContain('setInterval');
  expect(clinicalSource).toContain('AbortController');
  expect(clinicalSource).toContain('generationRef');
  expect(clinicalSource).not.toContain("mode === 'silent' && busyRef");
  const visibleCheck = clinicalSource.indexOf(
    "document.visibilityState === 'visible'",
  );
  const clearBeforeRecheck = clinicalSource.indexOf(
    'clearSensitiveClinicalState',
    visibleCheck,
  );
  const revalidate = clinicalSource.indexOf(
    "refreshDirectoryRef.current('revalidate')",
    visibleCheck,
  );
  expect(visibleCheck).toBeGreaterThan(-1);
  expect(clearBeforeRecheck).toBeGreaterThan(visibleCheck);
  expect(revalidate).toBeGreaterThan(clearBeforeRecheck);
  expect(staffHomeSource).toContain('ClinicalReviewSection');
  expect(staffHomeSource.indexOf('setSession(undefined)')).toBeLessThan(
    staffHomeSource.indexOf("'/api/v1/auth/staff/sign-out'"),
  );
  expect(css).toContain('@media print');
  expect(css).toContain('.clinical-sensitive');
  expect(retirement).toContain('/api/v1/clinical/intake-records/current');
  expect(retirement).not.toContain(
    'Authenticated staff routes still contain no Student answer entry',
  );
  expect(readme).toContain('clinical Intake Record reveal');
});
