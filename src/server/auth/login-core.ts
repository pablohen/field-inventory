import type { GlobalClient } from '#/server/db/clients';
import { hashPin, verifyPin } from './password';
import { type Role, SESSION_TTL_SECONDS, signSession } from './session';

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
      reason:
        | 'BAD_CREDENTIALS'
        | 'DEVICE_UNKNOWN'
        | 'DEVICE_REVOKED'
        | 'LOCKED';
    };

export const MAX_FAILURES = 5;
export const MAX_FAILURES_ACROSS_DEVICES = 10;
export const LOCKOUT_MS = 15 * 60 * 1000;

/** `LoginAttempt.deviceId` used for the per-username counter spanning all devices. */
const ALL_DEVICES_KEY = '*';

/** Attempt key for desk sign-ins (see `DESK_DEVICE_ID`). */
const DESK_KEY = 'desk';

export const ROLES: readonly string[] = ['worker', 'supervisor', 'admin'];

/** Lazily computed hash so unknown users still cost one scrypt (no timing enumeration). */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPin('dummy-pin-for-timing');
  return dummyHash;
}

/** Checks the device first, then the credentials (same reason for unknown user and wrong PIN). */
export async function loginCore(
  deps: { global: GlobalClient; now(): Date },
  input: LoginInput,
): Promise<LoginResult> {
  // 'desk' and '*' are reserved attempt keys, never real handheld devices.
  if (input.deviceId === DESK_KEY || input.deviceId === ALL_DEVICES_KEY) {
    return { ok: false, reason: 'DEVICE_UNKNOWN' };
  }
  const device = await deps.global.device.findUnique({
    where: { id: input.deviceId },
  });
  if (!device) return { ok: false, reason: 'DEVICE_UNKNOWN' };
  if (device.revokedAt) return { ok: false, reason: 'DEVICE_REVOKED' };

  const now = deps.now();
  const checked = await checkCredentialsWithLockout(deps, {
    deviceKey: device.id,
    username: input.username,
    pin: input.pin,
  });
  if (!checked.ok) return checked;
  const { user } = checked;
  const role = user.role as Role; // validated against ROLES by the check
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

/**
 * The one lockout-protected PIN check, shared by handheld and desk sign-in.
 * Reserves attempts atomically before verifying, so parallel requests each
 * consume budget. The cross-device key is reserved first; if it is locked we
 * stop without touching the device key. A locked response still spends one
 * scrypt so it is not distinguishable by timing.
 */
export async function checkCredentialsWithLockout(
  deps: { global: GlobalClient; now(): Date },
  input: { deviceKey: string; username: string; pin: string },
): Promise<
  | { ok: true; user: { id: string; name: string; role: string } }
  | { ok: false; reason: 'BAD_CREDENTIALS' | 'LOCKED' }
> {
  const { global } = deps;
  const now = deps.now();
  const username = input.username.trim();

  const allDevices = await reserveUsernameAttempt(global, username, now);
  const device = allDevices.blocked
    ? null
    : await reserveAttempt(
        global,
        input.deviceKey,
        username,
        now,
        MAX_FAILURES,
      );
  if (!device || device.blocked) {
    await verifyPin(input.pin, await getDummyHash());
    return { ok: false, reason: 'LOCKED' };
  }

  const user = await global.user.findUnique({ where: { username } });
  let valid = false;
  if (user) {
    valid =
      (await verifyPin(input.pin, user.pinHash)) && ROLES.includes(user.role);
  } else {
    await verifyPin(input.pin, await getDummyHash());
  }
  if (!user || !valid) return { ok: false, reason: 'BAD_CREDENTIALS' };
  // Checked after the PIN (same scrypt cost as any login), and the attempt was
  // already reserved above, so a disabled account is indistinguishable from a
  // wrong PIN and still counts toward lockout.
  if (user.disabledAt) return { ok: false, reason: 'BAD_CREDENTIALS' };

  await clearLoginAttempts(global, input.deviceKey, username);
  return { ok: true, user };
}

export type Reservation = {
  failures: number;
  lockedUntil: Date | null;
  /** True when the lock was already in force before this attempt. */
  blocked: boolean;
};

/** After a successful login: forget both counters. */
export async function clearLoginAttempts(
  global: GlobalClient,
  deviceKey: string,
  username: string,
): Promise<void> {
  await global.loginAttempt.deleteMany({
    where: { deviceId: { in: [deviceKey, ALL_DEVICES_KEY] }, username },
  });
}

export function reserveUsernameAttempt(
  global: GlobalClient,
  username: string,
  now: Date,
): Promise<Reservation> {
  return reserveAttempt(
    global,
    ALL_DEVICES_KEY,
    username,
    now,
    MAX_FAILURES_ACROSS_DEVICES,
  );
}

export async function clearUsernameAttempts(
  global: GlobalClient,
  username: string,
): Promise<void> {
  await global.loginAttempt.deleteMany({
    where: { deviceId: ALL_DEVICES_KEY, username },
  });
}

/**
 * One atomic statement owns all lock state for a (key, username) row:
 * - lock in force (`lockedUntil > now`): no count change beyond a cap of
 *   `max + 1` (the marker that this attempt is blocked), lock untouched;
 * - lock expired: restart at 1 and clear it;
 * - otherwise count the attempt, and the attempt that reaches `max` sets
 *   `lockedUntil = now + LOCKOUT_MS` right here. That attempt is still allowed
 *   to verify (`failures === max`); every later one sees `max + 1`.
 * So a counter can never sit at its limit with `lockedUntil` NULL.
 */
async function reserveAttempt(
  global: GlobalClient,
  deviceKey: string,
  username: string,
  now: Date,
  max: number,
): Promise<Reservation> {
  const iso = now.toISOString();
  const lockIso = new Date(now.getTime() + LOCKOUT_MS).toISOString();
  const rows = await global.$queryRaw<
    { failures: number | bigint; lockedUntil: Date | string | null }[]
  >`INSERT INTO "LoginAttempt" ("deviceId", "username", "failures", "lockedUntil", "updatedAt")
    VALUES (${deviceKey}, ${username}, 1, NULL, ${iso})
    ON CONFLICT ("deviceId", "username") DO UPDATE SET
      "failures" = CASE
        WHEN "lockedUntil" IS NOT NULL AND "lockedUntil" > ${iso} THEN ${max + 1}
        WHEN "lockedUntil" IS NOT NULL THEN 1
        ELSE "failures" + 1 END,
      "lockedUntil" = CASE
        WHEN "lockedUntil" IS NOT NULL AND "lockedUntil" > ${iso} THEN "lockedUntil"
        WHEN "lockedUntil" IS NOT NULL THEN NULL
        WHEN "failures" + 1 >= ${max} THEN ${lockIso}
        ELSE NULL END,
      "updatedAt" = ${iso}
    RETURNING "failures", "lockedUntil"`;
  const row = rows[0];
  if (!row) throw new Error('login attempt reservation returned no row');
  const failures = Number(row.failures);
  return {
    failures,
    lockedUntil: row.lockedUntil ? new Date(row.lockedUntil) : null,
    blocked: failures > max,
  };
}
