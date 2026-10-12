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

const ROLES: readonly string[] = ['worker', 'supervisor', 'admin'];

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
  const device = await deps.global.device.findUnique({
    where: { id: input.deviceId },
  });
  if (!device) return { ok: false, reason: 'DEVICE_UNKNOWN' };
  if (device.revokedAt) return { ok: false, reason: 'DEVICE_REVOKED' };

  const now = deps.now();
  const username = input.username.trim();

  // Reserve the attempts atomically before verifying, so parallel requests
  // each consume budget instead of all reading "not locked yet".
  const attempts = await reserveLoginAttempts(
    deps.global,
    device.id,
    username,
    now,
  );
  if (attempts.blocked) {
    // Equivalent scrypt cost, so a locked response is not distinguishable by timing.
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
    await recordLoginFailure(deps.global, device.id, username, attempts, now);
    return { ok: false, reason: 'BAD_CREDENTIALS' };
  }

  await clearLoginAttempts(deps.global, device.id, username);
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

export type Reservation = { failures: number; lockedUntil: Date | null };

export type LoginAttempts = {
  device: Reservation;
  allDevices: Reservation;
  /** True when either counter is locked or over its limit. */
  blocked: boolean;
};

function isBlocked(r: Reservation, max: number, now: Date): boolean {
  return r.failures > max || (r.lockedUntil !== null && r.lockedUntil > now);
}

/**
 * Reserves one attempt on the per-device counter and one on the cross-device
 * counter (`deviceId = '*'`). Call before verifying the PIN.
 */
export async function reserveLoginAttempts(
  global: GlobalClient,
  deviceKey: string,
  username: string,
  now: Date,
): Promise<LoginAttempts> {
  const allDevices = await reserveUsernameAttempt(global, username, now);
  const device = await reserveAttempt(global, deviceKey, username, now);
  return {
    device,
    allDevices,
    blocked:
      isBlocked(device, MAX_FAILURES, now) ||
      isBlocked(allDevices, MAX_FAILURES_ACROSS_DEVICES, now),
  };
}

/** After a failed verify: lock whichever counter just reached its limit. */
export async function recordLoginFailure(
  global: GlobalClient,
  deviceKey: string,
  username: string,
  attempts: LoginAttempts,
  now: Date,
): Promise<void> {
  if (attempts.device.failures >= MAX_FAILURES) {
    await lockAttempt(global, deviceKey, username, now);
  }
  if (attempts.allDevices.failures >= MAX_FAILURES_ACROSS_DEVICES) {
    await lockAttempt(global, ALL_DEVICES_KEY, username, now);
  }
}

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
  return reserveAttempt(global, ALL_DEVICES_KEY, username, now);
}

export function clearUsernameAttempts(
  global: GlobalClient,
  username: string,
): Promise<void> {
  return global.loginAttempt
    .deleteMany({ where: { deviceId: ALL_DEVICES_KEY, username } })
    .then(() => undefined);
}

/**
 * One atomic statement: count this attempt and return the new state. An
 * expired lock restarts the counter at 1.
 */
async function reserveAttempt(
  global: GlobalClient,
  deviceKey: string,
  username: string,
  now: Date,
): Promise<Reservation> {
  const iso = now.toISOString();
  const rows = await global.$queryRaw<
    { failures: number | bigint; lockedUntil: Date | string | null }[]
  >`INSERT INTO "LoginAttempt" ("deviceId", "username", "failures", "lockedUntil", "updatedAt")
    VALUES (${deviceKey}, ${username}, 1, NULL, ${iso})
    ON CONFLICT ("deviceId", "username") DO UPDATE SET
      "failures" = CASE WHEN "lockedUntil" IS NOT NULL AND "lockedUntil" <= ${iso}
        THEN 1 ELSE "failures" + 1 END,
      "lockedUntil" = CASE WHEN "lockedUntil" IS NOT NULL AND "lockedUntil" <= ${iso}
        THEN NULL ELSE "lockedUntil" END,
      "updatedAt" = ${iso}
    RETURNING "failures", "lockedUntil"`;
  const row = rows[0];
  if (!row) throw new Error('login attempt reservation returned no row');
  return {
    failures: Number(row.failures),
    lockedUntil: row.lockedUntil ? new Date(row.lockedUntil) : null,
  };
}

async function lockAttempt(
  global: GlobalClient,
  deviceKey: string,
  username: string,
  now: Date,
): Promise<void> {
  await global.loginAttempt.updateMany({
    where: { deviceId: deviceKey, username },
    data: { failures: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MS) },
  });
}
