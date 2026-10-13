import type { VitePWAOptions } from 'vite-plugin-pwa';

/**
 * The SW is registered at `/` so it also controls dedicated workers whose
 * script lives outside `/h` (the sync engine's `/assets/worker-*.js`); Chromium
 * matches worker script URLs against SW scopes. Routing in src/sw.ts still only
 * handles `/h` navigations.
 */
export const SW_SCOPE = '/';
/** The installed app's scope (manifest). No trailing slash: `/h` and `/h/...`. */
export const APP_SCOPE = '/h';
export const SW_URL = '/sw.js';

export const MAX_PRECACHE_FILE_BYTES = 16 * 1024 * 1024;

/**
 * Precache globs, relative to dist/client. The `.wasm` (sync engine, ~13 MB)
 * and its worker script are precached so the app loads with no network.
 *
 * Navigation fallback, NetworkOnly routes and COOP/COEP re-application are
 * implemented in src/sw.ts using the helpers in src/pwa/sw-routes.ts.
 */
export const PRECACHE_GLOBS = [
  '**/*.{js,css,wasm,svg,png,ico,woff2,webmanifest}',
] as const;

export const pwaOptions: Partial<VitePWAOptions> = {
  strategies: 'injectManifest',
  srcDir: 'src',
  // Start builds the client into dist/client (the plugin would see dist/server).
  outDir: 'dist/client',
  filename: 'sw.ts',
  injectRegister: false,
  scope: SW_SCOPE,
  manifestFilename: 'manifest.webmanifest',
  manifest: {
    name: 'Field Inventory',
    short_name: 'Inventory',
    start_url: '/h',
    scope: APP_SCOPE,
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1c7ed6',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  },
  injectManifest: {
    globDirectory: 'dist/client',
    globPatterns: [...PRECACHE_GLOBS],
    maximumFileSizeToCacheInBytes: MAX_PRECACHE_FILE_BYTES,
  },
};
