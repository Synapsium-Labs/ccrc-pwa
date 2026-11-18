# Native Docs reader: appearance continuity

**Spec** · 2026-11-18 · Status: Draft · Owner: native-docs-reader programme, wave X1 · Linear: none · Related: `docs/superpowers/plans/2026-11-18-native-docs-appearance-continuity.md`, `docs/superpowers/plans/2026-11-07-native-docs-reader-completion.md`, `docs/superpowers/specs/2026-11-07-native-docs-reader-completion-design.md`, `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md`, `docs/superpowers/programs/native-docs-reader.md`

## In short

The Docs reader frame should look like the rest of ccrc. It opens in the skin and palette the person chose in ccrc, and it follows any change made while it is open. Today it only learns light, dark or auto, because the adapter folds the twelve palettes into those three words and sends no skin (§1).

The design has five parts:
- **What crosses the bridge.** ccrc sends a small set of colour and shape values, a token contract, through the bridge the reader already uses. ccrc never sends a palette catalogue, an id list or a stylesheet (§2).
- **Where the values come from.** ccrc reads them from its own applied design tokens at the moment it needs them, through one mapping table. So the twelve palettes, Follow the system and both skins keep one source: the design system. A scan reds a second copy (§3).
- **Readability in every palette.** Code, tables, Mermaid and focus are drawn from the same values, and a test checks their contrast in every palette (§5).
- **Aa.** Inside ccrc, the frame's Aa stops offering a theme. Width, font and folds stay the reader's own (§6).
- **The library's part.** The shared library takes a backward-compatible minor change. Section 10 is written for the library programme to plan from. Its release and ccrc's re-pin are the operator's.

Nothing in this design widens the sandbox, the CSP, parent-DOM access or the set of message channels. The phone blocks and the tap, one-bar and desktop-fit budgets stand, measured on both skins (§8, §9).

What to check: the token contract (§2), the one-source mechanism and its scan (§3), the budgets (§9), and the acceptance mapping onto Task 17's Appearance row (§11). The one product choice, Aa's line while hosted, is answered (Where things stand).

## 1. Context

This section states the operator's requirement and what ccrc and library 1.1.0 do today. Every claim here was read from shipped source on 2026-11-18, at `main` `6f5421139`.

**The requirement.** It is the programme ledger's "Operator amendment — native visual continuity and legacy decoupling (2026-11-10)" and its Carried constraint "Required native appearance continuity". The reader uses ccrc's skin and theme choices and opens with ccrc's selected appearance. It aligns surfaces, text, accent and semantic colours, typography, borders, focus, controls and density. A colour-mode-only approximation is not enough. Rendering styles and any checked-preference extension belong to the shared library, and ccrc owns its preference and the adapter. Two choices are coordinator defaults: the frame follows host changes while open, and Aa's global appearance follows ccrc while hosted.

**ccrc's appearance today (sourced).**

| What | Where | Shape |
|---|---|---|
| Skin catalogue | `ui/src/styles/skins.ts#SKINS` | `refined`, `instrument`; stored choice `auto` resolves at boot (`resolveSkin`), applied as `data-skin` on the root (`applySkin`) |
| Skin tokens | `ui/src/styles/skins.css`, closed list `skins.ts#SKIN_TOKENS` | Type, density, radius, elevation, meter, motion. Skins never set colour (`skin-identity.test.ts`) |
| Palette catalogue | `ui/src/styles/themes.ts#THEMES` | Twelve rows `{id, label, mode, note}`: 8 dark, 4 light. `SYSTEM` is a stored choice, not a row |
| Palette values | `ui/src/styles/tokens.css`, generated from `ui/design/make-themes.mjs` | One `[data-theme]` block per palette, `:root` for Phosphor. About 45 colour tokens each (`--bg-*`, `--ink-*`, `--edge-*`, `--accent*`, `--status-*`, `--diff-*`, `--syn-*`) |
| Catalogue checks | `pwa/test/theme-catalogue.test.ts`, `skin-catalogue.test.ts` | ids equal CSS blocks both ways; generated block equals the generator's output |
| Contrast gate | `pwa/design/contrast-check.mjs`, `pwa/test/contrast.test.ts` | WCAG 2.1 floors, 4.5:1 for ink on every surface, in every palette |
| Preference | `pwa/src/lib/theme.ts`, `pwa/src/lib/skin.ts` | Per-device storage, one writer each (`setTheme`, `setSkin`), pre-paint script in `pwa/index.html` |
| Typefaces | `tokens.css` `@font-face` | Geist and Geist Mono, self-hosted woff2 (69 KB and 71 KB) |

**The reader today (sourced).** `ReaderFrame.tsx` computes `readerPrefsOf(useThemeChoice(), THEMES)`. It sends `auto` for Follow the system and the palette's `mode` for a named palette. It sends no skin. The bridge (`docs/reader/bridge.ts`) passes `prefs: {theme}` at mount, and the frame's `setPrefs` afterwards. During a lazy start, `ReaderFrame` re-sends the latest mode after the mount resolves (`seededPrefs`). The reader lab mounts with `theme: 'auto'` and profile `lab-draw`.

