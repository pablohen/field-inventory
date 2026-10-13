import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enrollDeviceInputSchema } from '#/admin/device-input';
import {
  type DeviceDeps,
  enrollDeviceCore,
  handleEnrollDevice,
  handleListDevices,
  handleSetDeviceRevoked,
  handleSetDeviceWarehouses,
  listDevicesAdminCore,
  setDeviceRevokedCore,
  setDeviceWarehousesCore,
} from '#/server/admin/devices.server';
import { loginCore } from '#/server/auth/login-core';
import type { SessionClaims } from '#/server/auth/session';
import { SCHEMA_VERSIONS } from '#/server/db/migrate';
import { replicaConfigCore } from '#/server/replicas/replica-config.server';
import type { TokenMinter } from '#/server/replicas/token-minter';
import { type SyncDeps, syncMovementsCore } from '#/server/sync/sync-movements';
import { createTestEnv, type TestEnv } from '../support/test-env';

const NOW = new Date('2026-03-01T12:00:00Z');
const LATER = new Date('2026-03-02T12:00:00Z');
const claims = (
  userId: string,
  role: SessionClaims['role'],
): SessionClaims => ({ userId, deviceId: 'desk', role, exp: 0 });
const INVALID = (message: string) => ({ ok: false, code: 'INVALID', message });

describe('enrollDeviceInputSchema', () => {
  const base = { id: 'dev-1', label: 'Dock scanner', warehouseIds: [] };
  it.each([
    { id: 'desk' },
    { id: '*' },
    { id: 'D1' },
    { id: 'a' },
    { id: '-ab' },
    { id: 'a'.repeat(65) },
    { label: '' },
    { label: 'x'.repeat(61) },
  ])('rejects %j', (patch) => {
    expect(
      enrollDeviceInputSchema.safeParse({ ...base, ...patch }).success,
    ).toBe(false);
  });
  it('accepts a valid input', () => {
    expect(enrollDeviceInputSchema.safeParse(base).success).toBe(true);
  });
});

