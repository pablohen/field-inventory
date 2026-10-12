import type { StockFilters } from '#/desk/stock-filters';
import { movementDeltas } from '#/domain/balance';
import type { Movement, MovementSource, MovementType } from '#/domain/types';
import type { SessionClaims } from '#/server/auth/session';
import type {
  CatalogClient,
  GlobalClient,
  WarehouseClient,
} from '#/server/db/clients';
import type { TimelineMovement } from './exceptions.server';
import { authorizeDesk } from './session';
import { type DeskError, warehouseClientFor } from './warehouses.server';

export {
  type StockFilters,
  stockFiltersSchema,
} from '#/desk/stock-filters';

export type StockDeps = {
  global: GlobalClient;
  catalog: CatalogClient;
  warehouseDb(name: string): WarehouseClient;
};

export type StockRow = {
  skuId: string;
  sku: string;
  name: string;
  locationId: string;
  locationCode: string;
  qty: number;
};

export type StockResult = { ok: true; rows: StockRow[] } | DeskError;

const UNKNOWN_PRODUCT = '(unknown product)';

export async function stockCore(
  deps: StockDeps,
  warehouseId: string,
  filters: StockFilters,
): Promise<StockResult> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;

  const balances = await wh.db.stockBalance.findMany({
    where: {
      ...(filters.skuId ? { skuId: filters.skuId } : {}),
      ...(filters.locationId ? { locationId: filters.locationId } : {}),
      ...(filters.nonZero ? { qty: { not: 0 } } : {}),
    },
  });
  const skuIds = [...new Set(balances.map((b) => b.skuId))];
  const locationIds = [...new Set(balances.map((b) => b.locationId))];
  const [products, locations] = await Promise.all([
    skuIds.length > 0
      ? deps.catalog.product.findMany({
          where: { id: { in: skuIds } },
          select: { id: true, sku: true, name: true },
        })
      : [],
    locationIds.length > 0
      ? wh.db.location.findMany({
          where: { id: { in: locationIds } },
          select: { id: true, code: true },
        })
      : [],
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const codeById = new Map(locations.map((l) => [l.id, l.code]));

  const rows: StockRow[] = balances.map((b) => {
    const p = productById.get(b.skuId);
    return {
      skuId: b.skuId,
      sku: p?.sku ?? b.skuId,
      name: p?.name ?? UNKNOWN_PRODUCT,
      locationId: b.locationId,
      locationCode: codeById.get(b.locationId) ?? b.locationId,
      qty: b.qty,
    };
  });
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  rows.sort((a, b) => cmp(a.sku, b.sku) || cmp(a.locationCode, b.locationCode));
  return { ok: true, rows };
}

/** Authorized entry point; throws 401/403 Responses for non-desk callers. */
export async function handleGetStock(
  claims: SessionClaims | null,
  input: { warehouseId: string; filters: StockFilters },
  deps: StockDeps,
): Promise<StockResult> {
  authorizeDesk(claims);
  return stockCore(deps, input.warehouseId, input.filters);
}

export type LedgerKey = { skuId: string; locationId: string };

export type LedgerRow = TimelineMovement & {
  delta: number;
  runningBalance: number;
};

export type LedgerResult =
  | { ok: true; rows: LedgerRow[]; balance: number }
  | DeskError;

export async function ledgerCore(
  deps: StockDeps,
  warehouseId: string,
  key: LedgerKey,
): Promise<LedgerResult> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;

  const movements = await wh.db.movement.findMany({
    where: {
      skuId: key.skuId,
      OR: [
        { toLocationId: key.locationId },
        { fromLocationId: key.locationId },
      ],
    },
    orderBy: { seq: 'asc' },
  });
  let running = 0;
  const rows: LedgerRow[] = movements.map((m) => {
    const domain: Movement = {
      id: m.id,
      type: m.type as MovementType,
      skuId: m.skuId,
      fromLocationId: m.fromLocationId,
      toLocationId: m.toLocationId,
      qty: m.qty,
      reasonCode: m.reasonCode,
      ref: m.ref,
      counterpartWarehouseId: m.counterpartWarehouseId,
      userId: m.userId,
      deviceId: m.deviceId,
      occurredAt: m.occurredAt,
      source: m.source as MovementSource,
    };
    const delta = movementDeltas(domain)
      .filter((d) => d.skuId === key.skuId && d.locationId === key.locationId)
      .reduce((sum, d) => sum + d.delta, 0);
    running += delta;
    return {
      id: m.id,
      seq: m.seq,
      type: m.type,
      skuId: m.skuId,
      fromLocationId: m.fromLocationId,
      toLocationId: m.toLocationId,
      qty: m.qty,
      reasonCode: m.reasonCode,
      userId: m.userId,
      deviceId: m.deviceId,
      source: m.source,
      occurredAt: m.occurredAt.toISOString(),
      receivedAt: m.receivedAt.toISOString(),
      involved: false,
      delta,
      runningBalance: running,
    };
  });
  const stored = await wh.db.stockBalance.findUnique({
    where: { skuId_locationId: key },
  });
  return { ok: true, rows, balance: stored?.qty ?? 0 };
}

/** Authorized entry point; throws 401/403 Responses for non-desk callers. */
export async function handleGetLedger(
  claims: SessionClaims | null,
  input: { warehouseId: string; key: LedgerKey },
  deps: StockDeps,
): Promise<LedgerResult> {
  authorizeDesk(claims);
  return ledgerCore(deps, input.warehouseId, input.key);
}

/** System-generated codes are never offered to a person. */
const SYSTEM_REASONS = new Set(['COUNT_AUTO', 'INITIAL']);

/** Reason codes applicable to `type`, ordered by code, minus system codes. */
export async function listReasonCodesCore(
  catalog: CatalogClient,
  type: MovementType,
): Promise<{ code: string; label: string }[]> {
  const rows = await catalog.reasonCode.findMany({
    orderBy: { code: 'asc' },
  });
  return rows
    .filter((r) => {
      if (SYSTEM_REASONS.has(r.code)) return false;
      try {
        const applies: unknown = JSON.parse(r.appliesTo);
        return Array.isArray(applies) && applies.includes(type);
      } catch {
        return false;
      }
    })
    .map((r) => ({ code: r.code, label: r.label }));
}

/** Authorized entry point; throws 401/403 Responses for non-desk callers. */
export async function handleListReasonCodes(
  claims: SessionClaims | null,
  input: { type: MovementType },
  deps: { catalog: CatalogClient },
): Promise<{ code: string; label: string }[]> {
  authorizeDesk(claims);
  return listReasonCodesCore(deps.catalog, input.type);
}
