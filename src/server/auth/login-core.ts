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
export const LOCKOUT_MS = 15 * 60 * 1000;

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

  const now = deps.now();
  const username = input.username.trim();
  const key = { deviceId_username: { deviceId: device.id, username } };

  const attempt = await deps.global.loginAttempt.findUnique({ where: key });
  if (attempt?.lockedUntil && attempt.lockedUntil > now) {
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
    await recordFailure(deps.global, key, device.id, username, now);
    return { ok: false, reason: 'BAD_CREDENTIALS' };
  }

  await deps.global.loginAttempt.deleteMany({
    where: { deviceId: device.id, username },
  });
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

async function recordFailure(
  global: GlobalClient,
  key: { deviceId_username: { deviceId: string; username: string } },
  deviceId: string,
  username: string,
  now: Date,
): Promise<void> {
  const row = await global.loginAttempt.upsert({
    where: key,
    create: { deviceId, username, failures: 1 },
    update: { failures: { increment: 1 } },
  });
  if (row.failures >= MAX_FAILURES) {
    await global.loginAttempt.update({
      where: key,
      data: {
        failures: 0,
        lockedUntil: new Date(now.getTime() + LOCKOUT_MS),
      },
    });
  }
}
