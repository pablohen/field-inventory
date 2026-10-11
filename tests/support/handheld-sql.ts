import { type Client, createClient } from '@libsql/client';
import type { Sql } from '#/handheld/sql';
import { applyMigrations, migrationsDir } from '#/server/db/migrate';

/** Node-only adapter (kept out of src/ so the browser bundle never sees libsql). */
export function libsqlSql(client: Client): Sql {
  return {
    async all<T = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ) {
      const res = await client.execute({
        sql,
        args: params as never,
      });
      return res.rows.map((r) => ({ ...r })) as T[];
    },
    async run(sql, params = []) {
      await client.execute({ sql, args: params as never });
    },
  };
}

export async function memorySql(): Promise<Sql> {
  return libsqlSql(createClient({ url: ':memory:' }));
}

/** In-memory libsql with that DB's migrations applied, acting as a replica. */
export async function replicaSql(kind: 'warehouse' | 'catalog'): Promise<Sql> {
  const client = createClient({ url: ':memory:' });
  await applyMigrations(client, migrationsDir(kind));
  return libsqlSql(client);
}
