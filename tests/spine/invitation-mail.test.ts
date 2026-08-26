import { expect, test } from 'bun:test';
import { PermanentInvitationDeliveryError } from '../../modules/invitation-delivery/index.ts';
import { createResendInvitationMail } from '../../packages/invitation-mail/src/index.ts';

const sender = 'Invitation <noreply@example.test>';
const recipient = 'student.one@school.example';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('controlled mailbox mismatches fail closed when the staging safety control is configured', async () => {
  const mail = createResendInvitationMail({
    apiKey: 're-test',
    sender,
    controlledRecipient: 'controlled@example.test',
    fetch: async () => {
      throw new Error('must not contact the provider');
    },
  });

  await expect(
    mail.sendInvitation({
      recipient,
      code: '729104',
      idempotencyKey: 'invitation-1:1',
      subject: 'Your Invitation Code',
      text: 'Your Invitation Code is 729104. It expires in 10 minutes.',
    }),
  ).rejects.toBeInstanceOf(PermanentInvitationDeliveryError);
});

test('ordinary delivery sends a neutral Invitation Code to any validated recipient when the control is omitted', async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  const mail = createResendInvitationMail({
    apiKey: 're-test',
    sender,
    fetch: async (url, init) => {
      sent.push({ url: String(url), init: init ?? {} });
      return jsonResponse(200, { id: 'resend-message-1' });
    },
  });

  const result = await mail.sendInvitation({
    recipient,
    code: '729104',
    idempotencyKey: 'invitation-1:1',
    subject: 'Your Invitation Code',
    text: 'Your Invitation Code is 729104. It expires in 10 minutes.',
  });

  expect(result).toEqual({ providerMessageId: 'resend-message-1' });
  expect(sent).toHaveLength(1);
  expect(sent[0]?.url).toBe('https://api.resend.com/emails');
  expect(sent[0]?.init.headers).toMatchObject({
    authorization: 'Bearer re-test',
    'content-type': 'application/json',
    'idempotency-key': 'invitation-1:1',
  });
  expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
    from: sender,
    to: [recipient],
    subject: 'Your Invitation Code',
    text: 'Your Invitation Code is 729104. It expires in 10 minutes.',
  });
});
