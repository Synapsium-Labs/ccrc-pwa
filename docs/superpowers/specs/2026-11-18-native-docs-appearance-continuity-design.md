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
- The bridge protocol is `v: 1`. A parent op the frame does not know is ignored. The frame's parser of parent ops accepts any plain object with own data properties and no proto keys, and checks each op through `OP_KEYS`. Nested values pass: `changes.result` already carries `ranges`, an array of integer pairs. The flat strings-and-numbers rule is the host's parser of frame-to-parent messages (`dist/host/parse.js`).
- The frame's CSP allows `style-src 'unsafe-inline' data:` and `font-src data:`. Its four fonts, Source Serif 4 and Source Sans 3, travel as `data:` inside its stylesheet: 413 096 base64 characters of the stylesheet's 549 069.

## 2. What crosses the bridge: a token contract

This section fixes the interface between ccrc and the library. ccrc sends values for a closed list of named slots. The library owns the list, the stylesheet that uses it, and the validation.

```mermaid
flowchart LR
  P["ccrc preference<br/>theme.ts and skin.ts"] --> R["Root stamp<br/>data-theme and data-skin"]
  R --> T["Applied tokens<br/>tokens.css and skins.css"]
  T --> M["Adapter reads mapped tokens<br/>one mapping table"]
  M --> C{"Library contract<br/>ccrc supports?"}
  C -->|yes| V["Library parseAppearance<br/>verdict slot by slot"]
  V --> A["Seed at mount<br/>appearance op while open"]
  C -->|no| F["Mode-only mount<br/>prefs.theme, as today"]
  A --> X["Frame root<br/>library-owned custom properties"]
  F --> X
```
*Figure 1. Where appearance comes from and how it reaches the frame. The catalogue stays on the left, and only resolved values cross. The library's own validator decides every value: a refused colour drops the colour group, and the frame stays hosted in the library's colours for the mode. A refused skin slot drops only itself. Only a library without a contract version ccrc supports, either none or a newer one, leaves ccrc on today's mode-only mount (§7).*

**The contract (library-owned).**
- `mode` is `light`, `dark` or `auto`: the resolved direction. It sets `color-scheme` and the library's defaults for any slot the host leaves out.
- `colour.<slot>` is one value per colour slot, `#rrggbb` only. Version 1 carries no alpha in a colour slot: no ccrc token mapped to one uses alpha, and a translucent `text` or `bg` would make §5's contrast numbers depend on what is behind it. Alpha appears only inside `popShadow`'s colour. The group is all or nothing. An appearance with no colour group is valid. It means "hosted, in the library's own colours for `mode`", and it clears any host colours applied before.
- `skin.<slot>` holds the skin's character, in ten slots, each falling back by itself (§2.3 says which ccrc token feeds each, and why the others are not carried):
  - `radius`, `radiusSmall` and `radiusLarge`: whole pixels from 0 to 24;
  - `controlRow`: whole pixels from 28 to 56, the height of rows in the frame's popovers, applied only under `(pointer: fine)`;
  - `popShadow`: the popovers' elevation, one to three shadows, each two to four lengths and one colour, with no `inset`, no other function and no keyword. Both forms ccrc uses fit, measured in every palette: Refined's `0 12px 40px rgba(0, 0, 0, 0.55)` (and `rgba(26, 32, 27, 0.22)` in light palettes), and Instrument's hairline `0 0 0 1px #5F697C` (one `--edge-strong` per palette);
  - the section-label type of the popovers' own headings: `sectionFamily` (`sans` or `mono`), `sectionSize` (whole px from 10 to 16), `sectionWeight` (100 to 900, in hundreds), `sectionTracking` (em from -0.1 to 0.3) and `sectionCase` (`none` or `uppercase`).

  "The popovers" are Aa, the changes menu, the cross-reference card, quick jump, the keys sheet and the contents drawer. Their headings are the frame's own chrome, never document headings.
- `label` is optional text for Aa's hosted line (§6): 1 to 64 UTF-16 code units, so a character outside the Basic Multilingual Plane counts as two. It is refused by Unicode general category, not by a list: if it holds any code point in `\p{Cc}` (controls), `\p{Cf}` (format characters, every bidi mark and isolate, the invisible operators, the soft hyphen, U+FEFF and the tag characters included), `\p{Zl}` (U+2028) or `\p{Zp}` (U+2029), or a lone surrogate (`\p{Cs}`, matched with the `u` flag). An empty label is refused. The frame renders it as text content, never as markup. When it is absent or refused, the frame shows a neutral default that names no host: "Appearance follows the app's settings". ccrc sends "Appearance follows ccrc Settings".
- `fonts` are optional faces for the frame's sans and mono roles, carried as font assets at mount (§2.2).

**The value grammars, exact.** The library's `parseAppearance` matches each value against one pattern, and ccrc sends each token's text exactly as `getPropertyValue` answers it. ccrc normalises nothing: no trim, no case change, no unit change. So both sides build from these patterns, and only from them:
- **Types.** `mode`, `label` and every value in `colour` and `skin` is a JSON string. A number is refused, even `600` for `sectionWeight`, where the string `"600"` is accepted. Unknown keys are refused and named, at the top level and in each group.
- **Spaces.** A value may begin and end with any number of ASCII spaces (U+0020), which the pattern ignores and the verdict drops, because a browser may keep the space after a custom property's colon. Inside a value, tokens are separated by exactly one U+0020, and shadows by a comma and one U+0020. Any other whitespace refuses the value: tab, line feed, carriage return, U+00A0, U+2028, U+2029, U+FEFF, and two spaces in a row.
- **Size.** A value whose `JSON.stringify` text is longer than 8 192 UTF-16 code units is refused whole: the verdict keeps only a valid `mode`, and `refused` holds one entry, `{key: '*', why: 'too-large'}`. ccrc's own payload budget is half that (§9).

| Key | Pattern, after the outer spaces | Range |
|---|---|---|
| `mode` | `light` \| `dark` \| `auto` | Anything else reads as `auto` |
| `colour.<slot>` | `#[0-9A-Fa-f]{6}`. Hex is case-insensitive. No alpha form | — |
| `radius`, `radiusSmall`, `radiusLarge` | `(0\|[1-9][0-9]?)px` | 0 to 24 |
| `controlRow` | `[1-9][0-9]px` | 28 to 56 |
| `popShadow` | `SHADOW(, SHADOW){0,2}`. `SHADOW` is `LEN LEN( LEN( LEN)?)? COLOUR`, single spaces between. `LEN` is `0` \| `0px` \| `-?[1-9][0-9]?px`. `COLOUR` is `#[0-9A-Fa-f]{6}` \| `#[0-9A-Fa-f]{8}` \| `rgba(INT, INT, INT, ALPHA)`, lower-case `rgba`, a comma and one space between arguments. `INT` is `0` \| `[1-9][0-9]{0,2}`, and `ALPHA` is `0` \| `1` \| `0\.[0-9]{1,3}` \| `1\.0{1,3}` | x and y offsets -64 to 64, blur 0 to 64, spread -8 to 8, `INT` 0 to 255 |
| `sectionFamily` | `sans` \| `mono` | — |
| `sectionSize` | `1[0-6]px` | 10 to 16 |
| `sectionWeight` | `[1-9]00` | 100 to 900 |
| `sectionTracking` | `-?0(\.[0-9]{1,3})?em` | -0.1 to 0.3 |
| `sectionCase` | `none` \| `uppercase` | — |
| `label` | §6's rule: 1 to 64 UTF-16 code units, refused by category (§2, `label`) | — |

