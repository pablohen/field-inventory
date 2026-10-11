import { describe, expect, it, vi } from 'vitest';
import {
  buildIdFromManifest,
  handleShellNavigation,
  isNetworkOnly,
  isShellNavigation,
  SHELL_URL,
  shellCacheName,
  staleShellCaches,
  withIsolationHeaders,
} from '#/pwa/sw-routes';
import {
  APP_SCOPE,
  MAX_PRECACHE_FILE_BYTES,
  pwaOptions,
  SW_SCOPE,
  SW_URL,
} from '#/pwa-options';
import { SECURITY_HEADERS } from '#/server/http/security-headers';

describe('pwa options', () => {
  it('registers the SW at / but keeps the installed app scoped to /h', () => {
    expect(SW_SCOPE).toBe('/');
    expect(APP_SCOPE).toBe('/h');
    expect(SW_URL).toBe('/sw.js');
    expect(pwaOptions.scope).toBe('/');
    expect(pwaOptions.manifest).toMatchObject({
      name: 'Field Inventory',
      short_name: 'Inventory',
      start_url: '/h',
      scope: '/h',
      display: 'standalone',
    });
  });

  it('precaches the wasm and allows large files', () => {
    const globs = pwaOptions.injectManifest?.globPatterns ?? [];
    expect(globs.some((g) => g.includes('wasm'))).toBe(true);
    expect(globs.some((g) => g.includes('js'))).toBe(true);
    expect(
      pwaOptions.injectManifest?.maximumFileSizeToCacheInBytes,
    ).toBeGreaterThanOrEqual(16 * 1024 * 1024);
    expect(MAX_PRECACHE_FILE_BYTES).toBeGreaterThanOrEqual(16 * 1024 * 1024);
  });
});

describe('sw routing helpers', () => {
  it('falls back to the /h shell for /h navigations only', () => {
    expect(SHELL_URL).toBe('/h');
    const nav = { mode: 'navigate' };
    expect(isShellNavigation(nav, new URL('https://x/h'))).toBe(true);
    expect(isShellNavigation(nav, new URL('https://x/h/'))).toBe(true);
    expect(isShellNavigation(nav, new URL('https://x/h/login'))).toBe(true);
    expect(isShellNavigation(nav, new URL('https://x/h/wh1/count'))).toBe(true);
    expect(isShellNavigation(nav, new URL('https://x/hx'))).toBe(false);
    expect(isShellNavigation(nav, new URL('https://x/hx/y'))).toBe(false);
    expect(isShellNavigation(nav, new URL('https://x/'))).toBe(false);
    expect(isShellNavigation(nav, new URL('https://x/admin'))).toBe(false);
    expect(
      isShellNavigation({ mode: 'cors' }, new URL('https://x/h/login')),
    ).toBe(false);
  });

  it('never caches server functions or Turso traffic', () => {
    expect(isNetworkOnly(new URL('https://x/_serverFn/abc?x=1'))).toBe(true);
    expect(isNetworkOnly(new URL('https://db-org.turso.io/v2/pipeline'))).toBe(
      true,
    );
    expect(isNetworkOnly(new URL('https://turso.io/x'))).toBe(true);
    expect(isNetworkOnly(new URL('https://api.turso.tech/v1/orgs'))).toBe(true);
    expect(isNetworkOnly(new URL('https://x/h/login'))).toBe(false);
    expect(isNetworkOnly(new URL('https://x/assets/a.js'))).toBe(false);
    expect(isNetworkOnly(new URL('https://notturso.io.evil.com/'))).toBe(false);
  });

  it('merges COOP/COEP into a response, keeping existing headers', async () => {
    const original = new Response('<html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html', 'x-keep': '1' },
    });
    const out = withIsolationHeaders(original);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      expect(out.headers.get(k)).toBe(v);
    }
    expect(out.headers.get('x-keep')).toBe('1');
    expect(out.headers.get('content-type')).toBe('text/html');
    expect(out.status).toBe(200);
    expect(await out.text()).toBe('<html></html>');
  });
});

describe('versioned shell cache', () => {
  it('derives a stable id that changes with the manifest', () => {
    const a = [{ url: 'assets/a-1.js', revision: null }, 'x.css'];
    expect(buildIdFromManifest(a)).toBe(buildIdFromManifest([...a].reverse()));
    expect(buildIdFromManifest(a)).not.toBe(
      buildIdFromManifest([{ url: 'assets/a-2.js', revision: null }, 'x.css']),
    );
    expect(shellCacheName('abc')).toBe('fi-shell-abc');
  });

  it('prunes every other shell cache, including the legacy one', () => {
    expect(
      staleShellCaches(
        ['fi-shell', 'fi-shell-old', 'fi-shell-new', 'workbox-precache-v2'],
        'fi-shell-new',
      ),
    ).toEqual(['fi-shell', 'fi-shell-old']);
  });
});

describe('handleShellNavigation', () => {
  const shell = () =>
    Promise.resolve(new Response('shell', { headers: { 'x-a': '1' } }));

  it('returns the network response and never touches the shell on success', async () => {
    const readShell = vi.fn(shell);
    const res = await handleShellNavigation({
      fetchNetwork: () => Promise.resolve(new Response('net')),
      readShell,
      timeoutMs: 50,
    });
    expect(await res.text()).toBe('net');
    expect(readShell).not.toHaveBeenCalled();
  });

  it('serves only the versioned shell, with isolation headers, on failure', async () => {
    const res = await handleShellNavigation({
      fetchNetwork: () => Promise.reject(new Error('offline')),
      readShell: shell,
      timeoutMs: 50,
    });
    expect(await res.text()).toBe('shell');
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe(
      'require-corp',
    );
  });

  it('falls back on timeout and rethrows when there is no shell', async () => {
    const hang = () => new Promise<Response>(() => {});
    const res = await handleShellNavigation({
      fetchNetwork: hang,
      readShell: shell,
      timeoutMs: 10,
    });
    expect(await res.text()).toBe('shell');
    await expect(
      handleShellNavigation({
        fetchNetwork: () => Promise.reject(new Error('offline')),
        readShell: () => Promise.resolve(undefined),
        timeoutMs: 10,
      }),
    ).rejects.toThrow('offline');
  });
});
