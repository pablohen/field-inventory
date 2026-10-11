import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { movementDeltas } from '#/domain/balance';
import { type MovementInput, toMovement } from '#/domain/schemas';
import { addToOutbox, ensureOutboxSchema, listOutbox } from '#/handheld/outbox';
import type { Replica } from '#/handheld/replicas';
import type { Sql } from '#/handheld/sql';
import { displayedStock } from '#/handheld/stock';
import {
  backoffDelayMs,
  initialSyncState,
  pushErrorKind,
  runSyncOnce,
  type SyncDeps,
  type SyncState,
  startSyncScheduler,
} from '#/handheld/sync-loop';
import type { SyncResponse } from '#/server/sync/sync-movements';
import { memorySql, replicaSql } from '../support/handheld-sql';

const NOW = new Date('2026-01-01T10:00:00.000Z');
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const move = (extra: Partial<Record<string, unknown>> = {}): MovementInput =>
  ({
    id: uuid(),
    warehouseId: 'w1',
    skuId: 's1',
    userId: 'u1',
    deviceId: 'd1',
    occurredAt: NOW,
    type: 'MOVE',
    fromLocationId: 'A',
    toLocationId: 'B',
    qty: 2,
    ...extra,
  }) as unknown as MovementInput;

type Harness = {
  deps: SyncDeps;
  outbox: Sql;
  server: Sql;
  replica: Sql;
  replicaObj: Replica;
  pushCalls: MovementInput[][];
  control: {
    pushError: unknown;
    pushThrowsAfterStore: boolean;
    pullFails: boolean;
    response: SyncResponse | null;
    session: boolean;
  };
  pull: ReturnType<typeof vi.fn>;
  checkpoint: ReturnType<typeof vi.fn>;
};

async function copyTable(from: Sql, to: Sql, table: string) {
  const rows = await from.all<Record<string, unknown>>(
    `SELECT * FROM ${table}`,
  );
  await to.run(`DELETE FROM ${table}`);
  for (const r of rows) {
    const cols = Object.keys(r);
    await to.run(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      cols.map((c) => r[c]),
    );
  }
}

