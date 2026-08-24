import createClient from 'openapi-fetch';
import type { paths } from './schema.ts';

export function createApiClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}

/**
 * Same-origin browser client. Cookies ride with the default same-origin
 * credentials mode; state-changing requests carry the synchronizer header
 * the server's origin/CSRF gate requires.
 */
export function createBrowserApiClient() {
  return createClient<paths>({
    fetch: (input: Request) => {
      if (['DELETE', 'PATCH', 'POST', 'PUT'].includes(input.method)) {
        input.headers.set('x-prevcare-csrf', '1');
      }
      return fetch(input);
    },
  });
}
