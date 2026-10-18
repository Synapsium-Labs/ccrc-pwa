# ccrc's two skins: Refined and Instrument, on one identity core and one data model (design)

**Status:** DRAFT rev 1 (2026-10-15). It records the operator's rulings of 2026-10-15 (§1.1). Rev 1 applies the design review's thirteen corrections and records the coordinator's rulings on rev 0's seven open questions (§12).
**Date:** 2026-10-15 · **Base:** `origin/main` `a3cebde1` (#419, the design system and its guards).
**Plan:** `docs/superpowers/plans/2026-10-15-ccrc-skins-foundations.md`. It covers W0 (the foundations) and the W1 items in its scope, both those that land now and those gated on an in-flight merge, each gated one with its own header (§10). It is the single home of this design's deviation numbers, D-5093 to D-5104 (§13). Later waves get their own plans, which cite these numbers and never redefine them.
**Source:** the 2026-10-15 UI audit. It took 932 captures of `a3cebde1` at phone, laptop and wide widths in all twelve palettes and in Storybook, ran three visual and UX audits and a feature-gap inventory, and drew three directional mocks: A "Refined Phosphor", B "Instrument Panel" and C "Soft Glass". The audit material is held outside this tree. This document restates every fact it relies on and cites the code for each.
**Related:** #419 (`@ccrc/ui`), #402 (the Docs reader), #384 (the collector switch in Settings), #405 (the terminal drawer spec), #422 (framer-motion 14), #424 (TypeScript 7).

**Measurements.** "Measured" means computed at `a3cebde1` with the generator's own colour maths (`ui/design/make-themes.mjs`: WCAG 2.1 relative luminance, and OKLab for lightness), applied to the values in `ui/src/styles/tokens.css`. Code is cited by file and by function, constant or selector.

## In short

- **Two skins, one product.** *Refined* (A) evolves today's Phosphor & Ink into a roomy, touch-first console. *Instrument* (B) is a dense, keyboard-first operations panel. Both are built in full and can be switched at any time. Each borrows the other's best parts (§6).
- **The skin is a third axis**, next to the palette (twelve of them) and light/dark. It is the attribute `data-skin` on `<html>`, chosen under Settings → Appearance and remembered per device. On first run it follows the device, resolved once per page load: Refined on a phone or tablet, Instrument on a desktop (§7).
- **An identity core never varies** (§3): the `❯ ccrc` wordmark and caret, the phosphor accent and glow-means-life, lamp dots that pair a glyph with a word, dark wells, the Geist pair, the lane hues, the twelve palettes, and the mono/sans rule of voice. A skin varies density, structure and chrome, nothing else. A guard enforces this: a skin's token block may hold no colour, and may only override tokens from a closed list (§3.2, §4).
- **One data model.** Stores, words, planners, action hooks, sheets and flows stay single. A skin contributes layout components only, chosen by `useSkin()`. Business logic is never forked (§5).
- **Foundations first.** W0 lands the axis, the guard, the fonts, the ink tiers, one shared meter, danger buttons, per-skin verification and the per-device default. It also lands the audit's first-batch items that collide with nothing in flight: the quick wins, and the data halves of the integrity strip and the version and cost readouts. W1 lands the shared structure: icons, hover and selection, the command palette, the type and density roles adopted by the shared primitives, the page scaffold, the picker, and centred dialogs once the in-flight sheet work lands. W2 builds the two shells, W3 the screens, W4 the feature gaps (§10).

## 1. Rulings and goals

### 1.1 Operator rulings (2026-10-15)

1. **Build both A and B as switchable skins,** "and borrow the good things from each other across A and B - have two themes basically".
2. **Defaults: A on phone, B on desktop.** The operator: "makes sense, but we need the same recognisable "look" across both so that you always know you're using CCRC". So an **identity core** is fixed across skins (§3). Skins vary density, structure and chrome only.
3. **The skin is orthogonal** to the palette and to light/dark. It is chosen in Settings → Appearance, remembered per device, and on first run defaults by device (phone or coarse pointer → A, desktop → B).
4. **B keeps its own phone navigation:** the five-tab bottom bar and the in-session Tasks / Mail / PR / Log quick bar. A keeps its one-row phone header.
5. **Borrowed into both:** the ⌘K command palette and keyboard shortcuts; the inspector (permanent in B, at ≥1600 in A); Needs you / Working / Done grouping with ASK / ALLOW / FAULT / SIGN-IN reason tags; lucide icons; plain-language tool summaries; centred dialogs at ≥900; danger button variants; hover and pressed states; and C's inline-answer "Needs you" cards.
6. **Fonts:** Geist and Geist Mono, self-hosted with the app. No external requests, and the OFL licence notice ships with them.
7. **Start the shared foundations now.** Each foundations piece lands as its own PR, merged when green and checked in both skins at every width (phone 360–438, laptop 1280–1470, wide 1920 and up), in dark and light.
8. **Standing rules:** improve on what exists rather than reinvent, and every UI change works at every width.

### 1.2 Goals

- G1. Both skins are complete products at every width, not a skin and a demo.
- G2. A user switching skins always knows it is ccrc: the identity core renders identically in both (§3).
- G3. One source of truth for behaviour. A fix to a store, a word function or a flow fixes both skins.
- G4. Every palette, in both modes, works in both skins, and the contrast gate keeps ruling on all of them without a second run per skin (§8.2).
- G5. The test surface grows by the layout components and no more. Behaviour tests are not duplicated per skin (§11).

### 1.3 Non-goals

- No third skin. C (Soft Glass) is not built; its one adopted idea, the inline-answer card, is shared (§6).
- No per-palette tuning per skin. A skin owns no colour.
- No change to the server, the agent, ccd, a wire frame or a route in W0 or W1. Features that need the server (§10, W4) come with their own designs.
- No user-defined skins and no token editor.

## 2. What exists today (measured at `a3cebde1`)

**Tokens and palettes.** `ui/src/styles/tokens.css` declares Phosphor & Ink dark as `:root` and Phosphor Daylight as `[data-theme='light']`, both hand-tuned. Ten more palettes are `[data-theme='<id>']` blocks generated from seeds by `ui/design/make-themes.mjs` (`npm run themes`, checked by `npm run themes:check`). `ui/src/styles/theme.css` maps tokens into Tailwind utilities through `@theme inline` and defines nothing. `ui/src/styles/themes.ts` is the one hand-typed catalogue (`THEMES`, `resolveTheme`, `applyTheme`). `pwa/src/lib/theme.ts` stores the choice (`ccrc-theme`), and `pwa/index.html` stamps it before first paint.

**The gates.**
- The contrast gate: `pwa/design/audit.mjs` parses every stylesheet under `pwa/src` and `ui/src`, and `pwa/design/contrast-check.mjs` holds the token-pair contract measured for every palette.
- Bindings and censuses: `pwa/test/theme-catalogue.test.ts`, `theme-bridge.test.ts`, `css-vars.test.ts`, `design-system-boundary.test.ts`, `ui-package-boundary.test.ts`, and the control, shape, markup and literal censuses.
- Storybook: `npm run build-storybook` runs on the required `test (pwa)` leg, and the advisory `storybook-a11y` job runs axe over every story in the default palette.

**Defects the audit measured that the foundations fix.**

1. **Ink tiers collapse.** `ink-primary`, `ink-secondary` and `ink-tertiary` are fitted from the same seed against the same floor, so when the seed already passes, all three come out equal. OKLab lightness distance between primary and tertiary (ΔL):

   | palette | ΔL(primary, tertiary) | | palette | ΔL(primary, tertiary) |
   |---|---|---|---|---|
   | Phosphor & Ink | 0.294 | | Gruvbox Dark | 0.003 |
   | Phosphor Daylight | 0.274 | | One Dark | 0.085 |
   | Nord | 0.000 | | Solarized Dark | 0.084 |
   | Tokyo Night | 0.000 | | GitHub Light | 0.000 |
   | Dracula | 0.000 | | Solarized Light | 0.067 |
   | Catppuccin Mocha | 0.012 | | Catppuccin Latte | 0.000 |

   Five palettes are fully collapsed, two nearly so, and three sit below 0.12. Measured as reachable: with tertiary held at 4.9:1 or more on every ground and chroma allowed to bleed, every generated palette can reach a ΔL between 0.180 (Nord) and 0.532 (GitHub Light). Primary cannot reach 9:1 in Nord (8.58) or Gruvbox Dark (8.77), so the rule lifts primary toward 9:1 only as far as the gamut allows.
2. **The account meter leaves the palette.** `.acct-meter` (in `pwa/src/fleet/fleet.css`) uses `--bg-well` as its track, so the track is black in Daylight. Its critical fill is the literal `#f85149`, which belongs to no palette and is identical in both modes. That rule's own comment records it as a known defect, kept for a later change. Three components draw one idea:
   - `AccountMeterRow` draws `.acct-meter` at 5px (`height: 5px` in `fleet.css`, and again in `shell.css` under `.shell-accounts`);
   - `LimitBar` (`ui/src/primitives/limit-bar.tsx`) draws its track, `LIMIT_TRACK`, on `--limit-track` at 4px (`h-1`);
   - `AccountRow`'s `Gauge` (`pwa/src/fleet/AccountRow.tsx`, the swap and new-session pickers' row) builds a third bar by hand from `LIMIT_TRACK` and `fillVariants`.

   The app sheets are unlayered, so `.acct-meter`'s `height` beats any utility a shared meter sets.
