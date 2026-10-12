import { findStuckTransfers } from '#/domain/detectors';
import type { ExceptionDraft } from '#/domain/types';
import type { GlobalClient, WarehouseClient } from '#/server/db/clients';
import { toDomain } from './warehouse-repo';

export interface StuckTransferDeps {
  global: GlobalClient;
  warehouseDb(name: string): WarehouseClient;
  now(): Date;
  transferStuckHours: number;
}

/** Detects, persists and returns new TRANSFER_STUCK drafts for one warehouse. */
export async function checkStuckTransfers(
  deps: StuckTransferDeps,
  warehouseId: string,
): Promise<ExceptionDraft[]> {
  const self = await deps.global.warehouse.findUnique({
    where: { id: warehouseId },
    select: { tursoDbName: true },
  });
  if (!self) return [];
  const db = deps.warehouseDb(self.tursoDbName);
  const now = deps.now();
  const tursoNames = new Map<string, string>();

  const outs = (
    await db.movement.findMany({
      where: { type: 'TRANSFER_OUT' },
      orderBy: { seq: 'asc' },
    })
  ).map(toDomain);

  const inRefs = new Set<string>();
  const byCounterpart = new Map<string, string[]>();
  for (const o of outs) {
    if (o.ref === null || o.counterpartWarehouseId === null) continue;
    const refs = byCounterpart.get(o.counterpartWarehouseId) ?? [];
    refs.push(o.ref);
    byCounterpart.set(o.counterpartWarehouseId, refs);
  }
  for (const [counterpartId, refs] of byCounterpart) {
    let name = tursoNames.get(counterpartId);
    if (name === undefined) {
      const wh = await deps.global.warehouse.findUnique({
        where: { id: counterpartId },
        select: { tursoDbName: true },
      });
      if (!wh) continue;
      name = wh.tursoDbName;
      tursoNames.set(counterpartId, name);
    }
    const ins = await deps.warehouseDb(name).movement.findMany({
      where: { type: 'TRANSFER_IN', ref: { in: refs } },
      select: { ref: true },
    });
    for (const r of ins) if (r.ref !== null) inRefs.add(r.ref);
  }

  const flagged = await db.exception.findMany({
    where: { type: 'TRANSFER_STUCK' },
    select: { details: true },
  });
  const alreadyFlagged = new Set<string>();
  for (const f of flagged) {
    const transferId = parseTransferId(f.details);
    if (transferId !== null) alreadyFlagged.add(transferId);
  }

  const drafts = findStuckTransfers(
    outs,
    inRefs,
    alreadyFlagged,
    now,
    deps.transferStuckHours,
  );
  // Deterministic id + per-row unique-violation catch = insert-or-ignore, so
  // concurrent checks cannot double-flag a transfer.
  const inserted: ExceptionDraft[] = [];
  for (const draft of drafts) {
    const transferId = parseTransferId(JSON.stringify(draft.details));
    if (transferId === null) continue;
    try {
      await db.exception.create({
        data: {
          id: `stuck:${transferId}`,
          type: draft.type,
          status: 'OPEN',
          movementIds: JSON.stringify(draft.movementIds),
          skuId: draft.skuId,
          locationId: draft.locationId,
          deviceId: draft.deviceId,
          details: JSON.stringify(draft.details),
        },
      });
      inserted.push(draft);
    } catch (err) {
      if ((err as { code?: unknown }).code !== 'P2002') throw err;
    }
  }
  return inserted;
}

function parseTransferId(details: string): string | null {
  try {
    const parsed = JSON.parse(details) as { transferId?: unknown } | null;
    return typeof parsed?.transferId === 'string' ? parsed.transferId : null;
  } catch {
    return null;
  }
}