describe('devices admin', () => {
  let env: TestEnv;
  let deps: DeviceDeps;

  beforeEach(async () => {
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(40));
    env = await createTestEnv();
    await env.seedWarehouse('w1');
    await env.seedWarehouse('w2');
    await env.seedWarehouse('w3');
    await env.seedUser({ id: 'worker', username: 'worker', pin: '1111' });
    await env.seedUser({
      id: 'supervisor',
      username: 'supervisor',
      pin: '2222',
      role: 'supervisor',
    });
    await env.seedUser({
      id: 'admin',
      username: 'admin',
      pin: '3333',
      role: 'admin',
    });
    deps = { global: env.global, now: () => NOW };
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await env.cleanup();
  });

  it('enrolls a device with its warehouses', async () => {
    expect(
      await enrollDeviceCore(deps, {
        id: 'dev-1',
        label: 'Dock',
        warehouseIds: ['w2', 'w1'],
      }),
    ).toEqual({ ok: true, id: 'dev-1' });
    const list = await listDevicesAdminCore(deps);
    expect(list.devices).toHaveLength(1);
    expect(list.devices[0]).toMatchObject({
      id: 'dev-1',
      label: 'Dock',
      revoked: false,
      warehouseIds: ['w1', 'w2'],
    });
    expect(list.devices[0].enrolledAt).toBeInstanceOf(Date);
  });

  it('rejects a duplicate id', async () => {
    await env.seedDevice({ id: 'dev-1', warehouses: [] });
    expect(
      await enrollDeviceCore(deps, {
        id: 'dev-1',
        label: 'Again',
        warehouseIds: [],
      }),
    ).toEqual(INVALID('Device dev-1 is already enrolled'));
  });

  it('rejects unknown warehouses and writes nothing', async () => {
    expect(
      await enrollDeviceCore(deps, {
        id: 'dev-2',
        label: 'X',
        warehouseIds: ['w1', 'nope'],
      }),
    ).toEqual(INVALID('Unknown warehouse: nope'));
    expect(await env.global.device.count()).toBe(0);
    expect(await env.global.deviceWarehouse.count()).toBe(0);
  });

  it('lists by label case-insensitively', async () => {
    for (const [id, label] of [
      ['d-a', 'bravo'],
      ['d-b', 'Alpha'],
      ['d-c', 'charlie'],
    ]) {
      await enrollDeviceCore(deps, { id, label, warehouseIds: [] });
    }
    expect(
      (await listDevicesAdminCore(deps)).devices.map((d) => d.label),
    ).toEqual(['Alpha', 'bravo', 'charlie']);
  });

  it('replaces the warehouse set and rejects unknown ones atomically', async () => {
    await env.seedDevice({ id: 'dev-1', warehouses: ['w1', 'w2'] });
    expect(await setDeviceWarehousesCore(deps, 'dev-1', ['w2', 'w3'])).toEqual({
      ok: true,
    });
    expect((await listDevicesAdminCore(deps)).devices[0].warehouseIds).toEqual([
      'w2',
      'w3',
    ]);
    expect(await setDeviceWarehousesCore(deps, 'dev-1', ['w1', 'zzz'])).toEqual(
      INVALID('Unknown warehouse: zzz'),
    );
    expect((await listDevicesAdminCore(deps)).devices[0].warehouseIds).toEqual([
      'w2',
      'w3',
    ]);
    expect(await setDeviceWarehousesCore(deps, 'dev-1', [])).toEqual({
      ok: true,
    });
    expect((await listDevicesAdminCore(deps)).devices[0].warehouseIds).toEqual(
      [],
    );
    expect(await setDeviceWarehousesCore(deps, 'ghost', ['w1'])).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('changes what replicaConfigCore returns for the device', async () => {
    await env.seedDevice({ id: 'dev-1', warehouses: ['w1'] });
    const minter: TokenMinter = {
      mint: async (db) => ({ token: `t-${db}`, expiresAt: 'x' }),
    };
    const rdeps = {
      global: env.global,
      minter,
      urlFor: (db: string) => `libsql://${db}`,
      catalogDbName: 'cat',
    };
    const session: SessionClaims = {
      userId: 'worker',
      deviceId: 'dev-1',
      role: 'worker',
      exp: 0,
    };
    const names = async () =>
      (await replicaConfigCore(rdeps, session)).replicas.map((r) => r.name);
    expect(await names()).toEqual(['catalog', 'w1']);
    await setDeviceWarehousesCore(deps, 'dev-1', ['w3', 'w2']);
    expect(await names()).toEqual(['catalog', 'w2', 'w3']);
    await setDeviceWarehousesCore(deps, 'dev-1', []);
    expect(await names()).toEqual(['catalog']);
  });

  it('revoke blocks login and sync; restore allows them again', async () => {
    await env.seedWarehouse('wh1');
    await env.seedDevice({ id: 'dev-1', warehouses: ['wh1'] });
    await env.seedUser({ id: 'u1', username: 'u1', pin: '1234' });
    await env.seedProduct({ id: 'P1', sku: 'P1' });
    await env.seedLocation('wh1', { id: 'L1', code: 'L1' });
    const db = await env.warehouse('wh1');
    let n = 0;
    const syncDeps: SyncDeps = {
      global: env.global,
      catalog: env.catalog,
      warehouseDb: () => db,
      now: () => NOW,
      newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      clockSkewThresholdMs: 120_000,
      transferStuckHours: 24,
    };
    const sync = () =>
      syncMovementsCore(syncDeps, {
        deviceId: 'dev-1',
        schemaVersion: SCHEMA_VERSIONS.warehouse,
        sentAt: NOW.toISOString(),
        movements: [
          {
            id: `10000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
            type: 'ADJUST',
            warehouseId: 'wh1',
            skuId: 'P1',
            userId: 'u1',
            deviceId: 'dev-1',
            occurredAt: '2026-03-01T09:00:00Z',
            locationId: 'L1',
            qty: 10,
            reasonCode: 'FOUND',
          },
        ],
      });
    const login = () =>
      loginCore(deps, { username: 'u1', pin: '1234', deviceId: 'dev-1' });

    expect((await login()).ok).toBe(true);
    expect((await sync()).status).toBe('ok');

    expect(await setDeviceRevokedCore(deps, 'dev-1', true)).toEqual({
      ok: true,
    });
    expect(await login()).toEqual({ ok: false, reason: 'DEVICE_REVOKED' });
    expect((await sync()).status).toBe('DEVICE_REVOKED');

    expect(await setDeviceRevokedCore(deps, 'dev-1', false)).toEqual({
      ok: true,
    });
    expect((await login()).ok).toBe(true);
    expect((await sync()).status).toBe('ok');
  });

  it('keeps the original revocation time when revoked twice', async () => {
    await env.seedDevice({ id: 'dev-1', warehouses: [] });
    await setDeviceRevokedCore(deps, 'dev-1', true);
    await setDeviceRevokedCore({ ...deps, now: () => LATER }, 'dev-1', true);
    const d = await env.global.device.findUnique({ where: { id: 'dev-1' } });
    expect(d?.revokedAt).toEqual(NOW);
    expect(await setDeviceRevokedCore(deps, 'ghost', true)).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  describe('admin-only authorization', () => {
    const calls: [string, (c: SessionClaims | null) => Promise<unknown>][] = [
      ['list', (c) => handleListDevices(c, {}, deps)],
      [
        'enroll',
        (c) =>
          handleEnrollDevice(
            c,
            { id: 'new-dev', label: 'N', warehouseIds: ['w1'] },
            deps,
          ),
      ],
      [
        'setWarehouses',
        (c) =>
          handleSetDeviceWarehouses(
            c,
            { deviceId: 'dev-x', warehouseIds: ['w2'] },
            deps,
          ),
      ],
      [
        'setRevoked',
        (c) =>
          handleSetDeviceRevoked(c, { deviceId: 'dev-x', revoked: true }, deps),
      ],
    ];
    beforeEach(async () => {
      await env.seedDevice({ id: 'dev-x', warehouses: ['w1'] });
    });
    const unchanged = async () => {
      const devs = await env.global.device.findMany();
      const links = await env.global.deviceWarehouse.findMany();
      expect(devs.map((d) => d.id)).toEqual(['dev-x']);
      expect(devs[0].revokedAt).toBeNull();
      expect(links.map((l) => l.warehouseId)).toEqual(['w1']);
    };
    it.each(calls)('%s: supervisor gets 403', async (_n, call) => {
      const err = (await call(claims('supervisor', 'supervisor')).catch(
        (e) => e,
      )) as Response;
      expect(err).toBeInstanceOf(Response);
      expect(err.status).toBe(403);
      await unchanged();
    });
    it.each(calls)('%s: no session gets 401', async (_n, call) => {
      const err = (await call(null).catch((e) => e)) as Response;
      expect(err.status).toBe(401);
      await unchanged();
    });
    it('admin succeeds', async () => {
      const admin = claims('admin', 'admin');
      expect(
        await handleSetDeviceRevoked(
          admin,
          { deviceId: 'dev-x', revoked: true },
          deps,
        ),
      ).toEqual({ ok: true });
    });
  });
});
