import type { QueryClient } from '@tanstack/react-query';

/**
 * True for the error a desk server fn surfaces when its thrown 401/403
 * `Response` reaches the client: a Response, an object with that status,
 * or a plain Error whose message is the response text.
 */
export function isDeskAuthError(err: unknown): boolean {
  if (err instanceof Response) return err.status === 401 || err.status === 403;
  if (typeof err !== 'object' || err === null) return false;
  const { status, message } = err as { status?: unknown; message?: unknown };
  if (status === 401 || status === 403) return true;
  return message === 'Unauthorized' || message === 'Forbidden';
}

/**
 * Calls `onExpired` when any `['desk', ...]` query fails with an auth error.
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
      event.query.queryKey[0] === 'desk' &&
      isDeskAuthError(event.action.error)
    ) {
      onExpired();
    }
  });
}