**Library 1.1.0 (sourced from the installed package).**
- `HostAdapters` has no appearance key beyond `prefs: Partial<FramePrefs>`, where `FRAME_PREF_VALUES = {theme: auto|light|dark, width: standard|wide, font: serif|sans}`.
- `mountDocFrame` throws `TypeError` on any adapter key it does not know (`ownData`), and `RangeError` on a bad pref value.
- The frame's stylesheet scopes every rule under `[data-docreader-root]`, through 54 custom properties, 36 of them colours (`--bg`, `--surface`, `--text`, `--accent`, `--border`, `--th-bg`, `--code-block-bg` and so on). Its header says a host may override any of them, but no API carries them.
- Code highlighting uses hard-coded hex in `.hljs-*` rules, with a second dark block.
- Mermaid draws with `theme: 'base'` and one fixed warm light palette of 15 hex values, on a white plate. Dark mode inverts the plate with a CSS filter.
- The bridge protocol is `v: 1`. A parent op the frame does not know is ignored, and the parser accepts only flat objects of strings and numbers.
- The frame's CSP allows `style-src 'unsafe-inline' data:` and `font-src data:`. Its four fonts, Source Serif 4 and Source Sans 3, travel as `data:` inside its stylesheet: 413 096 base64 characters of the stylesheet's 549 069.

## 2. What crosses the bridge: a token contract

This section fixes the interface between ccrc and the library. ccrc sends values for a closed list of named slots. The library owns the list, the stylesheet that uses it, and the validation.

```mermaid
flowchart LR
  P["ccrc preference<br/>theme.ts and skin.ts"] --> R["Root stamp<br/>data-theme and data-skin"]
  R --> T["Applied tokens<br/>tokens.css and skins.css"]
  T --> M["Adapter reads mapped tokens<br/>one mapping table"]
  M --> V["Library validator<br/>closed slots, hex only"]
  V -->|valid| A["Seed at mount<br/>appearance op while open"]
  V -->|invalid| F["Mode only<br/>today's light, dark or auto"]
  A --> X["Frame root<br/>library-owned custom properties"]
  F --> X
```
*Figure 1. Where appearance comes from and how it reaches the frame. The catalogue stays on the left. Only resolved values cross, and only after the library's own validator accepts them. A payload it refuses leaves the reader on today's mode-only path.*

**The contract (library-owned).**
- `mode` is `light`, `dark` or `auto`: the resolved direction. It sets `color-scheme` and the library's defaults for any slot the host leaves out.
- `colour.<slot>` is one value per colour slot, `#rrggbb` or `#rrggbbaa` only. The group is all or nothing. An appearance with no colour group is valid. It means "hosted, in the library's own colours for `mode`", and it clears any host colours applied before.
- `skin.<slot>` holds the skin's character. Each slot falls back one by one:
  - `radius` and `radiusSmall`: whole pixels from 0 to 24;
  - `controlRow`: whole pixels from 28 to 56, the height of rows in the frame's popovers (Aa, contents, quick jump), applied only under `(pointer: fine)`. Measured values: Refined 52 px, Instrument 32 px under a fine pointer;
  - `sectionCase`: `none` or `uppercase`, for the frame's own section labels.
- `fonts` are optional faces for the frame's sans and mono roles, carried as font assets at mount (§2.2).

**Base colours only.** Version 1's colour slots are base colours. The library derives every tint, hover, table head, inline-code and bar background from them with `color-mix` in its own stylesheet, because ccrc's own tints change form from palette to palette: `rgba(...)` in one, `color-mix(...)` in another. The 30 slots:
- surfaces: `bg`, `surface`, `surface2`;
- ink: `text`, `text-muted`, `text-faint`;
- edges: `border`, `rule`;
- accent: `accent`, `accent-ink`, `focus`;
- semantic: `ok`, `wait`, `no`, `info`, `chg`, `chg-del`;
- code: `code-block-bg`, `code-ink`, and `syn-comment`, `syn-keyword`, `syn-string`, `syn-number`, `syn-function`, `syn-type`, `syn-tag`, `syn-attr`, `syn-punct`, `syn-deleted`, `syn-inserted`, which replace the hard-coded `.hljs-*` hex.

The list's home is the library's `APPEARANCE_SLOTS` export, and ccrc never spells it a second time (§3). Each ccrc token mapped to these slots was measured on 2026-11-18 to resolve to a plain `#rrggbb` in all twelve palettes, through `var()` chains, both default blocks merged.

**Why values and not a catalogue.** The frame needs one appearance at a time. The values for that appearance are all it can use, and they reveal nothing the frame could act on. A catalogue would put a second copy of ccrc's palettes in the library or in every seed (Decision X1-1, §12).

### 2.1 Carriage

