# AGENTS.md

These are guidelines for coding agents and contributors working on Field
Inventory. Read [README.md](README.md) for setup and
[docs/architecture.md](docs/architecture.md) for how the system fits together.
The design spec in `docs/superpowers/specs/` is the source of truth for
behaviour.

## Commands

```bash
pnpm install
pnpm db:generate          # after any prisma/*/schema.prisma change
pnpm dev                  # http://localhost:3000
pnpm test <path>          # Vitest, single file or folder
pnpm e2e                  # Playwright; Turso specs need E2E_TURSO=1 (see docs/e2e.md)
```

**Gate before every commit:**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

After changing any route or `*.fn.ts` file, also check that no server code
reached the client bundle. This command must print nothing:
`grep -rl "PrismaClient\|@prisma" dist/client`.

## Repo and git

- **Local only: there is no git remote.** Finish work by merging into local
  `main` with `git merge --ff-only`. Never push.
- **Do feature work in a git worktree** under `.claude/worktrees/<name>`
  (git-ignored) on a `feat/…` branch. Merge, then remove the worktree and
  delete the merged branch.
- **Stage files explicitly.** Never `git add -A` or `git add .`.
- Don't commit `.env`, `.data/` or `.superpowers/` (scratch files from agent
  workflows).
- **Generated files** are git-ignored and are never edited by hand:
  `src/generated/*` (Prisma clients) and `src/routeTree.gen.ts` (TanStack
  Router).

## Tooling rules

- **Biome is the only linter and formatter.** Never add ESLint or Prettier.
- **TypeScript 7, strict.** `#/*` and `@/*` both resolve to `src/*`.
  - Don't derive types from overloaded functions with
    `Parameters`/`ReturnType`. Which overload is picked differs between
    compilers. Use the library's named type, e.g. `Prisma.TransactionClient`
    for a transaction client.
  - Add `as const` when building tuples for `new Map(…)` from `.map(…)`.
    TypeScript 7 doesn't infer a tuple there.
- **pnpm settings live in `pnpm-workspace.yaml`.** That covers `allowBuilds`
  and `overrides`. pnpm 12 ignores the `"pnpm"` field in `package.json`.
- **Pinned dependencies.** `@tursodatabase/sync-wasm` is pinned exactly, and
  its emnapi overrides are guarded by a test. Only upgrade it together with a
  passing Turso e2e run (see [docs/e2e.md](docs/e2e.md)).
- **TDD.** Write the failing test first. Component tests use
  `// @vitest-environment jsdom`, and Mantine needs `matchMedia` (and, for
  SegmentedControl, `ResizeObserver`) stubbed. Copy the setup from a
  neighbouring test.
- **Never weaken an existing assertion** to make a change pass. Strengthen the
  test or fix the code.
- **Database tests use real SQLite files** from `tests/support/test-env.ts`.
  Seed realistic movements through `syncMovementsCore`, not raw inserts.

## Domain rules (do not break)

- **The ledger is append-only.** App code never deletes or updates past
  movements, and never hard-deletes exceptions, warehouses, locations,
  products, users or devices. Deactivate, disable or revoke instead. The only
  deleting code is `scripts/e2e-reset.ts`. It is test-only, env-guarded, and
  nothing in `src/` imports it.
- **Movements recorded offline are never lost.** That holds whether they fail
  validation, lose a race, or come from a revoked device. They stay in the
  handheld outbox and can be exported.
- **Counts are blind.** Handheld screens never show the expected quantity.
- **Count reconciliation and late movements follow spec §5.4–5.5.** Each count
  has at most one open count exception. Changes to `src/domain` need scenario
  tests (`tests/scenarios/*.scenario.ts`). Property tests in
  `tests/domain/convergence.test.ts` must stay green. `tests/support/simulate.ts`
  must stay in parity with the server.
- **Supervisor movements** use `source: 'supervisor'` and
  `deviceId: 'desk'`. They go through `processMovement` and `persistEffects`,
  inside the same transaction as the exception version check.
- **Schema changes:**
  1. Edit `prisma/<db>/schema.prisma`.
  2. Generate the migration SQL with `prisma migrate diff`.
  3. Add it under `prisma/<db>/migrations`.
  4. Bump `SCHEMA_VERSIONS` in `src/domain/schema-versions.ts`.
  5. Run `pnpm db:generate`.

## Server pattern (desk and admin)

- **`*.fn.ts` files** export only server functions. They read claims with
  `readDeskClaims()` and contain no database code.
- **`*.server.ts` files** export `handleX(claims, input, deps)`, which
  authorizes first with `await authorizeDesk(…)` or `await authorizeAdmin(…)`
  and then calls a core function with injected deps. Tests assert 401/403
  through `handleX`.
- **Error handling.** Expected failures return a typed
  `DeskError { ok: false, code: 'CONFLICT' | 'NOT_FOUND' | 'INVALID' | 'NOT_READY', message }`.
  Auth failures throw 401/403.
- **Client-safe modules.** Zod schemas and types the client needs live in
  `src/desk/*.ts` or `src/admin/*.ts`. Client files import `*.server.ts` only
  with `import type`.
- **Client calls** go through `deskCall`. Saves go through `runMutation`, which
  turns an expired session into a sign-in redirect and shows other errors as
  readable messages.
- **Polling and errors (R5).** Show an error alert only when there is no data.
  A failed background poll keeps the data and the open forms, and shows
  `RefreshNote`. Search params use `safeParse` with a fallback. Mutations guard
  against double-submit.

## UI rules

- **Visual changes stay visual.** Restyling never changes behaviour, routes,
  queries or user-visible copy unless that's the explicit task.
- **Colours** come from `--fi-*` tokens (`src/ui/theme.ts` `TOKENS` mirrored
  in `src/ui/tokens.css`; a test keeps them in sync).
  - Status colours go only through `statusColor()` and `StatusBadge`. Never
    hard-code one.
  - Pick text colour in CSS, never in JS with `useComputedColorScheme`, so dark
    mode doesn't flash.
- **Contrast must meet WCAG AA in light and dark.** Add every new text and
  background pair to `tests/ui/contrast.test.ts`. Yellow (`--fi-signal`) is
  never text on a light background.
- **Icons are Phosphor** (`@phosphor-icons/react`, `*Icon` exports), always
  decorative: `aria-hidden="true"`, next to visible text. Accessible names stay
  the text, because tests and e2e find controls by name.
- **The handheld** must work with gloves: every tap target is at least 48px
  (use `TOUCH` from `src/handheld/touch.ts`). Offline loading must keep
  working, so anything the shell needs must be precached (`src/pwa-options.ts`).
- **The hazard stripe** (`.fi-stripe`) appears only in the login brand panel,
  on the sidebar rail and in the handheld status bar.

## Testing notes

- `pnpm e2e` binds local ports, and `tsx` scripts open an IPC pipe. In a
  sandboxed agent environment, both may need to run outside the sandbox.
- The Turso e2e specs need real Turso dev credentials and
  `E2E_TURSO=1 E2E_ALLOW_RESET=1`. Without them they are skipped. Report them as
  not run, never as passing.
