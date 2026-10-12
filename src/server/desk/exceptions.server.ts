import { z } from 'zod';
import type { ExceptionType } from '#/domain/types';
import type { SessionClaims } from '#/server/auth/session';
import type { GlobalClient, WarehouseClient } from '#/server/db/clients';
import { checkStuckTransfers } from '#/server/sync/stuck-transfers';
import { authorizeDesk } from './session';
import { type DeskError, warehouseClientFor } from './warehouses.server';

export const EXCEPTION_TYPES = [
  'NEGATIVE_BALANCE',
  'COUNT_VARIANCE',
  'LATE_MOVEMENT',
  'OVER_PICK',
  'TRANSFER_STUCK',
  'CLOCK_SKEW',
] as const satisfies readonly ExceptionType[];

export const exceptionFiltersSchema = z.object({
  type: z.enum(EXCEPTION_TYPES).optional(),
  skuId: z.string().optional(),
  locationId: z.string().optional(),
  userId: z.string().optional(),
  minAgeHours: z.coerce.number().nonnegative().optional(),
});
export type ExceptionFilters = z.infer<typeof exceptionFiltersSchema>;

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
function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

export function exceptionSummary(
  type: ExceptionType,
  d: Record<string, unknown>,
): string {
  switch (type) {
    case 'COUNT_VARIANCE':
      return `observed ${num(d.observed)}, expected ${num(d.expected)} (${minus(num(d.variance))})`;
    case 'NEGATIVE_BALANCE':
      return `balance ${minus(num(d.after))}`;
    case 'LATE_MOVEMENT':
      return `late movement, correction ${signed(num(d.correction))}`;
    case 'OVER_PICK':
      return `picked ${num(d.pickedAfter)} of ${num(d.requested)}`;
    case 'TRANSFER_STUCK':
      return `in transit ${Math.round(num(d.ageHours))} h`;
    case 'CLOCK_SKEW':
      return `clock ${signed(Math.round(num(d.skewMs) / 1000))} s`;
  }
}

function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
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

/** Shared by list and detail so both build rows identically. */
async function buildExceptionRows(
  db: WarehouseClient,
  records: ExceptionRecord[],
  nowMs: number,
): Promise<{ row: ExceptionRow; movementIds: string[] }[]> {
  const idsByException = new Map<string, string[]>(
    records.map((e) => [e.id, parseJson<string[]>(e.movementIds, [])]),
  );
  const allIds = [...new Set([...idsByException.values()].flat())];
  const movements =
    allIds.length > 0
      ? await db.movement.findMany({
          where: { id: { in: allIds } },
          select: { id: true, userId: true },
        })
      : [];
  const userByMovement = new Map(movements.map((m) => [m.id, m.userId]));
  return records.map((e) => {
    const movementIds = idsByException.get(e.id) ?? [];
    const userIds = [
      ...new Set(
        movementIds
          .map((id) => userByMovement.get(id))
          .filter((u): u is string => u !== undefined),
      ),
    ];
    return {
      movementIds,
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
        summary: exceptionSummary(
          e.type as ExceptionType,
          parseJson<Record<string, unknown>>(e.details, {}),
        ),
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
  authorizeDesk(claims);
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

  const [built] = await buildExceptionRows(wh.db, [e], deps.now().getTime());
  if (!built)
    return { ok: false, code: 'NOT_FOUND', message: 'Exception not found' };

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
      details: parseJson<Record<string, JsonValue>>(e.details, {}),
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
  authorizeDesk(claims);
  return exceptionDetailCore(deps, input.warehouseId, input.exceptionId);
}
