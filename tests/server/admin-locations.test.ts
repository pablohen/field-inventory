import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { locationInputSchema } from '#/admin/location-input';
import {
  createLocationCore,
  handleCreateLocation,
  handleListLocationsAdmin,
  handleSetLocationActive,
  handleUpdateLocation,
  type LocationDeps,
  listLocationsAdminCore,
  setLocationActiveCore,
  updateLocationCore,
} from '#/server/admin/locations.server';
import type { SessionClaims } from '#/server/auth/session';
import {
  type ResolveDeps,
  type ResolveInput,
  resolveExceptionCore,
} from '#/server/desk/exceptions.server';
import { handleListLocations } from '#/server/desk/locations.server';
import {
  createPickListCore,
  type PickListDeps,
} from '#/server/desk/pick-lists.server';
import type { DeskSession } from '#/server/desk/session';
import { createTestEnv, type TestEnv } from '../support/test-env';

const WH = 'wh1';
const NOW = new Date('2026-03-01T12:00:00Z');
const claims = (role: SessionClaims['role']): SessionClaims => ({
  userId: role,
  deviceId: 'desk',
  role,
  exp: 0,
});
const session: DeskSession = {
  userId: 'supervisor',
  deviceId: 'desk',
  role: 'supervisor',
  exp: 0,
};

describe('locationInputSchema', () => {
  it.each(['', 'a b', 'x'.repeat(21), 'a_b'])('rejects code %j', (code) => {
    expect(locationInputSchema.safeParse({ code }).success).toBe(false);
  });
  it('trims and accepts', () => {
    expect(locationInputSchema.parse({ code: ' A-01 ', zone: ' Z ' })).toEqual({
      code: 'A-01',
      zone: 'Z',
    });
  });
  it('rejects a zone over 20 chars', () => {
    expect(
      locationInputSchema.safeParse({ code: 'A', zone: 'z'.repeat(21) })
        .success,
    ).toBe(false);
  });
});

