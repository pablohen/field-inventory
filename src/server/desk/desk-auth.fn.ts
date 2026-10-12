import { createServerFn } from '@tanstack/react-start';
import {
  deleteCookie,
  getCookie,
  getRequestUrl,
  setCookie,
} from '@tanstack/react-start/server';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  verifySession,
} from '#/server/auth/session';
import { globalDb } from '#/server/db/clients';
import { deskLoginCore } from './desk-login';
import { deskSessionInfo, readDeskClaims } from './session';
import { handleGetWarehouses } from './warehouses.server';

const deskLoginSchema = z.object({
  username: z.string().min(1).max(64),
  pin: z.string().min(1).max(32),
});

export const deskLogin = createServerFn({ method: 'POST' })
  .validator((d: unknown) => deskLoginSchema.parse(d))
  .handler(async ({ data }) => {
    const result = await deskLoginCore(
      { global: globalDb(), now: () => new Date() },
      data,
    );
    if (!result.ok) return result;
    const { hostname } = getRequestUrl();
    setCookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: hostname !== 'localhost' && hostname !== '127.0.0.1',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
    return {
      ok: true as const,
      user: result.user,
      expiresAt: result.expiresAt,
    };
  });

export const deskLogout = createServerFn({ method: 'POST' }).handler(() => {
  deleteCookie(SESSION_COOKIE, { path: '/' });
  return { ok: true as const };
});

/** Current desk user, or null. Never throws; route guards use it. */
export const getDeskSession = createServerFn({ method: 'GET' }).handler(
  async () => {
    try {
      const token = getCookie(SESSION_COOKIE);
      const claims = token ? await verifySession(token) : null;
      return await deskSessionInfo(globalDb(), claims);
    } catch {
      return null;
    }
  },
);

export const getWarehouses = createServerFn({ method: 'GET' }).handler(
  async () =>
    handleGetWarehouses(await readDeskClaims(), { global: globalDb() }),
);
