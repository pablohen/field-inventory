import { z } from 'zod';
import type { ExceptionFilters } from '#/desk/exception-filters';
import { processMovement } from '#/domain/process';
import type { ExceptionType, Movement } from '#/domain/types';
import type { SessionClaims } from '#/server/auth/session';
import type {
  CatalogClient,
  GlobalClient,
  WarehouseClient,
} from '#/server/db/clients';
import { checkStuckTransfers } from '#/server/sync/stuck-transfers';
import {
  loadContext,
  persistEffects,
  withMovementTx,
} from '#/server/sync/warehouse-repo';
import { authorizeDesk, DESK_DEVICE_ID, type DeskSession } from './session';
import { assertWorker } from './users.server';
import { type DeskError, warehouseClientFor } from './warehouses.server';

export {
  EXCEPTION_TYPES,
  type ExceptionFilters,
  exceptionFiltersSchema,
} from '#/desk/exception-filters';

export type ExceptionRow = {
  id: string;
  type: ExceptionType;
  skuId: string | null;
  locationId: string | null;
  deviceId: string | null;
  userIds: string[];
  createdAt: string;
  ageHours: number;
  version: number;
  summary: string;
  /** Fields whose stored JSON was unreadable or the wrong shape. */
  malformed: ('details' | 'movementIds')[];
};

export type ListExceptionsDeps = {
  global: GlobalClient;
  warehouseDb(name: string): WarehouseClient;
  now(): Date;
  transferStuckHours: number;
};

export type ListExceptionsResult =
  | {
      ok: true;
      rows: ExceptionRow[];
      countsByType: Record<ExceptionType, number>;
    }
  | DeskError;

/** Signed number with a Unicode minus (U+2212) for negatives. */
function signed(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}
function minus(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : String(n);
}
/** A missing or non-numeric field renders as `?`, never as a fake 0. */
function num(v: unknown): number | '?' {
  return typeof v === 'number' && Number.isFinite(v) ? v : '?';
}
function fmtMinus(v: unknown): string {
  const n = num(v);
  return n === '?' ? n : minus(n);
}
function fmtSigned(v: unknown, scale = 1): string {
  const n = num(v);
  return n === '?' ? n : signed(Math.round(n / scale));
}

/** `d` is null when the stored details were unreadable. */
export function exceptionSummary(
  type: ExceptionType,
  d: Record<string, unknown> | null,
): string {
  if (d === null) return 'details unreadable';
  switch (type) {
    case 'COUNT_VARIANCE':
      return `observed ${num(d.observed)}, expected ${num(d.expected)} (${fmtMinus(d.variance)})`;
    case 'NEGATIVE_BALANCE':
      return `balance ${fmtMinus(d.after)}`;
    case 'LATE_MOVEMENT':
      return `late movement, correction ${fmtSigned(d.correction)}`;
    case 'OVER_PICK':
      return `picked ${num(d.pickedAfter)} of ${num(d.requested)}`;
    case 'TRANSFER_STUCK': {
      const h = num(d.ageHours);
      return `in transit ${h === '?' ? h : Math.round(h)} h`;
    }
    case 'CLOCK_SKEW':
      return `clock ${fmtSigned(d.skewMs, 1000)} s`;
  }
}

const detailsSchema = z.record(z.string(), z.unknown());
const movementIdsSchema = z.array(z.string());

