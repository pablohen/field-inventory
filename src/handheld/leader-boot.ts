import { SCHEMA_VERSIONS } from '#/domain/schema-versions';
import type { ReplicaConfig } from '#/server/replicas/replica-config.fn';
import { getReplicaConfig } from '#/server/replicas/replica-config.fn';
import { syncMovements } from '#/server/sync/sync-movements.fn';
import { createLeaderApi, type LeaderApi } from './leader-api';
import { createPush } from './push';
import type { Replica } from './replicas';
import {
  getCachedReplicaConfig,
  getCachedSession,
  hasValidSession,
  setCachedReplicaConfig,
} from './session-store';
import {
  initialSyncState,
  runSyncOnce,
  type SyncState,
  startSyncScheduler,
} from './sync-loop';

export const TOKEN_REFRESH_WINDOW_MS = 24 * 3600_000;

const online = () => typeof navigator === 'undefined' || navigator.onLine;

/** The server fn's thrown JSON `Response` resolves as a plain value; check the shape. */
function isConfig(v: unknown): v is ReplicaConfig {
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as ReplicaConfig).replicas)
  );
}

/**
 * Fetches a fresh config when online with a session and caches it. Falls back
 * to the cache when offline, on failure or on a 503; null when there is none.
 */
export async function loadReplicaConfig(): Promise<ReplicaConfig | null> {
  if (online() && getCachedSession()) {
    try {
      const fresh: unknown = await getReplicaConfig();
      if (isConfig(fresh)) {
        setCachedReplicaConfig(fresh);
        return fresh;
      }
    } catch {
      // fall through to the cache
    }
  }
  return getCachedReplicaConfig();
}

/** Becomes the leader's API: opens DBs, starts the sync scheduler. */
export async function startLeader(deviceId: string): Promise<LeaderApi> {
  const { openReplica, openOutboxDb } = await import('./replicas');
  const outbox = await openOutboxDb();
  let config = await loadReplicaConfig();

  let refreshing: Promise<void> | null = null;
  const refresh = () => {
    refreshing ??= (async () => {
      try {
        const fresh = await loadReplicaConfig();
        if (fresh) config = fresh;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  };
  const getToken = (name: string) => async () => {
    const find = () => config?.replicas.find((r) => r.name === name);
    const cur = find();
    const nearExpiry =
      !cur || Date.parse(cur.expiresAt) - Date.now() < TOKEN_REFRESH_WINDOW_MS;
    if (nearExpiry && online() && getCachedSession()) {
      // A failed refresh keeps the old token.
      await refresh().catch(() => {});
    }
    const t = find();
    if (!t) throw new Error(`No token for replica ${name}`);
    return t.token;
  };

  const replicas = new Map<string, Replica>();
  for (const r of config?.replicas ?? []) {
    try {
      replicas.set(r.name, await openReplica(r, getToken(r.name)));
    } catch (err) {
      console.warn(`Could not open replica ${r.name}`, err);
    }
  }

  let state: SyncState = initialSyncState;
  let inflight: Promise<SyncState> | null = null;
  const push = createPush(syncMovements as never);
  const runSync = () => {
    inflight ??= runSyncOnce(
      {
        outbox,
        replicas,
        push,
        deviceId,
        schemaVersion: SCHEMA_VERSIONS.warehouse,
        now: () => new Date(),
        hasValidSession: () => hasValidSession(),
      },
      { ...state, phase: 'syncing' },
    )
      .then((s) => {
        state = s;
        return s;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const stop = startSyncScheduler(
    async () => {
      await runSync();
    },
    window as never,
    () => state.nextRetryAt,
  );
  stop.triggerNow();

  return createLeaderApi({
    outbox,
    replicas,
    deviceId,
    runSync,
    getSyncState: () => state,
    now: () => new Date(),
    closeAll: async () => {
      stop();
      await Promise.allSettled([
        ...[...replicas.values()].map((r) => r.close()),
        outbox.close(),
      ]);
      replicas.clear();
    },
  });
}
