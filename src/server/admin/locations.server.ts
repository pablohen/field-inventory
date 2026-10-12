import {
  type LocationInput,
  locationInputSchema,
} from '#/admin/location-input';
import { authorizeAdmin } from '#/server/auth/authorize';
import type { SessionClaims } from '#/server/auth/session';
import type { GlobalClient, WarehouseClient } from '#/server/db/clients';
import {
  type DeskError,
  warehouseClientFor,
} from '#/server/desk/warehouses.server';

export type LocationDeps = {
  global: GlobalClient;
  warehouseDb(name: string): WarehouseClient;
};

export type AdminLocationRow = {
  id: string;
  code: string;
  zone: string | null;
  active: boolean;
  stockUnits: number;
};

const notFound: DeskError = {
  ok: false,
  code: 'NOT_FOUND',
  message: 'Location not found',
};

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 'P2002'
  );
}

const duplicate = (code: string): DeskError => ({
  ok: false,
  code: 'INVALID',
  message: `Code ${code} is already used`,
});

const normZone = (zone: string | null | undefined): string | null =>
  zone && zone.length > 0 ? zone : null;

export async function listLocationsAdminCore(
  deps: LocationDeps,
  warehouseId: string,
): Promise<{ ok: true; locations: AdminLocationRow[] } | DeskError> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  const [locations, sums] = await Promise.all([
    wh.db.location.findMany({ orderBy: [{ code: 'asc' }, { id: 'asc' }] }),
    wh.db.stockBalance.groupBy({
      by: ['locationId'],
      where: { qty: { gt: 0 } },
      _sum: { qty: true },
    }),
  ]);
  const units = new Map(sums.map((s) => [s.locationId, s._sum.qty ?? 0]));
  return {
    ok: true,
    locations: locations.map((l) => ({
      id: l.id,
      code: l.code,
      zone: l.zone,
      active: l.active,
      stockUnits: units.get(l.id) ?? 0,
    })),
  };
}

export async function createLocationCore(
  deps: LocationDeps,
  warehouseId: string,
  input: LocationInput,
): Promise<{ ok: true; id: string } | DeskError> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  const { code, zone } = locationInputSchema.parse(input);
  // An id can be taken by a renamed location (update keeps the id), so pick
  // the first free `<wh>-<code>` or `<wh>-<code>-<n>`, n >= 2.
  const base = `${warehouseId}-${code}`;
  const taken = new Set(
    (
      await wh.db.location.findMany({
        where: { id: { startsWith: base } },
        select: { id: true },
      })
    ).map((l) => l.id),
  );
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  try {
    await wh.db.location.create({
      data: { id, code, zone: normZone(zone), active: true },
    });
  } catch (e) {
    // Only a violated `code` is a duplicate code; anything else propagates.
    if (
      isUniqueViolation(e) &&
      (await wh.db.location.findUnique({ where: { code } }))
    ) {
      return duplicate(code);
    }
    throw e;
  }
  return { ok: true, id };
}

export async function updateLocationCore(
  deps: LocationDeps,
  warehouseId: string,
  locationId: string,
  input: LocationInput,
): Promise<{ ok: true } | DeskError> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  const { code, zone } = locationInputSchema.parse(input);
  const existing = await wh.db.location.findUnique({
    where: { id: locationId },
  });
  if (!existing) return notFound;
  try {
    await wh.db.location.update({
      where: { id: locationId },
      data: { code, zone: normZone(zone) },
    });
  } catch (e) {
    if (
      isUniqueViolation(e) &&
      (await wh.db.location.findUnique({ where: { code } }))
    ) {
      return duplicate(code);
    }
    throw e;
  }
  return { ok: true };
}

export async function setLocationActiveCore(
  deps: LocationDeps,
  warehouseId: string,
  locationId: string,
  active: boolean,
): Promise<{ ok: true; warning?: string } | DeskError> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  const existing = await wh.db.location.findUnique({
    where: { id: locationId },
  });
  if (!existing) return notFound;
  await wh.db.location.update({ where: { id: locationId }, data: { active } });
  if (active) return { ok: true };
  const agg = await wh.db.stockBalance.aggregate({
    where: { locationId, qty: { gt: 0 } },
    _sum: { qty: true },
  });
  const units = agg._sum.qty ?? 0;
  return units > 0
    ? { ok: true, warning: `Location still holds ${units} units` }
    : { ok: true };
}

export async function handleListLocationsAdmin(
  claims: SessionClaims | null,
  input: { warehouseId: string },
  deps: LocationDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return listLocationsAdminCore(deps, input.warehouseId);
}

export async function handleCreateLocation(
  claims: SessionClaims | null,
  input: { warehouseId: string } & LocationInput,
  deps: LocationDeps,
) {
  await authorizeAdmin(claims, deps.global);
  const { warehouseId, ...rest } = input;
  return createLocationCore(deps, warehouseId, rest);
}

export async function handleUpdateLocation(
  claims: SessionClaims | null,
  input: { warehouseId: string; locationId: string } & LocationInput,
  deps: LocationDeps,
) {
  await authorizeAdmin(claims, deps.global);
  const { warehouseId, locationId, ...rest } = input;
  return updateLocationCore(deps, warehouseId, locationId, rest);
}

export async function handleSetLocationActive(
  claims: SessionClaims | null,
  input: { warehouseId: string; locationId: string; active: boolean },
  deps: LocationDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return setLocationActiveCore(
    deps,
    input.warehouseId,
    input.locationId,
    input.active,
  );
}