describe('locations admin', () => {
  let env: TestEnv;
  let deps: LocationDeps;

  beforeEach(async () => {
    env = await createTestEnv();
    await env.seedDevice({ id: 'dev1', warehouses: [WH] });
    for (const role of ['worker', 'supervisor', 'admin'] as const) {
      await env.seedUser({ id: role, username: role, pin: '1', role });
    }
    await env.seedProduct({ id: 'P1', sku: 'P1' });
    const db = await env.warehouse(WH);
    deps = { global: env.global, warehouseDb: () => db };
  });
  afterEach(() => env.cleanup());

  it('creates with id <warehouse>-<code> and lists it', async () => {
    const r = await createLocationCore(deps, WH, {
      code: 'A-01',
      zone: 'North',
    });
    expect(r).toEqual({ ok: true, id: 'wh1-A-01' });
    const list = await listLocationsAdminCore(deps, WH);
    expect(list).toEqual({
      ok: true,
      locations: [
        {
          id: 'wh1-A-01',
          code: 'A-01',
          zone: 'North',
          active: true,
          stockUnits: 0,
        },
      ],
    });
  });

  it('rejects a duplicate code on create and update', async () => {
    await createLocationCore(deps, WH, { code: 'A-01' });
    expect(await createLocationCore(deps, WH, { code: 'A-01' })).toEqual({
      ok: false,
      code: 'INVALID',
      message: 'Code A-01 is already used',
    });
    await createLocationCore(deps, WH, { code: 'A-02' });
    expect(
      await updateLocationCore(deps, WH, 'wh1-A-02', { code: 'A-01' }),
    ).toEqual({
      ok: false,
      code: 'INVALID',
      message: 'Code A-01 is already used',
    });
  });

  it('update changes code and zone but keeps the id; unknown is NOT_FOUND', async () => {
    await createLocationCore(deps, WH, { code: 'A-01', zone: 'N' });
    expect(
      await updateLocationCore(deps, WH, 'wh1-A-01', {
        code: 'B-09',
        zone: '',
      }),
    ).toEqual({ ok: true });
    const db = await env.warehouse(WH);
    expect(
      await db.location.findUniqueOrThrow({ where: { id: 'wh1-A-01' } }),
    ).toMatchObject({ code: 'B-09', zone: null });
    expect(
      await updateLocationCore(deps, WH, 'nope', { code: 'C' }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('toggles active; deactivating a stocked location warns', async () => {
    await createLocationCore(deps, WH, { code: 'A-01' });
    const db = await env.warehouse(WH);
    expect(await setLocationActiveCore(deps, WH, 'wh1-A-01', false)).toEqual({
      ok: true,
    });
    expect(
      (await db.location.findUniqueOrThrow({ where: { id: 'wh1-A-01' } }))
        .active,
    ).toBe(false);
    await setLocationActiveCore(deps, WH, 'wh1-A-01', true);

    await db.stockBalance.create({
      data: { skuId: 'P1', locationId: 'wh1-A-01', qty: 7 },
    });
    await db.stockBalance.create({
      data: { skuId: 'P2', locationId: 'wh1-A-01', qty: -3 },
    });
    expect(await listLocationsAdminCore(deps, WH)).toMatchObject({
      locations: [{ stockUnits: 7 }],
    });
    expect(await setLocationActiveCore(deps, WH, 'wh1-A-01', false)).toEqual({
      ok: true,
      warning: 'Location still holds 7 units',
    });
    expect(
      (await db.location.findUniqueOrThrow({ where: { id: 'wh1-A-01' } }))
        .active,
    ).toBe(false);
    expect(await setLocationActiveCore(deps, WH, 'nope', false)).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('NOT_FOUND for an unknown warehouse', async () => {
    expect(await listLocationsAdminCore(deps, 'nope')).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('handlers: supervisor and worker get 403, no session 401, admin ok', async () => {
    const calls = (c: SessionClaims | null) => [
      handleListLocationsAdmin(c, { warehouseId: WH }, deps),
      handleCreateLocation(c, { warehouseId: WH, code: 'Z' }, deps),
      handleUpdateLocation(
        c,
        { warehouseId: WH, locationId: 'x', code: 'Z' },
        deps,
      ),
      handleSetLocationActive(
        c,
        { warehouseId: WH, locationId: 'x', active: false },
        deps,
      ),
    ];
    for (const p of calls(claims('supervisor')))
      await expect(p).rejects.toMatchObject({ status: 403 });
    for (const p of calls(claims('worker')))
      await expect(p).rejects.toMatchObject({ status: 403 });
    for (const p of calls(null))
      await expect(p).rejects.toMatchObject({ status: 401 });
    expect(
      await handleCreateLocation(
        claims('admin'),
        { warehouseId: WH, code: 'Z' },
        deps,
      ),
    ).toEqual({ ok: true, id: 'wh1-Z' });
  });

  it('desk listLocations still returns inactive locations flagged', async () => {
    await createLocationCore(deps, WH, { code: 'A-01' });
    await setLocationActiveCore(deps, WH, 'wh1-A-01', false);
    const r = await handleListLocations(
      claims('supervisor'),
      { warehouseId: WH },
      deps,
    );
    expect(r).toEqual({
      ok: true,
      locations: [{ id: 'wh1-A-01', code: 'A-01', zone: null, active: false }],
    });
  });

  describe('Review Focus 5: active re-check inside the transaction', () => {
    it('createPickListCore: location deactivated after validation -> INVALID, no PickList', async () => {
      await createLocationCore(deps, WH, { code: 'A-01' });
      const db = await env.warehouse(WH);
      const pickDeps: PickListDeps = {
        global: env.global,
        catalog: env.catalog,
        warehouseDb: () => db,
        newId: () => crypto.randomUUID(),
        afterValidate: async () => {
          await db.location.update({
            where: { id: 'wh1-A-01' },
            data: { active: false },
          });
        },
      };
      const r = await createPickListCore(pickDeps, session, WH, {
        lines: [{ skuId: 'P1', locationId: 'wh1-A-01', qty: 2 }],
      });
      expect(r).toEqual({
        ok: false,
        code: 'INVALID',
        message: 'Location A-01 is inactive',
      });
      expect(await db.pickList.count()).toBe(0);
      expect(await db.pickLine.count()).toBe(0);
    });

    describe('resolveExceptionCore', () => {
      let resolveDeps: ResolveDeps;
      let exId: string;
      let version: number;

      beforeEach(async () => {
        await createLocationCore(deps, WH, { code: 'A-01' });
        await env.catalog.reasonCode.create({
          data: { code: 'FOUND', label: 'Found', appliesTo: '["ADJUST"]' },
        });
        const db = await env.warehouse(WH);
        const ex = await db.exception.create({
          data: {
            id: 'ex1',
            type: 'NEGATIVE_BALANCE',
            movementIds: '[]',
            skuId: 'P1',
            locationId: 'wh1-A-01',
            details: '{}',
            status: 'OPEN',
            version: 1,
            createdAt: NOW,
          },
        });
        exId = ex.id;
        version = ex.version;
        resolveDeps = {
          global: env.global,
          catalog: env.catalog,
          warehouseDb: () => db,
          now: () => NOW,
          newId: () => crypto.randomUUID(),
          afterValidate: async () => {
            await db.location.update({
              where: { id: 'wh1-A-01' },
              data: { active: false },
            });
          },
        };
      });

      const adjust = (): ResolveInput => ({
        action: 'adjust',
        version,
        qty: 3,
        reasonCode: 'FOUND',
      });

      it('adjust: INVALID, exception stays OPEN at the same version, no movement', async () => {
        const r = await resolveExceptionCore(
          resolveDeps,
          session,
          WH,
          exId,
          adjust(),
        );
        expect(r).toEqual({
          ok: false,
          code: 'INVALID',
          message: 'Location A-01 is inactive',
        });
        const db = await env.warehouse(WH);
        expect(
          await db.exception.findUniqueOrThrow({ where: { id: exId } }),
        ).toMatchObject({ status: 'OPEN', version });
        expect(await db.movement.count()).toBe(0);
      });

      it('recount: INVALID, exception OPEN, no count task', async () => {
        const r = await resolveExceptionCore(resolveDeps, session, WH, exId, {
          action: 'recount',
          version,
        });
        expect(r).toMatchObject({ ok: false, code: 'INVALID' });
        const db = await env.warehouse(WH);
        expect(
          await db.exception.findUniqueOrThrow({ where: { id: exId } }),
        ).toMatchObject({ status: 'OPEN', version });
        expect(await db.countTask.count()).toBe(0);
      });

      it('an already-resolved exception reports CONFLICT before the inactive check', async () => {
        const db = await env.warehouse(WH);
        await db.exception.update({
          where: { id: exId },
          data: { status: 'RESOLVED', version: version + 1 },
        });
        const r = await resolveExceptionCore(
          resolveDeps,
          session,
          WH,
          exId,
          adjust(),
        );
        expect(r).toMatchObject({ ok: false, code: 'CONFLICT' });
      });
    });
  });
});