- **At mount**, a new adapter key `appearance` carries the contract. The library writes each slot onto the frame root with the CSSOM (`style.setProperty` on a library-owned property name) before first paint. So the first painted frame is already in ccrc's colours.
- **While open**, `DocFrame.setAppearance(a)` posts one new parent op, `appearance`, on the existing port: a flat object `{t:'appearance', v:1, mode, 'c.<slot>': '#…', 'k.<slot>': '…'}`. It fits the parser's existing rule (plain object of strings and numbers) and the library's closed key table. An op with no `c.` keys drops host colours (§7).
- **Nothing flows back.** There is no new frame-to-parent op and no new `store.set` key. The frame never tells ccrc what it applied.
- **Hosted means an appearance was seeded.** A mount whose adapters carried `appearance` is hosted for its whole life. While hosted, ccrc never calls `setPrefs` with a `theme`, and the frame never writes `theme` to `pref:prefs`. Its `prefs` path writes the whole prefs object, so the library leaves `theme` out of what it stores while hosted.

### 2.2 Fonts

ccrc's typefaces are part of its visual language, and the frame cannot fetch them (`default-src 'none'`). ccrc passes its own Geist and Geist Mono woff2 as two optional font assets, base64 text in `FrameAssets.fonts`, read once from the files the design system already ships.
- **Loading.** The library checks the base64 alphabet, a `wOF2` signature and a 128 KiB decoded cap per face. It then loads each face with the `FontFace` API from the decoded bytes, under a fixed family name. No CSS text is built from host input.
- **Failure.** A face that fails any check, or fails to load, is dropped silently, and that role keeps the library's own face. A bad font never throws, never refuses the mount and never falls back to the plain view. On the ccrc side, the fonts load on their own path, and a failed font load mounts without them, never through `onFallback('assets')`.
- **Size.** The library's derived srcdoc cap rises by exactly the two faces' cap, so fonts never push a document into `too-large`.
- **Use.** While hosted, the frame's sans role and its chrome use ccrc's UI face, and code uses ccrc's mono face. The serif reading face stays the library's. Font choice in Aa stays the reader's (§6).

## 3. One source of truth for the catalogue

This section says how the reader uses ccrc's catalogue without copying it, and what reds a copy. The rule: the catalogue never leaves the design system. The reader reads applied values, not names.

**The mechanism.** The design system already applies the chosen appearance to the document root: `data-theme`, `data-skin`, and the tokens under them. The adapter reads the computed values of the mapped ccrc tokens from that root (`getComputedStyle(document.documentElement)`) at the moment it seeds or updates the frame. That is ccrc reading its own document. The frame is not involved, and no parent-DOM access is given to it.

- The one hand-kept artefact is **the mapping table**, `READER_APPEARANCE_MAP` in a new pure module `pwa/src/docs/reader/appearance.ts`. It is a mapping, not a catalogue: it names no palette and no skin. Version 1 maps:

  | Slots | ccrc tokens |
  |---|---|
  | `bg`, `surface`, `surface2` | `--bg-page`, `--bg-surface`, `--bg-raised` |
  | `text`, `text-muted`, `text-faint` | `--ink-primary`, `--ink-secondary`, `--ink-tertiary` |
  | `border`, `rule` | `--edge-strong`, `--edge-subtle` |
  | `accent`, `accent-ink`, `focus` | `--accent`, `--ink-on-accent`, `--accent` |
  | `ok`, `wait`, `no`, `info` | `--status-done`, `--status-attention`, `--status-dead`, `--acct-blue` |
  | `chg`, `chg-del` | `--diff-add`, `--diff-del` |
  | `code-block-bg`, `code-ink` | `--bg-well`, `--ink-on-well` |
  | `syn-<name>` (eleven) | `--syn-<name>` |
  | `radius`, `radiusSmall` | `--r-md`, `--r-sm` |
  | `controlRow`, `sectionCase` | `--row-h`, `--case-section` |
- A new palette, or a third skin, reaches the reader with no reader change: it is applied to the root, and the adapter reads it.
- Follow the system needs no special case. The root carries whichever palette the operating system picked, and the adapter reads that.

**The scan that reds a second copy.** A new test, `pwa/test/reader-appearance-source.test.ts`, has four parts:
1. **Slot coverage.** The mapping table's slots equal the library's `APPEARANCE_SLOTS`, in both directions.
2. **Every palette resolves.** For every palette `THEMES` lists, and for both skins, each mapped token resolves, through `var()` chains in `tokens.css` and `skins.css`, to a literal the library's validator accepts. A token that resolves to `color-mix(...)` or nothing reds here, not on a phone.
3. **No second list.** The scan covers `pwa/src/docs/`, `pwa/src/readerLab/` and `pwa/src/lib/appearance.ts`:
   - no file holds two or more palette ids, or two or more skin ids, as string literals or as object keys, quoted or not;
   - no file under `pwa/src/docs/reader/` holds a hex colour literal;
   - only `ReaderFrame.tsx` imports `THEMES`, for the mode-only fallback (§7), and no file imports `SKINS`.
