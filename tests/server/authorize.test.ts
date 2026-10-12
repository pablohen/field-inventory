import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertSessionUserActive,
  authorizeAdmin,
  authorizeDesk,
} from '#/server/auth/authorize';
import { loginCore } from '#/server/auth/login-core';
import * as password from '#/server/auth/password';
import type { SessionClaims } from '#/server/auth/session';
import { SCHEMA_VERSIONS } from '#/server/db/migrate';
import { deskLoginCore } from '#/server/desk/desk-login';
import { deskSessionInfo } from '#/server/desk/session';
import { replicaConfigCore } from '#/server/replicas/replica-config.server';
import type { SyncDeps } from '#/server/sync/sync-movements';
import { handleSync } from '#/server/sync/sync-movements.server';
import { createTestEnv, type TestEnv } from '../support/test-env';

const NOW = new Date('2026-03-01T12:00:00Z');
const WH = 'wh1';

const claims = (
  userId: string,
  role: SessionClaims['role'],
  deviceId = 'desk',
): SessionClaims => ({ userId, deviceId, role, exp: 0 });

const status = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as Response).status;
  }
  return 200;
};

let env: TestEnv;
beforeEach(async () => {
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(32));
  env = await createTestEnv();
  await env.seedUser({
    id: 'sup',
    username: 'sup',
    pin: '1234',
    role: 'supervisor',
  });
  await env.seedUser({
    id: 'adm',
    username: 'adm',
    pin: '1234',
    role: 'admin',
  });
  await env.seedUser({
    id: 'wrk',
    username: 'wrk',
    pin: '1234',
    role: 'worker',
  });
  await env.seedUser({
    id: 'off',
    username: 'off',
    pin: '1234',
    role: 'supervisor',
    disabledAt: NOW,
  });
});
afterEach(async () => {
  await env.cleanup();
  vi.unstubAllEnvs();
});

describe('authorizeDesk', () => {
  it('401 without a session', async () => {
    expect(await status(authorizeDesk(null, env.global))).toBe(401);
  });
  it('403 for a DB worker', async () => {
    expect(
      await status(authorizeDesk(claims('wrk', 'worker'), env.global)),
    ).toBe(403);
  });
  it('403 for a supervisor token whose DB role is now worker', async () => {
    expect(
      await status(authorizeDesk(claims('wrk', 'supervisor'), env.global)),
    ).toBe(403);
  });
  it('401 for a disabled user', async () => {
    expect(
      await status(authorizeDesk(claims('off', 'supervisor'), env.global)),
    ).toBe(401);
  });
  it('401 for an admin token whose user was deleted', async () => {
    expect(
      await status(authorizeDesk(claims('gone', 'admin'), env.global)),
    ).toBe(401);
  });
  it('passes supervisor and admin, returning the DB role and the token device', async () => {
    const sup = await authorizeDesk(claims('sup', 'supervisor'), env.global);
    expect(sup.role).toBe('supervisor');
    const adm = await authorizeDesk(claims('adm', 'admin'), env.global);
    expect(adm.role).toBe('admin');
    const onDevice = await authorizeDesk(
      claims('sup', 'supervisor', 'dev-1'),
      env.global,
    );
    expect(onDevice.deviceId).toBe('dev-1');
  });
  it('returns the DB role, not the token role (promoted user)', async () => {
    const s = await authorizeDesk(claims('adm', 'supervisor'), env.global);
    expect(s.role).toBe('admin');
  });
});

describe('authorizeAdmin', () => {
  it('passes an admin', async () => {
    const s = await authorizeAdmin(claims('adm', 'admin'), env.global);
    expect(s.role).toBe('admin');
  });
  it('403 for a supervisor, even with an admin token', async () => {
    expect(
      await status(authorizeAdmin(claims('sup', 'supervisor'), env.global)),
    ).toBe(403);
    expect(
      await status(authorizeAdmin(claims('sup', 'admin'), env.global)),
    ).toBe(403);
  });
  it('401 without a session, for a disabled or deleted user', async () => {
    expect(await status(authorizeAdmin(null, env.global))).toBe(401);
    expect(
      await status(authorizeAdmin(claims('off', 'admin'), env.global)),
    ).toBe(401);
    expect(
      await status(authorizeAdmin(claims('gone', 'admin'), env.global)),
    ).toBe(401);
  });
});

describe('assertSessionUserActive', () => {
  it('passes an active user', async () => {
    await expect(
      assertSessionUserActive(env.global, claims('wrk', 'worker', 'd')),
    ).resolves.toBeUndefined();
  });
  it('403 USER_DISABLED for a disabled or missing user', async () => {
    for (const id of ['off', 'gone']) {
      const thrown = await assertSessionUserActive(
        env.global,
        claims(id, 'worker', 'd'),
      ).catch((e) => e);
      expect((thrown as Response).status).toBe(403);
      expect((thrown as Response).headers.get('Content-Type')).toBe(
        'application/json',
      );
      expect(await (thrown as Response).json()).toEqual({
        error: 'USER_DISABLED',
      });
    }
  });
});

