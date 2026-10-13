# Plan 6: Floor Signage UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the handheld, the desk, admin and both logins into one "Floor signage" product look, in light and dark, without changing behaviour.

**Architecture:**
- One Mantine `createTheme` plus a small CSS token file drive every surface. Status colours come from a single `statusColor()` helper.
- Two new shared layout components replace the per-area chrome: `AuthSplit` for the login screens and `AppShellSidebar` for the desk and admin frames.
- A new `ConflictLanes` SVG, built on a pure `laneLayout()`, is added to the exception detail page.

**Tech Stack:**
- Mantine 9: `createTheme`, `AppShell`, CSS variables resolver
- `@fontsource-variable/archivo`, self-hosted
- TanStack Router, Vitest + Testing Library, Biome

**Spec:** `docs/superpowers/specs/2026-10-13-floor-signage-ui-design.md`. Its section numbers are cited as §N.

## Global Constraints

- **No behaviour changes.** Routes, queries, server code, permissions, guards, `watchDeskAuth`, `runMutation`, R5 polling and the injectable `navigate` in `DeskLayoutView`/`AdminLayoutView` all stay as they are (§1, §9).
- **Copy changes are limited to §7:**
  - Pitch line: "Offline-first stock control. Every movement counted."
  - Login titles: "Supervisor sign-in" and "▲ Handheld"
  - Empty exceptions list: "No open exceptions. Floor's clear."
  - Lanes fallback: "Too many movements to draw — see the lists below."
  - A "▲" glyph on existing empty states
- **Colour tokens are exactly §3.1.** Badge text follows §3.1:
  - light: white on danger, ink on the other fills
  - dark: `#1c1917` on danger, signal and ok fills, `#e7e5e4` on the resolved fill
- **Yellow** is only a fill behind ink text, or text on `--fi-rail`. Never yellow text on a light background.
- **Status colours** go only through `statusColor()`. Components hard-code no status colour.
- **The hazard stripe** (`.fi-stripe`) appears in exactly three places: the bottom of the login panel, the top edge of the sidebar rail, and the handheld status bar.
- **Fonts** are self-hosted and precached; never a CDN or Google Fonts link.
- **Styling:** no new styling library (no Tailwind) and no chart library.
- **Accessibility:**
  - focus ring: 2px `--fi-signal` outline with a 2px `--fi-ink` offset
  - handheld touch targets ≥ 48px
  - text contrast AA (≥ 4.5 body, ≥ 3 large/bold UI text) in both colour schemes
- **Gate for every task:** `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Biome is the only linter.

## Review Focus

1. **A new or unknown exception type string arriving from the server.** `statusColor` must fall back to the yellow "attention" family and never throw. Test in Task 1.
2. **Dark mode, every badge fill in every table.** Badge text must stay legible: the contrast test covers each fill/text pair from §3.1 (Task 1).
3. **Very long warehouse names or user names in the sidebar.** They truncate with an ellipsis and keep the full text in `title`, so the rail never grows wider than 200px. Test in Task 3.
4. **An exception with 0 or 1 involved movements, or with tied `occurredAt`.** `ConflictLanes` must render nothing or a single non-late line, and break ties by `seq`. Test in Task 6.
5. **The first offline load after a deploy.** Fonts come from the precache. The pwa-config test (Task 1) and `offline-shell.spec.ts` (gate) cover it.

---

### Task 1: Theme foundation, status colours and offline fonts

**Files:**
- Create:
  - `src/ui/theme.ts`
  - `src/ui/tokens.css`
  - `src/ui/status.ts`
  - `src/ui/contrast.ts`
  - `tests/ui/status.test.ts`
  - `tests/ui/contrast.test.ts`
- Modify:
  - `src/routes/__root.tsx`: pass `theme` to `MantineProvider`; import `#/ui/tokens.css` and `@fontsource-variable/archivo`
  - `src/pwa-options.ts`: add `woff2` to `PRECACHE_GLOBS`
  - `tests/handheld/pwa-config.test.ts`
  - `package.json`: add `@fontsource-variable/archivo`

