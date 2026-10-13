import { createServerFn } from '@tanstack/react-start';
import {
  createUserInputSchema,
  resetPinRequestSchema,
  setUserDisabledRequestSchema,
  updateUserRequestSchema,
} from '#/admin/user-input';
import { globalDb } from '#/server/db/clients';
import { readDeskClaims } from '#/server/desk/session';
import {
  handleCreateUser,
  handleListUsers,
  handleResetPin,
  handleSetUserDisabled,
  handleUpdateUser,
} from './users.server';

const deps = () => ({ global: globalDb(), now: () => new Date() });

export const listUsers = createServerFn({ method: 'GET' }).handler(async () =>
  handleListUsers(await readDeskClaims(), {}, deps()),
);

export const createUser = createServerFn({ method: 'POST' })
  .validator((d: unknown) => createUserInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleCreateUser(await readDeskClaims(), data, deps()),
  );

export const updateUser = createServerFn({ method: 'POST' })
  .validator((d: unknown) => updateUserRequestSchema.parse(d))
  .handler(async ({ data }) =>
    handleUpdateUser(await readDeskClaims(), data, deps()),
  );

export const resetPin = createServerFn({ method: 'POST' })
  .validator((d: unknown) => resetPinRequestSchema.parse(d))
  .handler(async ({ data }) =>
    handleResetPin(await readDeskClaims(), data, deps()),
  );

export const setUserDisabled = createServerFn({ method: 'POST' })
  .validator((d: unknown) => setUserDisabledRequestSchema.parse(d))
  .handler(async ({ data }) =>
    handleSetUserDisabled(await readDeskClaims(), data, deps()),
  );
