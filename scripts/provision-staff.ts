import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresIdentityAndAccess } from '../packages/postgres/src/identity-access.ts';
import { createSupabaseStaffAuth } from '../packages/supabase-auth/src/index.ts';
import type { StaffPermission } from '../modules/identity-access/index.ts';

/**
 * Technical Operator tooling: provisions one Staff Identity with its Supabase
 * credentials and independent permission grants after out-of-band school
 * authorization. Prints the one-time initial password for out-of-band
 * delivery; it is never stored or logged elsewhere by this script.
 *
 * Required environment:
 *   DATABASE_URL          restricted runtime connection to the workspace database
 *   SUPABASE_URL          Supabase project URL
 *   SUPABASE_SECRET_KEY   Supabase server secret key
 *   STAFF_WORKSPACE_ID    School Workspace the identity belongs to
 *   STAFF_DISPLAY_NAME    Staff member's display name
 *   STAFF_EMAIL           Staff member's verified work address
 *   STAFF_PERMISSIONS     comma-separated: administrative,clinical
 *   SCHOOL_APPROVER       school authority who approved the provisioning
 *   PROVISIONING_REASON   structured reason recorded in audit evidence
 */
function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const permissions = requiredEnvironment('STAFF_PERMISSIONS')
  .split(',')
  .map((permission) => permission.trim());
for (const permission of permissions) {
  if (permission !== 'administrative' && permission !== 'clinical') {
    throw new Error(
      `STAFF_PERMISSIONS contains an unknown permission: ${permission}`,
    );
  }
}

const pool = new Pool({
  connectionString: requiredEnvironment('DATABASE_URL'),
});
try {
  const identityAndAccess = createPostgresIdentityAndAccess({
    pool,
    staffAuth: createSupabaseStaffAuth({
      supabaseUrl: requiredEnvironment('SUPABASE_URL'),
      secretKey: requiredEnvironment('SUPABASE_SECRET_KEY'),
    }),
    clock: { now: () => new Date() },
    ids: { create: randomUUID },
    handles: {
      create: () => randomBytes(32).toString('base64url'),
      hash: () => {
        throw new Error('Provisioning never hashes session handles');
      },
    },
  });

  const initialPassword = `${randomBytes(18).toString('base64url')}`;
  const staffIdentityId = randomUUID();
  const result = await identityAndAccess.provisionStaffIdentity({
    operationId: randomUUID(),
    workspaceId: requiredEnvironment('STAFF_WORKSPACE_ID'),
    staffIdentityId,
    displayName: requiredEnvironment('STAFF_DISPLAY_NAME'),
    email: requiredEnvironment('STAFF_EMAIL'),
    permissions: permissions as StaffPermission[],
    schoolApprover: requiredEnvironment('SCHOOL_APPROVER'),
    reason: requiredEnvironment('PROVISIONING_REASON'),
    initialPassword,
    actor: {
      type: 'technical_operator',
      id: process.env.OPERATOR_ID ?? 'provision-staff-script',
    },
  });
  console.log(
    JSON.stringify({
      outcome: result.outcome,
      staffIdentityId: result.staffIdentityId,
      initialPassword,
      notice:
        'Deliver the initial password out of band. The staff member sets up TOTP on first sign-in.',
    }),
  );
} finally {
  await pool.end();
}
