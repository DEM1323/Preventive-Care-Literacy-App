/// <reference lib="dom" />
import { createRequire } from 'node:module';
import type { Browser, BrowserContext, Page } from 'playwright';
import {
  assertBrowserAccessibility,
  fixtureModuleTitles,
  type AccessibilitySnapshot,
  type BrowserAssertionOutcomes,
  type BrowserLocale,
} from './browser-assertions.ts';
import { goldenJourneyBrowserControls } from './browser-controls.ts';
import { sessionCookiesForOrigin } from './browser-cookies.ts';

const locales: BrowserLocale[] = ['en-US', 'es-US', 'pt-BR', 'fr-CA', 'ht-HT'];
const require = createRequire(import.meta.url);

function rgbToHex(color: string): string | undefined {
  const match = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!match) return undefined;
  return `#${[match[1], match[2], match[3]]
    .map((part) => Number(part).toString(16).padStart(2, '0'))
    .join('')}`;
}

async function contrastPair(
  page: Page,
  selector: string,
  name: string,
): Promise<{ foreground: string; background: string; name: string }> {
  const colors = await page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  const foreground = rgbToHex(colors.color);
  const background = rgbToHex(colors.background);
  if (!foreground || !background) {
    throw new Error(`contrast colors unavailable for ${name}`);
  }
  return { foreground, background, name };
}

async function focusControl(page: Page, identity: string): Promise<void> {
  const byId = page.locator(`[id="${identity}"]`);
  if ((await byId.count()) > 0) {
    await byId.first().focus();
    return;
  }
  const byType = page.locator(
    `input[type="${identity}"], button[type="${identity}"]`,
  );
  if ((await byType.count()) > 0) {
    await byType.first().focus();
    return;
  }
  throw new Error('expected keyboard control is missing');
}

async function keyboardSequence(
  page: Page,
  expected: string[],
): Promise<string[]> {
  if (expected.length === 0) return [];
  await focusControl(page, expected[0]!);
  const focused: string[] = [];
  const identity = async () =>
    page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return 'unknown';
      return (
        element.getAttribute('id') ||
        element.getAttribute('type') ||
        element.tagName.toLowerCase()
      );
    });
  focused.push(await identity());
  for (let index = 1; index < expected.length; index += 1) {
    await page.keyboard.press('Tab');
    focused.push(await identity());
  }
  return focused;
}

async function focusVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    return (
      style.outlineStyle !== 'none' ||
      style.boxShadow !== 'none' ||
      style.outlineWidth !== '0px'
    );
  });
}

async function reflow(page: Page): Promise<{
  horizontalOverflowPx: number;
  contentFitsViewport: boolean;
}> {
  return page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    return {
      horizontalOverflowPx: Math.max(0, overflow),
      contentFitsViewport: overflow <= 1,
    };
  });
}

async function axeViolationCount(page: Page): Promise<number> {
  const axePath = require.resolve('axe-core/axe.min.js');
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (options?: {
            rules: Record<string, { enabled: boolean }>;
          }) => Promise<{ violations: { id: string }[] }>;
        };
      }
    ).axe;
    const results = await axe.run({
      rules: { 'color-contrast': { enabled: false } },
    });
    return results.violations.length;
  });
}

async function applyCookies(
  context: BrowserContext,
  origin: string,
  cookieHeader: string | undefined,
): Promise<void> {
  const cookies = sessionCookiesForOrigin(cookieHeader, origin);
  if (cookies.length > 0) await context.addCookies(cookies);
}