4. **No stylesheet crosses.** No value the adapter builds contains `;`, `{`, `}`, `url(` or `var(`, and the adapter passes no key outside the contract.

A test helper, `pwa/test/helpers/paletteTokens.ts`, resolves a palette's tokens for parts 2 and 3. The contrast gate's `audit.mjs` cannot, as it stands: it keys the default palette as `DARK`, reads only the first `:root` block, and never reads `skins.css` or `color-scheme`. The helper merges both default blocks, maps `phosphor` to them, applies a skin's `:root[data-skin=…]` block and its `(pointer: fine)` arm, and follows `var()` chains.

```mermaid
flowchart TB
  S["make-themes.mjs<br/>and skins.css"] --> C["tokens.css<br/>one block per palette"]
  C --> A["Applied on the root<br/>by applyTheme and applySkin"]
  A --> R["Adapter reads<br/>mapped tokens only"]
  T["THEMES and SKINS<br/>ids and labels"] --> P["Settings picker"]
  T -. "test reads, never copies" .-> G["reader-appearance-source test<br/>and contrast pairs"]
  C -. "test parses" .-> G
```
*Figure 2. The catalogue's one home and its readers. Solid edges are runtime paths. Dotted edges are test reads. Nothing on the reader side holds a list of palettes or skins.*

## 4. When the frame learns the appearance

This section covers an ordinary open, a lazy open (the reader chunk still loading) and a change while open.

**One signal.** A new hook, `useHostAppearance()` in `pwa/src/lib/appearance.ts` (ring L4), observes the root's `data-theme` and `data-skin` attributes with a `MutationObserver` and returns a stamp, `skin|theme`. It reads the applied result, not the stored choice. So it moves on every writer's change, including Follow the system flipping with the operating system, which `useThemeChoice()` alone does not see.

**Reading at the last moment.** The bridge reads the appearance synchronously, immediately before the synchronous `mountDocFrame`, after its last asset and Mermaid await. This is the point where D2 samples focus (D-8729), with no await in between. A change during the lazy chunk load or the asset wait is therefore already in the seed.

**After the mount resolves.** The bridge's synchronous read returns the values and the stamp it read them under, and the mount hands that stamp back. `ReaderFrame` compares it with the current stamp, as it does today for the mode (`seededPrefs`), and sends `setAppearance` once only if they differ. A change during the hold is already in the seed, so it sends nothing.

**While open.** On a stamp change, `ReaderFrame` reads the values again and calls `setAppearance`. Calls coalesce to one per animation frame, and the latest wins. The frame applies the values in place: no remount, the same iframe and nonce, and the reading position kept.

```mermaid
sequenceDiagram
  participant U as Person
  participant H as ccrc root
  participant RF as ReaderFrame
  participant B as Bridge
  participant F as Frame
  U->>RF: open a doc
  RF->>B: mount, chunk loading
  U->>H: picks Nord in Settings
  H-->>RF: stamp changes
  B->>B: assets and Mermaid awaits end
  B->>H: read mapped tokens now
  B->>F: seed with Nord values
  F-->>B: ready
  RF->>RF: stamp equals seed, nothing to send
  U->>H: switches skin to Instrument
  H-->>RF: stamp changes
  RF->>F: appearance op on the port
  F->>F: apply in place, redraw drawn figures
```
*Figure 3. A lazy open with a change during the chunk load, then a change while open. The seed is read after the last await, so the first change needs no follow-up op. The second rides the existing port as one `appearance` op.*

**Mermaid on a change.** Figures already drawn are redrawn in the new colours, nearest first, one per task. Figures not yet drawn are drawn in the new colours when their turn comes. A newer appearance cancels the redraws still queued for an older one, so a burst never stacks redraws. Production stays on request (E17-READING does-not-hold), so few figures are drawn at any moment.

## 5. Readable in every palette

This section covers code, tables, Mermaid, contrast and focus. The rule: everything the reader draws takes its colours from the contract, and the contrast of every pair the reader uses is checked in every palette.

| Element | Today | With the contract |
|---|---|---|
| Body text, links, borders | Library light or dark palette | ccrc's ink, accent and edges |
| Tables | `--th-bg`, `--surface`, `--surface2`, `--border` | The same slots, from ccrc's raised and well surfaces |
| Code blocks | Library background, hard-coded `.hljs-*` hex | ccrc's well and `--syn-*` tokens. Wells stay dark in every palette, as in ccrc's chat |
| Mermaid | Fixed warm palette on a white plate, inverted by a filter in dark | Colours derived from the slots by the library's `mermaidThemeOf` (`surface`, `surface2`, `text`, `border`, `accent`). No plate and no filter while hosted |
| Focus | `outline: 2px solid var(--accent)` | The same rule on the `focus` slot, ccrc's accent |
| Semantic colours | `--ok`, `--wait`, `--no`, `--info` | ccrc's `--status-done`, `--status-attention`, `--status-dead` and `--acct-blue` |

