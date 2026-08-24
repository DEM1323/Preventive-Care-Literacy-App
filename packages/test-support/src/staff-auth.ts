import { randomUUID } from 'node:crypto';
import {
  StaffCredentialsAlreadyExistError,
  type StaffAuthProvider,
} from '../../../modules/identity-access/index.ts';
import { createTotpSecret, totpCode } from './totp.ts';

/**
 * A controlled in-memory stand-in for the Supabase Auth staff credential
 * seam. Password verification, TOTP enrollment/challenge/verify, and aal2
 * assurance behave like the real provider; network and admin APIs are faked.
 */
export function createFakeStaffAuth(): {
  provider: StaffAuthProvider;
  hasCredentials(email: string): boolean;
  totpSecretFor(email: string): string;
} {
  const users = new Map<string, { supabaseUserId: string; password: string }>();
  const factors = new Map<
    string,
    { factorId: string; secret: string; verified: boolean }
  >();
  const challenges = new Map<string, { factorId: string }>();

  function emailForAccessToken(accessToken: string): string | undefined {
    for (const [email, user] of users) {
      if (`fake-access-${user.supabaseUserId}` === accessToken) return email;
    }
    return undefined;
  }

  return {
    provider: {
      async createCredentials(input) {
        if (users.has(input.email)) {
          throw new StaffCredentialsAlreadyExistError();
        }
        const supabaseUserId = randomUUID();
        users.set(input.email, {
          supabaseUserId,
          password: input.password,
        });
        return { supabaseUserId };
      },

      async deleteCredentials(supabaseUserId) {
        for (const [email, user] of users) {
          if (user.supabaseUserId === supabaseUserId) {
            users.delete(email);
            factors.delete(email);
            return;
          }
        }
      },

      async verifyPassword(input) {
        const user = users.get(input.email);
        if (!user || user.password !== input.password) return 'invalid';
        return {
          supabaseUserId: user.supabaseUserId,
          accessToken: `fake-access-${user.supabaseUserId}`,
        };
      },

      async prepareTotpChallenge(accessToken) {
        const email = emailForAccessToken(accessToken);
        if (!email) throw new Error('Unknown fake access token');
        const challengeId = randomUUID();
        const existing = factors.get(email);
        if (existing?.verified) {
          challenges.set(challengeId, { factorId: existing.factorId });
          return {
            stage: 'totp',
            factorId: existing.factorId,
            challengeId,
          };
        }
        const factor = existing ?? {
          factorId: randomUUID(),
          secret: createTotpSecret(),
          verified: false,
        };
        factors.set(email, factor);
        challenges.set(challengeId, { factorId: factor.factorId });
        return {
          stage: 'enroll',
          factorId: factor.factorId,
          challengeId,
          otpauthUri: `otpauth://totp/PreventiveCare:${encodeURIComponent(email)}?secret=${factor.secret}&issuer=PreventiveCare`,
        };
      },

      async verifyTotp(input) {
        const email = emailForAccessToken(input.accessToken);
        const challenge = challenges.get(input.challengeId);
        const factor = email ? factors.get(email) : undefined;
        if (
          !email ||
          !challenge ||
          !factor ||
          challenge.factorId !== input.factorId ||
          factor.factorId !== input.factorId ||
          totpCode(factor.secret) !== input.code
        ) {
          return 'invalid';
        }
        factor.verified = true;
        return { assurance: 'aal2' };
      },
    },

    hasCredentials(email) {
      return users.has(email);
    },

    totpSecretFor(email) {
      const factor = factors.get(email);
      if (!factor) throw new Error(`No TOTP factor enrolled for ${email}`);
      return factor.secret;
    },
  };
}
