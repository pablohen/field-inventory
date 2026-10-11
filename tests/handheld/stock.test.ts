import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MovementInput } from '#/domain/schemas';
import {
  addToOutbox,
  ensureOutboxSchema,
  markNeedsAttention,
} from '#/handheld/outbox';
import type { Sql } from '#/handheld/sql';
import {
  assignedCountTasks,
  assignedPickLists,
  displayedStock,
  findLocation,
  findProduct,
  inTransitTo,
  myOpenExceptions,
  parseDbDate,
} from '#/handheld/stock';
import { applyMigrations, migrationsDir } from '#/server/db/migrate';
import { libsqlSql, memorySql, replicaSql } from '../support/handheld-sql';
import { createTestEnv } from '../support/test-env';

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const T_PENDING = '99999999-9999-4999-8999-999999999999';
const NOW = new Date('2026-01-01T10:00:00Z');

const base = (extra: Record<string, unknown>): MovementInput =>
  ({
    id: uuid(),
    warehouseId: 'w1',
    skuId: 's1',
    userId: 'u1',
    deviceId: 'd1',
    occurredAt: NOW,
    ...extra,
  }) as unknown as MovementInput;

const setBalance = (r: Sql, skuId: string, locationId: string, qty: number) =>
  r.run('INSERT INTO StockBalance (skuId, locationId, qty) VALUES (?,?,?)', [
    skuId,
    locationId,
    qty,
  ]);

const insertMovement = (
  r: Sql,
  m: {
    id: string;
    type: string;
    skuId?: string;
    from?: string | null;
    to?: string | null;
    qty?: number;
    ref?: string | null;
    cp?: string | null;
  },
) =>
  r.run(
    `INSERT INTO Movement (id, type, skuId, fromLocationId, toLocationId, qty, ref, counterpartWarehouseId, userId, deviceId, occurredAt, source)
     VALUES (?,?,?,?,?,?,?,?, 'u1','d1', '2026-01-01T10:00:00.000+00:00','device')`,
    [
      m.id,
      m.type,
      m.skuId ?? 's1',
      m.from ?? null,
      m.to ?? null,
      m.qty ?? 1,
      m.ref ?? null,
      m.cp ?? null,
    ],
  );

describe('parseDbDate', () => {
  it('parses Prisma ISO text with offset', () => {
    expect(parseDbDate('2026-01-02T03:04:05.678+00:00').toISOString()).toBe(
      '2026-01-02T03:04:05.678Z',
    );
  });
  it('parses epoch ms as number, bigint and numeric string', () => {
    const ms = Date.UTC(2026, 0, 2, 3, 4, 5, 678);
    expect(parseDbDate(ms).getTime()).toBe(ms);
    expect(parseDbDate(BigInt(ms)).getTime()).toBe(ms);
    expect(parseDbDate(String(ms)).getTime()).toBe(ms);
  });
  it('parses CURRENT_TIMESTAMP text as UTC', () => {
    expect(parseDbDate('2026-01-02 03:04:05').toISOString()).toBe(
      '2026-01-02T03:04:05.000Z',
    );
  });
  it('throws on garbage', () => {
    expect(() => parseDbDate('nope')).toThrow();
    expect(() => parseDbDate(null)).toThrow();
  });
  it('reads what Prisma actually stored in a DATETIME column', async () => {
    const env = await createTestEnv();
    try {
      const wh = await env.warehouse('probe');
      const at = new Date('2026-01-02T03:04:05.678Z');
      await wh.movement.create({
        data: {
          id: 'm1',
          type: 'ADJUST',
          skuId: 's',
          toLocationId: 'l',
          qty: 1,
          userId: 'u',
          deviceId: 'd',
          occurredAt: at,
          source: 'device',
        },
      });
      const raw = createClient({
        url: (process.env.WAREHOUSE_DB_URL_TEMPLATE as string).replace(
          '{name}',
          'probe',
        ),
      });
      const rows = await libsqlSql(raw).all<{
        occurredAt: unknown;
        receivedAt: unknown;
      }>('SELECT occurredAt, receivedAt FROM Movement');
      raw.close();
      expect(parseDbDate(rows[0].occurredAt).getTime()).toBe(at.getTime());
      expect(Number.isNaN(parseDbDate(rows[0].receivedAt).getTime())).toBe(
        false,
      );
    } finally {
      await env.cleanup();
    }
  });
});

