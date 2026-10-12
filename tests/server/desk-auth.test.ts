import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCKOUT_MS, loginCore } from '#/server/auth/login-core';
import type { SessionClaims } from '#/server/auth/session';
import { verifySession } from '#/server/auth/session';
import { deskLoginCore } from '#/server/desk/desk-login';
import { authorizeDesk, deskSessionInfo } from '#/server/desk/session';
import { createTestEnv, type TestEnv } from '../support/test-env';

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(32));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const claims = (
  role: SessionClaims['role'],
  deviceId = 'desk',
): SessionClaims => ({ userId: 'u1', deviceId, role, exp: 0 });

describe('authorizeDesk', () => {
  const status = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as Response).status;
    }
    return 200;
  };

  it('401 without a session', () => {
    expect(status(() => authorizeDesk(null))).toBe(401);
  });
  it('403 for a worker', () => {
    expect(status(() => authorizeDesk(claims('worker')))).toBe(403);
  });
  it('passes supervisor and admin, including from a handheld device', () => {
    expect(authorizeDesk(claims('supervisor')).role).toBe('supervisor');
    expect(authorizeDesk(claims('admin')).role).toBe('admin');
    expect(authorizeDesk(claims('supervisor', 'dev-1')).deviceId).toBe('dev-1');
  });
});

describe('deskLoginCore', () => {
  let env: TestEnv;
  const t0 = new Date('2026-01-01T00:00:00Z');
  let clock = t0;
  const deps = () => ({ global: env.global, now: () => clock });
  const desk = (pin: string, username = 'ana') =>
    deskLoginCore(deps(), { username, pin });
  const handheld = (pin: string, deviceId: string, username = 'ana') =>
    loginCore(deps(), { username, pin, deviceId });

  beforeEach(async () => {
    clock = t0;
    env = await createTestEnv();
    await env.seedUser({
      id: 'u1',
      username: 'ana',
      pin: '1234',
      role: 'supervisor',
    });
    await env.seedUser({
      id: 'u2',
      username: 'bob',
      pin: '5678',
      role: 'worker',
    });
    for (const id of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']) {
      await env.seedDevice({ id, warehouses: [] });
    }
  });
  afterEach(async () => {
    await env.cleanup();
  });

  it('signs in a supervisor with a desk-device token', async () => {
    const res = await desk('1234');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.user).toEqual({ id: 'u1', name: 'ana', role: 'supervisor' });
    expect(await verifySession(res.token, t0)).toMatchObject({
      userId: 'u1',
      deviceId: 'desk',
      role: 'supervisor',
    });
  });

  it('worker with the right pin is NOT_ALLOWED', async () => {
    expect(await desk('5678', 'bob')).toEqual({
      ok: false,
      reason: 'NOT_ALLOWED',
    });
  });

  it('worker with a wrong pin is BAD_CREDENTIALS (role not revealed)', async () => {
    expect(await desk('0000', 'bob')).toEqual({
      ok: false,
      reason: 'BAD_CREDENTIALS',
    });
  });

  it('wrong pin and unknown user are BAD_CREDENTIALS', async () => {
    expect(await desk('0000')).toEqual({
      ok: false,
      reason: 'BAD_CREDENTIALS',
    });
    expect(await desk('1234', 'nobody')).toEqual({
      ok: false,
      reason: 'BAD_CREDENTIALS',
    });
  });

  it('locks after 5 wrong pins', async () => {
    for (let i = 0; i < 5; i++) await desk('0000');
    expect(await desk('1234')).toEqual({ ok: false, reason: 'LOCKED' });
  });

  describe('cross-device cap', () => {
    const spread = async (n: number) => {
      const devs = ['d1', 'd2', 'd3', 'd4'];
      for (let i = 0; i < n; i++) {
        expect(await handheld('0000', devs[i % 4] as string)).toEqual({
          ok: false,
          reason: 'BAD_CREDENTIALS',
        });
      }
    };

    it('10 wrong pins over 4 devices lock the username everywhere', async () => {
      await spread(10);
      expect(await handheld('1234', 'd5')).toEqual({
        ok: false,
        reason: 'LOCKED',
      });
      expect(await desk('1234')).toEqual({ ok: false, reason: 'LOCKED' });
    });

    it('9 wrong pins do not lock', async () => {
      await spread(9);
      expect((await handheld('1234', 'd5')).ok).toBe(true);
    });

    it('unlocks after LOCKOUT_MS', async () => {
      await spread(10);
      clock = new Date(t0.getTime() + LOCKOUT_MS + 1);
      expect((await handheld('1234', 'd5')).ok).toBe(true);
    });

    it('a success clears the cross-device counter', async () => {
      await spread(8);
      expect((await handheld('1234', 'd5')).ok).toBe(true);
      expect(
        await env.global.loginAttempt.findUnique({
          where: { deviceId_username: { deviceId: '*', username: 'ana' } },
        }),
      ).toBeNull();
      await spread(8);
      expect((await desk('1234')).ok).toBe(true);
    });

    it('desk failures count toward the cap', async () => {
      await spread(8);
      await desk('0000');
      await desk('0000');
      expect(await handheld('1234', 'd5')).toEqual({
        ok: false,
        reason: 'LOCKED',
      });
    });

    it('concurrent wrong pins across devices cannot exceed the cap', async () => {
      const devs = ['d1', 'd2', 'd3', 'd4', 'd5'];
      const results = await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          handheld('0000', devs[i % 5] as string),
        ),
      );
      const bad = results.filter(
        (r) => !r.ok && r.reason === 'BAD_CREDENTIALS',
      ).length;
      const locked = results.filter(
        (r) => !r.ok && r.reason === 'LOCKED',
      ).length;
      expect(bad).toBeLessThanOrEqual(10);
      expect(bad + locked).toBe(15);
      expect(await handheld('1234', 'd6')).toEqual({
        ok: false,
        reason: 'LOCKED',
      });
    });
  });
});

