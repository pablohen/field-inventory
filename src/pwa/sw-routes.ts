import { SECURITY_HEADERS } from '#/server/http/security-headers';

/** Pure helpers for the service worker (kept free of workbox imports for tests). */

/** The client-rendered shell document, cached on install. */
export const SHELL_URL = '/h';
export const SHELL_CACHE_PREFIX = 'fi-shell';
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

export type ManifestEntry = string | { url: string; revision: string | null };

/**
 * Per-build id: an FNV-1a hash of the precache manifest (url + revision).
 * Asset filenames are content-hashed, so it changes whenever any built asset
 * changes, i.e. whenever the SSR document could reference different assets.
 */
export function buildIdFromManifest(entries: readonly ManifestEntry[]): string {
  const text = entries
    .map((e) => (typeof e === 'string' ? e : `${e.url}@${e.revision ?? ''}`))
    .sort()
    .join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The shell cache owned by one SW build. */
export function shellCacheName(buildId: string): string {
  return `${SHELL_CACHE_PREFIX}-${buildId}`;
}

/** Shell caches (current and legacy unversioned) other than `own`. */
export function staleShellCaches(names: readonly string[], own: string) {
  return names.filter(
    (n) =>
      n !== own &&
      (n === SHELL_CACHE_PREFIX || n.startsWith(`${SHELL_CACHE_PREFIX}-`)),
  );
}

/**
 * Network first with a timeout; never writes to any cache. On a network
 * failure or timeout it serves the SW's own shell (`readShell`), if any.
 */
export async function handleShellNavigation(opts: {
  fetchNetwork: () => Promise<Response>;
  readShell: () => Promise<Response | undefined>;
  timeoutMs: number;
}): Promise<Response> {
  const fallback = async (error: unknown): Promise<Response> => {
    const cached = await opts.readShell();
    if (!cached) throw error;
    return withIsolationHeaders(cached);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('navigation timeout')),
      opts.timeoutMs,
    );
  });
  try {
    return await Promise.race([opts.fetchNetwork(), timeout]);
  } catch (error) {
    return fallback(error);
  } finally {
    clearTimeout(timer);
  }
}
