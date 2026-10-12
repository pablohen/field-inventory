import { createServerFn } from '@tanstack/react-start';
import { globalDb, warehouseDb } from '#/server/db/clients';
import {
  handleListLocations,
  listLocationsInputSchema,
} from './locations.server';
import { readDeskClaims } from './session';

export const listLocations = createServerFn({ method: 'GET' })
  .validator((d: unknown) => listLocationsInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleListLocations(await readDeskClaims(), data, {
      global: globalDb(),
      warehouseDb,
    }),
  );
