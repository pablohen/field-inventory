import { deskFetch } from '#/shared/checked-fetch';

type FetchFn = typeof fetch;

/**
 * Calls a desk server fn with the auth-checking fetch, so an expired session
 * rejects with `HttpError(401|403)` instead of resolving as a raw Response.
 * Every desk call from the client goes through here.
 */
export function deskCall<R>(
  fn: (opts?: { fetch?: FetchFn }) => Promise<R>,
): Promise<R>;
export function deskCall<D, R>(
  fn: (opts: { data: D; fetch?: FetchFn }) => Promise<R>,
  data: D,
): Promise<R>;
export function deskCall(
  fn: (opts: never) => Promise<unknown>,
  data?: unknown,
): Promise<unknown> {
  const opts =
    data === undefined ? { fetch: deskFetch } : { data, fetch: deskFetch };
  return fn(opts as never);
}
