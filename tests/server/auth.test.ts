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
});
