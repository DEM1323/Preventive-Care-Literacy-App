import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import type { InvitationSecretProtector } from '../../../modules/identity-access/index.ts';

export type InvitationSecretKeys = {
  hmacKey: Uint8Array;
  encryptionKeys: Record<string, Uint8Array>;
  activeEncryptionKeyId: string;
  createCode?: () => string;
};

function context(input: {
  invitationId: string;
  purpose: string;
  generation: number;
}) {
  return `${input.purpose}:${input.invitationId}:${input.generation}`;
}

export function createInvitationSecretProtector(
  keys: InvitationSecretKeys,
): InvitationSecretProtector {
  const encryptionKey = keys.encryptionKeys[keys.activeEncryptionKeyId];
  if (
    !encryptionKey ||
    encryptionKey.byteLength !== 32 ||
    keys.hmacKey.byteLength < 32
  ) {
    throw new Error('Invitation secret keys must contain at least 256 bits');
  }
  return {
    createCode:
      keys.createCode ??
      (() => randomBytes(6).toString('base64url').toUpperCase()),
    protect(input) {
      const normalizedRecipient = input.recipient.trim().toLowerCase();
      const binding = context(input);
      const digest = (kind: string, value: string) =>
        createHmac('sha256', keys.hmacKey)
          .update(`${kind}:${binding}:${value}`)
          .digest('hex');
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
      cipher.setAAD(Buffer.from(binding));
      const encrypted = Buffer.concat([
        cipher.update(
          JSON.stringify({ recipient: normalizedRecipient, code: input.code }),
        ),
        cipher.final(),
      ]);
      return {
        recipientDigest: digest('recipient', normalizedRecipient),
        codeDigest: digest('code', input.code),
        keyId: keys.activeEncryptionKeyId,
        ciphertext: Buffer.concat([
          nonce,
          cipher.getAuthTag(),
          encrypted,
        ]).toString('base64url'),
      };
    },
  };
}

export function decryptInvitationDelivery(input: {
  keys: Pick<InvitationSecretKeys, 'encryptionKeys'>;
  keyId: string;
  ciphertext: string;
  invitationId: string;
  purpose: string;
  generation: number;
}): { recipient: string; code: string } {
  const key = input.keys.encryptionKeys[input.keyId];
  if (!key) throw new Error('Invitation delivery key is unavailable');
  const packed = Buffer.from(input.ciphertext, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(context(input)));
  decipher.setAuthTag(packed.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(packed.subarray(28)),
      decipher.final(),
    ]).toString('utf8'),
  ) as { recipient: string; code: string };
}
