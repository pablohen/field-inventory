# Field Inventory: Plan 3, Supervisor Desk

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The online-only supervisor desk:
- desktop sign-in for supervisors and admins
- the exceptions queue, with resolution
- stock balances with ledger drill-down
- pick-list and count-task management

**Architecture:**
- Desk pages are ordinary SSR TanStack Start routes under `/w/$warehouseId/...` that call role-checked server functions.
- Server functions read and write the warehouse databases directly through Prisma. There are no local copies (replicas) and no outbox on the desk.
- A supervisor's correcting adjustment goes through the same `processMovement` → `persistEffects` pipeline as handheld movements, so balances and exceptions stay consistent.
- Each server-side core is a plain function tested in Node with `createTestEnv`. Each `.fn.ts` file holds only the `createServerFn` wrapper (the split pattern from plan 2).

**Tech Stack:** plan 1/2's stack (TanStack Start + Router + Query, Mantine, Prisma 7 + libSQL, Zod 4, Vitest, Biome). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-field-inventory-design.md` §8 (`/w/...` part), §5.5 (`TRANSFER_STUCK` is checked when the exceptions list loads), §9.1.

**Out of scope:**
- **Plan 4 (admin):** creating warehouses through the Turso Platform API; master data (locations, products, categories, tolerances, reason codes); users and roles; device enrollment and assignment.
- **Plan 5:** multi-device Playwright E2E.
- Reporting dashboards, bulk exception actions, and live push updates (spec non-goals).

## Global Constraints

- Desk routes are online-only, server-rendered, and live under `/w/$warehouseId/` plus `/desk/login`. Lists poll with Query `refetchInterval: 10000`.
- List filters live in route search params validated by Zod (shareable URLs).
- Only roles `supervisor` and `admin` can use desk server functions. Every desk server function calls `requireDeskSession()` first. Anyone else gets 403, and no session gets 401.
- Desk sessions reuse the `fi_session` cookie and `SessionClaims`, with `deviceId: 'desk'` (constant `DESK_DEVICE_ID = 'desk'`). The sync endpoint and replica config already reject `desk` as an unknown device, so a desk session can't push or mint tokens.
- Movements written by a supervisor have `source: 'supervisor'`, `deviceId: 'desk'`, `userId` = the supervisor, and `occurredAt` = server now. They go through `withMovementTx` + `loadContext` + `processMovement` + `persistEffects`.
- Expected failures return typed results, not thrown Responses, because a thrown JSON Response from a server function resolves as a plain value on the client in `@tanstack/react-start` 1.168.x (plan 2 finding). The shape is `{ ok: false; code: 'CONFLICT' | 'NOT_FOUND' | 'INVALID'; message: string }`. Auth failures (401/403) are still thrown.
- Exception resolution is guarded by `version`. A stale version returns `{ ok: false, code: 'CONFLICT', message: 'Resolved by someone else' }`. This is the spec's "409", delivered as a typed result per the rule above.
- Resolution values: `ACCEPTED | ADJUSTED | RECOUNT_REQUESTED | DISMISSED`. Every resolution sets `status: 'RESOLVED'`, `resolvedBy`, `resolvedAt`, and `version + 1`.
- Pick list and count task statuses: `OPEN | DONE`. The handheld treats anything except `DONE`/`CLOSED` as active.
- Per-username lockout across devices (deferred from plan 2): `MAX_FAILURES_ACROSS_DEVICES = 10` failed sign-ins on any devices within a lock window locks that username everywhere for `LOCKOUT_MS` (15 min). It's tracked in `LoginAttempt` under `deviceId = '*'`. The per-device rule (5 failures) stays.
- Biome is the only linter. Run `pnpm format && pnpm lint && pnpm typecheck && pnpm test` before every commit. Run `pnpm build` too for tasks that touch routes.

## Review Focus

1. **Two supervisors resolve the same exception at once.** Exactly one succeeds and the other gets `CONFLICT`. A correcting adjustment is written at most once. Test in Task 5.
2. **A correcting adjustment races a handheld push on the same bin.** The balance equals the ledger sum afterwards, with no lost update. Test in Task 5, run concurrently with `syncMovementsCore`.
3. **A worker-role session calls any desk server function.** It gets 403. A handheld device session (non-`desk`) for a supervisor is allowed, since role is what counts. Test in Task 1, then reused once per server-function file in Tasks 3–8.
4. **An exception whose `movementIds` is empty (`CLOCK_SKEW`) or references missing movements.** The detail view loads with an empty or partial timeline and no crash. Test in Task 4.
5. **A pick list asks for more than is on hand, or a SKU with no stock.** The suggestion fills what it can, returns a shortfall per SKU, and never suggests a negative or zero-qty line. A SKU with no stock produces a line with `locationId: null` that the supervisor must pick a bin for, and creation is rejected until they do. Test in Task 7.

