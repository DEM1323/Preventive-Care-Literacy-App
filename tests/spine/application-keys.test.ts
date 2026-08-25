import { expect, test } from 'bun:test';
import { createEnvelopeKeyManagement } from '../../packages/application-keys/src/index.ts';

const context = {
  purpose: 'intake-draft' as const,
  workspaceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5001',
  studentId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf5002',
};

test('application-layer envelope wrapping is selected and is not equivalent to at-rest encryption', () => {
  const keys = createEnvelopeKeyManagement({
    wrappingKeys: { alpha: Buffer.alloc(32, 11) },
    activeWrappingKeyId: 'alpha',
  });

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
