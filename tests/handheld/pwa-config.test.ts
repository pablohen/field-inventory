import { describe, expect, it } from 'vitest';
import {
  isNetworkOnly,
  isShellNavigation,
  SHELL_URL,
  withIsolationHeaders,
} from '#/pwa/sw-routes';
import {
  MAX_PRECACHE_FILE_BYTES,
  pwaOptions,
  SW_SCOPE,
  SW_URL,
} from '#/pwa-options';
import { SECURITY_HEADERS } from '#/server/http/security-headers';

describe('pwa options', () => {
  it('scopes the app to /h (start_url included) and serves the SW from the root', () => {
    expect(SW_SCOPE).toBe('/h');
    expect(SW_URL).toBe('/sw.js');
    expect(pwaOptions.scope).toBe('/h');
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
