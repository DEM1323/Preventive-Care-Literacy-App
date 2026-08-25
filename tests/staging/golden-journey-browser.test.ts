import { expect, test } from 'bun:test';
import {
  assertBrowserAccessibility,
  contrastRatio,
} from '../../packages/golden-journey/src/index.ts';

const passingSnapshot = {
  route: '/staff/sign-in',
  locale: 'en-US' as const,
  viewport: { width: 1280, height: 800, zoom: 1 },
  keyboard: {
    focusedSequence: ['email', 'password', 'continue'],
    reachedSubmitWithoutPointer: true,
  },
  focus: {
    visibleOnActiveElement: true,
    trappedInDialog: false,
  },
  announcements: [{ role: 'alert', polite: false, text: 'Sign-in failed.' }],
  colors: [
    { foreground: '#e2e8f0', background: '#020617', name: 'body' },
    { foreground: '#0f172a', background: '#38bdf8', name: 'primary-button' },
  ],
  reflow: {
    horizontalOverflowPx: 0,
    contentFitsViewport: true,
  },
};

test('browser assertions accept keyboard, focus, announcement, contrast, zoom, and locale coverage', () => {
  const result = assertBrowserAccessibility({
    snapshots: [
      passingSnapshot,
      {
        ...passingSnapshot,
        route: '/student/invitation',
        locale: 'es-US',
        viewport: { width: 375, height: 812, zoom: 1 },
        keyboard: {
          focusedSequence: ['email', 'code', 'join'],
          reachedSubmitWithoutPointer: true,
        },
        announcements: [],
        colors: [
          {
            foreground: '#17332d',
            background: '#fffaf0',
            name: 'student-body',
          },
          {
            foreground: '#17332d',
            background: '#e6af2e',
            name: 'student-button',
          },
        ],
      },
      {
        ...passingSnapshot,
        route: '/staff/configuration',
        locale: 'ht-HT',
        viewport: { width: 320, height: 640, zoom: 2 },
        keyboard: {
          focusedSequence: ['locale', 'publish'],
          reachedSubmitWithoutPointer: true,
        },
        announcements: [
          { role: 'status', polite: true, text: 'Draft loaded.' },
        ],
        reflow: { horizontalOverflowPx: 0, contentFitsViewport: true },
      },
    ],
    requiredLocales: ['en-US', 'es-US', 'pt-BR', 'fr-CA', 'ht-HT'],
    localesObserved: ['en-US', 'es-US', 'pt-BR', 'fr-CA', 'ht-HT'],
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

test('browser assertions fail closed on missing keyboard path, contrast, overflow, or locale', () => {
  expect(() =>
    assertBrowserAccessibility({
      snapshots: [
        {
          ...passingSnapshot,
          keyboard: {
            focusedSequence: ['email'],
            reachedSubmitWithoutPointer: false,
          },
        },
      ],
      requiredLocales: ['en-US'],
      localesObserved: ['en-US'],
    }),
  ).toThrow('keyboard');

  expect(() =>
    assertBrowserAccessibility({
      snapshots: [
        {
          ...passingSnapshot,
          colors: [
            { foreground: '#64748b', background: '#64748b', name: 'flat' },
          ],
        },
      ],
      requiredLocales: ['en-US'],
      localesObserved: ['en-US'],
    }),
  ).toThrow('contrast');

  expect(() =>
    assertBrowserAccessibility({
      snapshots: [
        {
          ...passingSnapshot,
          viewport: { width: 320, height: 640, zoom: 2 },
          reflow: { horizontalOverflowPx: 240, contentFitsViewport: false },
        },
      ],
      requiredLocales: ['en-US'],
      localesObserved: ['en-US'],
    }),
  ).toThrow('reflow');

  expect(() =>
    assertBrowserAccessibility({
      snapshots: [passingSnapshot],
      requiredLocales: ['en-US', 'es-US'],
      localesObserved: ['en-US'],
    }),
  ).toThrow('locale');
});

test('browser assertions never keep announcement text in the outcome', () => {
  const result = assertBrowserAccessibility({
    snapshots: [passingSnapshot],
    requiredLocales: ['en-US'],
    localesObserved: ['en-US'],
  });
  expect(JSON.stringify(result)).not.toContain('Sign-in failed.');
});
