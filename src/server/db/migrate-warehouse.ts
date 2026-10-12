import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import { warehouseUrl } from './clients';
import { applyMigrations, migrationsDir } from './migrate';

/** Applies pending warehouse migrations to one warehouse DB. Returns the version after applying. */
export async function migrateWarehouseDb(dbName: string): Promise<number> {
  const url = warehouseUrl(dbName);
  if (url.startsWith('file:'))
    mkdirSync(dirname(url.slice(5)), { recursive: true });
  const client = createClient({
    url,
    authToken: process.env.TURSO_GROUP_AUTH_TOKEN || undefined,
  });
  try {
    return await applyMigrations(client, migrationsDir('warehouse'));
  } finally {
    client.close();
  }
}
