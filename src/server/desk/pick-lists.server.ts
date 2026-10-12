import { z } from 'zod';
import type { SessionClaims } from '#/server/auth/session';
import type {
  CatalogClient,
  GlobalClient,
  WarehouseClient,
} from '#/server/db/clients';
import { authorizeDesk, type DeskSession } from './session';
import { assertWorker } from './users.server';
import { type DeskError, warehouseClientFor } from './warehouses.server';

export type PickListDeps = {
  global: GlobalClient;
  catalog: CatalogClient;
  warehouseDb(name: string): WarehouseClient;
  newId(): string;
};

type Balance = { skuId: string; locationId: string; qty: number };
type Suggestion = { skuId: string; locationId: string | null; qty: number };
type Shortfall = { skuId: string; missing: number };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Greedy bin suggestion. Per request: positive bins by qty desc (ties by
 * locationId), never more than a bin holds; any remainder is a shortfall.
 */
export function suggestBins(
  requests: { skuId: string; qty: number }[],
  balances: Balance[],
): { lines: Suggestion[]; shortfalls: Shortfall[] } {
  const lines: Suggestion[] = [];
  const shortfalls: Shortfall[] = [];
  // Remaining capacity per bin, shared across requests so a SKU requested
  // twice never allocates the same stock twice.
  const capacity = balances.filter((b) => b.qty > 0).map((b) => ({ ...b }));
  for (const req of requests) {
    if (req.qty <= 0) continue;
    const bins = capacity
      .filter((b) => b.skuId === req.skuId && b.qty > 0)
      .sort((a, b) => b.qty - a.qty || cmp(a.locationId, b.locationId));
    let remaining = req.qty;
    let allocated = 0;
    for (const bin of bins) {
      if (remaining <= 0) break;
      const take = Math.min(bin.qty, remaining);
      lines.push({ skuId: req.skuId, locationId: bin.locationId, qty: take });
      bin.qty -= take;
      remaining -= take;
      allocated += take;
    }
    if (allocated === 0) {
      lines.push({ skuId: req.skuId, locationId: null, qty: req.qty });
    }
    if (remaining > 0)
      shortfalls.push({ skuId: req.skuId, missing: remaining });
  }
  return { lines, shortfalls };
}

