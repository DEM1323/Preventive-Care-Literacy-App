import { expect, test } from 'bun:test';
import {
  captureInvitationMailboxBaseline,
  extractInvitationCode,
  extractSignInCode,
  waitForInvitationCode,
  waitForSignInCode,
} from '../../packages/golden-journey/src/index.ts';

const recipient = 'controlled@example.test';
const codeText = 'Your Invitation Code is 654321. It expires in 10 minutes.';

test('mailbox parser extracts a six-digit Invitation Code from the fixed subject text', () => {
  expect(extractInvitationCode(codeText)).toBe('654321');
});

test('mailbox parser extracts a six-digit Sign-In Code from the distinct template', () => {
  expect(
    extractSignInCode('Your Sign-In Code is 555111. It expires in 10 minutes.'),
  ).toBe('555111');
});

test('mailbox parser keeps Invitation and Sign-In Code templates distinct', () => {
  expect(() =>
    extractSignInCode(
      'Your Invitation Code is 729104. It expires in 10 minutes.',
    ),
  ).toThrow('Sign-In Code');
  expect(() => extractInvitationCode('Your Sign-In Code is 555111.')).toThrow(
    'Invitation Code',
  );
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

  expect(code.code).toBe('654321');
  expect(code.messageId).toBe('msg-1');
  expect(requests).toEqual(['list', 'list', 'read:msg-1']);
});

test('mailbox waiter observes a Sign-In Code by the distinct subject and template', async () => {
  const code = await waitForSignInCode(
    {
      list: async () => ({
        messages: [
          {
            id: 'invite-1',
            createdAt: '2026-08-26T18:01:00.000Z',
            subject: 'Your Invitation Code',
          },
          {
            id: 'signin-1',
            createdAt: '2026-08-26T18:01:30.000Z',
            subject: 'Your Sign-In Code',
          },
        ],
      }),
      read: async (id) => ({
        id,
        text:
          id === 'signin-1'
            ? 'Your Sign-In Code is 555111. It expires in 10 minutes.'
            : codeText,
        to: [recipient],
      }),
    },
    {
      expectedRecipient: recipient,
      since: new Date('2026-08-26T18:00:00.000Z'),
      sleep: async () => undefined,
      attempts: 1,
      now: () => new Date('2026-08-26T18:02:00.000Z'),
    },
  );
  expect(code).toEqual({
    code: '555111',
    messageId: 'signin-1',
    createdAt: '2026-08-26T18:01:30.000Z',
  });
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

  expect(code.code).toBe('777888');
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
  expect(code.code).toBe('654321');
  expect(delays).toEqual([500, 1_000]);
});

test('second mailbox wait excludes the first seen message id even for the same recipient and subject', async () => {
  const first = {
    id: 'msg-first',
    createdAt: '2026-08-25T16:01:00.000Z',
    subject: 'Your Invitation Code',
  };
  const second = {
    id: 'msg-second',
    createdAt: '2026-08-25T16:04:00.000Z',
    subject: 'Your Invitation Code',
  };
  const observed = await waitForInvitationCode(
    {
      list: async () => ({ messages: [first, second] }),
      read: async (id) => ({
        id,
        text:
          id === 'msg-first'
            ? 'Your Invitation Code is 111111. It expires in 10 minutes.'
            : 'Your Invitation Code is 222222. It expires in 10 minutes.',
        to: [recipient],
      }),
    },
    {
      expectedRecipient: recipient,
      since: new Date('2026-08-25T16:03:00.000Z'),
      excludeMessageIds: ['msg-first'],
      sleep: async () => undefined,
      attempts: 1,
      now: () => new Date('2026-08-25T16:05:00.000Z'),
    },
  );
  expect(observed.code).toBe('222222');
  expect(observed.messageId).toBe('msg-second');
});

