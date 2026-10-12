import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { catalogDb, globalDb, warehouseDb } from '#/server/db/clients';
import { readDeskClaims } from './session';
import {
  handleGetLedger,
  handleGetStock,
  stockFiltersSchema,
} from './stock.server';

const stockDeps = () => ({
  global: globalDb(),
  catalog: catalogDb(),
  warehouseDb,
});

const getStockSchema = z.object({
  warehouseId: z.string().min(1),
  filters: stockFiltersSchema,
});

export const getStock = createServerFn({ method: 'GET' })
  .validator((d: unknown) => getStockSchema.parse(d))
  .handler(async ({ data }) => {
    return handleGetStock(await readDeskClaims(), data, stockDeps());
  });

const getLedgerSchema = z.object({
  warehouseId: z.string().min(1),
  key: z.object({ skuId: z.string().min(1), locationId: z.string().min(1) }),
});

export const getLedger = createServerFn({ method: 'GET' })
  .validator((d: unknown) => getLedgerSchema.parse(d))
  .handler(async ({ data }) => {
    return handleGetLedger(await readDeskClaims(), data, stockDeps());
  });
