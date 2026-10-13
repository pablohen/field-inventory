# Field Inventory — Design Spec

- **Date:** 2026-10-11
- **Status:** Draft, awaiting review
- **Purpose:** A prototype of an offline-first field inventory app: a scaled-down cousin of a WMS, built to try out patterns for real WMS work. The main thing it tests is **conflict handling** for physical stock operations recorded offline.

## 1. Goals and non-goals

### Goals
- Floor workers on handhelds can record **cycle counts, moves/transfers, picks, and adjustments** with no connectivity. Their actions persist across reloads and restarts.
- Offline work from many devices **converges**: final stock balances don't depend on the order in which devices sync.
- Real-world conflicts (negative stock, count variance, late movements, over-picks, stuck transfers) are **detected and surfaced** to supervisors. They are never silently lost.
- The patterns (event ledger, outbox, idempotent sync, exceptions queue) should carry over to production WMS systems.

### Non-goals (for this prototype)
- Receiving and putaway.
- Editing master data offline (products, locations, users stay online-only, admin-only).
- Reporting dashboards, bulk exception actions, live push updates (SSE/WebSockets).
- Native app shells (Capacitor/Tauri). Handhelds run the web app as a PWA.

### Success criteria
- Property tests show that balances are the same for every arrival order of a randomly generated set of movements from several devices.
- A Playwright E2E test with two offline handheld contexts and one supervisor context produces the expected balances and exceptions under every reconnect order.
- No movement recorded offline is ever lost, whether it fails validation, loses a race, or comes from a revoked device.

## 2. Users and devices

| Role | Device | Connectivity |
|---|---|---|
| Worker | Rugged Android handheld (Zebra/Honeywell), PWA in Chrome, keyboard-wedge scanner (DataWedge) | Intermittent, must work fully offline |
| Supervisor | Desktop browser | Online only |
| Admin | Desktop browser | Online only |

One handheld may be assigned to **several warehouses**.

## 3. Stack

- **TanStack Start:** SSR app, routes, and server functions.
- **TanStack Router:** type-safe routes, with search params validated by Zod.
- **TanStack Query:** server state, mutations, and the optimistic UI.
- **Prisma** with the libSQL driver adapter: server-side data access.
- **Turso:** one global database plus **one database per warehouse**, with browser (WASM/OPFS) sync for read copies on handhelds.
- **Mantine:** UI components (core, form, dates, notifications, spotlight as needed).
- **Zod:** schemas shared between the client (outbox insert) and the server (sync validation).
- **Biome:** lint and format (see §10).
- **Vitest**, **fast-check**, **Playwright:** testing (see §9).

## 4. Architecture overview

**Approach A (chosen): Turso syncs reads, the server handles writes.**

- Handhelds keep **read-only** local copies of the catalog database (§5.1b) and of each assigned warehouse database, pulled with Turso browser sync and stored in OPFS. Devices **never push rows** to Turso.
- Worker actions go into a local **outbox**. A sync loop sends outbox rows to a TanStack Start server function. That function validates them, appends them to the warehouse ledger with Prisma, updates balances, and raises exceptions.
- Supervisor and admin screens are online-only and go through server functions and Prisma.

**Fallback (approach B):** if the browser sync spike (§11, milestone 0) fails, replace Turso browser sync with a custom `pullChanges(warehouseId, sinceSeq)` server function that serves ledger rows and balance changes after a cursor, stored in browser SQLite (wa-sqlite/OPFS). The outbox, ledger, exceptions, and UI don't change.

**Rejected (approach C):** Turso two-way sync with offline writes on the device. The sync engine would resolve conflicts at the row level, bypassing the ledger and exception rules.

```
Handheld (PWA)                                   Server (TanStack Start)                Turso
┌──────────────────────────────┐                 ┌──────────────────────────┐          ┌──────────────┐
│ UI ─ useMutation ─► outbox   │──push batch───► │ syncMovements (Zod)      │─Prisma──►│ warehouse DB │
│  ▲                  (local)  │◄─per-row result─│  ledger + balance +      │          │ (one per WH) │
│  │ local queries             │                 │  exception detection     │          └──────┬───────┘
│ replica(s) + pending deltas  │◄──────────────── Turso sync pull (read-only, scoped tokens) ───┘
└──────────────────────────────┘                 └──────────────────────────┘
Supervisor (desktop) ──────── server functions ──► Prisma ──► global DB / warehouse DBs
```

