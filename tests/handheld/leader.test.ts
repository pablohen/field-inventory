import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { electLeader } from '#/handheld/leader';

/** Fake LockManager: one exclusive lock per name, FIFO queue, ifAvailable. */
class FakeLocks {
  private held = new Map<string, () => void>();
  private queue = new Map<string, (() => void)[]>();

  request(
    name: string,
    a: unknown,
    b?: (lock: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    const opts = (b ? a : {}) as { ifAvailable?: boolean };
    const cb = (b ?? a) as (lock: unknown) => Promise<unknown>;
    return new Promise((resolve, reject) => {
      const grant = () => {
        let release!: () => void;
        const released = new Promise<void>((r) => {
          release = r;
        });
        this.held.set(name, release);
        const done = cb({ name });
        done.then(resolve, reject);
        // Released when the callback settles, or on a simulated tab close.
        void Promise.race([released, done.catch(() => {})]).then(() => {
          this.held.delete(name);
          this.queue.get(name)?.shift()?.();
        });
      };
      if (!this.held.has(name)) return grant();
      if (opts.ifAvailable) {
        cb(null).then(resolve, reject);
        return;
      }
      const q = this.queue.get(name) ?? [];
      q.push(grant);
      this.queue.set(name, q);
    });
  }

  /** Simulates the holder's tab closing. */
  closeHolder(name: string) {
    this.held.get(name)?.();
  }
}

/** Fake BroadcastChannel hub: delivers to every other endpoint, async. */
function channelPair() {
  const endpoints: FakeChannel[] = [];
  class FakeChannel {
    dead = false;
    private ls: ((ev: { data: unknown }) => void)[] = [];
    constructor() {
      endpoints.push(this);
    }
    addEventListener(_t: string, fn: (ev: { data: unknown }) => void) {
      this.ls.push(fn);
    }
    postMessage(data: unknown) {
      for (const e of endpoints) {
        if (e === this || e.dead || this.dead) continue;
        queueMicrotask(() => {
          for (const l of e.ls) l({ data: structuredClone(data) });
        });
      }
    }
  }
  return {
    make: () => new FakeChannel() as unknown as BroadcastChannel,
    /** Simulates a tab closing: its channel goes silent. */
    kill: (i: number) => {
      endpoints[i].dead = true;
    },
  };
}

type Api = {
  findProduct(code: string): Promise<string>;
  boom(): Promise<never>;
};

const apiFor = (tag: string): Api => ({
  findProduct: async (c) => `${tag}:${c}`,
  boom: async () => {
    const e = new Error('disk full');
    e.name = 'StorageFullError';
    throw e;
  },
});

function setup() {
  const locks = new FakeLocks();
  const hub = channelPair();
  const tab = (tag: string, onLeader = async () => apiFor(tag)) =>
    electLeader<Api>({
      locks: locks as unknown as LockManager,
      channel: hub.make(),
      onLeader,
    });
  return { locks, tab, kill: hub.kill };
}

describe('electLeader', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('first tab leads, second follows; follower call gets the leader answer', async () => {
    const { tab } = setup();
    const t1 = await tab('t1');
    const t2 = await tab('t2');
    expect(t1.role).toBe('leader');
    expect(t2.role).toBe('follower');
    expect(await t1.call('findProduct', 'X')).toBe('t1:X');
    expect(await t2.call('findProduct', 'X')).toBe('t1:X');
  });

  it('rethrows leader errors with the same name and message', async () => {
    const { tab } = setup();
    await tab('t1');
    const t2 = await tab('t2');
    const err = await t2.call('boom').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('StorageFullError');
    expect(err.message).toBe('disk full');
  });

  it('promotes a follower when the leader goes away', async () => {
    const { tab, locks } = setup();
    const t1 = await tab('t1');
    const t2 = await tab('t2');
    const seen: string[] = [];
    t2.onRoleChange((r) => seen.push(r));
    locks.closeHolder('fi-sync-leader');
    await vi.advanceTimersByTimeAsync(0);
    expect(t1.role).toBe('leader'); // stale object of the closed tab
    expect(t2.role).toBe('leader');
    expect(seen).toEqual(['leader']);
    expect(await t2.call('findProduct', 'Y')).toBe('t2:Y');
  });

  it('queues calls made during promotion and serves them once leader', async () => {
    const { tab, locks, kill } = setup();
    await tab('t1');
    kill(0);
    let open!: (a: Api) => void;
    const t2 = await tab(
      't2',
      () =>
        new Promise<Api>((r) => {
          open = r;
        }),
    );
    locks.closeHolder('fi-sync-leader');
    await vi.advanceTimersByTimeAsync(0);
    const p = t2.call('findProduct', 'Z');
    await vi.advanceTimersByTimeAsync(1000);
    open(apiFor('t2'));
    expect(await p).toBe('t2:Z');
  });

  it('times out with LEADER_TIMEOUT when the leader is silent', async () => {
    const { tab } = setup();
    // The leader holds the lock but never finishes opening (never serves).
    void tab('stuck', () => new Promise<Api>(() => {}));
    await vi.advanceTimersByTimeAsync(0);
    const f = await tab('f');
    expect(f.role).toBe('follower');
    const assertion = expect(f.call('findProduct', 'Q')).rejects.toThrow(
      'LEADER_TIMEOUT',
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('ignores responses meant for other followers', async () => {
    const { tab } = setup();
    await tab('t1');
    const t2 = await tab('t2');
    const t3 = await tab('t3');
    const [a, b] = await Promise.all([
      t2.call('findProduct', 'A'),
      t3.call('findProduct', 'B'),
    ]);
    expect([a, b]).toEqual(['t1:A', 't1:B']);
  });
});
