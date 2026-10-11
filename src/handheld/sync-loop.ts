import type { MovementInput } from '#/domain/schemas';
import type { RowResult, SyncResponse } from '#/server/sync/sync-movements';
import { deleteOutbox, listOutbox, markNeedsAttention } from './outbox';
import type { Replica } from './replicas';
import type { Sql } from './sql';

export const SYNC_BATCH_SIZE = 500;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 60000;
export const CHECKPOINT_EVERY = 20;
export const SYNC_INTERVAL_MS = 30000;
/** Age of the last pull after which the UI warns the data is stale (matches the server's `staleWarningMs`). */
export const STALE_WARNING_MS = 4 * 3600_000;

export type SyncPhase =
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'needs_sign_in'
  | 'update_required'
  | 'device_revoked'
  | 'device_unknown';

export type SyncState = {
  phase: SyncPhase;
  pendingCount: number;
  attentionCount: number;
  lastPullAt: string | null;
  lastError: string | null;
  nextRetryAt: string | null;
  /** Consecutive push failures (transport, 5xx, 400, WAREHOUSE_NOT_READY). Reset to 0 on a successful push round. Drives the backoff delay. */
  failures: number;
  /** Successful pulls per replica name since start. Every CHECKPOINT_EVERY-th pull of a replica triggers `checkpoint()`. */
  pullCounts: Record<string, number>;
};

export const initialSyncState: SyncState = {
  phase: 'idle',
  pendingCount: 0,
  attentionCount: 0,
  lastPullAt: null,
  lastError: null,
  nextRetryAt: null,
  failures: 0,
  pullCounts: {},
};

export interface SyncDeps {
  outbox: Sql;
  replicas: Map<string, Replica>;
  /** Throws on transport/HTTP failure; the thrown value may carry a numeric `status`. */
  push(batch: {
    deviceId: string;
    schemaVersion: number;
    sentAt: string;
    movements: MovementInput[];
  }): Promise<SyncResponse>;
  deviceId: string;
  schemaVersion: number;
  now(): Date;
  hasValidSession(): boolean;
}

/** 401/403 means the session is no good; anything else (5xx, 400, fetch failure) is retried with backoff. */
export function pushErrorKind(err: unknown): 'auth' | 'offline' {
  const status =
    typeof err === 'object' && err !== null
      ? (err as { status?: unknown }).status
      : undefined;
  return status === 401 || status === 403 ? 'auth' : 'offline';
}

/** Delay after the n-th consecutive failure (n >= 1). */
export function backoffDelayMs(failures: number): number {
  return Math.min(
    BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1),
    BACKOFF_MAX_MS,
  );
}

const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

type PushOutcome =
  | { kind: 'none' } // nothing to push
  | { kind: 'ok' }
  | { kind: 'blocked'; phase: SyncPhase; error: string }
  | { kind: 'auth'; error: string }
  | { kind: 'offline'; error: string };

async function pushPending(deps: SyncDeps): Promise<PushOutcome> {
  const pending = (
    await listOutbox(deps.outbox, { status: 'pending' })
  ).flatMap((r) => ('corrupt' in r ? [] : [r]));
  if (pending.length === 0) return { kind: 'none' };
  for (let i = 0; i < pending.length; i += SYNC_BATCH_SIZE) {
    const chunk = pending.slice(i, i + SYNC_BATCH_SIZE);
    let res: SyncResponse;
    try {
      res = await deps.push({
        deviceId: deps.deviceId,
        schemaVersion: deps.schemaVersion,
        sentAt: deps.now().toISOString(),
        movements: chunk.map((r) => r.input),
      });
    } catch (err) {
      return { kind: pushErrorKind(err), error: errMessage(err) };
    }
    switch (res.status) {
      case 'ok': {
        const invalid = res.results.flatMap((r: RowResult) =>
          r.status === 'invalid' && r.id !== null
            ? [{ id: r.id, reason: r.reason }]
            : [],
        );
        await markNeedsAttention(deps.outbox, invalid);
        break;
      }
      case 'UPDATE_REQUIRED':
        return { kind: 'blocked', phase: 'update_required', error: res.status };
      case 'DEVICE_REVOKED':
        return { kind: 'blocked', phase: 'device_revoked', error: res.status };
      case 'DEVICE_UNKNOWN':
        return { kind: 'blocked', phase: 'device_unknown', error: res.status };
      default:
        // WAREHOUSE_NOT_READY: transient on the server side.
        return { kind: 'offline', error: res.status };
    }
  }
  return { kind: 'ok' };
}

async function reconcile(deps: SyncDeps): Promise<void> {
  const pending = await listOutbox(deps.outbox, { status: 'pending' });
  const byWarehouse = new Map<string, string[]>();
  for (const r of pending) {
    const ids = byWarehouse.get(r.warehouseId) ?? [];
    ids.push(r.id);
    byWarehouse.set(r.warehouseId, ids);
  }
  let firstError: unknown;
  let failed = false;
  for (const [warehouseId, ids] of byWarehouse) {
    const replica = deps.replicas.get(warehouseId);
    if (!replica) continue;
    try {
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const found = await replica.all<{ id: string }>(
          `SELECT id FROM Movement WHERE id IN (${chunk.map(() => '?').join(',')})`,
          chunk,
        );
        await deleteOutbox(
          deps.outbox,
          found.map((f) => f.id),
        );
      }
    } catch (err) {
      // Rows stay pending and are retried next run; other warehouses go on.
      if (!failed) firstError = err;
      failed = true;
    }
  }
  if (failed) throw firstError;
}

