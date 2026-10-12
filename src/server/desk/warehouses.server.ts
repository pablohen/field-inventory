import { SCHEMA_VERSIONS } from '#/domain/schema-versions';
import type { GlobalClient, WarehouseClient } from '#/server/db/clients';

export type DeskError = {
  ok: false;
  code: 'CONFLICT' | 'NOT_FOUND' | 'INVALID' | 'NOT_READY';
  message: string;
};

export async function listWarehouses(
  global: GlobalClient,
): Promise<{ id: string; name: string }[]> {
  return global.warehouse.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

export async function warehouseClientFor(
  deps: { global: GlobalClient; warehouseDb(name: string): WarehouseClient },
  warehouseId: string,
): Promise<{ ok: true; db: WarehouseClient } | DeskError> {
  const wh = await deps.global.warehouse.findUnique({
    where: { id: warehouseId },
  });
  if (!wh) {
    return { ok: false, code: 'NOT_FOUND', message: 'Warehouse not found' };
  }
  if (wh.schemaVersion !== SCHEMA_VERSIONS.warehouse) {
    return {
      ok: false,
      code: 'NOT_READY',
      message: 'Warehouse database is not ready',
    };
  }
  return { ok: true, db: deps.warehouseDb(wh.tursoDbName) };
}