async function harness(): Promise<Harness> {
  const outbox = await memorySql();
  await ensureOutboxSchema(outbox);
  const server = await replicaSql('warehouse');
  const replica = await replicaSql('warehouse');
  const control: Harness['control'] = {
    pushError: null,
    pushThrowsAfterStore: false,
    pullFails: false,
    response: null,
    session: true,
  };
  const pushCalls: MovementInput[][] = [];
  const store = async (m: MovementInput) => {
    const exists = await server.all('SELECT 1 FROM Movement WHERE id = ?', [
      m.id,
    ]);
    if (exists.length) return 'duplicate' as const;
    const mv = toMovement(m, 'device');
    await server.run(
      `INSERT INTO Movement (id, type, skuId, fromLocationId, toLocationId, qty, ref, counterpartWarehouseId, userId, deviceId, occurredAt, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        mv.id,
        mv.type,
        mv.skuId,
        mv.fromLocationId,
        mv.toLocationId,
        mv.qty,
        mv.ref,
        mv.counterpartWarehouseId,
        mv.userId,
        mv.deviceId,
        mv.occurredAt.toISOString(),
        mv.source,
      ],
    );
    for (const d of movementDeltas(mv)) {
      await server.run(
        `INSERT INTO StockBalance (skuId, locationId, qty) VALUES (?,?,?)
         ON CONFLICT (skuId, locationId) DO UPDATE SET qty = qty + excluded.qty`,
        [d.skuId, d.locationId, d.delta],
      );
    }
    return 'accepted' as const;
  };
  const pull = vi.fn(async () => {
    if (control.pullFails) throw new TypeError('Failed to fetch');
    await copyTable(server, replica, 'Movement');
    await copyTable(server, replica, 'StockBalance');
    return true;
  });
  const checkpoint = vi.fn(async () => {});
  const replicaObj: Replica = {
    ...replica,
    name: 'w1',
    pull,
    checkpoint,
    close: async () => {},
  };
  const deps: SyncDeps = {
    outbox,
    replicas: new Map([['w1', replicaObj]]),
    deviceId: 'd1',
    schemaVersion: 1,
    now: () => NOW,
    hasValidSession: () => control.session,
    push: async (batch) => {
      pushCalls.push(batch.movements);
      if (control.pushError) throw control.pushError;
      if (control.response) return control.response;
      const results = [];
      for (const m of batch.movements) {
        results.push({ id: m.id, status: await store(m) });
      }
      if (control.pushThrowsAfterStore) {
        throw new TypeError('Failed to fetch');
      }
      return {
        status: 'ok',
        results,
        exceptions: [],
        serverTime: NOW.toISOString(),
      } as SyncResponse;
    },
  };
  return {
    deps,
    outbox,
    server,
    replica,
    replicaObj,
    pushCalls,
    control,
    pull,
    checkpoint,
  };
}

const stockOf = async (h: Harness) =>
  (await displayedStock(h.replica, h.outbox, 'w1')).map((s) => [
    s.skuId,
    s.locationId,
    s.qty,
  ]);

describe('pushErrorKind', () => {
  it('classifies', () => {
    expect(pushErrorKind({ status: 401 })).toBe('auth');
    expect(pushErrorKind({ status: 403 })).toBe('auth');
    expect(pushErrorKind({ status: 500 })).toBe('offline');
    expect(pushErrorKind({ status: 400 })).toBe('offline');
    expect(pushErrorKind(new TypeError('Failed to fetch'))).toBe('offline');
    expect(pushErrorKind(null)).toBe('offline');
    expect(pushErrorKind('x')).toBe('offline');
  });
});

describe('runSyncOnce', () => {
  it('happy path: accepted, pulled, deleted; displayed stock unchanged', async () => {
    const h = await harness();
    await h.server.run(
      "INSERT INTO StockBalance (skuId, locationId, qty) VALUES ('s1','A',10)",
    );
    await h.replicaObj.pull();
    await addToOutbox(h.outbox, move(), NOW);
    const before = await stockOf(h);
    expect(before).toEqual([
      ['s1', 'A', 8],
      ['s1', 'B', 2],
    ]);

    const st = await runSyncOnce(h.deps, initialSyncState);
    expect(st.phase).toBe('idle');
    expect(st.pendingCount).toBe(0);
    expect(st.lastPullAt).toBe(NOW.toISOString());
    expect(await listOutbox(h.outbox)).toEqual([]);
    expect(await stockOf(h)).toEqual(before);
  });

  it('response lost: next run sees duplicate and never double counts', async () => {
    const h = await harness();
    await addToOutbox(h.outbox, move(), NOW);
    h.control.pushThrowsAfterStore = true;
    h.control.pullFails = true; // offline: neither push response nor pull arrives
    const s1 = await runSyncOnce(h.deps, initialSyncState);
    expect(s1.phase).toBe('offline');
    expect(s1.failures).toBe(1);
    expect(s1.pendingCount).toBe(1);
    expect(s1.nextRetryAt).toBe(new Date(NOW.getTime() + 1000).toISOString());
    // Server has it, replica hasn't pulled: stock counts once.
    expect(await stockOf(h)).toEqual([
      ['s1', 'A', -2],
      ['s1', 'B', 2],
    ]);

    h.control.pushThrowsAfterStore = false;
    h.control.pullFails = false;
    const s2 = await runSyncOnce(h.deps, s1);
    expect(s2.phase).toBe('idle');
    expect(s2.failures).toBe(0);
    expect(s2.nextRetryAt).toBeNull();
    expect(await listOutbox(h.outbox)).toEqual([]);
    expect(await stockOf(h)).toEqual([
      ['s1', 'A', -2],
      ['s1', 'B', 2],
    ]);
  });

  it('pull failure after accepted push keeps the row pending, counted once', async () => {
    const h = await harness();
    await addToOutbox(h.outbox, move(), NOW);
    h.control.pullFails = true;
    const s1 = await runSyncOnce(h.deps, initialSyncState);
    expect(s1.phase).toBe('idle');
    expect(s1.pendingCount).toBe(1);
    expect(s1.lastPullAt).toBeNull();
    expect(await stockOf(h)).toEqual([
      ['s1', 'A', -2],
      ['s1', 'B', 2],
    ]);
    h.control.pullFails = false;
    const s2 = await runSyncOnce(h.deps, s1);
    expect(s2.pendingCount).toBe(0);
    expect(s2.lastPullAt).toBe(NOW.toISOString());
    expect(await stockOf(h)).toEqual([
      ['s1', 'A', -2],
      ['s1', 'B', 2],
    ]);
  });

  it('marks invalid rows needs_attention with the reason; ignores null ids', async () => {
    const h = await harness();
    const a = move();
    const b = move();
    await addToOutbox(h.outbox, a, NOW);
    await addToOutbox(h.outbox, b, NOW);
    h.control.response = {
      status: 'ok',
      results: [
        { id: a.id, status: 'invalid', reason: 'unknown sku' },
        { id: null, status: 'invalid', reason: 'garbage' },
        { id: b.id, status: 'accepted' },
      ],
      exceptions: [],
      serverTime: NOW.toISOString(),
    };
    const st = await runSyncOnce(h.deps, initialSyncState);
    expect(st.attentionCount).toBe(1);
    expect(st.pendingCount).toBe(1); // b is accepted but not yet in replica
    const rows = await listOutbox(h.outbox);
    expect(rows.find((r) => r.id === a.id)).toMatchObject({
      status: 'needs_attention',
      lastError: 'unknown sku',
    });
    expect(rows.find((r) => r.id === b.id)?.status).toBe('pending');
  });

  it.each([
    ['DEVICE_REVOKED', 'device_revoked'],
    ['DEVICE_UNKNOWN', 'device_unknown'],
    ['UPDATE_REQUIRED', 'update_required'],
  ] as const)(
    '%s sets phase and leaves the outbox intact',
    async (status, phase) => {
      const h = await harness();
      await addToOutbox(h.outbox, move(), NOW);
      h.control.response = { status, serverTime: NOW.toISOString() };
      const st = await runSyncOnce(h.deps, initialSyncState);
      expect(st.phase).toBe(phase);
      expect(st.pendingCount).toBe(1);
      expect(st.failures).toBe(0);
    },
  );

  it('WAREHOUSE_NOT_READY is offline with backoff', async () => {
    const h = await harness();
    await addToOutbox(h.outbox, move(), NOW);
    h.control.response = {
      status: 'WAREHOUSE_NOT_READY',
      serverTime: NOW.toISOString(),
    };
    const st = await runSyncOnce(h.deps, initialSyncState);
    expect(st.phase).toBe('offline');
    expect(st.failures).toBe(1);
    expect(st.pendingCount).toBe(1);
  });

  it('401 and 403 mean needs_sign_in without backoff; rows kept', async () => {
    for (const status of [401, 403]) {
      const h = await harness();
      await addToOutbox(h.outbox, move(), NOW);
      h.control.pushError = Object.assign(new Error('nope'), { status });
      const st = await runSyncOnce(h.deps, initialSyncState);
      expect(st.phase).toBe('needs_sign_in');
      expect(st.nextRetryAt).toBeNull();
      expect(st.pendingCount).toBe(1);
    }
  });

  it('500 and 400 mean offline with backoff and lastError; rows kept', async () => {
    for (const status of [500, 400]) {
      const h = await harness();
      await addToOutbox(h.outbox, move(), NOW);
      h.control.pushError = Object.assign(new Error(`http ${status}`), {
        status,
      });
      const st = await runSyncOnce(h.deps, initialSyncState);
      expect(st.phase).toBe('offline');
      expect(st.lastError).toBe(`http ${status}`);
      expect(st.nextRetryAt).not.toBeNull();
      expect(st.pendingCount).toBe(1);
    }
  });

  it('no session: no push, pull still runs, needs_sign_in', async () => {
    const h = await harness();
    await addToOutbox(h.outbox, move(), NOW);
    h.control.session = false;
    const st = await runSyncOnce(h.deps, initialSyncState);
    expect(st.phase).toBe('needs_sign_in');
    expect(h.pushCalls).toHaveLength(0);
    expect(h.pull).toHaveBeenCalledTimes(1);
    expect(st.pendingCount).toBe(1);
  });

  it('backoff doubles from 1000 and caps at 60000', async () => {
    const h = await harness();
    await addToOutbox(h.outbox, move(), NOW);
    h.control.pushError = new TypeError('Failed to fetch');
    let st: SyncState = initialSyncState;
    const delays: number[] = [];
    for (let i = 0; i < 9; i++) {
      st = await runSyncOnce(h.deps, st);
      delays.push(new Date(st.nextRetryAt as string).getTime() - NOW.getTime());
    }
    expect(delays).toEqual([
      1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000,
    ]);
    expect(backoffDelayMs(1)).toBe(1000);
    expect(backoffDelayMs(100)).toBe(60000);
  });

  it('empty outbox and every pull failing is offline', async () => {
    const h = await harness();
    h.control.pullFails = true;
    const st = await runSyncOnce(h.deps, initialSyncState);
    expect(st.phase).toBe('offline');
    expect(st.lastError).toBe('Failed to fetch');
  });

  it('batches pushes at 500', async () => {
    const h = await harness();
    for (let i = 0; i < 501; i++) await addToOutbox(h.outbox, move(), NOW);
    await runSyncOnce(h.deps, initialSyncState);
    expect(h.pushCalls.map((c) => c.length)).toEqual([500, 1]);
  });

  it('never pushes corrupt rows', async () => {
    const h = await harness();
    await h.outbox.run(
      "INSERT INTO outbox (id, warehouseId, input, status, lastError, createdAt) VALUES ('bad','w1','{nope','pending',NULL,'2026-01-01T00:00:00Z')",
    );
    const st = await runSyncOnce(h.deps, initialSyncState);
    expect(h.pushCalls).toHaveLength(0);
    expect(st.attentionCount).toBe(1);
    expect(st.pendingCount).toBe(0);
  });

  it('checkpoints on every 20th successful pull of a replica', async () => {
    const h = await harness();
    let st: SyncState = initialSyncState;
    for (let i = 0; i < 19; i++) st = await runSyncOnce(h.deps, st);
    expect(h.checkpoint).not.toHaveBeenCalled();
    st = await runSyncOnce(h.deps, st);
    expect(h.checkpoint).toHaveBeenCalledTimes(1);
    expect(st.pullCounts.w1).toBe(20);
    // Failed pulls do not count.
    h.control.pullFails = true;
    for (let i = 0; i < 20; i++) st = await runSyncOnce(h.deps, st);
    expect(h.checkpoint).toHaveBeenCalledTimes(1);
  });

  it('skips reconcile for rows whose warehouse replica is missing', async () => {
    const h = await harness();
    await addToOutbox(h.outbox, move({ warehouseId: 'other' }), NOW);
    const st = await runSyncOnce(h.deps, initialSyncState);
    expect(st.pendingCount).toBe(1);
  });

  it('lastPullAt only advances when all replicas pulled', async () => {
    const h = await harness();
    const bad: Replica = {
      ...h.replicaObj,
      name: 'catalog',
      pull: async () => {
        throw new Error('down');
      },
    };
    h.deps.replicas.set('catalog', bad);
    const st = await runSyncOnce(h.deps, initialSyncState);
    expect(st.lastPullAt).toBeNull();
    expect(st.phase).toBe('idle');
    expect(h.pull).toHaveBeenCalledTimes(1);
  });
});

describe('startSyncScheduler', () => {
  class FakeEnv extends EventTarget {
    document = { visibilityState: 'visible' };
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  it('single-flight: overlapping triggers run once more after, not concurrently', async () => {
    const env = new FakeEnv();
    let active = 0;
    let maxActive = 0;
    const gates: ReturnType<typeof deferred>[] = [];
    const run = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      const g = deferred();
      gates.push(g);
      await g.promise;
      active--;
    });
    const stop = startSyncScheduler(run, env);
    env.dispatchEvent(new Event('online'));
    env.dispatchEvent(new Event('online'));
    env.dispatchEvent(new Event('online'));
    expect(run).toHaveBeenCalledTimes(1);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    gates[1].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    stop();
  });

  it('runs every 30000 ms and on visible; stop removes everything', async () => {
    const env = new FakeEnv();
    const run = vi.fn(async () => {});
    const stop = startSyncScheduler(run, env);
    await vi.advanceTimersByTimeAsync(29999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    env.document.visibilityState = 'hidden';
    env.dispatchEvent(new Event('visibilitychange'));
    expect(run).toHaveBeenCalledTimes(1);
    env.document.visibilityState = 'visible';
    env.dispatchEvent(new Event('visibilitychange'));
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    env.dispatchEvent(new Event('online'));
    stop.triggerNow();
    await vi.advanceTimersByTimeAsync(120000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('interval and visibility respect nextRetryAt; online and triggerNow bypass it', async () => {
    const env = new FakeEnv();
    const run = vi.fn(async () => {});
    const retryAt = new Date(NOW.getTime() + 100000).toISOString();
    const stop = startSyncScheduler(run, env, () => retryAt);
    await vi.advanceTimersByTimeAsync(30000);
    env.dispatchEvent(new Event('visibilitychange'));
    expect(run).not.toHaveBeenCalled();
    env.dispatchEvent(new Event('online'));
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    stop.triggerNow();
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(90000); // past retryAt
    expect(run.mock.calls.length).toBeGreaterThan(2);
    stop();
  });

  it('survives a run that throws', async () => {
    const env = new FakeEnv();
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const stop = startSyncScheduler(run, env);
    env.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    env.dispatchEvent(new Event('online'));
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });
});
