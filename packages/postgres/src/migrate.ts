import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const migrationsDirectory = new URL('../migrations/', import.meta.url);

export async function migrate(
  databaseUrl: string,
  databaseCaCertificate?: string,
): Promise<void> {
  const connectionUrl = new URL(databaseUrl);
  if (databaseCaCertificate) {
    connectionUrl.searchParams.delete('sslmode');
    connectionUrl.searchParams.delete('sslrootcert');
  }
  const client = new Client({
    connectionString: connectionUrl.toString(),
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
    await client.query(`
      create table if not exists public.schema_migrations (
        name text primary key,
        applied_at timestamptz not null default transaction_timestamp()
      )
    `);

    const migrationNames = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const name of migrationNames) {
      await client.query('begin');
      try {
        const applied = await client.query<{ exists: boolean }>(
          'select exists(select 1 from public.schema_migrations where name = $1)',
          [name],
        );
        if (!applied.rows[0]?.exists) {
          const contents = await readFile(
            fileURLToPath(new URL(name, migrationsDirectory)),
            'utf8',
          );
          await client.query(contents);
          await client.query(
            'insert into public.schema_migrations(name) values ($1)',
            [name],
          );
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}
