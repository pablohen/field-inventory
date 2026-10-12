import { checkCredentialsWithLockout } from '#/server/auth/login-core';
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
  const checked = await checkCredentialsWithLockout(deps, {
    deviceKey: DESK_DEVICE_ID,
    username: input.username,
    pin: input.pin,
  });
  if (!checked.ok) return checked;
  const { user } = checked;
  const role = user.role as Role; // validated against ROLES by the check
  if (role === 'worker') return { ok: false, reason: 'NOT_ALLOWED' };
  const now = deps.now();
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