export const suggestPickListInputSchema = z.object({
  requests: z
    .array(
      z.object({
        skuId: z.string().min(1),
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
});
export type SuggestPickListInput = z.infer<typeof suggestPickListInputSchema>;

export const createPickListInputSchema = z.object({
  lines: z
    .array(
      z.object({
        skuId: z.string().min(1),
        locationId: z.string().min(1),
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
  assignedUserId: z.string().optional(),
});
export type CreatePickListInput = z.infer<typeof createPickListInputSchema>;

export type SuggestResult =
  | { ok: true; lines: Suggestion[]; shortfalls: Shortfall[] }
  | DeskError;

export async function suggestPickListCore(
  deps: PickListDeps,
  warehouseId: string,
  requests: { skuId: string; qty: number }[],
): Promise<SuggestResult> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  const skuIds = [...new Set(requests.map((r) => r.skuId))];
  const known = await deps.catalog.product.findMany({
    where: { id: { in: skuIds } },
    select: { id: true },
  });
  const knownIds = new Set(known.map((p) => p.id));
  const unknown = skuIds.find((id) => !knownIds.has(id));
  if (unknown !== undefined) {
    return { ok: false, code: 'INVALID', message: `Unknown SKU ${unknown}` };
  }
  const balances = await wh.db.stockBalance.findMany({
    where: { skuId: { in: skuIds }, qty: { gt: 0 } },
  });
  return { ok: true, ...suggestBins(requests, balances) };
}

export type CreatePickListResult = { ok: true; id: string } | DeskError;

export async function createPickListCore(
  deps: PickListDeps,
  session: DeskSession,
  warehouseId: string,
  input: CreatePickListInput,
): Promise<CreatePickListResult> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;

  const locationIds = [...new Set(input.lines.map((l) => l.locationId))];
  const skuIds = [...new Set(input.lines.map((l) => l.skuId))];
  const [locations, products] = await Promise.all([
    wh.db.location.findMany({
      where: { id: { in: locationIds } },
      select: { id: true, active: true },
    }),
    deps.catalog.product.findMany({
      where: { id: { in: skuIds } },
      select: { id: true },
    }),
  ]);
  const activeById = new Map(locations.map((l) => [l.id, l.active]));
  const skuSet = new Set(products.map((p) => p.id));
  for (const [i, line] of input.lines.entries()) {
    const n = i + 1;
    if (!skuSet.has(line.skuId)) {
      return {
        ok: false,
        code: 'INVALID',
        message: `Line ${n}: unknown SKU ${line.skuId}`,
      };
    }
    const active = activeById.get(line.locationId);
    if (active === undefined) {
      return {
        ok: false,
        code: 'INVALID',
        message: `Line ${n}: unknown location ${line.locationId}`,
      };
    }
    if (!active) {
      return {
        ok: false,
        code: 'INVALID',
        message: `Line ${n}: location ${line.locationId} is inactive`,
      };
    }
  }
  if (input.assignedUserId) {
    const err = await assertWorker(deps.global, input.assignedUserId);
    if (err) return err;
  }

  const id = deps.newId();
  await wh.db.$transaction(async (tx) => {
    await tx.pickList.create({
      data: {
        id,
        status: 'OPEN',
        createdBy: session.userId,
        assignedUserId: input.assignedUserId ?? null,
      },
    });
    for (const line of input.lines) {
      await tx.pickLine.create({
        data: {
          id: deps.newId(),
          pickListId: id,
          skuId: line.skuId,
          locationId: line.locationId,
          qtyRequested: line.qty,
        },
      });
    }
  });
  return { ok: true, id };
}

export const listPickListsInputSchema = z.object({
  status: z.enum(['OPEN', 'DONE']).optional(),
});
export type ListPickListsInput = z.infer<typeof listPickListsInputSchema>;

export type PickListRow = {
  id: string;
  status: string;
  createdBy: string;
  createdAt: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  lines: {
    id: string;
    skuId: string;
    locationId: string;
    qtyRequested: number;
    pickedQty: number;
  }[];
};

export type ListPickListsResult =
  | { ok: true; lists: PickListRow[] }
  | DeskError;

export async function listPickListsCore(
  deps: PickListDeps,
  warehouseId: string,
  filters: ListPickListsInput,
): Promise<ListPickListsResult> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  const lists = await wh.db.pickList.findMany({
    where: filters.status ? { status: filters.status } : {},
    include: { lines: { orderBy: { id: 'asc' } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  const lineIds = lists.flatMap((l) => l.lines.map((x) => x.id));
  const picks =
    lineIds.length > 0
      ? await wh.db.movement.groupBy({
          by: ['ref'],
          where: { type: 'PICK', ref: { in: lineIds } },
          _sum: { qty: true },
        })
      : [];
  const picked = new Map(picks.map((p) => [p.ref, p._sum.qty ?? 0]));
  const userIds = [
    ...new Set(
      lists.map((l) => l.assignedUserId).filter((u): u is string => !!u),
    ),
  ];
  const users =
    userIds.length > 0
      ? await deps.global.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return {
    ok: true,
    lists: lists.map((l) => ({
      id: l.id,
      status: l.status,
      createdBy: l.createdBy,
      createdAt: l.createdAt.toISOString(),
      assignedUserId: l.assignedUserId,
      assignedUserName: l.assignedUserId
        ? (nameById.get(l.assignedUserId) ?? null)
        : null,
      lines: l.lines.map((x) => ({
        id: x.id,
        skuId: x.skuId,
        locationId: x.locationId,
        qtyRequested: x.qtyRequested,
        pickedQty: picked.get(x.id) ?? 0,
      })),
    })),
  };
}

export const assignPickListInputSchema = z.object({
  pickListId: z.string().min(1),
  assignedUserId: z.string().min(1).nullable(),
});
export type AssignPickListInput = z.infer<typeof assignPickListInputSchema>;

export const closePickListInputSchema = z.object({
  pickListId: z.string().min(1),
});
export type ClosePickListInput = z.infer<typeof closePickListInputSchema>;

export type PickListOk = { ok: true } | DeskError;

const NO_LIST: DeskError = {
  ok: false,
  code: 'NOT_FOUND',
  message: 'Pick list not found',
};

export async function assignPickListCore(
  deps: PickListDeps,
  warehouseId: string,
  pickListId: string,
  assignedUserId: string | null,
): Promise<PickListOk> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  const list = await wh.db.pickList.findUnique({ where: { id: pickListId } });
  if (!list) return NO_LIST;
  if (list.status === 'DONE') {
    return { ok: false, code: 'INVALID', message: 'Pick list is closed' };
  }
  if (assignedUserId !== null) {
    const err = await assertWorker(deps.global, assignedUserId);
    if (err) return err;
  }
  await wh.db.pickList.update({
    where: { id: pickListId },
    data: { assignedUserId },
  });
  return { ok: true };
}

export async function closePickListCore(
  deps: PickListDeps,
  warehouseId: string,
  pickListId: string,
): Promise<PickListOk> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  const list = await wh.db.pickList.findUnique({ where: { id: pickListId } });
  if (!list) return NO_LIST;
  if (list.status !== 'DONE') {
    await wh.db.pickList.update({
      where: { id: pickListId },
      data: { status: 'DONE' },
    });
  }
  return { ok: true };
}

export async function handleSuggestPickList(
  claims: SessionClaims | null,
  input: { warehouseId: string } & SuggestPickListInput,
  deps: PickListDeps,
): Promise<SuggestResult> {
  await authorizeDesk(claims, deps.global);
  return suggestPickListCore(deps, input.warehouseId, input.requests);
}

export async function handleCreatePickList(
  claims: SessionClaims | null,
  input: { warehouseId: string } & CreatePickListInput,
  deps: PickListDeps,
): Promise<CreatePickListResult> {
  const session = await authorizeDesk(claims, deps.global);
  const { warehouseId, ...rest } = input;
  return createPickListCore(deps, session, warehouseId, rest);
}

export async function handleListPickLists(
  claims: SessionClaims | null,
  input: { warehouseId: string } & ListPickListsInput,
  deps: PickListDeps,
): Promise<ListPickListsResult> {
  await authorizeDesk(claims, deps.global);
  return listPickListsCore(deps, input.warehouseId, { status: input.status });
}

export async function handleAssignPickList(
  claims: SessionClaims | null,
  input: { warehouseId: string } & AssignPickListInput,
  deps: PickListDeps,
): Promise<PickListOk> {
  await authorizeDesk(claims, deps.global);
  return assignPickListCore(
    deps,
    input.warehouseId,
    input.pickListId,
    input.assignedUserId,
  );
}

export async function handleClosePickList(
  claims: SessionClaims | null,
  input: { warehouseId: string } & ClosePickListInput,
  deps: PickListDeps,
): Promise<PickListOk> {
  await authorizeDesk(claims, deps.global);
  return closePickListCore(deps, input.warehouseId, input.pickListId);
}
