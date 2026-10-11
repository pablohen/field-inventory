import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@libsql/client';

/** Hand-maintained; tests/server/migrate.test.ts checks it against the files on disk. */
export const SCHEMA_VERSIONS = {
  global: 2,
  catalog: 1,
  warehouse: 1,
} as const;

export type DbName = keyof typeof SCHEMA_VERSIONS;

/** Absolute path of a database's migrations directory. */
export function migrationsDir(name: DbName): string {
  return fileURLToPath(
    new URL(`../../../prisma/${name}/migrations`, import.meta.url),
  );
}

async function ensureTable(client: Client): Promise<void> {
  await client.execute(
    'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, appliedAt TEXT NOT NULL)',
  );
}

export async function currentVersion(client: Client): Promise<number> {
  await ensureTable(client);
  const res = await client.execute('SELECT COUNT(*) AS n FROM _migrations');
  return Number(res.rows[0]?.n ?? 0);
}

/** Applies unapplied `*.sql` files in lexical order. Returns the version after applying. */
export async function applyMigrations(
  client: Client,
  dir: string,
): Promise<number> {
  await ensureTable(client);
  const applied = new Set(
    (await client.execute('SELECT name FROM _migrations')).rows.map((r) =>
      String(r.name),
    ),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    const tx = await client.transaction('write');
    try {
      await tx.executeMultiple(sql);
      await tx.execute({
        sql: 'INSERT INTO _migrations (name, appliedAt) VALUES (?, ?)',
        args: [file, new Date().toISOString()],
      });
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    } finally {
      tx.close();
    }
  }
  return currentVersion(client);
}
