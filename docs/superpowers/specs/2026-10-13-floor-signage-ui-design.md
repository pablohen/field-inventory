# Floor Signage UI: Design

**Date:** 2026-10-13
**Status:** approved in brainstorming, pending spec review
**Parent spec:** `docs/superpowers/specs/2026-10-11-field-inventory-design.md` (behaviour, flows and copy rules there still apply)

## 1. Goal

**Stakeholder demo polish.** A person who sees the handheld, the desk and the admin side by side should read them as one designed product. The conflict story (offline → sync → exception → resolve) should look intentional rather than like a demo of default components.

**Scope:**
- All three surfaces (handheld `/h/*`, desk `/w/$warehouseId/*`, admin `/admin/*`) and both login screens.
- This is a visual layer only. Behaviour, routes, queries, server code and copy stay the same, except for the copy listed in §7.

**Success criteria:**
- One theme drives every surface, in both light and dark.
- The login, frame, handheld and exception-detail screens match the choices in §3.
- Every existing test passes unchanged in intent.
- Text contrast meets WCAG AA in both colour schemes.
- The handheld still loads fully offline, fonts included.

## 2. Decisions made in brainstorming

| Topic | Choice |
|---|---|
| Visual direction | **Floor signage:** warm off-white, black ink, safety yellow, bold condensed type |
| Colour schemes | **Light + dark**, following the OS (`defaultColorScheme="auto"`, as today) |
| Desk/admin login | **Split panel:** black brand panel on the left, form on the right |
| Desk/admin frame | **Sidebar:** black left rail |
| Exception detail | **Crossing lanes:** a "happened" axis over an "arrived" axis; late arrivals cross and turn red |

## 3. Visual system

### 3.1 Colour tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--fi-bg` | `#f4f1ea` | `#0c0a09` | page background |
| `--fi-surface` | `#fffdf8` | `#1c1917` | cards, tables, inputs |
| `--fi-ink` | `#1c1917` | `#e7e5e4` | text, 2px borders |
| `--fi-muted` | `#57534e` | `#a8a29e` | secondary text, labels |
| `--fi-rule` | `#d6d3d1` | `#44403c` | table row rules |
| `--fi-signal` | `#facc15` | `#facc15` | brand accent (safety yellow) |
| `--fi-rail` | `#1c1917` | `#000000` | sidebar, login panel, handheld status bar |
| `--fi-danger` | `#dc2626` | `#f87171` | negative balance, errors, late lane |
| `--fi-ok` | `#15803d` | `#4ade80` | synced / OK only |
| `--fi-resolved` | `#d6d3d1` (fill) | `#44403c` (fill) | resolved / superseded badges |

**Status colours are fixed across the app:**
- Red is `NEGATIVE_BALANCE`, errors and needs-attention.
- Yellow is `COUNT_VARIANCE`, `LATE_MOVEMENT`, `OVER_PICK`, `TRANSFER_STUCK`, `CLOCK_SKEW` and pending.
- Stone grey is resolved and superseded.
- Green is synced only.

**Badge text on filled status colours:**
- Light: white on `--fi-danger`, and `--fi-ink` on signal, resolved and ok fills.
- Dark: `#1c1917` on the danger, signal and ok fills (white on `#f87171` would fail AA), and `#e7e5e4` on the dark resolved fill `#44403c`.

**Contrast rule:** yellow is only ever a fill behind `--fi-ink` (`#1c1917`) text, or text on `--fi-rail`. Never use yellow text on a light background.

### 3.2 Typography

