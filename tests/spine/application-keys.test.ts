import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createEnvelopeKeyManagement } from '../../packages/application-keys/src/index.ts';

const context = {
  purpose: 'intake-draft' as const,
  workspaceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5001',
  studentId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5002',
};

const bindContext = {
  workspaceId: context.workspaceId,
  studentId: context.studentId,
};

function envelopeMaterial(
  wrapping: { id: string; key: number },
  idempotency = 17,
) {
  return {
    wrappingKeys: { [wrapping.id]: Buffer.alloc(32, wrapping.key) },
    activeWrappingKeyId: wrapping.id,
    idempotencyKey: Buffer.alloc(32, idempotency),
  };
}

test('application-layer envelope wrapping is selected and is not equivalent to at-rest encryption', () => {
  const keys = createEnvelopeKeyManagement(
    envelopeMaterial({ id: 'alpha', key: 11 }),
  );

  expect(keys.name).toBe('application-layer-envelope/v1');
  expect(keys.name).not.toContain('vault');
  expect(keys.name).not.toContain('at-rest');

  const secret = 'synthetic-health-answer-never-store-plain';
  const sealed = keys.seal(Buffer.from(secret, 'utf8'), context);
  expect(sealed.wrappingKeyId).toBe('alpha');
  expect(sealed.wrappedDataKey).not.toContain(secret);
  expect(sealed.ciphertext).not.toContain(secret);
  expect(
    Buffer.from(sealed.wrappedDataKey, 'base64url').length,
  ).toBeGreaterThan(32);
  expect(keys.open(sealed, context).toString('utf8')).toBe(secret);

  expect(() =>
    keys.open(sealed, { ...context, purpose: 'intake-record-version' }),
  ).toThrow();
  expect(() =>
    keys.open(sealed, { ...context, studentId: crypto.randomUUID() }),
  ).toThrow();
});

test('idempotency bindings are keyed to the Student and are not unkeyed answer hashes', () => {
  const keys = createEnvelopeKeyManagement(
    envelopeMaterial({ id: 'alpha', key: 11 }),
  );
  const plaintext = Buffer.from('no', 'utf8');
  const binding = keys.bind(plaintext, bindContext);

  expect(binding).not.toBe(
    createHash('sha256').update(plaintext).digest('hex'),
  );
  expect(binding).not.toContain('no');
  expect(keys.bind(plaintext, bindContext)).toBe(binding);
  expect(
    keys.bind(plaintext, {
      workspaceId: context.workspaceId,
      studentId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5003',
    }),
  ).not.toBe(binding);
});

test('idempotency bindings survive wrapping-key rotation', () => {
  const plaintext = Buffer.from('no', 'utf8');
  const original = createEnvelopeKeyManagement(
    envelopeMaterial({ id: 'alpha', key: 11 }),
  );
  const rotated = createEnvelopeKeyManagement(
    envelopeMaterial({ id: 'beta', key: 19 }),
  );
  const binding = original.bind(plaintext, bindContext);

  expect(rotated.bind(plaintext, bindContext)).toBe(binding);
  expect(
    createEnvelopeKeyManagement(
      envelopeMaterial({ id: 'beta', key: 19 }, 21),
    ).bind(plaintext, bindContext),
  ).not.toBe(binding);
});

test('prior wrapping keys still open records after rotation and lost keys cannot recover them', () => {
  const secret = 'synthetic-health-answer-never-store-plain';
  const original = createEnvelopeKeyManagement(
    envelopeMaterial({ id: 'alpha', key: 11 }),
  );
  const sealed = original.seal(Buffer.from(secret, 'utf8'), context);
  const rotated = createEnvelopeKeyManagement({
    wrappingKeys: {
      alpha: Buffer.alloc(32, 11),
      beta: Buffer.alloc(32, 19),
    },
    activeWrappingKeyId: 'beta',
    idempotencyKey: Buffer.alloc(32, 17),
  });

  expect(rotated.open(sealed, context).toString('utf8')).toBe(secret);
  expect(rotated.seal(Buffer.from(secret, 'utf8'), context).wrappingKeyId).toBe(
    'beta',
  );
  expect(() =>
    createEnvelopeKeyManagement(envelopeMaterial({ id: 'beta', key: 19 })).open(
      sealed,
      context,
    ),
  ).toThrow();
});

test('tracked envelope threat model names the selected adapter and its limits', () => {
  const doc = readFileSync(
    new URL(
      '../../docs/security/application-layer-envelope.md',
      import.meta.url,
    ),
    'utf8',
  );
  expect(doc).toContain('application-layer-envelope/v1');
  expect(doc).toContain('APPLICATION_WRAPPING_KEY');
  expect(doc).toContain('APPLICATION_IDEMPOTENCY_KEY');
  expect(doc).toContain('Supabase Vault');
  expect(doc.toLowerCase()).toContain('rotation');
  expect(doc).toContain('unrecoverable');
  expect(doc).toContain('process secret');
  expect(doc).toContain('/api/v1/clinical/intake-records/current');
  expect(doc).toContain('/api/v1/student/intake');
  expect(doc).toContain('Student-private draft restore');
  expect(doc).toContain(
    'Ordinary clinical and administrative HTTP projections must not receive those answers',
  );
  expect(doc).not.toContain(
    'is the only HTTP seam that may return plaintext answers',
  );
  expect(doc).toContain(
    'separately authorized, freshness-gated, no-store clinical reveal',
  );
  expect(doc).toContain('staff_identities');
  expect(doc).toContain('staff_permission_grants');
  expect(doc).toContain('rechecked after decrypt');
  expect(doc).toContain('issue #32');
});
