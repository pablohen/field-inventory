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
    select: { role: true },
  });
  if (user?.role !== 'worker') {
    return { ok: false, code: 'INVALID', message: 'Assignee must be a worker' };
  }
  return null;
}

/** Users with role `worker`, ordered by name (then id for stability). */
export async function listWorkersCore(
  global: GlobalClient,
): Promise<{ id: string; name: string }[]> {
  return global.user.findMany({
    where: { role: 'worker' },
    select: { id: true, name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
}

export async function handleListWorkers(
  claims: SessionClaims | null,
  deps: { global: GlobalClient },
): Promise<{ id: string; name: string }[]> {
  authorizeDesk(claims);
  return listWorkersCore(deps.global);
}
