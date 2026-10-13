import {
  type EnrollDeviceInput,
  enrollDeviceInputSchema,
} from '#/admin/device-input';
import { authorizeAdmin } from '#/server/auth/authorize';
import type { SessionClaims } from '#/server/auth/session';
import type { GlobalClient } from '#/server/db/clients';
import type { DeskError } from '#/server/desk/warehouses.server';

export type DeviceDeps = { global: GlobalClient; now(): Date };

export type AdminDeviceRow = {
  id: string;
  label: string;
  enrolledAt: Date;
  revoked: boolean;
  warehouseIds: string[];
};

const invalid = (message: string): DeskError => ({
  ok: false,
  code: 'INVALID',
  message,
});
const notFound: DeskError = {
  ok: false,
  code: 'NOT_FOUND',
  message: 'Device not found',
};

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 'P2002'
  );
}

/** Thrown inside a transaction to roll it back with a typed result. */
class Abort extends Error {
  constructor(readonly error: DeskError) {
    super(error.message);
  }
}

const dedupe = (ids: string[]) => [...new Set(ids)];

async function unknownWarehouses(
  db: Pick<GlobalClient, 'warehouse'>,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const found = await db.warehouse.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const have = new Set(found.map((w) => w.id));
  return ids.filter((id) => !have.has(id));
}

const unknownMessage = (ids: string[]) =>
  `Unknown warehouse${ids.length === 1 ? '' : 's'}: ${ids.join(', ')}`;

export async function listDevicesAdminCore(
  deps: Pick<DeviceDeps, 'global'>,
): Promise<{ ok: true; devices: AdminDeviceRow[] }> {
  const devices = await deps.global.device.findMany({
    include: { warehouses: { select: { warehouseId: true } } },
  });
  // Case-insensitive by label (SQLite's default collation puts capitals first).
  devices.sort(
    (a, b) =>
      a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }) ||
      a.id.localeCompare(b.id),
  );
  return {
    ok: true,
    devices: devices.map((d) => ({
      id: d.id,
      label: d.label,
      enrolledAt: d.enrolledAt,
      revoked: d.revokedAt !== null,
      warehouseIds: d.warehouses.map((w) => w.warehouseId).sort(),
    })),
  };
}

export async function enrollDeviceCore(
  deps: Pick<DeviceDeps, 'global'>,
  input: EnrollDeviceInput,
): Promise<{ ok: true; id: string } | DeskError> {
  const { id, label, warehouseIds } = enrollDeviceInputSchema.parse(input);
  const ids = dedupe(warehouseIds);
  const exists = () => deps.global.device.findUnique({ where: { id } });
  const taken = () => invalid(`Device ${id} is already enrolled`);
  if (await exists()) return taken();
  try {
    await deps.global.$transaction(async (tx) => {
      const unknown = await unknownWarehouses(tx, ids);
      if (unknown.length > 0) throw new Abort(invalid(unknownMessage(unknown)));
      await tx.device.create({ data: { id, label } });
      if (ids.length > 0) {
        await tx.deviceWarehouse.createMany({
          data: ids.map((warehouseId) => ({ deviceId: id, warehouseId })),
        });
      }
    });
  } catch (e) {
    if (e instanceof Abort) return e.error;
    if (isUniqueViolation(e) && (await exists())) return taken();
    throw e;
  }
  return { ok: true, id };
}

export async function setDeviceWarehousesCore(
  deps: Pick<DeviceDeps, 'global'>,
  deviceId: string,
  warehouseIds: string[],
): Promise<{ ok: true } | DeskError> {
  const ids = dedupe(warehouseIds);
  try {
    await deps.global.$transaction(async (tx) => {
      const device = await tx.device.findUnique({ where: { id: deviceId } });
      if (!device) throw new Abort(notFound);
      const unknown = await unknownWarehouses(tx, ids);
      if (unknown.length > 0) throw new Abort(invalid(unknownMessage(unknown)));
      await tx.deviceWarehouse.deleteMany({
        where: { deviceId, warehouseId: { notIn: ids } },
      });
      const existing = new Set(
        (
          await tx.deviceWarehouse.findMany({
            where: { deviceId },
            select: { warehouseId: true },
          })
        ).map((l) => l.warehouseId),
      );
      const toAdd = ids.filter((w) => !existing.has(w));
      if (toAdd.length > 0) {
        await tx.deviceWarehouse.createMany({
          data: toAdd.map((warehouseId) => ({ deviceId, warehouseId })),
        });
      }
    });
  } catch (e) {
    if (e instanceof Abort) return e.error;
    throw e;
  }
  return { ok: true };
}

export async function setDeviceRevokedCore(
  deps: DeviceDeps,
  deviceId: string,
  revoked: boolean,
): Promise<{ ok: true } | DeskError> {
  const device = await deps.global.device.findUnique({
    where: { id: deviceId },
  });
  if (!device) return notFound;
  if (revoked) {
    // Keep the original revocation time if already revoked.
    await deps.global.device.updateMany({
      where: { id: deviceId, revokedAt: null },
      data: { revokedAt: deps.now() },
    });
  } else {
    await deps.global.device.update({
      where: { id: deviceId },
      data: { revokedAt: null },
    });
  }
  return { ok: true };
}

export async function handleListDevices(
  claims: SessionClaims | null,
  _input: Record<string, never>,
  deps: DeviceDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return listDevicesAdminCore(deps);
}

export async function handleEnrollDevice(
  claims: SessionClaims | null,
  input: EnrollDeviceInput,
  deps: DeviceDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return enrollDeviceCore(deps, input);
}

export async function handleSetDeviceWarehouses(
  claims: SessionClaims | null,
  input: { deviceId: string; warehouseIds: string[] },
  deps: DeviceDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return setDeviceWarehousesCore(deps, input.deviceId, input.warehouseIds);
}

export async function handleSetDeviceRevoked(
  claims: SessionClaims | null,
  input: { deviceId: string; revoked: boolean },
  deps: DeviceDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return setDeviceRevokedCore(deps, input.deviceId, input.revoked);
}
