import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import { SESSION_COOKIE, verifySession } from '#/server/auth/session';
import { globalDb, warehouseDb } from '#/server/db/clients';
import { defaultDeps } from '#/server/sync/sync-movements.server';
import {
  exceptionFiltersSchema,
  handleListExceptions,
} from './exceptions.server';

const listExceptionsSchema = z.object({
  warehouseId: z.string().min(1),
  filters: exceptionFiltersSchema,
});

export const listExceptions = createServerFn({ method: 'GET' })
  .validator((d: unknown) => listExceptionsSchema.parse(d))
  .handler(async ({ data }) => {
    const token = getCookie(SESSION_COOKIE);
    const claims = token ? await verifySession(token) : null;
    return handleListExceptions(claims, data, {
      global: globalDb(),
      warehouseDb,
      now: () => new Date(),
      transferStuckHours: defaultDeps().transferStuckHours,
    });
  });
