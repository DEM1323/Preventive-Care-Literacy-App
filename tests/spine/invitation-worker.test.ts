import { expect, test } from 'bun:test';
import {
  PermanentInvitationDeliveryError,
  runInvitationDeliveryCycle,
} from '../../modules/invitation-delivery/index.ts';

test('worker relays IDs only and retries delivery with a stable provider idempotency key', async () => {
  const jobs: { messageId: string; outboxId: string; attempt: number }[] = [];
  const sent: { recipient: string; code: string; idempotencyKey: string }[] =
    [];
  let attempts = 0;
  let completed = false;
  const queue = {
    async send(payload: { outboxId: string }) {
      expect(Object.keys(payload)).toEqual(['outboxId']);
      jobs.push({ messageId: 'message-1', attempt: attempts + 1, ...payload });
    },
    async receive() {
      return jobs[0];
    },
    async complete() {
      jobs.shift();
    },
    async retry() {
      jobs.shift();
    },
  };
  const dependencies = {
    outbox: {
      async pending() {
        return [{ outboxId: 'outbox-1' }];
      },
    },
    queue,
    deliveries: {
      async claim() {
        return completed
          ? { outcome: 'suppressed' as const }
          : {
              outcome: 'deliver' as const,
              outboxId: 'outbox-1',
              invitationId: 'invitation-1',
              generation: 1,
              purpose: 'join_class' as const,
              keyId: 'key-1',
              ciphertext: 'protected',
              providerIdempotencyKey: 'invitation-1:1',
            };
      },
      async complete() {
        completed = true;
      },
      async suppress() {},
    },
    decrypt: () => ({ recipient: 'student@example.test', code: '729104' }),
    mail: {
      async sendInvitation(message: {
        recipient: string;
        code: string;
        idempotencyKey: string;
        subject: string;
        text: string;
      }) {
        attempts += 1;
        sent.push(message);
        if (attempts === 1) throw new Error('provider unavailable');
        return { providerMessageId: 'resend-message-1' };
      },
    },
    clock: { now: () => new Date('2026-08-24T12:00:00.000Z') },
  };

  await expect(runInvitationDeliveryCycle(dependencies)).rejects.toThrow(
    'Invitation delivery failed',
  );
  await runInvitationDeliveryCycle(dependencies);
  expect(sent).toHaveLength(2);
  expect(sent[0]?.idempotencyKey).toBe('invitation-1:1');
  expect(sent[1]?.idempotencyKey).toBe('invitation-1:1');
  expect(sent[1]?.subject).toBe('Your Invitation Code');
  expect(sent[1]?.text).toBe(
    'Your Invitation Code is 729104. It expires in 10 minutes.',
  );
  expect(JSON.stringify(jobs)).not.toContain('example.test');
  expect(JSON.stringify(jobs)).not.toContain('729104');
});

test('worker acknowledges stale or otherwise non-current delivery without decrypting or mailing', async () => {
  let acknowledged = false;
  let decrypted = false;
  await runInvitationDeliveryCycle({
    outbox: { pending: async () => [] },
    queue: {
      send: async () => {},
      receive: async () => ({
        messageId: 'message-2',
        outboxId: 'outbox-2',
        attempt: 1,
      }),
      complete: async () => {
        acknowledged = true;
      },
      retry: async () => {},
    },
    deliveries: {
      claim: async () => ({ outcome: 'suppressed' }),
      complete: async () => {},
      suppress: async () => {},
    },
    decrypt: () => {
      decrypted = true;
      throw new Error('must not decrypt');
    },
    mail: { sendInvitation: async () => ({ providerMessageId: 'impossible' }) },
    clock: { now: () => new Date() },
  });
  expect(acknowledged).toBe(true);
  expect(decrypted).toBe(false);
});

test('worker suppresses a permanently rejected delivery instead of poisoning the queue', async () => {
  let suppressed = false;
  let acknowledged = false;
  let retried = false;
  await runInvitationDeliveryCycle({
    outbox: { pending: async () => [] },
    queue: {
      send: async () => {},
      receive: async () => ({
        messageId: 'message-3',
        outboxId: 'outbox-3',
        attempt: 1,
      }),
      complete: async () => {
        acknowledged = true;
      },
      retry: async () => {
        retried = true;
      },
    },
    deliveries: {
      claim: async () => ({
        outcome: 'deliver',
        outboxId: 'outbox-3',
        invitationId: 'invitation-3',
        generation: 1,
        purpose: 'join_class',
        keyId: 'key-1',
        ciphertext: 'protected',
        providerIdempotencyKey: 'invitation-3:1',
      }),
      complete: async () => {},
      suppress: async () => {
        suppressed = true;
      },
    },
    decrypt: () => ({ recipient: 'outside@example.test', code: '729104' }),
    mail: {
      sendInvitation: async () => {
        throw new PermanentInvitationDeliveryError();
      },
    },
    clock: { now: () => new Date() },
  });
  expect(suppressed).toBe(true);
  expect(acknowledged).toBe(true);
  expect(retried).toBe(false);
});
