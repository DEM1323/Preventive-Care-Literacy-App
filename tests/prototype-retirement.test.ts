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