**The contrast gate.** The library exports `APPEARANCE_PAIRS`: each pair of slots its stylesheet puts in front of one another, with a floor. Body text, links, table text, code tokens and Mermaid labels need 4.5:1. The focus ring, borders that bound controls, and Mermaid lines need 3:1. ccrc's test computes the mapped values for every palette, from `tokens.css` through the gate's existing parser (`pwa/design/audit.mjs`), and checks every pair. A palette that fails reds ccrc's suite before it reaches a reader. The library checks the same pairs on its own defaults.

## 6. Aa while hosted

This section settles what the frame's own Aa menu offers inside ccrc. One Aa stays, in the frame.

- **While hosted with an appearance, Aa has no theme row.** Global appearance has one owner, and a choice in the frame would be overridden at the next change anyway. In the row's place is one static line, with this exact copy: "Appearance follows ccrc Settings".
  - **Accessibility.** The line is plain text in the settings panel, in reading order where the theme row was. It is not a control, not focusable, and has no role beyond a paragraph, so a screen reader reads it with the panel. It is drawn in `text-muted` on `surface`, a pair in `APPEARANCE_PAIRS` at 4.5:1, so the §5 gate checks it in every palette.
  - **Who decides "hosted".** The host adapter decides, never the frame. The frame shows the line only when its mount carried an `appearance`. With no appearance, Aa keeps its theme row. That covers the reader lab, the library used on its own, and ccrc on the mode-only path (§7).
  - **No shortcut.** Aa has no Settings button in this design. A later wish for one rides the bridge's existing command vocabulary, or comes back as an ask.
