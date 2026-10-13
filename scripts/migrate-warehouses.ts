import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import {
  catalogUrl,
  closeClients,
  globalDb,
  globalUrl,
} from '#/server/db/clients';
import { applyMigrations, migrationsDir } from '#/server/db/migrate';
import { migrateAllWarehouses } from '#/server/db/migrate-all-warehouses';
import { migrateWarehouseDb } from '#/server/db/migrate-warehouse';

async function migrate(url: string, name: 'global' | 'catalog') {
  if (url.startsWith('file:'))
    mkdirSync(dirname(url.slice(5)), { recursive: true });
  const client = createClient({
    url,
    authToken: process.env.TURSO_GROUP_AUTH_TOKEN || undefined,
  });
  try {
    return await applyMigrations(client, migrationsDir(name));
  } finally {
    client.close();
  }
}

async function main() {
  console.log(`global: v${await migrate(globalUrl(), 'global')}`);
  console.log(`catalog: v${await migrate(catalogUrl(), 'catalog')}`);

  const db = globalDb();
  const failed = await migrateAllWarehouses(db, migrateWarehouseDb);
  if (failed > 0) {
    console.error(`${failed} warehouse(s) failed to migrate`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeClients());
