import type { GlobalClient } from '#/server/db/clients';
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