## 5. Data model

### 5.1 Global database (single, server only)
- `User` (id, name, role: `worker | supervisor | admin`)
- `Warehouse` (id, name, tursoDbName, schemaVersion)
- `Device` (id, label, enrolledAt, revokedAt?)
- `DeviceWarehouse` (deviceId, warehouseId)

### 5.1b Catalog database (single, synced read-only to handhelds)
- `Product` (id, sku, name, barcode(s), uom, countTolerance?)
- `ProductCategory` (id, name, countTolerance), used as the tolerance fallback when the product has none
- `ReasonCode` (code, label, appliesTo: movement types)

The catalog is kept separate from the global database so user and device data never reach handhelds. Both are covered by the `global` Prisma client (two datasources and two clients if Prisma requires it; decided in milestone 1).

### 5.2 Warehouse database (one per warehouse, identical schema)
- `Location` (id, code, zone, active)
- `Movement`: the **append-only ledger**
  - `id`: client-generated UUID (idempotency key)
  - `seq`: server-assigned, monotonic, arrival order
  - `type`: `PICK | MOVE | COUNT | ADJUST | TRANSFER_OUT | TRANSFER_IN`
  - `skuId`, `fromLocationId?`, `toLocationId?`, `qty`
  - `reasonCode?`, `ref?` (pick line / count task / transfer id)
  - `userId`, `deviceId`, `occurredAt` (device clock), `receivedAt` (server clock)
  - `source`: `device | supervisor | system` (system = auto-adjust)
- `StockBalance` (skuId, locationId, qty): updated **only** by the server, in the same transaction as each movement. It **may go negative**.
- `PickList` (id, status, assignedUserId?, createdBy, createdAt) and `PickLine` (id, pickListId, skuId, locationId, qtyRequested)
- `CountTask` (id, scope: locations/zone/skus, assignedUserId?, status)
- `Exception` (id, type, status `OPEN | RESOLVED`, movementIds, skuId, locationId, details JSON, version, resolvedBy?, resolution?, note?, createdAt, resolvedAt?)
- `DeviceClockSample` (deviceId, deviceTime, serverTime, skewMs)

### 5.3 Movement semantics
- **PICK:** decreases `from` by qty. If `ref` points to a pick line, it is checked against `qtyRequested`.
- **MOVE:** decreases `from` and increases `to`, within one warehouse.
- **ADJUST:** a signed qty applied to one location. It needs a reason code.
- **COUNT:** records **what was observed**, not a change (see §5.4).
- **TRANSFER_OUT / TRANSFER_IN:** a move between warehouses, split across two warehouse databases and linked by a transfer id in `ref`. Stock is "in transit" between the two.

### 5.4 Count reconciliation
1. The server works out the **expected** balance for (sku, location) at the count's `occurredAt` by replaying that bin's movements ordered by `occurredAt`.
2. `variance = observed − expected`.
3. If `|variance| ≤ tolerance` (product's, else category's), the server writes a `system` `ADJUST` movement for the variance (with a `COUNT_AUTO` reason code). Otherwise it raises a `COUNT_VARIANCE` exception.
4. Counts are **blind**: handhelds never show the expected quantity.

### 5.5 Exception types (raised by the server at write time)
| Type | Trigger |
|---|---|
| `NEGATIVE_BALANCE` | A movement drives a balance below zero |
| `COUNT_VARIANCE` | The count variance is over tolerance |
| `LATE_MOVEMENT` | A movement arrives with an `occurredAt` before an accepted count on the same (sku, location). The server re-runs that count's reconciliation and records the result (the previous auto-adjust is kept and a correcting adjust is added, or an exception is raised) |
| `OVER_PICK` | The total picked against a pick line is more than `qtyRequested` |
| `TRANSFER_STUCK` | A `TRANSFER_OUT` has had no matching `TRANSFER_IN` after N hours (configurable). Checked when the exceptions list is loaded and on each sync |
| `CLOCK_SKEW` | A device's measured clock drift is over the threshold |