function parseWith<T>(schema: z.ZodType<T>, s: string): T | null {
  try {
    const r = schema.safeParse(JSON.parse(s));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

type ExceptionRecord = {
  id: string;
  type: string;
  movementIds: string;
  skuId: string | null;
  locationId: string | null;
  deviceId: string | null;
  details: string;
  version: number;
  createdAt: Date;
};

type BuiltRow = {
  row: ExceptionRow;
  movementIds: string[];
  details: Record<string, unknown>;
};

/** Shared by list and detail so both build rows identically. */
async function buildExceptionRows(
  db: WarehouseClient,
  records: ExceptionRecord[],
  nowMs: number,
): Promise<BuiltRow[]> {
  const idsByException = new Map<string, string[] | null>(
    records.map((e) => [e.id, parseWith(movementIdsSchema, e.movementIds)]),
  );
  const allIds = [
    ...new Set([...idsByException.values()].flatMap((v) => v ?? [])),
  ];
  const movements =
    allIds.length > 0
      ? await db.movement.findMany({
          where: { id: { in: allIds } },
          select: { id: true, userId: true },
        })
      : [];
  const userByMovement = new Map(movements.map((m) => [m.id, m.userId]));
  return records.map((e) => {
    const parsedIds = idsByException.get(e.id) ?? null;
    const movementIds = parsedIds ?? [];
    const parsedDetails = parseWith(detailsSchema, e.details);
    const malformed: ExceptionRow['malformed'] = [];
    if (parsedDetails === null) malformed.push('details');
    if (parsedIds === null) malformed.push('movementIds');
    const userIds = [
      ...new Set(
        movementIds
          .map((id) => userByMovement.get(id))
          .filter((u): u is string => u !== undefined),
      ),
    ];
    return {
      movementIds,
      details: parsedDetails ?? {},
      row: {
        id: e.id,
        type: e.type as ExceptionType,
        skuId: e.skuId,
        locationId: e.locationId,
        deviceId: e.deviceId,
        userIds,
        createdAt: e.createdAt.toISOString(),
        ageHours:
          Math.round(((nowMs - e.createdAt.getTime()) / 3_600_000) * 10) / 10,
        version: e.version,
        summary: exceptionSummary(e.type as ExceptionType, parsedDetails),
        malformed,
      },
    };
  });
}

export async function listExceptionsCore(
  deps: ListExceptionsDeps,
  warehouseId: string,
  filters: ExceptionFilters,
): Promise<ListExceptionsResult> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  await checkStuckTransfers(deps, warehouseId);

  const open = await wh.db.exception.findMany({
    where: { status: 'OPEN' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  const countsByType: Record<ExceptionType, number> = {
    NEGATIVE_BALANCE: 0,
    COUNT_VARIANCE: 0,
    LATE_MOVEMENT: 0,
    OVER_PICK: 0,
    TRANSFER_STUCK: 0,
    CLOCK_SKEW: 0,
  };
  for (const e of open) {
    if (e.type in countsByType) countsByType[e.type as ExceptionType] += 1;
  }

  const built = await buildExceptionRows(wh.db, open, deps.now().getTime());
  const rows = built
    .map((b) => b.row)
    .filter((row) => {
      if (filters.type && row.type !== filters.type) return false;
      if (filters.skuId && row.skuId !== filters.skuId) return false;
      if (filters.locationId && row.locationId !== filters.locationId) {
        return false;
      }
      if (filters.userId && !row.userIds.includes(filters.userId)) return false;
      return !(
        filters.minAgeHours !== undefined && row.ageHours < filters.minAgeHours
      );
    });
  return { ok: true, rows, countsByType };
}

/** Authorized entry point; throws 401/403 Responses for non-desk callers. */
export async function handleListExceptions(
  claims: SessionClaims | null,
  input: { warehouseId: string; filters: ExceptionFilters },
  deps: ListExceptionsDeps,
): Promise<ListExceptionsResult> {
  await authorizeDesk(claims, deps.global);
  return listExceptionsCore(deps, input.warehouseId, input.filters);
}

export type TimelineMovement = {
  id: string;
  seq: number;
  type: string;
  skuId: string;
  fromLocationId: string | null;
  toLocationId: string | null;
  qty: number;
  reasonCode: string | null;
  userId: string;
  deviceId: string;
  source: string;
  occurredAt: string;
  receivedAt: string;
  involved: boolean;
};

/**
 * Wire type only: `details` is validated as a JSON object, but its values
 * are an unchecked cast to JsonValue (needed for server-fn serialization).
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ExceptionDetail = ExceptionRow & {
  status: string;
  details: Record<string, JsonValue>;
  resolution: string | null;
  note: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
};

export type ExceptionDetailResult =
  | {
      ok: true;
      exception: ExceptionDetail;
      byOccurredAt: TimelineMovement[];
      bySeq: TimelineMovement[];
      missingMovementIds: string[];
    }
  | DeskError;

export async function exceptionDetailCore(
  deps: ListExceptionsDeps,
  warehouseId: string,
  exceptionId: string,
): Promise<ExceptionDetailResult> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  const e = await wh.db.exception.findUnique({ where: { id: exceptionId } });
  if (!e)
    return { ok: false, code: 'NOT_FOUND', message: 'Exception not found' };

  // One record in, one row out.
  const built = (
    await buildExceptionRows(wh.db, [e], deps.now().getTime())
  )[0] as BuiltRow;

  const hasKey = e.skuId !== null && e.locationId !== null;
  const referenced = new Set(built.movementIds);
  const where = hasKey
    ? {
        OR: [
          {
            skuId: e.skuId as string,
            OR: [
              { toLocationId: e.locationId as string },
              { fromLocationId: e.locationId as string },
            ],
          },
          { id: { in: built.movementIds } },
        ],
      }
    : { id: { in: built.movementIds } };
  const rows =
    hasKey || built.movementIds.length > 0
      ? await wh.db.movement.findMany({ where, orderBy: { seq: 'asc' } })
      : [];
  const bySeq: TimelineMovement[] = rows.map((m) => ({
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
    involved: referenced.has(m.id),
  }));
  const byOccurredAt = [...bySeq].sort((a, b) =>
    a.occurredAt < b.occurredAt
      ? -1
      : a.occurredAt > b.occurredAt
        ? 1
        : a.seq - b.seq,
  );
  const found = new Set(rows.map((m) => m.id));
  return {
    ok: true,
    exception: {
      ...built.row,
      status: e.status,
      details: built.details as Record<string, JsonValue>,
      resolution: e.resolution,
      note: e.note,
      resolvedBy: e.resolvedBy,
      resolvedAt: e.resolvedAt ? e.resolvedAt.toISOString() : null,
    },
    byOccurredAt,
    bySeq,
    missingMovementIds: built.movementIds.filter((id) => !found.has(id)),
  };
}

/** Authorized entry point; throws 401/403 Responses for non-desk callers. */
export async function handleGetExceptionDetail(
  claims: SessionClaims | null,
  input: { warehouseId: string; exceptionId: string },
  deps: ListExceptionsDeps,
): Promise<ExceptionDetailResult> {
  await authorizeDesk(claims, deps.global);
  return exceptionDetailCore(deps, input.warehouseId, input.exceptionId);
}

const resolveBase = { version: z.number().int() };
export const resolveInputSchema = z.discriminatedUnion('action', [
  z.object({
    ...resolveBase,
    action: z.literal('accept'),
    note: z.string().optional(),
  }),
  z.object({
    ...resolveBase,
    action: z.literal('adjust'),
    qty: z
      .number()
      .int()
      .refine((n) => n !== 0, 'qty must not be 0'),
    reasonCode: z.string().min(1),
    locationId: z.string().min(1).optional(),
    skuId: z.string().min(1).optional(),
    note: z.string().optional(),
  }),
  z.object({
    ...resolveBase,
    action: z.literal('recount'),
    assignedUserId: z.string().min(1).optional(),
    note: z.string().optional(),
  }),
  z.object({
    ...resolveBase,
    action: z.literal('dismiss'),
    note: z.string().min(1),
  }),
]);
export type ResolveInput = z.infer<typeof resolveInputSchema>;

export type ResolveDeps = {
  global: GlobalClient;
  catalog: CatalogClient;
  warehouseDb(name: string): WarehouseClient;
  now(): Date;
  newId(): string;
  /** Test seam: runs after pre-transaction validation, before the transaction. */
  afterValidate?: () => Promise<void>;
};

export type ResolveResult =
  | {
      ok: true;
      exceptionId: string;
      version: number;
      adjustmentId?: string;
      countTaskId?: string;
    }
  | DeskError;

/** Thrown inside the transaction to roll it back with a typed result. */
class ResolveAbort extends Error {
  constructor(readonly error: DeskError) {
    super(error.message);
  }
}

const invalid = (message: string): DeskError => ({
  ok: false,
  code: 'INVALID',
  message,
});

const RESOLUTION = {
  accept: 'ACCEPTED',
  adjust: 'ADJUSTED',
  recount: 'RECOUNT_REQUESTED',
  dismiss: 'DISMISSED',
} as const;

export async function resolveExceptionCore(
  deps: ResolveDeps,
  session: DeskSession,
  warehouseId: string,
  exceptionId: string,
  input: ResolveInput,
): Promise<ResolveResult> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  const db = wh.db;

  // Validation that can fail happens before the transaction, so an INVALID
  // never touches the exception. An exception's sku/location never change.
  const existing = await db.exception.findUnique({
    where: { id: exceptionId },
    select: { skuId: true, locationId: true },
  });
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Exception not found' };
  }

  let skuId: string | null = null;
  let locationId: string | null = null;
  if (input.action === 'adjust') {
    skuId = input.skuId ?? existing.skuId;
    locationId = input.locationId ?? existing.locationId;
    if (skuId === null || locationId === null) {
      return invalid('Exception has no sku/location; provide them');
    }
    const reason = await deps.catalog.reasonCode.findUnique({
      where: { code: input.reasonCode },
    });
    let applies: unknown = [];
    try {
      applies = JSON.parse(reason?.appliesTo ?? '[]');
    } catch {
      applies = [];
    }
    if (!reason || !Array.isArray(applies) || !applies.includes('ADJUST')) {
      return invalid('Unknown reason code for ADJUST');
    }
    const sku = await deps.catalog.product.findUnique({
      where: { id: skuId },
      select: { id: true },
    });
    if (!sku) return invalid('Unknown sku');
    const loc = await db.location.findUnique({ where: { id: locationId } });
    if (!loc?.active) return invalid('Unknown or inactive location');
  } else if (input.action === 'recount') {
    skuId = existing.skuId;
    locationId = existing.locationId;
    if (locationId === null) return invalid('Exception has no location');
    if (input.assignedUserId !== undefined) {
      const err = await assertWorker(deps.global, input.assignedUserId);
      if (err) return err;
    }
  }

  await deps.afterValidate?.();

  const now = deps.now();
  const run = () =>
    withMovementTx(db, async (tx) => {
      // The version guard is the first write in the transaction.
      const guard = await tx.exception.updateMany({
        where: { id: exceptionId, version: input.version, status: 'OPEN' },
        data: {
          status: 'RESOLVED',
          version: { increment: 1 },
          resolution: RESOLUTION[input.action],
          resolvedBy: session.userId,
          resolvedAt: now,
          note: input.note ?? null,
        },
      });
      if (guard.count === 0) {
        const found = await tx.exception.findUnique({
          where: { id: exceptionId },
          select: { id: true },
        });
        throw new ResolveAbort(
          found
            ? {
                ok: false,
                code: 'CONFLICT',
                message: 'Resolved by someone else',
              }
            : {
                ok: false,
                code: 'NOT_FOUND',
                message: 'Exception not found',
              },
        );
      }
      // Re-check the target location inside the transaction, after the
      // version guard so an already-resolved exception still reports CONFLICT.
      if (
        (input.action === 'adjust' || input.action === 'recount') &&
        locationId
      ) {
        const loc = await tx.location.findUnique({
          where: { id: locationId },
          select: { code: true, active: true },
        });
        if (!loc?.active) {
          throw new ResolveAbort(
            invalid(`Location ${loc?.code ?? locationId} is inactive`),
          );
        }
      }
      const out = {
        ok: true as const,
        exceptionId,
        version: input.version + 1,
        adjustmentId: undefined as string | undefined,
        countTaskId: undefined as string | undefined,
      };
      if (input.action === 'adjust' && skuId && locationId) {
        const m: Movement = {
          id: deps.newId(),
          type: 'ADJUST',
          skuId,
          fromLocationId: null,
          toLocationId: locationId,
          qty: input.qty,
          reasonCode: input.reasonCode,
          ref: null,
          counterpartWarehouseId: null,
          userId: session.userId,
          deviceId: DESK_DEVICE_ID,
          occurredAt: now,
          source: 'supervisor',
        };
        const ctx = await loadContext(tx, deps.catalog, m);
        await persistEffects(tx, processMovement(m, ctx, deps.newId));
        out.adjustmentId = m.id;
      } else if (input.action === 'recount' && locationId) {
        const id = deps.newId();
        await tx.countTask.create({
          data: {
            id,
            scope: JSON.stringify({
              locations: [locationId],
              skus: skuId ? [skuId] : [],
            }),
            assignedUserId: input.assignedUserId ?? null,
            status: 'OPEN',
          },
        });
        out.countTaskId = id;
      }
      const { adjustmentId, countTaskId, ...rest } = out;
      return {
        ...rest,
        ...(adjustmentId ? { adjustmentId } : {}),
        ...(countTaskId ? { countTaskId } : {}),
      } as ResolveResult;
    });

  try {
    return await run();
  } catch (err) {
    if (err instanceof ResolveAbort) return err.error;
    throw err;
  }
}

/** Authorized entry point; throws 401/403 Responses for non-desk callers. */
export async function handleResolveException(
  claims: SessionClaims | null,
  input: { warehouseId: string; exceptionId: string; input: ResolveInput },
  deps: ResolveDeps,
): Promise<ResolveResult> {
  const session = await authorizeDesk(claims, deps.global);
  return resolveExceptionCore(
    deps,
    session,
    input.warehouseId,
    input.exceptionId,
    input.input,
  );
}
