import { describe, expect, it, vi } from 'vitest';
import {
  type ConfigManagerDeps,
  createConfigManager,
} from '#/handheld/config-manager';
import { HttpError } from '#/handheld/push';
import { initialSyncState, type SyncState } from '#/handheld/sync-loop';
import { createSyncRunner } from '#/handheld/sync-runner';
import type { ReplicaConfig } from '#/server/replicas/replica-config.fn';

const NOW = new Date('2026-01-01T00:00:00Z');
const cfg = (token: string, hoursLeft: number): ReplicaConfig => ({
  staleWarningMs: 1,
  replicas: [
    {
      name: 'w1',
      dbName: 'w1',
      url: 'libsql://w1',
      token,
      expiresAt: new Date(NOW.getTime() + hoursLeft * 3600_000).toISOString(),
    },
  ],
});

function setup(
  fetchConfig: () => Promise<unknown>,
  cached: ReplicaConfig | null = null,
) {
  let cache = cached;
  const deps: ConfigManagerDeps = {
    fetchConfig: vi.fn(fetchConfig),
    getCached: () => cache,
    setCached: vi.fn((c) => {
      cache = c;
    }),
    hasSession: () => true,
    online: () => true,
    now: () => NOW,
  };
  return { deps, manager: createConfigManager(deps) };
}

const revoked = () =>
  new HttpError(403, JSON.stringify({ error: 'DEVICE_REVOKED' }));

describe('config manager', () => {
  it('caches a successful fetch', async () => {
    const fresh = cfg('new', 100);
    const { manager, deps } = setup(async () => fresh);
    expect(await manager.load()).toEqual(fresh);
    expect(deps.setCached).toHaveBeenCalledWith(fresh);
    expect(manager.blocked).toBeNull();
  });

  it('falls back to the cache on a network TypeError', async () => {
    const old = cfg('old', 100);
    const { manager } = setup(async () => {
      throw new TypeError('Failed to fetch');
    }, old);
    expect(await manager.load()).toEqual(old);
    expect(manager.blocked).toBeNull();
  });

  it('falls back to the cache on 503', async () => {
    const old = cfg('old', 100);
    const { manager } = setup(async () => {
      throw new HttpError(503, '{"error":"x"}');
    }, old);
    expect(await manager.load()).toEqual(old);
    expect(manager.blocked).toBeNull();
  });

  it('blocks with needs_sign_in on 401 and never renews', async () => {
    const old = cfg('old', 1);
    const { manager, deps } = setup(async () => {
      throw new HttpError(401, 'Unauthorized');
    }, old);
    await manager.load();
    expect(manager.blocked).toBe('needs_sign_in');
    expect(manager.config).toEqual(old);
    const calls = vi.mocked(deps.fetchConfig).mock.calls.length;
    expect(await manager.getToken('w1')).toBe('old');
    expect(vi.mocked(deps.fetchConfig).mock.calls.length).toBe(calls);
  });

  it('blocks on 403 DEVICE_REVOKED / DEVICE_UNKNOWN and stops calling', async () => {
    const old = cfg('old', 1);
    const { manager, deps } = setup(async () => {
      throw revoked();
    }, old);
    await manager.load();
    expect(manager.blocked).toBe('device_revoked');
    for (let i = 0; i < 5; i++) await manager.getToken('w1');
    expect(deps.fetchConfig).toHaveBeenCalledTimes(1);

    const u = setup(async () => {
      throw new HttpError(403, '{"error":"DEVICE_UNKNOWN"}');
    }, old);
    await u.manager.load();
    expect(u.manager.blocked).toBe('device_unknown');
  });

  it('renews within 24 h of expiry', async () => {
    const { manager, deps } = setup(
      async () => cfg('renewed', 200),
      cfg('old', 10),
    );
    await manager.load(); // fetch 1 -> 'renewed' (config loaded fresh)
    expect(await manager.getToken('w1')).toBe('renewed');
    expect(deps.fetchConfig).toHaveBeenCalledTimes(1); // 200 h left: no renewal

    let n = 0;
    const s = setup(async () =>
      ++n === 1 ? cfg('near', 10) : cfg('renewed', 200),
    );
    await s.manager.load();
    expect(await s.manager.getToken('w1')).toBe('renewed');
    expect(n).toBe(2);
  });

  it('keeps the old token when a renewal fails', async () => {
    let n = 0;
    const { manager } = setup(async () => {
      if (++n === 1) return cfg('old', 10);
      throw new TypeError('offline');
    });
    await manager.load();
    expect(await manager.getToken('w1')).toBe('old');
  });
});

describe('sync runner', () => {
  const idle = { ...initialSyncState, lastPullAt: 'x' };
  it('does not pull when revoked, keeps the phase, and clears it on a later success', async () => {
    let fail = true;
    const old = cfg('old', 1);
    const { manager } = setup(async () => {
      if (fail) throw revoked();
      return cfg('ok', 200);
    }, old);
    await manager.load();
    const runOnce = vi.fn(
      async (p: SyncState): Promise<SyncState> => ({
        ...p,
        phase: 'idle',
      }),
    );
    const runner = createSyncRunner({
      manager,
      runOnce,
      initial: idle,
      countOutbox: async () => ({ pendingCount: 3, attentionCount: 1 }),
    });
    const s = await runner.runSync();
    expect(runOnce).not.toHaveBeenCalled();
    expect(s.phase).toBe('device_revoked');
    expect(s.pendingCount).toBe(3);
    expect(runner.getState().phase).toBe('device_revoked');

    fail = false;
    const s2 = await runner.runSync();
    expect(runOnce).toHaveBeenCalledOnce();
    expect(s2.phase).toBe('idle');
  });

  it('overrides the phase when a block is found during the run', async () => {
    const { manager } = setup(
      async () => {
        throw revoked();
      },
      cfg('old', 1),
    );
    const runOnce = vi.fn(async (p: SyncState) => {
      await manager.load(); // like a token renewal inside a pull
      return { ...p, phase: 'idle' as const };
    });
    const runner = createSyncRunner({
      manager,
      runOnce,
      initial: idle,
      countOutbox: async () => ({ pendingCount: 0, attentionCount: 0 }),
    });
    expect((await runner.runSync()).phase).toBe('device_revoked');
    expect(runner.getState().phase).toBe('device_revoked');
  });
});
