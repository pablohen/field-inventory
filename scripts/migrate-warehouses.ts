import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import {
  catalogUrl,
  closeClients,
  globalDb,
  globalUrl,
  warehouseUrl,
} from '#/server/db/clients';
import { applyMigrations, migrationsDir } from '#/server/db/migrate';

async function migrate(url: string, name: 'global' | 'catalog' | 'warehouse') {
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
  const warehouses = await db.warehouse.findMany({ orderBy: { id: 'asc' } });
  for (const wh of warehouses) {
    const version = await migrate(warehouseUrl(wh.tursoDbName), 'warehouse');
    if (version !== wh.schemaVersion) {
      await db.warehouse.update({
        where: { id: wh.id },
        data: { schemaVersion: version },
      });
    }
    console.log(`${wh.tursoDbName}: v${version}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeClients());
