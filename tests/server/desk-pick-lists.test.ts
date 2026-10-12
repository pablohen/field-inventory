import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assignedPickLists } from '#/handheld/stock';
import type { SessionClaims } from '#/server/auth/session';
import { SCHEMA_VERSIONS } from '#/server/db/migrate';
import {
  assignPickListCore,
  closePickListCore,
  createPickListCore,
  createPickListInputSchema,
  handleAssignPickList,
  handleClosePickList,
  handleCreatePickList,
  handleListPickLists,
  handleSuggestPickList,
  listPickListsCore,
  type PickListDeps,
  suggestBins,
  suggestPickListCore,
} from '#/server/desk/pick-lists.server';
import type { DeskSession } from '#/server/desk/session';
import { type SyncDeps, syncMovementsCore } from '#/server/sync/sync-movements';
import { libsqlSql } from '../support/handheld-sql';
import { createTestEnv, type TestEnv } from '../support/test-env';

const NOW = new Date('2026-03-01T12:00:00Z');
const WH = 'wh1';
const DEV = 'dev1';

describe('suggestBins', () => {
  const bins = (...b: [string, number][]) =>
    b.map(([locationId, qty]) => ({ skuId: 'S', locationId, qty }));

  it('splits greedily across bins, largest first', () => {
    expect(
      suggestBins([{ skuId: 'S', qty: 15 }], bins(['B', 8], ['A', 10])),
    ).toEqual({
      lines: [
        { skuId: 'S', locationId: 'A', qty: 10 },
        { skuId: 'S', locationId: 'B', qty: 5 },
      ],
      shortfalls: [],
    });
  });

  it('reports a shortfall when stock is insufficient', () => {
    expect(
      suggestBins([{ skuId: 'S', qty: 25 }], bins(['A', 10], ['B', 8])),
    ).toEqual({
      lines: [
        { skuId: 'S', locationId: 'A', qty: 10 },
        { skuId: 'S', locationId: 'B', qty: 8 },
      ],
      shortfalls: [{ skuId: 'S', missing: 7 }],
    });
  });

  it('gives a null-location line and full shortfall for a SKU with no stock', () => {
    expect(suggestBins([{ skuId: 'S', qty: 4 }], [])).toEqual({
      lines: [{ skuId: 'S', locationId: null, qty: 4 }],
      shortfalls: [{ skuId: 'S', missing: 4 }],
    });
  });

  it('ignores negative and zero bins', () => {
    const r = suggestBins(
      [{ skuId: 'S', qty: 3 }],
      bins(['A', -2], ['B', 0], ['C', 5]),
    );
    expect(r.lines).toEqual([{ skuId: 'S', locationId: 'C', qty: 3 }]);
    expect(r.shortfalls).toEqual([]);
  });

  it('does not double-allocate when a SKU is requested twice', () => {
    expect(
      suggestBins(
        [
          { skuId: 'S', qty: 10 },
          { skuId: 'S', qty: 10 },
        ],
        bins(['A', 10]),
      ),
    ).toEqual({
      lines: [
        { skuId: 'S', locationId: 'A', qty: 10 },
        { skuId: 'S', locationId: null, qty: 10 },
      ],
      shortfalls: [{ skuId: 'S', missing: 10 }],
    });
    expect(
      suggestBins(
        [
          { skuId: 'S', qty: 6 },
          { skuId: 'S', qty: 6 },
        ],
        bins(['A', 10]),
      ),
    ).toEqual({
      lines: [
        { skuId: 'S', locationId: 'A', qty: 6 },
        { skuId: 'S', locationId: 'A', qty: 4 },
      ],
      shortfalls: [{ skuId: 'S', missing: 2 }],
    });
  });

  it('breaks ties by locationId and never emits qty <= 0', () => {
    const r = suggestBins(
      [
        { skuId: 'S', qty: 6 },
        { skuId: 'T', qty: 2 },
      ],
      [
        ...bins(['B', 4], ['A', 4], ['C', -2]),
        { skuId: 'T', locationId: 'A', qty: 0 },
      ],
    );
    expect(r.lines.slice(0, 2)).toEqual([
      { skuId: 'S', locationId: 'A', qty: 4 },
      { skuId: 'S', locationId: 'B', qty: 2 },
    ]);
    for (const l of r.lines) expect(l.qty).toBeGreaterThan(0);
    expect(r.shortfalls).toEqual([{ skuId: 'T', missing: 2 }]);
  });
});

