export const goldenJourneyBrowserContextOptions = {
  ignoreHTTPSErrors: false,
  locale: 'en-US',
  serviceWorkers: 'block' as const,
  // Isolated Playwright contexts only. Application CSP stays script-src 'self';
  // axe-core is injected via addScriptTag for accessibility instrumentation.
  bypassCSP: true,
};
