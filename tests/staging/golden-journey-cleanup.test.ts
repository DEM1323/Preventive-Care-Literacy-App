import { expect, test } from 'bun:test';
import { cleanupEphemeralAuthUsers } from '../../packages/golden-journey/src/cleanup.ts';

const created = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8501';
const unrelated = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8502';
const matched = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8503';
const lost = '018f1f5e-7b76-7f70-8f4d-9dc17ecf8504';

test('cleanup deletes only tracked Auth user IDs and never lists users', async () => {
  const requests: string[] = [];
  const status = await cleanupEphemeralAuthUsers({
    supabaseUrl: 'https://project-ref.supabase.co',
    secretKey: 'secret',
    identities: [
      { providerUserId: created, normalizedEmail: 'g1@example.test' },
    ],
    request: async (input, init) => {
      const url = input.toString();
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes(unrelated)) {
        throw new Error('unrelated Auth user was targeted');
      }
      return new Response(null, { status: 204 });
    },
  });
  expect(status).toBe('completed');
  expect(requests).toEqual([
    `DELETE https://project-ref.supabase.co/auth/v1/admin/users/${created}`,
  ]);
  expect(requests.join(' ')).not.toContain('email=');
  expect(requests.join(' ')).not.toContain(unrelated);
});

test('cleanup deletes mixed known IDs and email-only identities without returning after the first ID', async () => {
  const deleted: string[] = [];
  const listed: string[] = [];
  const status = await cleanupEphemeralAuthUsers({
    supabaseUrl: 'https://project-ref.supabase.co',
    secretKey: 'secret',
    identities: [
      { providerUserId: created, normalizedEmail: 'known@example.test' },
      { normalizedEmail: 'g1@example.test' },
    ],
    request: async (input, init) => {
      const url = input.toString();
      if ((init?.method ?? 'GET') === 'GET') {
        listed.push(url);
        expect(url).toContain('filter=g1%40example.test');
        expect(url).not.toContain('email=');
        expect(url).not.toContain('known@example.test');
        return Response.json({
          users: [
            { id: matched, email: 'g1@example.test' },
            { id: unrelated, email: 'unrelated@example.test' },
          ],
        });
      }
      deleted.push(url);
      if (url.includes(unrelated)) {
        throw new Error('unrelated Auth user was targeted');
      }
      return new Response(null, { status: 204 });
    },
  });
  expect(status).toBe('completed');
  expect(deleted).toEqual([
    `https://project-ref.supabase.co/auth/v1/admin/users/${created}`,
    `https://project-ref.supabase.co/auth/v1/admin/users/${matched}`,
  ]);
  expect(listed).toHaveLength(1);
  expect(deleted.join(' ')).not.toContain(unrelated);
});

test('cleanup resolves a response-lost provision by exact email and does not delete unrelated users', async () => {
  const deleted: string[] = [];
  const status = await cleanupEphemeralAuthUsers({
    supabaseUrl: 'https://project-ref.supabase.co',
    secretKey: 'secret',
    identities: [{ normalizedEmail: 'lost@example.test' }],
    request: async (input, init) => {
      const url = input.toString();
      if ((init?.method ?? 'GET') === 'GET') {
        expect(url).toContain('filter=lost%40example.test');
        return Response.json({
          users: [
            { id: lost, email: 'lost@example.test' },
            { id: unrelated, email: 'unrelated@example.test' },
          ],
        });
      }
      deleted.push(url);
      if (url.includes(unrelated)) {
        throw new Error('unrelated Auth user was targeted');
      }
      return new Response(null, { status: 204 });
    },
  });
  expect(status).toBe('completed');
  expect(deleted).toEqual([
    `https://project-ref.supabase.co/auth/v1/admin/users/${lost}`,
  ]);
});

test('cleanup ignores unrelated users on a filter page and deletes only the exact email match', async () => {
  const deleted: string[] = [];
  const status = await cleanupEphemeralAuthUsers({
    supabaseUrl: 'https://project-ref.supabase.co',
    secretKey: 'secret',
    identities: [{ normalizedEmail: 'g1@example.test' }],
    request: async (input, init) => {
      const url = input.toString();
      if ((init?.method ?? 'GET') === 'GET') {
        expect(url).toContain('filter=g1%40example.test');
        expect(url).not.toContain('email=');
        return Response.json({
          users: [
            { id: matched, email: 'g1@example.test' },
            { id: unrelated, email: 'unrelated@example.test' },
          ],
        });
      }
      deleted.push(url);
      return new Response(null, { status: 204 });
    },
  });
  expect(status).toBe('completed');
  expect(deleted).toEqual([
    `https://project-ref.supabase.co/auth/v1/admin/users/${matched}`,
  ]);
  expect(deleted.join(' ')).not.toContain(unrelated);
});

test('cleanup refuses deletion when more than one exact email matches', async () => {
  const deleted: string[] = [];
  const status = await cleanupEphemeralAuthUsers({
    supabaseUrl: 'https://project-ref.supabase.co',
    secretKey: 'secret',
    identities: [{ normalizedEmail: 'g1@example.test' }],
    request: async (input, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return Response.json({
          users: [
            { id: matched, email: 'g1@example.test' },
            { id: unrelated, email: 'G1@example.test' },
          ],
        });
      }
      deleted.push(input.toString());
      return new Response(null, { status: 204 });
    },
  });
  expect(status).toBe('failed');
  expect(deleted).toEqual([]);
});

test('cleanup refuses deletion when the only filter hit is not an exact email match', async () => {
  const deleted: string[] = [];
  const status = await cleanupEphemeralAuthUsers({
    supabaseUrl: 'https://project-ref.supabase.co',
    secretKey: 'secret',
    identities: [{ normalizedEmail: 'g1@example.test' }],
    request: async (input, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return Response.json({
          users: [{ id: unrelated, email: 'g1@example.test.attacker' }],
        });
      }
      deleted.push(input.toString());
      return new Response(null, { status: 204 });
    },
  });
  expect(status).toBe('failed');
  expect(deleted).toEqual([]);
});

test('cleanup reports not-attempted when no Auth users were created', async () => {
  const status = await cleanupEphemeralAuthUsers({
    supabaseUrl: 'https://project-ref.supabase.co',
    secretKey: 'secret',
    identities: [],
  });
  expect(status).toBe('not-attempted');
});