---

## File Structure

```
prisma/global/ (no schema change; LoginAttempt is reused)
src/server/desk/
  session.ts               DESK_DEVICE_ID, requireDeskSession, DeskSession
  desk-login.ts            deskLoginCore (+ cross-device lockout shared with loginCore)
  desk-auth.fn.ts          deskLogin, deskLogout, getDeskSession
  warehouses.server.ts     listWarehouses, warehouseClientFor
  exceptions.server.ts     listExceptionsCore, exceptionDetailCore, resolveExceptionCore
  exceptions.fn.ts
  stock.server.ts          stockCore, ledgerCore
  stock.fn.ts
  pick-lists.server.ts     suggestBins, createPickListCore, listPickListsCore, assignPickListCore, closePickListCore
  pick-lists.fn.ts
  count-tasks.server.ts    createCountTaskCore, listCountTasksCore, assignCountTaskCore, closeCountTaskCore, listWorkersCore
  count-tasks.fn.ts
src/server/sync/stuck-transfers.ts   checkStuckTransfers (extracted from sync-movements.ts)
src/routes/desk/login.tsx
src/routes/w/$warehouseId/route.tsx              layout + guard + nav + warehouse switcher
src/routes/w/$warehouseId/exceptions.index.tsx
src/routes/w/$warehouseId/exceptions.$id.tsx
src/routes/w/$warehouseId/stock.index.tsx
src/routes/w/$warehouseId/stock.ledger.tsx       ?sku=&location=
src/routes/w/$warehouseId/pick-lists.tsx
src/routes/w/$warehouseId/counts.tsx
src/routes/index.tsx                              redirect: desk session → /w/<first>/exceptions, else /desk/login
src/desk/components/*.tsx
tests/server/desk-*.test.ts, tests/desk/*.test.tsx
```

---

### Task 1: Desk sign-in, role guard, cross-device lockout

**Files:**
- Create: `src/server/desk/session.ts`, `src/server/desk/desk-login.ts`, `src/server/desk/desk-auth.fn.ts`, `tests/server/desk-auth.test.ts`
- Modify: `src/server/auth/login-core.ts` (cross-device cap), `tests/server/auth.test.ts`

**Interfaces:**
- Consumes: `signSession`, `verifySession`, `SessionClaims`, `Role`, `SESSION_COOKIE`, `SESSION_TTL_SECONDS` (`src/server/auth/session.ts`); `verifyPin`/`hashPin`; the `LoginAttempt` model; `MAX_FAILURES`, `LOCKOUT_MS` (`login-core.ts`)
- Produces:
  - `DESK_DEVICE_ID = 'desk'`
  - `type DeskSession = SessionClaims & { role: 'supervisor' | 'admin' }`
  - `authorizeDesk(claims: SessionClaims | null): DeskSession` throws `Response` 401 when null and 403 when the role is `worker`. It's pure and exported for tests.
  - `requireDeskSession(): Promise<DeskSession>` reads the cookie via `verifySession`, then calls `authorizeDesk`.
  - `deskLoginCore(deps: { global; now(): Date }, input: { username: string; pin: string }): Promise<{ ok: true; token: string; user: { id; name; role }; expiresAt: string } | { ok: false; reason: 'BAD_CREDENTIALS' | 'NOT_ALLOWED' | 'LOCKED' }>`
    - It uses the same atomic reserve-then-verify lockout as `loginCore`, keyed by (`'desk'`, username).
    - A worker with a correct PIN gets `NOT_ALLOWED`. The PIN is still verified first, so the response doesn't reveal the role to someone who doesn't know the PIN.
    - The token is signed with `deviceId: DESK_DEVICE_ID`.
  - Cross-device cap: export `reserveUsernameAttempt` and `clearUsernameAttempts`. Both `loginCore` and `deskLoginCore` reserve a (`'*'`, username) attempt before verifying the PIN, and return `LOCKED` without a real verify (dummy scrypt) when that row is locked or its count exceeds `MAX_FAILURES_ACROSS_DEVICES = 10`. Reaching 10 sets `lockedUntil = now + LOCKOUT_MS`. Success deletes the per-device row and the `'*'` row.
  - Server fns:
    - `deskLogin` sets the cookie with the same attributes as `login`.
    - `deskLogout` clears it.
    - `getDeskSession` returns `{ userId, name, role } | null` and never throws. Route guards use it.

