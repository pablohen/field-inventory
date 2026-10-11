import { createServerFn } from '@tanstack/react-start';
import { requireSession } from '#/server/auth/session';
import {
  defaultDeps,
  handleSync,
  type WireSyncResponse,
} from './sync-movements.server';

export const syncMovements = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    const session = await requireSession();
    return handleSync(
      defaultDeps(),
      data,
      session,
    ) as Promise<WireSyncResponse>;
  });
