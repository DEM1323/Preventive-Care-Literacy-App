import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  evaluateIntakePreview,
  intakeFieldIsVisible,
  omitHiddenIntakeAnswers,
  renderIntakeAnswer,
} from '../modules/intake-answers/index.ts';
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

test('Student restoration uses Sign-In Codes rather than consumed Invitation Codes', () => {
  const source = readFileSync(
    new URL(
      '../src/features/student-access/StudentAccessPages.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  expect(source).toContain('/api/v1/auth/student/sign-in');
  expect(source).toContain('/student/sign-in');
  expect(source).toContain('cannot restore this browser');
  expect(source).not.toContain('localStorage');
  expect(source).not.toContain('sessionStorage');
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
    '/operator',
    '/staff/sign-in',
    '/staff',
    '/student/invitation',
    '/student/sign-in',
    '/student',
    '/student/intake',
    '/student/learning',
    '/staff/configuration',
    '*',
  ]);
});

test('operator console keeps the provisioning credential out of browser storage', () => {
  const source = readFileSync(
    new URL(
      '../src/features/operator/OperatorConsolePage.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  expect(source).toContain("'/api/v1/auth/operator/sign-in'");
  expect(source).toContain("'/api/v1/operator/workspaces'");
  expect(source).not.toContain('localStorage');
  expect(source).not.toContain('sessionStorage');
  expect(source).not.toContain('VITE_');
});

test('an empty Staff workspace can install the bundled synthetic draft', () => {
  const source = readFileSync(
    new URL(
      '../src/features/admin/SchoolConfigurationPage.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  expect(source).toContain('Install synthetic demo draft');
  expect(source).toContain(
    "'/api/v1/administration/school-configuration/draft-imports'",
  );
  expect(source).toContain(
    'workspace: { ...fixtureWorkspace, id: workspaceId }',
  );
  expect(source).toContain(
    "'/api/v1/administration/school-configuration/draft-edits'",
  );
  expect(source).toContain('Edit selected');
  expect(source).toContain('Release readiness');
  expect(source).toContain('Restore active revision');
  expect(source).toContain('Discard never-published');
  expect(source).toContain('Reload shared draft');
  expect(source).toContain('Compare');
  expect(source).toContain('Preview follows the selected resource');
  expect(source).toContain('Active Students remain pinned');
  expect(source).toContain('save-intake-field');
  expect(source).toContain('create-intake-section');
  expect(source).toContain('Synthetic Intake preview');
  expect(source).toContain('evaluateIntakePreview');
  expect(source).toContain("width === 'mobile' ? 'max-w-[375px]'");
  expect(source).toContain(
    "'/api/v1/administration/school-configuration/managed-translation-generations'",
  );
  expect(source).toContain('save-managed-translation');
  expect(source).toContain('review-managed-translation');
  expect(source).toContain('Generate suggestions');
  expect(source).toContain('Mark reviewed');
  expect(source).toContain('English is canonical');
  expect(source).toContain('Open exact preview');
  expect(source).toContain('Current authority:');
  expect(source).toContain('Review the resource-level diff');
  expect(source).toContain('localized string');
  expect(source).toContain('archive-authored-resource');
  expect(source).toContain('restore-release-assembly');
  expect(source).toContain('Clone into the shared draft');
  expect(source).toContain('Remove from next release');
  expect(source).toContain('Immutable release history');
  expect(source).toContain('data-readiness-target');
  expect(source).toContain('blocker.location');
  expect(source).toContain(
    "'/api/v1/administration/school-configuration/releases'",
  );
  expect(source).not.toContain('/api/v1/student/intake');
  expect(source).not.toContain(
    'Intake Form authoring is not part of this slice',
  );
  expect(source).not.toContain(
    'Managed Translation generation and review are not part of this slice',
  );
  expect(source).not.toContain('SchoolConfigurationEditorPrototype');
});

test('configuration publication keeps its success confirmation after reloading the draft', () => {
  const source = readFileSync(
    new URL(
      '../src/features/admin/SchoolConfigurationPage.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  const successStart = source.indexOf(
    'if (result.response.status === 201 && result.data)',
  );
  const success = source.slice(
    successStart,
    source.indexOf('const problem = result.error', successStart),
  );
  expect(success.indexOf('await loadDraft()')).toBeLessThan(
    success.indexOf('is active with one immutable package'),
  );
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

test('synthetic Intake preview omits hidden answers and applies requiredness', () => {
  const controller = {
    id: 'controller',
    type: 'yes-no',
    required: true,
    requiredWhenVisible: false,
    visibility: null as { fieldId: string; equalsOptionCode: string } | null,
    options: [{ code: 'yes' }, { code: 'no' }],
  };
  const dependent = {
    id: 'detail',
    type: 'textarea',
    required: false,
    requiredWhenVisible: true,
    visibility: { fieldId: 'controller', equalsOptionCode: 'yes' },
    options: [] as { code: string }[],
  };
  expect(intakeFieldIsVisible(dependent, { controller: 'no' })).toBe(false);
  expect(intakeFieldIsVisible(dependent, { controller: 'yes' })).toBe(true);
  expect(
    omitHiddenIntakeAnswers([controller, dependent], {
      controller: 'no',
      detail: 'kept only while visible',
    }),
  ).toEqual({ controller: 'no' });
  const hidden = evaluateIntakePreview([controller, dependent], {
    controller: 'no',
    detail: 'should vanish',
  });
  expect(hidden.visibleFieldIds).toEqual(['controller']);
  expect(hidden.answers).toEqual({ controller: 'no' });
  expect(hidden.requiredFieldIds).toEqual(['controller']);
  const shown = evaluateIntakePreview([controller, dependent], {
    controller: 'yes',
    detail: 'now required',
  });
  expect(shown.visibleFieldIds).toEqual(['controller', 'detail']);
  expect(shown.requiredFieldIds).toEqual(['controller', 'detail']);
  expect(shown.answers).toEqual({
    controller: 'yes',
    detail: 'now required',
  });
});
