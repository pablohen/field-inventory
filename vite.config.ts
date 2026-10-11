import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaOptions } from './src/pwa-options.ts';
import { SECURITY_HEADERS } from './src/server/http/security-headers.ts';

/**
 * vite-plugin-pwa only builds the service worker when the (shared) resolved
 * config is not an SSR build, which Start's multi-environment build never
 * satisfies. So run the plugin's own generator after the client environment.
 */
function pwaForStart(): Plugin[] {
  const plugins = VitePWA(pwaOptions);
  const api = plugins.find((p) => p.name === 'vite-plugin-pwa')?.api as
    | { generateSW: () => Promise<void> }
    | undefined;
  if (!api) throw new Error('vite-plugin-pwa api not found');
  const clientSw: Plugin = {
    name: 'field-inventory:pwa-client-sw',
    apply: 'build',
    enforce: 'post',
    closeBundle: {
      sequential: true,
      async handler() {
        if (this.environment.name === 'client') await api.generateSW();
      },
    },
  };
  return [...plugins, clientSw];
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: { headers: SECURITY_HEADERS },
  preview: { headers: SECURITY_HEADERS },
  // @tursodatabase/sync-wasm spawns `new Worker(..., { type: 'module' })`;
  // the default 'iife' worker format breaks the emnapi thread pool.
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@tursodatabase/sync-wasm'] },
  plugins: [devtools(), tanstackStart(), viteReact(), pwaForStart()],
});

export default config;