- **Width, font and folds stay reader-local.** They are stored under `ccrc:reader:v1:` as today, and seeded back on mount.
- **A stale reader preference never wins.** With an appearance supplied, the frame ignores any stored `theme` in `pref:prefs`, and it never writes one. On the mode-only path (§7), the host keeps passing `theme` on every mount, as today, so the host value still wins (the library's precedence: defaults, then stored, then host).

## 7. Compatibility and fail-safe behaviour

This section says what happens when the two sides do not match, or a value is bad. In every case the reader stays readable and never falls back to the plain view over appearance.

There is no skew inside one mount. The host half and the frame half of a mount come from one package version, and the frame's scripts are pinned by hash (M8.12). Skew can only exist between ccrc's adapter and the library API it was built against, and the exact pin plus TypeScript make that a build error.

| Case | What happens | Why |
|---|---|---|
| Library without the contract (1.1.0) | The adapter finds no supported `APPEARANCE_CONTRACT` and sends today's `prefs.theme`. Aa keeps its theme row | 1.1.0 throws on an unknown adapter key, so the adapter must not send one. With the exact pin this is a build error, so the case is reached through a test seam only |
| Library contract newer than the adapter knows | Today's `prefs.theme`, until ccrc adopts it | The adapter supports an explicit set of contract versions |
| A mapped colour reads empty or not as a literal, at mount or while open | An appearance with `mode` and no colour group: the frame stays hosted, drops any host colours it had, and shows the library's colours for that mode. `console.warn('ccrc-reader: …')` once | Half a palette could put dark ink on a dark surface, and a stale palette left on screen would be worse. All or nothing per group is safe |
| A shape or font value is refused | That slot keeps the library default. Colours still apply | Shape and type cannot hurt contrast |
| The frame receives a malformed `appearance` op | The frame ignores the whole op and keeps the previous appearance | The same rule as any parent op the frame cannot use |
| A new ccrc skin or palette | Values flow with no reader change. The §5 gate reds a palette whose mapped pairs miss a floor | The library never sees ids, so an unknown skin cannot exist for it |
| The reader lab | Mounts with no appearance, as today | E17 and E18 readings stay comparable to the recorded phone blocks |

## 8. Boundaries and threat model

This section lists what does not change and what the new data could do. The standing boundaries are not reopened.

**Unchanged:**
- The reader sandbox is exactly `allow-scripts`, and the shell CSP is exactly `frame-src 'none'`.
- The frame's CSP is unchanged: its `style-src` and `font-src` already allow what the contract needs.
- There is no parent-DOM access from the frame, and no new channel, port or window listener.
- Both 2026-11-06 phone blocks stay byte for byte.

**What the new data is.**
- **Origin.** Colour, length and font values computed from ccrc's own stylesheets. A document cannot influence them: documents render inside the frame, never on ccrc's root.
- **Validation.** Both sides validate. The adapter validates with the library's own pure `parseAppearance` before sending. The frame validates again: closed keys; `#rrggbb` or `#rrggbbaa` only; lengths as whole pixels in range; no `;`, braces, `url(` or `var(`.
- **How values are written.** Through the CSSOM, onto library-owned custom property names. No stylesheet text is built from host input. Fonts load through the `FontFace` API from decoded bytes, under fixed family names.
- **Fonts.** These are ccrc's own bundled bytes. A malformed font would reach the browser's font parser inside an opaque-origin, script-pinned frame, which is the same exposure the library's own data-URL fonts have today. A face that fails to load is dropped (§2.2).
- **Exfiltration.** The frame learns ccrc's current colours. It has no way to send them anywhere: `default-src 'none'`, no network, and no new frame-to-parent op.
- **Rate.** A parent op costs the frame a repaint, plus a redraw of any drawn figure. Coalescing to one per animation frame bounds the ops. Cancelling queued redraws on a newer appearance bounds the figure work. The bridge's refusal count applies to frame-to-parent ops only, so a burst of host ops can never close the port.

## 9. Budgets

This section gives the numbers the implementation must keep. Geometry budgets are measured on both skins.

| Budget | Number | Measured by |
|---|---|---|
| Phone title at 412 x 915 | at most 61 px | `docs-compact-head` and `reader-frame` browser rows, both skins |
| Phone console part | at most 48 px | as above |
| Tap floor | 44 px | as above |
| Tablet and desktop fit | at most 1 px from a fresh BASE, per skin | as above |
| One bar on a phone | the frame's own bar off, ccrc's bar only, per skin | as above |
| Appearance payload | at most 4 KiB serialised, about 50 keys | unit row on the adapter's output |
| Ops while open | at most 1 per animation frame, latest wins | unit row with a fake clock |
| Hosted srcdoc growth | at most 192 KiB of characters over the same document at the 1.1.0 pin | `frame-cost` browser row (two faces of base64 are about 188 K) |
| Open to `ready` | hosted median of 9 opens at most 1.10 x the BASE median of 9, desktop Chromium, same runner | `frame-cost` browser row |
| Change while open | frame root shows the new values within 100 ms. Same iframe and nonce. Scroll within 1 px | `reader-appearance` browser row |
| Mermaid redraw | one figure per task, no single gap over E17's 200 ms | `reader-appearance` browser row |
| Contrast | 4.5:1 text, links, code, table and figure labels. 3:1 focus ring, control borders, figure lines | unit gate, every palette, both skins |

## 10. The library's part

This section is written for the library programme to plan from. It names the library by role, the shared rendering library, and proposes no new name. Its release, signed tag and ccrc's re-pin are the operator's.

**Version.** A minor release, additive only. The bridge protocol stays `v: 1`, because a frame that does not know the new op ignores it (rich-docs §3.8). A host that never passes the new key gets exactly today's behaviour.

**Interface (exports).**

| Export | Kind | What it is |
|---|---|---|
| `APPEARANCE_CONTRACT` (`./frame`) | number, `1` | The contract version. Absent in 1.1.0, which is how a host detects support |
| `APPEARANCE_SLOTS` (`./frame`) | readonly record | The closed slot names by group: `colour`, `skin`. The source of truth for both sides' tests |
| `APPEARANCE_PAIRS` (`./frame`) | readonly list | `{fg, bg, floor}` for every pair the stylesheet draws, derived colours included, expressed over the slots |
| `parseAppearance(x)` (`./frame`) | pure function | Returns `{ok: true, appearance}`, or `{ok: false, why, key}`. The same validator the frame runs |
| `mermaidThemeOf(colours)` (`./frame`) | pure function | Mermaid `themeVariables` derived from the slots. Documents still cannot set any theme key |
| `HostAdapters.appearance?` (`./host`) | adapter key | The contract value at mount. Validated with `parseAppearance`. Throws `TypeError` like any adapter key on a bad shape |
| `FrameAssets.fonts?` (`./host`) | asset | `{sans?: string, mono?: string}`, base64 woff2. Checked as §2.2 says, and dropped rather than thrown on failure |
| `DocFrame.setAppearance(a)` (`./host`) | method | Posts the `appearance` op after `ready`. Queued before `ready`, latest wins. Seeds later remounts |

The pure exports live in `./frame` because ccrc's import rule keeps `./host` to its one adapter file (`docs-scans.test.ts#LIBRARY_HOMES`), and ccrc's pure mapping module must read them.

**Frame behaviour.**
- An appearance is applied before first paint, from the seed, and in place from the op.
- With an appearance, the frame ignores stored theme, hides Aa's theme row, shows the one line §6 gives (plain text, not focusable), and never writes `theme`. Without one, Aa is exactly 1.1.0's.
- `.hljs-*` rules move onto the `syn-*` slots, with today's hex as their defaults, so a host that passes nothing sees no change.
- Tints, hover, table head, inline-code and bar backgrounds are derived from the base slots with `color-mix` in the stylesheet, and `APPEARANCE_PAIRS` covers the derived pairs.
- An appearance with no colour group removes every host colour and leaves the hosted state as it was.
- `skin.controlRow` sets popover row height under `(pointer: fine)` only. The frame's own bar and the reading layout (measure, prose size, gutters) never take a skin value.
- While hosted, the stored prefs object never carries `theme`.
- The frame's derived srcdoc cap rises by the fonts' cap.
- While hosted, Mermaid draws with `mermaidThemeOf`, with no white plate and no invert filter, and figures already drawn are redrawn on a change, nearest first, one per task.
- Optional: split the four inline fonts out of the stylesheet into font assets, so a host that supplies a sans face can leave the library's sans out. This would keep the srcdoc growth well under §9's 192 KiB.

**Tests the library ships.**
1. `parseAppearance`:
   - accepts every slot at the edges of its grammar;
   - refuses an unknown key, a nested value, a 3-digit hex, `rgb()`, `var(`, `url(`, a `;`, an out-of-range length and an oversize payload;
   - names the refused key.
2. Host API:
   - an unknown adapter key still throws;
   - `appearance` is accepted;
   - `setAppearance` before `ready` queues, and after `ready` posts exactly one op;
   - the op's keys equal the closed table.
3. Frame:
   - the seed paints before first frame;
   - an op applies without remount;
   - a malformed op changes nothing;
   - stored theme is ignored with an appearance and honoured without one;
   - Aa has no theme row with an appearance.
4. Conformance:
   - with no appearance, the rendered output and computed styles equal 1.1.0's for the corpus;
   - the default palette passes `APPEARANCE_PAIRS`.
5. Mermaid:
   - `mermaidThemeOf` output passes the pairs for both default modes;
   - a document's init directive still cannot set `themeVariables`, `themeCSS` or `darkMode`;
   - a newer appearance cancels redraws queued for an older one.
6. Hosted state:
   - an op with no colour group clears host colours;
   - while hosted, a `prefs` change never writes `theme`;
   - a font that fails its checks or `FontFace` load is dropped, and the mount reaches `ready`;
   - a document at the old srcdoc cap still mounts with both faces.
7. Boundaries: `frameCsp()` is byte-identical to 1.1.0, and so is the frame-to-parent op set.

**Compatibility.** A 1.1.0 host keeps working unchanged against the new version. The new version's frame ignores nothing a 1.1.0 host sends. A host built for the new version that is pinned back to 1.1.0 fails to build, and does not fail at run time.

## 11. Acceptance: Task 17's Appearance row

This section maps the design onto the completion plan's Task 17 "Required extension acceptance matrix" Appearance row, clause by clause. The leaf plan's acceptance rows (AP-1 to AP-8) are these, one to one. Each is run on the final installed release set, as F requires, and as a browser row in the implementing wave.

| Row | Task 17 clause | Installed action | Required observation |
|---|---|---|---|
| AP-1 | Both canonical skins | Open a doc under Refined and under Instrument | Frame root values equal the host's mapped values, and the frame's chrome, sans and mono faces are ccrc's, for each skin |
| AP-2 | All twelve palettes and Follow the system | Discover the catalogue from `THEMES` and the system choice at run time, then open a doc in each: 12 palettes, plus Follow the system with the device light and dark | 14 appearances x 2 skins = 28 opens, each matching the host values. The count is printed from the discovered catalogue, never typed |
| AP-3 | Host-selected appearance on ordinary open | Open with the chunk already loaded, with a stale reader theme stored (`{"theme":"dark"}` under a light palette, and the reverse) | The seed carries the appearance, and values at first `ready` equal the host's, not the stored theme's. Painting before first paint is the library's own test (§10). On a device, no light-then-dark flash is seen |
| AP-4 | Lazy open | Hold the reader chunk, change the palette and the skin during the hold, release | The seed carries the latest appearance, and at most one follow-up op is sent |
| AP-5 | Changes while open under the reviewed contract | Cycle through every palette, flip the system mode, switch skin | Applied in place: same iframe and nonce, scroll within 1 px, values within 100 ms, drawn figures redrawn in the new colours |
| AP-6 | Native chrome, typography, surfaces, focus, accessibility | Read text, links, a table, code and a drawn figure, and tab to a control, in every palette | Every `APPEARANCE_PAIRS` pair meets its floor on computed frame values. The focus ring is visible at 3:1. Aa shows no theme row and keeps width, font and folds |
| AP-7 | Retained phone and desktop geometry budgets | The `docs-compact-head` and `reader-frame` geometry rows on both skins | One bar on a phone. Title at most 61 px, console at most 48 px, tap 44 px. Tablet and desktop at most 1 px from BASE |
| AP-8 | No independent catalogue or mode-only substitution | Run the §3 scan, and open with a library that supports the contract | Scan green. The bridge sent `appearance`, not only `prefs.theme`. A deliberate mode-only mount is reported as a failure of this row |

## 12. Decisions

Each decision is a technical call within the operator's requirement, made and argued here. The one product choice, Aa's line while hosted, is recorded in Where things stand.

| # | Decision | Options considered | Chosen, and why | Status |
|---|---|---|---|---|
| X1-1 | Library interface | (a) token contract, values for closed slots; (b) the host passes its catalogue and the frame switches by id; (c) the library ships ccrc's palettes; (d) the host injects a stylesheet | (a). It is the only option with no second copy of the catalogue, and it carries exactly one appearance. (b) and (c) copy the catalogue. (d) is forbidden by the requirement | Proposed |
| X1-2 | Catalogue sharing | (a) read applied tokens from ccrc's root at run time; (b) a TS table generated from `tokens.css` at build time; (c) a hand-kept table | (a). It has zero copies, follows any new palette or skin, and reads exactly what the person sees. (b) is a derived copy that needs its own drift check. (c) is the copy the requirement forbids | Proposed |
| X1-3 | How a change while open travels | (a) a new parent op on the existing port; (b) widen `prefs` with appearance keys; (c) remount | (a). The `prefs` op is a closed set of enum words, and nested data breaks the parser's flat rule. (c) loses reading position and costs a full open | Proposed |
| X1-4 | Change signal | (a) observe the root's `data-theme` and `data-skin`; (b) subscribe to the two stores plus the media query | (a). It reads the applied outcome, so Follow the system flips and every writer are covered by one observer | Proposed |
| X1-5 | Bad values | (a) all or nothing per group, hosted with library colours on failure; (b) per slot; (c) fall back to the plain view | (a) for colour, (b) for skin slots and fonts. A partial palette can break contrast, and appearance never justifies losing the rich view | Proposed |
| X1-11 | Tints and composites | (a) base colours only, the library derives tints with `color-mix`; (b) carry ccrc's tint tokens and resolve them through a probe element | (a). ccrc's tints change form between palettes, so (b) needs a colour parser on both sides for no visible gain | Proposed |
| X1-6 | Typography | (a) pass ccrc's two faces as font assets; (b) the library ships Geist; (c) keep library faces | (a). One home for ccrc's typefaces, and the frame cannot fetch them. (b) couples the library to one host. (c) misses typography | Proposed |
| X1-7 | Density and controls | (a) carry the skin's radius, popover row height and section-label case, and keep the frame's bar and reading layout; (b) carry every skin token, the bar included; (c) radius only | (a). It aligns the controls a reader touches with the skin. The operator's own constraints fix the rest: the reading layout is kept, and the bar is held by the one-bar and desktop-fit budgets (at most 1 px). (b) breaks those budgets. (c) leaves density unaligned | Proposed |
| X1-8 | Code wells | (a) ccrc's dark wells in every palette; (b) follow the page in light palettes | (a). That is ccrc's own rule in chat and tool cards, and the contrast gate already holds `--syn-*` on the well | Proposed |
| X1-9 | Mermaid | (a) colours from the slots, redraw on change; (b) keep the neutral plate | (a). A white plate in a dark palette is the separate-destination look the operator asked to remove | Proposed |
| X1-10 | The reader lab | (a) no appearance; (b) the host appearance | (a). Its E17 and E18 readings stay comparable with the recorded blocks | Proposed |

**Deviations.** The design departs from two rich-docs sentences, defined in the leaf plan's `## Deviations found`:
- **D-8759, the bridge's parent op set.** Rich-docs §4.4 and M8.6 list exactly `prefs`, `changes.result`, `mermaid` and `command`. This design adds `appearance`, and §4.3's font row grows by ccrc's two faces.
- **D-8760, the hosted theme is not a reader preference.** Rich-docs §3.2's `prefs`, `chrome` row and G7 make theme a reader pref stored under the reader prefix. While hosted, it is ccrc's.

## 13. Promise delta

This design changes no Promise. It specifies required scope that the programme ledger already records, the operator's appearance requirement of 2026-11-10, and adds no capability or scenario.

```promise-delta
none - design of a recorded required follow-on of the native Docs reader programme; no Promise capability or scenario changes
```

## Where things stand

### Agreed
- The operator's requirement (2026-11-10) and its two coordinator defaults: follow changes while open, and Aa's global appearance follows ccrc while hosted.
- Standing boundaries: `allow-scripts`, `frame-src 'none'`, no parent-DOM access or extra channel, the two phone blocks byte for byte, the existing budgets, and the library exactly 1.1.0 in this wave.

- **Aa's line while hosted (ask 594, answered by the coordinator 2026-11-18, option 0).** Aa shows the one static line "Appearance follows ccrc Settings", with no button. Its accessibility is in §6. Outside ccrc, Aa keeps its theme row, as the host adapter decides. A Settings shortcut is not added: one would ride the bridge's existing command vocabulary, or come back as an ask.

### Waiting on you
- Nothing. The design's technical choices are recorded in §12. The library's release and ccrc's re-pin wait on you when the library change is ready (Later).

### Later
- The library's release and signed tag, and ccrc's exact re-pin: the operator's.
- Whether the standalone reader also adopts the token contract. Not needed: it is retired by the operator later.
