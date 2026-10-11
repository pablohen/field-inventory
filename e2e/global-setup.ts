import { execSync } from 'node:child_process';

export default function globalSetup() {
  if (process.env.E2E_TURSO !== '1') return;
  execSync('pnpm db:seed', { stdio: 'inherit' });
}