describe('displayedStock', () => {
  let replica: Sql;
  let outbox: Sql;
  beforeEach(async () => {
    replica = await replicaSql('warehouse');
    outbox = await memorySql();
    await ensureOutboxSchema(outbox);
  });

  it('adds pending PICK to the balance', async () => {
    await setBalance(replica, 's1', 'l1', 10);
    await addToOutbox(
      outbox,
      base({ type: 'PICK', fromLocationId: 'l1', qty: 3 }),
      NOW,
    );
    expect(await displayedStock(replica, outbox, 'w1')).toEqual([
      { skuId: 's1', locationId: 'l1', qty: 7, pendingDelta: -3 },
    ]);
  });

  it('shows a MOVE on both keys', async () => {
    await setBalance(replica, 's1', 'l1', 5);
    await addToOutbox(
      outbox,
      base({ type: 'MOVE', fromLocationId: 'l1', toLocationId: 'l2', qty: 2 }),
      NOW,
    );
    expect(await displayedStock(replica, outbox, 'w1')).toEqual([
      { skuId: 's1', locationId: 'l1', qty: 3, pendingDelta: -2 },
      { skuId: 's1', locationId: 'l2', qty: 2, pendingDelta: 2 },
    ]);
  });

  it('includes a key that only has a pending ADJUST, and needs_attention rows', async () => {
    const a = base({
      type: 'ADJUST',
      locationId: 'l9',
      qty: 4,
      reasonCode: 'FOUND',
    });
    await addToOutbox(outbox, a, NOW);
    await markNeedsAttention(outbox, [{ id: a.id, reason: 'X' }]);
    expect(await displayedStock(replica, outbox, 'w1')).toEqual([
      { skuId: 's1', locationId: 'l9', qty: 4, pendingDelta: 4 },
    ]);
  });

  it('ignores other warehouses, corrupt rows and COUNTs; applies filter', async () => {
    await setBalance(replica, 's1', 'l1', 10);
    await setBalance(replica, 's2', 'l1', 1);
    await addToOutbox(
      outbox,
      base({ type: 'PICK', fromLocationId: 'l1', qty: 3, warehouseId: 'w2' }),
      NOW,
    );
    await addToOutbox(
      outbox,
      base({ type: 'COUNT', locationId: 'l1', qty: 99 }),
      NOW,
    );
    await outbox.run(
      "INSERT INTO outbox VALUES ('bad','w1','{oops','pending',NULL,'2026-01-01T00:00:00Z')",
    );
    expect(
      await displayedStock(replica, outbox, 'w1', { skuId: 's1' }),
    ).toEqual([{ skuId: 's1', locationId: 'l1', qty: 10, pendingDelta: 0 }]);
  });

  it('does not double count a pending row already present in the replica', async () => {
    const p = base({ type: 'PICK', fromLocationId: 'l1', qty: 3 });
    await addToOutbox(outbox, p, NOW);
    // balance already reflects the synced PICK (10 - 3), outbox not yet cleared
    await setBalance(replica, 's1', 'l1', 7);
    await insertMovement(replica, {
      id: p.id,
      type: 'PICK',
      from: 'l1',
      qty: 3,
    });
    expect(await displayedStock(replica, outbox, 'w1')).toEqual([
      { skuId: 's1', locationId: 'l1', qty: 7, pendingDelta: 0 },
    ]);
  });
});

describe('restart', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fi-stock-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('gives identical results after closing and reopening file DBs', async () => {
    const open = () => {
      const r = createClient({ url: `file:${dir}/replica.db` });
      const o = createClient({ url: `file:${dir}/outbox.db` });
      return { r, o, rs: libsqlSql(r), os: libsqlSql(o) };
    };
    const first = open();
    await applyMigrations(first.r, migrationsDir('warehouse'));
    await ensureOutboxSchema(first.os);
    await setBalance(first.rs, 's1', 'l1', 10);
    await addToOutbox(
      first.os,
      base({ type: 'PICK', fromLocationId: 'l1', qty: 3, ref: 'line-1' }),
      NOW,
    );
    await first.rs.run(
      "INSERT INTO PickList (id, status, assignedUserId, createdBy) VALUES ('pl','OPEN','u1','sup')",
    );
    await first.rs.run(
      "INSERT INTO PickLine VALUES ('line-1','pl','s1','l1',5)",
    );
    const before = {
      stock: await displayedStock(first.rs, first.os, 'w1'),
      picks: await assignedPickLists(first.rs, 'u1', first.os),
    };
    first.r.close();
    first.o.close();

    const second = open();
    const after = {
      stock: await displayedStock(second.rs, second.os, 'w1'),
      picks: await assignedPickLists(second.rs, 'u1', second.os),
    };
    second.r.close();
    second.o.close();
    expect(after).toEqual(before);
    expect(after.stock[0].qty).toBe(7);
    expect(after.picks[0].lines[0].pickedQty).toBe(3);
  });
});

describe('lookups', () => {
  it('findProduct by sku, id, barcode, trimmed; null otherwise', async () => {
    const catalog = await replicaSql('catalog');
    await catalog.run(
      `INSERT INTO Product (id, sku, name, barcodes) VALUES
       ('p1','SKU-1','Widget','["111","222"]'),
       ('p2','SKU-2','Gadget','not json')`,
    );
    expect((await findProduct(catalog, ' 222 '))?.id).toBe('p1');
    expect((await findProduct(catalog, 'SKU-1'))?.name).toBe('Widget');
    expect((await findProduct(catalog, 'p2'))?.sku).toBe('SKU-2');
    expect(await findProduct(catalog, '22')).toBeNull();
    expect(await findProduct(catalog, '')).toBeNull();
  });

  it('findLocation by code or id, trimmed', async () => {
    const r = await replicaSql('warehouse');
    await r.run(
      "INSERT INTO Location (id, code, active) VALUES ('loc-1','A-01',1),('loc-2','A-02',0)",
    );
    expect(await findLocation(r, ' A-01\n')).toEqual({
      id: 'loc-1',
      code: 'A-01',
      active: true,
    });
    expect((await findLocation(r, 'loc-2'))?.active).toBe(false);
    expect(await findLocation(r, 'zzz')).toBeNull();
  });
});