const describeError = (err: unknown): string =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err);

export async function runSyncOnce(
  deps: SyncDeps,
  prev: SyncState,
): Promise<SyncState> {
  const now = deps.now();
  let failures = prev.failures;
  let nextRetryAt: string | null = null;
  let lastError: string | null = null;
  let pushPhase: SyncPhase = 'idle';

  // 1-2. push. Storage errors (e.g. StorageFullError) must not stop the pulls.
  if (!deps.hasValidSession()) {
    pushPhase = 'needs_sign_in';
  } else {
    try {
      const out = await pushPending(deps);
      switch (out.kind) {
        case 'none':
        case 'ok':
          failures = 0;
          break;
        case 'blocked':
          pushPhase = out.phase;
          lastError = out.error;
          break;
        case 'auth':
          pushPhase = 'needs_sign_in';
          lastError = out.error;
          break;
        case 'offline':
          pushPhase = 'offline';
          lastError = out.error;
          failures += 1;
          nextRetryAt = new Date(
            now.getTime() + backoffDelayMs(failures),
          ).toISOString();
          break;
      }
    } catch (err) {
      lastError = describeError(err);
    }
  }

  // 3. pull every replica independently
  const pullCounts = { ...prev.pullCounts };
  let pulled = 0;
  let firstPullError: string | null = null;
  for (const [name, replica] of deps.replicas) {
    try {
      await replica.pull();
    } catch (err) {
      firstPullError ??= errMessage(err);
      continue;
    }
    pulled += 1;
    pullCounts[name] = (pullCounts[name] ?? 0) + 1;
    if (pullCounts[name] % CHECKPOINT_EVERY === 0) {
      try {
        await replica.checkpoint();
      } catch {
        // checkpoint is housekeeping; a failure must not fail the sync
      }
    }
  }
  const allPulled = pulled === deps.replicas.size;

  // 4. reconcile (deletes only rows present in their own warehouse replica)
  try {
    await reconcile(deps);
  } catch (err) {
    lastError ??= describeError(err);
  }

  // 5. counts and phase
  let pendingCount = prev.pendingCount;
  let attentionCount = prev.attentionCount;
  try {
    const rows = await listOutbox(deps.outbox);
    pendingCount = rows.filter((r) => r.status === 'pending').length;
    attentionCount = rows.length - pendingCount;
  } catch (err) {
    lastError ??= describeError(err);
  }

  let phase = pushPhase;
  if (phase === 'idle' && deps.replicas.size > 0 && pulled === 0) {
    phase = 'offline';
  }
  if (firstPullError !== null) lastError ??= firstPullError;

  return {
    phase,
    pendingCount,
    attentionCount,
    lastPullAt: allPulled ? now.toISOString() : prev.lastPullAt,
    lastError,
    nextRetryAt,
    failures,
    pullCounts,
  };
}

type SchedulerEnv = EventTarget & {
  document: { visibilityState: string };
};

export type SyncSchedulerStop = (() => void) & {
  /** Runs now, ignoring `nextRetryAt` (still single-flight). */
  triggerNow(): void;
};

/**
 * Triggers `run` on `online` (ignores nextRetryAt), on `visibilitychange` to
 * visible and every 30 s (both respect nextRetryAt). Never overlaps runs: a
 * trigger during a run schedules exactly one more run after it finishes.
 */
export function startSyncScheduler(
  run: () => Promise<void>,
  env: SchedulerEnv = window as unknown as SchedulerEnv,
  getNextRetryAt: () => string | null,
): SyncSchedulerStop {
  let running = false;
  let rerun: { force: boolean } | null = null;
  let stopped = false;

  const due = () => {
    const at = getNextRetryAt();
    if (at === null) return true;
    const t = new Date(at).getTime();
    // Unparseable: treat as no backoff rather than blocking forever.
    return Number.isNaN(t) || Date.now() >= t;
  };

  const trigger = (force: boolean) => {
    if (stopped) return;
    if (running) {
      rerun = { force: force || (rerun?.force ?? false) };
      return;
    }
    if (!force && !due()) return;
    running = true;
    void (async () => {
      try {
        await run();
      } catch {
        // run() reports its own failures through state
      } finally {
        running = false;
        const again = rerun;
        rerun = null;
        if (again) trigger(again.force);
      }
    })();
  };

  const onOnline = () => trigger(true);
  const onVisibility = () => {
    if (env.document.visibilityState === 'visible') trigger(false);
  };
  env.addEventListener('online', onOnline);
  env.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(() => trigger(false), SYNC_INTERVAL_MS);

  const stop = (() => {
    stopped = true;
    clearInterval(timer);
    env.removeEventListener('online', onOnline);
    env.removeEventListener('visibilitychange', onVisibility);
  }) as SyncSchedulerStop;
  stop.triggerNow = () => trigger(true);
  return stop;
}
