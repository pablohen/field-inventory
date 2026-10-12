import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWarehouseInputSchema,
  type WarehouseStatus,
} from '#/admin/warehouse-input';
import { SCHEMA_VERSIONS } from '#/domain/schema-versions';
import {
  fileProvisioner,
  tursoProvisioner,
  type WarehouseProvisioner,
} from '#/server/admin/provisioner';
import {
  createWarehouseCore,
  finishWarehouseSetupCore,
  handleCreateWarehouse,
  handleFinishWarehouseSetup,
  handleListWarehousesAdmin,
  handleRenameWarehouse,
  listWarehousesAdminCore,
  type ProvisionDeps,
  renameWarehouseCore,
} from '#/server/admin/warehouses.server';
import { warehouseUrl } from '#/server/db/clients';
import { migrateWarehouseDb } from '#/server/db/migrate-warehouse';
import { createTestEnv, type TestEnv } from '../support/test-env';

describe('tursoProvisioner', () => {
  const cfg = { org: 'acme', platformToken: 'tok', group: 'grp' };

  it('posts the exact URL, body and bearer header', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    await tursoProvisioner(
      cfg,
      fetchFn as unknown as typeof fetch,
    ).ensureDatabase('fi-x');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.turso.tech/v1/organizations/acme/databases');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'fi-x',
      group: 'grp',
    });
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    );
  });

  it('treats 409 as success and throws on 500', async () => {
    const f409 = (async () =>
      new Response('', { status: 409 })) as typeof fetch;
    await expect(
      tursoProvisioner(cfg, f409).ensureDatabase('fi-x'),
    ).resolves.toBeUndefined();
    const f500 = (async () =>
      new Response('', { status: 500 })) as typeof fetch;
    await expect(
      tursoProvisioner(cfg, f500).ensureDatabase('fi-x'),
    ).rejects.toThrow(/fi-x.*500/);
  });
});

describe('createWarehouseInputSchema', () => {
  it.each(['Wh_1', '-x', 'a'.repeat(30)])('rejects id %s', (id) => {
    expect(
      createWarehouseInputSchema.safeParse({ id, name: 'N' }).success,
    ).toBe(false);
  });
  it('accepts a good id and trims the name', () => {
    expect(
      createWarehouseInputSchema.parse({ id: 'north-1', name: '  North ' }),
    ).toEqual({ id: 'north-1', name: 'North' });
  });
});

