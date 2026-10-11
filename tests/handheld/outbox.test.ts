import { beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  addToOutbox,
  deleteOutbox,
  discardOutbox,
  ensureOutboxSchema,
  exportOutbox,
  listOutbox,
  markNeedsAttention,
  StorageFullError,
} from '#/handheld/outbox';
import type { Sql } from '#/handheld/sql';
import { memorySql } from '../support/handheld-sql';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

const mv = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'COUNT',
    warehouseId: 'w1',
    skuId: 's1',
    userId: 'u1',
    deviceId: 'd1',
    occurredAt: new Date('2026-01-01T10:00:00Z'),
    locationId: 'l1',
    qty: 3,
    ...extra,
  }) as never;

let sql: Sql;
beforeEach(async () => {
  sql = await memorySql();
  await ensureOutboxSchema(sql);
});

describe('outbox', () => {
  it('round-trips input with dates as Date', async () => {
    await addToOutbox(sql, mv(ID1), new Date('2026-01-02T00:00:00Z'));
    const [row] = await listOutbox(sql);
    expect(row?.status).toBe('pending');
    expect(row?.createdAt).toBe('2026-01-02T00:00:00.000Z');
    expect(row?.input).toMatchObject({
      occurredAt: new Date('2026-01-01T10:00:00Z'),
    });
    expect(row?.input).toMatchObject({ id: ID1, qty: 3, type: 'COUNT' });
  });

  it('is a no-op for an existing id', async () => {
    await addToOutbox(sql, mv(ID1), new Date());
    await addToOutbox(sql, mv(ID1, { qty: 9 }), new Date());
    const rows = await listOutbox(sql);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.input).toMatchObject({ qty: 3 });
  });

  it('throws ZodError for invalid input and inserts nothing', async () => {
    await expect(
      addToOutbox(sql, mv(ID1, { qty: -1 }), new Date()),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await listOutbox(sql)).toHaveLength(0);
  });

  it('maps quota errors to StorageFullError with cause', async () => {
    const cause = new Error('full');
    cause.name = 'QuotaExceededError';
    const stub: Sql = {
      all: sql.all,
      run: async () => {
        throw cause;
      },
    };
    const err = await addToOutbox(stub, mv(ID1), new Date()).catch((e) => e);
    expect(err).toBeInstanceOf(StorageFullError);
    expect(err.cause).toBe(cause);
    const stub2: Sql = {
      all: sql.all,
      run: async () => {
        throw new Error('database or disk is full: SQLITE_FULL');
      },
    };
    await expect(ensureOutboxSchema(stub2)).rejects.toBeInstanceOf(
      StorageFullError,
    );
  });

  it('marks needs_attention, ignoring unknown ids, and filters', async () => {
    await addToOutbox(sql, mv(ID1), new Date('2026-01-01T00:00:00Z'));
    await addToOutbox(
      sql,
      mv(ID2, { warehouseId: 'w2' }),
      new Date('2026-01-01T00:00:01Z'),
    );
    await markNeedsAttention(sql, [
      { id: ID1, reason: 'UNKNOWN_SKU' },
      { id: 'nope', reason: 'X' },
    ]);
    const bad = await listOutbox(sql, { status: 'needs_attention' });
    expect(bad.map((r) => [r.id, r.lastError])).toEqual([[ID1, 'UNKNOWN_SKU']]);
    expect(
      (await listOutbox(sql, { warehouseId: 'w2' })).map((r) => r.id),
    ).toEqual([ID2]);
    expect(await listOutbox(sql)).toHaveLength(2);
  });

  it('keeps corrupt rows as needs_attention instead of dropping them', async () => {
    await addToOutbox(sql, mv(ID1), new Date());
    await sql.run("UPDATE outbox SET input = '{not json' WHERE id = ?", [ID1]);
    const rows = await listOutbox(sql);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: ID1,
      status: 'needs_attention',
      lastError: 'CORRUPT_ROW',
      input: { raw: '{not json' },
    });
    expect(await listOutbox(sql, { status: 'needs_attention' })).toHaveLength(
      1,
    );
  });

  it('deletes, discards and exports', async () => {
    await addToOutbox(sql, mv(ID1), new Date('2026-01-01T00:00:00Z'));
    await addToOutbox(sql, mv(ID2), new Date('2026-01-01T00:00:01Z'));
    const exported = JSON.parse(await exportOutbox(sql));
    expect(exported.map((r: { id: string }) => r.id)).toEqual([ID1, ID2]);
    expect(await exportOutbox(sql)).toContain('\n  ');
    await deleteOutbox(sql, [ID1]);
    expect((await listOutbox(sql)).map((r) => r.id)).toEqual([ID2]);
    await discardOutbox(sql, ID2);
    expect(await listOutbox(sql)).toHaveLength(0);
  });
});
