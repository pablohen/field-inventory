type FetchFn = typeof fetch;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

const defaultFetch: FetchFn = (...a) => globalThis.fetch(...a);

/** Wraps fetch so any non-2xx throws an `HttpError` carrying the status. */
export function checkedFetch(fetchImpl: FetchFn = defaultFetch): FetchFn {
  return async (...args) => {
    const res = await fetchImpl(...args);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new HttpError(res.status, body || `HTTP ${res.status}`);
    }
    return res;
  };
}

/**
 * Wraps fetch so only 401/403 throw an `HttpError`. The client RPC layer would
 * otherwise resolve a thrown auth `Response` as a plain value (`x-tss-raw`).
 * Everything else is returned untouched, so typed `DeskError` bodies and
 * deserialized 500s keep their normal handling.
 */
export function authCheckedFetch(fetchImpl: FetchFn = defaultFetch): FetchFn {
  return async (...args) => {
    const res = await fetchImpl(...args);
    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => '');
      throw new HttpError(res.status, body || `HTTP ${res.status}`);
    }
    return res;
  };
}

/** Fetch for desk server-fn calls: throws `HttpError` on 401/403 only. */
export const deskFetch: FetchFn = authCheckedFetch();