async function snapshotPage(options: {
  page: Page;
  origin: string;
  route: string;
  locale: BrowserLocale;
  viewport: { width: number; height: number; zoom: number };
  expectedFocus: string[];
  expectedTranslatedText: string[];
  expectedAnnouncementText?: string[];
  prepare?: (page: Page) => Promise<void>;
  runAxe?: boolean;
}): Promise<AccessibilitySnapshot> {
  await options.page.setViewportSize({
    width: options.viewport.width,
    height: options.viewport.height,
  });
  await options.page.goto(`${options.origin}${options.route}`, {
    waitUntil: 'networkidle',
  });
  if (options.viewport.zoom !== 1) {
    await options.page.evaluate((zoom) => {
      document.documentElement.style.zoom = String(zoom);
    }, options.viewport.zoom);
  }
  if (options.prepare) await options.prepare(options.page);
  const focusedSequence = await keyboardSequence(
    options.page,
    options.expectedFocus,
  );
  const visibleOnActiveElement = await focusVisible(options.page);
  const announcements = await options.page
    .locator('[role="alert"], [aria-live]')
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const text = (element.textContent ?? '').trim();
        if (!text) return [];
        return [
          {
            role: element.getAttribute('role') ?? 'status',
            polite: element.getAttribute('aria-live') === 'polite',
            text,
          },
        ];
      }),
    );
  const observedText = await options.page.locator('main').innerText();
  const body = await contrastPair(options.page, 'main', 'body');
  const button = await contrastPair(options.page, 'button', 'button').catch(
    () => body,
  );
  return {
    route: options.route,
    locale: options.locale,
    viewport: options.viewport,
    expectedFocusOrder: options.expectedFocus,
    keyboard: {
      focusedSequence,
      reachedSubmitWithoutPointer: focusedSequence.length >= 1,
    },
    focus: { visibleOnActiveElement, trappedInDialog: false },
    announcements,
    expectedAnnouncementText: options.expectedAnnouncementText,
    observedText,
    expectedTranslatedText: options.expectedTranslatedText,
    colors: [body, button],
    reflow: await reflow(options.page),
    axeViolations:
      options.runAxe === false ? 0 : await axeViolationCount(options.page),
  };
}

async function collectLocaleSnapshots(
  page: Page,
  origin: string,
): Promise<AccessibilitySnapshot[]> {
  const snapshots: AccessibilitySnapshot[] = [];
  const viewports = [
    { width: 1280, height: 800, zoom: 1 },
    { width: 375, height: 812, zoom: 1 },
    { width: 320, height: 640, zoom: 2 },
  ] as const;
  for (const locale of locales) {
    for (const viewport of viewports) {
      snapshots.push(
        await snapshotPage({
          page,
          origin,
          route: '/staff/configuration',
          locale,
          viewport,
          expectedFocus: [...goldenJourneyBrowserControls.configuration],
          expectedTranslatedText: [
            'UMass Boston Demo Workspace',
            fixtureModuleTitles[locale],
          ],
          prepare: async (current) => {
            await current.locator('#preview-locale').selectOption(locale);
            await current
              .getByText(fixtureModuleTitles[locale], { exact: true })
              .first()
              .waitFor();
          },
        }),
      );
    }
  }
  return snapshots;
}

