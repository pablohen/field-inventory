# Field Inventory: Plan 2, Handheld (offline PWA)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The worker-facing handheld PWA. Workers sign in, read local copies of warehouse databases, and record counts, moves/transfers, picks and adjustments offline through an outbox. The app syncs on reconnect and shows pending, needs-attention and exception state.

**Architecture:**
- Local copies (replicas) of each assigned warehouse database and of the catalog are pulled with `@tursodatabase/sync-wasm` into OPFS and opened read-only.
- Worker actions go into a separate local-only `outbox.db`. Displayed stock = replica `StockBalance` + pending outbox deltas, computed with plan 1's `movementDeltas`.
- A sync loop pushes the outbox to `syncMovements` (now session-authenticated), pulls the replicas, and deletes outbox rows that have appeared in the replica.
- All SQL-level logic sits behind a small `Sql` interface, so it is unit-tested in Node against `@libsql/client`. Only the replica adapter, leader election and the service worker are browser-only.

**Tech Stack:** plan 1's stack plus `@tursodatabase/sync-wasm` 0.8.2, `jose`, `vite-plugin-pwa` (Workbox), `@testing-library/react` + `jsdom`, `@playwright/test`.

**Spec:** `docs/superpowers/specs/2026-10-11-field-inventory-design.md` (§2, §6, §9.1; milestone 4). **Spike evidence:** `spikes/turso-browser-sync/FINDINGS.md` on branch `spike/turso-browser-sync` (`git show spike/turso-browser-sync:spikes/turso-browser-sync/FINDINGS.md`).

**Out of scope:** supervisor/admin screens and Turso database provisioning through the Platform API (plan 3; warehouse DBs are created manually with the `turso` CLI for now), multi-device Playwright E2E (plan 4), camera scanning, native shells.

## Human gate (before Task 7 merges)

**Android check (spike item 5).** On the target Android device or emulator, run the spike page using the steps in FINDINGS §5 (`adb reverse tcp:5179 tcp:5179`, then wipe → open+pull → query → airplane-mode reload → query → two-tab leader election).
- **Pass:** Task 7 proceeds as written.
- **Fail:** Task 7 implements `ReplicaSource` with approach B's `pullChanges` endpoint instead. No other task changes.

The executor can do Tasks 1–6 before the gate result comes in.

## Global Constraints

- `@tursodatabase/sync-wasm` pinned **exactly** `0.8.2`, imported from `@tursodatabase/sync-wasm/vite`, and listed in `optimizeDeps.exclude`.
- Every response (dev and prod) sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
- Replicas: after **every** `connect()`, run `PRAGMA query_only = 1`. The outbox is a separate local-only DB, `connect({ path: 'outbox.db' })`.
- Only the sync leader opens OPFS databases. Web Lock name `fi-sync-leader`, BroadcastChannel name `fi-sync`. Followers send reads and mutations to the leader over the channel.
- One reset routine, `resetDevice()`, clears OPFS **and** every localStorage key (sync-wasm keeps its metadata there). No code deletes only one of the two.
- A failed `pull()` means "offline/stale" and is never fatal. The replica stays readable.
- `checkpoint()` runs on each replica every 20 successful pulls.
- Sync triggers: the `online` event, `visibilitychange` to visible, and every `30000` ms. Push batch size is at most `500`. Push retry backoff starts at `1000` ms, doubles, and caps at `60000` ms.
- Staleness warning when the last successful pull is older than `4` hours (constant `STALE_WARNING_MS = 4 * 3600_000`).
- Session:
  - httpOnly, `SameSite=Strict`, `Secure` (except on localhost) cookie `fi_session`
  - HS256 JWT signed with `jose`, using env `SESSION_SECRET` (at least 32 chars; the server refuses to start without it)
  - TTL `7` days, claims `{ sub: userId, deviceId, role }`
  - PINs hashed with `node:crypto` scrypt; stored as `scrypt$<saltB64>$<hashB64>`
- Replica tokens:
  - read-only, `7d` expiry, minted per database through the Turso Platform API with env `TURSO_ORG` and `TURSO_PLATFORM_TOKEN`
  - renewed when within `24` h of expiry
  - **never** shipped as `VITE_*` env vars
- Handheld routes live under `/h`, with `ssr: false`. Supervisor routes (plan 3) don't exist yet.
- Counts are **blind**: no handheld screen ever shows the expected quantity for a count.
- localStorage keys are prefixed with `fi:`.

## Review Focus