Every pattern is anchored and bounded: the longest value any colour or skin pattern accepts is a three-shadow `popShadow` of 154 characters. No colour or skin pattern admits `;`, `{`, `}`, a `(` other than `rgba(`'s, `url(`, `var(`, a comment opener, a backslash or a quote. The label is free text, rendered as text only (§8).

**Base colours only.** Version 1's colour slots are base colours. The library derives every tint, hover, table head, inline-code and bar background from them with `color-mix` in its own stylesheet, because ccrc's own tints change form from palette to palette: `rgba(...)` in one, `color-mix(...)` in another. A coloured tint holds at most 4% of its colour, mixed over `bg` or `surface`, so every text colour keeps 4.5:1 on every tint, links and faint text included. Inline code never sits on a tint: its ground is the opaque `surface2` (§5, §10). Every semantic slot is a colour the library draws as text, so it maps to ccrc's text variant, never to a fill. The 33 slots:
- surfaces: `bg`, `surface`, `surface2`;
- ink: `text`, `text-muted`, `text-faint`;
- edges: `border`, `rule`;
- accent: `accent`, `accent-ink`, `focus`;
- semantic, drawn as text: `ok`, `wait`, `no`, `info`, `chg`;
- reference text: `term` (glossary terms), `id` (rule and fact ids), `violet` (the IMPORTANT alert title), `path` (code paths);
- code: `code-block-bg`, `code-ink`, and `syn-comment`, `syn-keyword`, `syn-string`, `syn-number`, `syn-function`, `syn-type`, `syn-tag`, `syn-attr`, `syn-punct`, `syn-deleted`, `syn-inserted`, which replace the hard-coded `.hljs-*` hex.

