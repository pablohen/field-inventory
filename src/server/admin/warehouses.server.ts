import { SCHEMA_VERSIONS } from '#/domain/schema-versions';
import { authorizeAdmin } from '#/server/auth/authorize';
import type { SessionClaims } from '#/server/auth/session';
import type { GlobalClient } from '#/server/db/clients';
import { migrateWarehouseDb } from '#/server/db/migrate-warehouse';
import type { DeskError } from '#/server/desk/warehouses.server';
import {
  type CreateWarehouseInput,
  createWarehouseInputSchema,
  type WarehouseStatus,
} from '../../admin/warehouse-input';
import { defaultProvisioner, type WarehouseProvisioner } from './provisioner';

export type { WarehouseStatus };

export interface AdminWarehouseRow {
  id: string;
  name: string;
  tursoDbName: string;
  schemaVersion: number;
  status: WarehouseStatus;
  deviceCount: number;
}

export interface ProvisionDeps {
  global: GlobalClient;
  provisioner: WarehouseProvisioner;
  migrate(dbName: string): Promise<number>;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 'P2002'
  );
}

export function warehouseStatus(schemaVersion: number): WarehouseStatus {
  if (schemaVersion === SCHEMA_VERSIONS.warehouse) return 'READY';
  return schemaVersion === 0 ? 'SETUP_INCOMPLETE' : 'NEEDS_MIGRATION';
}

export async function listWarehousesAdminCore(
  global: GlobalClient,
): Promise<AdminWarehouseRow[]> {
  const rows = await global.warehouse.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { devices: true } } },
  });
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    tursoDbName: w.tursoDbName,
    schemaVersion: w.schemaVersion,
    status: warehouseStatus(w.schemaVersion),
    deviceCount: w._count.devices,
  }));
}

/** Provision the DB, migrate it, record the version. Idempotent; also "Run migrations". */
export async function finishWarehouseSetupCore(
  deps: ProvisionDeps,
  warehouseId: string,
): Promise<{ ok: true; status: WarehouseStatus } | DeskError> {
  const wh = await deps.global.warehouse.findUnique({
    where: { id: warehouseId },
  });
  if (!wh) {
    return { ok: false, code: 'NOT_FOUND', message: 'Warehouse not found' };
  }
  try {
    await deps.provisioner.ensureDatabase(wh.tursoDbName);
    const version = await deps.migrate(wh.tursoDbName);
    await deps.global.warehouse.update({
      where: { id: wh.id },
      data: { schemaVersion: version },
    });
    return { ok: true, status: warehouseStatus(version) };
  } catch (e) {
    return {
      ok: false,
      code: 'NOT_READY',
      message: `Setup incomplete: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function createWarehouseCore(
  deps: ProvisionDeps,
  input: CreateWarehouseInput,
): Promise<{ ok: true; status: WarehouseStatus } | DeskError> {
  const { id, name } = createWarehouseInputSchema.parse(input);
  const exists: DeskError = {
    ok: false,
    code: 'INVALID',
    message: `Warehouse ${id} already exists`,
  };
  if (await deps.global.warehouse.findUnique({ where: { id } })) return exists;
  try {
    await deps.global.warehouse.create({
      data: { id, name, tursoDbName: `fi-${id}`, schemaVersion: 0 },
    });
  } catch (e) {
    // Lost a race with a concurrent create of the same id.
    if (isUniqueViolation(e)) return exists;
    throw e;
  }
  return finishWarehouseSetupCore(deps, id);
}

export async function renameWarehouseCore(
  deps: { global: GlobalClient },
  id: string,
  name: string,
): Promise<{ ok: true } | DeskError> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Name must be 1-80 characters',
    };
  }
  const wh = await deps.global.warehouse.findUnique({ where: { id } });
  if (!wh) {
    return { ok: false, code: 'NOT_FOUND', message: 'Warehouse not found' };
  }
  await deps.global.warehouse.update({
    where: { id },
    data: { name: trimmed },
  });
  return { ok: true };
}

export function defaultProvisionDeps(global: GlobalClient): ProvisionDeps {
  return {
    global,
    provisioner: defaultProvisioner(),
    migrate: migrateWarehouseDb,
  };
}

export async function handleListWarehousesAdmin(
  claims: SessionClaims | null,
  deps: { global: GlobalClient },
): Promise<AdminWarehouseRow[]> {
  await authorizeAdmin(claims, deps.global);
  return listWarehousesAdminCore(deps.global);
}

export async function handleCreateWarehouse(
  claims: SessionClaims | null,
  input: CreateWarehouseInput,
  deps: ProvisionDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return createWarehouseCore(deps, input);
}

export async function handleFinishWarehouseSetup(
  claims: SessionClaims | null,
  input: { id: string },
  deps: ProvisionDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return finishWarehouseSetupCore(deps, input.id);
}

export async function handleRenameWarehouse(
  claims: SessionClaims | null,
  input: { id: string; name: string },
  deps: { global: GlobalClient },
) {
  await authorizeAdmin(claims, deps.global);
  return renameWarehouseCore(deps, input.id, input.name);
}
