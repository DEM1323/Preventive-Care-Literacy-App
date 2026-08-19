import { Client } from 'pg';
import type { ProviderName } from '../../observability/src/index.ts';
import { restrictedDatabaseRoleSql } from '../../postgres/src/identity-access.ts';

export type ProviderProbe = {
  name: ProviderName;
  check(): Promise<void>;
};

export type ProviderCheck = {
  name: ProviderName;
  status: 'error' | 'ok';
  durationMs: number;
};

export type ProviderConfiguration = {
  databaseUrl: string;
  databaseCaCertificate?: string;
  projectRef: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  storageBucket: string;
  queueName: string;
  cronJobName: string;
  resendApiKey: string;
  smokeEmailSender: string;
  smokeEmailRecipient: string;
};

type FetchRequest = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

type Query = (
  sql: string,
  parameters?: readonly unknown[],
) => Promise<{ rows: readonly Record<string, unknown>[] }>;

type ProviderDependencies = {
  request: FetchRequest;
  query: Query;
  sleep: (milliseconds: number) => Promise<void>;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function providerConfigurationFromEnvironment(): ProviderConfiguration {
  return {
    databaseUrl: requiredEnvironment('DATABASE_URL'),
    databaseCaCertificate: process.env.DATABASE_CA_CERT || undefined,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    supabaseUrl: requiredEnvironment('SUPABASE_URL'),
    supabaseSecretKey: requiredEnvironment('SUPABASE_SECRET_KEY'),
    storageBucket: requiredEnvironment('SUPABASE_STORAGE_BUCKET'),
    queueName: requiredEnvironment('SUPABASE_QUEUE_NAME'),
    cronJobName: requiredEnvironment('SUPABASE_CRON_JOB_NAME'),
    resendApiKey: requiredEnvironment('RESEND_API_KEY'),
    smokeEmailSender: requiredEnvironment('PROVIDER_SMOKE_EMAIL_FROM'),
    smokeEmailRecipient: requiredEnvironment('PROVIDER_SMOKE_EMAIL'),
  };
}

export function assertSupabaseDatabaseTarget(options: {
  databaseUrl: string;
  projectRef: string;
  supabaseUrl: string;
}): void {
  const supabase = new URL(options.supabaseUrl);
  const database = new URL(options.databaseUrl);
  if (supabase.hostname !== `${options.projectRef}.supabase.co`) {
    throw new Error('SUPABASE_URL does not match SUPABASE_PROJECT_REF');
  }
  const direct = database.hostname === `db.${options.projectRef}.supabase.co`;
  const sessionPooler =
    database.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(database.username).endsWith(`.${options.projectRef}`) &&
    database.port === '5432';
  if (!direct && !sessionPooler) {
    throw new Error(
      'DATABASE_URL does not target the configured Supabase project',
    );
  }
}

function createQuery(
  databaseUrl: string,
  databaseCaCertificate?: string,
): Query {
  const connectionUrl = new URL(databaseUrl);
  if (databaseCaCertificate) {
    // CI supplies the Supabase CA as a secret instead of a local file path.
    connectionUrl.searchParams.delete('sslmode');
    connectionUrl.searchParams.delete('sslrootcert');
  }
  return async (sql, parameters = []) => {
    const client = new Client({
      connectionString: connectionUrl.toString(),
      connectionTimeoutMillis: 5_000,
      statement_timeout: 5_000,
      ...(databaseCaCertificate
        ? {
            ssl: {
              ca: databaseCaCertificate,
              rejectUnauthorized: true,
            },
          }
        : {}),
    });
    await client.connect();
    try {
      return await client.query<Record<string, unknown>>(sql, [...parameters]);
    } finally {
      await client.end();
    }
  };
}

function probe(
  name: ProviderName,
  check: () => Promise<boolean>,
): ProviderProbe {
  return {
    name,
    async check() {
      try {
        if (!(await check())) throw new Error('unavailable');
      } catch {
        throw new Error('Provider smoke check failed');
      }
    },
  };
}

export function createProviderProbes(
  configuration: ProviderConfiguration,
  dependencies: Partial<ProviderDependencies> = {},
): readonly ProviderProbe[] {
  const request = dependencies.request ?? fetch;
  const query =
    dependencies.query ??
    createQuery(configuration.databaseUrl, configuration.databaseCaCertificate);
  const sleep =
    dependencies.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  assertSupabaseDatabaseTarget(configuration);
  const supabaseOrigin = new URL(configuration.supabaseUrl).origin;
  const requestOptions = (headers?: RequestInit['headers']): RequestInit => ({
    headers,
    signal: AbortSignal.timeout(5_000),
  });

  return [
    probe('postgres', async () => {
      const result = await query('select 1 as ok');
      const role = await query(restrictedDatabaseRoleSql);
      return (
        result.rows[0]?.ok === 1 &&
        role.rows[0]?.bypasses_rls === false &&
        role.rows[0]?.owns_protected_objects === false
      );
    }),
    probe('auth', async () => {
      const response = await request(
        `${supabaseOrigin}/auth/v1/settings`,
        requestOptions({ apikey: configuration.supabaseSecretKey }),
      );
      return response.ok;
    }),
    probe('storage', async () => {
      const bucket = await request(
        `${supabaseOrigin}/storage/v1/bucket/${encodeURIComponent(configuration.storageBucket)}`,
        requestOptions({ apikey: configuration.supabaseSecretKey }),
      );
      if (!bucket.ok) return false;
      const bucketMetadata: unknown = await bucket.json();
      if (
        typeof bucketMetadata !== 'object' ||
        bucketMetadata === null ||
        !('public' in bucketMetadata) ||
        bucketMetadata.public !== false
      ) {
        return false;
      }
      const objectUrl = `${supabaseOrigin}/storage/v1/object/${encodeURIComponent(configuration.storageBucket)}/provider-smoke/health.txt`;
      const upload = await request(objectUrl, {
        ...requestOptions({ apikey: configuration.supabaseSecretKey }),
        method: 'POST',
        headers: {
          apikey: configuration.supabaseSecretKey,
          'content-type': 'text/plain',
          'x-upsert': 'true',
        },
        body: 'synthetic provider check',
      });
      if (!upload.ok) return false;
      const remove = await request(objectUrl, {
        ...requestOptions({ apikey: configuration.supabaseSecretKey }),
        method: 'DELETE',
      });
      return remove.ok;
    }),
    probe('queue', async () => {
      const result = await query(
        'select infrastructure.provider_queue_healthy($1) as available',
        [configuration.queueName],
      );
      return result.rows[0]?.available === true;
    }),
    probe('cron', async () => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const result = await query(
          'select infrastructure.provider_cron_healthy($1) as available',
          [configuration.cronJobName],
        );
        if (result.rows[0]?.available === true) return true;
        await sleep(10_000);
      }
      return false;
    }),
    probe('email', async () => {
      const response = await request('https://api.resend.com/emails', {
        ...requestOptions({
          authorization: `Bearer ${configuration.resendApiKey}`,
          'content-type': 'application/json',
        }),
        method: 'POST',
        body: JSON.stringify({
          from: configuration.smokeEmailSender,
          to: [configuration.smokeEmailRecipient],
          subject: 'Staging provider check',
          text: 'Synthetic staging delivery check. No Student data.',
        }),
      });
      return response.ok;
    }),
  ];
}

export async function checkProviderProbes(
  probes: readonly ProviderProbe[],
  clock: { now(): number } = { now: performance.now.bind(performance) },
): Promise<readonly ProviderCheck[]> {
  const results: ProviderCheck[] = [];
  for (const provider of probes) {
    const startedAt = clock.now();
    let status: ProviderCheck['status'] = 'ok';
    try {
      await provider.check();
    } catch {
      status = 'error';
    }
    results.push({
      name: provider.name,
      status,
      durationMs: Math.max(0, Math.round(clock.now() - startedAt)),
    });
  }
  return results;
}