describe('lockout expiry (no permanent locks)', () => {
  let env: TestEnv;
  const t0 = new Date('2026-01-01T00:00:00Z');
  const MIN = 60 * 1000;
  let clock = t0;
  const deps = () => ({ global: env.global, now: () => clock });
  const desk = (pin: string) => deskLoginCore(deps(), { username: 'ana', pin });
  const handheld = (pin: string, deviceId: string) =>
    loginCore(deps(), { username: 'ana', pin, deviceId });

  beforeEach(async () => {
    clock = t0;
    env = await createTestEnv();
    await env.seedUser({
      id: 'u1',
      username: 'ana',
      pin: '1234',
      role: 'supervisor',
    });
    for (const id of ['d1', 'd2', 'd3', 'd5']) {
      await env.seedDevice({ id, warehouses: [] });
    }
  });
  afterEach(async () => {
    await env.cleanup();
  });

  it('12 wrong pins on one device still unlock everywhere after LOCKOUT_MS', async () => {
    for (let i = 0; i < 12; i++) await handheld('0000', 'd1');
    clock = new Date(t0.getTime() + 30 * MIN);
    expect((await handheld('1234', 'd5')).ok).toBe(true);
    for (let i = 0; i < 12; i++) await handheld('0000', 'd1');
    clock = new Date(clock.getTime() + 25 * 60 * MIN);
    expect((await desk('1234')).ok).toBe(true);
  });

  it('12 wrong desk pins unlock after LOCKOUT_MS', async () => {
    for (let i = 0; i < 12; i++) await desk('0000');
    clock = new Date(t0.getTime() + LOCKOUT_MS + 1);
    expect((await desk('1234')).ok).toBe(true);
  });

  it('retrying the correct pin during a global lock does not lock the device forever', async () => {
    for (let i = 0; i < 10; i++) await handheld('0000', i % 2 ? 'd1' : 'd2');
    for (let i = 0; i < 6; i++) {
      expect(await handheld('1234', 'd5')).toEqual({
        ok: false,
        reason: 'LOCKED',
      });
    }
    clock = new Date(t0.getTime() + LOCKOUT_MS + 1);
    expect((await handheld('1234', 'd5')).ok).toBe(true);
  });

  it('attempts during a lock do not extend it', async () => {
    for (let i = 0; i < 5; i++) await handheld('0000', 'd1');
    clock = new Date(t0.getTime() + 14 * MIN);
    expect(await handheld('1234', 'd1')).toEqual({
      ok: false,
      reason: 'LOCKED',
    });
    clock = new Date(t0.getTime() + LOCKOUT_MS + 1);
    expect((await handheld('1234', 'd1')).ok).toBe(true);
  });

  it('a global lock leaves the device counter untouched', async () => {
    for (let i = 0; i < 10; i++) await handheld('0000', i % 2 ? 'd1' : 'd2');
    await handheld('1234', 'd3');
    expect(
      await env.global.loginAttempt.findUnique({
        where: { deviceId_username: { deviceId: 'd3', username: 'ana' } },
      }),
    ).toBeNull();
  });

  it('reserved attempt keys are not handheld devices', async () => {
    for (const id of ['desk', '*']) {
      expect(await handheld('1234', id)).toEqual({
        ok: false,
        reason: 'DEVICE_UNKNOWN',
      });
    }
  });
});

describe('deskSessionInfo', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
    await env.seedUser({
      id: 'u1',
      username: 'ana',
      pin: '1',
      role: 'supervisor',
    });
    await env.seedUser({ id: 'u2', username: 'bob', pin: '1', role: 'worker' });
  });
  afterEach(async () => {
    await env.cleanup();
  });

  it('returns the user for a supervisor, null otherwise', async () => {
    expect(await deskSessionInfo(env.global, claims('supervisor'))).toEqual({
      userId: 'u1',
      name: 'ana',
      role: 'supervisor',
    });
    expect(
      await deskSessionInfo(env.global, { ...claims('worker'), userId: 'u2' }),
    ).toBeNull();
    expect(await deskSessionInfo(env.global, null)).toBeNull();
    expect(
      await deskSessionInfo(env.global, { ...claims('admin'), userId: 'zz' }),
    ).toBeNull();
  });
});
