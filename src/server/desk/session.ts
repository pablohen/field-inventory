import { getCookie } from '@tanstack/react-start/server';
import { authorizeDesk } from '#/server/auth/authorize';
import {
  SESSION_COOKIE,
  type SessionClaims,
  verifySession,
} from '#/server/auth/session';
import { type GlobalClient, globalDb } from '#/server/db/clients';

/** Desk sessions reuse the `fi_session` cookie with this pseudo device id. */
export const DESK_DEVICE_ID = 'desk';

export type DeskSession = SessionClaims & { role: 'supervisor' | 'admin' };

export { authorizeDesk } from '#/server/auth/authorize';

/** Verified claims from the `fi_session` cookie, or null. */
export async function readDeskClaims(): Promise<SessionClaims | null> {
  const token = getCookie(SESSION_COOKIE);
  return token ? verifySession(token) : null;
}

/** Reads the session cookie and authorizes it for the desk. */
export async function requireDeskSession(): Promise<DeskSession> {
  return authorizeDesk(await readDeskClaims(), globalDb());
}

/** Desk user for the route guard: null for no session, DB workers, disabled and unknown users. */
export async function deskSessionInfo(
  global: GlobalClient,
  claims: SessionClaims | null,
): Promise<{ userId: string; name: string; role: DeskSession['role'] } | null> {
  if (!claims) return null;
  const user = await global.user.findUnique({ where: { id: claims.userId } });
  if (!user || user.disabledAt) return null;
  if (user.role !== 'supervisor' && user.role !== 'admin') return null;
  return { userId: user.id, name: user.name, role: user.role };
}
