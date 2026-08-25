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

export type InvitationMailbox = {
  list(): Promise<readonly InvitationMailboxMessage[]>;
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

export async function waitForInvitationCode(
  mailbox: InvitationMailbox,
  options: {
    since: Date;
    attempts: number;
    sleep: (ms: number) => Promise<void>;
    delayMs?: number;
  },
): Promise<string> {
  try {
    return await retryTransient(
      async () => {
        const messages = await mailbox.list();
        const match = messages.find(
          (message) =>
            message.subject === 'Your Invitation Code' &&
            Date.parse(message.createdAt) >= options.since.getTime(),
        );
        if (!match) {
          throw new Error('Invitation delivery has not completed');
        }
        const body = await mailbox.read(match.id);
        return extractInvitationCode(body.text);
      },
      {
        attempts: options.attempts,
        delayMs: options.delayMs ?? 0,
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
    async list() {
      const response = await request('https://api.resend.com/emails?limit=20', {
        headers: { authorization: `Bearer ${options.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Invitation delivery listing failed');
      const body: unknown = await response.json();
      const data =
        body && typeof body === 'object' && 'data' in body
          ? (body as { data: unknown }).data
          : body;
      if (!Array.isArray(data)) return [];
      return data.flatMap((entry) => {
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