- [ ] **Step 1: Write failing tests**
  - `authorizeDesk(null)` throws a Response with status 401. A worker's claims → 403. Supervisor and admin claims pass, including a supervisor's claims from a handheld device (`deviceId: 'dev-1'`), since role is what counts.
  - `deskLoginCore`:
    - supervisor with a correct PIN → ok, and the token's `verifySession().deviceId === 'desk'`
    - worker with a correct PIN → `NOT_ALLOWED`
    - wrong PIN → `BAD_CREDENTIALS`
    - 5 wrong PINs → `LOCKED`
  - Cross-device cap:
    - 10 wrong PINs for `ana`, spread over devices `d1`–`d4` (none reaching 5 on any one device) → the next attempt on a fresh device `d5`, with the correct PIN, returns `LOCKED`
    - after `LOCKOUT_MS` (injected `now`) → ok
    - a success clears the `'*'` counter
  - The existing plan 2 lockout tests (including the 10-concurrent test) still pass.
- [ ] **Step 2: Run** `pnpm test tests/server/desk-auth.test.ts tests/server/auth.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Extract the shared reserve/lock/clear SQL in `login-core.ts` into exported helpers parameterized by `deviceKey`, rather than copying it.
- [ ] **Step 4: Run** the full gate. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(desk): supervisor sign-in, role guard, cross-device lockout`

---

### Task 2: Warehouse access helper and stuck-transfer extraction

**Files:**
- Create: `src/server/desk/warehouses.server.ts`, `src/server/sync/stuck-transfers.ts`, `tests/server/desk-warehouses.test.ts`, `tests/server/stuck-transfers.test.ts`
- Modify: `src/server/sync/sync-movements.ts` (call the extracted function, with no behavior change)

**Interfaces:**
- Consumes: `globalDb`, `warehouseDb(dbName)`, `SCHEMA_VERSIONS`, `findStuckTransfers`, `persistExceptions`
- Produces:
  - `type DeskError = { ok: false; code: 'CONFLICT' | 'NOT_FOUND' | 'INVALID' | 'NOT_READY'; message: string }`, exported from `warehouses.server.ts` and used by every desk core.
  - `listWarehouses(global: GlobalClient): Promise<{ id: string; name: string }[]>` returns warehouses ordered by `name`.
  - `warehouseClientFor(deps: { global; warehouseDb(name: string): WarehouseClient }, warehouseId: string): Promise<{ ok: true; db: WarehouseClient } | DeskError>` (codes `NOT_FOUND` or `NOT_READY`). It returns `NOT_READY` when `schemaVersion !== SCHEMA_VERSIONS.warehouse`.
  - `checkStuckTransfers(deps: { global; warehouseDb; now(): Date; transferStuckHours: number }, warehouseId: string): Promise<ExceptionDraft[]>` returns and persists any new `TRANSFER_STUCK` drafts. The logic moves verbatim from `syncMovementsCore`'s post-processing; `syncMovementsCore` now calls it.

- [ ] **Step 1: Write failing tests**
  - `warehouseClientFor` with an unknown id → `NOT_FOUND`. A schema version mismatch → `NOT_READY`. Otherwise ok.
  - `checkStuckTransfers`: a TRANSFER_OUT 25 h old with no IN → one draft persisted. A second call → none (already flagged). A matching IN in the counterpart warehouse → none.
  - All existing `tests/server/sync-movements.test.ts` and scenario tests still pass unchanged.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** the full gate and expect PASS.
- [ ] **Step 5: Commit**: `refactor(sync): extract checkStuckTransfers; feat(desk): warehouse access helper`

---

### Task 3: Exceptions list

