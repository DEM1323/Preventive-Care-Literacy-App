import { expect, test } from 'bun:test';
import { sessionCookiesForOrigin } from '../../packages/golden-journey/src/browser-cookies.ts';
import { assertExactSubmittedAnswers } from '../../packages/golden-journey/src/clinical-answers.ts';
import {
  assertBrowserAccessibility,
  contrastRatio,
  fixtureModuleTitles,
  type AccessibilitySnapshot,
  type BrowserLocale,
} from '../../packages/golden-journey/src/index.ts';

const locales: BrowserLocale[] = ['en-US', 'es-US', 'pt-BR', 'fr-CA', 'ht-HT'];

function snapshot(
  overrides: Partial<AccessibilitySnapshot> = {},
): AccessibilitySnapshot {
  const locale = overrides.locale ?? 'en-US';
  const title = fixtureModuleTitles[locale];
  return {
    route: '/staff/configuration',
    locale,
    viewport: { width: 1280, height: 800, zoom: 1 },
    expectedFocusOrder: ['preview-locale', 'preview-width'],
    keyboard: {
      focusedSequence: ['preview-locale', 'preview-width'],
      reachedSubmitWithoutPointer: true,
    },
    focus: {
      visibleOnActiveElement: true,
      trappedInDialog: false,
    },
    announcements: [],
    observedText: `UMass Boston Demo Workspace ${title}`,
    expectedTranslatedText: ['UMass Boston Demo Workspace', title],
    colors: [
      { foreground: '#e2e8f0', background: '#020617', name: 'body' },
      { foreground: '#0f172a', background: '#38bdf8', name: 'primary-button' },
    ],
    reflow: {
      horizontalOverflowPx: 0,
      contentFitsViewport: true,
    },
    axeViolations: 0,
    ...overrides,
  };
}

function completeSnapshots(): AccessibilitySnapshot[] {
  const snapshots: AccessibilitySnapshot[] = [];
  for (const locale of locales) {
    snapshots.push(
      snapshot({ locale, viewport: { width: 1280, height: 800, zoom: 1 } }),
    );
    snapshots.push(
      snapshot({ locale, viewport: { width: 375, height: 812, zoom: 1 } }),
    );
    snapshots.push(
      snapshot({ locale, viewport: { width: 320, height: 640, zoom: 2 } }),
    );
  }
  snapshots[0] = snapshot({
    locale: 'en-US',
    route: '/staff/sign-in',
    expectedFocusOrder: ['email', 'password', 'submit'],
    keyboard: {
      focusedSequence: ['email', 'password', 'submit'],
      reachedSubmitWithoutPointer: true,
    },
    announcements: [
      {
        role: 'alert',
        polite: false,
        text: 'Sign-in failed. Check your email address and password.',
      },
    ],
    expectedAnnouncementText: [
      'Sign-in failed. Check your email address and password.',
    ],
    observedText: `UMass Boston Demo Workspace ${fixtureModuleTitles['en-US']} Sign-in failed. Check your email address and password.`,
    expectedTranslatedText: [
      'UMass Boston Demo Workspace',
      fixtureModuleTitles['en-US'],
    ],
  });
  snapshots.push(
    snapshot({
      route: '/staff',
      clinicalClearing: {
        revealedPresentBeforeClear: true,
        revealedPresentAfterClear: false,
        filterValueAfterClear: '',
        selectedAfterClear: false,
        announcementText:
          'Clinical access is being rechecked. Sensitive values were cleared.',
      },
    }),
  );
  return snapshots;
}

test('browser assertions require matching focus order, fixture translations, axe, zoom, and clinical clearing', () => {
  const result = assertBrowserAccessibility({
    snapshots: completeSnapshots(),
    requiredLocales: locales,
  });
  expect(result).toEqual({
    keyboard: 'pass',
    focus: 'pass',
    announcements: 'pass',
    contrast: 'pass',
    zoomReflow: 'pass',
    responsive: 'pass',
    multilingualLayout: 'pass',
  });
});

test('contrast helper uses WCAG relative luminance', () => {
  expect(contrastRatio('#000000', '#ffffff')).toBe(21);
  expect(contrastRatio('#38bdf8', '#0f172a')).toBeGreaterThan(4.5);
  expect(contrastRatio('#64748b', '#64748b')).toBe(1);
});