**Interfaces:**
- **Produces:**
  - `theme: MantineThemeOverride` with:
    - colour tuples `stone` and `signal` (`signal[4] === '#facc15'`)
    - `primaryColor: 'signal'`, `primaryShade: 4`
    - `fontFamily: "'Archivo Variable', system-ui, sans-serif"`
    - `defaultRadius: 'sm'`
    - component defaults per §4
  - `TOKENS: Record<'light' | 'dark', Record<TokenName, string>>`, exported from `src/ui/theme.ts`. Its values are exactly the §3.1 table, and `tokens.css` mirrors it.
  - `type StatusKind = ExceptionType | 'pending' | 'synced' | 'attention' | 'resolved'`
  - `statusColor(kind: string): { fill: TokenName; text: { light: string; dark: string } }`:
    - `'NEGATIVE_BALANCE'` and `'attention'` map to the `--fi-danger` fill
    - `'synced'` maps to `--fi-ok`
    - `'resolved'` maps to `--fi-resolved`
    - every other exception type, `'pending'` and any unknown string map to `--fi-signal`
  - `contrastRatio(a: string, b: string): number` in `src/ui/contrast.ts`, the WCAG relative-luminance formula.
  - CSS classes `.fi-stripe` and `.fi-num`, and the global focus ring, in `tokens.css`.

- [ ] **Step 1: Write the failing tests**
  - `status.test.ts`:
    - every `ExceptionType` plus `'pending' | 'synced' | 'attention' | 'resolved'` maps as listed above
    - `statusColor('SOMETHING_NEW').fill === 'signal'`, and it does not throw
    - in dark mode, text is `'#1c1917'` for every kind except `'resolved'`, which is `'#e7e5e4'`
    - in light mode, text is `'#ffffff'` for danger and `'#1c1917'` otherwise
  - `contrast.test.ts`, for both schemes:
    - `contrastRatio(ink, bg)`, `(ink, surface)`, `(muted, surface)` and `(danger, surface)` are ≥ 4.5
    - for every `statusColor` kind, the badge text on its fill is ≥ 4.5 if it is body text, otherwise ≥ 3
    - `(signal, rail)` is ≥ 4.5
    - sanity check: `contrastRatio('#000', '#fff')` ≈ 21
  - `pwa-config.test.ts`: some glob includes `woff2`.
- [ ] **Step 2: Run** `pnpm test tests/ui tests/handheld/pwa-config.test.ts`. Expected: FAIL, modules missing.
- [ ] **Step 3: Implement**
  - Install the font package. The npm registry is blocked in the sandbox, so the controller may need to run the install outside it.
  - Write the theme, tokens, status and contrast modules, then wire them into `__root.tsx`.
  - If a §3.1 pair fails AA, stop and report the failing pair. Don't tweak values silently.
- [ ] **Step 4: Run** the gate. Expected: PASS, and `dist/client` contains `.woff2` files.
- [ ] **Step 5: Commit** `feat(ui): floor signage theme, status colours and offline fonts`

---

### Task 2: Login screens

**Files:**
- Create:
  - `src/ui/AuthSplit.tsx`
  - `tests/ui/auth-split.test.tsx`
- Modify:
  - `src/routes/desk/login.tsx`: render the form inside `AuthSplit`, titled "Supervisor sign-in"
  - `src/routes/h/login.tsx`: a full-screen form with `.fi-stripe` at the top and the title "▲ Handheld"

**Interfaces:**
- **Consumes:** Task 1's tokens and `.fi-stripe`.
- **Produces:** `AuthSplit({ title: string; children: ReactNode }): JSX.Element`.
  - The left panel holds:
    - the wordmark "▲ Field Inventory"
    - the pitch line "Offline-first stock control. Every movement counted."
    - a `.fi-stripe` along its bottom
  - The panel collapses to a header band below 720px.

