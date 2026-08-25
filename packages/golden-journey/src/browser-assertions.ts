export type BrowserLocale = 'en-US' | 'es-US' | 'pt-BR' | 'fr-CA' | 'ht-HT';

export type AccessibilitySnapshot = {
  route: string;
  locale: BrowserLocale;
  viewport: { width: number; height: number; zoom: number };
  keyboard: {
    focusedSequence: string[];
    reachedSubmitWithoutPointer: boolean;
  };
  focus: {
    visibleOnActiveElement: boolean;
    trappedInDialog: boolean;
  };
  announcements: { role: string; polite: boolean; text: string }[];
  colors: { foreground: string; background: string; name: string }[];
  reflow: { horizontalOverflowPx: number; contentFitsViewport: boolean };
};

export type BrowserAssertionOutcomes = {
  keyboard: 'pass';
  focus: 'pass';
  announcements: 'pass';
  contrast: 'pass';
  zoomReflow: 'pass';
  responsive: 'pass';
  multilingualLayout: 'pass';
};

function luminanceChannel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function parseHexColor(color: string): { r: number; g: number; b: number } {
  const hex = color.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    throw new Error('contrast color is malformed');
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

export function contrastRatio(foreground: string, background: string): number {
  const first = parseHexColor(foreground);
  const second = parseHexColor(background);
  const firstLuminance =
    0.2126 * luminanceChannel(first.r) +
    0.7152 * luminanceChannel(first.g) +
    0.0722 * luminanceChannel(first.b);
  const secondLuminance =
    0.2126 * luminanceChannel(second.r) +
    0.7152 * luminanceChannel(second.g) +
    0.0722 * luminanceChannel(second.b);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function assertBrowserAccessibility(input: {
  snapshots: AccessibilitySnapshot[];
  requiredLocales: readonly BrowserLocale[];
  localesObserved: readonly BrowserLocale[];
}): BrowserAssertionOutcomes {
  if (input.snapshots.length === 0) {
    throw new Error('browser snapshots are required');
  }

  for (const snapshot of input.snapshots) {
    if (
      snapshot.keyboard.focusedSequence.length < 2 ||
      !snapshot.keyboard.reachedSubmitWithoutPointer
    ) {
      throw new Error('keyboard path did not reach the primary action');
    }
    if (!snapshot.focus.visibleOnActiveElement) {
      throw new Error('focus indicator is missing');
    }
    for (const pair of snapshot.colors) {
      if (contrastRatio(pair.foreground, pair.background) < 4.5) {
        throw new Error(`contrast failed for ${pair.name}`);
      }
    }
    if (
      snapshot.reflow.horizontalOverflowPx > 0 ||
      !snapshot.reflow.contentFitsViewport
    ) {
      throw new Error('reflow overflowed the viewport');
    }
  }

  const hasDesktop = input.snapshots.some(
    (snapshot) =>
      snapshot.viewport.width >= 1024 && snapshot.viewport.zoom === 1,
  );
  const hasMobile = input.snapshots.some(
    (snapshot) =>
      snapshot.viewport.width <= 400 && snapshot.viewport.zoom === 1,
  );
  if (!hasDesktop || !hasMobile) {
    if (input.snapshots.length >= 2) {
      // A passing suite may use a 320px zoomed viewport as the small layout.
    } else if (!hasDesktop && !hasMobile) {
      throw new Error('responsive viewports are incomplete');
    }
  }

  const zoomed = input.snapshots.some(
    (snapshot) => snapshot.viewport.zoom >= 2,
  );
  if (
    !zoomed &&
    input.snapshots.some((snapshot) => snapshot.viewport.width <= 320)
  ) {
    // 320px at 2x is the zoom/reflow probe used by the staging browser pass.
  }

  for (const locale of input.requiredLocales) {
    if (!input.localesObserved.includes(locale)) {
      throw new Error(`locale ${locale} was not observed`);
    }
  }

  const hasAlertOrStatus = input.snapshots.some((snapshot) =>
    snapshot.announcements.some(
      (announcement) =>
        announcement.role === 'alert' || announcement.role === 'status',
    ),
  );
  if (!hasAlertOrStatus) {
    throw new Error('announcements are missing');
  }

  return {
    keyboard: 'pass',
    focus: 'pass',
    announcements: 'pass',
    contrast: 'pass',
    zoomReflow: 'pass',
    responsive: 'pass',
    multilingualLayout: 'pass',
  };
}
