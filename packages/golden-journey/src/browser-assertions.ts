export type BrowserLocale = 'en-US' | 'es-US' | 'pt-BR' | 'fr-CA' | 'ht-HT';

export const fixtureModuleTitles: Record<BrowserLocale, string> = {
  'en-US': 'Primary & Preventive Care',
  'es-US': 'Atención Primaria y Preventiva',
  'pt-BR': 'Cuidados Primários e Preventivos',
  'fr-CA': 'Soins Primaires et Préventifs',
  'ht-HT': 'Swen Prensipal ak Prevantif',
};

export const fixtureWorkspaceName = 'UMass Boston Demo Workspace';

export type AccessibilitySnapshot = {
  route: string;
  locale: BrowserLocale;
  viewport: { width: number; height: number; zoom: number };
  expectedFocusOrder: string[];
  keyboard: {
    focusedSequence: string[];
    reachedSubmitWithoutPointer: boolean;
  };
  focus: {
    visibleOnActiveElement: boolean;
    trappedInDialog: boolean;
  };
  announcements: { role: string; polite: boolean; text: string }[];
  expectedAnnouncementText?: string[];
  observedText: string;
  expectedTranslatedText: string[];
  colors: { foreground: string; background: string; name: string }[];
  reflow: { horizontalOverflowPx: number; contentFitsViewport: boolean };
  axeViolations: number;
  clinicalClearing?: {
    revealedPresentBeforeClear: boolean;
    revealedPresentAfterClear: boolean;
    filterValueAfterClear: string;
    selectedAfterClear: boolean;
    announcementText: string;
  };
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

function sequencesEqual(observed: string[], expected: string[]): boolean {
  return (
    observed.length === expected.length &&
    observed.every((identity, index) => identity === expected[index])
  );
}

export function assertBrowserAccessibility(input: {
  snapshots: AccessibilitySnapshot[];
  requiredLocales: readonly BrowserLocale[];
}): BrowserAssertionOutcomes {
  if (input.snapshots.length === 0) {
    throw new Error('browser snapshots are required');
  }

  for (const snapshot of input.snapshots) {
    if (snapshot.expectedFocusOrder.length < 1) {
      throw new Error('expected keyboard controls are incomplete');
    }
    if (
      !sequencesEqual(
        snapshot.keyboard.focusedSequence,
        snapshot.expectedFocusOrder,
      ) ||
      !snapshot.keyboard.reachedSubmitWithoutPointer
    ) {
      throw new Error('keyboard path did not match the expected controls');
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
    if (snapshot.axeViolations !== 0) {
      throw new Error('axe violations were observed');
    }
    for (const expected of snapshot.expectedTranslatedText) {
      if (!snapshot.observedText.includes(expected)) {
        throw new Error(`locale ${snapshot.locale} is missing expected text`);
      }
    }
    if (
      snapshot.announcements.some(
        (announcement) =>
          announcement.text.length === 0 || announcement.text === 'present',
      )
    ) {
      throw new Error('announcement text is missing');
    }
    for (const expected of snapshot.expectedAnnouncementText ?? []) {
      if (
        !snapshot.announcements.some(
          (announcement) => announcement.text === expected,
        )
      ) {
        throw new Error('announcements are missing');
      }
    }
    if (snapshot.clinicalClearing) {
      const clearing = snapshot.clinicalClearing;
      if (
        !clearing.revealedPresentBeforeClear ||
        clearing.revealedPresentAfterClear ||
        clearing.filterValueAfterClear !== '' ||
        clearing.selectedAfterClear ||
        clearing.announcementText !==
          'Clinical access is being rechecked. Sensitive values were cleared.'
      ) {
        throw new Error('clinical clearing did not complete');
      }
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
    throw new Error('responsive viewports are incomplete');
  }

  const zoomed = input.snapshots.some(
    (snapshot) => snapshot.viewport.zoom >= 2,
  );
  if (!zoomed) {
    throw new Error('zoom reflow viewport is missing');
  }

  for (const locale of input.requiredLocales) {
    const localeSnapshots = input.snapshots.filter(
      (snapshot) => snapshot.locale === locale,
    );
    if (localeSnapshots.length === 0) {
      throw new Error(`locale ${locale} was not observed`);
    }
    const expectedTitle = fixtureModuleTitles[locale];
    if (
      !localeSnapshots.some(
        (snapshot) =>
          snapshot.expectedTranslatedText.includes(expectedTitle) &&
          snapshot.observedText.includes(expectedTitle),
      )
    ) {
      throw new Error(`locale ${locale} is missing expected text`);
    }
    const hasDesktopLocale = localeSnapshots.some(
      (snapshot) =>
        snapshot.viewport.width >= 1024 && snapshot.viewport.zoom === 1,
    );
    const hasMobileLocale = localeSnapshots.some(
      (snapshot) =>
        snapshot.viewport.width <= 400 && snapshot.viewport.zoom === 1,
    );
    const hasZoomLocale = localeSnapshots.some(
      (snapshot) => snapshot.viewport.zoom >= 2,
    );
    if (!hasDesktopLocale || !hasMobileLocale || !hasZoomLocale) {
      throw new Error(`locale ${locale} is missing expected text`);
    }
  }

  const hasAlertOrStatus = input.snapshots.some((snapshot) =>
    snapshot.announcements.some(
      (announcement) =>
        (announcement.role === 'alert' || announcement.role === 'status') &&
        announcement.text.length > 0 &&
        announcement.text !== 'present',
    ),
  );
  if (!hasAlertOrStatus) {
    throw new Error('announcements are missing');
  }

  if (
    !input.snapshots.some((snapshot) => snapshot.clinicalClearing !== undefined)
  ) {
    throw new Error('clinical clearing did not complete');
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
