import { getCookie } from '@tanstack/react-start/server';
import {
  SESSION_COOKIE,
  type SessionClaims,
  verifySession,
} from '#/server/auth/session';
import type { GlobalClient } from '#/server/db/clients';

/** Desk sessions reuse the `fi_session` cookie with this pseudo device id. */
export const DESK_DEVICE_ID = 'desk';

export type DeskSession = SessionClaims & { role: 'supervisor' | 'admin' };

/** Pure guard: 401 without a session, 403 for workers. Role is what counts, not the device. */
export function authorizeDesk(claims: SessionClaims | null): DeskSession {
  if (!claims) throw new Response('Unauthorized', { status: 401 });
  if (claims.role !== 'supervisor' && claims.role !== 'admin') {
    throw new Response('Forbidden', { status: 403 });
  }
  return { ...claims, role: claims.role };
}

/** Reads the session cookie and authorizes it for the desk. */
export async function requireDeskSession(): Promise<DeskSession> {
  const token = getCookie(SESSION_COOKIE);
  const claims = token ? await verifySession(token) : null;
  return authorizeDesk(claims);
}

/** Desk user for the route guard: null for no session, workers and unknown users. */
export async function deskSessionInfo(
  global: GlobalClient,
  claims: SessionClaims | null,
): Promise<{ userId: string; name: string; role: DeskSession['role'] } | null> {
  if (!claims || claims.role === 'worker') return null;
  const user = await global.user.findUnique({ where: { id: claims.userId } });
  if (!user) return null;
  return { userId: user.id, name: user.name, role: claims.role };
}
