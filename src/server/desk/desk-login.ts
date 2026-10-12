import {
  clearLoginAttempts,
  getDummyHash,
  recordLoginFailure,
  reserveLoginAttempts,
} from '#/server/auth/login-core';
import { verifyPin } from '#/server/auth/password';
import {
  type Role,
  SESSION_TTL_SECONDS,
  signSession,
} from '#/server/auth/session';
import type { GlobalClient } from '#/server/db/clients';
import { DESK_DEVICE_ID } from './session';

export type DeskLoginResult =
  | {
      ok: true;
      token: string;
      user: { id: string; name: string; role: Role };
      expiresAt: string;
    }
  | { ok: false; reason: 'BAD_CREDENTIALS' | 'NOT_ALLOWED' | 'LOCKED' };

const ROLES: readonly string[] = ['worker', 'supervisor', 'admin'];

/**
 * Supervisor/admin sign-in for the desk. Same atomic reserve-then-verify
 * lockout as `loginCore`, keyed by (`'desk'`, username) plus the cross-device
 * counter. The PIN is verified before the role is checked, so a worker's role
 * is only revealed to someone who knows the PIN.
 */
export async function deskLoginCore(
  deps: { global: GlobalClient; now(): Date },
  input: { username: string; pin: string },
): Promise<DeskLoginResult> {
  const now = deps.now();
  const username = input.username.trim();

  const attempts = await reserveLoginAttempts(
    deps.global,
    DESK_DEVICE_ID,
    username,
    now,
  );
  if (attempts.blocked) {
    await verifyPin(input.pin, await getDummyHash());
    return { ok: false, reason: 'LOCKED' };
  }

  const user = await deps.global.user.findUnique({ where: { username } });
  let valid = false;
  if (user) {
    valid =
      (await verifyPin(input.pin, user.pinHash)) && ROLES.includes(user.role);
  } else {
    await verifyPin(input.pin, await getDummyHash());
  }
  if (!user || !valid) {
    await recordLoginFailure(
      deps.global,
      DESK_DEVICE_ID,
      username,
      attempts,
      now,
    );
    return { ok: false, reason: 'BAD_CREDENTIALS' };
  }

  await clearLoginAttempts(deps.global, DESK_DEVICE_ID, username);
  const role = user.role as Role; // validated against ROLES above
  if (role === 'worker') return { ok: false, reason: 'NOT_ALLOWED' };
  const token = await signSession(
    { userId: user.id, deviceId: DESK_DEVICE_ID, role },
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
