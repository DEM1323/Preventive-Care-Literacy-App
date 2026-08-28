import {
  serviceCaps,
  taskRetryDelaySeconds,
} from '../operational-readiness/index.ts';

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
      text: `Your Invitation Code is ${secret.code}. It expires in 10 minutes.`,
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
    if (message.attempt >= serviceCaps.taskMaxAttempts) {
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
      taskRetryDelaySeconds(message.attempt),
    );
    throw new Error('Invitation delivery failed');
  }
}

export type SignInCodeDeliveryDependencies = {
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
          challengeId: string;
          generation: number;
          purpose: 'sign_in';
          keyId: string;
          ciphertext: string;
          providerIdempotencyKey: string;
        }
    >;
    complete(input: {
      outboxId: string;
      challengeId: string;
      generation: number;
      providerMessageId: string;
      deliveredAt: Date;
    }): Promise<void>;
    suppress(input: {
      outboxId: string;
      challengeId: string;
      generation: number;
    }): Promise<void>;
  };
  decrypt(input: {
    challengeId: string;
    generation: number;
    purpose: 'sign_in';
    keyId: string;
    ciphertext: string;
  }): { recipient: string; code: string };
  mail: InvitationDeliveryDependencies['mail'];
  clock: { now(): Date };
};

export async function runSignInCodeDeliveryCycle(
  dependencies: SignInCodeDeliveryDependencies,
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
      subject: 'Your Sign-In Code',
      text: `Your Sign-In Code is ${secret.code}. It expires in 10 minutes.`,
    });
    await dependencies.deliveries.complete({
      outboxId: delivery.outboxId,
      challengeId: delivery.challengeId,
      generation: delivery.generation,
      providerMessageId: sent.providerMessageId,
      deliveredAt: dependencies.clock.now(),
    });
    await dependencies.queue.complete(message.messageId);
  } catch (error) {
    if (error instanceof PermanentInvitationDeliveryError) {
      await dependencies.deliveries.suppress({
        outboxId: delivery.outboxId,
        challengeId: delivery.challengeId,
        generation: delivery.generation,
      });
      await dependencies.queue.complete(message.messageId);
      return;
    }
    if (message.attempt >= serviceCaps.taskMaxAttempts) {
      await dependencies.deliveries.suppress({
        outboxId: delivery.outboxId,
        challengeId: delivery.challengeId,
        generation: delivery.generation,
      });
      await dependencies.queue.complete(message.messageId);
      return;
    }
    await dependencies.queue.retry(
      message.messageId,
      taskRetryDelaySeconds(message.attempt),
    );
    throw new Error('Sign-In Code delivery failed');
  }
}

export type RecordProductionDeliveryDependencies = {
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
          productionId: string;
          keyId: string;
          ciphertext: string;
          providerIdempotencyKey: string;
        }
    >;
    complete(input: {
      outboxId: string;
      productionId: string;
      providerMessageId: string;
      deliveredAt: Date;
    }): Promise<void>;
    suppress(input: { outboxId: string; productionId: string }): Promise<void>;
  };
  decrypt(input: { productionId: string; keyId: string; ciphertext: string }): {
    recipient: string;
    capability: string;
  };
  mail: InvitationDeliveryDependencies['mail'];
  clock: { now(): Date };
};

export async function runRecordProductionDeliveryCycle(
  dependencies: RecordProductionDeliveryDependencies,
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
      code: secret.capability,
      idempotencyKey: delivery.providerIdempotencyKey,
      subject: 'Your Record Production retrieval capability',
      text: `Your Record Production retrieval capability is ${secret.capability}. It expires in 10 minutes and can be used once.`,
    });
    await dependencies.deliveries.complete({
      outboxId: delivery.outboxId,
      productionId: delivery.productionId,
      providerMessageId: sent.providerMessageId,
      deliveredAt: dependencies.clock.now(),
    });
    await dependencies.queue.complete(message.messageId);
  } catch (error) {
    if (error instanceof PermanentInvitationDeliveryError) {
      await dependencies.deliveries.suppress({
        outboxId: delivery.outboxId,
        productionId: delivery.productionId,
      });
      await dependencies.queue.complete(message.messageId);
      return;
    }
    if (message.attempt >= serviceCaps.taskMaxAttempts) {
      await dependencies.deliveries.suppress({
        outboxId: delivery.outboxId,
        productionId: delivery.productionId,
      });
      await dependencies.queue.complete(message.messageId);
      return;
    }
    await dependencies.queue.retry(
      message.messageId,
      taskRetryDelaySeconds(message.attempt),
    );
    throw new Error('Record Production delivery failed');
  }
}
