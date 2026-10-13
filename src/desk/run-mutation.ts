import { isDeskAuthError, notifySessionExpired } from '#/desk/auth-error';
import type { DeskError } from '#/server/desk/warehouses.server';

export type MutationError = Pick<DeskError, 'code' | 'message'>;

const FALLBACK = 'Request failed';
const OFFLINE = 'Saving needs a connection';
// Chrome, Firefox and Safari wordings for a fetch that never reached the server.
const NETWORK = /failed to fetch|networkerror|load failed/i;

/** A server error body is often `{"error":"…"}` or `{"message":"…"}`. */
function fromJson(text: string): string | null {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return text;
  try {
    const body: unknown = JSON.parse(t);
    if (typeof body === 'object' && body !== null) {
      const { error, message } = body as { error?: unknown; message?: unknown };
      if (typeof error === 'string' && error) return error;
      if (typeof message === 'string' && message) return message;
    }
  } catch {
    // Truncated or malformed JSON is still not something to show.
  }
  return null;
}

/** A readable message for a thrown desk error; never raw JSON. */
export function readableError(err: unknown): string {
  if (err instanceof TypeError && NETWORK.test(err.message)) return OFFLINE;
  if (err instanceof Response) return `${FALLBACK} (HTTP ${err.status})`;
  if (err instanceof Error && err.message.trim()) {
    return fromJson(err.message) ?? FALLBACK;
  }
  return FALLBACK;
}

/**
 * Runs a desk/admin save. An auth error sends the user to sign-in; any other
 * throw is reported through `onError` as a readable INVALID. Resolves to the
 * fn's result, or `undefined` when it threw.
 */
export async function runMutation<T>(
  fn: () => Promise<T>,
  onError: (err: MutationError) => void,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (isDeskAuthError(err)) notifySessionExpired();
    else onError({ code: 'INVALID', message: readableError(err) });
    return undefined;
  }
}
