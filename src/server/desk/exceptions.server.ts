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

  const movementIds = new Map<string, string[]>(
    open.map((e) => [e.id, parseJson<string[]>(e.movementIds, [])]),
  );
  const allIds = [...new Set([...movementIds.values()].flat())];
  const movements =
    allIds.length > 0
      ? await wh.db.movement.findMany({
          where: { id: { in: allIds } },
          select: { id: true, userId: true },
        })
      : [];
  const userByMovement = new Map(movements.map((m) => [m.id, m.userId]));

  const nowMs = deps.now().getTime();
  const rows: ExceptionRow[] = [];
  for (const e of open) {
    const userIds = [
      ...new Set(
        (movementIds.get(e.id) ?? [])
          .map((id) => userByMovement.get(id))
          .filter((u): u is string => u !== undefined),
      ),
    ];
    const ageHours =
      Math.round(((nowMs - e.createdAt.getTime()) / 3_600_000) * 10) / 10;
    if (filters.type && e.type !== filters.type) continue;
    if (filters.skuId && e.skuId !== filters.skuId) continue;
    if (filters.locationId && e.locationId !== filters.locationId) continue;
    if (filters.userId && !userIds.includes(filters.userId)) continue;
    if (filters.minAgeHours !== undefined && ageHours < filters.minAgeHours) {
      continue;
    }
    rows.push({
      id: e.id,
      type: e.type as ExceptionType,
      skuId: e.skuId,
      locationId: e.locationId,
      deviceId: e.deviceId,
      userIds,
      createdAt: e.createdAt.toISOString(),
      ageHours,
      version: e.version,
      summary: exceptionSummary(
        e.type as ExceptionType,
        parseJson<Record<string, unknown>>(e.details, {}),
      ),
    });
  }
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
