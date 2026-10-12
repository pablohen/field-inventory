import { z } from 'zod';
import { countScopeSchema } from '#/desk/count-scope';
import type { SessionClaims } from '#/server/auth/session';
import type {
  CatalogClient,
  GlobalClient,
  WarehouseClient,
} from '#/server/db/clients';
import { authorizeDesk } from './session';
import { assertWorker } from './users.server';
import { type DeskError, warehouseClientFor } from './warehouses.server';

export type CountTaskDeps = {
  global: GlobalClient;
  catalog: CatalogClient;
  warehouseDb(name: string): WarehouseClient;
  newId(): string;
};

export { type CountScope, countScopeSchema } from '#/desk/count-scope';

export const createCountTaskInputSchema = z.object({
  scope: countScopeSchema,
  assignedUserId: z.string().min(1).optional(),
});
export type CreateCountTaskInput = z.infer<typeof createCountTaskInputSchema>;

export type CreateCountTaskResult = { ok: true; id: string } | DeskError;

const invalid = (message: string): DeskError => ({
  ok: false,
  code: 'INVALID',
  message,
});

export async function createCountTaskCore(
  deps: CountTaskDeps,
  warehouseId: string,
  input: CreateCountTaskInput,
): Promise<CreateCountTaskResult> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  const scope = input.scope;
  // Counting only reads stock, so inactive locations are allowed, including a
  // zone made up solely of inactive locations.

  if ('locations' in scope) {
    const ids = [...new Set(scope.locations)];
    const found = await wh.db.location.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const have = new Set(found.map((l) => l.id));
    const missing = ids.find((id) => !have.has(id));
    if (missing !== undefined) return invalid(`Unknown location ${missing}`);
  } else if ('zone' in scope) {
    const n = await wh.db.location.count({ where: { zone: scope.zone } });
    if (n === 0) return invalid(`Zone ${scope.zone} has no locations`);
  } else {
    const ids = [...new Set(scope.skus)];
    const found = await deps.catalog.product.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const have = new Set(found.map((p) => p.id));
    const missing = ids.find((id) => !have.has(id));
    if (missing !== undefined) return invalid(`Unknown SKU ${missing}`);
  }
  if (input.assignedUserId) {
    const err = await assertWorker(deps.global, input.assignedUserId);
    if (err) return err;
  }

  const id = deps.newId();
  await wh.db.countTask.create({
    data: {
      id,
      scope: JSON.stringify(scope),
      assignedUserId: input.assignedUserId ?? null,
      status: 'OPEN',
    },
  });
  return { ok: true, id };
}

export const listCountTasksInputSchema = z.object({
  status: z.enum(['OPEN', 'DONE']).optional(),
});
export type ListCountTasksInput = z.infer<typeof listCountTasksInputSchema>;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type CountTaskRow = {
  id: string;
  status: string;
  /** Parsed scope JSON; null when the stored JSON is malformed. */
  scope: JsonValue;
  malformed?: true;
  assignedUserId: string | null;
  assignedUserName: string | null;
  countsRecorded: number;
};

export type ListCountTasksResult =
  | { ok: true; tasks: CountTaskRow[] }
  | DeskError;

/**
 * CountTask has no createdAt, so there is no chronological order. Rows are
 * ordered OPEN before DONE (`status` desc), then by id for stability.
 */
