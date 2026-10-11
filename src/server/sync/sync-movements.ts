import { detectClockSkew, findStuckTransfers } from '#/domain/detectors';
import { processMovement } from '#/domain/process';
import {
  type MovementInput,
  movementInputSchema,
  syncBatchSchema,
  toMovement,
} from '#/domain/schemas';
import type { ExceptionDraft, Movement } from '#/domain/types';
import type {
  CatalogClient,
  GlobalClient,
  WarehouseClient,
} from '#/server/db/clients';
import { SCHEMA_VERSIONS } from '#/server/db/migrate';
import {
  loadContext,
  persistEffects,
  persistExceptions,
  toDomain,
  type WarehouseTx,
  withMovementTx,
} from './warehouse-repo';

export type RowResult =
  | { id: string; status: 'accepted' }
  | { id: string; status: 'duplicate' }
  | { id: string | null; status: 'invalid'; reason: string };

export type SyncResponse =
  | {
      status: 'ok';
      results: RowResult[];
      exceptions: ExceptionDraft[];
      serverTime: string;
    }
  | {
      status:
        | 'UPDATE_REQUIRED'
        | 'DEVICE_REVOKED'
        | 'DEVICE_UNKNOWN'
        | 'WAREHOUSE_NOT_READY';
      serverTime: string;
    };

export interface SyncDeps {
  global: GlobalClient;
  catalog: CatalogClient;
  warehouseDb(name: string): WarehouseClient;
  now(): Date;
  newId(): string;
  clockSkewThresholdMs: number;
  transferStuckHours: number;
}

interface ValidRow {
  index: number;
  input: MovementInput;
  dbName: string;
}

type TxOutcome =
  | { kind: 'accepted'; exceptions: ExceptionDraft[] }
  | { kind: 'duplicate' }
  | { kind: 'invalid'; reason: string };

