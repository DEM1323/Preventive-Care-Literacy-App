import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { renderIntakeAnswer } from '../modules/intake-answers/index.ts';
import {
  clinicalHttpFailureLocksAllState,
  ignoreStaleClinicalGeneration,
} from '../src/features/staff/clinical-review-fail-closed.ts';

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
    new URL('../src/features/staff/ClinicalReviewSection.tsx', import.meta.url),
    'utf8',
  );
  const staffHomeSource = readFileSync(
    new URL('../src/features/staff/StaffHomePage.tsx', import.meta.url),
    'utf8',
  );
  const css = readFileSync(
    new URL('../src/index.css', import.meta.url),
    'utf8',
  );
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
  expect(clinicalSource).toContain('clinicalAuthorizationBackstopMs');
  expect(clinicalSource).toContain('renderIntakeAnswer');
  expect(clinicalSource).toContain('modules/intake-answers');
  expect(clinicalSource).not.toContain('modules/intake/index');
  expect(clinicalSource).not.toContain('school-configuration');
  expect(clinicalSource).toContain('status >= 500');
  expect(clinicalSource).not.toContain("mode === 'silent' && busyRef");
  expect(clinicalSource).not.toContain(
    'generation !== generationRef.current || isAbortError',
  );
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

test('clinical UI fail-closed helpers clear immediately and ignore stale in-flight work', () => {
  expect(clinicalHttpFailureLocksAllState(500, undefined)).toBe(true);
  expect(
    clinicalHttpFailureLocksAllState(503, { code: 'INTERNAL_ERROR' }),
  ).toBe(true);
  expect(clinicalHttpFailureLocksAllState(0, undefined)).toBe(true);
  expect(clinicalHttpFailureLocksAllState(400, undefined)).toBe(true);
  expect(
    clinicalHttpFailureLocksAllState(404, { code: 'INTAKE_RECORD_NOT_FOUND' }),
  ).toBe(false);
  expect(ignoreStaleClinicalGeneration(1, 2)).toBe(true);
  expect(ignoreStaleClinicalGeneration(4, 4)).toBe(false);

  const freeText = {
    id: '00000000-0000-4000-8000-000000000001',
    revision: 1,
    key: 'name',
    sectionId: '00000000-0000-4000-8000-000000000002',
    order: 1,
    type: 'text' as const,
    required: true,
    requiredWhenVisible: false,
    visibility: null,
    options: [],
    label: 'Name',
  };
  expect(renderIntakeAnswer(freeText, 'UNIQUE-FREE-TEXT')).toBe(
    'UNIQUE-FREE-TEXT',
  );
  const optionField = {
    ...freeText,
    key: 'insurance',
    type: 'yes-no' as const,
    options: [
      { code: 'yes', label: 'Has insurance' },
      { code: 'no', label: 'No insurance' },
    ],
  };
  expect(renderIntakeAnswer(optionField, 'yes')).toBe('Has insurance');
  expect(renderIntakeAnswer(optionField, 'yes')).not.toBe('yes');
  expect(renderIntakeAnswer(optionField, 'unknown-code')).toBeUndefined();
});
