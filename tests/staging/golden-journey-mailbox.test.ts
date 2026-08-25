import { expect, test } from 'bun:test';
import {
  extractInvitationCode,
  waitForInvitationCode,
} from '../../packages/golden-journey/src/index.ts';

test('mailbox parser extracts a six-digit Invitation Code from the fixed subject text', () => {
  expect(
    extractInvitationCode(
      'Your Invitation Code is 729104. It expires in 10 minutes.',
    ),
  ).toBe('729104');
});

test('mailbox parser rejects bodies that are not the invitation template', () => {
  expect(() => extractInvitationCode('Your sign-in code is 729104.')).toThrow(
    'Invitation Code',
  );
  expect(() =>
    extractInvitationCode(
      'Your Invitation Code is 72. It expires in 10 minutes.',
    ),
  ).toThrow('Invitation Code');
});

test('mailbox waiter polls until a matching sent message exists and never returns surrounding content', async () => {
  const requests: string[] = [];
  const code = await waitForInvitationCode(
    {
      list: async () => {
        requests.push('list');
        if (requests.length < 2) return [];
        return [
          {
            id: 'msg-1',
            createdAt: '2026-08-25T16:01:00.000Z',
            subject: 'Your Invitation Code',
          },
        ];
      },
      read: async (id) => {
        requests.push(`read:${id}`);
        return {
          id,
          text: 'Your Invitation Code is 654321. It expires in 10 minutes.',
          to: ['controlled@example.test'],
        };
      },
    },
    {
      since: new Date('2026-08-25T16:00:00.000Z'),
      sleep: async () => undefined,
      attempts: 3,
    },
  );

  expect(code).toBe('654321');
  expect(requests).toEqual(['list', 'list', 'read:msg-1']);
});

test('mailbox waiter fails closed without leaking addresses or codes', async () => {
  try {
    await waitForInvitationCode(
      {
        list: async () => [
          {
            id: 'msg-hidden',
            createdAt: '2026-08-25T15:00:00.000Z',
            subject: 'Your Invitation Code',
          },
        ],
        read: async () => ({
          id: 'msg-hidden',
          text: 'Your Invitation Code is 111111. It expires in 10 minutes.',
          to: ['controlled@example.test'],
        }),
      },
      {
        since: new Date('2026-08-25T16:00:00.000Z'),
        sleep: async () => undefined,
        attempts: 1,
      },
    );
  } catch (error) {
    const message = String(error);
    expect(message).toContain('Invitation delivery');
    expect(message).not.toContain('controlled@example.test');
    expect(message).not.toContain('111111');
    expect(message).not.toContain('msg-hidden');
    return;
  }
  throw new Error('expected mailbox waiter to fail closed');
});
