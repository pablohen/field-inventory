import type { ConfigManager } from './config-manager';
import type { SyncState } from './sync-loop';

export interface SyncRunnerDeps {
  manager: Pick<ConfigManager, 'blocked' | 'load'>;
  /** The real sync pass (push, pull, reconcile). */
  runOnce(prev: SyncState): Promise<SyncState>;
  countOutbox(): Promise<{ pendingCount: number; attentionCount: number }>;
  initial: SyncState;
}

/**
 * Single-flight sync runner. While the config manager is blocked (401, or a
 * revoked/unknown device) it does not push or pull: the state reports the
 * blocking phase with top precedence, and it persists in `getState()` until a
 * later config fetch succeeds. The outbox is left intact.
 */
export function createSyncRunner(deps: SyncRunnerDeps) {
  let state = deps.initial;
  let inflight: Promise<SyncState> | null = null;

  const blockedState = async (): Promise<SyncState> => {
    const phase = deps.manager.blocked as NonNullable<
      typeof deps.manager.blocked
    >;
    let counts = {
      pendingCount: state.pendingCount,
      attentionCount: state.attentionCount,
    };
    try {
      counts = await deps.countOutbox();
    } catch {
      // keep previous counts
    }
    return { ...state, ...counts, phase, lastError: phase, nextRetryAt: null };
  };

  const run = async (): Promise<SyncState> => {
    // Retry the config once per run; a success clears the block.
    if (deps.manager.blocked) await deps.manager.load();
    if (deps.manager.blocked) return blockedState();
    const next = await deps.runOnce({ ...state, phase: 'syncing' });
    // A token renewal during the pull may have just discovered the block.
    return deps.manager.blocked
      ? {
          ...next,
          phase: deps.manager.blocked,
          lastError: deps.manager.blocked,
        }
      : next;
  };

  return {
    runSync(): Promise<SyncState> {
      inflight ??= run()
        .then((s) => {
          state = s;
          return s;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    getState(): SyncState {
      return state;
    },
  };
}
