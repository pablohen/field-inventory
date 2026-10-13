import type { GlobalClient } from './clients';

/**
 * Migrates every provisioned warehouse DB. Warehouses at version 0 are
 * skipped (provisioning is the admin's job). A failure on one warehouse is
 * logged and does not stop the rest. Returns the number of failures.
 */
export async function migrateAllWarehouses(
  db: GlobalClient,
  migrate: (dbName: string) => Promise<number>,
  log: (msg: string) => void = console.log,
  logError: (msg: string, err: unknown) => void = console.error,
): Promise<number> {
  const warehouses = await db.warehouse.findMany({ orderBy: { id: 'asc' } });
  let failed = 0;
  for (const wh of warehouses) {
    if (wh.schemaVersion === 0) {
      log(`${wh.tursoDbName}: setup incomplete, finish it in /admin`);
      continue;
    }
    try {
      const version = await migrate(wh.tursoDbName);
      if (version !== wh.schemaVersion) {
        await db.warehouse.update({
          where: { id: wh.id },
          data: { schemaVersion: version },
        });
      }
      log(`${wh.tursoDbName}: v${version}`);
    } catch (err) {
      failed++;
      logError(`${wh.tursoDbName}: migration failed`, err);
    }
  }
  return failed;
}
