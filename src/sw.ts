/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, NetworkOnly } from 'workbox-strategies';
import {
  isNetworkOnly,
  isShellNavigation,
  NAVIGATION_TIMEOUT_SECONDS,
  SHELL_CACHE,
  SHELL_URL,
  withIsolationHeaders,
} from '#/pwa/sw-routes';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('install', (event) => {
  // The SSR document is not a build asset, so cache the shell explicitly.
  event.waitUntil(
    (async () => {
      const response = await fetch(SHELL_URL, { cache: 'reload' });
      if (response.ok) {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(SHELL_URL, withIsolationHeaders(response));
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Server functions and Turso traffic: never cached.
registerRoute(({ url }) => isNetworkOnly(url), new NetworkOnly());

// /h navigations: network first (3 s), then the cached /h shell. The page is
// client-rendered, so the router renders whichever /h/... route was requested.
registerRoute(
  ({ request, url }) => isShellNavigation(request, url),
  new NetworkFirst({
    cacheName: SHELL_CACHE,
    networkTimeoutSeconds: NAVIGATION_TIMEOUT_SECONDS,
    plugins: [
      {
        handlerDidError: async () => {
          const cached = await caches.match(SHELL_URL, {
            cacheName: SHELL_CACHE,
          });
          return cached ? withIsolationHeaders(cached) : undefined;
        },
        cachedResponseWillBeUsed: async ({ cachedResponse }) =>
          cachedResponse ? withIsolationHeaders(cachedResponse) : null,
      },
    ],
  }),
);
