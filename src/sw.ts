/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';
import {
  buildIdFromManifest,
  handleShellNavigation,
  isNetworkOnly,
  isShellNavigation,
  type ManifestEntry,
  NAVIGATION_TIMEOUT_SECONDS,
  SHELL_URL,
  shellCacheName,
  staleShellCaches,
  withIsolationHeaders,
} from '#/pwa/sw-routes';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: ManifestEntry[];
};

const manifest = self.__WB_MANIFEST;
// The shell document is tied to this build: its cache name carries a hash of
// the precache manifest, so a different build never reads or writes it.
const SHELL_CACHE = shellCacheName(buildIdFromManifest(manifest));

precacheAndRoute(manifest);
cleanupOutdatedCaches();

// The ONLY writer of the shell cache. Runtime navigations never cache.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(SHELL_URL, { cache: 'reload' });
      // Fail the install (the old SW stays) rather than ship without a shell.
      if (!response.ok)
        throw new Error(`shell fetch failed: ${response.status}`);
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(SHELL_URL, withIsolationHeaders(response));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of staleShellCaches(await caches.keys(), SHELL_CACHE)) {
        await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

// Server functions and Turso traffic: never cached.
registerRoute(({ url }) => isNetworkOnly(url), new NetworkOnly());

// /h navigations: network (3 s), never cached; offline falls back to this
// build's /h shell. The page is client-rendered, so the router renders
// whichever /h/... route was requested.
registerRoute(
  ({ request, url }) => isShellNavigation(request, url),
  ({ request }) =>
    handleShellNavigation({
      fetchNetwork: () => fetch(request),
      readShell: () => caches.match(SHELL_URL, { cacheName: SHELL_CACHE }),
      timeoutMs: NAVIGATION_TIMEOUT_SECONDS * 1000,
    }),
);