The list's home is the library's `APPEARANCE_SLOTS` export, and ccrc never spells it a second time (§3). Each ccrc token mapped to these slots was measured on 2026-11-18 to resolve to a plain `#rrggbb` in all twelve palettes, through `var()` chains, both default blocks merged. Every pair §5 names was measured against its floor, the Mermaid label and line pairs included (the leaf plan's Results, "Cross pairs").

**Why values and not a catalogue.** The frame needs one appearance at a time. The values for that appearance are all it can use, and they reveal nothing the frame could act on. A catalogue would put a second copy of ccrc's palettes in the library or in every seed (Decision X1-1, §12).

### 2.1 Carriage

- **At mount**, a new adapter key `appearance` carries the contract. The library writes each slot onto the frame root with the CSSOM (`style.setProperty` on a library-owned property name) before first paint. So the first painted frame is already in ccrc's colours.
- **While open**, `DocFrame.setAppearance(a)` posts one new parent op, `appearance`, on the existing port: `{t: 'appearance', v: 1, appearance: a}`, where `a` has exactly the contract's shape, `{mode, colour?: {<slot>: '#…'}, skin?: {<slot>: …}, label?}`. One spelling serves the adapter key, the op and the validator. An op whose value has no `colour` group drops host colours (§7).
- **Nothing flows back.** This contract adds no frame-to-parent op and no `store.set` key. The frame never tells ccrc what it applied.
- **Hosted means an appearance was seeded.** A mount whose adapters carried `appearance` is hosted for its whole life. While hosted, ccrc never calls `setPrefs` with a `theme`, and the frame never writes `theme` to `pref:prefs`. Its `prefs` path writes the whole prefs object, so the library leaves `theme` out of what it stores while hosted.

### 2.2 Fonts

ccrc's typefaces are part of its visual language, and the frame cannot fetch them (`default-src 'none'`). ccrc passes its own Geist and Geist Mono woff2 as two optional font assets, base64 text in `FrameAssets.fonts`, read once from the files the design system already ships.
- **Loading.** The library checks the base64 alphabet, a `wOF2` signature and a cap of 131 072 decoded bytes (128 KiB) per face, which is at most 174 764 characters of base64. ccrc's faces are 69 492 and 71 236 bytes. It then loads each face with the `FontFace` API from the decoded bytes, under a fixed family name. No CSS text is built from host input.
- **Failure.** A face that fails any check, or fails to load, is dropped silently, and that role keeps the library's own face. A bad font never throws, never refuses the mount and never falls back to the plain view. On the ccrc side, the fonts load on their own path, and a failed font load mounts without them, never through `onFallback('assets')`.
- **Size.** The library's derived srcdoc cap rises by exactly the two faces' cap, so fonts never push a document into `too-large`.
- **Use.** While hosted, the frame's sans role and its chrome use ccrc's UI face, and code uses ccrc's mono face. The serif reading face stays the library's. Font choice in Aa stays the reader's (§6).

### 2.3 The skin, token by token

The operator asked that controls and density align with the skin, and that the reading layout and the budgets be kept. So a skin token is carried when it touches neither the frame's bar nor the reading geometry. It is rejected, by name, when it would move either, or when the frame has no counterpart. Values were read from `ui/src/styles/tokens.css` and `skins.css` on 2026-11-18. Instrument's values at a width of 900 px or more, and under a fine pointer, follow a slash.

| ccrc token | Refined | Instrument | Verdict | Why |
|---|---|---|---|---|
| `--fs-ui` | 15 px | 15 / 13 px | Rejected | The frame bar's labels. 2 px of type at 900 px and above moves the desktop bar, against the 1 px desktop-fit budget |
| `--fs-prose` | 15 px | 15 / 14 px | Rejected | Prose size is the reading layout (the library's `--rem` and its 18 px serif) |
| `--fs-meta` | 12 px | 11 px | Rejected | The byline and meta lines sit in the document's title block, in the reading layout |
| `--fs-page` | 20 / 24 px | 14 px | Rejected | The document title, in the reading layout |
| `--fs-section` | 15 px | 11 px | Carried | `sectionSize`, popover headings only |
| `--weight-section` | 600 | 500 | Carried | `sectionWeight` |
| `--family-section` | UI face | mono face | Carried | `sectionFamily`: ccrc compares the token with its own `--family-ui` and `--family-mono` and sends the role |
| `--case-section` | none | uppercase | Carried | `sectionCase` |
| `--ls-section` | -0.011em | 0.08em | Carried | `sectionTracking` |
| `--gutter` | 16 / 24 / 32 px | 12 / 14 px | Rejected | The reading layout's gutters (the library's `--pad` and `--gut`) |
| `--row-h` | 52 px | 44 / 32 px | Carried | `controlRow`, popover rows under a fine pointer only. A coarse pointer keeps the 44 px tap floor |
| `--pad-card` | 16 px | 12 px | Rejected | The library's cards (callouts, figures) sit in the reading flow |
| `--gap-section` | 32 px | 20 px | Rejected | Spacing in the reading flow |
| `--page-max` | 760 px | 960 px | Rejected | The reading measure (the library's `--measure`, 44 rem) |
| `--page-max-wide` | 1120 px | none | Rejected | The library's break-out width for tables and figures (`--wide`), in the reading layout |
| `--measure-chat`, `--measure-chat-prose` | 1200 px, 90ch | 100%, 100ch | Rejected | Chat only. No counterpart in the frame |
| `--head-h` | 56 px | 44 / 40 px | Rejected | The frame bar (`--bar-h`, 48 px): the one-bar and desktop-fit budgets |
| `--section-flow` | column-reverse | row | Rejected | ccrc's page Section heads. No counterpart |
| `--r-sm` | 6 px | 3 px | Carried | `radiusSmall`: inline code, keycaps, pills |
| `--r-md` | 10 px | 5 px | Carried | `radius`: controls, code blocks |
| `--r-lg` | 14 px | 8 px | Carried | `radiusLarge`: popovers, callouts and figure cards. Radius is paint only |
| `--r-xl` | 20 px | 12 px | Rejected | Sheet and drawer top corners. The frame has no bottom sheet |
| `--elev-card` | a palette shadow | none | Rejected | No counterpart: the library's in-document cards draw no shadow (measured: figures and tables set `box-shadow: none`) |
| `--elev-pop` | `0 12px 40px` and a palette colour | `0 0 0 1px` and `--edge-strong` | Carried | `popShadow`, on every popover |
| `--meter-h`, `--meter-segments`, `--meter-gap` | 5 px, 1, 0 | 8 px, 10, 2 px | Rejected | The frame draws no meter. Reading progress shows on ccrc's own bar |
| `--dur-fast`, `--dur-base`, `--dur-slow` | 180, 240, 320 ms | 120 ms | Rejected | They time ccrc's sheets, card expands and shared-element moves, which the frame does not have. The frame's own hover and fold fades are 100 to 150 ms |

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
  | `ok`, `wait`, `no`, `info` | `--status-done-text`, `--status-attention-text`, `--status-dead-text`, `--ink-secondary` |
  | `chg` ("changed since") | `--acct-magenta`, whatever hue the palette gives it (X1-12) |
  | `term`, `id`, `violet`, `path` | `--acct-cyan`, `--acct-blue`, `--acct-violet`, `--ink-secondary` |
  | `code-block-bg`, `code-ink` | `--bg-well`, `--ink-on-well` |
  | `syn-<name>` (eleven) | `--syn-<name>` |
  | `radius`, `radiusSmall`, `radiusLarge` | `--r-md`, `--r-sm`, `--r-lg` |
  | `controlRow`, `popShadow` | `--row-h`, `--elev-pop` |
  | `sectionSize`, `sectionWeight`, `sectionTracking`, `sectionCase` | `--fs-section`, `--weight-section`, `--ls-section`, `--case-section` |
  | `sectionFamily` | `--family-section`, as a role: `mono` when it equals `--family-mono`, `sans` when it equals `--family-ui`, left out otherwise |
- A new palette, or a third skin, reaches the reader with no reader change: it is applied to the root, and the adapter reads it.
- Follow the system needs no special case. The root carries whichever palette the operating system picked, and the adapter reads that.

**The scan that reds a second copy.** A new test, `pwa/test/reader-appearance-source.test.ts`, has these four parts, and a fifth, §5's contrast gate:
1. **Slot coverage.** The mapping table's slots equal the library's `APPEARANCE_SLOTS`, in both directions.
2. **Every palette resolves.** For every palette `THEMES` lists, and for both skins, each mapped token resolves, through `var()` chains in `tokens.css` and `skins.css`, to a literal the library's validator accepts. A token that resolves to `color-mix(...)` or nothing reds here, not on a phone.
3. **No second list.** The scan covers `pwa/src/docs/`, `pwa/src/readerLab/` and `pwa/src/lib/appearance.ts`:
   - no file holds two or more palette ids, or two or more skin ids, as string literals or as object keys, quoted or not;
   - no file under `pwa/src/docs/reader/` holds a hex colour literal;
   - only `ReaderFrame.tsx` imports `THEMES`, for the mode-only fallback (§7), and no file imports `SKINS`.
4. **No stylesheet crosses.** Two checks:
   - at run time, over every value `readerAppearanceOf` builds in part 2, no string contains `;`, `{`, `}`, `url(` or `var(`. Every top-level key is `mode`, `label`, `colour` or `skin`, and every key inside `colour` or `skin` is a slot of that group in `APPEARANCE_SLOTS`;
   - in source, `appearance.ts` holds no such literal.

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

**Reading at the last moment.** The bridge reads the appearance synchronously, immediately before the synchronous `mountDocFrame`, after its last asset and Mermaid await. This is the point where D2 samples focus (D-8729), with no await in between. A change during the lazy chunk load or the asset wait is therefore already in the seed. The read happens once per library mount: since #3026, a same-page link's `openAt` builds the adapters again, and it reads again, beside the focus sample.

**After the mount resolves.** The mount reports whether it is hosted, as an explicit fact: hosted means the library's contract is supported and ccrc gave the bridge its root. A hosted mount also reports the stamp its seed was read under. `ReaderFrame` compares that stamp with the current one, as it does today for the mode (`seededPrefs`), and asks the mount to follow once, only if they differ. A change during the hold is already in the seed, so it sends nothing. A mount that is not hosted never reads the root.

**Who reads.** The bridge reads the root, both at mount and when asked to follow. The bridge is the lazily loaded module that carries the library, so `ReaderFrame`, in the main bundle, imports nothing of the library's. It holds only the stamp hook.

**While open.** On a stamp change, `ReaderFrame` asks the mount to follow. The bridge reads the values again and calls the library's `setAppearance`. Calls coalesce to one per animation frame, and the latest wins. The frame applies the values in place: no remount, the same iframe and nonce, and the reading position kept.

**A mode-only mount keeps today's trigger.** On a mode-only mount (§7), `ReaderFrame` keeps its existing effect on the derived mode (`readerPrefsOf`). The stamp alone would miss a change: on a dark device, Follow the system and Phosphor both leave `data-theme` unset, so the stamp does not move while the mode goes from `auto` to `dark`. A hosted mount needs no such trigger, because both choices then apply the same values.

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
  RF->>B: follow, once per animation frame
  B->>H: read mapped tokens again
  B->>F: appearance op on the port
  F->>F: apply in place, redraw drawn figures
```
*Figure 3. A lazy open with a change during the chunk load, then a change while open. The seed is read after the last await, so the first change needs no follow-up op. For the second, `ReaderFrame` asks the bridge to follow, and the bridge reads the root again and sends one `appearance` op on the existing port.*

**Mermaid on a change.** Figures already drawn are redrawn in the new colours, nearest first, one per task. Figures not yet drawn are drawn in the new colours when their turn comes. A newer appearance cancels the redraws still queued for an older one, so a burst never stacks redraws. Production stays on request (E17-READING does-not-hold), so few figures are drawn at any moment.

## 5. Readable in every palette

This section covers code, tables, Mermaid, contrast and focus. The rule: everything the reader draws takes its colours from the contract, and the contrast of every pair the reader uses is checked in every palette.

| Element | Today | With the contract |
|---|---|---|
| Body text, links, borders | Library light or dark palette | ccrc's ink, accent and edges. Edges are decorative, as in ccrc: no floor |
| Tables | `--th-bg`, `--surface`, `--surface2`, `--border` | The same slots, from ccrc's raised and well surfaces |
| Code blocks | Library background, hard-coded `.hljs-*` hex | ccrc's well and `--syn-*` tokens. Wells stay dark in every palette, as in ccrc's chat |
| Mermaid | Fixed warm palette on a white plate, inverted by a filter in dark | Colours derived from the slots by the library's `mermaidThemeOf`. The figure's ground is `surface` (the plate) and a node's fill is `surface2`. Labels are `text`. Lines, arrowheads and edges between nodes are `text-muted`, so they meet 3:1 on both grounds. Node borders are `border`, decorative like every edge, with the node told apart by its fill and label. Accent marks the highlighted node. No white plate and no filter while hosted |
| Focus | `outline: 2px solid var(--accent)` | The same rule on the `focus` slot, ccrc's accent |
| Reference text | `--term`, `--id`, `--violet`, `--path`, hard-coded per mode | ccrc's lane hues `--acct-cyan`, `--acct-blue`, `--acct-violet`, and `--ink-secondary` for paths, as each palette defines them |
| Semantic colours | `--ok`, `--wait`, `--no`, `--info`, `--chg` | ccrc's text variants `--status-done-text`, `--status-attention-text`, `--status-dead-text`, then `--ink-secondary`, and `--acct-magenta` for "changed since", as each palette defines them. Fills, dots and tints derive from them |
| Meaning | Colour, with some cues | Never colour alone. "Changed since" and a glossary term each carry a cue that is not colour (§10), because a palette may give `chg` the hue of `wait` or `violet`, and `term` no hue at all (X1-12) |

**The contrast gate.** The library exports `APPEARANCE_PAIRS`: each pair of colours its stylesheet puts in front of one another, with a floor. The list is not a sample of pairs someone found. It is a product: every text colour on every ground the stylesheet paints, so a link inside a changed block or faint text on a row tint is in it by construction.
- **The text colours:** `text`, `text-muted`, `text-faint`, `accent`, `accent-hover` and the nine semantic and reference slots (`ok`, `wait`, `no`, `info`, `chg`, `term`, `id`, `violet`, `path`).
- **The grounds:** `bg`, `surface`, `surface2`, and every coloured tint: `chg`, `wait`, `no` and `accent` at 4% over `bg`, and `chg` at 4% over `surface` (the summary box's changed items). The table head and the row hover are accent tints over `bg`, and inline code is drawn on `surface2`. The library ships a test that its stylesheet paints no other ground under text while hosted (§10).
- **4.5:1:** every text colour on every ground; `code-ink` and each `syn-*` on `code-block-bg`; `accent-ink` on `accent`; Mermaid labels (`text`) on `surface` and `surface2`.
- **3:1:** the focus ring (`focus`) on every ground, and Mermaid lines (`text-muted`) on `surface` and `surface2`, the figure's grounds while hosted.
- **No floor: edges.** `border` and `rule` are decorative, as ccrc's own gate treats its edges (`pwa/design/contrast-check.mjs` holds that no edge token clears 3:1 in every palette). Measured: `border` on `bg` is 1.54:1 at worst. A frame control is identified by its label, at 4.5:1, and by the focus ring, never by its border alone.

ccrc's test computes the mapped values for every palette through `pwa/test/helpers/paletteTokens.ts` (§3) and checks every pair. A palette that fails reds ccrc's suite before it reaches a reader. The library checks the same pairs on its own defaults. Measured 2026-11-18 under this map, in all twelve palettes, with each tint rounded to 8 bits as a browser paints it: every pair holds. The lowest are `text-faint` on `surface2` at 4.52 (Solarized Dark), `text-faint` on a tint at 4.57 (Catppuccin Latte), `accent` on `surface2` at 4.57 and `accent` on a tint at 4.64 (Phosphor Daylight). The focus ring is 4.57:1 at worst, on `surface2`. Why 4%, and why inline code is not a tint: at 6%, `text-faint` on the `no` tint falls to 4.44 and `accent` on the `chg` tint to 4.48. Inline code inside a link inside a changed block would put `accent` on a text tint over a coloured tint. That pair falls below 4.5 at every pair of caps from 3% to 6% (4.44 at 3% and 3%, Phosphor Daylight), so inline code takes an opaque ground the gate already checks.

## 6. Aa while hosted

This section settles what the frame's own Aa menu offers inside ccrc. One Aa stays, in the frame.

- **While hosted with an appearance, Aa has no theme row.** Global appearance has one owner, and a choice in the frame would be overridden at the next change anyway. In the row's place is one static line. Its text is the contract's `label`, which ccrc sends as "Appearance follows ccrc Settings". The library hard-codes nothing of ccrc's: without a label, it shows its neutral default, "Appearance follows the app's settings" (§2).
  - **Accessibility.** The line is plain text in the settings panel, in reading order where the theme row was. It is not a control, not focusable, and has no role beyond a paragraph, so a screen reader reads it with the panel. It is drawn in `text-muted` on `surface`, a pair in `APPEARANCE_PAIRS` at 4.5:1, so the §5 gate checks it in every palette.
  - **Who decides "hosted".** The host adapter decides, never the frame. The frame shows the line only when its mount carried an `appearance`. With no appearance, Aa keeps its theme row. That covers the reader lab, the library used on its own, and ccrc on the mode-only path (§7).
  - **No shortcut.** Aa has no Settings button in this design. A later wish for one rides the bridge's existing command vocabulary, or comes back as an ask.
- **Width, font and folds stay reader-local.** They are stored under `ccrc:reader:v1:` as today, and seeded back on mount.
- **A stale reader preference never wins.** With an appearance supplied, the frame ignores any stored `theme` in `pref:prefs`, and it never writes one. On the mode-only path (§7), the host keeps passing `theme` on every mount, as today, so the host value still wins (the library's precedence: defaults, then stored, then host).

## 7. Compatibility and fail-safe behaviour

This section says what happens when the two sides do not match, or a value is bad. In every case the reader stays readable and never falls back to the plain view over appearance.

Two terms, each with one meaning in this spec and its plan:
- **A mode-only mount** is a mount on a library without the contract (or with a contract newer than ccrc knows). ccrc sends `prefs.theme`, as today, and no `appearance`.
- **A hosted mount without colours** carries an `appearance` whose colour group the validator dropped. It stays hosted, in the library's colours for its `mode`.

There is no skew inside one mount. The host half and the frame half of a mount come from one package version, and the frame's scripts are pinned by hash (M8.12). Skew can only exist between ccrc's adapter and the library API it was built against, and the exact pin plus TypeScript make that a build error.

| Case | What happens | Why |
|---|---|---|
| Library without the contract (1.1.0) | The adapter finds no supported `APPEARANCE_CONTRACT` and sends today's `prefs.theme`. Aa keeps its theme row | 1.1.0 throws on an unknown adapter key, so the adapter must not send one. With the exact pin this is a build error, so the case is reached through the test seam only: `libraryContract`, answering a number or `'none'` |
| Library contract newer than the adapter knows | Today's `prefs.theme`, until ccrc adopts it | The adapter supports an explicit set of contract versions |
| A mapped colour reads empty or not as a literal, at mount or while open | An appearance with `mode` and no colour group: the frame stays hosted, drops any host colours it had, and shows the library's colours for that mode. `console.warn('ccrc-reader: …')` once | Half a palette could put dark ink on a dark surface, and a stale palette left on screen would be worse. All or nothing per group is safe |
| A skin slot or the label is refused | That slot keeps the library default. Colours still apply | Shape and type cannot hurt contrast |
| The frame receives an `appearance` op with bad values | The frame runs the same `parseAppearance` and applies its verdict, slot by slot, with the colour group all or nothing. Only a value that is not a plain object is ignored whole | One bad-value rule, the validator's, at mount and while open |
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
- **Validation.** Both sides validate. The adapter validates with the library's own pure `parseAppearance` before sending. The frame validates again, against §2's exact patterns: closed keys, strings only, single ASCII spaces, bounded digits and a size cap of 8 192 UTF-16 code units; no `;`, braces, `url(` or `var(`. A `popShadow` within its bounds paints at most a 64 px blur and an 8 px spread around a popover, and it reaches no URL.
- **The label.** It is the one free text that crosses. It is 1 to 64 UTF-16 code units, refused if it holds a code point of category `Cc`, `Cf`, `Zl` or `Zp` or a lone surrogate (§2), and set with `textContent`, so markup in it shows as its own characters and never renders. Refusing by category keeps an invisible or reordered label out, a spoof from a host that is trusted but mistaken.
- **How values are written.** Through the CSSOM, onto library-owned custom property names. No stylesheet text is built from host input. Fonts load through the `FontFace` API from decoded bytes, under fixed family names.
- **Fonts.** These are ccrc's own bundled bytes. They are the first binary bytes in the srcdoc that the library does not pin by hash: its own faces sit in a stylesheet that `frameDocument` checks against its manifest. So the library checks ccrc's faces by alphabet, signature and size, and ccrc pins them with a row: the bytes it passes are exactly the design system's font files. A malformed font would reach the browser's font parser inside an opaque-origin, script-pinned frame, and a face that fails to load is dropped (§2.2).
- **Exfiltration.** The frame learns ccrc's current colours. This contract gives it no way to send them anywhere: `default-src 'none'`, no network, and no frame-to-parent op of its own. Another design may add a frame-to-parent op additively, such as X2's figure images. That design argues its own threat model, and nothing here rules it out.
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
| Hosted srcdoc growth, in three parts | (1) ccrc's two faces: exactly 187 640 characters of base64, pinned to the files. (2) This contract's own library growth, measured at the library commit that lands it: its frame assets (guard, bootstrap, enhance, stylesheet) at most 32 768 characters over 1.1.0's 781 080 (its frame manifest's characters; 783 343 bytes). In the one library wave this contract lands first. Another design's additions in the same release, such as X2's, are measured from this contract's commit against a share of their own, which the coordinator sets when that design is accepted. The release's library growth is the sum of the shares. (3) The appearance seed: at most 4 096. So a hosted mount grows, over the same document at the 1.1.0 pin, by at most 224 504 characters plus the other designs' shares | (1) and (3): unit rows. (2): the library's test 8 at this contract's commit, and Task 1 Step 2a, which reads it and the release. (1) plus (3), at most 191 736 over a BASE taken at the new pin, which already holds every share: `frame-cost` browser row |
| Open to `ready` | hosted median of 9 opens at most 1.10 x the BASE median of 9, desktop Chromium, same runner | `frame-cost` browser row |
| Change while open | frame root shows the new values within 100 ms. Same iframe and nonce. Scroll within 1 px | `reader-appearance` browser row |
| Mermaid redraw | one figure per task, no single gap over E17's 200 ms | `reader-appearance` browser row |
| Contrast | 4.5:1 for every text colour on every ground and tint, code on the well and figure labels. 3:1 for the focus ring on every ground, and figure lines. Edges have no floor. Tints at most 4% | unit gate, every palette, both skins |

## 10. The library's part

This section is written for the library programme to plan from. It names the library by role, the shared rendering library, and proposes no new name. Its release, signed tag and ccrc's re-pin are the operator's.

**Version.** A minor release, additive only. The bridge protocol stays `v: 1`, because a frame that does not know the new op ignores it (rich-docs §3.8). A host that never passes the new key gets exactly today's behaviour.

**Interface (exports).**

| Export | Kind | What it is |
|---|---|---|
| `Appearance`, `AppearanceColourSlot`, `AppearanceSkinSlot` (`./frame`) | types | The contract value `{mode, colour?, skin?, label?}` and its slot-name unions, derived from `APPEARANCE_SLOTS` |
| `APPEARANCE_CONTRACT` (`./frame`) | number, `1` | The contract version. Absent in 1.1.0, which is how a host detects support |
| `APPEARANCE_SLOTS` (`./frame`) | readonly record | The closed slot names by group: `colour`, `skin`. The source of truth for both sides' tests |
| `APPEARANCE_PAIRS` (`./frame`) | readonly list | `{fg, bg, floor}` for every pair the stylesheet draws, derived colours included, expressed over the slots |
| `parseAppearance(x)` (`./frame`) | pure function | Never throws for a value. Returns `{appearance, refused}`: `appearance` is always usable, and `refused` lists `{key, why}` for each slot it left out. A refused colour drops the whole colour group. A refused skin slot or label drops itself. A bad `mode` reads as `auto`. The same validator the frame runs on the seed and on every op |
| `mermaidThemeOf(colours)` (`./frame`) | pure function | Mermaid `themeVariables` derived from the slots: `surface` for the background and cluster fill, `surface2` for node fill, `text` for every text colour, `text-muted` for `lineColor` and the arrowheads, `border` for node and cluster borders, `accent` for the highlighted node. Documents still cannot set any theme key |
| `APPEARANCE_LABEL_DEFAULT` (`./frame`) | string | "Appearance follows the app's settings": the line shown with no host label, naming no host |
| `HostAdapters.appearance?` (`./host`) | adapter key | The contract value at mount, taken through `parseAppearance`: a bad slot value never throws. Only a value that is not a plain object throws `TypeError`, like any adapter key |
| `FrameAssets.fonts?` (`./host`) | asset | `{sans?: string, mono?: string}`, base64 woff2. Checked as §2.2 says, and dropped rather than thrown on failure |
| `DocFrame.setAppearance(a)` (`./host`) | method | Posts the `appearance` op after `ready`. Queued before `ready`, latest wins. Seeds later remounts |

The pure exports live in `./frame` because ccrc's import rule keeps `./host` to its one adapter file (`docs-scans.test.ts#LIBRARY_HOMES`), and ccrc's pure mapping module must read them.

**Frame behaviour.**
- An appearance is applied before first paint, from the seed, and in place from the op.
- With an appearance, the frame ignores stored theme, hides Aa's theme row, shows the one line §6 gives (plain text, not focusable), and never writes `theme`. Without one, Aa is exactly 1.1.0's.
- `.hljs-*` rules move onto the `syn-*` slots, with today's hex as their defaults, so a host that passes nothing sees no change.
- Every colour that is not a slot derives from the slots with `color-mix` in the stylesheet, each by one stated rule. Every tint is an opaque mix, `color-mix(in srgb, <slot> 4%, <ground>)`:
  - `accent-hover` is `color-mix(in srgb, accent 80%, text)`, a text colour, gated like `accent`;
  - `accent-soft` (row hover, the flash, the index and quick-jump selection) and `th-bg` are `accent` at 4% over `bg`;
  - `wait-soft` and `wait-tint` are `wait` at 4% over `bg`, and `no-tint` is `no` at 4% over `bg`;
  - `chg-tint` is `chg` at 4% over `bg`, and `chg-soft` is `chg` at 4% over `surface`;
  - `chg-bg` is `chg-tint`, except inside the summary box (`.short`) and a waiting callout, where it is `chg` at 4% over `short-bg`. 1.1.0 mixes 7% there; this design lowers it to the same 4%;
  - `short-bg` is `surface`, so the summary box's ground is a gated ground and its changed items are a tint over `surface`;
  - `paper` and `topbar-bg` are `bg`, and `plate` is `surface` (§5: no white plate while hosted);
  - `code-inline-bg` is `surface2`, opaque. It is never a tint, because inline code sits inside links and tinted blocks, and a tint over a tint misses 4.5:1 (§5);
  - `code-comment` is `syn-comment`.

  `paper` and `chg-soft` are declared in 1.1.0 but drawn by no frame rule. They derive anyway, so a later rule finds them gated. No tint is mixed over `surface2`: measured, the accent over a tint on `surface2` is 4.23:1 at 6% and still 4.40:1 at 3% (Phosphor Daylight). On raised surfaces and in popovers, coloured text sits on the plain ground or on a tint mixed over `bg`, never on a tint mixed over `surface2`. `chg-x` is a length, not a colour, and stays the library's.
- **The grounds are closed.** While hosted, every background the stylesheet paints under text is one of §5's grounds. The library ships a test that walks the corpus's rendered elements and fails on any other computed background under text (test 4).
- **Meaning without colour.** A palette may give `chg` the hue of `wait` or `violet`, and `term` no hue (X1-12), so each meaning carries a cue that is not colour. Read from 1.1.0's frame stylesheet and enhance code:
  - **"Changed since", in words:** a section's heading mark reads "Changed since you read it" (`marks.js`), and the changes menu names each change. This holds in 1.1.0 and stays.
  - **"Changed since", in shape:** a changed block draws a 3 px bar in the margin, and a changed row a 3 px bar on its first cell. In 1.1.0 that shape is shared: an attention rule, a waiting callout, an attention task item and, in the stack layout, an attention row also draw a 3 px left bar on a tint. So in a palette where `chg` and `wait` look alike, the block marks differ by colour alone. While hosted, every changed block and row therefore draws a mark that no attention mark draws, differing in shape (the library chooses it, a double bar for example, within the margin the bar already uses, painting only, so no layout moves). Without an appearance, the mark stays 1.1.0's (test 4).
  - **A glossary term:** in running text, a dotted underline (`a.term`, 1.1.0), kept while hosted whatever `term`'s hue. In the glossary table, the term is the first cell of its row, set at weight 600, so its place names it.
- An appearance with no colour group removes every host colour and leaves the hosted state as it was.
- Skin slots style the popovers and their headings, the radii of controls, cards and code, and nothing else. `controlRow` applies under `(pointer: fine)` only. The frame's own bar and the reading layout (measure, prose size, gutters, title block) never take a skin value.
- `popShadow` replaces `--pop-shadow` on every popover, the quick jump, keys and contents drawer shadows included.
- While hosted, the stored prefs object never carries `theme`.
- The frame's derived srcdoc cap rises by the fonts' cap.
- While hosted, Mermaid draws with `mermaidThemeOf`, with no white plate and no invert filter, and figures already drawn are redrawn on a change, nearest first, one per task.
- The library's four faces stay inline in its stylesheet, exactly as in 1.1.0, so a host that supplies 1.1.0's four assets keeps working. ccrc's faces are additional, optional assets. Splitting the library's faces out would save at most its two sans faces, 76 364 characters (measured), and would change the asset set a 1.1.0-style host supplies, so it is not proposed.

**Tests the library ships.**
1. `parseAppearance`:
   - accepts every slot at the edges of its grammar, `popShadow` at three shadows, offsets of ±64, blur 64 and spread ±8 included;
   - leaves out a `popShadow` with `inset`, four shadows, a blur of 65, a spread of 9, `rgba(256, 0, 0, 1)`, `rgba(0, 0, 0, 1.5)` or `rgb(0, 0, 0)`;
   - leaves out, without throwing, an unknown key, a 3-digit hex, `rgb()`, `var(`, `url(`, a `;`, an out-of-range length and an oversize payload, and names each in `refused`;
   - **the forms ccrc sends:** accepts `#2E3440` and `#2e3440` in a colour slot and refuses `#2E3440FF` there, while `popShadow` accepts `0 0 0 1px #2E3440FF`; accepts the strings `"10px"`, `"600"` and `"-0.011em"`, and a value with leading and trailing U+0020; refuses the numbers `10` and `600`;
   - **whitespace and digits:** refuses a `popShadow` with a tab, a line feed, U+00A0, U+2028 or U+FEFF between tokens, or two spaces in a row, an alpha of `0.5555`, and a `sectionTracking` of `0.0800em`;
   - **size:** a value whose `JSON.stringify` text is 8 192 UTF-16 code units long is judged slot by slot, and one of 8 193 is refused whole, with `refused` equal to `[{key: '*', why: 'too-large'}]`;
   - one refused colour leaves out the whole colour group; one refused skin slot leaves out only itself;
   - a bad `mode` reads as `auto`.
2. Host API:
   - an unknown adapter key still throws;
   - `appearance` is accepted;
   - `setAppearance` before `ready` queues, and after `ready` posts exactly one op;
   - the op's keys are exactly `t`, `v` and `appearance`, and its value's keys are exactly the contract's (`mode`, `colour`, `skin`, `label`).
3. Frame:
   - the seed paints before first frame;
   - an op applies without remount;
   - a malformed op changes nothing;
   - stored theme is ignored with an appearance and honoured without one;
   - Aa has no theme row with an appearance.
4. Conformance:
   - with no appearance, the rendered output and computed styles equal 1.1.0's for the corpus;
   - the default palette passes `APPEARANCE_PAIRS`;
   - **closed grounds:** with an appearance, every element of the corpus that holds text has a computed background, its own or the nearest painted one behind it, equal to one of §5's grounds.
5. Mermaid:
   - `mermaidThemeOf` output passes the pairs for both default modes;
   - `mermaidThemeOf`'s `lineColor` is the `text-muted` it was given, and a drawn figure's edge paths have that computed `stroke`;
   - a document's init directive still cannot set `themeVariables`, `themeCSS` or `darkMode`;
   - a newer appearance cancels redraws queued for an older one.
6. The label:
   - a label of 64 UTF-16 code units shows whole, and one of 65 is refused, so the default shows. So is an empty label;
   - **astral characters count twice:** a label of 32 characters from outside the Basic Multilingual Plane (64 units) shows whole, and one of 33 (66 units) is refused;
   - a label holding U+0000, U+001B, U+007F, U+0085, U+202E or U+2066 is refused;
   - **by category, not by list:** a label holding U+061C (Arabic letter mark), U+206A, U+00AD, U+E0041 (a tag character), U+2028, U+2029 or a lone U+D800 is refused;
   - a label of `<b>x</b>` shows those eight characters, and the line holds no element;
   - with no label, the line is `APPEARANCE_LABEL_DEFAULT`, and the string `ccrc` appears nowhere in the library's built assets.
7. Hosted state:
   - an op with no colour group clears host colours;
   - while hosted, a `prefs` change never writes `theme`;
   - a font that fails its checks or `FontFace` load is dropped, and the mount reaches `ready`;
   - a document at the old srcdoc cap still mounts with both faces.
8. Size, by contract, in commit order. The library keeps one table of size shares: 1.1.0's frame-asset total as the baseline, then one row per design in the order its commit lands. This contract's commit adds the table and its own row, 32 768 characters. The test sums the four frame assets' characters from the generated frame manifest, and asserts the total is at most the baseline plus the sum of the shares listed. At this contract's commit the table holds one share, so the test measures this contract's own growth against 1.1.0. A later design, X2 for one, adds its own row in its own commit with the share the coordinator set, so its growth is measured from this contract's commit and never spends this contract's share.
9. Boundaries, pinned at this contract's commit:
   - **frame-to-parent ops:** the set of op names the frame sends equals the set at the commit before this contract's, which is 1.1.0's. The test lists that set, so the row compares before and after this contract and nothing else;
   - **parent-to-frame ops:** the set the frame accepts is the set before this commit plus `appearance`;
   - **the canonical CSP:** `frameCsp()` takes no argument and embeds one hash per inlined script, so its text changes whenever a frame script changes. The row asserts what this contract may not change: `frameCsp()` equals 1.1.0's value with each script hash source replaced by this version's. That is the same directives in the same order, the same sources other than hashes, and four hash sources, one per inlined script;
   - **behaviour:** the srcdoc's CSP meta and the iframe's `csp` attribute of a mount with an appearance and both fonts equal those of the same mount, at the same version, without them. And a spy on the port counts the frame-to-parent messages of a mount that gets a seed and then 20 `appearance` ops: the count equals that of the same mount and actions with no appearance.

   **Which of these constrain later additive work, and how:**
   - **Test 4** (with no appearance, the corpus equals 1.1.0's) constrains every later change to the no-appearance output. A later design whose new behaviour a document or host must ask for keeps it green. One that changes what an existing document renders re-baselines the test in its own commit and argues it in its own design.
   - **Test 8** constrains a later design only through the share table: each design adds its own row, and its growth is checked against its own share.
   - **Test 9** constrains nothing later. Its op lists and its CSP baseline are pinned at this contract's commit. A later design that adds an op, such as X2's figure-image op, adds it to the lists in its own commit, with its own threat model, and the row still holds. The behaviour rows hold at every version. They forbid only making the CSP or the frame-to-parent traffic depend on an appearance.
10. Meaning without colour, each with an appearance whose colours are chosen to collide (`chg` equal to `wait` and to `violet`, and `term` equal to `text`):
    - a heading mark in the changed state reads "Changed since you read it";
    - a changed block's mark and a changed row's mark (wide and stack layouts) differ from an attention rule's, a waiting callout's, an attention task item's and an attention row's in shape: their computed `box-shadow` and `border-left`, with every colour removed, are not equal;
    - `a.term` has a computed `text-decoration-line` of `underline` and `text-decoration-style` of `dotted`;
    - a glossary table's term cell is its row's first cell, at a computed `font-weight` of 600.

**One release for more than one design.** The library wave that carries this contract may also carry X2's figure-image op, a frame-to-parent op designed separately. The two have independent interfaces and tests. This contract's commit lands first in the wave, and each later design is measured from it: its size against its own share (test 8), and its ops against lists it extends (test 9). The coordinator sets X2's share when X2's design is accepted. This section designs only its own.

**Compatibility.** A 1.1.0 host keeps working unchanged against the new version. The new version's frame ignores nothing a 1.1.0 host sends. A host built for the new version that is pinned back to 1.1.0 fails to build, and does not fail at run time.

## 11. Acceptance: Task 17's Appearance row

This section maps the design onto the completion plan's Task 17 "Required extension acceptance matrix" Appearance row, clause by clause. The leaf plan's acceptance rows (AP-1 to AP-8) are these, one to one. Each is run on the final installed release set, as F requires, and as a browser row in the implementing wave.

| Row | Task 17 clause | Installed action | Required observation |
|---|---|---|---|
| AP-1 | Both canonical skins | Open a doc under Refined and under Instrument, open Aa, and read a popover heading | Per skin: every colour slot on the frame root equals the host's mapped value. The frame's chrome, sans and mono faces are ccrc's loaded faces. Popover rows, popover shadow, radii and the popover headings' family, size, weight, tracking and case equal the host's skin values. The frame bar's height and the reading layout (measure, prose size, gutters, title block) equal BASE as computed lengths, unchanged by the skin, on a fixture whose title and byline stay on one line in either face |
| AP-2 | All twelve palettes and Follow the system | Discover the catalogue from `THEMES` and the system choice at run time, then open a doc in each: 12 palettes, plus Follow the system with the device light and dark | 14 appearances x 2 skins = 28 opens. In each, every colour slot on the frame root equals the host's mapped value, and the frame's `color-scheme` equals the host's. The count is printed from the discovered catalogue, never typed |
| AP-3 | Host-selected appearance on ordinary open | Open with the chunk already loaded, with a stale reader theme stored (`{"theme":"dark"}` under a light palette, and the reverse) | The seed carries the appearance, and values at first `ready` equal the host's, not the stored theme's. Painting before first paint is the library's own test (§10). On a device, no light-then-dark flash is seen |
| AP-4 | Lazy open | Hold the reader chunk, change the palette and the skin during the hold, release | The seed carries the latest appearance, and at most one follow-up op is sent |
| AP-5 | Changes while open under the reviewed contract | Under the device in light and in dark: every palette to the next, every palette to Follow the system and back, the device mode flipping both ways while on Follow the system, and the skin switched both ways | Applied in place: same iframe and nonce, scroll within 1 px, values within 100 ms, drawn figures redrawn in the new colours |
| AP-6 | Native chrome, typography, surfaces, focus, accessibility | Read text, links, a table, code and a drawn figure, and tab to a control, in every palette | Every `APPEARANCE_PAIRS` pair meets its floor on computed frame values. The focus ring is visible at 3:1. "Changed since" and a glossary term each show their cue that is not colour (§10), in the palettes where their hue collides or is absent. Aa shows no theme row. Width, font and a fold, changed in Aa, are back after a reopen, and the stored prefs carry no `theme` |
| AP-7 | Retained phone and desktop geometry budgets | The `docs-compact-head` and `reader-frame` geometry rows on both skins | One bar on a phone. Title at most 61 px, console at most 48 px, tap 44 px. Tablet and desktop at most 1 px from BASE |
| AP-8 | No independent catalogue or mode-only substitution | Run the §3 scan, and open with a library that supports the contract | Scan green. The bridge sent `appearance`, not only `prefs.theme`. A deliberate mode-only mount is reported as a failure of this row |

## 12. Decisions

Each decision is a technical call within the operator's requirement, made and argued here. The one product choice, Aa's line while hosted, is recorded in Where things stand.

| # | Decision | Options considered | Chosen, and why | Status |
|---|---|---|---|---|
| X1-1 | Library interface | (a) token contract, values for closed slots; (b) the host passes its catalogue and the frame switches by id; (c) the library ships ccrc's palettes; (d) the host injects a stylesheet | (a). It is the only option with no second copy of the catalogue, and it carries exactly one appearance. (b) and (c) copy the catalogue. (d) is forbidden by the requirement | Proposed |
| X1-2 | Catalogue sharing | (a) read applied tokens from ccrc's root at run time; (b) a TS table generated from `tokens.css` at build time; (c) a hand-kept table | (a). It has zero copies, follows any new palette or skin, and reads exactly what the person sees. (b) is a derived copy that needs its own drift check. (c) is the copy the requirement forbids | Proposed |
| X1-3 | How a change while open travels | (a) a new parent op on the existing port; (b) widen `prefs` with appearance keys; (c) remount | (a). `prefs` carries the reader's own enum preferences, which the frame persists to `pref:prefs`. Appearance is ccrc's, must never be persisted (§6), and has its own validator. One op per meaning keeps both closed key tables simple. (c) loses reading position and costs a full open | Proposed |
| X1-4 | Change signal | (a) observe the root's `data-theme` and `data-skin`; (b) subscribe to the two stores plus the media query | (a). It reads the applied outcome, so Follow the system flips and every writer are covered by one observer | Proposed |
| X1-5 | Bad values | (a) all or nothing per group, hosted with library colours on failure; (b) per slot; (c) fall back to the plain view | (a) for colour, (b) for skin slots and fonts. A partial palette can break contrast, and appearance never justifies losing the rich view | Proposed |
| X1-12 | Semantic colours | (a) ccrc's text variants, with fills and tints derived; (b) ccrc's fill tokens; (c) separate text and fill slots | (a). The library draws these colours as text, and ccrc's fills miss 4.5:1 there: `--diff-add` is 1.69:1 in Phosphor Daylight, `--status-dead` 3.85:1 in Nord. (c) doubles the slots for no visible gain. Accepted with it: these are ccrc's own accent, lane and text colours, so the frame reads as ccrc does, and each slot takes what the palette defines (the coordinator's ruling on review 2657 F2). In some palettes `ok` (`--status-done-text`) is ccrc's secondary ink or near black, and `info` and `path` equal `text-muted`. `chg` (`--acct-magenta`) is magenta in most palettes, but orange beside `wait` in Tokyo Night (#FF9E64 against #E0AF68), and equal to `violet` in Nord, Gruvbox Dark and One Dark. `term` (`--acct-cyan`) is near black and has no hue in GitHub Light, Solarized Light and Catppuccin Latte (#000003, #000001, #000003). So meaning never rides on colour alone: "ok" counts and dots are told apart by their word, "changed since" by its words and its mark's shape, and a glossary term by its underline (§10, test 10), as on ccrc's own screens. No distinctness check is added to the gate: every cue is a shape or a word, so it holds whatever hues a palette chooses | Ruled |
| X1-11 | Tints and composites | (a) base colours only, the library derives tints with `color-mix`; (b) carry ccrc's tint tokens and resolve them through a probe element | (a). ccrc's tints change form between palettes, so (b) needs a colour parser on both sides for no visible gain | Proposed |
| X1-6 | Typography | (a) pass ccrc's two faces as font assets; (b) the library ships Geist; (c) keep library faces | (a). One home for ccrc's typefaces, and the frame cannot fetch them. (b) couples the library to one host. (c) misses typography | Proposed |
| X1-7 | Density and controls | (a) carry every skin token that touches neither the frame bar nor the reading geometry, and reject the rest by name; (b) carry every skin token, the bar included; (c) radius, row height and label case only | (a), token by token in §2.3 (the coordinator's ruling on review 2645 F3): radius, popover rows, popover elevation and the section-label type are carried; type sizes, gutters, measures, the bar height and card padding are rejected because they move the reading layout or a budget; meter, motion, chat measures and sheet corners have no counterpart. (b) breaks the one-bar and desktop-fit budgets. (c) left elevation and label type neither carried nor rejected | Ruled |
| X1-8 | Code wells | (a) ccrc's dark wells in every palette; (b) follow the page in light palettes | (a). That is ccrc's own rule in chat and tool cards, and the contrast gate already holds `--syn-*` on the well | Proposed |
| X1-9 | Mermaid | (a) colours from the slots, redraw on change; (b) keep the neutral plate | (a). A white plate in a dark palette is the separate-destination look the operator asked to remove | Proposed |
| X1-10 | The reader lab | (a) no appearance; (b) the host appearance | (a). Its E17 and E18 readings stay comparable with the recorded blocks | Proposed |

**Deviations.** The design departs from three rich-docs statements, defined in the leaf plan's `## Deviations found`:
- **D-8759, the bridge's parent op set.** Rich-docs §4.4's sentence and op table, and M8.6, list exactly `prefs`, `changes.result`, `mermaid` and `command`. This design adds `appearance`, and §4.3's font row grows by ccrc's two faces.
- **D-8760, the hosted theme is not a reader preference.** Rich-docs §3.2's `prefs`, `chrome` row and G7 make theme a reader pref stored under the reader prefix. While hosted, it is ccrc's.
- **D-8761, the frame handle gains `setAppearance`.** Rich-docs §3.2 gives `mountDocFrame`'s return as `{ update(d: RenderInput): void; setPrefs(p: Prefs): void; destroy(): void }`. This design adds `setAppearance(a)` to it.

## 13. Promise delta

This design changes no Promise. It specifies required scope that the programme ledger already records, the operator's appearance requirement of 2026-11-10, and adds no capability or scenario.

```promise-delta
none - design of a recorded required follow-on of the native Docs reader programme; no Promise capability or scenario changes
```

## Where things stand

### Agreed
- The operator's requirement (2026-11-10) and its two coordinator defaults: follow changes while open, and Aa's global appearance follows ccrc while hosted.
- Standing boundaries: `allow-scripts`, `frame-src 'none'`, no parent-DOM access or extra channel, the two phone blocks byte for byte, the existing budgets, and the library exactly 1.1.0 in this wave.

- **Aa's line while hosted (ask 594, answered by the coordinator 2026-11-18, option 0, with the label ruled at review 2645 F6).** Aa shows one static line, with no button. The host sends its text as the contract's validated `label`, and ccrc sends "Appearance follows ccrc Settings". Its accessibility is in §6. Outside ccrc, Aa keeps its theme row, as the host adapter decides. A Settings shortcut is not added: one would ride the bridge's existing command vocabulary, or come back as an ask.

- **Density and controls (review 2645 F3, ruled by the coordinator 2026-11-18).** Popover elevation and the section-label type are carried as skin slots, because they touch neither the frame bar nor the reading geometry. Every ccrc skin token is carried or rejected by name in §2.3.

### Waiting on you
- Nothing. The design's technical choices are recorded in §12. The library's release and ccrc's re-pin wait on you when the library change is ready (Later).

### Later
- The library's release and signed tag, and ccrc's exact re-pin: the operator's.
- Whether the standalone reader also adopts the token contract. Not needed: it is retired by the operator later.
