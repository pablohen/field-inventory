import { pathToFileURL } from 'node:url';
import {
  catalogUrl,
  closeClients,
  globalDb,
  globalUrl,
  type WarehouseClient,
  warehouseDb,
  warehouseUrl,
} from '#/server/db/clients';
import { seedDev, WAREHOUSES } from './seed-dev';

/**
 * Deletes a warehouse DB's transactional rows. Locations, pick-list headers and
 * lines, and count-task definitions stay; pick/count progress (their status)
 * goes back to OPEN.
 */
export async function resetWarehouseData(db: WarehouseClient): Promise<void> {
  await db.$transaction([
    db.movement.deleteMany(),
    db.stockBalance.deleteMany(),
    db.exception.deleteMany(),
    db.deviceClockSample.deleteMany(),
    db.pickList.updateMany({ data: { status: 'OPEN' } }),
    db.countTask.updateMany({ data: { status: 'OPEN' } }),
  ]);
}

export async function main(): Promise<void> {
  if (process.env.E2E_TURSO !== '1' || process.env.E2E_ALLOW_RESET !== '1') {
    throw new Error('Refusing to reset: set E2E_TURSO=1 and E2E_ALLOW_RESET=1');
  }
  console.log(`e2e reset: global ${globalUrl()}, catalog ${catalogUrl()}`);
  for (const wh of WAREHOUSES) {
    console.log(`e2e reset: ${wh.id} ${warehouseUrl(wh.tursoDbName)}`);
  }
  await globalDb().loginAttempt.deleteMany();
  for (const wh of WAREHOUSES) {
    await resetWarehouseData(warehouseDb(wh.tursoDbName));
  }
  // Rebuilds the initial stock through syncMovementsCore.
  await seedDev();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closeClients());
}
