import type { InvitationDeliveryDependencies } from '../../../modules/invitation-delivery/index.ts';
import { PermanentInvitationDeliveryError } from '../../../modules/invitation-delivery/index.ts';

export function createResendInvitationMail(options: {
  apiKey: string;
  sender: string;
  controlledRecipient?: string;
  fetch?: typeof fetch;
}): InvitationDeliveryDependencies['mail'] {
  const request = options.fetch ?? fetch;
  const controlledRecipient = options.controlledRecipient?.trim();
  return {
    async sendInvitation(input) {
      if (
        controlledRecipient &&
        input.recipient.trim().toLowerCase() !==
          controlledRecipient.toLowerCase()
      ) {
        throw new PermanentInvitationDeliveryError();
      }
      const response = await request('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': input.idempotencyKey,
        },
        body: JSON.stringify({
          from: options.sender,
          to: [input.recipient],
          subject: input.subject,
          text: input.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        if (
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 429].includes(response.status)
        ) {
          throw new PermanentInvitationDeliveryError();
        }
        throw new Error('Invitation mail provider failed');
      }
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== 'object' ||
        !('id' in body) ||
        typeof body.id !== 'string'
      ) {
        throw new PermanentInvitationDeliveryError();
      }
      return { providerMessageId: body.id };
    },
  };
}