test('browser assertions fail when the observed focus order does not equal the expected controls', () => {
  const snapshots = completeSnapshots();
  snapshots[0] = {
    ...snapshots[0]!,
    expectedFocusOrder: ['email', 'password', 'submit'],
    keyboard: {
      focusedSequence: ['email', 'submit'],
      reachedSubmitWithoutPointer: true,
    },
  };
  expect(() =>
    assertBrowserAccessibility({ snapshots, requiredLocales: locales }),
  ).toThrow('keyboard path did not match the expected controls');
});

test('browser assertions fail when zoom or responsive branches would no-op', () => {
  const withoutZoom = completeSnapshots().filter(
    (entry) => entry.viewport.zoom === 1,
  );
  expect(() =>
    assertBrowserAccessibility({
      snapshots: withoutZoom,
      requiredLocales: locales,
    }),
  ).toThrow('zoom reflow viewport is missing');

  const desktopOnly = completeSnapshots().filter(
    (entry) => entry.viewport.width >= 1024 || entry.clinicalClearing,
  );
  expect(() =>
    assertBrowserAccessibility({
      snapshots: desktopOnly,
      requiredLocales: locales,
    }),
  ).toThrow();
});

test('browser assertions fail when a locale is only selected and not translated', () => {
  const snapshots = completeSnapshots().map((entry) =>
    entry.locale === 'ht-HT'
      ? {
          ...entry,
          observedText: 'UMass Boston Demo Workspace',
          expectedTranslatedText: ['UMass Boston Demo Workspace'],
        }
      : entry,
  );
  expect(() =>
    assertBrowserAccessibility({ snapshots, requiredLocales: locales }),
  ).toThrow('locale ht-HT is missing expected text');
});

test('browser assertions fail when announcement text is a placeholder or clinical answers stay visible', () => {
  const placeholder = completeSnapshots();
  placeholder[0] = {
    ...placeholder[0]!,
    announcements: [{ role: 'alert', polite: false, text: 'present' }],
    expectedAnnouncementText: undefined,
  };
  expect(() =>
    assertBrowserAccessibility({
      snapshots: placeholder,
      requiredLocales: locales,
    }),
  ).toThrow('announcement text is missing');

  const uncleared = completeSnapshots();
  const clinical = uncleared.at(-1)!;
  uncleared[uncleared.length - 1] = {
    ...clinical,
    clinicalClearing: {
      revealedPresentBeforeClear: true,
      revealedPresentAfterClear: true,
      filterValueAfterClear: 'student',
      selectedAfterClear: true,
      announcementText: 'present',
    },
  };
  expect(() =>
    assertBrowserAccessibility({
      snapshots: uncleared,
      requiredLocales: locales,
    }),
  ).toThrow('clinical clearing did not complete');
});

test('browser assertions never keep announcement text in the outcome', () => {
  const result = assertBrowserAccessibility({
    snapshots: completeSnapshots(),
    requiredLocales: locales,
  });
  expect(JSON.stringify(result)).not.toContain('Sign-in failed.');
  expect(JSON.stringify(result)).not.toContain('Swen Prensipal');
});

test('session cookie injection uses url only and never pairs it with domain or path', () => {
  const cookies = sessionCookiesForOrigin(
    '__Host-prevcare-staff-session=staff-handle; __Host-prevcare-student-session=student-handle',
    'https://staging.up.railway.app',
  );
  expect(cookies).toEqual([
    {
      name: '__Host-prevcare-staff-session',
      value: 'staff-handle',
      url: 'https://staging.up.railway.app',
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
    {
      name: '__Host-prevcare-student-session',
      value: 'student-handle',
      url: 'https://staging.up.railway.app',
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  for (const cookie of cookies) {
    expect(Object.keys(cookie).sort()).toEqual([
      'httpOnly',
      'name',
      'sameSite',
      'secure',
      'url',
      'value',
    ]);
    expect('path' in cookie).toBe(false);
    expect('domain' in cookie).toBe(false);
  }
});

test('clinical reveal compares submitted answers exactly then discards them from the record', () => {
  const submitted = { 'field-name': 'Synthetic Student' };
  const revealed = {
    answers: { 'field-name': 'Synthetic Student' },
    intakeForm: { title: 'secret-form' },
  };
  expect(() =>
    assertExactSubmittedAnswers(revealed.answers, submitted),
  ).not.toThrow();
  expect(() =>
    assertExactSubmittedAnswers({ 'field-name': 'other' }, submitted),
  ).toThrow('Clinical reveal answers did not match');
  expect(() =>
    assertExactSubmittedAnswers(
      { 'field-name': 'Synthetic Student', extra: 'x' },
      submitted,
    ),
  ).toThrow('Clinical reveal answers did not match');
});