function rawId(row: unknown): string | null {
  if (typeof row === 'object' && row !== null && 'id' in row) {
    const id = (row as { id: unknown }).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}

async function validateReferences(
  tx: WarehouseTx,
  catalog: CatalogClient,
  m: Movement,
): Promise<string | null> {
  const sku = await catalog.product.findUnique({
    where: { id: m.skuId },
    select: { id: true },
  });
  if (!sku) return 'UNKNOWN_SKU';

  for (const locationId of [m.fromLocationId, m.toLocationId]) {
    if (locationId === null) continue;
    const loc = await tx.location.findUnique({ where: { id: locationId } });
    if (!loc) return 'UNKNOWN_LOCATION';
    if (!loc.active) return 'INACTIVE_LOCATION';
  }

  if (m.type === 'PICK' && m.ref !== null) {
    const line = await tx.pickLine.findUnique({ where: { id: m.ref } });
    if (!line) return 'UNKNOWN_PICK_LINE';
  }
  return null;
}

async function applyRow(
  deps: SyncDeps,
  db: WarehouseClient,
  input: MovementInput,
): Promise<TxOutcome> {
  const m = toMovement(input, 'device');
  try {
    return await withMovementTx(db, async (tx): Promise<TxOutcome> => {
      const existing = await tx.movement.findUnique({
        where: { id: m.id },
        select: { id: true },
      });
      if (existing) return { kind: 'duplicate' };

      const reason = await validateReferences(tx, deps.catalog, m);
      if (reason !== null) return { kind: 'invalid', reason };

      const ctx = await loadContext(tx, deps.catalog, m);
      const effects = processMovement(m, ctx, deps.newId);
      await persistEffects(tx, effects);
      return { kind: 'accepted', exceptions: effects.exceptions };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: 'duplicate' };
    throw err;
  }
}

async function detectForWarehouse(
  deps: SyncDeps,
  db: WarehouseClient,
  deviceId: string,
  sentAt: Date,
  now: Date,
  tursoNames: Map<string, string>,
): Promise<ExceptionDraft[]> {
  const openSkew = await db.exception.findFirst({
    where: { type: 'CLOCK_SKEW', status: 'OPEN', deviceId },
    select: { id: true },
  });
  await db.deviceClockSample.create({
    data: {
      deviceId,
      deviceTime: sentAt,
      serverTime: now,
      skewMs: sentAt.getTime() - now.getTime(),
    },
  });
  const drafts: ExceptionDraft[] = [];
  const skew = detectClockSkew(
    deviceId,
    sentAt,
    now,
    deps.clockSkewThresholdMs,
    openSkew !== null,
  );
  if (skew) drafts.push(skew);

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
    const details = JSON.parse(f.details) as { transferId?: unknown };
    if (typeof details.transferId === 'string') {
      alreadyFlagged.add(details.transferId);
    }
  }

  drafts.push(
    ...findStuckTransfers(
      outs,
      inRefs,
      alreadyFlagged,
      now,
      deps.transferStuckHours,
    ),
  );
  return drafts;
}

export async function syncMovementsCore(
  deps: SyncDeps,
  rawInput: unknown,
): Promise<SyncResponse> {
  const batch = syncBatchSchema.parse(rawInput);
  const now = deps.now();
  const serverTime = now.toISOString();

  if (batch.schemaVersion !== SCHEMA_VERSIONS.warehouse) {
    return { status: 'UPDATE_REQUIRED', serverTime };
  }

  const device = await deps.global.device.findUnique({
    where: { id: batch.deviceId },
    include: { warehouses: { include: { warehouse: true } } },
  });
  if (!device) return { status: 'DEVICE_UNKNOWN', serverTime };
  if (device.revokedAt !== null)
    return { status: 'DEVICE_REVOKED', serverTime };

  const assigned = new Map(
    device.warehouses.map((dw) => [dw.warehouseId, dw.warehouse]),
  );

  const results: RowResult[] = new Array(batch.movements.length);
  const parsedRows: { index: number; input: MovementInput }[] = [];
  batch.movements.forEach((row, index) => {
    const parsed = movementInputSchema.safeParse(row);
    if (!parsed.success) {
      results[index] = {
        id: rawId(row),
        status: 'invalid',
        reason: parsed.error.issues
          .map((i) => `${i.path.join('.') || '(row)'}: ${i.message}`)
          .join('; '),
      };
      return;
    }
    parsedRows.push({ index, input: parsed.data });
  });

  const userIds = [...new Set(parsedRows.map((r) => r.input.userId))];
  const knownUsers = new Set(
    userIds.length === 0
      ? []
      : (
          await deps.global.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true },
          })
        ).map((u) => u.id),
  );

  const valid: ValidRow[] = [];
  for (const { index, input } of parsedRows) {
    const reject = (reason: string) => {
      results[index] = { id: input.id, status: 'invalid', reason };
    };
    if (input.deviceId !== batch.deviceId) {
      reject('DEVICE_MISMATCH');
      continue;
    }
    if (!knownUsers.has(input.userId)) {
      reject('UNKNOWN_USER');
      continue;
    }
    const wh = assigned.get(input.warehouseId);
    if (!wh) {
      reject('WAREHOUSE_NOT_ASSIGNED');
      continue;
    }
    valid.push({ index, input, dbName: wh.tursoDbName });
  }

  for (const wh of assigned.values()) {
    const targeted = valid.some((v) => v.input.warehouseId === wh.id);
    if (targeted && wh.schemaVersion !== SCHEMA_VERSIONS.warehouse) {
      return { status: 'WAREHOUSE_NOT_READY', serverTime };
    }
  }

  valid.sort((a, b) => {
    const dt = a.input.occurredAt.getTime() - b.input.occurredAt.getTime();
    if (dt !== 0) return dt;
    return a.input.id < b.input.id ? -1 : a.input.id > b.input.id ? 1 : 0;
  });

  const exceptions: ExceptionDraft[] = [];
  const touched = new Set<string>(); // tursoDbName
  for (const row of valid) {
    const db = deps.warehouseDb(row.dbName);
    const outcome = await applyRow(deps, db, row.input);
    const id = row.input.id;
    if (outcome.kind === 'accepted') {
      touched.add(row.dbName);
      exceptions.push(...outcome.exceptions);
      results[row.index] = { id, status: 'accepted' };
    } else if (outcome.kind === 'duplicate') {
      touched.add(row.dbName);
      results[row.index] = { id, status: 'duplicate' };
    } else {
      results[row.index] = { id, status: 'invalid', reason: outcome.reason };
    }
  }

  const tursoNames = new Map<string, string>();
  for (const wh of assigned.values()) tursoNames.set(wh.id, wh.tursoDbName);

  for (const dbName of touched) {
    const db = deps.warehouseDb(dbName);
    const drafts = await detectForWarehouse(
      deps,
      db,
      batch.deviceId,
      batch.sentAt,
      now,
      tursoNames,
    );
    if (drafts.length > 0) {
      await withMovementTx(db, (tx) => persistExceptions(tx, drafts));
      exceptions.push(...drafts);
    }
  }

  return { status: 'ok', results, exceptions, serverTime };
}
