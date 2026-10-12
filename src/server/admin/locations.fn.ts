import { createServerFn } from '@tanstack/react-start';
import {
  createLocationInputSchema,
  listLocationsAdminInputSchema,
  setLocationActiveInputSchema,
  updateLocationInputSchema,
} from '#/admin/location-input';
import { globalDb, warehouseDb } from '#/server/db/clients';
import { readDeskClaims } from '#/server/desk/session';
import {
  handleCreateLocation,
  handleListLocationsAdmin,
  handleSetLocationActive,
  handleUpdateLocation,
} from './locations.server';

const deps = () => ({ global: globalDb(), warehouseDb });

export const listLocationsAdmin = createServerFn({ method: 'GET' })
  .validator((d: unknown) => listLocationsAdminInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleListLocationsAdmin(await readDeskClaims(), data, deps()),
  );

export const createLocation = createServerFn({ method: 'POST' })
  .validator((d: unknown) => createLocationInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleCreateLocation(await readDeskClaims(), data, deps()),
  );

export const updateLocation = createServerFn({ method: 'POST' })
  .validator((d: unknown) => updateLocationInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleUpdateLocation(await readDeskClaims(), data, deps()),
  );

export const setLocationActive = createServerFn({ method: 'POST' })
  .validator((d: unknown) => setLocationActiveInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleSetLocationActive(await readDeskClaims(), data, deps()),
  );
