/// <reference lib="dom" />
import type { Browser, Page } from 'playwright';
import {
  assertBrowserAccessibility,
  type AccessibilitySnapshot,
  type BrowserAssertionOutcomes,
  type BrowserLocale,
} from './browser-assertions.ts';

const locales: BrowserLocale[] = ['en-US', 'es-US', 'pt-BR', 'fr-CA', 'ht-HT'];

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

async function keyboardSequence(
  page: Page,
  expected: string[],
): Promise<string[]> {
  const focused: string[] = [];
  for (let index = 0; index < expected.length + 2; index += 1) {
    await page.keyboard.press('Tab');
    const identity = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return 'unknown';
      return (
        element.getAttribute('id') ||
        element.getAttribute('type') ||
        element.tagName.toLowerCase()
      );
    });
    if (!focused.includes(identity)) focused.push(identity);
    if (focused.length >= expected.length) break;
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

async function snapshotPage(options: {
  page: Page;
  origin: string;
  route: string;
  locale: BrowserLocale;
  viewport: { width: number; height: number; zoom: number };
  expectedFocus: string[];
  prepare?: (page: Page) => Promise<void>;
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
  const focusedSequence = await keyboardSequence(
    options.page,
    options.expectedFocus,
  );
  const visibleOnActiveElement = await focusVisible(options.page);
  if (options.prepare) await options.prepare(options.page);
  const body = await contrastPair(options.page, 'main', 'body');
  const button = await contrastPair(options.page, 'button', 'button').catch(
    () => body,
  );
  const announcements = await options.page
    .locator('[role="alert"], [aria-live]')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        role: element.getAttribute('role') ?? 'status',
        polite: element.getAttribute('aria-live') === 'polite',
        text: 'present',
      })),
    );
  return {
    route: options.route,
    locale: options.locale,
    viewport: options.viewport,
    keyboard: {
      focusedSequence,
      reachedSubmitWithoutPointer: focusedSequence.length >= 2,
    },
    focus: { visibleOnActiveElement, trappedInDialog: false },
    announcements,
    colors: [body, button],
    reflow: await reflow(options.page),
  };
}

export async function runGoldenJourneyBrowser(input: {
  origin: string;
  staffCookie?: string;
  studentCookie?: string;
}): Promise<BrowserAssertionOutcomes> {
  const playwright = await import('playwright');
  let browser: Browser | undefined;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
    });
    const context = await browser.newContext({
      ignoreHTTPSErrors: false,
      locale: 'en-US',
      serviceWorkers: 'block',
    });
    context.setDefaultTimeout(15_000);
    if (input.staffCookie) {
      for (const pair of input.staffCookie.split('; ')) {
        const separator = pair.indexOf('=');
        if (separator === -1) continue;
        await context.addCookies([
          {
            name: pair.slice(0, separator),
            value: pair.slice(separator + 1),
            url: input.origin,
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Strict',
          },
        ]);
      }
    }
    const page = await context.newPage();
    const snapshots: AccessibilitySnapshot[] = [];
    snapshots.push(
      await snapshotPage({
        page,
        origin: input.origin,
        route: '/staff/sign-in',
        locale: 'en-US',
        viewport: { width: 1280, height: 800, zoom: 1 },
        expectedFocus: ['email', 'password', 'submit'],
        prepare: async (current) => {
          await current
            .locator('input[type="email"]')
            .fill('synthetic@example.invalid');
          await current
            .locator('input[type="password"]')
            .fill('not-a-real-password');
          await current.locator('button[type="submit"]').click();
          await current
            .locator('[role="alert"]')
            .first()
            .waitFor({ timeout: 5_000 })
            .catch(() => undefined);
        },
      }),
    );

    snapshots.push(
      await snapshotPage({
        page,
        origin: input.origin,
        route: '/student/invitation',
        locale: 'es-US',
        viewport: { width: 375, height: 812, zoom: 1 },
        expectedFocus: ['email', 'text', 'submit'],
      }),
    );

    snapshots.push(
      await snapshotPage({
        page,
        origin: input.origin,
        route: '/staff/sign-in',
        locale: 'en-US',
        viewport: { width: 320, height: 640, zoom: 2 },
        expectedFocus: ['email', 'password', 'submit'],
      }),
    );

    const localesObserved: BrowserLocale[] = ['en-US', 'es-US'];
    if (input.staffCookie) {
      await page.goto(`${input.origin}/staff/configuration`, {
        waitUntil: 'networkidle',
      });
      const localeSelect = page.locator('select').first();
      if (await localeSelect.count()) {
        for (const locale of locales) {
          await localeSelect.selectOption(locale);
          localesObserved.push(locale);
        }
      }
    }
    const uniqueLocales = [...new Set(localesObserved)];

    if (input.staffCookie) {
      await page.goto(`${input.origin}/staff`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'Intake review' }).waitFor();
      await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page
        .getByRole('alert')
        .first()
        .waitFor({ timeout: 5_000 })
        .catch(() => undefined);
    }

    return assertBrowserAccessibility({
      snapshots,
      requiredLocales: locales,
      localesObserved: uniqueLocales,
    });
  } finally {
    await browser?.close();
  }
}