describe('warehouse provisioning', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
  });
  afterEach(() => env.cleanup());

  const deps = (over: Partial<ProvisionDeps> = {}): ProvisionDeps => ({
    global: env.global,
    provisioner: fileProvisioner(),
    migrate: migrateWarehouseDb,
    ...over,
  });
  const failingOnce = (): WarehouseProvisioner => ({
    ensureDatabase: vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined),
  });
  const statusOf = async (id: string): Promise<WarehouseStatus | undefined> =>
    (await listWarehousesAdminCore(env.global)).find((w) => w.id === id)
      ?.status;

  it('creates a READY warehouse with every table', async () => {
    const r = await createWarehouseCore(deps(), { id: 'north', name: 'North' });
    expect(r).toEqual({ ok: true, status: 'READY' });
    const row = await env.global.warehouse.findUnique({
      where: { id: 'north' },
    });
    expect(row).toMatchObject({
      tursoDbName: 'fi-north',
      schemaVersion: SCHEMA_VERSIONS.warehouse,
    });
    const c = createClient({ url: warehouseUrl('fi-north') });
    try {
      const t = await c.execute(
        "SELECT name FROM sqlite_master WHERE type='table'",
      );
      const names = t.rows.map((x) => String(x.name));
      for (const n of ['Location', 'PickList', 'PickLine'])
        expect(names).toContain(n);
    } finally {
      c.close();
    }
  });

  it('keeps the row SETUP_INCOMPLETE when provisioning fails, then finishes', async () => {
    const provisioner = failingOnce();
    const r = await createWarehouseCore(deps({ provisioner }), {
      id: 'north',
      name: 'North',
    });
    expect(r).toEqual({
      ok: false,
      code: 'NOT_READY',
      message: 'Setup incomplete: boom',
    });
    expect(await statusOf('north')).toBe('SETUP_INCOMPLETE');
    const ok = { ok: true, status: 'READY' };
    expect(
      await finishWarehouseSetupCore(deps({ provisioner }), 'north'),
    ).toEqual(ok);
    expect(await statusOf('north')).toBe('READY');
    expect(
      await finishWarehouseSetupCore(deps({ provisioner }), 'north'),
    ).toEqual(ok);
  });

  it('keeps SETUP_INCOMPLETE when migrate throws, finish later succeeds', async () => {
    const migrate = vi
      .fn()
      .mockRejectedValueOnce(new Error('mig fail'))
      .mockImplementation(migrateWarehouseDb);
    const r = await createWarehouseCore(deps({ migrate }), {
      id: 'north',
      name: 'North',
    });
    expect(r).toMatchObject({ ok: false, code: 'NOT_READY' });
    expect(await statusOf('north')).toBe('SETUP_INCOMPLETE');
    expect(await finishWarehouseSetupCore(deps({ migrate }), 'north')).toEqual({
      ok: true,
      status: 'READY',
    });
  });

  it('rejects a duplicate id and reports NOT_FOUND on finish', async () => {
    await createWarehouseCore(deps(), { id: 'north', name: 'North' });
    expect(
      await createWarehouseCore(deps(), { id: 'north', name: 'Other' }),
    ).toEqual({
      ok: false,
      code: 'INVALID',
      message: 'Warehouse north already exists',
    });
    expect(await finishWarehouseSetupCore(deps(), 'nope')).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('lists status and deviceCount; NEEDS_MIGRATION is finishable', async () => {
    await createWarehouseCore(deps(), { id: 'north', name: 'North' });
    await env.seedDevice({ id: 'd1', warehouses: ['north'] });
    await env.seedDevice({ id: 'd2', warehouses: ['north'] });
    await env.global.warehouse.update({
      where: { id: 'north' },
      data: { schemaVersion: 0 },
    });
    expect((await listWarehousesAdminCore(env.global))[0]).toMatchObject({
      id: 'north',
      deviceCount: 2,
      status: 'SETUP_INCOMPLETE',
    });
    expect(await finishWarehouseSetupCore(deps(), 'north')).toEqual({
      ok: true,
      status: 'READY',
    });
  });

  it('renames, trimming, and validates', async () => {
    await createWarehouseCore(deps(), { id: 'north', name: 'North' });
    expect(await renameWarehouseCore(deps(), 'north', '  Nord ')).toEqual({
      ok: true,
    });
    expect(
      (await env.global.warehouse.findUnique({ where: { id: 'north' } }))?.name,
    ).toBe('Nord');
    expect(await renameWarehouseCore(deps(), 'north', '  ')).toMatchObject({
      code: 'INVALID',
    });
    expect(await renameWarehouseCore(deps(), 'zz', 'X')).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('admin handlers: supervisor gets 403, null gets 401, admin succeeds', async () => {
    await env.seedUser({
      id: 'sup',
      username: 'sup',
      pin: '1',
      role: 'supervisor',
    });
    await env.seedUser({ id: 'adm', username: 'adm', pin: '1', role: 'admin' });
    const claims = (userId: string) => ({
      userId,
      deviceId: 'desk',
      role: 'admin' as const,
      exp: 0,
    });
    type Claims = ReturnType<typeof claims> | null;
    const calls: Record<string, (c: Claims) => Promise<unknown>> = {
      list: (c) => handleListWarehousesAdmin(c, { global: env.global }),
      create: (c) =>
        handleCreateWarehouse(c, { id: 'north', name: 'N' }, deps()),
      finish: (c) => handleFinishWarehouseSetup(c, { id: 'north' }, deps()),
      rename: (c) =>
        handleRenameWarehouse(
          c,
          { id: 'north', name: 'X' },
          { global: env.global },
        ),
    };
    for (const [name, call] of Object.entries(calls)) {
      await expect(call(claims('sup')), name).rejects.toMatchObject({
        status: 403,
      });
      await expect(call(null), name).rejects.toMatchObject({ status: 401 });
    }
    expect(await calls.create?.(claims('adm'))).toEqual({
      ok: true,
      status: 'READY',
    });
  });
});
