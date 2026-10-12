import type { GlobalClient } from '#/server/db/clients';
import type { DeskSession } from '#/server/desk/session';
import type { SessionClaims } from './session';

function deny(status: 401 | 403, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Live desk guard. The token only proves who signed in; the role and the
 * disabled flag are re-read from the DB on every call. No session, a deleted
 * user or a disabled user is 401 (the session is no longer valid, so the desk
 * sends them to sign-in); a DB role other than supervisor/admin is 403. The
 * returned `role` is the DB role, never the token's.
 */
export async function authorizeDesk(
  claims: SessionClaims | null,
  global: GlobalClient,
): Promise<DeskSession> {
  if (!claims) throw deny(401, 'Unauthorized');
  const user = await global.user.findUnique({ where: { id: claims.userId } });
  if (!user || user.disabledAt) throw deny(401, 'Unauthorized');
  if (user.role !== 'supervisor' && user.role !== 'admin') {
    throw deny(403, 'Forbidden');
  }
  return { ...claims, role: user.role };
}

/** Like `authorizeDesk`, but requires the DB role `admin`. */
export async function authorizeAdmin(
  claims: SessionClaims | null,
  global: GlobalClient,
): Promise<DeskSession & { role: 'admin' }> {
  const session = await authorizeDesk(claims, global);
  if (session.role !== 'admin') throw deny(403, 'Forbidden');
  return { ...session, role: 'admin' };
}

/** Handheld guard: 403 USER_DISABLED when the session's user is missing or disabled. */
export async function assertSessionUserActive(
  global: GlobalClient,
  claims: SessionClaims,
): Promise<void> {
  const user = await global.user.findUnique({
    where: { id: claims.userId },
    select: { disabledAt: true },
  });
  if (!user || user.disabledAt) {
    throw new Response(JSON.stringify({ error: 'USER_DISABLED' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
