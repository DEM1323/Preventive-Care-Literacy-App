import { expect, test } from 'bun:test';
import { Client } from 'pg';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import { startEphemeralPostgres } from '../../packages/test-support/src/postgres.ts';

test('migrations apply in order and are repeatable', async () => {
  const postgres = await startEphemeralPostgres();
  try {
    await migrate(postgres.connectionString);
    await migrate(postgres.connectionString);

    const client = new Client({ connectionString: postgres.connectionString });
    await client.connect();
    try {
      const applied = await client.query<{ name: string }>(
        'select name from public.schema_migrations order by name',
      );
      expect(applied.rows).toEqual([{ name: '001_audited_spine.sql' }]);
    } finally {
      await client.end();
    }
  } finally {
    await postgres.stop();
  }
});
