import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { catalogDb, globalDb, warehouseDb } from '#/server/db/clients';
import { defaultDeps } from '#/server/sync/sync-movements.server';
import {
  exceptionFiltersSchema,
  handleGetExceptionDetail,
  handleListExceptions,
  handleResolveException,
  resolveInputSchema,
} from './exceptions.server';
import { readDeskClaims } from './session';

const listExceptionsSchema = z.object({
  warehouseId: z.string().min(1),
  filters: exceptionFiltersSchema,
});

const deskDeps = () => ({
  global: globalDb(),
  warehouseDb,
  now: () => new Date(),
  transferStuckHours: defaultDeps().transferStuckHours,
});

export const listExceptions = createServerFn({ method: 'GET' })
  .validator((d: unknown) => listExceptionsSchema.parse(d))
  .handler(async ({ data }) => {
    return handleListExceptions(await readDeskClaims(), data, deskDeps());
  });

const detailSchema = z.object({
  warehouseId: z.string().min(1),
  exceptionId: z.string().min(1),
});

export const getExceptionDetail = createServerFn({ method: 'GET' })
  .validator((d: unknown) => detailSchema.parse(d))
  .handler(async ({ data }) => {
    return handleGetExceptionDetail(await readDeskClaims(), data, deskDeps());
  });

const resolveSchema = z.object({
  warehouseId: z.string().min(1),
  exceptionId: z.string().min(1),
  input: resolveInputSchema,
});

export const resolveException = createServerFn({ method: 'POST' })
  .validator((d: unknown) => resolveSchema.parse(d))
  .handler(async ({ data }) => {
    return handleResolveException(await readDeskClaims(), data, {
      global: globalDb(),
      catalog: catalogDb(),
      warehouseDb,
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
    });
  });
