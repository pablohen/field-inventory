import { createServerFn } from '@tanstack/react-start';
import {
  createWarehouseInputSchema,
  renameWarehouseInputSchema,
  warehouseIdInputSchema,
} from '#/admin/warehouse-input';
import { globalDb } from '#/server/db/clients';
import { readDeskClaims } from '#/server/desk/session';
import {
  defaultProvisionDeps,
  handleCreateWarehouse,
  handleFinishWarehouseSetup,
  handleListWarehousesAdmin,
  handleRenameWarehouse,
} from './warehouses.server';

export const listWarehousesAdmin = createServerFn({ method: 'GET' }).handler(
  async () =>
    handleListWarehousesAdmin(await readDeskClaims(), { global: globalDb() }),
);

export const createWarehouse = createServerFn({ method: 'POST' })
  .validator((d: unknown) => createWarehouseInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleCreateWarehouse(
      await readDeskClaims(),
      data,
      defaultProvisionDeps(globalDb()),
    ),
  );

export const finishWarehouseSetup = createServerFn({ method: 'POST' })
  .validator((d: unknown) => warehouseIdInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleFinishWarehouseSetup(
      await readDeskClaims(),
      data,
      defaultProvisionDeps(globalDb()),
    ),
  );

export const renameWarehouse = createServerFn({ method: 'POST' })
  .validator((d: unknown) => renameWarehouseInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleRenameWarehouse(await readDeskClaims(), data, {
      global: globalDb(),
    }),
  );
