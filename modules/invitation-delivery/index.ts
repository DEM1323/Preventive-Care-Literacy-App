export type InvitationQueue = {
  send(payload: { outboxId: string }): Promise<void>;
  receive(): Promise<
    { messageId: string; outboxId: string; attempt: number } | undefined
  >;
  complete(messageId: string): Promise<void>;
  retry(messageId: string, delaySeconds: number): Promise<void>;
};

export class PermanentInvitationDeliveryError extends Error {
  constructor() {
    super('Invitation delivery was rejected');
    this.name = 'PermanentInvitationDeliveryError';
  }
}

export type InvitationDeliveryDependencies = {
  outbox: {
    pending(): Promise<readonly { outboxId: string }[]>;
  };
  queue: InvitationQueue;
  deliveries: {
    claim(
      outboxId: string,
      now: Date,
    ): Promise<
      | { outcome: 'suppressed' }
      | {
          outcome: 'deliver';
          outboxId: string;
          invitationId: string;
          generation: number;
          purpose: 'join_class';
          keyId: string;
          ciphertext: string;
          providerIdempotencyKey: string;
        }
    >;
    complete(input: {
      outboxId: string;
      invitationId: string;
      generation: number;
      providerMessageId: string;
      deliveredAt: Date;
    }): Promise<void>;
    suppress(input: {
      outboxId: string;
      invitationId: string;
      generation: number;
    }): Promise<void>;
  };
  decrypt(input: {
    invitationId: string;
    generation: number;
    purpose: 'join_class';
    keyId: string;
    ciphertext: string;
  }): { recipient: string; code: string };
  mail: {
    sendInvitation(input: {
      recipient: string;
      code: string;
      idempotencyKey: string;
      subject: string;
      text: string;
    }): Promise<{ providerMessageId: string }>;
  };
  clock: { now(): Date };
};

export async function runInvitationDeliveryCycle(
  dependencies: InvitationDeliveryDependencies,
): Promise<void> {
  for (const event of await dependencies.outbox.pending()) {
    await dependencies.queue.send({ outboxId: event.outboxId });
  }

  const message = await dependencies.queue.receive();
  if (!message) return;
  const delivery = await dependencies.deliveries.claim(
    message.outboxId,
    dependencies.clock.now(),
  );
  if (delivery.outcome === 'suppressed') {
    await dependencies.queue.complete(message.messageId);
    return;
  }

  try {
    const secret = dependencies.decrypt(delivery);
    const sent = await dependencies.mail.sendInvitation({
      recipient: secret.recipient,
      code: secret.code,
      idempotencyKey: delivery.providerIdempotencyKey,
      subject: 'Your Invitation Code',
      text: `Your Invitation Code is ${secret.code}. It expires in 24 hours.`,
    });
    await dependencies.deliveries.complete({
      outboxId: delivery.outboxId,
      invitationId: delivery.invitationId,
      generation: delivery.generation,
      providerMessageId: sent.providerMessageId,
      deliveredAt: dependencies.clock.now(),
    });
    await dependencies.queue.complete(message.messageId);
  } catch (error) {
    if (error instanceof PermanentInvitationDeliveryError) {
      await dependencies.deliveries.suppress({
        outboxId: delivery.outboxId,
        invitationId: delivery.invitationId,
        generation: delivery.generation,
      });
      await dependencies.queue.complete(message.messageId);
      return;
    }
    if (message.attempt >= 5) {
      await dependencies.deliveries.suppress({
        outboxId: delivery.outboxId,
        invitationId: delivery.invitationId,
        generation: delivery.generation,
      });
      await dependencies.queue.complete(message.messageId);
      return;
    }
    await dependencies.queue.retry(
      message.messageId,
      Math.min(30 * 2 ** (message.attempt - 1), 15 * 60),
    );
    throw new Error('Invitation delivery failed');
  }
}
