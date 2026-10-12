import { z } from 'zod';
import type { SessionClaims } from '#/server/auth/session';
import type { GlobalClient, WarehouseClient } from '#/server/db/clients';
import { authorizeDesk } from './session';
import { type DeskError, warehouseClientFor } from './warehouses.server';

export const listLocationsInputSchema = z.object({
  warehouseId: z.string().min(1),
});

export type LocationRow = {
  id: string;
  code: string;
  zone: string | null;
  active: boolean;
};

export type ListLocationsResult =
  | { ok: true; locations: LocationRow[] }
  | DeskError;

/** All bins of a warehouse (inactive included, flagged), ordered by code. */
export async function handleListLocations(
  claims: SessionClaims | null,
  input: { warehouseId: string },
  deps: {
    global: GlobalClient;
    warehouseDb(name: string): WarehouseClient;
  },
): Promise<ListLocationsResult> {
  authorizeDesk(claims);
  const wh = await warehouseClientFor(deps, input.warehouseId);
  if (!wh.ok) return wh;
  const locations = await wh.db.location.findMany({
    select: { id: true, code: true, zone: true, active: true },
    orderBy: [{ code: 'asc' }, { id: 'asc' }],
  });
  return { ok: true, locations };
}
