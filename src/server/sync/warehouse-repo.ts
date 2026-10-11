import { balanceKeyString } from '#/domain/balance';
import {
  type Effects,
  type ProcessContext,
  touchedKeys,
} from '#/domain/process';
import type {
  ExceptionDraft,
  Movement,
  MovementSource,
  MovementType,
} from '#/domain/types';
import type { CatalogClient, WarehouseClient } from '#/server/db/clients';

/** The interactive-transaction client passed to `$transaction` callbacks. */
export type WarehouseTx = Parameters<
  Parameters<WarehouseClient['$transaction']>[0]
>[0];

export function withMovementTx<T>(
  db: WarehouseClient,
  fn: (tx: WarehouseTx) => Promise<T>,
): Promise<T> {
  return db.$transaction(fn);
}

export interface MovementRow {
  id: string;
  type: string;
  skuId: string;
  fromLocationId: string | null;
  toLocationId: string | null;
  qty: number;
  reasonCode: string | null;
  ref: string | null;
  counterpartWarehouseId: string | null;
  userId: string;
  deviceId: string;
  occurredAt: Date;
  source: string;
}

export function toDomain(r: MovementRow): Movement {
  return {
    id: r.id,
    type: r.type as MovementType,
    skuId: r.skuId,
    fromLocationId: r.fromLocationId,
    toLocationId: r.toLocationId,
    qty: r.qty,
    reasonCode: r.reasonCode,
    ref: r.ref,
    counterpartWarehouseId: r.counterpartWarehouseId,
    userId: r.userId,
    deviceId: r.deviceId,
    occurredAt: r.occurredAt,
    source: r.source as MovementSource,
  };
}

async function resolveTolerance(
  catalog: CatalogClient,
  skuId: string,
): Promise<number> {
  const product = await catalog.product.findUnique({
    where: { id: skuId },
    select: {
      countTolerance: true,
      category: { select: { countTolerance: true } },
    },
  });
  return product?.countTolerance ?? product?.category?.countTolerance ?? 0;
}

/** Reads everything `processMovement` needs for one incoming movement. */
export async function loadContext(
  tx: WarehouseTx,
  catalog: CatalogClient,
  m: Movement,
): Promise<ProcessContext> {
  const keys = touchedKeys(m).map((k) => {
    const [skuId = '', locationId = ''] = k.split('|');
    return { key: k, skuId, locationId };
  });

  const balances = new Map<string, number>();
  const binLedgers = new Map<string, Movement[]>();
  for (const { key, skuId, locationId } of keys) {
    const bal = await tx.stockBalance.findUnique({
      where: { skuId_locationId: { skuId, locationId } },
    });
    balances.set(key, bal?.qty ?? 0);
    const rows = await tx.movement.findMany({
      where: {
        skuId,
        OR: [{ toLocationId: locationId }, { fromLocationId: locationId }],
      },
      orderBy: { seq: 'asc' },
    });
    binLedgers.set(key, rows.map(toDomain));
  }

  const openNegativeKeys = new Set<string>();
  if (keys.length > 0) {
    const open = await tx.exception.findMany({
      where: {
        type: 'NEGATIVE_BALANCE',
        status: 'OPEN',
        OR: keys.map(({ skuId, locationId }) => ({ skuId, locationId })),
      },
    });
    for (const e of open) {
      if (e.skuId !== null && e.locationId !== null) {
        openNegativeKeys.add(
          balanceKeyString({ skuId: e.skuId, locationId: e.locationId }),
        );
      }
    }
  }

  let pickLine: ProcessContext['pickLine'] = null;
  let pickedBefore = 0;
  if (m.type === 'PICK' && m.ref !== null) {
    const line = await tx.pickLine.findUnique({ where: { id: m.ref } });
    if (line) {
      pickLine = { id: line.id, qtyRequested: line.qtyRequested };
      const sum = await tx.movement.aggregate({
        where: { type: 'PICK', ref: m.ref },
        _sum: { qty: true },
      });
      pickedBefore = sum._sum.qty ?? 0;
    }
  }

  return {
    balances,
    binLedgers,
    openNegativeKeys,
    tolerance: await resolveTolerance(catalog, m.skuId),
    pickLine,
    pickedBefore,
  };
}

/** Writes the movements, balance deltas and exceptions produced by `processMovement`. */
export async function persistEffects(
  tx: WarehouseTx,
  effects: Effects,
): Promise<void> {
  for (const m of effects.movements) {
    await tx.movement.create({ data: { ...m } });
  }
  for (const d of effects.balanceDeltas) {
    await tx.stockBalance.upsert({
      where: { skuId_locationId: { skuId: d.skuId, locationId: d.locationId } },
      create: { skuId: d.skuId, locationId: d.locationId, qty: d.delta },
      update: { qty: { increment: d.delta } },
    });
  }
  await persistExceptions(tx, effects.exceptions);
}

/** Inserts OPEN exception rows for the given drafts. */
export async function persistExceptions(
  tx: WarehouseTx,
  drafts: ExceptionDraft[],
): Promise<void> {
  for (const e of drafts) {
    await tx.exception.create({
      data: {
        id: crypto.randomUUID(),
        type: e.type,
        status: 'OPEN',
        movementIds: JSON.stringify(e.movementIds),
        skuId: e.skuId,
        locationId: e.locationId,
        deviceId: e.deviceId,
        details: JSON.stringify(e.details),
      },
    });
  }
}
