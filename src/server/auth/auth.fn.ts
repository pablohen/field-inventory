import { createServerFn } from '@tanstack/react-start';
import {
  deleteCookie,
  getRequestUrl,
  setCookie,
} from '@tanstack/react-start/server';
import { z } from 'zod';
import { type GlobalClient, globalDb } from '#/server/db/clients';
import { hashPin, verifyPin } from './password';
import {
  type Role,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  signSession,
} from './session';

export type LoginInput = { username: string; pin: string; deviceId: string };

export type LoginResult =
  | {
      ok: true;
      token: string;
      user: { id: string; name: string; role: Role };
      expiresAt: string;
    }
  | {
      ok: false;
      reason: 'BAD_CREDENTIALS' | 'DEVICE_UNKNOWN' | 'DEVICE_REVOKED';
    };

const ROLES: readonly string[] = ['worker', 'supervisor', 'admin'];

/** Lazily computed hash so unknown users still cost one scrypt (no timing enumeration). */
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPin('dummy-pin-for-timing');
  return dummyHash;
}

/** Checks the device first, then the credentials (same reason for unknown user and wrong PIN). */
export async function loginCore(
  deps: { global: GlobalClient; now(): Date },
  input: LoginInput,
): Promise<LoginResult> {
  const device = await deps.global.device.findUnique({
    where: { id: input.deviceId },
  });
  if (!device) return { ok: false, reason: 'DEVICE_UNKNOWN' };
  if (device.revokedAt) return { ok: false, reason: 'DEVICE_REVOKED' };

  const user = await deps.global.user.findUnique({
    where: { username: input.username },
  });
  if (!user) {
    await verifyPin(input.pin, await getDummyHash());
    return { ok: false, reason: 'BAD_CREDENTIALS' };
  }
  if (
    !(await verifyPin(input.pin, user.pinHash)) ||
    !ROLES.includes(user.role)
  ) {
    return { ok: false, reason: 'BAD_CREDENTIALS' };
  }

  const now = deps.now();
  const role = user.role as Role; // validated against ROLES above
  const token = await signSession(
    { userId: user.id, deviceId: device.id, role },
    now,
  );
  return {
    ok: true,
    token,
    user: { id: user.id, name: user.name, role },
    expiresAt: new Date(
      now.getTime() + SESSION_TTL_SECONDS * 1000,
    ).toISOString(),
  };
}

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
