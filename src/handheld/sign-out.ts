import { logout } from '#/server/auth/auth.fn';
import { clearCachedSession } from './session-store';

/**
 * Ends the server session and drops the cached one, then does a full
 * navigation to the login page. The outbox and replicas are left alone: rows
 * recorded before sign-out sync later under their original user.
 */
export async function signOut(): Promise<void> {
  try {
    await logout();
  } catch {
    // offline: the cookie expires on its own; the local session is still cleared
  }
  clearCachedSession();
  window.location.assign('/h/login');
}
