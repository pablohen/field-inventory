import { createServerFn } from '@tanstack/react-start';
import {
  deleteCookie,
  getRequestUrl,
  setCookie,
} from '@tanstack/react-start/server';
import { z } from 'zod';
import { globalDb } from '#/server/db/clients';
import { loginCore } from './login-core';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from './session';

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  pin: z.string().min(1).max(32),
  deviceId: z.string().min(1).max(128),
});

export const login = createServerFn({ method: 'POST' })
  .validator((d: unknown) => loginSchema.parse(d))
  .handler(async ({ data }) => {
    const result = await loginCore(
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
      deviceId: data.deviceId,
      expiresAt: result.expiresAt,
    };
  });

export const logout = createServerFn({ method: 'POST' }).handler(() => {
  deleteCookie(SESSION_COOKIE, { path: '/' });
  return { ok: true as const };
});
