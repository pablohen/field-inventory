import { getCookie } from '@tanstack/react-start/server';
import { jwtVerify, SignJWT } from 'jose';
import { requireSessionSecret } from '#/server/http/server-env';

export type Role = 'worker' | 'supervisor' | 'admin';

export type SessionClaims = {
  userId: string;
  deviceId: string;
  role: Role;
  exp: number;
};

export const SESSION_COOKIE = 'fi_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(
    requireSessionSecret(process.env.SESSION_SECRET),
  );
}

export async function signSession(
  claims: { userId: string; deviceId: string; role: Role },
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ deviceId: claims.deviceId, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_TTL_SECONDS)
    .sign(secretKey());
}

export async function verifySession(
  token: string,
  now: Date = new Date(),
): Promise<SessionClaims | null> {
  const key = secretKey();
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      currentDate: now,
    });
    const { sub, deviceId, role, exp } = payload;
    if (
      typeof sub !== 'string' ||
      typeof deviceId !== 'string' ||
      typeof exp !== 'number' ||
      (role !== 'worker' && role !== 'supervisor' && role !== 'admin')
    ) {
      return null;
    }
    return { userId: sub, deviceId, role, exp };
  } catch {
    return null;
  }
}

/** Reads the session cookie or throws a 401 Response. */
export async function requireSession(): Promise<SessionClaims> {
  const token = getCookie(SESSION_COOKIE);
  const claims = token ? await verifySession(token) : null;
  if (!claims) throw new Response('Unauthorized', { status: 401 });
  return claims;
}