describe('deskSessionInfo', () => {
  it('is null for a disabled user and uses the DB role', async () => {
    expect(
      await deskSessionInfo(env.global, claims('off', 'supervisor')),
    ).toBeNull();
    expect(
      await deskSessionInfo(env.global, claims('wrk', 'supervisor')),
    ).toBeNull();
    expect(
      await deskSessionInfo(env.global, claims('adm', 'supervisor')),
    ).toEqual({ userId: 'adm', name: 'adm', role: 'admin' });
  });
});

describe('disabled users cannot sign in', () => {
  const deps = () => ({ global: env.global, now: () => NOW });

  beforeEach(async () => {
    await env.seedDevice({ id: 'd1', warehouses: [] });
    await env.seedUser({
      id: 'offw',
      username: 'offw',
      pin: '1234',
      disabledAt: NOW,
    });
  });

  it('handheld login with the correct PIN is BAD_CREDENTIALS', async () => {
    expect(
      await loginCore(deps(), {
        username: 'offw',
        pin: '1234',
        deviceId: 'd1',
      }),
    ).toEqual({ ok: false, reason: 'BAD_CREDENTIALS' });
  });

  it('desk login with the correct PIN is BAD_CREDENTIALS', async () => {
    expect(
      await deskLoginCore(deps(), { username: 'off', pin: '1234' }),
    ).toEqual({ ok: false, reason: 'BAD_CREDENTIALS' });
  });

  it('spends exactly one PIN verification, like any other login', async () => {
    const spy = vi.spyOn(password, 'verifyPin');
    await deskLoginCore(deps(), { username: 'off', pin: '1234' });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('counts toward lockout like any failed attempt', async () => {
    for (let i = 0; i < 5; i++) {
      expect(
        await deskLoginCore(deps(), { username: 'off', pin: '1234' }),
      ).toEqual({ ok: false, reason: 'BAD_CREDENTIALS' });
    }
    expect(
      await deskLoginCore(deps(), { username: 'off', pin: '1234' }),
    ).toEqual({ ok: false, reason: 'LOCKED' });
  });
});

describe('handheld sessions of disabled users', () => {
  it('replicaConfigCore throws 403 USER_DISABLED and mints nothing', async () => {
    await env.seedDevice({ id: 'd1', warehouses: [WH] });
    const mint = vi.fn();
    const thrown = await replicaConfigCore(
      {
        global: env.global,
        minter: { mint },
        urlFor: (n) => `libsql://${n}`,
        catalogDbName: 'cat',
      },
      claims('off', 'worker', 'd1'),
    ).catch((e) => e);
    expect((thrown as Response).status).toBe(403);
    expect(await (thrown as Response).json()).toEqual({
      error: 'USER_DISABLED',
    });
    expect(mint).not.toHaveBeenCalled();
  });

  describe('handleSync', () => {
    let deps: SyncDeps;
    let n = 0;
    const batch = (userId: string) => ({
      deviceId: 'd1',
      schemaVersion: SCHEMA_VERSIONS.warehouse,
      sentAt: NOW.toISOString(),
      movements: [
        {
          id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
          type: 'ADJUST',
          warehouseId: WH,
          userId,
          deviceId: 'd1',
          skuId: 'P1',
          locationId: 'L1',
          qty: 5,
          reasonCode: 'FOUND',
          occurredAt: '2026-03-01T08:00:00Z',
        },
      ],
    });

    beforeEach(async () => {
      await env.seedDevice({ id: 'd1', warehouses: [WH] });
      await env.seedProduct({ id: 'P1', sku: 'P1', countTolerance: 0 });
      await env.seedLocation(WH, { id: 'L1', code: 'L1' });
      const db = await env.warehouse(WH);
      deps = {
        global: env.global,
        catalog: env.catalog,
        warehouseDb: () => db,
        now: () => NOW,
        newId: () => crypto.randomUUID(),
        clockSkewThresholdMs: 120_000,
        transferStuckHours: 100_000,
      };
    });

    it('rejects a disabled session user with 403 USER_DISABLED and applies nothing', async () => {
      const thrown = await handleSync(
        deps,
        batch('off'),
        claims('off', 'worker', 'd1'),
      ).catch((e) => e);
      expect((thrown as Response).status).toBe(403);
      expect(await (thrown as Response).json()).toEqual({
        error: 'USER_DISABLED',
      });
      const db = await env.warehouse(WH);
      expect(await db.movement.count()).toBe(0);
    });

    it('still accepts rows recorded by a disabled user via another active session', async () => {
      const res = await handleSync(
        deps,
        batch('off'),
        claims('wrk', 'worker', 'd1'),
      );
      expect(res.status).toBe('ok');
      const db = await env.warehouse(WH);
      expect(await db.movement.count({ where: { userId: 'off' } })).toBe(1);
    });
  });
});
