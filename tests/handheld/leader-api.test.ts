import { describe, expect, it, vi } from 'vitest';
import type { MovementInput } from '#/domain/schemas';
import { createLeaderApi } from '#/handheld/leader-api';
import { ensureOutboxSchema } from '#/handheld/outbox';
import type { Replica } from '#/handheld/replicas';
import type { Sql } from '#/handheld/sql';
import { initialSyncState } from '#/handheld/sync-loop';
import { memorySql, replicaSql } from '../support/handheld-sql';

const asReplica = (name: string, sql: Sql): Replica => ({
  name,
  ...sql,
  pull: async () => false,
  checkpoint: async () => {},
  close: async () => {},
});

const pick: MovementInput = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'PICK',
  warehouseId: 'w1',
  skuId: 's1',
  userId: 'u1',
  deviceId: 'd1',
  occurredAt: new Date('2026-01-01T10:00:00Z'),
  fromLocationId: 'l1',
  qty: 2,
};

async function setup() {
  const outbox = await memorySql();
  await ensureOutboxSchema(outbox);
  const replicas = new Map<string, Replica>([
    ['w1', asReplica('w1', await replicaSql('warehouse'))],
    ['w2', asReplica('w2', await replicaSql('warehouse'))],
    ['catalog', asReplica('catalog', await replicaSql('catalog'))],
  ]);
  const runSync = vi.fn(async () => ({ ...initialSyncState, pendingCount: 1 }));
  const closeAll = vi.fn(async () => {});
  const api = createLeaderApi({
    outbox,
    replicas,
    deviceId: 'd1',
    runSync,
    getSyncState: () => initialSyncState,
    closeAll,
    now: () => new Date('2026-01-01T10:00:05Z'),
  });
  return { api, outbox, runSync, closeAll };
}

describe('createLeaderApi', () => {
  it('is a plain object literal whose methods are own properties', async () => {
    const { api } = await setup();
    expect(Object.getPrototypeOf(api)).toBe(Object.prototype);
    for (const m of [
      'displayedStock',
      'findProduct',
      'findLocation',
      'assignedPickLists',
      'assignedCountTasks',
      'myOpenExceptions',
      'inTransitTo',
      'record',
      'listOutbox',
      'discardOutbox',
      'exportOutbox',
      'syncNow',
      'syncState',
      'resetDevice',
    ]) {
      expect(Object.hasOwn(api, m)).toBe(true);
    }
  });

  it('record writes the outbox and displayedStock reflects it', async () => {
    const { api } = await setup();
    await api.record(pick);
    const rows = await api.listOutbox({ warehouseId: 'w1' });
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt).toBe('2026-01-01T10:00:05.000Z');
    expect(await api.displayedStock('w1')).toEqual([
      { skuId: 's1', locationId: 'l1', qty: -2, pendingDelta: -2 },
    ]);
    expect(await api.displayedStock('w1', { skuId: 'nope' })).toEqual([]);
    expect(JSON.parse(await api.exportOutbox())).toHaveLength(1);
    await api.discardOutbox(pick.id);
    expect(await api.listOutbox()).toEqual([]);
  });

  it('record rejects an invalid input', async () => {
    const { api } = await setup();
    await expect(api.record({ ...pick, qty: 0 })).rejects.toThrow();
  });

  it('lookups, tasks and transit run against the right replica', async () => {
    const { api } = await setup();
    expect(await api.findProduct('nothing')).toBeNull();
    expect(await api.findLocation('w1', 'nothing')).toBeNull();
    expect(await api.assignedPickLists('w1', 'u1')).toEqual([]);
    expect(await api.assignedCountTasks('w1', 'u1')).toEqual([]);
    expect(await api.myOpenExceptions('w1')).toEqual([]);
    expect(await api.inTransitTo('w1')).toEqual([]);
  });

  it('throws UNKNOWN_WAREHOUSE for a warehouse without a replica', async () => {
    const { api } = await setup();
    await expect(api.displayedStock('zz')).rejects.toThrow('UNKNOWN_WAREHOUSE');
    await expect(api.findLocation('zz', 'x')).rejects.toThrow(
      'UNKNOWN_WAREHOUSE',
    );
    await expect(api.assignedPickLists('zz', 'u')).rejects.toThrow(
      'UNKNOWN_WAREHOUSE',
    );
    await expect(api.assignedCountTasks('zz', 'u')).rejects.toThrow(
      'UNKNOWN_WAREHOUSE',
    );
    await expect(api.myOpenExceptions('zz')).rejects.toThrow(
      'UNKNOWN_WAREHOUSE',
    );
    await expect(api.inTransitTo('zz')).rejects.toThrow('UNKNOWN_WAREHOUSE');
  });

  it('delegates sync and reset', async () => {
    const { api, runSync } = await setup();
    expect((await api.syncNow()).pendingCount).toBe(1);
    expect(runSync).toHaveBeenCalledOnce();
    expect(await api.syncState()).toEqual(initialSyncState);
  });
});
