# End-to-end tests

`pnpm e2e` runs Playwright (Chromium) against a production build served by
`vite preview` on port 4173.

Without `E2E_TURSO=1` the server uses local file databases. Only the
offline-shell specs run; the Turso specs are skipped:
- `handheld-offline`
- `multi-device` (three reconnect orders)
- `revoked-device`

The handheld needs Turso replicas, which is why those specs need Turso.

## Specs

| Spec | Proves |
|---|---|
| `offline-shell.spec.ts` | The handheld shell and worker load offline from the service worker |
| `handheld-offline.spec.ts` | Count and adjust offline, then sync back to 0 pending |
| `multi-device.spec.ts` | Two offline handhelds and a supervisor end with the same balances and open exceptions whether A or B reconnects first, or both at once, and the supervisor resolves the result |
| `revoked-device.spec.ts` | A revoked device keeps its offline work, can export it, and syncs it after restore |

Shared pieces live in `e2e/fixtures.ts`, `e2e/helpers.ts` and
`e2e/scenario-data.ts`.
- **Fixtures:** `handheldA` (ana on `dev-handheld-1`), `handheldB` (bruno on
  `dev-handheld-2`), `desk` and `admin`.
- **Scenario quantities** are derived from the seed, not hard-coded.

## Running the Turso E2E

1. Create the Turso dev databases (global, catalog, and the warehouses
   `fi-wh-1` and `fi-wh-2`), and set the server variables:
   - `SESSION_SECRET`
   - `TURSO_ORG`, `TURSO_PLATFORM_TOKEN`
   - `CATALOG_TURSO_DB`
   - `WAREHOUSE_DB_URL_TEMPLATE`
   - `TURSO_GROUP_AUTH_TOKEN`
   - `GLOBAL_DB_URL`, `CATALOG_DB_URL`
2. Apply migrations: `pnpm db:migrate`.
3. Run:

   ```bash
   E2E_TURSO=1 E2E_ALLOW_RESET=1 pnpm e2e
   ```

   Global setup seeds the databases. Before each Turso test,
   `pnpm e2e:reset` wipes the warehouse movements, balances, exceptions and
   clock samples, clears login lockouts, and re-seeds, which also un-revokes the
   seeded devices and re-enables the seeded users.

**Use dev databases only.** The reset is destructive. It refuses to run unless
both `E2E_TURSO=1` and `E2E_ALLOW_RESET=1` are set.

In CI the e2e job enables the Turso specs only when the Turso secrets are
configured. Runs share one concurrency group, so two runs never reset the same
databases at once.