**Files:**
- Create: `src/server/desk/exceptions.server.ts` (list part), `src/server/desk/exceptions.fn.ts`, `tests/server/desk-exceptions-list.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2
- Produces:
  - `exceptionFiltersSchema = z.object({ type: z.enum([...ExceptionType values]).optional(), skuId: z.string().optional(), locationId: z.string().optional(), userId: z.string().optional(), minAgeHours: z.coerce.number().nonnegative().optional() })`. The routes reuse it for search params.
  - `type ExceptionRow = { id; type; skuId: string | null; locationId: string | null; deviceId: string | null; userIds: string[]; createdAt: string; ageHours: number; version: number; summary: string }`
    - `userIds` holds the distinct `userId`s of the referenced movements.
    - `summary` is a one-line description built from `details`:
      - COUNT_VARIANCE: `observed 7, expected 10 (−3)`
      - NEGATIVE_BALANCE: `balance −2`
      - LATE_MOVEMENT: `late movement, correction +3`
      - OVER_PICK: `picked 6 of 5`
      - TRANSFER_STUCK: `in transit 25 h`
      - CLOCK_SKEW: `clock +180 s`
  - `listExceptionsCore(deps: { global; warehouseDb; now(): Date; transferStuckHours: number }, warehouseId: string, filters: ExceptionFilters): Promise<{ ok: true; rows: ExceptionRow[]; countsByType: Record<ExceptionType, number> } | DeskError>`
    - It runs `checkStuckTransfers` first (spec §5.5).
    - It returns OPEN exceptions only, filtered, newest first. `countsByType` is computed over all OPEN exceptions before filters.
  - Server fn `listExceptions({ warehouseId, filters })` calls `requireDeskSession()` first.

- [ ] **Step 1: Write failing tests**, seeding via `syncMovementsCore` (as the scenario tests do) to produce real exceptions:
  - A NEGATIVE_BALANCE (pick below zero) and a COUNT_VARIANCE (tolerance 0) → both listed, with `countsByType` correct.
  - Filter by `type` → only that type. By `userId` → only exceptions whose movements came from that user. By `minAgeHours: 1` with `now` + 2h → both; with `now` + 30min → none.
  - Resolved exceptions are excluded.
  - A 25 h-old transfer with no IN → TRANSFER_STUCK appears in the result on the first list call.
  - The summary strings match the formats above for COUNT_VARIANCE and NEGATIVE_BALANCE.
  - Review Focus 3: the server fn with a worker session throws 403. Call the handler through an exported `handleListExceptions(session, input, deps)`, or assert on `authorizeDesk`, consistent with how `sync-movements-fn.test.ts` tests wrappers.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** the full gate and expect PASS.
- [ ] **Step 5: Commit**: `feat(desk): exceptions list with filters and stuck-transfer check`

---

### Task 4: Exception detail (both orderings)

**Files:**
- Modify: `src/server/desk/exceptions.server.ts`, `src/server/desk/exceptions.fn.ts`
- Create: `tests/server/desk-exception-detail.test.ts`

**Interfaces:**
- Produces:
  - `type TimelineMovement = { id; seq: number; type; skuId; fromLocationId; toLocationId; qty; reasonCode; userId; deviceId; source; occurredAt: string; receivedAt: string; involved: boolean }`
  - `exceptionDetailCore(deps, warehouseId: string, exceptionId: string): Promise<{ ok: true; exception: ExceptionRow & { status; details: Record<string, unknown>; resolution; note; resolvedBy; resolvedAt }; byOccurredAt: TimelineMovement[]; bySeq: TimelineMovement[]; missingMovementIds: string[] } | DeskError>`
    - The timeline is every movement on the exception's (sku, location) key, i.e. `toLocationId` or `fromLocationId` equals the location. Without a key, it's just the referenced movements.
    - `involved` is true for referenced ids.
    - `byOccurredAt` is sorted by (occurredAt, seq). `bySeq` is sorted by seq.
    - Referenced ids not found go in `missingMovementIds`.
  - Server fn `getExceptionDetail({ warehouseId, exceptionId })`

- [ ] **Step 1: Write failing tests**
  - LATE_MOVEMENT scenario (count at 10:30 synced first, pick at 10:00 synced after):
    - `bySeq` puts the count before the pick
    - `byOccurredAt` puts the pick before the count
    - both are marked `involved`
  - CLOCK_SKEW (empty `movementIds`, no key) → ok with empty timelines (Review Focus 4).
  - An exception whose `movementIds` references a deleted or unknown id → `missingMovementIds` lists it, and the timeline still returns the others.
  - Unknown exception id → `NOT_FOUND`.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** and expect PASS.
- [ ] **Step 5: Commit**: `feat(desk): exception detail with physical and arrival orderings`

---

### Task 5: Resolve an exception (versioned)

**Files:**
- Modify: `src/server/desk/exceptions.server.ts`, `src/server/desk/exceptions.fn.ts`
- Create: `tests/server/desk-exception-resolve.test.ts`

**Interfaces:**
- Consumes: `withMovementTx`, `loadContext`, `persistEffects` (`warehouse-repo.ts`); `processMovement`; `toMovement`/`Movement`; `DESK_DEVICE_ID`
- Produces:
  - `resolveInputSchema`, a Zod discriminated union on `action`:
    - `{ action: 'accept'; note?: string }`
    - `{ action: 'adjust'; qty: int ≠ 0; reasonCode: string; locationId?: string; skuId?: string; note?: string }` (sku and location default to the exception's)
    - `{ action: 'recount'; assignedUserId?: string; note?: string }`
    - `{ action: 'dismiss'; note: string min 1 }`
    - All carry `version: int`.
  - `resolveExceptionCore(deps: { global; catalog; warehouseDb; now(): Date; newId(): string }, session: DeskSession, warehouseId: string, exceptionId: string, input: ResolveInput): Promise<{ ok: true; exceptionId: string; version: number; adjustmentId?: string; countTaskId?: string } | DeskError>`
    - Everything happens in **one** `withMovementTx`. The first statement is `exception.updateMany({ where: { id, version: input.version, status: 'OPEN' }, data: { status: 'RESOLVED', version: { increment: 1 }, resolution, resolvedBy: session.userId, resolvedAt: now, note } })`. A count of 0 → return `CONFLICT` ('Resolved by someone else') and roll back without writing anything else. An unknown id → `NOT_FOUND`.
    - `adjust`: build an ADJUST `Movement` (`source: 'supervisor'`, `deviceId: DESK_DEVICE_ID`, `userId: session.userId`, `occurredAt: now`, `id: newId()`, `toLocationId` = the location), then `loadContext(tx, catalog, m)` → `processMovement` → `persistEffects(tx, effects)` in the same transaction. If the exception has no sku/location and the input doesn't give them → `INVALID`. The reason code must exist in the catalog `ReasonCode` with `ADJUST` in `appliesTo`, else `INVALID`.
    - `recount`: create a `CountTask { id: newId(), scope: JSON { locations: [locationId], skus: [skuId] }, assignedUserId, status: 'OPEN' }`. If the exception has no location → `INVALID`.
    - Resolution values are as listed in Global Constraints.
  - Server fn `resolveException({ warehouseId, exceptionId, input })`

- [ ] **Step 1: Write failing tests**
  - Accept → RESOLVED, `resolution 'ACCEPTED'`, `version + 1`, `resolvedBy` set.
  - Adjust +3 on a NEGATIVE_BALANCE at a bin with balance −3 → a movement with `source 'supervisor'` and `deviceId 'desk'`, balance 0, `adjustmentId` returned, `resolution 'ADJUSTED'`.
  - Recount → a CountTask with scope `{ locations: [loc], skus: [sku] }` and `status 'OPEN'`.
  - Dismiss without a note → Zod-invalid. With a note → `DISMISSED`.
  - **Review Focus 1:** two `resolveExceptionCore` calls with the same `version` via `Promise.all`, both `adjust +3` → exactly one ok and one `CONFLICT`; exactly one supervisor movement exists; the balance changed by +3 once.
  - **Review Focus 2:** run `resolveExceptionCore(adjust +2)` and `syncMovementsCore` (a handheld PICK 1 on the same bin) concurrently → afterwards `StockBalance.qty` equals the sum of `movementDeltas` over that bin's ledger.
  - Adjust with an unknown reason code → `INVALID`, and the exception is still OPEN with its version unchanged.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** the full gate and expect PASS.
- [ ] **Step 5: Commit**: `feat(desk): versioned exception resolution through the ledger pipeline`

---

### Task 6: Stock balances and ledger drill-down

**Files:**
- Create: `src/server/desk/stock.server.ts`, `src/server/desk/stock.fn.ts`, `tests/server/desk-stock.test.ts`

**Interfaces:**
- Produces:
  - `stockFiltersSchema = z.object({ skuId: z.string().optional(), locationId: z.string().optional(), nonZero: z.coerce.boolean().optional() })`
  - `stockCore(deps: { global; catalog; warehouseDb }, warehouseId, filters): Promise<{ ok: true; rows: { skuId; sku: string; name: string; locationId; locationCode: string; qty: number }[] } | DeskError>`. Product names come from the catalog and location codes from the warehouse DB. Rows are ordered by sku, then location code. `nonZero` drops qty 0.
  - `ledgerCore(deps, warehouseId, key: { skuId: string; locationId: string }): Promise<{ ok: true; rows: (TimelineMovement & { delta: number; runningBalance: number })[]; balance: number } | DeskError>`
    - Rows are ordered by `seq`, and `delta` comes from `movementDeltas` for this key.
    - `runningBalance` is the cumulative sum, and the last value equals the `StockBalance.qty`. (This is the invariant the server maintains; assert it in the test.)
  - Server fns `getStock` and `getLedger`

- [ ] **Step 1: Write failing tests**
  - Seed through `syncMovementsCore`: ADJUST +10, PICK 3, a MOVE of 2 to another bin → stock rows show 5 and 2 with names and codes.
  - `ledgerCore` for the source bin → deltas `[+10, −3, −2]`, running `[10, 7, 5]`, final 5 = balance.
  - A COUNT with an auto-adjust shows the COUNT with delta 0, then the system ADJUST.
  - `nonZero` filter.
  - Worker session → 403 (Review Focus 3).
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** and expect PASS.
- [ ] **Step 5: Commit**: `feat(desk): stock balances and ledger with running balance`

---

### Task 7: Pick lists

**Files:**
- Create: `src/server/desk/pick-lists.server.ts`, `src/server/desk/pick-lists.fn.ts`, `tests/server/desk-pick-lists.test.ts`

**Interfaces:**
- Produces:
  - Pure suggestion function:

```ts
export function suggestBins(
  requests: { skuId: string; qty: number }[],
  balances: { skuId: string; locationId: string; qty: number }[],
): { lines: { skuId: string; locationId: string | null; qty: number }[]; shortfalls: { skuId: string; missing: number }[] }
```

    - For each request, take bins with `qty > 0` for that SKU in descending qty order (ties broken by `locationId`), and split the requested qty greedily.
    - Never suggest more than a bin holds.
    - Any remainder goes into `shortfalls`.
    - A SKU with no positive bins gets one line `{ locationId: null, qty: requested }` plus a shortfall of the full qty.
    - Zero- and negative-qty lines are never produced.
  - `createPickListInputSchema = z.object({ lines: z.array(z.object({ skuId: z.string().min(1), locationId: z.string().min(1), qty: z.number().int().positive() })).min(1), assignedUserId: z.string().optional() })`. Creation requires a concrete location on every line (Review Focus 5).
  - Core functions:
    - `suggestPickListCore(deps, warehouseId, requests)` returns `suggestBins` over current balances.
    - `createPickListCore(deps, session, warehouseId, input)` validates the locations (active) and SKUs (catalog), then creates a `PickList { id: newId(), status: 'OPEN', createdBy: session.userId, assignedUserId }` with lines `id: newId()`, `qtyRequested`.
    - `listPickListsCore(deps, warehouseId, { status?: 'OPEN' | 'DONE' })` returns lists with lines, where `pickedQty` is the sum of PICK movements with `ref = line.id`, plus `assignedUserName`.
    - `assignPickListCore(deps, warehouseId, pickListId, assignedUserId | null)` checks that the assignee exists with role `worker`.
    - `closePickListCore(deps, warehouseId, pickListId)` sets `status 'DONE'`.
  - Server fns: `suggestPickList`, `createPickList`, `listPickLists`, `assignPickList`, `closePickList`.

- [ ] **Step 1: Write failing tests**
  - `suggestBins` (Review Focus 5):
    - request 15 with bins `{A:10, B:8}` → `[A:10, B:5]`, no shortfall
    - request 25 → `[A:10, B:8]`, shortfall 7
    - SKU with no stock → `[{ locationId: null, qty: 4 }]`, shortfall 4
    - a bin at qty −2 is ignored
    - no line ever has qty ≤ 0
  - `createPickListCore` rejects a line with an inactive location and one with an unknown SKU (`INVALID`). A line with `locationId: null` is Zod-invalid. Valid → list and lines created with `status 'OPEN'`.
  - `listPickListsCore` `pickedQty` reflects synced PICKs with `ref` = the line id.
  - Assigning to a non-worker → `INVALID`.
  - Close → `DONE`, and the plan 2 handheld `assignedPickLists` (src/handheld/stock.ts, against the same DB through `libsqlSql`) no longer returns it.
  - Worker session → 403.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** and expect PASS.
- [ ] **Step 5: Commit**: `feat(desk): pick lists with bin suggestions and assignment`

---

### Task 8: Count tasks and worker list

**Files:**
- Create: `src/server/desk/count-tasks.server.ts`, `src/server/desk/count-tasks.fn.ts`, `tests/server/desk-count-tasks.test.ts`

**Interfaces:**
- Produces:
  - `countScopeSchema = z.union([z.object({ locations: z.array(z.string().min(1)).min(1) }), z.object({ zone: z.string().min(1) }), z.object({ skus: z.array(z.string().min(1)).min(1) })])`. It's stored as JSON in `CountTask.scope`, compatible with the shapes the handheld reads (`ct-1` uses `{ zone }`; the recount from Task 5 uses `{ locations, skus }`, so the read side accepts both keys together).
  - Core functions:
    - `createCountTaskCore(deps, warehouseId, { scope, assignedUserId? })` validates that the referenced locations exist, the zone has at least one location, and the SKUs exist in the catalog. It creates `status 'OPEN'`.
    - `listCountTasksCore(deps, warehouseId, { status? })` adds a `countsRecorded` field: the number of COUNT movements with `ref = task.id`.
    - `assignCountTaskCore` uses the same assignee rule as pick lists.
    - `closeCountTaskCore` sets `DONE`.
  - `listWorkersCore(global): Promise<{ id; name }[]>` returns users with role `worker`, ordered by name.
  - Server fns: `createCountTask`, `listCountTasks`, `assignCountTask`, `closeCountTask`, `listWorkers`.

- [ ] **Step 1: Write failing tests**
  - Create by zone `A` when locations A-01..A-03 exist in zone A → ok. Zone `Z` with no locations → `INVALID`. Unknown location id → `INVALID`. Unknown SKU → `INVALID`.
  - `countsRecorded` counts COUNT movements with `ref` = the task id.
  - Close → `DONE`.
  - `listWorkersCore` excludes supervisors and admins.
  - Worker session → 403.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** and expect PASS.
- [ ] **Step 5: Commit**: `feat(desk): count tasks and worker list`

---

### Task 9: Desk shell: login, guard, navigation

**Files:**
- Create: `src/routes/desk/login.tsx`, `src/routes/w/$warehouseId/route.tsx`, `src/desk/components/DeskNav.tsx`, `tests/desk/shell.test.tsx`
- Modify: `src/routes/index.tsx`

**Interfaces:**
- Consumes: `deskLogin`, `deskLogout`, `getDeskSession` (Task 1); `listWarehouses` via a server fn `getWarehouses` (add it to `desk-auth.fn.ts`, role-checked)
- Produces:
  - `/desk/login`: username and PIN (`PinInput`, 4 digits). On success → `/`. It maps `BAD_CREDENTIALS` → "Wrong username or PIN", `NOT_ALLOWED` → "This account can't use the desk", and `LOCKED` → "Too many attempts. Try again in 15 minutes."
  - `/`: `beforeLoad` calls `getDeskSession`. With a session → redirect to `/w/<first warehouse>/exceptions`; with no warehouses, render "No warehouses yet". Without a session → `/desk/login`. Handheld users go to `/h` directly; `/` is the desk entry.
  - `/w/$warehouseId` layout:
    - `beforeLoad` redirects to `/desk/login` without a session
    - header: warehouse switcher (Mantine `Select`, keeps the current sub-page), nav links (Exceptions, Stock, Pick lists, Counts), the user's name and a Sign out button
    - renders a `NOT_FOUND`/`NOT_READY` warehouse as an inline Alert
  - Every desk query shares the polling default: `queryClient.setQueryDefaults(['desk'], { refetchInterval: 10000 })`, set once in the layout.

- [ ] **Step 1: Write failing tests** (jsdom, mocking the server fns)
  - The login page shows each error message for its reason.
  - `DeskNav` renders the four links for the current warehouse and keeps the sub-page when the warehouse changes (`/w/wh-1/stock` → `/w/wh-2/stock`).
  - The `/` redirect decision is a pure exported helper `deskHomeTarget(session, warehouses)` → `'/desk/login' | '/w/<id>/exceptions' | null`. Unit-test it.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** the full gate plus `pnpm build`. Expected: PASS, and the `/h` handheld still builds; `pnpm e2e` offline-shell specs still pass.
- [ ] **Step 5: Commit**: `feat(desk): login, guarded warehouse layout, navigation`

---

### Task 10: Exceptions UI

**Files:**
- Create: `src/routes/w/$warehouseId/exceptions.index.tsx`, `src/routes/w/$warehouseId/exceptions.$id.tsx`, `src/desk/components/{ExceptionTable,ExceptionFilters,Timeline,ResolvePanel}.tsx`, `tests/desk/exceptions.test.tsx`

**Interfaces:**
- Consumes: `listExceptions`, `getExceptionDetail`, `resolveException`, `listWorkers`, and a reason-code list. Add `listReasonCodesCore(catalog: CatalogClient, type: MovementType): Promise<{ code; label }[]>` to `stock.server.ts` (codes whose `appliesTo` includes the type, excluding `COUNT_AUTO` and `INITIAL`, with a unit test) and the role-checked server fn `listReasonCodes` to `stock.fn.ts`.
- Produces:
  - **List page:**
    - search params validated with `exceptionFiltersSchema`
    - a type count strip with one badge per type (clicking it sets the `type` filter)
    - a filter bar (type, SKU, bin, worker, min age)
    - a table: type, summary, SKU, bin, workers, age; rows link to detail
    - query key `['desk', wh, 'exceptions', filters]`
  - **Detail page:**
    - header with the summary and details
    - `Timeline`: two side-by-side columns titled **"Physical order (occurred at)"** and **"Arrival order (seq)"**. Involved movements are highlighted, with time, type, qty, delta, user and device. Below 900 px wide it stacks vertically.
    - `ResolvePanel` (shown only while OPEN) with four actions: Accept, Correcting adjustment (qty ≠ 0, reason, defaults to the exception's sku/bin), Request recount (optional worker), Dismiss (note required)
    - every submit sends the loaded `version`
    - `CONFLICT` shows an orange Alert "Resolved by someone else. Reload to see what changed." with a Reload button, and keeps the form disabled
    - success invalidates `['desk', wh, 'exceptions']` and shows the resolved state
  - Resolved exceptions show resolution, note, who and when, and hide the panel.

- [ ] **Step 1: Write failing tests** (jsdom, fake fns)
  - Timeline renders both column titles. Given `byOccurredAt` [pick, count] and `bySeq` [count, pick], the column order matches each list, and involved rows have `data-involved="true"`.
  - Dismiss with an empty note keeps submit disabled.
  - A resolve returning `CONFLICT` shows the exact message and disables the form.
  - A success invalidates the exceptions key.
  - Clicking a type badge sets `type` in the URL search params (assert on the router location).
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** the full gate plus build and expect PASS.
- [ ] **Step 5: Commit**: `feat(desk): exceptions queue and resolution UI`

---

### Task 11: Stock and ledger UI

**Files:**
- Create: `src/routes/w/$warehouseId/stock.index.tsx`, `src/routes/w/$warehouseId/stock.ledger.tsx`, `src/desk/components/{StockTable,LedgerTable}.tsx`, `tests/desk/stock.test.tsx`

**Interfaces:**
- Produces:
  - **Stock page:** search params `stockFiltersSchema`; a filter bar (SKU, bin, "non-zero only"); a table with SKU, name, bin code and qty (negative qty in red). Each row links to `stock/ledger?skuId=&locationId=`.
  - **Ledger page:** search params `z.object({ skuId: z.string().min(1), locationId: z.string().min(1) })`. It shows a header with the current balance and a table by seq: seq, occurred at, received at, type, delta (+/−), running balance, user, device and source (with a badge for supervisor/system).
  - Query keys: `['desk', wh, 'stock', filters]` and `['desk', wh, 'ledger', key]`.

- [ ] **Step 1: Write failing tests**
  - Negative qty renders with the red style (assert the class or attribute).
  - The ledger shows the running balance column, and its last value equals the header balance.
  - Rows link to the ledger with the right search params.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** the full gate plus build and expect PASS.
- [ ] **Step 5: Commit**: `feat(desk): stock and ledger pages`

---

### Task 12: Pick lists and counts UI

**Files:**
- Create: `src/routes/w/$warehouseId/pick-lists.tsx`, `src/routes/w/$warehouseId/counts.tsx`, `src/desk/components/{PickListForm,PickListTable,CountTaskForm,CountTaskTable}.tsx`, `tests/desk/pick-counts.test.tsx`

**Interfaces:**
- Produces:
  - **Pick lists page:**
    - a status tab (Open / Done)
    - a table of lists: id, assignee, created, progress "picked/requested", with Assign (worker Select) and Close actions
    - a "New pick list" drawer: add SKU and qty rows → "Suggest bins" calls `suggestPickList` and shows the suggested lines, each with an editable bin Select over that SKU's bins. Shortfalls show in a yellow Alert "Short by N for <sku>". Lines with `locationId: null` must get a bin before Create is enabled. An optional assignee.
    - Create calls `createPickList`.
  - **Counts page:**
    - a table of tasks: id, scope summary ("Zone A", "3 bins", "2 SKUs"), assignee, counts recorded, status, with Assign and Close
    - a "New count task" drawer with a scope type SegmentedControl (Bins / Zone / SKUs) and the matching inputs, plus an optional assignee
  - Query keys under `['desk', wh, 'pick-lists' | 'counts', ...]`.

- [ ] **Step 1: Write failing tests**
  - Create stays disabled while any suggested line has no bin, and becomes enabled after a bin is chosen.
  - A shortfall shows the exact Alert text.
  - The count task form posts `{ zone: 'A' }` for the Zone scope and `{ locations: [...] }` for Bins.
  - Close calls the close fn and invalidates the list key.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** the full gate plus build and `pnpm e2e` (offline-shell specs still pass). Expected: PASS.
- [ ] **Step 5: Commit**: `feat(desk): pick list and count task management`
