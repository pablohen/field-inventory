import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { catalogDb, globalDb, warehouseDb } from '#/server/db/clients';
import {
  assignPickListInputSchema,
  closePickListInputSchema,
  createPickListInputSchema,
  handleAssignPickList,
  handleClosePickList,
  handleCreatePickList,
  handleListPickLists,
  handleSuggestPickList,
  listPickListsInputSchema,
  suggestPickListInputSchema,
} from './pick-lists.server';
import { readDeskClaims } from './session';

const pickDeps = () => ({
  global: globalDb(),
  catalog: catalogDb(),
  warehouseDb,
  newId: () => crypto.randomUUID(),
});

const wh = { warehouseId: z.string().min(1) };

const suggestSchema = suggestPickListInputSchema.extend(wh);
export const suggestPickList = createServerFn({ method: 'POST' })
  .validator((d: unknown) => suggestSchema.parse(d))
  .handler(async ({ data }) =>
    handleSuggestPickList(await readDeskClaims(), data, pickDeps()),
  );

const createSchema = createPickListInputSchema.extend(wh);
export const createPickList = createServerFn({ method: 'POST' })
  .validator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data }) =>
    handleCreatePickList(await readDeskClaims(), data, pickDeps()),
  );

const listSchema = listPickListsInputSchema.extend(wh);
export const listPickLists = createServerFn({ method: 'GET' })
  .validator((d: unknown) => listSchema.parse(d))
  .handler(async ({ data }) =>
    handleListPickLists(await readDeskClaims(), data, pickDeps()),
  );

const assignSchema = assignPickListInputSchema.extend(wh);
export const assignPickList = createServerFn({ method: 'POST' })
  .validator((d: unknown) => assignSchema.parse(d))
  .handler(async ({ data }) =>
    handleAssignPickList(await readDeskClaims(), data, pickDeps()),
  );

const closeSchema = closePickListInputSchema.extend(wh);
export const closePickList = createServerFn({ method: 'POST' })
  .validator((d: unknown) => closeSchema.parse(d))
  .handler(async ({ data }) =>
    handleClosePickList(await readDeskClaims(), data, pickDeps()),
  );
