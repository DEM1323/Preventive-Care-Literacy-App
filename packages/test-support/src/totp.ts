import { randomBytes } from 'node:crypto';
export { totpCode } from '../../supabase-auth/src/index.ts';

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function createTotpSecret(): string {
  const bytes = randomBytes(20);
  let secret = '';
  for (const byte of bytes) {
    secret += base32Alphabet[byte % 32];
  }
  return secret;
}
