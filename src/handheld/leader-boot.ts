import { SCHEMA_VERSIONS } from '#/domain/schema-versions';
import { getReplicaConfig } from '#/server/replicas/replica-config.fn';
import { syncMovements } from '#/server/sync/sync-movements.fn';
import { createConfigManager } from './config-manager';
import { createLeaderApi, type LeaderApi } from './leader-api';
import { listOutbox } from './outbox';
import { checkedFetch, createPush } from './push';
import type { Replica } from './replicas';
import {
  getCachedReplicaConfig,
  getCachedSession,
  hasValidSession,
  setCachedReplicaConfig,
} from './session-store';
import { initialSyncState, runSyncOnce, startSyncScheduler } from './sync-loop';
import { createSyncRunner } from './sync-runner';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

/** Becomes the leader's API: opens DBs, starts the sync scheduler. */
export async function startLeader(deviceId: string): Promise<LeaderApi> {
  const { openReplica, openOutboxDb } = await import('./replicas');
  const outbox = await openOutboxDb();
  const manager = createConfigManager({
    fetchConfig: () =>
      (
        getReplicaConfig as unknown as (o: {
          fetch: typeof fetch;
        }) => Promise<unknown>
      )({
        fetch: checkedFetch(),
      }),
    getCached: getCachedReplicaConfig,
    setCached: setCachedReplicaConfig,
    hasSession: () => getCachedSession() !== null,
    online,
    now: () => new Date(),
  });
  const config = await manager.load();
  const getToken = (name: string) => () => manager.getToken(name);

  const replicas = new Map<string, Replica>();
  for (const r of config?.replicas ?? []) {
    try {
      replicas.set(r.name, await openReplica(r, getToken(r.name)));
    } catch (err) {
      console.warn(`Could not open replica ${r.name}`, err);
    }
  }

  const push = createPush(syncMovements as never);
  const runner = createSyncRunner({
    manager,
    initial: initialSyncState,
    countOutbox: async () => {
      const rows = await listOutbox(outbox);
      const pendingCount = rows.filter((r) => r.status === 'pending').length;
      return { pendingCount, attentionCount: rows.length - pendingCount };
    },
    runOnce: (prev) =>
      runSyncOnce(
        {
          outbox,
          replicas,
          push,
          deviceId,
          schemaVersion: SCHEMA_VERSIONS.warehouse,
          now: () => new Date(),
          hasValidSession: () => hasValidSession(),
        },
        prev,
      ),
  });
  const runSync = runner.runSync;

  const stop = startSyncScheduler(
    async () => {
      await runSync();
    },
    window as never,
    () => runner.getState().nextRetryAt,
  );
  stop.triggerNow();

  return createLeaderApi({
    outbox,
    replicas,
    deviceId,
    runSync,
    getSyncState: runner.getState,
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
