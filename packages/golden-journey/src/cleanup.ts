import { normalizeMailboxRecipient } from './mailbox.ts';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  userIds?: readonly string[];
  emails?: readonly string[];
  request?: typeof fetch;
}): Promise<'completed' | 'failed' | 'not-attempted'> {
  const userIds = [...new Set(input.userIds ?? [])].filter((id) =>
    uuidPattern.test(id),
  );
  const emails = [
    ...new Set((input.emails ?? []).map(normalizeMailboxRecipient)),
  ].filter((email) => email.length > 0);
  if (userIds.length === 0 && emails.length === 0) return 'not-attempted';
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

  try {
    if (userIds.length > 0) {
      for (const id of userIds) {
        if (!(await deleteUser(id))) return 'failed';
      }
      return 'completed';
    }

    for (const email of emails) {
      const listed = await request(
        `${baseUrl}?page=1&per_page=2&filter=${encodeURIComponent(email)}`,
        { headers, signal: AbortSignal.timeout(10_000) },
      );
      if (!listed.ok) return 'failed';
      const exact = exactEmailUsers(usersFromBody(await listed.json()), email);
      if (exact.length !== 1) return 'failed';
      const id = exact[0]?.id;
      if (typeof id !== 'string' || !uuidPattern.test(id)) return 'failed';
      if (!(await deleteUser(id))) return 'failed';
    }
    return 'completed';
  } catch {
    return 'failed';
  }
}