A count has at most one open count exception (`COUNT_VARIANCE` or `LATE_MOVEMENT`), whatever the arrival order of the movements around it. When a late movement makes the server re-run a count:
- If the corrected variance is within tolerance, the count's open exception is closed as `SUPERSEDED` (resolved by `system`, in the same transaction).
- If the corrected variance is still over tolerance and the re-run changes the result, the old exception is superseded and one `LATE_MOVEMENT` with the corrected variance replaces it.
- If it is over tolerance and nothing changes, the existing exception stays open.

## 6. Handheld: local storage and sync

### 6.1 Local storage
- One local copy per assigned warehouse, plus the catalog copy, all read-only.
- One local read-write `outbox` database. Each row is a movement payload plus `status: pending | needs_attention` and `lastError?`.
- The server issues **read-only, warehouse-scoped Turso tokens** to each device and renews them whenever it's online.
- **Single-writer:** OPFS sync access handles are exclusive, so a Web Lock elects one tab as the "sync leader". Other tabs talk to it over `BroadcastChannel`.

### 6.2 Recording an action (works offline)
1. The worker scans and confirms. `useMutation`'s `mutationFn` validates the payload with the **shared Zod schema** and inserts it into the outbox with a new UUID and `occurredAt = now()`.
2. `onMutate` patches the cached quantity optimistically, and `onSettled` invalidates the local queries.
3. Local queries compute **displayed stock = local copy's `StockBalance` + pending outbox deltas**. They use `networkMode: 'always'`.
4. Durability comes from the outbox, not from Query's paused-mutation persistence.

### 6.3 Sync loop
Triggered by the `online` event, by `visibilitychange` to visible, and every 30 s while online. Only the sync leader runs it.
1. **Push:** send pending outbox rows in batches to `syncMovements({ deviceId, schemaVersion, movements[] })`. The response contains a per-row `accepted | duplicate | invalid(reason)`, the exceptions raised, and `serverTime`.
2. **Pull:** run `sync()` on each warehouse copy and on the catalog.
3. **Reconcile:** delete outbox rows whose `id` is now in the local copy's `Movement` table. `invalid` rows become `needs_attention` for the worker to fix or discard.
4. **Clock:** the server records a `DeviceClockSample` on each push.

### 6.4 UI
- A status pill shows online/offline, the pending count, the last sync time, and how stale the copy is.
- A pending badge appears on rows that depend on unconfirmed movements.
- A "needs attention" list for invalid outbox rows.
- Exceptions caused by this worker's own movements, shown after sync.
- Screens: warehouse picker, cycle count (task or one-off), move, pick (assigned lists), adjust. All are built around scanning, with the input focused for the keyboard-wedge scanner.

### 6.5 Pick lists
Supervisors create and assign them online, and they reach handhelds through the local copy. Assignment is **advisory**. Two people picking the same list offline is allowed and surfaces as `OVER_PICK` or `NEGATIVE_BALANCE`.

## 7. Server: `syncMovements`
- Validates the batch envelope with Zod and rejects outdated `schemaVersion` with `UPDATE_REQUIRED`. The outbox is kept on the client.
- Checks the device is enrolled, not revoked, and assigned to each movement's warehouse.
- Processes the device's movements **in `occurredAt` order**, each in **its own transaction**:
  1. If the `id` already exists, return `duplicate`.
  2. Validate references (SKU, location, pick line, count task). If any is invalid, return `invalid`.
  3. Insert the `Movement` with the next `seq`, update `StockBalance`, run exception detection (§5.5) and count reconciliation (§5.4).
- Domain logic (balances, reconciliation, detection) lives in **pure functions** that take movements and return effects. `syncMovements` only does I/O around them.

## 8. Supervisor and admin (desktop, online only)
Lists use route search params validated by Zod (shareable URLs) and refresh by polling with Query's `refetchInterval` (10 s).

### `/w/$warehouseId/…`
- `exceptions`: a table of open exceptions with filters (type, SKU, bin, worker, age) and counts per type.
- `exceptions/$id`: a timeline of the involved movements showing **both orderings side by side**: `occurredAt` (physical) and `seq` (arrival). Resolutions:
  - **Accept as-is**
  - **Correcting adjustment** (reason code, written to the ledger with `source: supervisor`)
  - **Request recount** (creates a `CountTask`)
  - **Dismiss with note**
  - Protected against two supervisors acting at once by `version`. A stale version returns `409` with a "resolved by someone else" message.
- `stock`: balances by SKU/bin. Each row drills into the ledger with a running balance.
- `pick-lists`: create (SKUs and quantities, with source bins suggested from balances) and assign.
- `counts`: create count tasks by bin, zone, or SKU, and assign them.

