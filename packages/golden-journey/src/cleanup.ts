export async function cleanupEphemeralAuthUsers(input: {
  supabaseUrl: string;
  secretKey: string;
  emails: readonly string[];
  request?: typeof fetch;
}): Promise<'completed' | 'failed' | 'not-attempted'> {
  if (input.emails.length === 0) return 'not-attempted';
  const request = input.request ?? fetch;
  const headers = {
    authorization: `Bearer ${input.secretKey}`,
    apikey: input.secretKey,
  };
  try {
    for (const email of input.emails) {
      const listed = await request(
        `${input.supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
        { headers, signal: AbortSignal.timeout(10_000) },
      );
      if (!listed.ok) return 'failed';
      const body: unknown = await listed.json();
      const users =
        body && typeof body === 'object' && 'users' in body
          ? (body as { users: unknown }).users
          : Array.isArray(body)
            ? body
            : [];
      if (!Array.isArray(users)) return 'failed';
      for (const user of users) {
        if (
          !user ||
          typeof user !== 'object' ||
          !('id' in user) ||
          typeof user.id !== 'string'
        ) {
          continue;
        }
        const deleted = await request(
          `${input.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
          {
            method: 'DELETE',
            headers,
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!deleted.ok && deleted.status !== 404) return 'failed';
      }
    }
    return 'completed';
  } catch {
    return 'failed';
  }
}