test('second mailbox wait does not reuse the first code when only the first message exists', async () => {
  await expect(
    waitForInvitationCode(
      {
        list: async () => ({
          messages: [
            {
              id: 'msg-first',
              createdAt: '2026-08-25T16:04:00.000Z',
              subject: 'Your Invitation Code',
            },
          ],
        }),
        read: async (id) => ({
          id,
          text: 'Your Invitation Code is 111111. It expires in 10 minutes.',
          to: [recipient],
        }),
      },
      {
        expectedRecipient: recipient,
        since: new Date('2026-08-25T16:03:00.000Z'),
        excludeMessageIds: ['msg-first'],
        sleep: async () => undefined,
        attempts: 1,
        now: () => new Date('2026-08-25T16:05:00.000Z'),
      },
    ),
  ).rejects.toThrow('Invitation delivery');
});

test('mailbox baseline captures recipient and subject IDs without extracting codes', async () => {
  const readBodies: string[] = [];
  const ids = await captureInvitationMailboxBaseline(
    {
      list: async () => ({
        messages: [
          {
            id: 'msg-previous',
            createdAt: '2026-08-25T16:00:20.000Z',
            subject: 'Your Invitation Code',
          },
          {
            id: 'msg-other',
            createdAt: '2026-08-25T16:00:21.000Z',
            subject: 'Your Invitation Code',
          },
        ],
      }),
      read: async (id) => {
        readBodies.push(id);
        return {
          id,
          text:
            id === 'msg-previous'
              ? 'Your Invitation Code is 111111. It expires in 10 minutes.'
              : 'Your Invitation Code is 999999. It expires in 10 minutes.',
          to: id === 'msg-previous' ? [recipient] : ['unrelated@example.test'],
        };
      },
    },
    { expectedRecipient: recipient },
  );
  expect(ids).toEqual(['msg-previous']);
  expect(readBodies).toEqual(['msg-previous', 'msg-other']);
});

test('mailbox waiter excludes a previous-run baseline message inside the 30s skew for the same recipient and subject', async () => {
  const baseline = await captureInvitationMailboxBaseline(
    {
      list: async () => ({
        messages: [
          {
            id: 'msg-previous-run',
            createdAt: '2026-08-25T16:00:20.000Z',
            subject: 'Your Invitation Code',
          },
        ],
      }),
      read: async (id) => ({
        id,
        text: 'Your Invitation Code is 111111. It expires in 10 minutes.',
        to: [recipient],
      }),
    },
    { expectedRecipient: recipient },
  );
  expect(baseline).toEqual(['msg-previous-run']);

  const observed = await waitForInvitationCode(
    {
      list: async () => ({
        messages: [
          {
            id: 'msg-previous-run',
            createdAt: '2026-08-25T16:00:20.000Z',
            subject: 'Your Invitation Code',
          },
          {
            id: 'msg-current',
            createdAt: '2026-08-25T16:00:40.000Z',
            subject: 'Your Invitation Code',
          },
        ],
      }),
      read: async (id) => ({
        id,
        text:
          id === 'msg-previous-run'
            ? 'Your Invitation Code is 111111. It expires in 10 minutes.'
            : 'Your Invitation Code is 654321. It expires in 10 minutes.',
        to: [recipient],
      }),
    },
    {
      expectedRecipient: recipient,
      since: new Date('2026-08-25T16:00:30.000Z'),
      excludeMessageIds: baseline,
      clockSkewMs: 30_000,
      sleep: async () => undefined,
      attempts: 1,
      now: () => new Date('2026-08-25T16:00:45.000Z'),
    },
  );
  expect(observed.messageId).toBe('msg-current');
  expect(observed.code).toBe('654321');
});

test('mailbox waiter does not accept a previous-run baseline message when it is the only candidate inside 30s', async () => {
  await expect(
    waitForInvitationCode(
      {
        list: async () => ({
          messages: [
            {
              id: 'msg-previous-run',
              createdAt: '2026-08-25T16:00:20.000Z',
              subject: 'Your Invitation Code',
            },
          ],
        }),
        read: async (id) => ({
          id,
          text: 'Your Invitation Code is 111111. It expires in 10 minutes.',
          to: [recipient],
        }),
      },
      {
        expectedRecipient: recipient,
        since: new Date('2026-08-25T16:00:30.000Z'),
        excludeMessageIds: ['msg-previous-run'],
        clockSkewMs: 30_000,
        sleep: async () => undefined,
        attempts: 1,
        now: () => new Date('2026-08-25T16:00:45.000Z'),
      },
    ),
  ).rejects.toThrow('Invitation delivery');
});
