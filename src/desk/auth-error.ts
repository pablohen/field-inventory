import type { QueryClient } from '@tanstack/react-query';
import { HttpError } from '#/shared/checked-fetch';

/**
 * True for the error a desk server fn surfaces when its thrown 401/403
 * `Response` reaches the client: a Response, an object with that status,
 * or a plain Error whose message is the response text.
 */
export function isDeskAuthError(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 401 || err.status === 403;
  if (err instanceof Response) return err.status === 401 || err.status === 403;
  if (typeof err !== 'object' || err === null) return false;
  const { status, message } = err as { status?: unknown; message?: unknown };
  if (status === 401 || status === 403) return true;
  return message === 'Unauthorized' || message === 'Forbidden';
}

const toLogin = () => window.location.assign('/desk/login');
let expiredHandler: (() => void) | null = null;

/**
 * Sets what `notifySessionExpired` does, normally the desk/admin layout's
 * navigate to sign-in. Returns a function that clears it again.
 */
export function onSessionExpired(handler: () => void): () => void {
  expiredHandler = handler;
  return () => {
    if (expiredHandler === handler) expiredHandler = null;
  };
}

/** Sends the user to sign-in after a save failed auth. */
export function notifySessionExpired(): void {
  (expiredHandler ?? toLogin)();
}

const WATCHED_ROOTS: ReadonlySet<unknown> = new Set(['desk', 'admin']);

/**
 * Calls `onExpired` when any `['desk', ...]` or `['admin', ...]` query fails
 * with an auth error.
 * Returns the unsubscribe function.
 */
export function watchDeskAuth(
  queryClient: QueryClient,
  onExpired: () => void,
): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    if (
      event.type === 'updated' &&
      event.action.type === 'error' &&
      WATCHED_ROOTS.has(event.query.queryKey[0]) &&
      isDeskAuthError(event.action.error)
    ) {
      onExpired();
    }
  });
}