describe('pick lists', () => {
  let env: TestEnv;
  let deps: PickListDeps;
  let syncDeps: SyncDeps;
  let counter = 0;
  const uuid = () =>
    `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  const session: DeskSession = {
    userId: 'sup',
    deviceId: 'desk',
    role: 'supervisor',
    exp: 0,
  };

  beforeEach(async () => {
    counter = 0;
    env = await createTestEnv();
    await env.seedDevice({ id: DEV, warehouses: [WH] });
    await env.seedUser({ id: 'w1', username: 'w1', pin: '1234' });
    await env.seedUser({
      id: 'sup',
      username: 'sup',
      pin: '1234',
      role: 'supervisor',
    });
    await env.seedProduct({ id: 'P1', sku: 'SKU-1' });
    await env.seedLocation(WH, { id: 'L1', code: 'A-01' });
    await env.seedLocation(WH, { id: 'L2', code: 'A-02', active: false });
    const db = await env.warehouse(WH);
    deps = {
      global: env.global,
      catalog: env.catalog,
      warehouseDb: () => db,
      newId: uuid,
    };
    syncDeps = {
      global: env.global,
      catalog: env.catalog,
      warehouseDb: () => db,
      now: () => NOW,
      newId: uuid,
      clockSkewThresholdMs: 120_000,
      transferStuckHours: 100_000,
    };
  });
  afterEach(() => env.cleanup());

  async function create(assignedUserId?: string) {
    const r = await createPickListCore(deps, session, WH, {
      lines: [{ skuId: 'P1', locationId: 'L1', qty: 5 }],
      assignedUserId,
    });
    if (!r.ok) throw new Error(r.message);
    return r.id;
  }
  async function lists(status?: 'OPEN' | 'DONE') {
    const r = await listPickListsCore(deps, WH, { status });
    if (!r.ok) throw new Error(r.message);
    return r.lists;
  }

  it('suggests bins over current balances', async () => {
    const db = await env.warehouse(WH);
    await db.stockBalance.create({
      data: { skuId: 'P1', locationId: 'L1', qty: 4 },
    });
    const r = await suggestPickListCore(deps, WH, [{ skuId: 'P1', qty: 6 }]);
    expect(r).toEqual({
      ok: true,
      lines: [{ skuId: 'P1', locationId: 'L1', qty: 4 }],
      shortfalls: [{ skuId: 'P1', missing: 2 }],
    });
  });

  it('rejects suggestions for SKUs not in the catalog', async () => {
    expect(
      await suggestPickListCore(deps, WH, [{ skuId: 'NOPE', qty: 1 }]),
    ).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('rejects assigning a closed list', async () => {
    const id = await create();
    await closePickListCore(deps, WH, id);
    expect(await assignPickListCore(deps, WH, id, 'w1')).toMatchObject({
      ok: false,
      code: 'INVALID',
      message: 'Pick list is closed',
    });
  });

  it('creates an OPEN list with its lines', async () => {
    const id = await create('w1');
    const all = await lists();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id,
      status: 'OPEN',
      createdBy: 'sup',
      assignedUserId: 'w1',
      assignedUserName: 'w1',
    });
    expect(all[0].lines).toEqual([
      {
        id: expect.any(String),
        skuId: 'P1',
        locationId: 'L1',
        qtyRequested: 5,
        pickedQty: 0,
      },
    ]);
  });

  it('rejects an inactive location, an unknown SKU and a non-worker assignee', async () => {
    const bad = async (
      line: { skuId: string; locationId: string },
      assignedUserId?: string,
    ) =>
      createPickListCore(deps, session, WH, {
        lines: [{ ...line, qty: 1 }],
        assignedUserId,
      });
    const inactive = await bad({ skuId: 'P1', locationId: 'L2' });
    expect(inactive).toMatchObject({ ok: false, code: 'INVALID' });
    expect(inactive.ok ? '' : inactive.message).toContain('Line 1');
    expect(await bad({ skuId: 'NOPE', locationId: 'L1' })).toMatchObject({
      ok: false,
      code: 'INVALID',
    });
    expect(await bad({ skuId: 'P1', locationId: 'L1' }, 'sup')).toMatchObject({
      ok: false,
      code: 'INVALID',
    });
    expect(await lists()).toHaveLength(0);
  });

  it('treats a null location line as Zod-invalid', () => {
    const r = createPickListInputSchema.safeParse({
      lines: [{ skuId: 'P1', locationId: null, qty: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it('filters by status and orders by createdAt desc', async () => {
    const a = await create();
    await new Promise((r) => setTimeout(r, 5));
    const b = await create();
    await closePickListCore(deps, WH, a);
    expect((await lists()).map((l) => l.id)).toEqual([b, a]);
    expect((await lists('DONE')).map((l) => l.id)).toEqual([a]);
    expect((await lists('OPEN')).map((l) => l.id)).toEqual([b]);
  });

  it('reports pickedQty from synced PICKs referencing the line id', async () => {
    const id = await create();
    const lineId = (await lists())[0].lines[0].id;
    const base = { userId: 'w1', deviceId: DEV, warehouseId: WH };
    const res = await syncMovementsCore(syncDeps, {
      deviceId: DEV,
      schemaVersion: SCHEMA_VERSIONS.warehouse,
      sentAt: NOW.toISOString(),
      movements: [
        {
          ...base,
          id: uuid(),
          type: 'ADJUST',
          skuId: 'P1',
          locationId: 'L1',
          qty: 10,
          reasonCode: 'FOUND',
          occurredAt: '2026-03-01T08:00:00Z',
        },
        {
          ...base,
          id: uuid(),
          type: 'PICK',
          skuId: 'P1',
          fromLocationId: 'L1',
          qty: 3,
          ref: lineId,
          occurredAt: '2026-03-01T09:00:00Z',
        },
      ],
    });
    expect(res.status).toBe('ok');
    const l = (await lists()).find((x) => x.id === id);
    expect(l?.lines[0].pickedQty).toBe(3);
  });

  it('assigns and unassigns, rejecting non-workers and unknown lists', async () => {
    const id = await create();
    expect(await assignPickListCore(deps, WH, id, 'sup')).toMatchObject({
      ok: false,
      code: 'INVALID',
    });
    expect(await assignPickListCore(deps, WH, id, 'w1')).toEqual({ ok: true });
    expect((await lists())[0].assignedUserName).toBe('w1');
    expect(await assignPickListCore(deps, WH, id, null)).toEqual({ ok: true });
    const l = (await lists())[0];
    expect(l.assignedUserId).toBeNull();
    expect(l.assignedUserName).toBeNull();
    expect(await assignPickListCore(deps, WH, 'nope', 'w1')).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('closes idempotently, NOT_FOUND on unknown, and the handheld stops seeing it', async () => {
    const id = await create('w1');
    const url = (process.env.WAREHOUSE_DB_URL_TEMPLATE ?? '').replace(
      '{name}',
      WH,
    );
    const client = createClient({ url });
    try {
      const sql = libsqlSql(client);
      expect((await assignedPickLists(sql, 'w1')).map((p) => p.id)).toEqual([
        id,
      ]);
      expect(await closePickListCore(deps, WH, id)).toEqual({ ok: true });
      expect(await closePickListCore(deps, WH, id)).toEqual({ ok: true });
      expect((await lists())[0].status).toBe('DONE');
      expect(await assignedPickLists(sql, 'w1')).toEqual([]);
    } finally {
      client.close();
    }
    expect(await closePickListCore(deps, WH, 'nope')).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('returns 403 for a worker session on every handler', async () => {
    const worker = {
      userId: 'w1',
      deviceId: DEV,
      role: 'worker',
      exp: 0,
    } as SessionClaims;
    const calls = [
      () =>
        handleSuggestPickList(
          worker,
          { warehouseId: WH, requests: [{ skuId: 'P1', qty: 1 }] },
          deps,
        ),
      () =>
        handleCreatePickList(
          worker,
          {
            warehouseId: WH,
            lines: [{ skuId: 'P1', locationId: 'L1', qty: 1 }],
          },
          deps,
        ),
      () => handleListPickLists(worker, { warehouseId: WH }, deps),
      () =>
        handleAssignPickList(
          worker,
          { warehouseId: WH, pickListId: 'x', assignedUserId: null },
          deps,
        ),
      () =>
        handleClosePickList(worker, { warehouseId: WH, pickListId: 'x' }, deps),
    ];
    for (const call of calls) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(403);
    }
    expect(await lists()).toHaveLength(0);
  });
});
