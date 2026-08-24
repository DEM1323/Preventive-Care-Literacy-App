import { appendFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  createSupabaseStaffAuth,
  totpCode,
} from '../packages/supabase-auth/src/index.ts';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const outputPath = requiredEnvironment('GITHUB_OUTPUT');
const email = `auth-smoke-${randomUUID()}@example.invalid`;
const password = `${randomBytes(32).toString('base64url')}A1!`;
const auth = createSupabaseStaffAuth({
  supabaseUrl: requiredEnvironment('SUPABASE_URL'),
  secretKey: requiredEnvironment('SUPABASE_SECRET_KEY'),
});

const deleteUserId = process.env.DELETE_SMOKE_USER_ID;
if (deleteUserId) {
  await auth.deleteCredentials(deleteUserId);
  console.log('Synthetic Supabase Auth identity was removed');
  process.exit(0);
}

const previousUserId = process.env.PREVIOUS_SMOKE_USER_ID;
if (previousUserId) await auth.deleteCredentials(previousUserId);

let supabaseUserId: string | undefined;
try {
  const created = await auth.createCredentials({ email, password });
  supabaseUserId = created.supabaseUserId;
  appendFileSync(outputPath, `user_id=${supabaseUserId}\n`);
  const verified = await auth.verifyPassword({ email, password });
  if (verified === 'invalid' || verified.supabaseUserId !== supabaseUserId) {
    throw new Error('Synthetic Auth credential verification failed');
  }
  const challenge = await auth.prepareTotpChallenge(verified.accessToken);
  if (challenge.stage !== 'enroll') {
    throw new Error('Synthetic Auth identity did not begin TOTP enrollment');
  }
  const secret = new URL(challenge.otpauthUri).searchParams.get('secret');
  if (!secret) throw new Error('Supabase returned no TOTP secret');
  const completed = await auth.verifyTotp({
    accessToken: verified.accessToken,
    factorId: challenge.factorId,
    challengeId: challenge.challengeId,
    code: totpCode(secret),
  });
  if (completed === 'invalid' || completed.assurance !== 'aal2') {
    throw new Error('Synthetic Auth identity did not reach aal2');
  }

  for (const value of [email, password, secret]) {
    console.log(`::add-mask::${value}`);
  }
  appendFileSync(
    outputPath,
    `email=${email}\npassword=${password}\ntotp_secret=${secret}\n`,
  );
  console.log('Synthetic Supabase Auth smoke identity is ready at aal2');
} catch (error) {
  if (supabaseUserId) await auth.deleteCredentials(supabaseUserId);
  throw error;
}
