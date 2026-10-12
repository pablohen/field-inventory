import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionClaims } from '#/server/auth/session';
import { handleListLocations } from '#/server/desk/locations.server';
import { createTestEnv, type TestEnv } from '../support/test-env';

const WH = 'wh1';
const claims = (role: SessionClaims['role']): SessionClaims => ({
  userId: 'u',
  deviceId: 'desk',
  role,
  exp: 0,
});

describe('handleListLocations', () => {
  let env: TestEnv;
  let deps: Parameters<typeof handleListLocations>[2];

  beforeEach(async () => {
    env = await createTestEnv();
    await env.seedDevice({ id: 'dev1', warehouses: [WH] });
    await env.seedLocation(WH, { id: 'L2', code: 'B-01', active: false });
    await env.seedLocation(WH, { id: 'L1', code: 'A-01' });
    const db = await env.warehouse(WH);
    deps = { global: env.global, warehouseDb: () => db };
  });
  afterEach(() => env.cleanup());

  it('lists all bins ordered by code, flagging inactive', async () => {
    const r = await handleListLocations(
      claims('supervisor'),
      { warehouseId: WH },
      deps,
    );
    expect(r).toEqual({
      ok: true,
      locations: [
        { id: 'L1', code: 'A-01', zone: null, active: true },
        { id: 'L2', code: 'B-01', zone: null, active: false },
      ],
    });
  });

  it('returns NOT_FOUND for an unknown warehouse', async () => {
    const r = await handleListLocations(
      claims('admin'),
      { warehouseId: 'nope' },
      deps,
    );
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('rejects workers with 403 and no session with 401', async () => {
    await expect(
      handleListLocations(claims('worker'), { warehouseId: WH }, deps),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      handleListLocations(null, { warehouseId: WH }, deps),
    ).rejects.toMatchObject({ status: 401 });
  });
});