- **Font:** Archivo, self-hosted. Body text uses weights 400, 500 and 700. Uppercase headings, labels, tabs and buttons use the condensed width (Archivo's `wdth` axis, or `Archivo Narrow`, at 800).
- **No CDN.** The font files must be bundled and precached (§6.1). A Google Fonts link would break the offline handheld.
- **Numbers:** `font-variant-numeric: tabular-nums` on quantities, counts and bin codes.

### 3.3 Signature details

- Uppercase condensed page titles, labels, tabs and button text.
- 2px `--fi-ink` borders on cards, tables, inputs, drawers and modals. The radius is 6px.
- **The hazard stripe** is a repeating 45° yellow/black gradient. It appears in exactly three places:
  - the bottom of the login brand panel
  - the top edge of the sidebar rail
  - the handheld status bar

  It is a CSS class `fi-stripe`.
- **The wordmark** is "▲ Field Inventory", in uppercase condensed. It replaces any text logo. No image logo.
- **Focus ring:** a 2px `--fi-signal` outline with a 2px `--fi-ink` offset on every focusable element.

## 4. Theme implementation

- **`src/ui/theme.ts` exports `theme = createTheme({...})`:**
  - 10-shade colour tuples `stone` and `signal` (signal shade 4 = `#facc15`)
  - `primaryColor: 'signal'`, `primaryShade: 4`
  - `fontFamily` and `headings.fontFamily`
  - `defaultRadius: 'sm'` (6px)
  - component defaults:
    - Button: uppercase condensed. The primary variant is an ink fill with signal text.
    - Badge: square, 800 weight.
    - Table: 2px border, uppercase header.
    - Input, Select and PinInput: 2px ink border.
    - Drawer and Modal: 2px border, uppercase title.
- **`src/ui/tokens.css`** defines the §3.1 variables for `[data-mantine-color-scheme="light"]` and `[data-mantine-color-scheme="dark"]`, plus `.fi-stripe`, the focus ring, and the `tabular-nums` utility `fi-num`.
- **`src/ui/status.ts` exports `statusColor(kind)`.** `kind` is an exception type, or one of `'pending' | 'synced' | 'attention' | 'resolved'`. It returns the token name, and every badge uses it. Components must not hard-code status colours.
- **Wiring:**
  - `src/routes/__root.tsx` passes `theme` to `MantineProvider` and imports `tokens.css` and the font CSS.
  - `ColorSchemeScript defaultColorScheme="auto"` stays.
- No new styling library: no Tailwind and no CSS-in-JS beyond Mantine.

## 5. Screens

### 5.1 Logins

- **`src/ui/AuthSplit.tsx`:**
  - The left panel is `--fi-rail` and holds:
    - the wordmark, in `--fi-signal`
    - the pitch line *"Offline-first stock control. Every movement counted."*
    - a `fi-stripe` along the bottom
  - The right side is a `children` slot on `--fi-surface`.
  - Below 720px the panel collapses into a short header band with the wordmark and the stripe.
- **`/desk/login`** renders its existing form inside `AuthSplit`, titled "Supervisor sign-in". Fields, behaviour and error handling are unchanged.
- **`/h/login`** is a full-screen form with a `fi-stripe` at the top and the title "▲ Handheld". Fields and behaviour are unchanged.

### 5.2 Desk and admin frame

- **`src/ui/AppShellSidebar.tsx`** is built on Mantine `AppShell` with `navbar`:
  - Props: `brand` (wordmark), `switcher` (ReactNode), `links: { label, to, active }[]`, `footer` (ReactNode).
  - The rail is `--fi-rail` and about 200px wide, with a `fi-stripe` on its top edge.
  - The active link is a yellow pill with ink text. Inactive links are stone-200 text.
  - Below 900px the rail collapses. A top bar shows the wordmark and a burger button, and the rail opens as a drawer.
- **Desk layout** (`src/routes/w/$warehouseId/route.tsx`):
  - It renders `AppShellSidebar`.
  - The switcher is the existing warehouse select. The links are Exceptions, Stock, Pick lists and Counts.
  - The footer has an "Admin" link (admins only, as today), the user's name and `SignOutButton`.
  - `DeskNav.tsx` is retired or folded into it.
- **Admin layout** (`src/routes/admin/route.tsx`) renders the same `AppShellSidebar`:
  - The switcher slot shows an "Admin" title.
  - The links are the six admin sections.
  - The footer has "Back to desk", the user's name and Sign out.
- **Unchanged:** guards, `watchDeskAuth`, the query defaults, `DeskLayoutView` and `AdminLayoutView`, and their injectable `navigate`. Existing tests must keep passing.

### 5.3 Desk and admin content

- **Page titles:** uppercase condensed.
- **Exception count tiles** (`ExceptionFilters` or the list header):
  - each tile has a 2px ink border
  - a non-zero tile fills with its `statusColor`, e.g. "Negative 1" in red with white text
  - zero tiles stay outlined
- **Tables** (Exception, Stock, Ledger, PickList, CountTask and all admin tables):
  - 2px outer border, uppercase header labels in `--fi-muted`, `--fi-rule` row rules
  - quantities and bin codes are bold with `fi-num`
  - negative quantities use `--fi-danger`
- **Type badges** come from `statusColor`.
- **Drawers and modals:** 2px border and an uppercase title.
- **State components:**
  - `DeskErrorAlert` and `RefreshNote` are restyled only. `DeskErrorAlert` gets a red 2px border with an inline icon. Their logic and the R5 rules are unchanged.
  - Loading: Mantine `Skeleton` blocks with the same border language replace bare "Loading…" text, where a component shows one today.

### 5.4 Handheld

- **`ScreenFrame`:** the status bar is `--fi-rail` with a `fi-stripe` above it. It holds the screen title in uppercase signal text, plus `StatusPill`.
- **`StatusPill`:** green for synced, yellow for "N pending", red for revoked or needs-attention. The text, link targets and logic are unchanged.
- **Scan steps:** `ScanInput`, `ScanStep` and `QtyInput` get large inputs with 2px borders. The confirmed quantity in `DisplayedQty` is 40px, bold and `fi-num`.
- **Actions:** `ConfirmButton` is full width, at least 48px tall, with an ink fill and signal text (signal fill and ink text in dark).
- **`BlockingBanner`:** full width, rail background, signal text. When it shows is unchanged.

### 5.5 Exception detail: crossing lanes

- **`src/desk/components/ConflictLanes.tsx`** renders above the existing `Timeline` lists in `src/routes/w/$warehouseId/exceptions.$id.tsx`. The lists stay as the detailed, accessible view.
- **The pure function `laneLayout(movements)`** goes in `src/desk/conflict-lanes.ts`:
  - Input: the involved movements with `id`, `occurredAt`, `seq`, `type`, `delta` and `worker`.
  - Output: `{ id, happenedRank, arrivedRank, late, label }[]`.
  - `happenedRank` is the movement's position when sorted by `occurredAt`, with ties broken by `seq`. `arrivedRank` is its position by `seq`.
  - `late` is true iff some other movement happened after it but arrived before it (higher `happenedRank`, lower `arrivedRank`). Only the later-arriving side of an inverted pair is late. In the stale-count example, the move is late and the count is not.
- **Rendering:** hand-rolled SVG, no chart library.
  - Two horizontal axes, labelled "HAPPENED" (top) and "ARRIVED" (bottom).
  - One line per movement, drawn from `happenedRank` on the top axis to `arrivedRank` on the bottom axis.
  - Late lines are `--fi-danger` with a "late" label. Others are `--fi-muted`.
  - Endpoint dots carry `type delta · worker` labels.
  - The SVG has `role="img"` and an `aria-label` summarising the late arrivals.
- **Fallback:** above 12 involved movements, it renders the note "Too many movements to draw — see the lists below." instead of the SVG.

## 6. Cross-cutting

### 6.1 Offline fonts

- Add `@fontsource-variable/archivo`, or `@fontsource/archivo` plus the condensed weights, and import it in `__root.tsx`.
- Extend `PRECACHE_GLOBS` in `src/pwa-options.ts` with `woff2`. The current pattern `'**/*.{js,css,wasm,svg,png,ico,webmanifest}'` does not include fonts.
- Update the PWA config unit test to match.

### 6.2 Accessibility

- AA contrast for every text/background token pair in both schemes is enforced by a unit test (§8).
- The visible focus ring is everywhere (§3.3).
- Touch targets on the handheld are at least 48px.
- `ConflictLanes` has a text alternative, and the lists remain.

## 7. Copy changes (the only ones)

- **Login pitch line:** "Offline-first stock control. Every movement counted."
- **Login form titles:** "Supervisor sign-in" (desk) and "▲ Handheld" (handheld).
- **Empty states** (exceptions list, stock, pick lists, counts, admin tables): keep each component's existing message and add a small "▲" glyph. One exception: the exceptions list's empty message becomes "No open exceptions. Floor's clear."
- **ConflictLanes fallback:** "Too many movements to draw — see the lists below."

## 8. Testing

- **Existing tests:** all existing unit tests (729) and the 4 non-Turso e2e tests stay green. Copy and roles are unchanged except for §7, so any test that asserts the old exceptions empty-state text is updated to the new one, and that is the only allowed assertion change.
- **New unit tests:**
  - `laneLayout`:
    - ranks by `occurredAt`, with ties broken by `seq`
    - `late` iff inverted, including the plan 5 stale-count example: seed adjust, then Ana's move happened before Bruno's count but arrived after it, so only the move is late
    - no lates when arrival order equals physical order
  - `ConflictLanes`: renders one line per movement, renders the fallback above 12, and has the `aria-label`.
  - `statusColor`: maps every exception type and state.
  - Contrast: computes the WCAG contrast ratio for each text/background pair from §3.1 in both schemes and asserts ≥ 4.5 for body text and ≥ 3 for large or bold UI text.
  - `AppShellSidebar`: marks the active link (`aria-current="page"`) and shows the burger button below the breakpoint.
  - The PWA config test includes `woff2`.
- **E2E:** `offline-shell.spec.ts` must still pass. That proves the shell, fonts included, loads offline.
- **Manual visual pass:** in the browser pane, check light and dark across the desk login, a desk list, exception detail, admin, handheld login, and a handheld scan screen. Attach the screenshots to the final report. There is no screenshot-diff suite.

## 9. Out of scope

- An image logo, illustrations or animations.
- Rearranging page content beyond the frame.
- Any change to behaviour, queries, routes, server code or permissions.
- Copy changes other than §7.
- Turso e2e runs, which are deferred separately.
