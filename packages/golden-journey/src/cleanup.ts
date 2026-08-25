import { normalizeMailboxRecipient } from './mailbox.ts';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EphemeralAuthIdentity = {
  providerUserId?: string;
  normalizedEmail: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function usersFromBody(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter(isRecord);
  }
  if (isRecord(body) && Array.isArray(body.users)) {
    return body.users.filter(isRecord);
  }
  return [];
}

function exactEmailUsers(
  users: Record<string, unknown>[],
  expectedEmail: string,
): Record<string, unknown>[] {
  return users.filter((user) => {
    if (typeof user.email !== 'string') return false;
    return normalizeMailboxRecipient(user.email) === expectedEmail;
  });
}

export async function cleanupEphemeralAuthUsers(input: {
  supabaseUrl: string;
  secretKey: string;
  identities: readonly EphemeralAuthIdentity[];
  request?: typeof fetch;
}): Promise<'completed' | 'failed' | 'not-attempted'> {
  const identities = input.identities.map((identity) => ({
    providerUserId:
      typeof identity.providerUserId === 'string' &&
      uuidPattern.test(identity.providerUserId)
        ? identity.providerUserId
        : undefined,
    normalizedEmail: normalizeMailboxRecipient(identity.normalizedEmail),
  }));
  const tracked = identities.filter(
    (identity) =>
      identity.providerUserId !== undefined ||
      identity.normalizedEmail.length > 0,
  );
  if (tracked.length === 0) return 'not-attempted';
  const request = input.request ?? fetch;
  const headers = {
    authorization: `Bearer ${input.secretKey}`,
    apikey: input.secretKey,
  };
  const baseUrl = `${input.supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users`;

  async function deleteUser(id: string): Promise<boolean> {
    const deleted = await request(`${baseUrl}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    return deleted.ok || deleted.status === 404;
  }

  async function resolveExactEmail(email: string): Promise<string | undefined> {
    const listed = await request(
      `${baseUrl}?page=1&per_page=2&filter=${encodeURIComponent(email)}`,
      { headers, signal: AbortSignal.timeout(10_000) },
    );
    if (!listed.ok) return undefined;
    const exact = exactEmailUsers(usersFromBody(await listed.json()), email);
    if (exact.length !== 1) return undefined;
    const id = exact[0]?.id;
    if (typeof id !== 'string' || !uuidPattern.test(id)) return undefined;
    return id;
  }

  try {
    let failed = false;
    for (const identity of tracked) {
      if (identity.providerUserId) {
        if (!(await deleteUser(identity.providerUserId))) failed = true;
        continue;
      }
      const resolved = await resolveExactEmail(identity.normalizedEmail);
      if (!resolved || !(await deleteUser(resolved))) failed = true;
    }
    return failed ? 'failed' : 'completed';
  } catch {
    return 'failed';
  }
}