1. **Response lost after the server commits.** The device re-pushes and gets `duplicate`. The row stays pending until a pull shows it in the replica, and it's counted once throughout. Test in Task 8.
2. **Push accepted but pull fails.** The row stays in the outbox, and displayed stock counts it exactly once (it isn't in the replica yet). It's deleted only after a successful pull contains it. Test in Task 8.
3. **Double Enter or a scanner burst on confirm.** Exactly one outbox row is created. Test in Task 11.
4. **Storage quota error on outbox insert.** The mutation fails visibly, the optimistic quantity rolls back, and the blocking storage banner shows. Test in Tasks 5 and 9.
5. **App restarted offline.** It shows the same displayed stock, including pending rows. Test in Task 6 (Node) and Task 13 (Playwright, gated).

---

## File Structure

```
prisma/global/schema.prisma (+username, pinHash), prisma/global/migrations/0002_auth.sql
src/server/auth/{password.ts,session.ts,auth.fn.ts}
src/server/replicas/{token-minter.ts,replica-config.fn.ts}
src/server/http/security-headers.ts
scripts/seed-dev.ts
src/handheld/
  sql.ts                 Sql interface + libsql adapter (tests) + sync-wasm adapter (browser)
  outbox.ts              outbox schema + CRUD
  stock.ts               displayed stock, lookups, pick lists, my exceptions
  replicas.ts            ReplicaSource (sync-wasm), openReplicas, query_only
  leader.ts              Web Lock leader election + BroadcastChannel RPC
  reset.ts, capabilities.ts
  sync-loop.ts           runSyncOnce + scheduler
  session-store.ts       cached session in localStorage
  record.ts              buildMovementInput + useRecordMovement
  HandheldProvider.tsx   wires leader/replicas/outbox/sync + QueryClient defaults
  components/{StatusPill,ScanInput,BlockingBanner}.tsx
src/routes/h/{route.tsx,index.tsx,login.tsx,attention.tsx,$wh.stock.tsx,$wh.count.tsx,$wh.adjust.tsx,$wh.move.tsx,$wh.transfer-in.tsx,$wh.pick.tsx}
tests/handheld/*.test.ts(x), tests/server/{auth,replica-config,security-headers}.test.ts
e2e/handheld-offline.spec.ts, playwright.config.ts
```

---

### Task 1: Auth: users with PINs, login and session

**Files:**
- Modify: `prisma/global/schema.prisma`, `src/server/db/migrate.ts` (`SCHEMA_VERSIONS.global` → 2)
- Create: `prisma/global/migrations/0002_auth.sql`, `src/server/auth/password.ts`, `src/server/auth/session.ts`, `src/server/auth/auth.fn.ts`, `tests/server/auth.test.ts`
- Modify: `tests/support/test-env.ts` (add `seedUser({ id, username, pin, role })`)

**Interfaces:**
- Produces:
  - `type Role = 'worker' | 'supervisor' | 'admin'` (exported from `session.ts`)
  - `hashPin(pin: string): Promise<string>`, `verifyPin(pin: string, stored: string): Promise<boolean>`
  - `signSession(claims: { userId: string; deviceId: string; role: Role }, now?: Date): Promise<string>`
  - `verifySession(token: string, now?: Date): Promise<SessionClaims | null>`
  - `type SessionClaims = { userId; deviceId; role; exp: number }`
  - `loginCore(deps: { global: GlobalClient; now(): Date }, input: { username: string; pin: string; deviceId: string }): Promise<{ ok: true; token: string; user: { id; name; role }; expiresAt: string } | { ok: false; reason: 'BAD_CREDENTIALS' | 'DEVICE_UNKNOWN' | 'DEVICE_REVOKED' }>`
  - `requireSession(): Promise<SessionClaims>` reads cookie `fi_session` via `@tanstack/react-start/server`, or throws a `Response` 401
  - Server fns `login` (sets the cookie, returns `{ user, deviceId, expiresAt }` without the token) and `logout` (clears the cookie)
- Schema: `User` gains `username String @unique`, `pinHash String`. Generate `0002_auth.sql` with `prisma migrate diff --from-schema <previous schema via git show> --to-schema ... --script`. Existing rows have no username; the migration may require an empty table, which is fine.

- [ ] **Step 1: Write failing tests**
  - `verifyPin` round-trips; a wrong PIN → false.
  - `signSession` then `verifySession` returns the claims. Past the 7-day TTL → null. A token signed with a different secret → null.
  - `loginCore`:
    - good credentials on an enrolled device → ok, `expiresAt` = now + 7d
    - wrong PIN → `BAD_CREDENTIALS`
    - unknown username → `BAD_CREDENTIALS` (same reason, no user enumeration)
    - revoked device → `DEVICE_REVOKED`
  - `SCHEMA_VERSIONS` guard test still passes with 2 global migrations.
- [ ] **Step 2: Run** `pnpm test tests/server/auth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** If `SESSION_SECRET` is missing or shorter than 32 chars, `signSession`/`verifySession` throw `Error('SESSION_SECRET must be at least 32 characters')`.
- [ ] **Step 4: Run** `pnpm test && pnpm lint && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(auth): user PINs, sessions, login`

---

### Task 2: Authenticate `syncMovements` and bind rows to the device

**Files:**
- Modify: `src/server/sync/sync-movements.ts`, `src/server/sync/sync-movements.fn.ts`, `tests/server/sync-movements.test.ts`, `tests/server/sync-movements-fn.test.ts`

**Interfaces:**
- Consumes: `requireSession`, `verifySession` (Task 1)
- Produces:
  - `RowResult.invalid.reason` gains `'DEVICE_MISMATCH'` (row `deviceId` ≠ batch `deviceId`) and `'UNKNOWN_USER'` (row `userId` not in global `User`). Both checks run after Zod parsing and before the warehouse-assignment check.
  - `handleSync(deps, data, session: SessionClaims)` throws `Response` 403 when `batch.deviceId !== session.deviceId`.
  - The `syncMovements` server fn calls `requireSession()` first.
- Rows recorded offline by a previous user on the same device are accepted (their `userId` is that user's). The session only proves the device is enrolled and someone is signed in.

- [ ] **Step 1: Write failing tests**
  - A row whose `deviceId` differs from the batch → `invalid('DEVICE_MISMATCH')`, while other rows are accepted.
  - Unknown `userId` → `invalid('UNKNOWN_USER')`.
  - `handleSync` with a session for another device → throws a 403 Response.
  - Existing tests are updated to seed users.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test` (all, including scenarios). Expected: PASS.
- [ ] **Step 5: Commit**: `feat(sync): require session and bind rows to device`

---

### Task 3: Replica config endpoint, Turso token minter, security headers

**Files:**
- Create: `src/server/replicas/token-minter.ts`, `src/server/replicas/replica-config.fn.ts`, `src/server/http/security-headers.ts`, `tests/server/replica-config.test.ts`, `tests/server/security-headers.test.ts`
- Modify: `vite.config.ts` (`server.headers`, `preview.headers`, `optimizeDeps.exclude`), and the Start entry where global request middleware is registered (`src/start.ts`; create it if missing, per the installed `@tanstack/react-start` docs)

**Interfaces:**
- Produces:
  - `interface TokenMinter { mint(dbName: string): Promise<{ token: string; expiresAt: string }> }`
  - `tursoTokenMinter(env: { org: string; platformToken: string }, fetchFn = fetch): TokenMinter` does `POST https://api.turso.tech/v1/organizations/{org}/databases/{dbName}/auth/tokens?expiration=7d&authorization=read-only` with `Authorization: Bearer <platformToken>` and reads `jwt` from the JSON. `expiresAt` = now + 7d. A non-2xx response throws an `Error` including status and dbName.
  - `type ReplicaConfig = { replicas: { name: 'catalog' | string /* warehouseId */; dbName: string; url: string; token: string; expiresAt: string }[]; staleWarningMs: number }`
  - `replicaConfigCore(deps: { global; minter: TokenMinter; urlFor(dbName: string): string; catalogDbName: string }, session: SessionClaims): Promise<ReplicaConfig>` returns the catalog plus each warehouse assigned to `session.deviceId`.
  - Server fn `getReplicaConfig` (requires session). If `WAREHOUSE_DB_URL_TEMPLATE` doesn't start with `libsql://`, it throws `Response` 503 `{ error: 'Replicas require Turso databases' }`. `urlFor` substitutes the template. The catalog db name comes from env `CATALOG_TURSO_DB`.
  - `SECURITY_HEADERS = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }`, applied in Vite dev/preview and by Start global middleware in production.

- [ ] **Step 1: Write failing tests**
  - The minter calls the exact URL and method with the bearer header, using a fake `fetchFn`, and returns `jwt`. A 403 throws.
  - `replicaConfigCore` returns the catalog plus exactly the assigned warehouses, each with a minted token and a `libsql://` URL.
  - Security headers: a Start middleware unit test, or a `vite preview` fetch in the test, shows both headers on `/` and `/h`.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(replicas): replica config, token minter, COOP/COEP headers`

---

### Task 4: Dev seed script

**Files:**
- Create: `scripts/seed-dev.ts`
- Modify: `package.json` (`"db:seed": "tsx scripts/seed-dev.ts"`), `.env.example` (`SESSION_SECRET`, `TURSO_ORG`, `TURSO_PLATFORM_TOKEN`, `CATALOG_TURSO_DB`, `WAREHOUSE_DB_URL_TEMPLATE=libsql://{name}-<org>.turso.io`, `TURSO_GROUP_AUTH_TOKEN`)

**Interfaces:**
- Produces a seeded dev environment that is idempotent (upserts):
  - warehouses `wh-1` (tursoDbName `fi-wh-1`) and `wh-2` (`fi-wh-2`)
  - device `dev-handheld-1` assigned to both
  - users `ana` (worker), `bruno` (worker), `sup` (supervisor), each with PIN `1234`. These test PINs live in this file only and are not printed.
  - 6 products with barcodes (one with `countTolerance: 2`) and 2 categories
  - locations `A-01..A-06` per warehouse
  - one `INITIAL` ADJUST per product/location via `syncMovementsCore`, using a seed device `seed`
  - one pick list assigned to `ana` in `wh-1` with 3 lines
  - one count task for zone A in `wh-1`
  - reason codes `DAMAGED`, `FOUND`, `LOST`, `COUNT_AUTO`, `INITIAL`
- The script runs migrations first (`applyMigrations` for global/catalog plus each warehouse) and prints only names and counts.

- [ ] **Step 1: Write the script.** Seeding goes through `syncMovementsCore` so balances come from the ledger.
- [ ] **Step 2: Verify locally** against temp `file:` DBs: `GLOBAL_DB_URL=file:/tmp/fi/g.db CATALOG_DB_URL=file:/tmp/fi/c.db WAREHOUSE_DB_URL_TEMPLATE=file:/tmp/fi/{name}.db pnpm db:seed` twice. Expected: both runs exit 0, and the second creates no duplicate movements (it checks for existing `INITIAL` movements first).
- [ ] **Step 3: Commit**: `chore: dev seed script`

---

### Task 5: `Sql` interface and outbox

**Files:**
- Create: `src/handheld/sql.ts`, `src/handheld/outbox.ts`, `tests/handheld/outbox.test.ts`, `tests/support/handheld-sql.ts`

**Interfaces:**
- Produces:
  - `interface Sql { all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>; run(sql: string, params?: unknown[]): Promise<void> }`
  - `libsqlSql(client: libsql.Client): Sql` (used by Node tests)
  - `memorySql(): Promise<Sql>` and `replicaSql(kind: 'warehouse' | 'catalog'): Promise<Sql>` in `tests/support/handheld-sql.ts`. The latter is an in-memory libsql with that DB's migrations applied, to act as a replica.
  - `type OutboxStatus = 'pending' | 'needs_attention'`
  - `type OutboxRow = { id: string; warehouseId: string; input: MovementInput; status: OutboxStatus; lastError: string | null; createdAt: string }`
  - `class StorageFullError extends Error`
  - Outbox functions:
    - `ensureOutboxSchema(sql)`
    - `addToOutbox(sql, input: MovementInput, now: Date): Promise<void>`. Validates with `movementInputSchema` and throws a `ZodError` if invalid. Maps DOMException `QuotaExceededError` (or a message containing `quota`/`SQLITE_FULL`) to `StorageFullError`. An existing `id` is a no-op.
    - `listOutbox(sql, filter?: { warehouseId?: string; status?: OutboxStatus }): Promise<OutboxRow[]>`, ordered by `createdAt`, `id`
    - `markNeedsAttention(sql, results: { id: string; reason: string }[])`
    - `deleteOutbox(sql, ids: string[])`
    - `discardOutbox(sql, id)`
    - `exportOutbox(sql): Promise<string>` (JSON array of all rows)
- Table `outbox(id TEXT PRIMARY KEY, warehouseId TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL, lastError TEXT, createdAt TEXT NOT NULL)`.

- [ ] **Step 1: Write failing tests**
  - add + list round-trips the `MovementInput` (dates come back as Date)
  - a second add with the same id is a no-op
  - an invalid input throws a ZodError and inserts nothing
  - a `run` stub throwing a `QuotaExceededError` → `StorageFullError` (Review Focus 4)
  - `markNeedsAttention` sets status and `lastError`
  - delete and export work
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** and expect PASS.
- [ ] **Step 5: Commit**: `feat(handheld): Sql interface and outbox`

---

### Task 6: Displayed stock and lookups

**Files:**
- Create: `src/handheld/stock.ts`, `tests/handheld/stock.test.ts`

**Interfaces:**
- Consumes: `Sql`, `listOutbox`, `toMovement`, `movementDeltas`, `balanceKeyString`
- Produces:
  - `parseDbDate(v: unknown): Date`. Check how Prisma/libsql actually store `DATETIME` in the replica (ISO text or epoch ms) and handle that format. Test both shapes it can produce.
  - `displayedStock(replica: Sql, outbox: Sql, warehouseId: string, filter?: { skuId?: string; locationId?: string }): Promise<{ skuId: string; locationId: string; qty: number; pendingDelta: number }[]>`. Here `qty` = replica balance + pending delta. It covers every key that has a balance or a pending delta. Pending = outbox rows with status `pending` **or** `needs_attention` for this warehouse, so a pending row is never silently dropped from view.
  - `findProduct(catalog: Sql, scan: string): Promise<{ id: string; sku: string; name: string } | null>` matches `sku` or any value in the `barcodes` JSON array.
  - `findLocation(replica: Sql, scan: string): Promise<{ id: string; code: string; active: boolean } | null>` matches `code` or `id`.
  - `assignedPickLists(replica: Sql, userId: string)` returns lists with lines and `pickedQty` (sum of replica PICK movements with `ref = line.id`, plus pending outbox PICKs).
  - `assignedCountTasks(replica, userId)`
  - `myOpenExceptions(replica: Sql, deviceId: string)`
  - `inTransitTo(replicas: Map<string, Sql>, warehouseId: string)` returns the TRANSFER_OUT movements in any replica whose `counterpartWarehouseId === warehouseId` and whose `ref` has no TRANSFER_IN in this warehouse's replica or outbox.

- [ ] **Step 1: Write failing tests** using `replicaSql('warehouse')` seeded with INSERTs and `memorySql()` for the outbox
  - Balance 10 plus pending PICK 3 → qty 7, pendingDelta −3.
  - A MOVE shows on both keys.
  - A key with only a pending ADJUST appears.
  - **Restart:** open new `Sql` handles over the same file-based libsql DBs and get identical results (Review Focus 5, Node half).
  - `findProduct` by barcode. `findLocation` by code.
  - `pickedQty` includes pending.
  - `inTransitTo` excludes a transfer whose IN is pending in the outbox.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** and expect PASS.
- [ ] **Step 5: Commit**: `feat(handheld): displayed stock and lookups`

---

### Task 7: Replica source, leader election, reset, capabilities (browser)

**Gate:** follows the Android check result (see top). If it fails, implement `openReplicas` with approach B and stop to re-plan this task with the controller.

**Files:**
- Create: `src/handheld/replicas.ts`, `src/handheld/leader.ts`, `src/handheld/reset.ts`, `src/handheld/capabilities.ts`, `tests/handheld/leader.test.ts`, `tests/handheld/capabilities.test.ts`
- Modify: `package.json` (`@tursodatabase/sync-wasm` exactly `0.8.2`)

**Interfaces:**
- Produces:
  - `interface Replica extends Sql { name: string; pull(): Promise<boolean>; checkpoint(): Promise<void>; close(): Promise<void> }`
  - `openReplica(cfg: ReplicaConfig['replicas'][number], getToken: () => Promise<string>): Promise<Replica>` calls `connect({ path: \`${cfg.dbName}.db\`, url: cfg.url, authToken: getToken, clientName: 'fi-handheld' })`, then immediately `PRAGMA query_only = 1`.
  - `openOutboxDb(): Promise<Sql>` calls `connect({ path: 'outbox.db' })` and then `ensureOutboxSchema`.
  - `electLeader(opts: { locks: LockManager; channel: BroadcastChannel; onLeader(): Promise<LeaderApi> }): Promise<HandheldBackend>`
    - `HandheldBackend = { role: 'leader' | 'follower'; call<K extends keyof LeaderApi>(method: K, ...args): Promise<ReturnType<LeaderApi[K]>> }`
    - The leader serves requests from the channel. A follower forwards with request ids and a `10000` ms timeout, rejecting with `Error('LEADER_TIMEOUT')`. When the leader's tab closes, a queued follower acquires the lock and becomes leader.
  - `type LeaderApi` holds the methods the UI needs: `displayedStock`, `findProduct`, `findLocation`, `assignedPickLists`, `assignedCountTasks`, `myOpenExceptions`, `inTransitTo`, `record(input)`, `listOutbox`, `discardOutbox`, `exportOutbox`, `syncNow`, `syncState`.
  - `resetDevice(): Promise<void>` closes open DBs, removes every OPFS entry (`navigator.storage.getDirectory()` → `removeEntry(name, { recursive: true })`), and calls `localStorage.clear()`.
  - `checkCapabilities(env = globalThis): { ok: boolean; missing: ('crossOriginIsolated' | 'SharedArrayBuffer' | 'OPFS' | 'WebLocks' | 'BroadcastChannel')[] }`

- [ ] **Step 1: Write failing tests** (Node, with fakes)
  - `electLeader` with a fake `LockManager` (a queue) and a fake channel pair: tab 1 becomes leader, tab 2 a follower; a follower `call('findProduct', 'X')` returns the leader's answer; releasing tab 1's lock promotes tab 2; a silent leader → `LEADER_TIMEOUT`.
  - `checkCapabilities` on a stub env lists exactly the missing features.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement**, including `openReplica`/`openOutboxDb`/`resetDevice` (browser-only; they're exercised by Task 13's E2E). Add `optimizeDeps.exclude: ['@tursodatabase/sync-wasm']` if Task 3 didn't.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm build`. Expected: PASS, and the build emits the sync-wasm worker and `.wasm` assets.
- [ ] **Step 5: Commit**: `feat(handheld): replicas, leader election, reset, capabilities`

---

### Task 8: Sync loop

**Files:**
- Create: `src/handheld/sync-loop.ts`, `tests/handheld/sync-loop.test.ts`

**Interfaces:**
- Consumes: outbox functions (Task 5), `Replica` (Task 7, faked in tests), `SyncResponse` / `RowResult` types (plan 1)
- Produces:
  - `type SyncState = { phase: 'idle' | 'syncing' | 'offline' | 'needs_sign_in' | 'update_required' | 'device_revoked' | 'device_unknown'; pendingCount: number; attentionCount: number; lastPullAt: string | null; lastError: string | null; nextRetryAt: string | null }`
  - `interface SyncDeps { outbox: Sql; replicas: Map<string, Replica>; push(batch: { deviceId: string; schemaVersion: number; sentAt: string; movements: MovementInput[] }): Promise<SyncResponse>; deviceId: string; schemaVersion: number; now(): Date; hasValidSession(): boolean }`
  - `runSyncOnce(deps, prev: SyncState): Promise<SyncState>`:
    1. If `!hasValidSession()` → skip push, still pull, phase `needs_sign_in`.
    2. Push pending rows in batches of 500. A `fetch` failure or 5xx → phase `offline`, backoff (1000 doubling, capped at 60000), and **no outbox deletion**. A 401 → `needs_sign_in`. `UPDATE_REQUIRED` / `DEVICE_REVOKED` / `DEVICE_UNKNOWN` → that phase, stop, outbox untouched. On `ok`, `invalid` rows → `markNeedsAttention`, and `accepted`/`duplicate` rows stay pending.
    3. Pull every replica (each failure is independent and leaves that replica stale). Every 20 successful pulls of a replica → `checkpoint()`.
    4. Reconcile: for each warehouse replica, delete pending outbox rows whose `id` is in that replica's `Movement` table.
    5. Return the state with counts. `lastPullAt` is updated only if every replica pulled.
  - `startSyncScheduler(run: () => Promise<void>, env = window): () => void` triggers on `online`, on `visibilitychange` to visible, and every 30000 ms. It never runs concurrently (a single-flight guard) and honours `nextRetryAt`.

- [ ] **Step 1: Write failing tests** with a fake push/replica built on `replicaSql`; the fake replica's `pull()` copies rows from a fake "server" DB
  - Happy path: push accepted → pull → row deleted, displayed stock unchanged across the transition.
  - **Response lost:** the push throws after the fake server stored the row. On the next run, push → `duplicate` → pull → deleted, and it's never double counted (Review Focus 1).
  - **Pull fails after accepted push:** the row stays pending and counts once. Next successful pull → deleted (Review Focus 2).
  - Invalid → needs_attention with its reason.
  - `DEVICE_REVOKED` → phase set, outbox intact.
  - No session → no push, but pull still runs.
  - Backoff sequence 1000, 2000, 4000, … capped at 60000.
  - The scheduler single-flight guard stops overlapping runs.
  - `checkpoint` is called on the 20th pull.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** and expect PASS.
- [ ] **Step 5: Commit**: `feat(handheld): sync loop and scheduler`

---

### Task 9: Session store, recording hook, HandheldProvider

**Files:**
- Create: `src/handheld/session-store.ts`, `src/handheld/record.ts`, `src/handheld/HandheldProvider.tsx`, `src/handheld/components/BlockingBanner.tsx`, `tests/handheld/record.test.tsx`, `tests/handheld/session-store.test.ts`
- Modify: `package.json` (dev: `@testing-library/react`, `jsdom`)

**Interfaces:**
- Produces:
  - Session store:
    - `type CachedSession = { userId: string; name: string; role: Role; deviceId: string; expiresAt: string }` stored at `fi:session`
    - `getCachedSession()`, `setCachedSession(s)`, `clearCachedSession()`
    - `hasValidSession(now = new Date())` checks `expiresAt` against now
    - Device id at `fi:deviceId`: `getDeviceId()` / `setDeviceId(id)`
  - `buildMovementInput(kind: MovementInput['type'], fields: Record<string, unknown>, ctx: { warehouseId; userId; deviceId; now: Date; newId(): string }): MovementInput` creates the id and `occurredAt` here, exactly once per confirm.
  - `useRecordMovement(warehouseId: string)` is a TanStack Query `useMutation`:
    - `mutationFn` calls `backend.call('record', input)` (the outbox insert)
    - `onMutate` cancels and patches `['h', wh, 'stock']`, returning a snapshot
    - `onError` restores the snapshot, and on `StorageFullError` also sets the blocking banner to `'storage'`
    - `onSettled` invalidates `['h', wh]`
    - It exposes `isPending`, which screens use to disable confirm.
  - `<HandheldProvider>`:
    - checks capabilities (if not ok, shows `BlockingBanner kind="capabilities"` listing what's missing)
    - elects the leader; as leader, fetches `getReplicaConfig` when online and a session exists (caching the config at `fi:replicaConfig` for offline startup), opens the replicas and outbox, and starts the scheduler
    - exposes `useHandheld(): { backend; syncState; session; banner }`
    - QueryClient defaults for `['h', ...]` queries: `networkMode: 'always'`, `staleTime: 0`
    - after each sync, invalidates `['h']`
  - Token renewal: `getToken` for each replica returns the cached token and refreshes the config when it's within 24h of `expiresAt` and online.

- [ ] **Step 1: Write failing tests**
  - `buildMovementInput` produces a schema-valid input per kind, generating id and occurredAt once.
  - Session store: expiry check; the device id persists.
  - jsdom: `useRecordMovement` with a fake backend whose `record` throws `StorageFullError` → the optimistic stock rolls back and the banner state is `'storage'` (Review Focus 4).
  - A successful record invalidates `['h', wh]`.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(handheld): session store, record hook, provider`

---

### Task 10: Handheld shell: login, warehouse picker, status, attention

**Files:**
- Create: `src/routes/h/route.tsx` (`ssr: false`, wraps `HandheldProvider`), `src/routes/h/index.tsx`, `src/routes/h/$wh.stock.tsx`, `src/routes/h/login.tsx`, `src/routes/h/attention.tsx`, `src/handheld/components/StatusPill.tsx`, `src/handheld/components/ScanInput.tsx`, `tests/handheld/shell.test.tsx`

**Interfaces:**
- Consumes: `useHandheld`, `login`/`logout` server fns, `getDeviceId`/`setDeviceId`
- Produces:
  - `/h/login`: device id field (shown only if none is stored), username, PIN (`PinInput`, 4 digits). On success, stores the cached session and goes to `/h`. Offline → the message "Sign-in needs a connection".
  - `/h`: list of assigned warehouses (from the cached replica config), action buttons per warehouse (Stock, Count, Move, Transfer in, Pick, Adjust), and the user's open exceptions (`myOpenExceptions`).
  - `/h/$wh/stock`: searchable list from `displayedStock` (filter by scanned product or location). Rows with `pendingDelta !== 0` show a **Pending** badge.
  - `/h/attention`: needs-attention rows with their reason, each with **Discard** (confirm modal). If `syncState.phase === 'device_revoked'`, an **Export outbox** button downloads `outbox-<deviceId>-<date>.json`.
  - `StatusPill` shows Online/Offline, `N pending`, `N need attention` (links to `/h/attention`), last-sync relative time, a "stale" badge when `now - lastPullAt > STALE_WARNING_MS`, and a "Sign in to sync" badge for `needs_sign_in`.
  - `ScanInput` is an autofocused Mantine `TextInput`. It calls `onScan(value.trim())` on Enter, clears itself, and refocuses. It ignores empty values.
  - `/h` redirects to `/h/login` when there's no cached session. An expired cached session still allows recording (the badge shows).

- [ ] **Step 1: Write failing tests** (jsdom, fake `useHandheld`)
  - `ScanInput` calls `onScan` once per Enter with the trimmed value and refocuses.
  - `StatusPill` shows "stale" at 4h+1ms and not at 4h−1ms.
  - The attention page discard flow calls `discardOutbox`.
  - The stock page shows a Pending badge only on rows with `pendingDelta !== 0`.
  - The Export button appears only when `device_revoked`.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(handheld): shell, login, status, attention`

---

### Task 11: Action screens: count, adjust, move/transfer, transfer-in, pick

**Files:**
- Create: `src/routes/h/$wh.count.tsx`, `$wh.adjust.tsx`, `$wh.move.tsx`, `$wh.transfer-in.tsx`, `$wh.pick.tsx`, `tests/handheld/screens.test.tsx`

**Interfaces:**
- Consumes: `ScanInput`, `useRecordMovement`, `buildMovementInput`, backend lookups
- Produces the flows (each confirm records exactly one movement, and confirm is disabled while `isPending` or once submitted, until the form resets):
  - **Count:** optional count-task picker (`assignedCountTasks`) → scan location → scan product → enter counted qty (`NumberInput`, min 0) → confirm records COUNT `{ locationId, qty, ref?: taskId }`. **It never displays the expected qty or the balance for that bin.**
  - **Adjust:** scan location → scan product (shows the current displayed qty) → signed qty (≠ 0) → reason (`Select` from catalog `ReasonCode` where `appliesTo` includes ADJUST) → ADJUST.
  - **Move:** scan from → scan product (shows the displayed qty at from) → qty > 0 → destination: either a location in this warehouse (MOVE; rejects `from === to` inline) or another assigned warehouse (TRANSFER_OUT with `transferId = newId()` and `counterpartWarehouseId`).
  - **Transfer in:** list `inTransitTo(wh)` → choose → scan destination location → TRANSFER_IN `{ toLocationId, qty: out.qty, transferId: out.ref, counterpartWarehouseId: source }`.
  - **Pick:** choose an assigned pick list → for each line, scan the location (must match `line.locationId`, else an inline error) → scan the product (must match) → qty (default the remaining qty; over-pick allowed with a warning) → PICK `{ fromLocationId, qty, ref: line.id }`.
  - Unknown scans show an inline "Not found: <scan>" error and record nothing. An inactive location shows "Location inactive".

- [ ] **Step 1: Write failing tests** (jsdom, fake backend)
  - **Count:** after scanning location and product, the screen text contains no balance number, and confirm records one COUNT with the entered qty.
  - **Double confirm:** firing Enter twice (or clicking twice) quickly → `record` is called once (Review Focus 3).
  - Move to the same location is rejected inline. Move to another warehouse records TRANSFER_OUT with `counterpartWarehouseId`.
  - Transfer-in uses the OUT's `ref` and qty.
  - A pick location mismatch shows an error and records nothing.
  - Adjust requires a reason.
  - An unknown barcode shows "Not found".
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test && pnpm lint && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(handheld): count, adjust, move/transfer, transfer-in, pick screens`

---

### Task 12: Offline app shell (service worker)

**Files:**
- Modify: `vite.config.ts` (add `vite-plugin-pwa`), `src/routes/h/route.tsx` (register the SW)
- Create: `public/manifest.webmanifest` (or plugin-generated), `tests/handheld/pwa-config.test.ts`

**Interfaces:**
- Produces:
  - A service worker scoped to `/h/` that precaches the client build assets, **including the sync-wasm `.wasm` and worker**, with `maximumFileSizeToCacheInBytes` ≥ `16 * 1024 * 1024`.
  - Navigation requests under `/h/` fall back to a cached `/h` shell document, so a reload works offline (the handheld routes are `ssr: false`, so the shell can render client-side).
  - Server function calls and `*.turso.io` are never cached (`NetworkOnly`).
  - Manifest: `name: 'Field Inventory'`, `short_name: 'Inventory'`, `start_url: '/h'`, `display: 'standalone'`.
  - The SW's own responses must keep the COOP/COEP headers. If Workbox strips them from cached navigations, add a plugin that re-applies `SECURITY_HEADERS`.

- [ ] **Step 1: Write the failing test.** `pwa-config.test.ts` imports the exported PWA options object and checks: scope `/h/`, the `.wasm` glob is included, the size limit is ≥ 16 MiB, the navigation fallback is `/h`, and server-fn and turso URLs are NetworkOnly.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test && pnpm build`. Expected: PASS, and `dist` contains the SW with the `.wasm` in its precache manifest.
- [ ] **Step 5: Commit**: `feat(handheld): offline app shell service worker`

---

### Task 13: Handheld offline E2E (gated on real Turso)

**Files:**
- Create: `playwright.config.ts`, `e2e/handheld-offline.spec.ts`
- Modify: `package.json` (`"e2e": "playwright test"`, dev `@playwright/test`)

**Interfaces:**
- Consumes: the whole handheld app, `pnpm db:seed` (against Turso dev DBs)
- The test is skipped unless `E2E_TURSO=1` (and the Task 4 env vars point at Turso dev DBs). Playwright `webServer` runs `pnpm build && pnpm preview`; the project is Chromium.
- Flow:
  1. Sign in as `ana` on `dev-handheld-1`.
  2. Open `wh-1` → Count, scan `A-01` + the first product, enter 7, confirm → StatusPill shows `1 pending`.
  3. `context.setOffline(true)`, reload `/h/wh-1/count` → the app loads from the SW, `1 pending` is still shown, and `/h/wh-1/stock` shows the same displayed stock for that product as before the reload (Review Focus 5).
  4. Record an ADJUST offline → `2 pending`.
  5. `context.setOffline(false)` and trigger sync (wait for `online`, or click "Sync now") → `0 pending` within 15 s, and displayed stock is unchanged across the transition.

- [ ] **Step 1: Write the spec** with the skip guard.
- [ ] **Step 2: Run** `pnpm e2e`. Expected: skipped without `E2E_TURSO`. With `E2E_TURSO=1` and Turso dev DBs seeded: PASS. If no Turso credentials are available in the executing environment, report the test as written-but-unrun (DONE_WITH_CONCERNS). Never fabricate a pass.
- [ ] **Step 3: Commit**: `test(e2e): handheld offline flow`
