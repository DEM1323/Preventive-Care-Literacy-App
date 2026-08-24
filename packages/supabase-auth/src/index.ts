import { createHmac } from 'node:crypto';
import {
  StaffCredentialsAlreadyExistError,
  type StaffAuthProvider,
} from '../../../modules/identity-access/index.ts';

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(secret: string): Buffer {
  const clean = secret.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of clean) {
    const index = base32Alphabet.indexOf(character);
    if (index === -1) throw new Error('Invalid base32 TOTP secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/** RFC 6238 TOTP used to drive the real Supabase MFA seam in controlled checks. */
export function totpCode(secret: string, at: Date = new Date()): string {
  const counter = BigInt(Math.floor(at.getTime() / 1000 / 30));
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, '0');
}

/**
 * Supabase Auth (GoTrue) adapter for staff credentials. The browser never
 * sees these endpoints: the server mediates password verification, TOTP
 * enrollment/challenge/verify, and reads the resulting assurance level from
 * the provider token. Supabase proves credentials only; the application owns
 * Staff Identity, permission grants, sessions, and freshness.
 */
export function createSupabaseStaffAuth(options: {
  supabaseUrl: string;
  secretKey: string;
  fetch?: typeof fetch;
}): StaffAuthProvider {
  const http = options.fetch ?? fetch;
  const baseUrl = `${options.supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  const adminHeaders = {
    apikey: options.secretKey,
    authorization: `Bearer ${options.secretKey}`,
    'content-type': 'application/json',
  };
  const userHeaders = (accessToken: string) => ({
    apikey: options.secretKey,
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
  });

  function assuranceLevel(accessToken: string): 'aal1' | 'aal2' {
    const [, payload] = accessToken.split('.');
    if (!payload) return 'aal1';
    try {
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as { aal?: string };
      return claims.aal === 'aal2' ? 'aal2' : 'aal1';
    } catch {
      return 'aal1';
    }
  }

  async function listTotpFactors(
    accessToken: string,
  ): Promise<{ id: string; status: string }[]> {
    const response = await http(`${baseUrl}/factors`, {
      headers: userHeaders(accessToken),
    });
    if (!response.ok) {
      throw new Error(`Supabase factor listing failed: ${response.status}`);
    }
    const body = (await response.json()) as {
      totp?: { id: string; status: string }[];
    };
    return body.totp ?? [];
  }

  async function enrollTotp(accessToken: string): Promise<{
    factorId: string;
    otpauthUri: string;
  }> {
    const response = await http(`${baseUrl}/factors`, {
      method: 'POST',
      headers: userHeaders(accessToken),
      body: JSON.stringify({ factor_type: 'totp' }),
    });
    if (response.ok) {
      const body = (await response.json()) as {
        id: string;
        totp?: { uri?: string };
      };
      if (!body.totp?.uri) {
        throw new Error('Supabase TOTP enrollment returned no URI');
      }
      return { factorId: body.id, otpauthUri: body.totp.uri };
    }
    throw new Error(`Supabase TOTP enrollment failed: ${response.status}`);
  }

  async function deleteFactor(
    accessToken: string,
    factorId: string,
  ): Promise<void> {
    const response = await http(`${baseUrl}/factors/${factorId}`, {
      method: 'DELETE',
      headers: userHeaders(accessToken),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Supabase factor cleanup failed: ${response.status}`);
    }
  }

  async function challengeTotp(
    accessToken: string,
    factorId: string,
  ): Promise<string> {
    const response = await http(`${baseUrl}/factors/${factorId}/challenge`, {
      method: 'POST',
      headers: userHeaders(accessToken),
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error(`Supabase TOTP challenge failed: ${response.status}`);
    }
    const body = (await response.json()) as { id: string };
    return body.id;
  }

  return {
    async createCredentials(input) {
      const response = await http(`${baseUrl}/admin/users`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          email_confirm: true,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error_code?: string;
        };
        if (
          body.error_code === 'user_already_exists' ||
          body.error_code === 'email_exists'
        ) {
          throw new StaffCredentialsAlreadyExistError();
        }
        throw new Error(
          `Supabase staff credential creation failed: ${response.status}`,
        );
      }
      const body = (await response.json()) as { id: string };
      return { supabaseUserId: body.id };
    },

    async deleteCredentials(supabaseUserId) {
      const response = await http(`${baseUrl}/admin/users/${supabaseUserId}`, {
        method: 'DELETE',
        headers: adminHeaders,
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(
          `Supabase staff credential cleanup failed: ${response.status}`,
        );
      }
    },

    async verifyPassword(input) {
      const response = await http(`${baseUrl}/token?grant_type=password`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          email: input.email,
          password: input.password,
        }),
      });
      if (!response.ok) return 'invalid';
      const body = (await response.json()) as {
        access_token: string;
        user: { id: string };
      };
      return {
        supabaseUserId: body.user.id,
        accessToken: body.access_token,
      };
    },

    async prepareTotpChallenge(accessToken) {
      const factors = await listTotpFactors(accessToken);
      const verified = factors.find((factor) => factor.status === 'verified');
      if (verified) {
        return {
          stage: 'totp',
          factorId: verified.id,
          challengeId: await challengeTotp(accessToken, verified.id),
        };
      }
      // A PostgreSQL advisory lock serializes this cleanup with every other
      // first-time enrollment for the same application-owned Staff Identity.
      for (const factor of factors.filter(
        (candidate) => candidate.status !== 'verified',
      )) {
        await deleteFactor(accessToken, factor.id);
      }
      const enrollment = await enrollTotp(accessToken);
      return {
        stage: 'enroll',
        factorId: enrollment.factorId,
        challengeId: await challengeTotp(accessToken, enrollment.factorId),
        otpauthUri: enrollment.otpauthUri,
      };
    },

    async verifyTotp(input) {
      const response = await http(
        `${baseUrl}/factors/${input.factorId}/verify`,
        {
          method: 'POST',
          headers: userHeaders(input.accessToken),
          body: JSON.stringify({
            challenge_id: input.challengeId,
            code: input.code,
          }),
        },
      );
      if (!response.ok) return 'invalid';
      const body = (await response.json()) as { access_token?: string };
      return {
        assurance: body.access_token
          ? assuranceLevel(body.access_token)
          : 'aal1',
      };
    },
  };
}
