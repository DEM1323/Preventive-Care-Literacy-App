import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
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

function signInContext(input: { challengeId: string; generation: number }) {
  return `sign_in:${input.challengeId}:${input.generation}`;
}

function recipientContext(input: { workspaceId: string; studentId: string }) {
  return `verified-email:${input.workspaceId}:${input.studentId}`;
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
      (() => randomInt(0, 1_000_000).toString().padStart(6, '0')),
    digestRecipient(recipient) {
      return createHmac('sha256', keys.hmacKey)
        .update(`recipient:${recipient.trim().toLowerCase()}`)
        .digest('hex');
    },
    digestInvitationLookup(input) {
      return createHmac('sha256', keys.hmacKey)
        .update(
          `invitation-lookup:${input.recipient.trim().toLowerCase()}:${input.code}`,
        )
        .digest('hex');
    },
    digestSignInLookup(input) {
      return createHmac('sha256', keys.hmacKey)
        .update(
          `sign-in-lookup:${input.recipient.trim().toLowerCase()}:${input.code}`,
        )
        .digest('hex');
    },
    digestCode(input) {
      return createHmac('sha256', keys.hmacKey)
        .update(`code:${context(input)}:${input.code}`)
        .digest('hex');
    },
    digestSignInCode(input) {
      return createHmac('sha256', keys.hmacKey)
        .update(`code:${signInContext(input)}:${input.code}`)
        .digest('hex');
    },
    codeMatches(input) {
      const actual = Buffer.from(
        createHmac('sha256', keys.hmacKey)
          .update(`code:${context(input)}:${input.code}`)
          .digest('hex'),
      );
      const expected = Buffer.from(input.expectedDigest);
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    },
    signInCodeMatches(input) {
      const actual = Buffer.from(
        createHmac('sha256', keys.hmacKey)
          .update(`code:${signInContext(input)}:${input.code}`)
          .digest('hex'),
      );
      const expected = Buffer.from(input.expectedDigest);
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    },
    protectRecipient(input) {
      const binding = recipientContext(input);
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
      cipher.setAAD(Buffer.from(binding));
      const encrypted = Buffer.concat([
        cipher.update(input.recipient.trim().toLowerCase()),
        cipher.final(),
      ]);
      return {
        keyId: keys.activeEncryptionKeyId,
        ciphertext: Buffer.concat([
          nonce,
          cipher.getAuthTag(),
          encrypted,
        ]).toString('base64url'),
      };
    },
    protect(input) {
      const normalizedRecipient = input.recipient.trim().toLowerCase();
      const binding = context(input);
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
        recipientDigest: createHmac('sha256', keys.hmacKey)
          .update(`recipient:${normalizedRecipient}`)
          .digest('hex'),
        codeDigest: createHmac('sha256', keys.hmacKey)
          .update(`code:${binding}:${input.code}`)
          .digest('hex'),
        lookupDigest: createHmac('sha256', keys.hmacKey)
          .update(`invitation-lookup:${normalizedRecipient}:${input.code}`)
          .digest('hex'),
        keyId: keys.activeEncryptionKeyId,
        ciphertext: Buffer.concat([
          nonce,
          cipher.getAuthTag(),
          encrypted,
        ]).toString('base64url'),
      };
    },
    protectSignIn(input) {
      const normalizedRecipient = input.recipient.trim().toLowerCase();
      const binding = signInContext(input);
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
        recipientDigest: createHmac('sha256', keys.hmacKey)
          .update(`recipient:${normalizedRecipient}`)
          .digest('hex'),
        codeDigest: createHmac('sha256', keys.hmacKey)
          .update(`code:${binding}:${input.code}`)
          .digest('hex'),
        lookupDigest: createHmac('sha256', keys.hmacKey)
          .update(`sign-in-lookup:${normalizedRecipient}:${input.code}`)
          .digest('hex'),
        keyId: keys.activeEncryptionKeyId,
        ciphertext: Buffer.concat([
          nonce,
          cipher.getAuthTag(),
          encrypted,
        ]).toString('base64url'),
      };
    },
    revealInvitationRecipient(input) {
      return decryptInvitationDelivery({
        keys,
        keyId: input.keyId,
        ciphertext: input.ciphertext,
        invitationId: input.invitationId,
        purpose: input.purpose,
        generation: input.generation,
      }).recipient;
    },
    revealVerifiedEmailRecipient(input) {
      const key = keys.encryptionKeys[input.keyId];
      if (!key) throw new Error('Verified email key is unavailable');
      const packed = Buffer.from(input.ciphertext, 'base64url');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        packed.subarray(0, 12),
      );
      decipher.setAAD(
        Buffer.from(
          recipientContext({
            workspaceId: input.workspaceId,
            studentId: input.studentId,
          }),
        ),
      );
      decipher.setAuthTag(packed.subarray(12, 28));
      return Buffer.concat([
        decipher.update(packed.subarray(28)),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

export function decryptSignInDelivery(input: {
  keys: Pick<InvitationSecretKeys, 'encryptionKeys'>;
  keyId: string;
  ciphertext: string;
  challengeId: string;
  generation: number;
}): { recipient: string; code: string } {
  return decryptInvitationDelivery({
    keys: input.keys,
    keyId: input.keyId,
    ciphertext: input.ciphertext,
    invitationId: input.challengeId,
    purpose: 'sign_in',
    generation: input.generation,
  });
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
