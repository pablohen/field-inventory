# Field Inventory

An offline-first, WMS-style stock-control prototype. Rugged handhelds record stock
movements with no connection and sync when they come back. A supervisor desk
reviews the conflicts that offline work produces, and an admin area manages
warehouses, master data, users and devices.

- **Handheld** (`/h`): an installable PWA for warehouse workers. It counts, moves,
  picks and adjusts stock fully offline against a local copy of the warehouse,
  keeps an outbox, and syncs when it reconnects.
- **Supervisor desk** (`/w/<warehouse>`): exceptions with a crossing-lanes view of
  physical vs arrival order, stock and ledger, pick lists and count tasks.
- **Admin** (`/admin`): warehouses (with database provisioning), locations,
  products, categories, reason codes, users, devices.

Stack: TanStack Start, Router and Query, Prisma 7 on libSQL/Turso, Mantine 9,
Zod 4, Phosphor icons, TypeScript 7, Biome, Vitest and Playwright.

More docs:
- [Architecture](docs/architecture.md): data model, the ledger, sync and
  conflict rules, handheld offline design.
- [User guide](docs/user-guide.md): what each screen does.
- [End-to-end tests](docs/e2e.md): running Playwright, including against Turso.
- [Design spec](docs/superpowers/specs/2026-10-11-field-inventory-design.md) and
  the [implementation plans](docs/superpowers/plans/).
- [AGENTS.md](AGENTS.md): conventions for coding agents and contributors.

## Quick start (local, no Turso)

Requires Node 24 and pnpm 12. The project uses TypeScript 7 (the native
compiler). For editor support, use its native language server, e.g. VS Code's
**TypeScript (Native Preview)** extension; the old `tsserver` doesn't exist in 7.

```bash
pnpm install
cp .env.example .env   # then set SESSION_SECRET (openssl rand -base64 48)
pnpm db:generate
pnpm db:seed
pnpm dev
```

Open http://localhost:3000/desk/login. By default the databases are local SQLite
files under `.data/`.

Seeded dev accounts all use PIN `1234`:

| Username | Role | Use |
|---|---|---|
| `admin` | admin | desk + `/admin` |
| `sup` | supervisor | desk |
| `ana`, `bruno` | worker | handheld (devices `dev-handheld-1`, `dev-handheld-2`) |

> **The handheld needs Turso.** It downloads its local copies (embedded replicas)
> straight from Turso, so with file databases the desk and admin work fully but a
> handheld can't load its data. See
> [Running against Turso](#running-against-turso).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server on port 3000 |
| `pnpm build` / `pnpm preview` | Production build / serve it |
| `pnpm db:generate` | Generate the three Prisma clients (global, catalog, warehouse) |
| `pnpm db:seed` | Seed dev data (idempotent; restores seeded users/devices) |
| `pnpm db:migrate` | Apply warehouse DB migrations to every warehouse |
| `pnpm lint` / `pnpm format` | Biome check / fix (the only linter and formatter) |
| `pnpm typecheck` | `tsc --noEmit` (TypeScript 7) |
| `pnpm test` | Vitest: unit, property, scenario and server tests |
| `pnpm e2e` | Playwright; Turso specs run only with `E2E_TURSO=1` |
| `pnpm e2e:reset` | Test-only: wipe and re-seed the dev warehouses (guarded) |
| `pnpm generate-routes` | Regenerate `src/routeTree.gen.ts` |

## Configuration

All settings come from the environment (`.env` locally). See `.env.example`.

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | Required, at least 32 characters; signs session cookies |
| `GLOBAL_DB_URL`, `CATALOG_DB_URL` | Global (users, devices, warehouses) and catalog DBs; `file:` or `libsql://` |
| `WAREHOUSE_DB_URL_TEMPLATE` | One DB per warehouse; `{name}` is the warehouse's DB name |
| `TURSO_GROUP_AUTH_TOKEN` | Server access to `libsql://` databases |
| `TURSO_ORG`, `TURSO_PLATFORM_TOKEN`, `CATALOG_TURSO_DB` | Turso Platform API: provisioning warehouses and minting read-only replica tokens for handhelds |

## Running against Turso

1. Create a Turso group and the global, catalog and warehouse databases (the
   dev seed expects warehouse DBs `fi-wh-1` and `fi-wh-2`).
2. Point the variables above at them (`libsql://…` URLs plus the tokens).
3. Run `pnpm db:migrate`, then `pnpm db:seed`, then `pnpm dev`.
4. Sign in on a handheld at `/h/login` with a seeded device and worker.

Warehouses created later from `/admin/warehouses` are provisioned through the
Turso Platform API automatically.

## Project layout

```
src/
  domain/      pure ledger logic: balances, count reconciliation, exception detectors
  server/      server functions and cores: auth, sync, replicas, desk, admin, db
  handheld/    offline engine (replicas, outbox, sync loop) and handheld components
  desk/        supervisor desk components and client helpers
  admin/       admin components and client-safe schemas
  ui/          theme, tokens, shared layout (sidebar, login split, toggles)
  routes/      file routes: /h, /w/$warehouseId, /admin, /desk/login
  pwa/         service worker routing
prisma/        global, catalog and warehouse schemas + SQL migrations
scripts/       seed, migrate, e2e reset
tests/         Vitest suites (domain, scenarios, server, handheld, desk, admin, ui)
e2e/           Playwright specs and fixtures
```

## Quality gate

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

CI (`.github/workflows/ci.yml`) runs `biome ci`, typecheck, tests, and e2e. The
Turso e2e runs only when the Turso secrets are configured.
