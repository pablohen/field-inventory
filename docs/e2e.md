# End-to-end tests

`pnpm e2e` runs Playwright against a production build served by `vite preview`.
Without `E2E_TURSO=1` only the offline-shell specs run (file DBs, no Turso);
`e2e/handheld-offline.spec.ts` is skipped.

## Running the Turso E2E

1. Create the databases with the `turso` CLI, in your dev group:
   `turso db create fi-wh-1 --group <group>`, `turso db create fi-wh-2 --group <group>`,
   and the catalog DB (the name you will put in `CATALOG_TURSO_DB`).
2. Set the env vars the server needs: `SESSION_SECRET`, `TURSO_ORG`,
   `TURSO_PLATFORM_TOKEN`, `CATALOG_TURSO_DB`, `WAREHOUSE_DB_URL_TEMPLATE`,
   `TURSO_GROUP_AUTH_TOKEN`, `GLOBAL_DB_URL`, `CATALOG_DB_URL`.
3. Apply migrations: `pnpm db:migrate`.
4. Run `E2E_TURSO=1 pnpm e2e`. Global setup runs `pnpm db:seed` first
   (user `ana`, device `dev-handheld-1`, warehouses `wh-1`/`wh-2`).
