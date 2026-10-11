import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginCore } from '#/server/auth/login-core';
import { hashPin, verifyPin } from '#/server/auth/password';
import { signSession, verifySession } from '#/server/auth/session';
import { createTestEnv, type TestEnv } from '../support/test-env';

vi.mock('#/server/auth/password', async (orig) => {
  const m = await orig<typeof import('#/server/auth/password')>();
  return { ...m, verifyPin: vi.fn(m.verifyPin) };
});

const SECRET = 'a'.repeat(32);
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('pin hashing', () => {
  it('round-trips and rejects a wrong pin', async () => {
    const stored = await hashPin('1234');
    expect(stored).toMatch(/^scrypt\$[^$]+\$[^$]+$/);
    expect(await verifyPin('1234', stored)).toBe(true);
    expect(await verifyPin('4321', stored)).toBe(false);
  });

  it('rejects a malformed stored value', async () => {
    expect(await verifyPin('1234', 'bogus')).toBe(false);
  });
});

describe('session', () => {
  const claims = { userId: 'u1', deviceId: 'd1', role: 'worker' as const };
  const t0 = new Date('2026-01-01T00:00:00Z');

  it('signs and verifies', async () => {
    const token = await signSession(claims, t0);
    const got = await verifySession(token, new Date(t0.getTime() + DAY));
    expect(got).toMatchObject(claims);
    expect(got?.exp).toBe(Math.floor(t0.getTime() / 1000) + 7 * 86400);
  });

  it('expires after 7 days', async () => {
    const token = await signSession(claims, t0);
    expect(await verifySession(token, new Date(t0.getTime() + 8 * DAY))).toBe(
      null,
    );
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signSession(claims, t0);
    vi.stubEnv('SESSION_SECRET', 'b'.repeat(32));
    expect(await verifySession(token, t0)).toBe(null);
  });

  it('rejects HS512, alg none and tampered tokens', async () => {
    const key = new TextEncoder().encode(SECRET);
    const hs512 = await new SignJWT({ deviceId: 'd1', role: 'worker' })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject('u1')
      .setExpirationTime(Math.floor(t0.getTime() / 1000) + 3600)
      .sign(key);
    expect(await verifySession(hs512, t0)).toBe(null);

    const b64 = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      sub: 'u1',
      deviceId: 'd1',
      role: 'admin',
      exp: Math.floor(t0.getTime() / 1000) + 3600,
    })}.`;
    expect(await verifySession(none, t0)).toBe(null);

    const good = await signSession(claims, t0);
    const [h, , sig] = good.split('.');
    const forged = `${h}.${b64({ sub: 'u1', deviceId: 'd1', role: 'admin', exp: Math.floor(t0.getTime() / 1000) + 3600 })}.${sig}`;
    expect(await verifySession(forged, t0)).toBe(null);
  });

  it('throws when the secret is the example placeholder', async () => {
    vi.stubEnv('SESSION_SECRET', 'change-me-to-a-long-random-string');
    await expect(signSession(claims, t0)).rejects.toThrow(
      'not the example placeholder',
    );
  });

  it('throws when the secret is missing or short', async () => {
    vi.stubEnv('SESSION_SECRET', 'short');
    await expect(signSession(claims, t0)).rejects.toThrow(
      'SESSION_SECRET must be at least 32 characters',
    );
    await expect(verifySession('x', t0)).rejects.toThrow(
      'SESSION_SECRET must be at least 32 characters',
    );
  });
});

describe('loginCore', () => {
  let env: TestEnv;
  const now = new Date('2026-01-01T00:00:00Z');
  const deps = () => ({ global: env.global, now: () => now });

  beforeEach(async () => {
    env = await createTestEnv();
    await env.seedUser({
      id: 'u1',
      username: 'ana',
      pin: '1234',
      role: 'supervisor',
    });
    await env.seedDevice({ id: 'd1', warehouses: [] });
    await env.seedDevice({ id: 'dr', warehouses: [], revoked: true });
  });
  afterEach(async () => {
    await env.cleanup();
  });

  it('logs in with good credentials', async () => {
    const res = await loginCore(deps(), {
      username: 'ana',
      pin: '1234',
      deviceId: 'd1',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.user).toEqual({ id: 'u1', name: 'ana', role: 'supervisor' });
    expect(res.expiresAt).toBe(new Date(now.getTime() + 7 * DAY).toISOString());
    expect(await verifySession(res.token, now)).toMatchObject({
      userId: 'u1',
      deviceId: 'd1',
      role: 'supervisor',
    });
  });

  it('rejects a wrong pin', async () => {
    expect(
      await loginCore(deps(), { username: 'ana', pin: '0000', deviceId: 'd1' }),
    ).toEqual({ ok: false, reason: 'BAD_CREDENTIALS' });
  });

  it('rejects an unknown username with the same reason', async () => {
    expect(
      await loginCore(deps(), {
        username: 'nobody',
        pin: '1234',
        deviceId: 'd1',
      }),
    ).toEqual({ ok: false, reason: 'BAD_CREDENTIALS' });
  });

  it('runs scrypt verification for an unknown user', async () => {
    vi.mocked(verifyPin).mockClear();
    await loginCore(deps(), {
      username: 'nobody',
      pin: '1234',
      deviceId: 'd1',
    });
    expect(verifyPin).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown role', async () => {
    await env.global.user.update({
      where: { id: 'u1' },
      data: { role: 'boss' },
    });
    expect(
      await loginCore(deps(), { username: 'ana', pin: '1234', deviceId: 'd1' }),
    ).toEqual({ ok: false, reason: 'BAD_CREDENTIALS' });
  });

  it('checks the device before credentials', async () => {
    expect(
      await loginCore(deps(), {
        username: 'nobody',
        pin: '0000',
        deviceId: 'dr',
      }),
    ).toEqual({ ok: false, reason: 'DEVICE_REVOKED' });
  });

  it('rejects a revoked device', async () => {
    expect(
      await loginCore(deps(), { username: 'ana', pin: '1234', deviceId: 'dr' }),
    ).toEqual({ ok: false, reason: 'DEVICE_REVOKED' });
  });

  it('rejects an unknown device', async () => {
    expect(
      await loginCore(deps(), { username: 'ana', pin: '1234', deviceId: 'zz' }),
    ).toEqual({ ok: false, reason: 'DEVICE_UNKNOWN' });
  });

  describe('throttling', () => {
    const MIN = 60 * 1000;
    let clock = now;
    const tdeps = () => ({ global: env.global, now: () => clock });
    const attempt = (pin: string, username = 'ana', deviceId = 'd1') =>
      loginCore(tdeps(), { username, pin, deviceId });
    const failN = async (n: number, username = 'ana', deviceId = 'd1') => {
      for (let i = 0; i < n; i++) {
        expect(await attempt('0000', username, deviceId)).toEqual({
          ok: false,
          reason: 'BAD_CREDENTIALS',
        });
      }
    };

    beforeEach(async () => {
      clock = now;
      await env.seedDevice({ id: 'd2', warehouses: [] });
    });

    it('locks after 5 wrong pins even for the right pin', async () => {
      await failN(5);
      expect(await attempt('1234')).toEqual({ ok: false, reason: 'LOCKED' });
    });

    it('does not verify the pin while locked but still spends scrypt', async () => {
      await failN(5);
      vi.mocked(verifyPin).mockClear();
      await attempt('1234');
      expect(verifyPin).toHaveBeenCalledTimes(1);
      const hash = vi.mocked(verifyPin).mock.calls[0]?.[1];
      const user = await env.global.user.findUnique({
        where: { username: 'ana' },
      });
      expect(hash).not.toBe(user?.pinHash);
    });

    it('unlocks after 15 minutes and resets the counter', async () => {
      await failN(5);
      clock = new Date(now.getTime() + 15 * MIN + 1);
      expect((await attempt('1234')).ok).toBe(true);
      const row = await env.global.loginAttempt.findUnique({
        where: { deviceId_username: { deviceId: 'd1', username: 'ana' } },
      });
      expect(row?.failures ?? 0).toBe(0);
      expect(row?.lockedUntil ?? null).toBe(null);
    });

    it('stays locked just before 15 minutes', async () => {
      await failN(5);
      clock = new Date(now.getTime() + 15 * MIN - 1);
      expect(await attempt('1234')).toEqual({ ok: false, reason: 'LOCKED' });
    });

    it('a success resets the failure count', async () => {
      await failN(4);
      expect((await attempt('1234')).ok).toBe(true);
      await failN(4);
      expect((await attempt('1234')).ok).toBe(true);
    });

    it('locks unknown usernames too, keyed by the trimmed name', async () => {
      await failN(5, 'ghost');
      expect(await attempt('1234', ' ghost ')).toEqual({
        ok: false,
        reason: 'LOCKED',
      });
    });

    it('a lock on one device does not affect another', async () => {
      await failN(5, 'ana', 'd1');
      expect(await attempt('1234', 'ana', 'd2')).toMatchObject({ ok: true });
    });

    it('concurrent wrong pins cannot exceed the attempt budget', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => attempt('0000')),
      );
      const bad = results.filter(
        (r) => !r.ok && r.reason === 'BAD_CREDENTIALS',
      ).length;
      const locked = results.filter(
        (r) => !r.ok && r.reason === 'LOCKED',
      ).length;
      expect(bad).toBeLessThanOrEqual(5);
      expect(bad + locked).toBe(10);
      expect(await attempt('1234')).toEqual({ ok: false, reason: 'LOCKED' });
    });

    it('a lock on one username does not affect another', async () => {
      await env.seedUser({
        id: 'u2',
        username: 'bob',
        pin: '5678',
        role: 'worker',
      });
      await failN(5, 'ana');
      expect(await attempt('5678', 'bob')).toMatchObject({ ok: true });
    });
  });
});
