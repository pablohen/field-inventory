import type { SessionClaims } from '#/server/auth/session';
import type { GlobalClient } from '#/server/db/clients';
import { authorizeDesk } from './session';
import type { DeskError } from './warehouses.server';

/** Null when `userId` is an existing worker, else an `INVALID` DeskError. */
export async function assertWorker(
  global: GlobalClient,
  userId: string,
): Promise<DeskError | null> {
  const user = await global.user.findUnique({
    where: { id: userId },
    select: { role: true, disabledAt: true },
  });
  if (user?.role !== 'worker' || user.disabledAt !== null) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Assignee must be an active worker',
    };
  }
  return null;
}

/** Users with role `worker`, ordered by name (then id for stability). */
export async function listWorkersCore(
  global: GlobalClient,
): Promise<{ id: string; name: string }[]> {
  return global.user.findMany({
    where: { role: 'worker', disabledAt: null },
    select: { id: true, name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
}

export async function handleListWorkers(
  claims: SessionClaims | null,
  deps: { global: GlobalClient },
): Promise<{ id: string; name: string }[]> {
  await authorizeDesk(claims, deps.global);
  return listWorkersCore(deps.global);
}