- [ ] **Step 1: Write the failing test** in `auth-split.test.tsx`. It checks that the wordmark, the pitch line and `title` all render, and that `children` render inside a `form` region.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement**
  - Use `AuthSplit` on the desk login, and restyle the handheld login.
  - Don't change the fields, labels, handlers or error handling. The existing login tests must stay green unedited.
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): split-panel desk login and handheld login`

---

### Task 3: Sidebar frame for desk and admin

**Files:**
- Create:
  - `src/ui/AppShellSidebar.tsx`
  - `src/desk/components/WarehouseSwitcher.tsx`
  - `tests/ui/app-shell-sidebar.test.tsx`
- Modify:
  - `src/routes/w/$warehouseId/route.tsx`: `DeskLayoutView` renders `AppShellSidebar`
  - `src/routes/admin/route.tsx`: `AdminLayoutView` renders `AppShellSidebar`
  - `src/desk/components/DeskNav.tsx`: delete it, and move `switchWarehousePath` into `WarehouseSwitcher.tsx` with the same export name
  - `tests/desk/shell.test.tsx` and `tests/admin/shell.test.tsx`: update import paths only

**Interfaces:**
- **Produces:**
  - `AppShellSidebar({ switcher, links, footer, children }: { switcher: ReactNode; links: { label: string; to: string; params?: Record<string,string>; active: boolean }[]; footer: ReactNode; children: ReactNode })`
    - The rail is about 200px wide, uses `--fi-rail`, and has a `.fi-stripe` along its top edge plus the wordmark.
    - The active link is a yellow pill with `aria-current="page"`.
    - Below 900px the rail collapses: a top bar shows the wordmark and a burger (`aria-label="Open navigation"`), and the rail opens as a drawer.
    - Text in the rail truncates with an ellipsis and carries a `title` attribute.
  - `WarehouseSwitcher({ warehouseId, warehouses, pathname })`: the existing select logic from `DeskNav`.
  - `switchWarehousePath(pathname, id)`: unchanged.

- [ ] **Step 1: Write the failing tests** in `app-shell-sidebar.test.tsx`:
  - the active link has `aria-current="page"` and the others don't
  - at a 600px viewport (`window.matchMedia` mocked) the burger is shown, and clicking it reveals the links
  - a 60-character link label or footer name renders with `title` equal to the full text
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement**
  - **Desk links:** Exceptions, Stock, Pick lists and Counts.
  - **Desk footer:** the "Admin" link (admins only, as today), the user's name and `SignOutButton`.
  - **Admin:** the switcher slot shows an "Admin" title, the links are the six admin sections, and the footer has "Back to desk", the user's name and Sign out.
  - The existing shell, auth-expiry and session-handling tests must pass. Only import paths may change.
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): sidebar frame for desk and admin`

---

### Task 4: Desk and admin content styling

**Files:**
- Modify:
  - `src/desk/components/{ExceptionTable,ExceptionFilters,StockTable,LedgerTable,PickListTable,CountTaskTable,DeskErrorAlert,RefreshNote}.tsx`
  - `src/admin/components/*Table.tsx`
  - the desk and admin route files' page titles
  - `e2e/helpers.ts:167`: the empty-state text
- Test:
  - `tests/desk/exceptions.test.tsx`
  - `tests/ui/count-tiles.test.tsx` (create)

**Interfaces:**
- **Consumes:** `statusColor` and `.fi-num` from Task 1.
- **Produces:** `CountTiles({ counts: Record<string, number> })` in `src/desk/components/CountTiles.tsx`. It replaces the plain count badges on the exceptions page:
  - each tile has a 2px ink border
  - a non-zero tile is filled with `statusColor(type)`
  - a zero tile is outlined only
  - each tile's accessible name is `"<TYPE> <n>"`

