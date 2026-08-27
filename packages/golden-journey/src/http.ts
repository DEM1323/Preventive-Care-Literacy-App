export type GoldenJourneyFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class CookieJar {
  private readonly values = new Map<string, string>();

  store(response: Response): void {
    const listed =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
    const fallback = response.headers.get('set-cookie');
    const cookies = listed.length > 0 ? listed : fallback ? [fallback] : [];
    for (const cookie of cookies) {
      const pair = cookie.split(';', 1)[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator === -1) continue;
      this.values.set(
        pair.slice(0, separator).trim(),
        pair.slice(separator + 1),
      );
    }
  }

  header(): string | undefined {
    if (this.values.size === 0) return undefined;
    return [...this.values.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
}

export function createOriginFetch(options: {
  origin: string;
  fetch?: GoldenJourneyFetch;
  jar: CookieJar;
  authorization?: string;
}): GoldenJourneyFetch {
  const request = options.fetch ?? fetch;
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    const cookie = options.jar.header();
    if (cookie) headers.set('cookie', cookie);
    if (options.authorization) {
      headers.set('authorization', options.authorization);
      headers.set('origin', options.origin);
      headers.set('x-prevcare-csrf', '1');
    }
    const method = (init?.method ?? 'GET').toUpperCase();
    if (['DELETE', 'PATCH', 'POST', 'PUT'].includes(method)) {
      headers.set('origin', options.origin);
      headers.set('x-prevcare-csrf', '1');
      if (!headers.has('content-type') && init?.body) {
        headers.set('content-type', 'application/json');
      }
    }
    const response = await request(input, { ...init, headers });
    options.jar.store(response);
    return response;
  };
}

export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`HTTP ${response.status}`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function learningSnapshotContainsItemCompletion(
  body: unknown,
  itemCompletionId: string,
): boolean {
  if (!isRecord(body) || !Array.isArray(body.modules)) return false;
  return body.modules.some(
    (module) =>
      isRecord(module) &&
      Array.isArray(module.sections) &&
      module.sections.some(
        (section) =>
          isRecord(section) &&
          Array.isArray(section.items) &&
          section.items.some(
            (item) =>
              isRecord(item) &&
              isRecord(item.completion) &&
              item.completion.itemCompletionId === itemCompletionId,
          ),
      ),
  );
}
