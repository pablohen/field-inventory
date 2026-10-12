import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { catalogDb, globalDb, warehouseDb } from '#/server/db/clients';
import {
  assignCountTaskInputSchema,
  closeCountTaskInputSchema,
  createCountTaskInputSchema,
  handleAssignCountTask,
  handleCloseCountTask,
  handleCreateCountTask,
  handleListCountTasks,
  listCountTasksInputSchema,
} from './count-tasks.server';
import { readDeskClaims } from './session';
import { handleListWorkers } from './users.server';

const deps = () => ({
  global: globalDb(),
  catalog: catalogDb(),
  warehouseDb,
  newId: () => crypto.randomUUID(),
});

const wh = { warehouseId: z.string().min(1) };

const createSchema = createCountTaskInputSchema.extend(wh);
export const createCountTask = createServerFn({ method: 'POST' })
  .validator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data }) =>
    handleCreateCountTask(await readDeskClaims(), data, deps()),
  );

const listSchema = listCountTasksInputSchema.extend(wh);
export const listCountTasks = createServerFn({ method: 'GET' })
  .validator((d: unknown) => listSchema.parse(d))
  .handler(async ({ data }) =>
    handleListCountTasks(await readDeskClaims(), data, deps()),
  );

const assignSchema = assignCountTaskInputSchema.extend(wh);
export const assignCountTask = createServerFn({ method: 'POST' })
  .validator((d: unknown) => assignSchema.parse(d))
  .handler(async ({ data }) =>
    handleAssignCountTask(await readDeskClaims(), data, deps()),
  );

const closeSchema = closeCountTaskInputSchema.extend(wh);
export const closeCountTask = createServerFn({ method: 'POST' })
  .validator((d: unknown) => closeSchema.parse(d))
  .handler(async ({ data }) =>
    handleCloseCountTask(await readDeskClaims(), data, deps()),
  );

export const listWorkers = createServerFn({ method: 'GET' }).handler(async () =>
  handleListWorkers(await readDeskClaims(), { global: globalDb() }),
);