3. **No danger treatment.** Archive, Abandon, Reap and the forced archive are solid "go" green `Button variant="primary"` (`AbandonSheet.tsx`, `ArchiveSheet.tsx`, `ArchiveConflictSheet.tsx`, `ReapSheet.tsx`). `ArchiveAllPlane.tsx` confirms through `QuickConfirm`, which has no tone. Sign out (`AuthSection.tsx`) is primary too. So is the most destructive control in the app, the fleet host's Reboot (`FleetHostBanner.tsx`), which restarts the whole fleet box; its `QuickConfirm` has no tone either.
   - Measured: every palette's `--status-dead` carries one of the two plain inks at 4.63:1 or better. Dark palettes take a near-black ink, light palettes white. The tightest are Solarized Light (white 4.63) and GitHub Light (white 4.66).
4. **No hover anywhere it matters.** `fleet.css` and every `@ccrc/ui` primitive declare no `:hover` rule. The only ones are four in `chat.css`, one in `task-card.css` and two in `prose.css`.
5. **The selected fleet row is a reverse-video slab.** `.sess-line--active` paints `--ink-primary` with `--bg-page` ink. Forty-three rules in `fleet.css` keep its meta legible, and they do it by turning every hue grey.
6. **Colour emoji in a two-hue UI.**
   - `🔑` on the accounts door (`FleetHead.tsx`).
   - `🔔` and `🔕` (`NotificationBell.tsx`).
   - `✋` (`HotFilesStrip.tsx`).
   - `🤖` (`SessionHeader.tsx`).
   - `❓` (the ask card in `tool-card.tsx`).
   - The text glyphs `⚙ ✉ ⚠` (`ui/src/lib/text.ts`), which some platforms draw as emoji.
   - `components.json` names lucide, but nothing installs it.
7. **The type stack varies by OS.** `--family-ui` and `--family-mono` are system stacks only.
8. **One layout per width.** `pwa/src/styles/shell.css` swaps at 900px: below it the fleet or the detail fills the screen, and above it a fleet sidebar sits beside a detail pane under a full-width accounts strip. Every sheet is a bottom drawer at every width (`ui/src/primitives/sheet.tsx`).
9. **Sizes are scale steps, never roles.** The app sheets size everything from the scales: 206 `var(--fs-*)` and 322 `var(--sp-*)` uses across `fleet.css`, `chat.css` and `shell.css`. Nineteen of the non-story files in `ui/src/primitives` and `ui/src/components` carry a scale utility (a text size, a numeric padding, gap or margin, or a bracketed height). `ListRow` hard-codes `min-h-[52px]`, and its header argues against a token for it. So a density or type role declared today would reach no existing component.
10. **Two server facts the PWA drops.**
    - The server sends a `divergence` frame on `/ws/fleet` (`server.ts`, `onDivergence`) carrying the registry census of `server/src/divergence.ts`. The fleet store's `asFleetMsg` has no arm for it, so the frame is dropped. The server sends it only when the census changes, with no cold start on connect.
    - Every `FleetSession` carries `version` (Claude Code's own) and `usage.cost` (the statusline's `cost.total_cost_usd`). Nothing in `pwa/src` reads either.
