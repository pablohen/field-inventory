import { createServerFn } from '@tanstack/react-start';
import {
  enrollDeviceInputSchema,
  setDeviceRevokedRequestSchema,
  setDeviceWarehousesRequestSchema,
} from '#/admin/device-input';
import { globalDb } from '#/server/db/clients';
import { readDeskClaims } from '#/server/desk/session';
import {
  handleEnrollDevice,
  handleListDevices,
  handleSetDeviceRevoked,
  handleSetDeviceWarehouses,
} from './devices.server';

const deps = () => ({ global: globalDb(), now: () => new Date() });

export const listDevices = createServerFn({ method: 'GET' }).handler(async () =>
  handleListDevices(await readDeskClaims(), {}, deps()),
);

export const enrollDevice = createServerFn({ method: 'POST' })
  .validator((d: unknown) => enrollDeviceInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleEnrollDevice(await readDeskClaims(), data, deps()),
  );

export const setDeviceWarehouses = createServerFn({ method: 'POST' })
  .validator((d: unknown) => setDeviceWarehousesRequestSchema.parse(d))
  .handler(async ({ data }) =>
    handleSetDeviceWarehouses(await readDeskClaims(), data, deps()),
  );

export const setDeviceRevoked = createServerFn({ method: 'POST' })
  .validator((d: unknown) => setDeviceRevokedRequestSchema.parse(d))
  .handler(async ({ data }) =>
    handleSetDeviceRevoked(await readDeskClaims(), data, deps()),
  );