export async function listCountTasksCore(
  deps: CountTaskDeps,
  warehouseId: string,
  filters: ListCountTasksInput,
): Promise<ListCountTasksResult> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  const tasks = await wh.db.countTask.findMany({
    where: filters.status ? { status: filters.status } : {},
    orderBy: [{ status: 'desc' }, { id: 'asc' }],
  });
  const ids = tasks.map((t) => t.id);
  const counts =
    ids.length > 0
      ? await wh.db.movement.groupBy({
          by: ['ref'],
          where: { type: 'COUNT', ref: { in: ids } },
          _count: { _all: true },
        })
      : [];
  const recorded = new Map(counts.map((c) => [c.ref, c._count._all]));
  const userIds = [
    ...new Set(
      tasks.map((t) => t.assignedUserId).filter((u): u is string => !!u),
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
    tasks: tasks.map((t) => {
      let scope: JsonValue = null;
      let malformed = false;
      try {
        scope = JSON.parse(t.scope) as JsonValue;
      } catch {
        malformed = true;
      }
      return {
        id: t.id,
        status: t.status,
        scope,
        ...(malformed ? { malformed: true as const } : {}),
        assignedUserId: t.assignedUserId,
        assignedUserName: t.assignedUserId
          ? (nameById.get(t.assignedUserId) ?? null)
          : null,
        countsRecorded: recorded.get(t.id) ?? 0,
      };
    }),
  };
}

export const assignCountTaskInputSchema = z.object({
  taskId: z.string().min(1),
  assignedUserId: z.string().min(1).nullable(),
});
export type AssignCountTaskInput = z.infer<typeof assignCountTaskInputSchema>;

export const closeCountTaskInputSchema = z.object({
  taskId: z.string().min(1),
});
export type CloseCountTaskInput = z.infer<typeof closeCountTaskInputSchema>;

export type CountTaskOk = { ok: true } | DeskError;

const NO_TASK: DeskError = {
  ok: false,
  code: 'NOT_FOUND',
  message: 'Count task not found',
};

export async function assignCountTaskCore(
  deps: CountTaskDeps,
  warehouseId: string,
  taskId: string,
  assignedUserId: string | null,
): Promise<CountTaskOk> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  const task = await wh.db.countTask.findUnique({ where: { id: taskId } });
  if (!task) return NO_TASK;
  if (task.status === 'DONE') return invalid('Count task is closed');
  if (assignedUserId !== null) {
    const err = await assertWorker(deps.global, assignedUserId);
    if (err) return err;
  }
  await wh.db.countTask.update({
    where: { id: taskId },
    data: { assignedUserId },
  });
  return { ok: true };
}

export async function closeCountTaskCore(
  deps: CountTaskDeps,
  warehouseId: string,
  taskId: string,
): Promise<CountTaskOk> {
  const wh = await warehouseClientFor(deps, warehouseId);
  if (!wh.ok) return wh;
  const task = await wh.db.countTask.findUnique({ where: { id: taskId } });
  if (!task) return NO_TASK;
  if (task.status !== 'DONE') {
    await wh.db.countTask.update({
      where: { id: taskId },
      data: { status: 'DONE' },
    });
  }
  return { ok: true };
}

export async function handleCreateCountTask(
  claims: SessionClaims | null,
  input: { warehouseId: string } & CreateCountTaskInput,
  deps: CountTaskDeps,
): Promise<CreateCountTaskResult> {
  await authorizeDesk(claims, deps.global);
  const { warehouseId, ...rest } = input;
  return createCountTaskCore(deps, warehouseId, rest);
}

export async function handleListCountTasks(
  claims: SessionClaims | null,
  input: { warehouseId: string } & ListCountTasksInput,
  deps: CountTaskDeps,
): Promise<ListCountTasksResult> {
  await authorizeDesk(claims, deps.global);
  return listCountTasksCore(deps, input.warehouseId, { status: input.status });
}

export async function handleAssignCountTask(
  claims: SessionClaims | null,
  input: { warehouseId: string } & AssignCountTaskInput,
  deps: CountTaskDeps,
): Promise<CountTaskOk> {
  await authorizeDesk(claims, deps.global);
  return assignCountTaskCore(
    deps,
    input.warehouseId,
    input.taskId,
    input.assignedUserId,
  );
}

export async function handleCloseCountTask(
  claims: SessionClaims | null,
  input: { warehouseId: string } & CloseCountTaskInput,
  deps: CountTaskDeps,
): Promise<CountTaskOk> {
  await authorizeDesk(claims, deps.global);
  return closeCountTaskCore(deps, input.warehouseId, input.taskId);
}