describe('tasks and exceptions', () => {
  it('assignedPickLists counts synced + pending picks, skips finished lists', async () => {
    const r = await replicaSql('warehouse');
    const o = await memorySql();
    await ensureOutboxSchema(o);
    await r.run(
      `INSERT INTO PickList (id, status, assignedUserId, createdBy) VALUES
       ('a','OPEN','u1','sup'),('b','DONE','u1','sup'),('c','OPEN','u2','sup')`,
    );
    await r.run(
      `INSERT INTO PickLine VALUES ('la','a','s1','l1',5),('lb','b','s1','l1',1),('lc','c','s1','l1',1)`,
    );
    await insertMovement(r, {
      id: 'm-synced',
      type: 'PICK',
      from: 'l1',
      qty: 2,
      ref: 'la',
    });
    await addToOutbox(
      o,
      base({ type: 'PICK', fromLocationId: 'l1', qty: 1, ref: 'la' }),
      NOW,
    );
    const lists = await assignedPickLists(r, 'u1', o);
    expect(lists.map((l) => l.id)).toEqual(['a']);
    expect(lists[0].lines).toEqual([
      {
        id: 'la',
        skuId: 's1',
        locationId: 'l1',
        qtyRequested: 5,
        pickedQty: 3,
      },
    ]);
    expect((await assignedPickLists(r, 'u1'))[0].lines[0].pickedQty).toBe(2);
  });

  it('assignedCountTasks includes unassigned, excludes done', async () => {
    const r = await replicaSql('warehouse');
    await r.run(
      `INSERT INTO CountTask (id, scope, assignedUserId, status) VALUES
       ('t1','{"zone":"A"}','u1','OPEN'),('t2','{}',NULL,'OPEN'),
       ('t3','{}','u2','OPEN'),('t4','{}','u1','DONE')`,
    );
    const tasks = await assignedCountTasks(r, 'u1');
    expect(tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(tasks[0].scope).toEqual({ zone: 'A' });
  });

  it('myOpenExceptions filters by device and parses JSON, newest first', async () => {
    const r = await replicaSql('warehouse');
    const ins = (id: string, status: string, dev: string, at: string) =>
      r.run(
        `INSERT INTO Exception (id, type, status, movementIds, deviceId, details, createdAt)
         VALUES (?, 'OVER_PICK', ?, '["m1","m2"]', ?, '{"x":1}', ?)`,
        [id, status, dev, at],
      );
    await ins('e1', 'OPEN', 'd1', '2026-01-01T00:00:00.000+00:00');
    await ins('e2', 'OPEN', 'd1', '2026-01-02T00:00:00.000+00:00');
    await ins('e3', 'RESOLVED', 'd1', '2026-01-03T00:00:00.000+00:00');
    await ins('e4', 'OPEN', 'd2', '2026-01-04T00:00:00.000+00:00');
    const ex = await myOpenExceptions(r, 'd1');
    expect(ex.map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(ex[0].details).toEqual({ x: 1 });
    expect(ex[0].movementIds).toEqual(['m1', 'm2']);
  });
});

describe('inTransitTo', () => {
  it('excludes transfers received in the replica or pending in the outbox', async () => {
    const w1 = await replicaSql('warehouse');
    const w2 = await replicaSql('warehouse');
    const w3 = await replicaSql('warehouse');
    const o = await memorySql();
    await ensureOutboxSchema(o);
    const out = (r: Sql, id: string, ref: string, cp: string) =>
      insertMovement(r, {
        id,
        type: 'TRANSFER_OUT',
        from: 'l1',
        qty: 4,
        ref,
        cp,
      });
    await out(w1, 'o1', 't-open', 'w2');
    await out(w1, 'o2', 't-received', 'w2');
    await out(w3, 'o3', T_PENDING, 'w2');
    await out(w3, 'o4', 't-other', 'w9');
    await insertMovement(w2, {
      id: 'i1',
      type: 'TRANSFER_IN',
      to: 'l2',
      ref: 't-received',
      cp: 'w1',
    });
    const tid = T_PENDING;
    await addToOutbox(
      o,
      base({
        type: 'TRANSFER_IN',
        warehouseId: 'w2',
        toLocationId: 'l2',
        qty: 4,
        transferId: tid,
        counterpartWarehouseId: 'w3',
      }),
      NOW,
    );
    const replicas = new Map([
      ['w1', w1],
      ['w2', w2],
      ['w3', w3],
    ]);
    const res = await inTransitTo(replicas, 'w2', o);
    expect(res.map((r) => r.ref)).toEqual(['t-open']);
    expect(res[0]).toMatchObject({ fromWarehouseId: 'w1', qty: 4 });
  });
});