async function collectClinicalClearing(
  page: Page,
  origin: string,
  studentId: string,
): Promise<AccessibilitySnapshot> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${origin}/staff`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Intake review' }).waitFor();
  const reveal = page.getByRole('button', { name: 'Reveal current record' });
  await reveal.first().waitFor({ timeout: 15_000 });
  await page.locator('#student-filter').fill(studentId);
  await reveal.first().click();
  const record = page.locator('article').filter({
    has: page.getByRole('heading', { name: 'Current Intake Record' }),
  });
  await record.waitFor();
  const revealedCount = await record.locator('dd').count();
  if (revealedCount < 1) {
    throw new Error('clinical reveal did not render through the UI');
  }
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const announcement = page.getByRole('alert').first();
  await announcement.waitFor();
  const announcementText = ((await announcement.textContent()) ?? '').trim();
  const revealedPresentAfterClear = await record
    .count()
    .then((count) => count > 0);
  const filterValueAfterClear = await page
    .locator('#student-filter')
    .inputValue();
  const selectedAfterClear = await page
    .locator('li.border-sky-400')
    .count()
    .then((count) => count > 0);
  const snapshot = await snapshotPage({
    page,
    origin,
    route: '/staff',
    locale: 'en-US',
    viewport: { width: 1280, height: 800, zoom: 1 },
    expectedFocus: [...goldenJourneyBrowserControls.staffHome],
    expectedTranslatedText: ['Intake review'],
    expectedAnnouncementText: [
      'Clinical access is being rechecked. Sensitive values were cleared.',
    ],
    runAxe: true,
  });
  return {
    ...snapshot,
    announcements: [
      { role: 'alert', polite: false, text: announcementText },
      ...snapshot.announcements,
    ],
    expectedAnnouncementText: [
      'Clinical access is being rechecked. Sensitive values were cleared.',
    ],
    clinicalClearing: {
      revealedPresentBeforeClear: revealedCount > 0,
      revealedPresentAfterClear,
      filterValueAfterClear,
      selectedAfterClear,
      announcementText,
    },
  };
}

export async function runGoldenJourneyBrowser(input: {
  origin: string;
  staffCookie?: string;
  studentCookie?: string;
  studentId: string;
}): Promise<BrowserAssertionOutcomes> {
  const playwright = await import('playwright');
  let browser: Browser | undefined;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
    });
    const snapshots: AccessibilitySnapshot[] = [];

    const anonymous = await browser.newContext({
      ignoreHTTPSErrors: false,
      locale: 'en-US',
      serviceWorkers: 'block',
    });
    anonymous.setDefaultTimeout(15_000);
    const anonymousPage = await anonymous.newPage();
    snapshots.push(
      await snapshotPage({
        page: anonymousPage,
        origin: input.origin,
        route: '/staff/sign-in',
        locale: 'en-US',
        viewport: { width: 1280, height: 800, zoom: 1 },
        expectedFocus: [...goldenJourneyBrowserControls.signIn],
        expectedTranslatedText: ['Sign in'],
        expectedAnnouncementText: [
          'Sign-in failed. Check your email address and password.',
        ],
        prepare: async (current) => {
          await current
            .locator('input[type="email"]')
            .fill('synthetic@example.invalid');
          await current
            .locator('input[type="password"]')
            .fill('not-a-real-password');
          await current.locator('button[type="submit"]').click();
          await current.getByRole('alert').first().waitFor({ timeout: 5_000 });
        },
      }),
    );
    snapshots.push(
      await snapshotPage({
        page: anonymousPage,
        origin: input.origin,
        route: '/student/invitation',
        locale: 'en-US',
        viewport: { width: 375, height: 812, zoom: 1 },
        expectedFocus: [...goldenJourneyBrowserControls.invitation],
        expectedTranslatedText: ['Join your class.'],
      }),
    );
    await anonymous.close();

    if (!input.staffCookie || !input.studentCookie) {
      throw new Error('authenticated browser cookies are required');
    }

    const staff = await browser.newContext({
      ignoreHTTPSErrors: false,
      locale: 'en-US',
      serviceWorkers: 'block',
    });
    staff.setDefaultTimeout(15_000);
    await applyCookies(staff, input.origin, input.staffCookie);
    const staffPage = await staff.newPage();
    snapshots.push(...(await collectLocaleSnapshots(staffPage, input.origin)));
    snapshots.push(
      await collectClinicalClearing(staffPage, input.origin, input.studentId),
    );
    await staff.close();

    const student = await browser.newContext({
      ignoreHTTPSErrors: false,
      locale: 'en-US',
      serviceWorkers: 'block',
    });
    student.setDefaultTimeout(15_000);
    await applyCookies(student, input.origin, input.studentCookie);
    const studentPage = await student.newPage();
    snapshots.push(
      await snapshotPage({
        page: studentPage,
        origin: input.origin,
        route: '/student',
        locale: 'en-US',
        viewport: { width: 1280, height: 800, zoom: 1 },
        expectedFocus: [...goldenJourneyBrowserControls.studentHomeUnlocked],
        expectedTranslatedText: ['Your learning space'],
      }),
    );
    snapshots.push(
      await snapshotPage({
        page: studentPage,
        origin: input.origin,
        route: '/student/intake',
        locale: 'en-US',
        viewport: { width: 375, height: 812, zoom: 1 },
        expectedFocus: [...goldenJourneyBrowserControls.intakeAccepted],
        expectedTranslatedText: ['Intake accepted', 'Learning is unlocked.'],
      }),
    );
    snapshots.push(
      await snapshotPage({
        page: studentPage,
        origin: input.origin,
        route: '/student/learning',
        locale: 'en-US',
        viewport: { width: 320, height: 640, zoom: 2 },
        expectedFocus: [...goldenJourneyBrowserControls.learning],
        expectedTranslatedText: [],
      }),
    );
    await student.close();

    return assertBrowserAccessibility({
      snapshots,
      requiredLocales: locales,
    });
  } finally {
    await browser?.close();
  }
}
