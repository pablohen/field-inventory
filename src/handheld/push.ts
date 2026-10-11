import type { SyncResponse } from '#/server/sync/sync-movements';
import type { SyncDeps } from './sync-loop';

type Batch = Parameters<SyncDeps['push']>[0];
type FetchFn = typeof fetch;
type ServerFn = (opts: { data: Batch; fetch?: FetchFn }) => Promise<unknown>;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Adapts the `syncMovements` server fn to `SyncDeps.push`.
 *
 * The client RPC layer drops the HTTP status: a thrown JSON `Response` comes
 * back as a *resolved* value and a non-JSON one becomes a plain `Error`. So the
 * call goes through a wrapping `fetch` that turns any non-2xx into an
 * `HttpError` carrying the numeric `status` (`pushErrorKind` reads it).
 * Transport failures stay as the original `TypeError`.
 */
export function createPush(
  fn: ServerFn,
  fetchImpl: FetchFn = (...a) => globalThis.fetch(...a),
): SyncDeps['push'] {
  const checked: FetchFn = async (...args) => {
    const res = await fetchImpl(...args);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new HttpError(res.status, body || `HTTP ${res.status}`);
    }
    return res;
  };
  return async (batch) => {
    const out = await fn({ data: batch, fetch: checked });
    if (
      typeof out !== 'object' ||
      out === null ||
      typeof (out as { status?: unknown }).status !== 'string'
    ) {
      throw new Error('Malformed sync response');
    }
    return out as unknown as SyncResponse;
  };
}
