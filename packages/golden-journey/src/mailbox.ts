import { NonRetryableGoldenJourneyError, retryTransient } from './retry.ts';

export type InvitationMailboxMessage = {
  id: string;
  createdAt: string;
  subject: string;
};

export type InvitationMailboxBody = {
  id: string;
  text: string;
  to: string[];
};

export type InvitationMailboxPage = {
  messages: readonly InvitationMailboxMessage[];
  nextCursor?: string;
};

export type InvitationMailbox = {
  list(cursor?: string): Promise<InvitationMailboxPage>;
  read(id: string): Promise<InvitationMailboxBody>;
};

const invitationCodePattern =
  /^Your Invitation Code is ([0-9]{6})\. It expires in 10 minutes\.$/;

export function extractInvitationCode(text: string): string {
  const match = invitationCodePattern.exec(text.trim());
  if (!match?.[1]) {
    throw new NonRetryableGoldenJourneyError(
      'Invitation Code could not be read from the delivery template',
    );
  }
  return match[1];
}

export function normalizeMailboxRecipient(value: string): string {
  return value.trim().toLowerCase();
}

async function listAllMessages(
  mailbox: InvitationMailbox,
  maxPages = 50,
): Promise<InvitationMailboxMessage[]> {
  const messages: InvitationMailboxMessage[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await mailbox.list(cursor);
    messages.push(...result.messages);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return messages;
}

export type ObservedInvitationMail = {
  code: string;
  messageId: string;
  createdAt: string;
};

export async function waitForInvitationCode(
  mailbox: InvitationMailbox,
  options: {
    expectedRecipient: string;
    since: Date;
    attempts: number;
    sleep: (ms: number) => Promise<void>;
    delayMs?: number;
    backoffFactor?: number;
    maxDelayMs?: number;
    clockSkewMs?: number;
    now?: () => Date;
    excludeMessageIds?: readonly string[];
  },
): Promise<ObservedInvitationMail> {
  const expectedRecipient = normalizeMailboxRecipient(
    options.expectedRecipient,
  );
  const excluded = new Set(options.excludeMessageIds ?? []);
  const skewMs = options.clockSkewMs ?? 30_000;
  const now = options.now ?? (() => new Date());
  try {
    return await retryTransient(
      async () => {
        const messages = await listAllMessages(mailbox);
        const earliest = options.since.getTime() - skewMs;
        const latest = now().getTime() + skewMs;
        const candidates = messages.filter((message) => {
          if (excluded.has(message.id)) return false;
          if (message.subject !== 'Your Invitation Code') return false;
          const createdAt = Date.parse(message.createdAt);
          if (Number.isNaN(createdAt)) return false;
          return createdAt >= earliest && createdAt <= latest;
        });
        if (candidates.length === 0) {
          throw new Error('Invitation delivery has not completed');
        }
        const ordered = [...candidates].sort(
          (left, right) =>
            Date.parse(right.createdAt) - Date.parse(left.createdAt),
        );
        for (const candidate of ordered) {
          const body = await mailbox.read(candidate.id);
          const recipients = body.to.map(normalizeMailboxRecipient);
          if (!recipients.includes(expectedRecipient)) continue;
          return {
            code: extractInvitationCode(body.text),
            messageId: candidate.id,
            createdAt: candidate.createdAt,
          };
        }
        throw new Error('Invitation delivery has not completed');
      },
      {
        attempts: options.attempts,
        delayMs: options.delayMs ?? 500,
        backoffFactor: options.backoffFactor ?? 2,
        maxDelayMs: options.maxDelayMs ?? 8_000,
        sleep: options.sleep,
      },
    );
  } catch {
    throw new Error('Invitation delivery was not observed');
  }
}

export function createResendInvitationMailbox(options: {
  apiKey: string;
  request?: typeof fetch;
}): InvitationMailbox {
  const request = options.request ?? fetch;
  return {
    async list(cursor) {
      const url = new URL('https://api.resend.com/emails');
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('after', cursor);
      const response = await request(url.toString(), {
        headers: { authorization: `Bearer ${options.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Invitation delivery listing failed');
      const body: unknown = await response.json();
      const record =
        body && typeof body === 'object'
          ? (body as Record<string, unknown>)
          : {};
      const data = Array.isArray(record.data) ? record.data : [];
      const messages = data.flatMap((entry) => {
        if (
          !entry ||
          typeof entry !== 'object' ||
          !('id' in entry) ||
          !('created_at' in entry) ||
          !('subject' in entry) ||
          typeof entry.id !== 'string' ||
          typeof entry.created_at !== 'string' ||
          typeof entry.subject !== 'string'
        ) {
          return [];
        }
        return [
          {
            id: entry.id,
            createdAt: entry.created_at,
            subject: entry.subject,
          },
        ];
      });
      const last = messages.at(-1);
      const hasMore =
        (typeof record.has_more === 'boolean' && record.has_more) ||
        messages.length === 100;
      return {
        messages,
        nextCursor: hasMore && last ? last.id : undefined,
      };
    },
    async read(id) {
      const response = await request(
        `https://api.resend.com/emails/${encodeURIComponent(id)}`,
        {
          headers: { authorization: `Bearer ${options.apiKey}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) throw new Error('Invitation delivery read failed');
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== 'object' ||
        !('id' in body) ||
        typeof body.id !== 'string'
      ) {
        throw new Error('Invitation delivery read failed');
      }
      const text =
        'text' in body && typeof body.text === 'string' ? body.text : '';
      const to =
        'to' in body && Array.isArray(body.to)
          ? body.to.filter(
              (value): value is string => typeof value === 'string',
            )
          : [];
      return { id: body.id, text, to };
    },
  };
}
