import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { SECURITY_HEADERS } from './src/server/http/security-headers';

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: { headers: SECURITY_HEADERS },
  preview: { headers: SECURITY_HEADERS },
  optimizeDeps: { exclude: ['@tursodatabase/sync-wasm'] },
  plugins: [devtools(), tanstackStart(), viteReact()],
});

export default config;