### `/admin`
- Warehouses: creating one sets up a Turso database through the Platform API and applies warehouse migrations.
- Locations, products, categories and tolerances, reason codes.
- Users and roles, device enrollment and warehouse assignment.

### Prisma setup
- Two Prisma schemas and two generated clients: `global` and `warehouse`.
- The warehouse client is created per warehouse database through the libSQL adapter and cached per `warehouseId`.
- A migration script applies warehouse migrations to every warehouse database. It can safely be re-run and records `schemaVersion` on each database. The server refuses to serve a warehouse whose database is at the wrong version.

## 9. Error handling and testing

### 9.1 Error handling
| Failure | Behavior |
|---|---|
| OPFS missing or storage quota exceeded | The app refuses to enter offline mode and shows a blocking banner |
| Turso pull fails | The device keeps its last good copy and shows how stale it is. It warns after N hours (configurable) |
| Push only partly succeeds | Each row is handled separately. Failed rows are retried with exponential backoff, which is safe because duplicates are ignored |
| Login expires while offline | The worker keeps recording, attributed to the cached user. The app signs in again before pushing |
| Device revoked | Push is rejected and the outbox is kept and can be exported, never deleted |
| Schema version mismatch | `UPDATE_REQUIRED`. The outbox is kept |
| Migration only partly applied across warehouse DBs | The script can be re-run. The server gates each warehouse on `schemaVersion` |

### 9.2 Testing
1. **Unit tests (Vitest, TDD):** the pure domain functions: balance calculation, replaying a count at `occurredAt`, tolerance checks, and each exception detector.
2. **Property tests (fast-check):** random movement sets from several devices applied in every arrival order. Final balances must be identical, and the exception sets equivalent.
3. **Scenario files:** short, readable descriptions of device offline windows, actions with `occurredAt`, and sync order. They are replayed through the real `syncMovements` code against a local libSQL file and checked against expected balances and exceptions. They include clock drift through an injectable clock. Every edge case found becomes a scenario.
4. **Server integration tests:** ignored duplicates, `409` on concurrent resolve, mixed valid/invalid batches, schema version gating, device revocation.
5. **End-to-end (Playwright, Chromium):** two handheld contexts and one supervisor context use `context.setOffline(true)`, make conflicting changes, reconnect in different orders, and resolve the result.

## 10. Tooling
- **Biome** is the only linter and formatter (no ESLint/Prettier), with one root `biome.json` using the recommended rules. Promise-safety rules are on where Biome supports them.
- Ignored: `routeTree.gen.ts` and the generated Prisma clients.
- Scripts:
  - `lint`: `biome check`
  - `format`: `biome check --write`
  - `typecheck`: `tsc --noEmit`
  - `test`: Vitest
  - `e2e`: Playwright
- CI runs `biome ci`, `typecheck`, `test`, `e2e`.

## 11. Milestones
0. **Spike (throwaway): Turso browser sync.** Prove that pulling into OPFS works, that more than one warehouse database can be open in one tab, that data survives a reload, that the read-only scoped tokens work, and that it runs in Chrome on Android. If any of these fail, switch to approach B (§4).
1. Project scaffold: TanStack Start, Mantine, Biome, Vitest. Global and warehouse Prisma schemas plus the migration script.
2. Domain core: pure functions with unit and property tests.
3. `syncMovements` with scenario and integration tests.
4. Handheld: local storage, outbox, sync loop, and the count/move/pick/adjust screens.
5. Supervisor: exceptions list and detail, stock and ledger, pick lists, count tasks.
6. Admin: warehouses (Turso setup), master data, users and devices.
7. Playwright multi-device E2E.

## 12. Open risks
- **Turso browser sync maturity:** covered by milestone 0 and the approach B fallback.
- **Device clock drift:** count reconciliation depends on `occurredAt`. Drift is measured on every sync and flagged with `CLOCK_SKEW`, but not corrected automatically.
- **Revocation lag on replica tokens:** a disabled worker or revoked device keeps read-only replica access with already-minted tokens until they expire (7 days at most). Turso tokens can't be revoked individually; rotate the group token if this needs to be cut off sooner.
- **OPFS on rugged Android Chrome versions:** checked in milestone 0 on a real or emulated target if possible.