- [ ] **Step 1: Write the failing tests**
  - `count-tiles.test.tsx`: `{ NEGATIVE_BALANCE: 1, COUNT_VARIANCE: 0 }` renders tile "NEGATIVE_BALANCE 1" with `data-filled="true"` and tile "COUNT_VARIANCE 0" with `data-filled="false"`.
  - `exceptions.test.tsx`: the empty list shows "No open exceptions. Floor's clear.", replacing the old "No open exceptions match." assertion. That is the only assertion change.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**
  - Page titles: uppercase condensed.
  - Tables: 2px outer border, uppercase muted header, `--fi-rule` rows, bold `.fi-num` quantities and bin codes, `--fi-danger` for negative quantities.
  - Badges use `statusColor`.
  - Drawers and modals get a 2px border and an uppercase title, via theme defaults where possible.
  - `DeskErrorAlert` gets a 2px danger border. Its logic is unchanged.
  - Show `Skeleton` where a component shows bare "Loading…" today.
  - Prefix the existing empty-state messages with "▲".
  - Update the `e2e/helpers.ts` empty text.
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): signage styling for desk and admin content`

---

### Task 5: Handheld styling

**Files:**
- Modify: `src/handheld/components/{ScreenFrame,StatusPill,ScanInput,ScanStep,QtyInput,DisplayedQty,ConfirmButton,BlockingBanner}.tsx`
- Test: `tests/handheld/screens.test.tsx` and `tests/handheld/shell.test.tsx`, adding assertions only

**Interfaces:**
- **Consumes:** `statusColor` (`'synced'`, `'pending'`, `'attention'`), `.fi-stripe` and `.fi-num`.

- [ ] **Step 1: Write the failing tests**
  - `StatusPill` exposes `data-status` set to `"synced"`, `"pending"` or `"attention"`. It is `"attention"` for the revoked and needs-attention states, and its text is unchanged.
  - `ConfirmButton`'s computed `min-height` is ≥ 48px. Set it with an inline style or a CSS variable so jsdom can read it.
  - `ScreenFrame` renders a `.fi-stripe` element.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** per §5.4:
  - the status bar is the rail colour, with the stripe and an uppercase signal title
  - inputs are large, with 2px borders
  - `DisplayedQty` is 40px, bold and `.fi-num`
  - `ConfirmButton` is full width with an ink fill and signal text, inverted in dark
  - `BlockingBanner` uses the rail with signal text

  When banners show, and all other logic, is unchanged.
- [ ] **Step 4: Run** the gate plus `pnpm e2e`, outside the sandbox (controller). Expected: PASS, with offline-shell still green.
- [ ] **Step 5: Commit** `feat(ui): signage styling for the handheld`

---

### Task 6: Conflict lanes on exception detail

**Files:**
- Create:
  - `src/desk/conflict-lanes.ts`
  - `src/desk/components/ConflictLanes.tsx`
  - `tests/desk/conflict-lanes.test.ts`
  - `tests/desk/conflict-lanes-view.test.tsx`
- Modify:
  - `src/routes/w/$warehouseId/exceptions.$id.tsx`: render `ConflictLanes` above the existing `Timeline`
  - `src/desk/components/Timeline.tsx`: export `deltaFor`, unchanged otherwise

**Interfaces:**
- **Consumes:** `TimelineMovement` (`src/server/desk/exceptions.server.ts`, type import only), `deltaFor(m, key)` and `names: Record<string,string>` from `Timeline`.
- **Produces:**
  - `type LaneInput = { id: string; occurredAt: string; seq: number; type: string; delta: number | null; worker: string }`
  - `laneLayout(ms: LaneInput[]): { id: string; happenedRank: number; arrivedRank: number; late: boolean; label: string }[]`
    - ranks are 0-based
    - `happenedRank` sorts by `occurredAt`, ties broken by `seq`
    - `arrivedRank` sorts by `seq`
    - `late` is true iff some other movement has a higher `happenedRank` and a lower `arrivedRank`
    - `label` is `` `${type} ${signed(delta)} · ${worker}` ``
  - `ConflictLanes({ movements, key, names }: { movements: TimelineMovement[]; key: TimelineKey | null; names: Record<string,string> })`
    - It uses the involved movements only (`m.involved`).
    - With 0 involved, it renders nothing.
    - With more than 12, it renders the text "Too many movements to draw — see the lists below."
    - Otherwise it renders an SVG with `role="img"` and an `aria-label` of `"Arrival order vs physical order: N late arrival(s)"`.
    - Each line has `data-late`. Late lines use `--fi-danger` with a "late" label; others use `--fi-muted`.

- [ ] **Step 1: Write the failing tests**
  - `conflict-lanes.test.ts`:
    - **Stale-count case:** a MOVE `{occurredAt 10:00, seq 19}` and a COUNT `{occurredAt 10:30, seq 17}`. Only the MOVE is late. MOVE `happenedRank` 0 / `arrivedRank` 1; COUNT 1 / 0.
    - **In-order case:** no movement is late.
    - **Tie case:** equal `occurredAt` is ordered by `seq`, so there are no lates.
    - **Single movement:** one entry, not late.
    - **Empty input:** returns `[]`.
  - `conflict-lanes-view.test.tsx`:
    - one `line[data-late]` per involved movement
    - the aria-label reports the late count
    - 13 involved movements show the fallback text
    - 0 involved render nothing
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**
  - Draw a hand-rolled SVG with a `viewBox`: "HAPPENED" axis on top, "ARRIVED" axis below, points spaced evenly by rank.
  - Add `ConflictLanes` to the exception detail page. The existing exception detail tests must stay green.
- [ ] **Step 4: Run** the gate. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desk): conflict lanes on exception detail`

---

### Final: Visual verification (controller, after the whole-branch review)

- [ ] **Step 1: Launch the app.** Seed local file DBs and run `pnpm dev` outside the sandbox. Replay the plan 5 multi-device scenario through the sync core, as in the earlier demo, so that a superseded variance and a negative balance exist.
- [ ] **Step 2: Screenshot the screens in the browser pane, in both light and dark.** Use `resize_window` `colorScheme`. Cover:
  - the desk login
  - the desk exceptions list
  - the exception detail with lanes
  - admin warehouses
  - the handheld login
  - a handheld scan screen
  - one at a narrow width, to show the sidebar collapsing
- [ ] **Step 3: Report.** Fix any visual defect found, as its own commit with the gate. Attach the screenshots to the final report.
