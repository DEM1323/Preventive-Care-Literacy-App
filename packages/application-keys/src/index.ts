import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import type {
  ApplicationKeyManagement,
  KeyWrappingContext,
  SealedRecord,
} from '../../../modules/intake/index.ts';

export type EnvelopeKeyMaterial = {
  wrappingKeys: Record<string, Uint8Array>;
  activeWrappingKeyId: string;
};

function binding(context: KeyWrappingContext): Buffer {
  return Buffer.from(
    `${context.purpose}:${context.workspaceId}:${context.studentId}`,
  );
}

function encryptAesGcm(input: {
  key: Uint8Array;
  plaintext: Uint8Array;
  aad: Uint8Array;
}): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', input.key, nonce);
  cipher.setAAD(input.aad);
  const encrypted = Buffer.concat([
    cipher.update(input.plaintext),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString(
    'base64url',
  );
}

function decryptAesGcm(input: {
  key: Uint8Array;
  packed: string;
  aad: Uint8Array;
}): Buffer {
  const packed = Buffer.from(input.packed, 'base64url');
  if (packed.length < 28) throw new Error('Sealed record is malformed');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    input.key,
    packed.subarray(0, 12),
  );
  decipher.setAAD(input.aad);
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([
    decipher.update(packed.subarray(28)),
    decipher.final(),
  ]);
}

export function createEnvelopeKeyManagement(
  material: EnvelopeKeyMaterial,
): ApplicationKeyManagement {
  const activeKey = material.wrappingKeys[material.activeWrappingKeyId];
  if (!activeKey || activeKey.byteLength !== 32) {
    throw new Error('Application wrapping keys must contain at least 256 bits');
  }
  for (const key of Object.values(material.wrappingKeys)) {
    if (key.byteLength !== 32) {
      throw new Error(
        'Application wrapping keys must contain at least 256 bits',
      );
    }
  }

  return {
    name: 'application-layer-envelope/v1',
    seal(plaintext, context) {
      const dataKey = randomBytes(32);
      const aad = binding(context);
      return {
        wrappingKeyId: material.activeWrappingKeyId,
        wrappedDataKey: encryptAesGcm({
          key: activeKey,
          plaintext: dataKey,
          aad,
        }),
        ciphertext: encryptAesGcm({
          key: dataKey,
          plaintext,
          aad,
        }),
      };
    },
    open(sealed: SealedRecord, context: KeyWrappingContext) {
      const wrappingKey = material.wrappingKeys[sealed.wrappingKeyId];
      if (!wrappingKey)
        throw new Error('Application wrapping key is unavailable');
      const aad = binding(context);
      const dataKey = decryptAesGcm({
        key: wrappingKey,
        packed: sealed.wrappedDataKey,
        aad,
      });
      return decryptAesGcm({
        key: dataKey,
        packed: sealed.ciphertext,
        aad,
      });
    },
    bind(plaintext, context) {
      return `v1:${material.activeWrappingKeyId}:${createHmac(
        'sha256',
        Buffer.from(activeKey),
      )
        .update(
          `intake-idempotency:${context.workspaceId}:${context.studentId}:`,
        )
        .update(plaintext)
        .digest('hex')}`;
    },
  };
}