11. **Small defects** (the audit's quick wins).
    - No `accent-color`, so native checkboxes and radios draw in the browser's blue.
    - No themed scrollbars. Each palette sets `color-scheme`, so a scrollbar is the browser's own grey for the mode, never the palette's edge colours.
    - A full-width `Button` (`size: 'full'`) has no side padding, so a wrapped label touches the edges.
    - The wordmark can wrap between `❯` and `ccrc` in a narrow head.
    - The passkey list reads "added 5m ago ago": `AuthSection.tsx` appends " ago" to `formatAge`, which already ends in "ago" (or reads "just now").
    - A focused text field draws two cues at once: `TEXT_INPUT` carries both `focus:border-phosphor` and `FOCUS_RING`, and `base.css`'s unlayered `:focus-visible` outline draws the ring in the app anyway. The sign-in screen's autofocused passphrase shows it first.
    - The Accounts screen sets two prose sentences in mono (`.accounts-projection` and `.accounts-disabled-note`), against the rule of voice.
12. **Jump to latest covers a failed send.** `.jump-latest` (`chat.css`) is absolutely placed over the bottom of the list, so it covers whatever the last visible row holds. The audit measured it covering a failed send's Retry and Discard at 390.

## 3. The identity core

### 3.1 What never varies between skins

| Element | Where it lives | The rule |
|---|---|---|
| The wordmark `❯ ccrc` | today `.wordmark` and `.wordmark::before` in `fleet.css`. W1 makes it a `Wordmark` primitive in `@ccrc/ui` (§10). | The `❯` (U+276F) is painted in `--accent`, then `ccrc` in mono at medium weight. Every shell renders it, in its top-left. |
| The `❯` caret as "selected / acting" | `OptionRow`'s preselect glyph, the composer caret, `PickSheet` and `DialogSheet` rows, the working line, and the page title (`PageScaffold`, D-5102) | One glyph and one meaning in both skins. A skin never introduces a second cursor glyph. Page titles carry it in both skins (§12, O3). |
| Phosphor accent | `--accent`, `--accent-tint`, `--accent-on-well`, `--ink-on-accent` | The accent marks commit actions, the active selection and living status, nothing else. |
| Glow means life | `--glow-*`, `--breathe-period`, `--pulse-period`, `StatusDot` | Only `busy` and `attention` emit light, in both skins. B's tighter lamp glow is the same token family at the same rhythm. |
| Lamp dots, glyph plus word | `StatusDot` (`ui/src/primitives/status-dot.tsx`), `--lamp-size`, `--r-full` | A status always carries a glyph and a word. Lamps are round in both skins. |
| Dark wells | `--bg-well`, `--ink-on-well`, the `--syn-*` palette, `Well`, the terminal drawer's glass | Terminals and code sit in wells that stay dark in every palette, in both skins. |
| The Geist pair | `--family-ui`, `--family-mono` (Geist and Geist Mono, self-hosted, D-5095) | Both skins set every glyph in these two families. |
| Lane hues | `--acct-*`, the `[data-acct]` rebinding, account names in mono | Same hue per lane, same mono name, never a glow. |
| The twelve palettes, light and dark | `[data-theme]` blocks, `THEMES` | Every palette renders in both skins. The skin cannot add, remove or retint one. |
| The rule of voice | mono for what the machine says, sans for prose, tabular readouts | B is more mono-forward in its chrome (tabs, counts, keys), but prose stays sans and readouts stay tabular in both. |
| Accessibility floors | `--tap-min` (44px), `--fs-input` (16px), `--fs-2xs` (11px) as the smallest type, `prefers-reduced-motion` | B's density never goes below them: rows are 44px tall unless the primary pointer is fine, and nothing is set below 11px. |

### 3.2 The guard (D-5094)

There are two halves, each a test that goes red when the core is breached.

**The token half (W0, plan Task 2).** `pwa/test/skin-identity.test.ts` reads `ui/src/styles/skins.css` and asserts the following:
- Every declaration sits inside a `:root[data-skin='<id>']` block (optionally inside an `@media` block). The ids are exactly the non-default skins in the catalogue, and Refined has no block, because Refined is `:root`.
- Every declared property is in the catalogue's closed list `SKIN_TOKENS` (§4.2).
- Every `SKIN_TOKENS` member has a `:root` default in `tokens.css`.
- The file holds no colour literal: no hex, `rgb()`, `hsl()`, `oklch()`, `color-mix()` or named colour.
- **No colour by reference either.** Every `var()` in the file names a token from its class's allowlist, and `currentColor` appears nowhere:
  - elevation: only `--edge-subtle` and `--edge-strong`;
  - type: only `--fs-*`, `--ls-*`, `--weight-*`, `--family-ui` and `--family-mono`;
  - density: only `--sp-*`;
  - radius, meter and motion: no `var()` at all (lengths, counts and durations).

  So `--elev-card: 0 0 8px var(--accent)`, which would put a glow on every card and break glow-means-life, is red.
- Type roles point at the type scale (`var(--fs-<step>)`), and family roles at the pair (`var(--family-ui)` or `var(--family-mono)`).
- Any motion token (`--dur-*`) is declared only inside `@media (prefers-reduced-motion: no-preference)`. A `:root[data-skin]` selector out-specifies `:root`'s own reduced-motion block, so a motion override outside that media query would silently undo reduced motion. This is the one hazard the skin axis adds to an existing rule.
- A tap-bearing density token (`--row-h`, and any later one the catalogue marks so) is never declared below `--tap-min` outside a `@media (pointer: fine)` block.
- No palette block in `tokens.css` declares a type, density, radius, meter or motion skin token. Elevation is the one shared class (§4.3).
- `design/audit.mjs`'s stylesheet walk lists `ui/src/styles/skins.css` by that exact relative path, so a colour rule planted there would be measured. This guards the guard.
- There is no `!important`.

Three censuses in the same file keep the skin out of everything else, each with a registry asserted in both directions (a listed file that no longer matches is stale, and red):
- **`data-skin` appears in no other stylesheet.** Under `pwa/src` and `ui/src`, only `skins.css` may contain it. A rule such as `[data-skin='instrument'] .dot { border-radius: 2px }` in `fleet.css` would square the lamps, and the contrast gate keys rules by selector alone, so nothing else would notice.
- **`data-skin` appears in no other source.** In TS, TSX and HTML under `pwa/src`, `ui/src`, `ui/.storybook` and `pwa/index.html`, only `skins.ts`, `pwa/src/lib/skin.ts` and `index.html` may contain it.
- **`useSkin(` is called only where registered.** In W0 the registry is empty (the hook's own file is the definition). Task 12b adds the picker. W2 adds `app.tsx`'s one branch (§5.2) and the skin directories' own files.

**The element half (W2, cited from W2's plan).** `pwa/test/skin-boundary.test.ts` reads `pwa/src/skins/<id>/**` and asserts the following:
- Each shell module renders `Wordmark` and draws status only through `StatusDot`.
- No file under a skin directory declares a colour literal, a `font-family`, a `box-shadow` that is not a `var(--elev-*)` or `var(--glow-*)` token, or a `❯` outside `Wordmark`, `OptionRow` and the composer.
- No skin directory imports another skin's, or imports `lib/api` (§5.2).

The element half needs the shells to scan. Written before they exist, it would be a guard over an empty directory, and this tree's own rule is that a scan that sees nothing must go red.

## 4. Token architecture: skin × palette × mode

### 4.1 Three axes, three owners

| Axis | Attribute on `<html>` | Owner | Values |
|---|---|---|---|
| Palette and mode | `data-theme` (absent for Phosphor & Ink) | `tokens.css`: `:root`, `[data-theme='light']` and the generated blocks | twelve, plus "Follow system" |
| Skin | `data-skin` (always stamped) | `skins.css`: `:root` holds Refined's values in `tokens.css`, and `:root[data-skin='instrument']` holds Instrument's overrides | `refined`, `instrument`, plus "Match this device" |
| Account | `data-acct` (on a screen root) | `tokens.css` rebinding rules | the six hues and `unknown` |

**Why the skin attribute is always stamped, while Phosphor's palette is stamped by absence.** W2's skin stylesheets select on their own skin-prefixed classes (§4.4), and the boot path must be able to tell "no choice yet" from "Refined". An absent attribute still renders Refined, because `:root` holds Refined's values: a page that runs no script, or paints before the bundle, is a correct Refined page.

**Specificity.** `:root[data-skin='instrument']` is (0,2,0). It outranks every `[data-theme='…']` block (0,1,0) wherever it appears in the cascade, so the order of `tokens.css` and `skins.css` cannot decide a tie. That is how B's `--elev-card: none` wins in every palette, even though palette blocks declare `--elev-card` themselves.

**Load order.** `theme.css` imports `tokens.css`, then `skins.css`, both before any rule, as its header requires. The Geist pair's two `@font-face` rules (D-5095) sit at the top of `tokens.css`, not in a sheet of their own (D-5450).

### 4.2 What a skin may override (`SKIN_TOKENS`)

A skin chooses a value from a scale. It never mints a size or a colour. The values below are this design's starting point. Plan Task 1 declares the type and density roles, the radii, `--elev-card` and the motion values. The meter tokens land with Task 5, Refined's radius change with Task 11, and `--elev-pop` with the sheet arm. The plan's File Structure says which task owns each.

| Class | Token | Refined (A, `:root`) | Instrument (B) |
|---|---|---|---|
| type | `--fs-ui` (controls, rows) | `var(--fs-base)` 15 | `var(--fs-base)` 15 below 900; `var(--fs-sm)` 13 at ≥900 |
| type | `--fs-prose` (chat and Markdown) | `var(--fs-base)` 15 | 15 below 900; `var(--fs-md)` 14 at ≥900 |
| type | `--fs-meta` (timestamps, chips) | `var(--fs-xs)` 12 | `var(--fs-2xs)` 11 |
| type | `--fs-page` (screen title) | `var(--fs-xl)` 20; `var(--fs-2xl)` 24 at ≥900 | `var(--fs-md)` 14 |
| type | `--fs-section`, `--weight-section`, `--family-section`, `--case-section`, `--ls-section` | 15, 600, sans, none, `var(--ls-tight)` | 11, 500, mono, uppercase, `var(--ls-caps)` |
| density | `--gutter` | 16; 24 at ≥900; 32 at ≥1600 | 12; 14 at ≥900 |
| density | `--row-h` | 52 (today's `ListRow`) | 44 by default; 32 only inside `@media (pointer: fine)`, so `pointer: none` and coarse devices keep 44 |
| density | `--pad-card`, `--gap-section` | `var(--sp-4)`, `var(--sp-8)` | `var(--sp-3)`, `var(--sp-5)` |
| density | `--page-max`, `--page-max-wide` | 760, 1120 | 960, `none` |
| density | `--measure-chat` | 780; 820 at ≥1600 | 860 (the log column) |
| radius | `--r-sm`, `--r-md`, `--r-lg`, `--r-xl` | 6, 10, 14, 20. Today 16 and 22; the change lands with the page scaffold (D-5102). | 3, 5, 8, 12 |
| elevation | `--elev-card`, `--elev-sheet` (and `--elev-pop` once W1 adds it) | the palette's own | `none`, or `0 0 0 1px var(--edge-strong)`. Depth comes from grounds and hairlines. |
| meter | `--meter-h`, `--meter-segments`, `--meter-gap` | 5px, 1, 0px (continuous) | 8px, 10, 2px (LED segments) |
| motion, under `no-preference` only | `--dur-fast`, `--dur-base`, `--dur-slow` | today's 180 / 240 / 320ms | 120ms each. `--dur-sheet` and `--curve-spring` are untouched, so phone sheets keep their spring. |

The type scale gains one step, `--fs-md: 14px`, and the tracking scale gains `--ls-tight: -0.011em`. Both are scale tokens: shared, and not overridable.

**Who reads the roles, and when.** A role reaches the screen only through a component that reads it, and today none does (§2 item 9). So the roles arrive in three steps:
- **Task 1 (W0)** declares them, maps them into Tailwind (`text-ui`, `text-meta`, `min-h-row`, `p-card`, `px-gutter` and the rest), and teaches `cn()`'s merge their names.
- **Task 14 (W1)** moves the shared primitives (`Button`, `ListRow`, `Chip`, `Keycap`, `Door`, `Radio`) onto them. A census keeps a scale size from coming back. Every move is pixel-neutral in Refined, because a role's Refined value equals the step it replaces.
- **Task 14b (W1, gated)** does the same for the rows, chips and sheet copy in `fleet.css`, `shell.css` and `chat.css`, for `Sheet`'s body padding, and for `OptionRow`. Those files, or the shape census that clusters app rules by their declared values, are frozen by the ask sheet half and drawer stage 1.
- **Task 11** builds the page scaffold on them from the start.

Until Task 14 lands, Instrument varies only radii, card elevation, motion and meters. It is a token preview of B, not a dense layout. Between Tasks 14 and 14b, the primitives are dense and the app sheets' own rows are not.

`--row-h` replaces `ListRow`'s literal 52px. That component's header argues that a `--list-row` token "would imply the two numbers move together" with `--tap-min`. They do not: `--row-h` is a density role whose floor is `--tap-min` everywhere except inside `(pointer: fine)`, and the guard holds that floor (§3.2). Recorded under D-5093.

### 4.3 What a skin may not override, and why

- **Every colour token** (`--bg-*`, `--edge-*`, `--ink-*`, `--accent*`, `--status-*`, `--acct-*`, `--limit-*`, `--diff-*`, `--syn-*`, `--well-*`, `--pr-*`, `--scrim`, and W1's `--bg-hover`, `--bg-pressed` and `--ink-on-danger`). Colour is the palette axis, and the contrast gate measures it once per palette (§8.2).
- **`--glow-*` and the breathing periods.** Glow means life, and its rhythm is part of it.
- **`--family-ui` and `--family-mono`.** The Geist pair. A skin re-points a role (`--family-section`) at one of the two, never at a third font.
- **The scales**: `--sp-*`, `--fs-*` and `--ls-*` themselves. A skin picks steps; it never moves the grid.
- **`--r-full` and `--lamp-size`.** Lamps and pills stay round.
- **The floors**: `--tap-min`, `--fs-input` and `--fs-2xs`.
- **Behaviour tokens**: `--z-*`, `--safe-*`, `--composer-h`.
- **Elevation is the one shared class.** Its values carry shadow colour and belong to the palette (each palette block declares `--elev-card` and `--elev-sheet`). A skin may only *replace* one, with `none` or with a hairline recipe built from `var(--edge-*)`.

### 4.4 Two channels, and only two

1. **The token channel:** `skins.css`. Non-colour values only, guarded (§3.2).
2. **The structure channel:** skin-specific components and their stylesheets, under `pwa/src/skins/<id>/` (W2). These are ordinary rules on skin-prefixed classes (`ref-*`, `ins-*`), reading palette tokens. `audit.mjs` already walks every stylesheet under `pwa/src`, so the contrast gate measures them like any other rule. They select on their own classes, not on `[data-skin]`: the owning component only renders in its skin, and an attribute-qualified selector would add an ancestor that the gate's ground recovery has no reason to know. The `data-skin` census (§3.2) holds this from W0 on.

A shared component never branches on the skin to change a colour. Where a shared component's look differs by skin, the difference is a token in channel 1. Where its structure differs, it is two components in channel 2.

## 5. One data model, two layouts

### 5.1 What is shared and what is skin-specific

| Shared (one implementation, tested once) | Skin-specific (layout only) |
|---|---|
| `pwa/src/stores/` (`fleet.ts`, `session.ts`) and `pwa/src/lib/` (api, ws, router, accounts, models, feed, theme, skin) | the shell: A's app bar plus sidebar; B's icon rail, list column, inspector and status bar |
| every `*Words.ts`, `sortFleet`, `groupFleet`, `nestFleet`, `movePlan` and `foldState`, and W1's reason tags and status grouping | how the fleet list presents those groups: A's project cards with a filter rail; B's status-grouped table with a status/project toggle |
| every action hook (`useActionsSheet`, `useMarkerToggle`, `useProgramAttempt`, `useProjectRows`, `useUpdatesView`, …) | where an action's door sits: A's ⋯ menu and FAB; B's row keys, top-bar `+` and status bar |
| every sheet and flow body (`SwapSheet`, `ArchiveSheet`, `NewSessionSheet`, `DialogSheet`, `EnvelopeSheet`, `PrSheet`, …). The container (bottom sheet, or centred dialog at ≥900) is decided by `Sheet` from the width, not by the skin. | phone navigation: A's one-row header; B's tab bar and quick bar |
| `chatItems`, the per-tool summariser (W2), the composer's logic and the terminal drawer | how a transcript item renders: A's bubbles and grouped tool rows; B's time-gutter log rows |
| inspector sections (tasks, mail, PR, routing, meter, version and cost, history), and the pure models behind them, including the integrity census and the session facts (D-5104) | where the inspector sits: A's rail at ≥1600; B's column, overlay or quick-bar sheets |
| the secondary screens (Inbox, Runs, Accounts, Archive, Settings), built on `PageScaffold` and `Section`, whose density follows the tokens | B's master-detail split for Inbox, Runs, Accounts and Settings (the list column holds the screen's list, and the detail holds the selection) |
| the command registry (D-5103) | how the palette is reached: a shortcut and an app-bar icon in A; a visible command field in B's top bar |

### 5.2 `useSkin()` and the switch points

- `pwa/src/lib/skin.ts` (D-5093) owns the stored choice, `initSkin()` (boot), `setSkin()` (the picker and the palette) and `useSkin()`, a `useSyncExternalStore` hook over a module-level emitter, which answers `'refined'` or `'instrument'`. It reads the device rule once, at `initSkin()`, and never subscribes to it (§7), so the skin changes only when a person chooses.
- W2 adds `pwa/src/skins/refined/` and `pwa/src/skins/instrument/`. Each exports a `Shell`, a `FleetList`, a `SessionChrome`, a `TranscriptRow`, an `Inspector` placement and a `PhoneNav`. `pwa/src/skins/index.ts` maps a skin id to its set, and `app.tsx` renders `SKIN_SETS[useSkin()].Shell` with the shared route ladder passed in as a slot. This is the only branch on the skin in shared code. The `useSkin(` census (§3.2, W0) counts it, and the element half (W2) checks the skin directories.
- **Boundary rules for a skin directory** (W2's guard):
  - It may import from `stores/`, `lib/` (not `lib/api`), the pure modules and action hooks under `fleet/` and `session/`, and `@ccrc/ui`.
  - It never imports the other skin's directory.
  - It never calls the network. A skin reaches every action through a shared hook, so the PWA's two skins can never disagree about what an action does.

### 5.3 Per-screen structure, by skin and width

The widths: phone is under 900 (verified at 360, 390 and 438); laptop is 900 to 1599 (verified at 1280 and 1440 to 1470); wide is 1600 and up (verified at 1920).

**Shell**

| Width | Refined (A) | Instrument (B) |
|---|---|---|
| phone | Today's full-screen swap: the fleet or a detail fills the screen. | The same swap, under a top bar, with the five-tab bottom bar (Fleet · Inbox · Runs · Accounts · More). |
| laptop | A 56px app bar: wordmark; tabs (Fleet · Inbox · Runs · Accounts, plus Docs once #402 lands) with badges and an active state; compact lane gauges; Bell; Settings; `+ New session`. Below it, a fleet-only sidebar at `clamp(320px, 24vw, 400px)` and the detail pane. Global banners span the width under the bar, two at most, plus "+n more". | A 52px icon rail (Fleet, Inbox, Runs, Accounts, Archive, two reserved slots for Docs and Activity, then Bell and Settings; see "Mock B's items" below). A top bar holds a breadcrumb, the ⌘K command field and LED lane meters. Below it, a 340px list column, the detail pane, and a 24px status bar: agent link · build · counts · ⌘K · `?`. |
| wide | Sidebar at 400; the detail holds an 820 reading column and a 320 inspector rail. | Rail 52, list 420, detail, and a permanent 320 inspector. |

**Fleet**

| Width | Refined | Instrument |
|---|---|---|
| phone | A one-row header (wordmark, then Inbox with its badge, Runs, Settings and Account icon doors) and a one-line subtitle ("19 sessions · 4 waiting · 5 runs"). A 2×2 grid of compact lane gauges; a single-select filter rail (All · Attention · Working · Done · Idle · More) with unseen dots; project cards with an "N waiting" pill; an extended `+ New` FAB at bottom right. The first session row sits at about 38% of the screen height, against 68% today. | A top bar (wordmark, search, Bell, `+`); an LED lane strip; underline tabs (Needs you · Working · Done · All); grouped rows. "Needs you" rows carry an ASK, ALLOW, FAULT or SIGN-IN reason tag and the question's first line. |
| laptop | The sidebar holds "❯ Fleet · N sessions · N waiting", a chip rail (runs, claims, archive size) and the filter rail, then the project cards. No FAB; the app bar's button and the `N` shortcut take its place. | The list column holds a table grouped by status (Needs you, Working, Done, then folded Idle, Cleanup, Archived and Dead), with a status/project toggle. Each row shows a lamp, the title, the project, the lane and the age. |
| wide | Same, at 400. | Same, at 420. |

**Session**

| Width | Refined | Instrument |
|---|---|---|
| phone | Back, a title row and one scrolling chip rail (status, lane, model, effort, branch, PR, repo, ctx). The header is about 96px tall, against 356 today. Grouped tool rows; tasks and mail strips in one container; Stop takes the send slot while a turn runs. | A title and status line, then a mono caps chip line. The log transcript has a time gutter. The quick bar (Tasks · Mail · PR · Log) above the composer opens each as a sheet. Stop sits in the composer. |
| laptop | A 780 reading column in the pane; key hints under the composer. | A header row (title, status, Terminal `T`, History `H`, ⋯); the log transcript with YOU and CLAUDE gutters; the inspector as an `I` overlay; key hints on every action. |
| wide | 820 column plus the inspector rail. | The permanent inspector. |

**Inspector** (shared sections; skin-specific placement)
- **Refined:** at ≥1600, a 320 rail holding tasks (always expanded), mail, PR, routing chips, the lane meter, version and cost, and a History link. Below 1600, the same content stays in today's strips, chips and sheets.
- **Instrument:** the same sections as key/value panels. Permanent at ≥1600; an overlay on `I` or a header button from 900 to 1599; the quick bar's sheets on a phone.

**Sheets and dialogs**
- **Both skins:** a bottom sheet on a phone. At ≥900, a centred dialog in three sizes (sm 440, md 560, lg 720) on `--elev-pop`, with a ✕ and no grabber (W1, once the in-flight sheet work lands; §10). The flows inside are shared.
- **What differs is tokens only.** Refined's dialog has radius 16 and a 200ms fade and scale. Instrument's has radius 8 and a 120ms fade.

**Inbox** (today's Mail screen, renamed in W3)
- **Refined:** a page in the detail pane on `PageScaffold` (≤760). Every row navigates to its target.
- **Instrument:** the rail's Inbox swaps the list column to the feed, and the selected item's target opens in the detail pane.
- **Phone, both:** a page. Inline "Needs you" cards lead it once F2 lands (W4).

**Runs**
- **Refined:** a page at `--page-max-wide`, grouped Needs you → Running (by programme, with a wave stepper) → Finished.
- **Instrument:** the list column is the runs table, grouped by programme. The detail is the run drill-down (F3, W4); until then it is the board.

**Accounts**
- **Refined:** lane cards at ≤760, with trouble cards (what is wrong, its effect, the fix).
- **Instrument:** a table of lanes with LED meters in the list column, and the selected lane's detail in the pane.

**Settings**
- **Both skins:** sectioned (W3), with Appearance holding the Layout (skin) and Theme fieldsets.
- **Refined:** subpages on a phone and a sticky sub-nav on desktop.
- **Instrument:** the section index in the list column and the section in the detail pane.

**Phone navigation**
- **Refined:** the one-row header with icon doors, and the FAB.
- **Instrument:** the bottom tab bar, and the in-session quick bar.
- **Both:** every route is reachable in at most two taps from the fleet. W2's parity test pins that for each skin.

**Mock B's items, each placed or dropped** (the audit's mock B carried four things the tables above did not):
- **The rail's Activity item:** a reserved slot between Archive and Bell, filled by the activity log (F4, W4). Refined's app bar gains Activity as a tab at the same time.
- **A Docs slot on the rail:** reserved beside Activity for #402's Docs reader. W2 requires #402 anyway (§10), so W2 fills it, and Refined's tabs gain Docs at the same time (the laptop row of the Shell table).
- **⌘J, jump to latest:** a W2 registry command in both skins, so the shortcut sheet and the parity test see it. Some browsers keep Ctrl+J and ⌘J for their downloads view, so W2 confirms a page can claim the key in each target browser. Where one cannot, the command keeps its palette entry and W2 names a single-key fallback.
- **The second session beside the first at 1920:** reserved for W4, as its own plan. The session store is already one store per id (`getSessionStore(id)`), so nothing in W0 to W2 blocks it. It needs W2's inspector and the parity test first.

### 5.4 What a skin switch preserves

A skin switch re-renders the shell in place, with no reload, and the theme is untouched. From W2, when the shell is the skin's own component, it also keeps:
- the route;
- the composer's typed text. That text is component state today (`Composer.tsx`'s `value`), so W2 either lifts it out of the shell or keeps the composer mounted across the swap;
- an open sheet or dialog;
- the terminal drawer, open, with its live connection;
- an open command palette.

Scroll position may reset. W2's parity test switches the skin with each of these open and asserts each survives. Before W2 a switch changes tokens only, so nothing is remounted.

## 6. The borrowing matrix

| Feature | From | Refined gets | Instrument gets | Shared implementation | Wave |
|---|---|---|---|---|---|
| ⌘K palette and shortcuts | B | ⌘K, `[` `]`, `g` chords and `?`; an app-bar search icon | the same, plus a visible command field and a status-bar hint | registry and `CommandPalette` (D-5103) | W1 (plan Task 10) |
| ⌘J jump to latest | B | yes | yes | a registry command (§5.3) | W2 |
| Key hints | B | under the composer only | on every action | `Keycap` | W2 |
| Inspector | B | rail at ≥1600 | permanent at ≥1600, overlay below, quick-bar sheets on a phone | the inspector sections | W2 |
| Needs you / Working / Done and reason tags | B | the filter rail's Attention view, grouped by reason; tags on rows | the default list grouping, with a project toggle | pure grouping and `needsReason()` | W2 (data) and W3 (U1) |
| lucide icons | A | everywhere a glyph was an emoji | the same, plus the rail | `Icon` (D-5100) | W1 (Task 8) |
| Plain-language tool summaries | A | grouped tool rows | log rows | the per-tool summariser | W2 (after #402) |
| Centred dialogs at ≥900 | A | yes | yes | `Sheet`'s desktop arm | W1, gated (§10) |
| Danger variants | A | yes | yes | `Button` (D-5099) | W0 (Task 6) |
| Hover, pressed and selected row | A | yes | yes | tokens and primitives (D-5101) | W1 (Task 9) |
| Inline-answer "Needs you" cards | C | the desktop empty-detail home, and the top of the phone Inbox | expanding rows in the Needs-you group, and the detail-pane home | one card on the ask sheet's option rows | W4 (F2, after the ask sheet half) |
| LED segment meters | B | continuous | 10 segments | one `Meter` (D-5098) | W0 (Task 5) |
| Status bar | B | no; the build line stays in Settings and the subtitle | yes | `BuildLine` and `useFleetHealth` | W2 |
| Time-gutter log transcript | B | no | yes | `chatItems` | W2 |
| Page scaffold and type roles | A | roomy | dense, through tokens | `PageScaffold`, `Section`, `EmptyState` (D-5102); the primitives' role adoption (D-5093) | W1 (Tasks 11, 14, 14b) |
| Integrity strip, version and cost | audit F5, F6 | a strip on the fleet; version and cost in the inspector rail | the status bar; the inspector's panels | the divergence store and its model, and the session-facts model (D-5104) | data W0 (Tasks 15, 16); UI after #402, then W2's inspectors |
| Reading column | A | 780 / 820 | 860 log column | `--measure-chat` | W2 |
| One-row phone header and FAB | A | yes | no | — | W2 |
| Bottom tab bar and quick bar | B | no | yes | — | W2 |
| Selected row: tint plus rail | A and B agree | yes | yes | `--accent-tint` and a 2px `--accent` rail | W1 (Task 9) |

## 7. The per-device default and the picker (D-5096)

- **Catalogue** (`ui/src/styles/skins.ts`): `refined` ("Refined": roomy and touch-first, with cards, a reading column and a one-row phone header) and `instrument` ("Instrument": dense and keyboard-first, with a rail, a grouped table, an inspector and a status bar). Each entry carries a `preview` flag.
- **The device rule.** `AUTO` ("Match this device") resolves by primary input, never by window width: `(hover: hover) and (pointer: fine)` → Instrument, anything else → Refined.
  - A phone or a tablet is coarse, so it gets Refined. A desktop or a touch laptop with a fine primary pointer gets Instrument.
  - Tablets (touch, 900 or wider) default to Refined, for touch comfort (§12, O1).
  - Resizing a window never flips the skin. Both skins have a phone layout, so a narrow desktop window keeps its device's skin and shows that skin's phone layout (§12, O2).
  - **Resolved once per page load.** The device fact is read at boot and reused until the next load. Nothing subscribes to the query, so a tablet docking a keyboard mid-session changes nothing until it reloads. Under W2's `SKIN_SETS[useSkin()].Shell`, a live re-resolve would remount the shell under the person using it.
- **Preview.** Instrument is `preview: true` until its shell lands (W2). While it is a preview, `AUTO` resolves to Refined on every device, and the picker labels Instrument "Instrument (preview)". The W2 PR that lands B's shell sets `preview: false`, which is what turns the desktop default on. So the per-device default exists in code from W0 (plan Task 12a) but changes nobody's screen until there is a B shell to show.
- **Storage** is `ccrc-skin` in `localStorage`, read and written inside try/catch like `ccrc-theme`. An unreadable store means `AUTO`; an unknown value means `AUTO`.
- **First paint.** `pwa/index.html` stamps `data-skin` before the bundle loads, on the theme snippet's terms (that snippet's own header argues them).
  - A stored value is stamped verbatim. The snippet never re-lists the catalogue's ids, which would be the second copy `single-definition` forbids. An unknown value matches no block, so the frame renders `:root`, which is Refined, and `initSkin()` corrects the attribute when the bundle runs.
  - A missing value, or `auto`, takes the device rule, gated by a literal that mirrors the preview flag.
  - The storage key, the default id, the media query and the flag literal are bound to `skins.ts` by a test, the way `contrast.test.ts` binds the page-background hexes in that file. The snippet never throws.
- **The picker.** Settings → Appearance gains a "Layout" fieldset above "Theme" (Match this device · Refined · Instrument), built on `Radio` like `ThemeRow`. Each row carries a one-line note. Under it, one line names the fonts and links their licence (D-5095). The command palette offers the same three as "Switch layout". The picker lands after #384, which edits `SettingsScreen.tsx` (plan Task 12b).
- **Reaching Instrument before the picker** (§12, O6). From Task 10 on, ⌘K → "Switch layout" → "Instrument (preview)" selects it. Before Task 10, in the browser's console: `localStorage.setItem('ccrc-skin', 'instrument')`, then reload. `localStorage.removeItem('ccrc-skin')` and a reload return to the default. `ui/README.md` documents both.

## 8. Storybook and the contrast gate per skin

### 8.1 Storybook (D-5093, its verification clause)

- `ui/.storybook/preview.ts` gains a `skin` global beside `theme`. Its items are derived from `SKINS`, never re-listed, and it is applied through `applySkin`, the function the app calls, which is the same discipline the theme decorator documents.
- The viewport presets become 360, 390, 438, 1280, 1470 and 1920, the verification widths.
- The initial skin comes from `STORYBOOK_SKIN` (plan Task 3, now), so a local `STORYBOOK_SKIN=instrument` build runs axe over every story in Instrument.
- `storybook-a11y` (CI, advisory) builds Storybook once per skin and runs the test-runner against each build, so axe measures every story in both skins. `server/test/ci-pipeline.test.ts` pins that the job covers exactly the catalogue's skins. Both files are #402's until it merges, so this lands as plan Task 3b, after #402.
- The token reference story (`tokens.stories.tsx`) gains a "Skin roles" table that shows each `SKIN_TOKENS` value as resolved in the selected skin.

### 8.2 The contrast gate

The gate needs no second run per skin, and the reason is structural, not hoped for:
1. A skin declares no colour (§3.2). The token-pair contract in `contrast-check.mjs` measures every palette's colours, and those are identical in both skins.
2. The structure channel (§4.4) is ordinary stylesheet rules, which `audit.mjs` already walks and measures. Where those rules put an ink on a new ground, the contract gains the pair (below).
3. The guard asserts that `skins.css` is in the gate's walk. If a colour ever slipped into the token channel, the stylesheet half would see the rule even though the guard should refuse it first.

What the skin does change is which grounds text sits on. B's panels sit on `--bg-page` where A's cards sit on `--bg-surface`. That is channel 2, measured as rules. The token contract gates the neutral inks on `page`, `surface` and `raised` (and primary and secondary on `sheet` too). It gates the status texts and lane hues on `surface` only; attention text is the one also gated on `page`.

So when a skin component first puts a status text or a lane hue on another ground, the PR that does it adds that pair to the contract and lets the generator fit it. W2 does this for B's panels on `--bg-page`, as W1 does now for the grounds it introduces.

W1 adds `--accent-tint` (the selected row) and `--bg-hover` / `--bg-pressed` to the contract as grounds, each with exactly the inks drawn on it:
- on `--accent-tint`, the selected fleet row: the three neutral inks, every status text and every lane hue;
- on `--bg-hover`: the three neutral inks (rows, menu items, doors, ghost and quiet buttons), plus the status texts and lane hues, because a hovered fleet row keeps its meta;
- on `--bg-pressed`: the three neutral inks only. No status text or lane hue is drawn on a pressed primitive; a chip paints its own ground.

The tertiary ink is fitted against the tint and the pressed recipe from the start (D-5097), so the neutral pairs hold when W1 adds them. The pressed recipe (ink at 9% over surface) bounds the hover one (5%), because the mix moves the ground monotonically toward the ink; the gate still measures both.

Measured at `a3cebde1`: on `--accent-tint`, four generated palettes have one or two meta inks below 4.5:1. Plan Task 9 re-measures this on its own base (main plus Tasks 4 and 6) before it fits anything, since Task 6's new dead-text pairs can move the dead text.

| palette | below 4.5:1 on `--accent-tint` |
|---|---|
| Dracula | `--status-dead-text` 4.34, `--acct-blue` 4.43 |
| Catppuccin Mocha | `--status-dead-text` 4.38 |
| Gruvbox Dark | `--status-dead-text` 4.21 |
| Solarized Dark | `--acct-magenta` 4.21, `--acct-amber` 4.26 |

Both Phosphor palettes pass. The generator therefore fits the status texts and lane hues with the tint and the hover ground as extra grounds (plan Task 9).

## 9. The visual verification matrix

Every foundations PR is checked, and its PR body carries a table with one cell per combination: **skins** (Refined, Instrument) × **widths** (phone 360, 390 and 438; laptop 1280 and 1440 or 1470; wide 1920) × **modes** (Phosphor & Ink, Phosphor Daylight). A PR that changes palette values adds one generated dark palette and one generated light palette (Dracula and GitHub Light are the most constrained).

- **Surfaces per PR:** the ones the change can reach. The full set for a shell or screen change is fleet; session (busy, with an ask pending); a sheet open; Inbox; Runs; Accounts; Settings; and the sign-in cover.
- **How:** primitives in Storybook through the skin, theme and viewport toolbars. Screens in the app, via `npm run dev` in `pwa/` against a local `ccrc-server` with a fixture `CCRC_HOME` and `HOME` (README, "Run the server against a fixture home"), on a machine that runs no fleet. Screenshots in a PR use fixture names only (`project-a`, `lane-a`). This repository is public.
- **Reaching Instrument in the app** before the picker exists: ⌘K → "Switch layout" once Task 10 has landed. Before that, run `localStorage.setItem('ccrc-skin', 'instrument')` in the console and reload (§7).
- **What is checked in each cell:**
  - no horizontal page scroll;
  - no clipped or overlapping text;
  - tap targets of at least 44px on a coarse pointer;
  - the identity core present (wordmark, lamps, wells, lane hues);
  - nothing the PR did not intend to change has moved (W0's axis task is pixel-neutral in Refined).
- **After #402 lands** its real-browser leg (`pwa/browser/`, playwright-core), W1 adds `pwa/browser/skins.browser.test.ts`. Per skin × width × mode, it asserts the measurable half of the list above: scroll width, the 44px floor under coarse emulation, the dialog centred at ≥900, and the wordmark present. Screenshots stay human evidence. Layout invariants become a mechanism.

## 10. Migration waves

| Wave | Contents | Needs | Blocks |
|---|---|---|---|
| **W0 Foundations** | The skin axis (D-5093), including `cn()`'s merge groups for the new utilities; the identity core's token guard and its three censuses (D-5094); per-skin verification (D-5093's verification clause): the Storybook half now, the CI half after #402 (`ci.yml`, `ci-pipeline.test.ts`); ink tiers (D-5097); one meter on the palette (D-5098); danger variants, the fleet-host Reboot included (D-5099); the Geist pair (D-5095), whose service-worker precache line waits for #402 (`pwa/vite.config.ts`); the per-device default, resolved once per load (D-5096, plan Task 12a). **The audit's first batch, where it collides with nothing:** the quick wins (§2 item 11, plan Task 13); the integrity census's store half and model (F5), and the session facts' model (F6) (D-5104, plan Tasks 15 and 16). | nothing in flight, except the gated steps named | everything below: every later PR is checked in both skins on this axis |
| **W1 Shared structure** | **Now (in the plan):** the `Icon` primitive and the emoji swaps outside in-flight files (D-5100); hover, pressed and the selected row (D-5101); the command palette and shortcuts (D-5103); the type and density roles adopted by the shared primitives (D-5093, plan Task 14). **Gated, in the plan:** the page scaffold (D-5102), after #402 and terminal drawer stage 1, because both edit `contrast.test.ts`, whose census names the screen titles and empty states the scaffold retires (Settings adopts it after #384; Docs is #402's own); the picker (D-5096, plan Task 12b), after #384; role adoption in the app sheets' rows, chips and sheet copy, `Sheet`'s body padding and `OptionRow` (plan Task 14b), after the ask sheet half and drawer stage 1, which hold `chat.css`, `sheet.tsx`, `option-row` and the shape census; Jump to latest clearing Retry and Discard (§2 item 12, plan Task 17), after the ask sheet half and drawer stage 1, which both edit `chat.css` and the control census. **Gated, a later plan:** `Sheet`'s desktop arm (sizes, centred at ≥900, `--elev-pop`, a `Popover` primitive), after the ask sheet half and drawer stage 1, which both edit `sheet.tsx` or its consumers; toast and `QuickConfirm` polish after the arm; `Wordmark` as a primitive, the meter's band carried on its number, and danger on the hand-drawn Abandon and Revoke controls, after #402 and the drawer (the contrast and control censuses name those rules); Stop as a danger control, after #402 (`SessionHeader.tsx`); the 🤖 and ❓ swaps, after #402 and the ask sheet half; the per-tool summariser, after #402; the browser matrix (§9), after #402; the integrity strip and the version and cost readouts on the fleet screen and session header (D-5104's UI halves), after #402 (`FleetScreen.tsx`, `SessionHeader.tsx`); the seven `audit.mjs` grounds reasons that still describe the reverse-video slab, rewritten after #402 once Task 9 has landed. **Out:** framer `layout` and the count ping wait on framer-motion 14 (#422), which stays out of this programme (§12, O7). | W0 | W2: the shells need dialogs, icons, the scaffold, the roles and ⌘K |
| **W2 Shells** | Refined's shell (the app bar, the sidebar, the phone header and FAB, Stop in the send slot, the reading column, the inspector at ≥1600); Instrument's shell (the rail with its reserved Docs and Activity slots, the list column and table, the detail pane, the inspector, the status bar, the tab bar and quick bar, the log transcript); `pwa/src/skins/`; the element half of the guard; the parity test (every route and every registry action reachable in both skins, and the switch-preserves list of §5.4); ⌘J as a registry command; the inspectors take over the integrity and session-facts views; Instrument `preview: false`, which turns on the desktop default. | W1. It edits `app.tsx`, `shell.css`, `FleetScreen.tsx`, `SessionHeader.tsx` and `ChatList.tsx`, so #402, the ask sheet half and drawer stage 1 must all be merged. | W3 |
| **W3 Screens** | The audit's per-screen items (U1 to U15) in both skins: mostly shared screens on the scaffold, plus B's master-detail splits for Inbox, Runs, Accounts and Settings. | W2 | W4's homes |
| **W4 Feature gaps** | The audit's feature items (F1 to F15): the ask sheet half moved onto the new `Sheet`; the "Needs you" home with inline-answer cards (F2); run drill-down (F3); activity log (F4), which fills the rail's reserved Activity slot; the routing sheet (F7); mail bodies (F8, after its server gate change); Instrument's second session beside the first at 1920 (§5.3); and the rest as rulings and server waves allow. F5 and F6 are not here: their data lands in W0 and their UI in W1 and W2. | W2's inspector and home slots, and each item's server half | — |

## 11. Risks and containment

1. **Doubling the test surface.** Two skins could mean two of every test.
   - *Contained:* behaviour lives once (§5.1), so stores, words, hooks and flows keep one suite. Skin components are thin and get structure tests only (identity elements present, navigation parity). Primitives are tested once, with Storybook a11y run in both skins. The visual matrix is per PR and scoped to the surfaces touched.
2. **Drift between skins.** A fix lands in one skin's layout and not the other's, or one skin quietly grows a colour of its own.
   - *Contained:* the identity guard (§3.2, both halves); W2's parity test, which checks every route and every command-registry action has a door in both skins; and the borrowing matrix (§6) as the owner table, where every row names its shared implementation.
3. **Instrument reads as a generic dev tool and loses the phosphor mood.** This was the audit's main risk for B.
   - *Contained:* the identity core is identical in B (wordmark, glow, lamps, wells, the Geist pair, lane hues), and a skin cannot change a colour.
4. **Density against touch.** B's 32px rows on a phone would fail the tap floor.
   - *Contained:* `--row-h` is 44 by default and 32 only inside `(pointer: fine)`, so a coarse device or one reporting `pointer: none` keeps 44. A guard case refuses a tap-bearing density token below `--tap-min` outside that block (§3.2). `--tap-min` cannot be overridden, and B on a phone keeps its own phone navigation (ruling 4).
5. **The keyboard surface.** Global keys can fire inside a text field, or reach through an overlay. Escape on an open palette must not interrupt a running turn.
   - *Contained:*
     - Single-key shortcuts fire only outside text fields and with no modifier held. A modifier is Ctrl, Alt or Meta; Shift is not one, because `?` is Shift+/ on common layouts. Keys match on `e.key`. ⌘K is the one global binding.
     - The palette keeps focus in its input. Its options are `role="option"` with `tabIndex={-1}`, reached through `aria-activedescendant`, so `SessionHeader`'s Escape handler, which skips `INPUT` and `TEXTAREA` targets, never sees a key from them.
     - The palette also stops Escape's propagation itself. That handler never checks `defaultPrevented`, and Radix's dismiss layer prevents the default without stopping propagation, so focus placed anywhere in the palette (an option, the empty state) is covered too.
     - Pinned by the plan's Task 10.
6. **Status grouping against the project mental model.**
   - *Contained:* B's list keeps a status/project toggle (remembered per device), and A keeps projects first.
7. **In-flight collisions.** Six branches and PRs touch shared files, and one adds a colour emoji that the icon census refuses (#402's Docs door).
   - *Contained:* the plan's in-flight table names every touched file, and a task that needs one is gated on its merge, never interleaved. Where a task lands now and splits off its frozen half (Tasks 3, 7, 12 and 14), the half that waits is its own step with its own header. Task 8's header records how the 📄 resolves whichever side merges second.
8. **Font coverage and payload.** Geist Mono may not carry `❯` or the status glyphs (✓ ✕ ♻ ○ ● ▲ ⑂ ⟳ ⇡ ⤺).
   - *Contained:* the system stacks stay behind Geist, so a missing glyph falls back per glyph to today's look. Task 7 checks each glyph in Storybook. Until the precache step lands after #402, an offline first load uses the system stack, which is today's behaviour.
9. **The per-device default surprises someone.**
   - *Contained:* B is a preview, so the default changes nothing, until B's shell lands. The picker and the palette both switch at any time, and the choice is remembered.
10. **A half-built B in W0 and W1.** Until Task 14 lands, Instrument changes only radii, card elevation, motion and meters. Its type and density roles are declared but read by nothing (§4.2).
    - *Contained:* it stays a labelled preview, reachable from ⌘K (or by the stored value before Task 10), and the default does not select it.
11. **A merge that eats a class.** `cn()` is tailwind-merge, which reads an unknown utility by its prefix. Without being taught, it reads `text-meta` as a text colour and deletes the ink beside it, and it keeps both `p-4` and `p-gutter`. Measured with `cn.ts`'s own config on tailwind-merge 3.7.0. `cn.ts`'s header records the same silent drop shipping once already.
    - *Contained:* Task 1 teaches the merge every new size and spacing key, with a red test for each direction.
12. **"Unmeasured" read as "clean".** The divergence frame has no cold start, so a client that connected after the last change has seen no census at all.
    - *Contained:* the store keeps "no frame yet" (`null`) apart from "measured, none" (`[]`), and the model never renders an all-clear for the first. Pinned by Task 15.

## 12. Rulings on rev 0's open questions

Rev 0 left seven questions open. Each is now ruled, and the sections it touches say so.

- **O1. Tablets** (touch, at least 900 wide). Ruled 2026-10-15 (coordinator, under the operator's direction): **Refined by default**, for touch comfort. The device rule already does this, because a tablet's primary pointer is coarse (§7).
- **O2. Narrow desktop windows.** Ruled 2026-10-15 (coordinator, under the operator's direction): a narrow desktop window **keeps its device's skin and shows that skin's phone layout**. A skin never flips on resize. `AUTO` is resolved **once per page load**, not subscribed (§5.2, §7; plan Task 12a).
- **O3. The `❯` before page titles in Instrument.** Ruled 2026-10-15 (coordinator, under the operator's direction): **it stays**. The caret is part of the identity core (§3.1), and `PageScaffold` draws it in both skins (D-5102).
- **O4. The last issued number.** Ruled 2026-10-15 (coordinator, under the operator's direction): **D-5104 covers the data halves of F5 and F6 now.** That means F5's store half (a handler for the `/ws/fleet` divergence frame, which the store drops today, plus a pure model) and F6's data (version and cost surfaced through a pure view model over the session rows). Their UI halves are gated on #402's frozen files, `FleetScreen.tsx` and `SessionHeader.tsx`, and then move into W2's inspectors (plan Tasks 15 and 16). Per-skin verification (Storybook a11y in both skins, in CI) is folded into D-5093 as its verification clause. It is the axis's own proof, and folding it in keeps every number defined once.
- **O5. Vendoring.** Ruled 2026-10-15 (coordinator, under the operator's direction): the fonts and the lucide subset are **copied into `@ccrc/ui` with their licences**, and no npm dependency is added. A dependency would change `ui/package.json`, which the open framer-motion and TypeScript bumps also change, and `lucide-react` would join the three React-dedupe lists in `pwa/vite.config.ts`, a file #402 changes.
- **O6. Instrument as a preview before W2.** Ruled 2026-10-15 (coordinator, under the operator's direction): **selectable as a labelled preview from ⌘K** before its shell exists (Task 10 on). Before Task 10 it is **reachable by `localStorage['ccrc-skin'] = 'instrument'` and a reload**, documented in §7 and in `ui/README.md`.
- **O7. The framer-motion 14 bump (#422).** Ruled 2026-10-15 (coordinator, under the operator's direction): **it stays out.** W1's motion items (framer `layout` and the count ping) stay gated on it, and nothing in this plan depends on it.

## 13. Deviation numbers

`POST /api/ledger/deviations` issued this work a block of twelve on 2026-10-15. All twelve are defined once, in the plan's §Deviations found. This design cites them:

| Number | Slug | Section |
|---|---|---|
| D-5093 | `skin-axis` (with its verification clause, its role adoption and its merge groups) | §2 item 9, §4.1, §4.2, §5.2, §8.1, §9 |
| D-5094 | `identity-core` | §3 |
| D-5095 | `geist-self-hosted` | §3.1, §7, §10 |
| D-5096 | `skin-default-and-picker` | §5.4, §7, §12 O1, O2, O6 |
| D-5097 | `ink-tiers` | §2 item 1, §8.2 |
| D-5098 | `one-meter` | §2 item 2, §4.2 |
| D-5099 | `danger-variants` | §2 item 3 |
| D-5100 | `icon-primitive` | §2 item 6, §6, §11 item 7 |
| D-5101 | `hover-pressed-selected` (with the one-focus-cue clause) | §2 items 4, 5 and 11, §8.2 |
| D-5102 | `page-scaffold` | §3.1, §4.2, §6, §10, §12 O3 |
| D-5103 | `command-palette` | §5.1, §6, §11 item 5 |
| D-5104 | `integrity-and-session-facts` | §2 item 10, §6, §10, §12 O4 |
