import { SECURITY_HEADERS } from '#/server/http/security-headers';

/** Pure helpers for the service worker (kept free of workbox imports for tests). */

/** The client-rendered shell document, cached on install. */
export const SHELL_URL = '/h';
export const SHELL_CACHE = 'fi-shell';
export const NAVIGATION_TIMEOUT_SECONDS = 3;

/** Start's server-function base path. */
export const SERVER_FN_PREFIX = '/_serverFn/';

/** Requests that must always hit the network and never be cached. */
export function isNetworkOnly(url: URL): boolean {
  if (url.pathname.startsWith(SERVER_FN_PREFIX)) return true;
  if (url.hostname === 'api.turso.tech') return true;
  return url.hostname === 'turso.io' || url.hostname.endsWith('.turso.io');
}

/** Document navigations inside the handheld app (`/h` or `/h/...`, not `/hx`). */
export function isShellNavigation(
  request: { mode: string },
  url: URL,
): boolean {
  return (
    request.mode === 'navigate' &&
    (url.pathname === SHELL_URL || url.pathname.startsWith(`${SHELL_URL}/`))
  );
}

/** Copies `response` (dropping the redirected flag) with COOP/COEP applied. */
export function withIsolationHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
