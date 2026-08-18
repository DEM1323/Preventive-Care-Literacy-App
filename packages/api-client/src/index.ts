import createClient from 'openapi-fetch';
import type { paths } from './schema.ts';

export function createApiClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}
