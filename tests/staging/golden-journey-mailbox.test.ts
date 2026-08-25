import { expect, test } from 'bun:test';
import {
  extractInvitationCode,
  waitForInvitationCode,
} from '../../packages/golden-journey/src/index.ts';

const recipient = 'controlled@example.test';
const codeText = 'Your Invitation Code is 654321. It expires in 10 minutes.';

test('mailbox parser extracts a six-digit Invitation Code from the fixed subject text', () => {
  expect(extractInvitationCode(codeText)).toBe('654321');
});

test('mailbox parser rejects bodies that are not the invitation template', () => {
  expect(() => extractInvitationCode('Your sign-in code is 729104.')).toThrow(
    'Invitation Code',
  );
});

test('mailbox waiter correlates subject, sent-after, and the expected recipient before extracting a code', async () => {
  const requests: string[] = [];
  const code = await waitForInvitationCode(
    {
      list: async () => {
        requests.push('list');
        if (requests.filter((item) => item === 'list').length < 2) {
          return { messages: [] };
        }
        return {
          messages: [
            {
              id: 'msg-1',
              createdAt: '2026-08-25T16:01:00.000Z',
              subject: 'Your Invitation Code',
            },
          ],
        };
      },
      read: async (id) => {
        requests.push(`read:${id}`);
        return {
          id,
          text: codeText,
          to: ['Controlled@example.test'],
        };
      },
    },
    {
      expectedRecipient: recipient,
      since: new Date('2026-08-25T16:00:00.000Z'),
      sleep: async () => undefined,
      attempts: 3,
      now: () => new Date('2026-08-25T16:02:00.000Z'),
    },
  );

  expect(code).toBe('654321');
  expect(requests).toEqual(['list', 'list', 'read:msg-1']);
});

test('mailbox waiter ignores a matching subject sent to an unrelated recipient', async () => {
  try {
    await waitForInvitationCode(
      {
        list: async () => ({
          messages: [
            {
              id: 'msg-other',
              createdAt: '2026-08-25T16:01:00.000Z',
              subject: 'Your Invitation Code',
            },
          ],
        }),
        read: async (id) => ({
          id,
          text: 'Your Invitation Code is 111111. It expires in 10 minutes.',
          to: ['unrelated@example.test'],
        }),
      },
      {
        expectedRecipient: recipient,
        since: new Date('2026-08-25T16:00:00.000Z'),
        sleep: async () => undefined,
        attempts: 1,
        now: () => new Date('2026-08-25T16:02:00.000Z'),
      },
    );
  } catch (error) {
    const message = String(error);
    expect(message).toContain('Invitation delivery');
    expect(message).not.toContain('unrelated@example.test');
    expect(message).not.toContain('111111');
    expect(message).not.toContain(recipient);
    return;
  }
  throw new Error('expected unrelated recipient to fail closed');
});

test('mailbox waiter rejects old messages even when the recipient matches', async () => {
  await expect(
    waitForInvitationCode(
      {
        list: async () => ({
          messages: [
            {
              id: 'msg-old',
              createdAt: '2026-08-25T15:00:00.000Z',
              subject: 'Your Invitation Code',
            },
          ],
        }),
        read: async () => ({
          id: 'msg-old',
          text: codeText,
          to: [recipient],
        }),
      },
      {
        expectedRecipient: recipient,
        since: new Date('2026-08-25T16:00:00.000Z'),
        sleep: async () => undefined,
        attempts: 1,
        clockSkewMs: 30_000,
        now: () => new Date('2026-08-25T16:02:00.000Z'),
      },
    ),
  ).rejects.toThrow('Invitation delivery');
});

test('mailbox waiter paginates past a 20-message page and applies backoff delays', async () => {
  const delays: number[] = [];
  const pages: (string | undefined)[] = [];
  const code = await waitForInvitationCode(
    {
      list: async (cursor) => {
        pages.push(cursor);
        if (!cursor) {
          return {
            messages: Array.from({ length: 20 }, (_, index) => ({
              id: `old-${index}`,
              createdAt: '2026-08-25T15:00:00.000Z',
              subject: 'Your Invitation Code',
            })),
            nextCursor: 'page-2',
          };
        }
        return {
          messages: [
            {
              id: 'msg-later',
              createdAt: '2026-08-25T16:01:30.000Z',
              subject: 'Your Invitation Code',
            },
          ],
        };
      },
      read: async (id) => ({
        id,
        text: 'Your Invitation Code is 777888. It expires in 10 minutes.',
        to: [recipient],
      }),
    },
    {
      expectedRecipient: recipient,
      since: new Date('2026-08-25T16:00:00.000Z'),
      sleep: async (ms) => {
        delays.push(ms);
      },
      attempts: 3,
      delayMs: 500,
      backoffFactor: 2,
      maxDelayMs: 8_000,
      now: () => new Date('2026-08-25T16:02:00.000Z'),
    },
  );

  expect(code).toBe('777888');
  expect(pages).toEqual([undefined, 'page-2']);
  expect(delays).toEqual([]);
});

test('mailbox waiter uses bounded exponential backoff while delivery is delayed', async () => {
  const delays: number[] = [];
  let lists = 0;
  const code = await waitForInvitationCode(
    {
      list: async () => {
        lists += 1;
        if (lists < 3) return { messages: [] };
        return {
          messages: [
            {
              id: 'msg-delayed',
              createdAt: '2026-08-25T16:01:00.000Z',
              subject: 'Your Invitation Code',
            },
          ],
        };
      },
      read: async (id) => ({
        id,
        text: codeText,
        to: [recipient],
      }),
    },
    {
      expectedRecipient: recipient,
      since: new Date('2026-08-25T16:00:00.000Z'),
      sleep: async (ms) => {
        delays.push(ms);
      },
      attempts: 3,
      delayMs: 500,
      backoffFactor: 2,
      maxDelayMs: 8_000,
      now: () => new Date('2026-08-25T16:02:00.000Z'),
    },
  );
  expect(code).toBe('654321');
  expect(delays).toEqual([500, 1_000]);
});
