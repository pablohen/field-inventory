# Architecture

The source of truth for requirements is the
[design spec](superpowers/specs/2026-10-11-field-inventory-design.md). This page
is a map of how the code implements it.

## Databases

There are three kinds of database, each with its own Prisma schema, generated
client (`src/generated/*`) and SQL migrations (`prisma/<db>/migrations`):

| DB | Holds | Client |
|---|---|---|
| **global** | users, login attempts, devices, device ↔ warehouse assignments, warehouses (name, DB name, schema version) | `globalDb()` |
| **catalog** | products, barcodes, categories (with count tolerances), reason codes | `catalogDb()` |
| **warehouse** (one per warehouse) | locations, the movement ledger, stock balances, exceptions, pick lists, count tasks, clock samples | `warehouseDb(name)` |

Clients come from `src/server/db/clients.ts`. URLs are `file:` locally or
`libsql://` on Turso.
- **Migrations:** `src/server/db/migrate.ts` applies them, and
  `SCHEMA_VERSIONS` (`src/domain/schema-versions.ts`) records each DB's current
  version.
- **Readiness gate:** the server gates each warehouse on its stored schema
  version. A warehouse that isn't ready is refused, not corrupted.

## The ledger

Stock is never edited directly. Every change is an append-only **movement**:
`COUNT`, `MOVE`, `PICK`, `ADJUST`, `TRANSFER_OUT` or `TRANSFER_IN`. Each one
carries the time it physically happened (`occurredAt`, from the device clock)
and the order it arrived in (`seq`). Balances are derived from the ledger.
Nothing in the app hard-deletes movements, exceptions or master data.

`src/domain` holds the pure rules, and they are the heart of the system:
- `process.ts`: `processMovement` turns one incoming movement plus its
  context into **effects**: new movements (including system auto-adjusts),
  balance deltas, exceptions to raise, and count exceptions to supersede.
- `count.ts`: count reconciliation. A count's expected quantity is replayed at
  its `occurredAt`.
  - **Within tolerance:** the server writes a system `ADJUST` (`COUNT_AUTO`).
  - **Over tolerance:** it raises `COUNT_VARIANCE`.
- `detectors.ts`: `NEGATIVE_BALANCE`, `OVER_PICK`, `TRANSFER_STUCK` and
  `CLOCK_SKEW`.

**Late movements.** A movement can arrive after a count it physically happened
before. When it does, the server re-runs reconciliation for every count on that
bin that the movement precedes, earliest first:
- **Back within tolerance:** the count's open exception is closed as
  `SUPERSEDED` by the system.
- **Still over tolerance:** the old exception is superseded, and one
  `LATE_MOVEMENT` exception with the corrected variance replaces it.

So each count has at most one open count exception, and for bins with a single
count the same counts end up flagged in every arrival order. A known limit
(spec §12): a bin with several contradicting offline counts can still flag
differently depending on arrival order. Balances always converge.

## Sync

`syncMovementsCore` (`src/server/sync/sync-movements.ts`) is the single write
path for device movements:

1. **Check the device.** It must exist and not be revoked, the user must exist
   and not be disabled, and the schema version must match.
2. **Validate each row** with Zod (`src/domain/schemas.ts`). Duplicates are
   ignored by id, so retrying is safe.
3. **Apply each row** in its own transaction (`withMovementTx`, with generous
   `LEDGER_TX_OPTIONS` for remote Turso). The transaction loads the bin
   context, runs `processMovement`, and calls `persistEffects`.
4. **Return results per row** (`accepted`, `duplicate`, `invalid`) or a
   batch status such as `DEVICE_REVOKED` or `WAREHOUSE_NOT_READY`.

Supervisor actions such as resolving an exception or a correcting adjustment go
through the same ledger code. Exceptions carry a `version`, so two people
resolving at once get a conflict instead of a double resolution.

## Handheld (offline)

The handheld is a PWA under `/h`. Its service worker (`src/pwa/sw-routes.ts`,
`src/pwa-options.ts`) precaches the app shell, the wasm and the fonts, so it
loads with no connection.

- **Replicas.** On sign-in the server returns a replica config with read-only,
  per-database Turso tokens (`src/server/replicas`). The handheld then pulls
  embedded replicas of the catalog and its warehouses into OPFS
  (`src/handheld/replicas.ts`, using `@tursodatabase/sync-wasm`).
- **Recording.** Each scan is written to a local **outbox**
  (`src/handheld/outbox.ts`) and shown immediately as pending stock.
- **Sync loop.** `sync-loop.ts` and `push.ts` push the outbox, then pull fresh
  replicas. Rows rejected as invalid move to *needs attention*.
  - **Revoked or unknown device:** the push is refused, nothing is deleted, and
    the outbox can be exported (`/h/attention`).
- **Leader tab.** One tab owns the databases (`leader.ts`); other tabs talk to
  it.

Counts are blind: handheld screens never show the expected quantity.

## Auth

- **Logins.** Workers sign in on a device with a username and a 4-digit PIN;
  supervisors and admins do the same at `/desk/login`. Sessions are signed,
  httpOnly cookies (`src/server/auth`).
- **Live authorization.** Every request checks the current database row, so
  disabling a user, demoting them or revoking a device takes effect on the next
  request. `authorizeDesk` and `authorizeAdmin` live in
  `src/server/auth/authorize.ts`.
- **Lockout.** Repeated wrong PINs lock the account for a while. A PIN reset
  clears the lock.

## Server function pattern (desk and admin)

- `*.fn.ts`: thin TanStack server functions. They read the session claims and
  call a handler. They contain no database code.
- `*.server.ts`: `handleX(claims, input, deps)` authorizes first, then calls a
  pure-ish `xCore` that takes injected database deps, so tests use real SQLite
  files from `tests/support/test-env.ts`.
- **Failures.** Expected failures return a typed
  `DeskError { ok: false, code, message }`. Auth failures throw 401/403.
- **Client calls.** Clients call server functions through `deskCall`
  (`src/desk/desk-call.ts`) and run saves through `runMutation`
  (`src/desk/run-mutation.ts`). An expired session therefore redirects to
  sign-in instead of showing an inline error.

## UI

Mantine with one theme (`src/ui/theme.ts`) and CSS tokens (`src/ui/tokens.css`)
in the "Floor signage" style: warm stone, black ink, safety yellow, condensed
Archivo, light and dark modes.
- **Status colours** come only from `statusColor()` and `StatusBadge`
  (`src/ui/status.ts`). A unit test enforces WCAG AA contrast for every token
  pair.
- **Layout pieces:** `AuthSplit` (logins), `AppShellSidebar` (desk and admin
  frame), `ThemeToggle` (light, dark or auto, remembered per device).
- **Icons** are Phosphor and always decorative, beside text.
