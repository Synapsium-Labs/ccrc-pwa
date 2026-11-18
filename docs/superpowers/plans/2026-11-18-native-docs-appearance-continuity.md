# Native Docs reader: appearance continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task, under the dispatched `ccrc-worker` role. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Docs reader frame opens in ccrc's selected skin and palette and follows changes while open. It uses ccrc's own colours, typefaces, radius and focus, and keeps the reading layout, figures, tables and every geometry budget.

**Architecture:** The shared rendering library gains a token contract: closed colour and shape slots, two optional font assets, one new parent op on the existing port, and a validator. ccrc reads the applied values of its own design tokens from the document root through one mapping table, and seeds the frame at mount. On a root change it sends the `appearance` op. The catalogue never leaves the design system, and a scan reds a second copy.

**Tech Stack:** TypeScript, React 19, package-local vitest, the existing browser harness (`vitest.browser.config.ts`, Chromium), the shared rendering library at the exact released version that carries `APPEARANCE_CONTRACT` 1 (not 1.1.0).

**Spec:** `docs/superpowers/specs/2026-11-18-native-docs-appearance-continuity-design.md`. Read it with this plan. Completion plan `docs/superpowers/plans/2026-11-07-native-docs-reader-completion.md` (Task 17's acceptance matrix) and rich-docs spec `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md` (§3.2, §4.3, §4.4, G7, M8.6, M8.12) are the context.

## Global Constraints

- Reader sandbox exactly `allow-scripts`; shell CSP meta exactly `frame-src 'none'`; no parent-DOM access from the frame, no extra channel, port or window `message` listener. A need to widen any of these stops the wave and is asked, never proposed.
- Both 2026-11-06 phone blocks stay byte for byte. Phone 412 x 915: title at most 61 px, console part at most 48 px, tap floor 44 px; tablet and desktop at most 1 px from a fresh BASE, measured per skin.
- The library version is exact (no `^`), and M8.12 still holds: CSP hashes equal the embedded script bytes, `assets.json` sha256 matches. Its release, signed tag and the exact version ccrc pins are the operator's.
- No second copy of the palette or skin catalogue anywhere under `pwa/src/docs/` or `pwa/src/readerLab/`; the only reader-side artefact is `READER_APPEARANCE_MAP`, a slot-to-token mapping.
- Two terms (spec §7): a *mode-only mount* is a library without a supported contract, which gets `prefs.theme` only; a *hosted mount without colours* carries an `appearance` whose colour group the validator dropped.
- One bad-value rule, the library's: the adapter builds the raw contract from ccrc's tokens and passes it through the library's `parseAppearance`, then sends only its verdict. ccrc spells none of the library's ranges or grammars. In the verdict, colour slots are all or nothing, and skin slots and the label fall back one by one. Appearance never drops the reader to the plain view.
- Contrast floors: 4.5:1 for every text colour on every ground the stylesheet paints, plain or tint, and for code tokens and figure labels; 3:1 for the focus ring on every ground and for figure lines; no floor for decorative edges. A coloured tint holds at most 4% of its colour, mixed over `bg` or `surface`. Inline code sits on the opaque `surface2`, never on a tint (spec §5, §10).
- Budgets: payload at most 4 KiB serialised; at most one `appearance` op per animation frame, latest wins; hosted srcdoc growth over the same document at the 1.1.0 pin in three parts: ccrc's two faces exactly 187 640 characters; this contract's own frame-asset growth at most 32 768 over 1.1.0's 781 099, measured at the library commit that lands it, with each later design in the release measured from that commit against its own share, which the coordinator sets; the appearance seed at most 4 096. So at most 224 504 plus the other designs' shares; hosted open-to-`ready` median of 9 opens at most 1.10 x the BASE median of 9; a change while open shows on the frame root within 100 ms, same iframe and nonce, scroll within 1 px; Mermaid redraw one figure per task, no gap over 200 ms.
- The reader lab mounts with no appearance (spec X1-10).
- Heavy tests, typecheck and browser runs go through `ccrc test`, in the foreground, with a timeout of at least 600000 ms. Mutations run in sequence from saved copies, and each is restored and hash-checked, never with `git checkout`.
- Commit on the workspace branch only. Private-name scan every changed file before each commit and before the push.

## Review Focus

| Failure mode | Expected behaviour | Owning test |
|---|---|---|
| The operating system flips light and dark while a Follow the system reader is open | The frame follows. The stored choice did not change, but the root did | Task 3 `useHostAppearance` "a system flip moves the stamp"; AP-5 |
| A palette whose mapped token is a `color-mix(...)` or a `var()` chain to nothing | Caught at test time for every palette. At run time, the frame stays hosted in the library's colours for the mode, with one warning, never a broken mix and never a stale palette | Task 2 source test part 2; Task 2 "one colour token answering `''`"; Task 4 "while open" |
| A burst of changes, such as cycling palettes in Settings | One op per animation frame and the last one wins. No refusal count builds up and the frame never closes | Task 5 "coalesces to the latest per frame" |
| A palette or skin change during the lazy chunk or the asset wait | The seed carries the latest, and no follow-up op is sent | Task 4 "reads after the last await"; Task 5 "after the mount resolves"; AP-4 |
| A stored reader theme from before the change (Aa set dark earlier) | Ignored while an appearance is supplied. The host's mode-only value still wins on the fallback path | Task 6 AP-3 (stored theme seeded); AP-M13 |

---

## Waves and order

| Wave | Who | What | Depends on |
|---|---|---|---|
| L | The library programme, in the library's repository | Spec §10: the contract, validator, frame application, font assets, `appearance` op, CSS on slots, Mermaid from slots, Aa hosted line, the library's own tests | This plan merged |
| R | The operator | The library's minor release and signed tag | L reviewed |
| C | One ccrc run (this plan's Tasks 1 to 7) | Exact re-pin, the appearance source, mapping, adapter, frame wiring, browser matrix, rich-docs amendments | R released. #3026 (D2) is merged (`839c05e46`, 2026-11-18), so D-8729's focus sample, beside which Task 4 reads, is on `main` |
| F | The coordinator, at completion Task 17 | AP-1 to AP-8 on the final installed release set | C merged, E reviewed |

No ccrc wave edits the library's repository. C does not start before R: its types and tests read the library's `APPEARANCE_SLOTS`, `APPEARANCE_PAIRS`, `APPEARANCE_CONTRACT` and `parseAppearance`, and it spells none of them itself. These pure exports come from the library's `./frame` entry. `docs-scans.test.ts#LIBRARY_HOMES` lets any file under `pwa/src/docs/reader/` import `./frame`, but only `bridge.ts` may import `./host`.

## File ownership (wave C)

| File | Ring | Task | Responsibility |
|---|---|---|---|
| `pwa/package.json`, `pwa/package-lock.json` | — | 1 | Exact re-pin |
| `pwa/src/docs/reader/appearance.ts` (new) | L1 | 2 | `READER_APPEARANCE_MAP`, `READER_APPEARANCE_CONTRACTS`, `READER_APPEARANCE_LABEL`, `readerAppearanceOf` |
| `pwa/test/reader-appearance.test.ts` (new) | — | 2 | Pure rule rows |
| `pwa/test/reader-appearance-source.test.ts` (new) | — | 2 | Slot coverage, every palette resolves, contrast pairs, second-copy scan |
| `pwa/test/helpers/paletteTokens.ts` (new) | — | 2 | `resolvePaletteTokens(themeId, skinId, pointer)`: both default blocks merged, `phosphor` as the default, the skin block and its `(pointer: fine)` arm, `var()` chains, `color-scheme` |
| `pwa/src/lib/appearance.ts` (new) | L4 | 3 | `useHostAppearance()` stamp |
| `pwa/test/host-appearance.test.tsx` (new) | — | 3 | Stamp rows |
| `pwa/src/docs/reader/hostAppearance.ts` (new) | L3 | 4 | `readHostAppearance(root, contract)` over `getComputedStyle`, imported by `bridge.ts` only |
| `pwa/src/docs/reader/assets.ts` | L3 | 4 | `loadReaderFonts()` |
| `pwa/src/docs/reader/bridge.ts` | L3 | 4 | `appearance` at mount, `seed`, `follow`, contract detection, fonts |
| `pwa/src/docs/reader/policy.ts` | L1 | 4 | `readerMountPlan` gains `appearance: boolean` |
| `pwa/test/reader-policy.test.ts` | — | 4 | The two `readerMountPlan` `.toEqual` rows gain the field |
| `pwa/test/reader-bridge.test.ts` | — | 4 | Bridge rows, and the two `readerMountPlan` rows of "readerMountPlan is the one decision" |
| `pwa/test/docs-scans.test.ts` | — | 4 | `hostAppearance.ts` and `appearance.ts` join `READER_ADAPTERS`, and `adapterUseAllowed` gains the three lazy edges between the bridge and them |
| `pwa/src/docs/ReaderFrame.tsx` | L4 | 5 | Seed, post-mount resend, follow, coalesce |
| `pwa/test/reader-frame.test.tsx` | — | 5 | Frame rows |
| `pwa/browser/reader-appearance.browser.test.ts` (new) | — | 6 | AP-1 to AP-6 and AP-8 browser rows |
| `pwa/browser/docs-compact-head.browser.test.ts`, `reader-frame.browser.test.ts`, `frame-cost.browser.test.ts` | — | 6 | Per-skin geometry and cost rows (AP-7, §9 budgets) |
| `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md` | — | 7 | D-8759, D-8760 and D-8761 amendments |

---

### Task 1: Re-pin the shared library to the contract release

**Files:**
- Modify: `pwa/package.json`, `pwa/package-lock.json`
- Test: the existing M8.12 rows, `pwa/test/reader-pin.test.ts` and `pwa/test/reader-assets.test.ts` (no new file)

**Interfaces:**
- Produces: from the library's `./frame` entry, `APPEARANCE_CONTRACT`, `APPEARANCE_SLOTS`, `APPEARANCE_PAIRS`, `parseAppearance`, `mermaidThemeOf` and the `Appearance` type. From its `./host` entry, `HostAdapters.appearance`, `FrameAssets.fonts` and `DocFrame.setAppearance`.

- [ ] **Step 1:** Re-read the release the brief names: registry entry, tarball integrity, attestation, signed tag. A difference from the brief stops the wave.
- [ ] **Step 2:** Set the exact version (no `^`) in `pwa/package.json` and install through the existing approved spine. `npm ls` of the library's package (the name `pwa/package.json` already carries) prints exactly that version.
- [ ] **Step 2a: Measure this contract's own growth, at its commit.** The brief names the library commit that lands this contract (the library wave's first) and the share of each design in the release, as the coordinator set them. Two reads, both read-only:
  - **This contract's share.** Read the library's generated frame manifest at that commit, as an immutable git object (`git -C <library repo> show <sha>:<manifest path>`, the paths the brief names), and sum the four frame assets' characters (guard, bootstrap, enhance, the frame stylesheet). Compare with 1.1.0's 781 099 (3 643, 30 153, 198 234 and 549 069, measured 2026-11-18). More than 32 768 over stops the wave and is reported. Also check that the library's test 8 share table at that commit holds exactly one row, this contract's 32 768.
  - **The release.** Sum the same four assets in the installed package's manifest. More than 1.1.0's total plus the sum of the shares the brief names stops the wave and is reported.

  Spec §9's budget is the library's to keep, and the shares are the coordinator's to set.
- [ ] **Step 3:** Run the M8.12 rows through `ccrc test` (`./node_modules/.bin/vitest run test/reader-pin.test.ts test/reader-assets.test.ts`). Expected: PASS, with the new script hashes read from the package, never typed.
- [ ] **Step 4:** Commit `pwa/package.json pwa/package-lock.json`: `deps(pwa): the shared library at <version>, the appearance contract`.

### Task 2: The mapping table and the one-source scan

**Files:**
- Create: `pwa/src/docs/reader/appearance.ts`, `pwa/test/reader-appearance.test.ts`, `pwa/test/reader-appearance-source.test.ts`, `pwa/test/helpers/paletteTokens.ts`

**Interfaces:**
- Consumes: Task 1's `APPEARANCE_SLOTS`, `APPEARANCE_PAIRS`, `APPEARANCE_CONTRACT`, `parseAppearance` and the `Appearance` type, all from the library's `./frame` entry.
- Produces:

```ts
export type HostToken = `--${string}`;
export const READER_APPEARANCE_MAP: {
  readonly colour: { readonly [S in AppearanceColourSlot]: HostToken };
  readonly skin: { readonly [S in AppearanceSkinSlot]: HostToken };
};
export const READER_APPEARANCE_CONTRACTS: readonly number[]; // [1]
export const READER_APPEARANCE_LABEL = 'Appearance follows ccrc Settings'; // the contract's label, ruled copy (ask 594)
export type ReaderAppearanceOutcome =
  | { readonly kind: 'appearance'; readonly value: Appearance;
      /** The library verdict's own list: each key it left out, and why. */
      readonly refused: readonly { readonly key: string; readonly why: string }[];
      /** `null`: every colour applied. Otherwise the colour group was dropped (spec §7). */
      readonly dropped: null | { readonly why: 'colour-unreadable' | 'scheme-unreadable'; readonly token: string } }
  | { readonly kind: 'mode-only'; readonly why: 'contract-unsupported' };
export function readerAppearanceOf(
  read: (token: HostToken) => string, colourScheme: string, contract: number | 'none',
): ReaderAppearanceOutcome;
// pwa/test/helpers/paletteTokens.ts
export function resolvePaletteTokens(
  themeId: string, skinId: string, pointer: 'fine' | 'coarse',
): { readonly tokens: ReadonlyMap<string, string>; readonly colourScheme: string };
```

The map is spec §3's table, slot for slot. Each mapped colour token was measured to resolve to `#rrggbb` in all twelve palettes, and every pair to meet its floor (2026-11-18, Results, "Contrast under the map"). A pair that misses its floor under this map in some palette stops the wave and is reported. It is not remapped silently.

- [ ] **Step 1: Write the failing pure rows** in `reader-appearance.test.ts`:
  - `readerAppearanceOf` builds the raw contract, each value the token's text exactly as `read` answers it (spec §2's grammars: ccrc normalises nothing, no trim and no case change), and returns `parseAppearance`'s verdict. It checks no range or grammar of its own:
  - `readerAppearanceOf`:
    - **every mapped token:** with a reader answering every mapped token, contract `1` and `'dark'`, it is `kind 'appearance'`. The keys of its value's `colour` equal `APPEARANCE_SLOTS.colour`, and the keys of its `skin` equal `APPEARANCE_SLOTS.skin`, both ways. Its `refused` list is empty, `dropped` is `null`, and its `label` is `READER_APPEARANCE_LABEL`;
    - one colour token answering `''` gives `kind 'appearance'` with `mode` set, no colour group, and `dropped: {why:'colour-unreadable', token}`;
    - an unreadable skin token keeps every colour, leaves that slot out, and has `dropped: null`;
    - contract `'none'` (a library without the contract) and contract `2` (one newer than ccrc knows) each give `{kind:'mode-only', why:'contract-unsupported'}`;
    - a `colourScheme` of `'normal'` or `''` gives `mode: 'auto'`, no colour group, and `dropped.why: 'scheme-unreadable'`;
    - a skin token whose value the library refuses (for example `--row-h` answering `'60px'`) is left out by the verdict, and every colour stays;
    - **text as read:** with `--bg-page` answering `'#2E3440'` and `--r-md` answering `' 10px'` (a leading space, as an engine may keep it), the raw contract `readerAppearanceOf` passes to `parseAppearance` (a spy) carries `'#2E3440'` and `' 10px'` unchanged, the verdict's `colour.bg` is `'#2E3440'` and its `skin.radius` is `'10px'` (the library drops outer spaces), and `refused` is empty;
    - **strings only:** every value in the built raw contract is a string (`typeof` over every leaf), `sectionWeight` included;
    - **section family:** with `--family-section` answering the same text as `--family-mono`, `sectionFamily` is `'mono'`; with it equal to `--family-ui`, `'sans'`; with any other text, the slot is left out;
    - its serialised value is at most 4096 bytes.
  - `resolvePaletteTokens`:
    - `('phosphor', 'refined', 'coarse')` answers `--r-md` as `'10px'` (the second default block) and `colourScheme` `'dark'`;
    - `('nord', 'instrument', 'fine')` answers `--row-h` as `'32px'` and `--bg-page` as `'#2E3440'`;
    - a `var()` chain is followed: `--status-done` answers a hex in `'light'`.
- [ ] **Step 2: Write the failing source rows** in `reader-appearance-source.test.ts`, in five describes. Parts 1 to 4 are spec §3's scan, in its order, and part 5 is spec §5's contrast gate:
  1. **Coverage:** the slot keys of `READER_APPEARANCE_MAP` equal `APPEARANCE_SLOTS`, in both directions.
  2. **Every palette resolves:** for each id in `THEMES`, each skin in `SKINS`, and each pointer, `resolvePaletteTokens` answers every mapped token, and the verdict `readerAppearanceOf` returns has `dropped: null` and an empty `refused` list: every colour, every skin slot and the label are accepted. Each palette's `color-scheme` is `light` or `dark`, equal to its `THEMES` row's `mode`. The case title names the palette, skin, pointer and token. (`audit.mjs` is not reused: it keys the default palette `DARK`, reads only the first `:root` block, and never reads `skins.css` or `color-scheme`.)
  3. **No second list**, over `pwa/src/docs/`, `pwa/src/readerLab/` and `pwa/src/lib/appearance.ts`:
     - no file holds two or more `THEMES` ids, or two or more `SKINS` ids, as string literals or as object keys, quoted or not;
     - no file under `pwa/src/docs/reader/` holds a hex colour literal;
     - only `pwa/src/docs/ReaderFrame.tsx` imports `THEMES`, and no file imports `SKINS`.
  4. **No stylesheet crosses:**
     - at run time, no string in any value `readerAppearanceOf` builds in part 2 contains `;`, `{`, `}`, `url(` or `var(` (except `popShadow`'s own bounded `rgba(`), and no key falls outside `APPEARANCE_SLOTS`, `mode` and `label`;
     - in source, `appearance.ts` holds no such literal.
  5. **Contrast (spec §5):** for each palette and each skin, every `APPEARANCE_PAIRS` entry over the mapped values meets its floor. The pairs are the library's product of text colours and grounds, so the cross pairs are in it: a link on the `chg` tint, inline code on `surface2` inside a link, `text-faint` on a row tint, and the summary box's `chg` tint over `surface`. Each tint is computed as the library's stated mix, rounded to 8 bits per channel as a browser paints it. The number of palettes checked equals `THEMES.length`, read at run time, never a typed 12. The case title names the palette, the pair and the measured ratio.
- [ ] **Step 3: Run both to red.** `ccrc test -- ./node_modules/.bin/vitest run test/reader-appearance.test.ts test/reader-appearance-source.test.ts` from `pwa/`. Expected: FAIL, the module is missing.
- [ ] **Step 4: Implement `appearance.ts` and the helper.** `appearance.ts` is pure (ring L1): no `document`, no `getComputedStyle`. `readerAppearanceOf` takes `mode` from `colourScheme`, trimmed: `'light'` or `'dark'`. Anything else is `'auto'` with the colour group dropped. Every palette block declares `color-scheme` (measured 2026-11-18), and part 2 pins that per palette.
- [ ] **Step 5: Run to green**, same command. Expected: PASS.
- [ ] **Step 6: Commit** the four files: `feat(docs): the reader's appearance map and its one-source scan`.

### Task 3: The host appearance stamp

**Files:**
- Create: `pwa/src/lib/appearance.ts`, `pwa/test/host-appearance.test.tsx`

**Interfaces:**
- Produces: `export function useHostAppearance(): string`. The stamp is `` `${data-skin ?? ''}|${data-theme ?? ''}` `` of `document.documentElement`, kept by one `MutationObserver` with `attributeFilter: ['data-skin', 'data-theme']`, through `useSyncExternalStore`.

- [ ] **Step 1: Write the failing rows:**
  - renders the current stamp;
  - `applyTheme('nord', root, false)` re-renders with `|nord`;
  - `applySkin('instrument', root)` re-renders with `instrument|`;
  - **a system flip moves the stamp:** with stored choice `system`, `initTheme` given a fake media query that flips to light moves the stamp to `|light`;
  - a change to any other attribute does not re-render;
  - unmounting the last subscriber disconnects the observer.
- [ ] **Step 2: Run to red** (`test/host-appearance.test.tsx`). Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement** `useHostAppearance` in `pwa/src/lib/appearance.ts`. It has one observer shared by all subscribers, created on first subscribe.
- [ ] **Step 4: Run to green.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(pwa): one stamp for the applied appearance`.

### Task 4: The bridge carries the appearance

**Files:**
- Create: `pwa/src/docs/reader/hostAppearance.ts`
- Modify: `pwa/src/docs/reader/bridge.ts`, `pwa/src/docs/reader/assets.ts`, `pwa/src/docs/reader/policy.ts`, `pwa/test/reader-bridge.test.ts`, `pwa/test/reader-policy.test.ts`, `pwa/test/docs-scans.test.ts`

**Interfaces:**
- Consumes: Task 2's `readerAppearanceOf`, `ReaderAppearanceOutcome`; Task 1's `APPEARANCE_CONTRACT`, `HostAdapters.appearance`, `FrameAssets.fonts`, `DocFrame.setAppearance`.
- Produces:

```ts
// hostAppearance.ts (L3). Imported by bridge.ts only, so the library stays in the lazily loaded chunk.
export function readHostAppearance(root: HTMLElement, contract: number): { readonly stamp: string; readonly outcome: ReaderAppearanceOutcome };
// assets.ts
export function loadReaderFonts(): Promise<{ readonly sans: string; readonly mono: string }>; // base64 woff2
// bridge.ts: ReaderMountInput gains
readonly appearanceRoot?: HTMLElement;              // ccrc's document root. Absent: no appearance is read (the lab)
// ReaderMountDeps gains
readonly libraryContract?: () => number | 'none';   // the skew seam; absent, the library's ./frame APPEARANCE_CONTRACT, or 'none' when it exports none
readonly fonts?: () => Promise<{ sans: string; mono: string }>;
// ReaderMount gains
readonly seed: { readonly hosted: true; readonly stamp: string } | { readonly hosted: false };
follow(theme: 'light' | 'dark' | 'auto'): void;     // hosted: re-read the root and send DocFrame.setAppearance; not hosted: setPrefs({theme})
```

- **Hosted, explicitly.** A mount is hosted when its contract answer is supported and it was given an `appearanceRoot`. The bridge decides this before any read. A mount that is not hosted never reads the root. `seed` says which case holds, with no overloaded null.
- `readHostAppearance` calls `getComputedStyle(root)` once, and reads `color-scheme` and the mapped tokens through `getPropertyValue`. Its stamp has the same shape as Task 3's. It runs `readerAppearanceOf`, so it imports `appearance.ts`, which imports the library's `./frame` entry. Only `bridge.ts` imports it, and the main bundle reaches `bridge.ts` only through `lazyMountReader`'s dynamic import. `ReaderFrame.tsx` imports neither file by value.
- `loadReaderFonts` reads the design system's own `Geist-Variable.woff2` and `GeistMono-Variable.woff2` through an inline asset import: `@/fonts/Geist-Variable.woff2?inline` and `@/fonts/GeistMono-Variable.woff2?inline`, through pwa's `@` alias to `ui/src` (`pwa/vite.config.ts`). It strips the `data:` prefix to the base64. No font file is copied into `pwa/`. The fonts load on their own path, beside the assets. If they fail, the bridge mounts without `fonts`, and never calls `onFallback('assets')` for them.
- On a hosted mount, `follow` re-reads the root and sends `DocFrame.setAppearance` with the verdict, a verdict with no colour group included. It never calls `setPrefs` with a theme. On a mount that is not hosted, it sends `setPrefs({theme})`.

- [ ] **Step 1: Write the failing rows** in `reader-bridge.test.ts`, with a fake `mount`:
  - **reads after the last await:** hold `deps.assets`, change the root's tokens and `data-theme` while held, release. The adapters' `appearance` is the post-release verdict, `seed` is `{hosted: true, stamp}` with the post-release stamp, and the root was read exactly once per library mount, with no await between that read and `mount`. An `openAt` remount, which rebuilds the adapters, reads once more, and its stamp updates `seed`;
  - **an outcome of kind `appearance`** passes `adapters.appearance` and `assets.fonts`, and passes no `prefs.theme`;
  - **a dropped colour group** still passes `adapters.appearance`, with `mode` and no `colour` group;
  - **fonts that fail to load** mount without `fonts`, and `onFallback` is never called;
  - **the faces are ccrc's files:** the base64 `loadReaderFonts` answers decodes to bytes whose sha256 equals the sha256 of `ui/src/fonts/Geist-Variable.woff2` and `ui/src/fonts/GeistMono-Variable.woff2`, read from disk in the test;
  - **an older library:** with `deps.libraryContract` answering `'none'`, and `deps.mount` throwing `TypeError` on any key outside 1.1.0's set, the mount succeeds as a mode-only mount: `prefs.theme`, no `appearance`, no `fonts`, `seed` `{hosted: false}`, and the root is never read (a spy on `getComputedStyle` sees no call). With `deps.libraryContract` answering `2`, the same. This seam is the only way to reach the case: with the exact pin it is a build error;
  - **while open, hosted:** `follow` re-reads the root and calls `DocFrame.setAppearance` once, including for a dropped colour group, and never `setPrefs`;
  - **while open, mode only:** `follow` calls `DocFrame.setPrefs({theme})` once and reads nothing;
  - **after `destroy()`**, `follow` does nothing;
  - **the lab:** with `profile: 'lab-draw'`, no `appearance` is passed, `seed` is `{hosted: false}` and the root is never read;
  - **the plan:** in `reader-policy.test.ts`, the Docs row (`readerMountPlan(undefined, 100, chrome, e17)`) expects `{ draw: docsDrawFor(e17), watchdogMs: readerWatchdogMs(100), store: true, chrome, history: true, appearance: true }`, and the lab row (`readerMountPlan('lab-draw', …)`) expects `{ draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false, chrome: 'frame-bar', history: false, appearance: false }`. Both rows exist on `main` today without the field, so they go red until Step 3. So do the two rows of `reader-bridge.test.ts`'s case "readerMountPlan is the one decision, and only lab-draw maps to drawing on open", which gain `appearance: false` (lab-draw) and `appearance: true` (Docs);
  - **the main bundle stays library-free:** in `docs-scans.test.ts`:
    - `READER_ADAPTERS` becomes `['src/docs/reader/bridge', 'src/docs/reader/assets', 'src/docs/reader/hostAppearance', 'src/docs/reader/appearance']`;
    - `adapterUseAllowed(file, target, dynamic)` keeps its two arms and gains exactly three, each a static value import made inside the lazily loaded chunk: `bridge.ts` → `src/docs/reader/hostAppearance` (the read), `bridge.ts` → `src/docs/reader/appearance` (`READER_APPEARANCE_CONTRACTS`, for the support check), and `hostAppearance.ts` → `src/docs/reader/appearance` (`readerAppearanceOf`). Without them, the existing "M8.10" case reds `main-bundle:value-import` on the plan's own imports;
    - a new case in clause W8a plants, in a tree copy, a value import of `hostAppearance` and one of `appearance` in `src/docs/ReaderFrame.tsx`, and one of `appearance` in `src/docs/DocsHead.tsx`. Each answers `main-bundle:value-import`, and the unplanted tree answers none;
  - **the key set:** the adapters' key set is the existing set plus `appearance`, exactly;
  - **only the verdict is passed:** with a reader whose `--r-md` answers `'99px'`, the adapters' `appearance` has no `radius`, and the fake `mount` (which throws on any value `parseAppearance` would leave out) does not throw.
- [ ] **Step 2: Run to red** (`test/reader-bridge.test.ts test/reader-policy.test.ts test/docs-scans.test.ts`). Expected: FAIL on the new rows and the four changed `readerMountPlan` rows (two in each file) only. `docs-scans` stays green here: no source imports the new modules yet, and its planted case passes on a tree copy once `READER_ADAPTERS` names them.
- [ ] **Step 3: Implement.**
  - Contract detection asks `deps.libraryContract`. Its default reads `APPEARANCE_CONTRACT` from a namespace import of the library's `./frame` entry, and answers `'none'` when that export is absent. The answer is checked against `READER_APPEARANCE_CONTRACTS`.
  - The read sits beside D-8729's focus sample, after the Mermaid wait and before `mountDocFrame`, with no await between.
  - The lab path is decided by `readerMountPlan`, which gains `appearance: boolean`: `false` for `lab-draw`.
- [ ] **Step 4: Run to green:** `test/reader-bridge.test.ts test/reader-policy.test.ts test/docs-scans.test.ts`. Expected: PASS, with `docs-scans`' "M8.10" case green over the three new edges.
- [ ] **Step 5: Commit**: `feat(docs): the reader bridge carries ccrc's appearance`.

### Task 5: The frame follows the host

**Files:**
- Modify: `pwa/src/docs/ReaderFrame.tsx`, `pwa/test/reader-frame.test.tsx`

**Interfaces:**
- Consumes: Task 3's `useHostAppearance`; Task 4's `ReaderMountInput.appearanceRoot`, `ReaderMount.seed` and `ReaderMount.follow`, as types. It imports no value from the four `READER_ADAPTERS` (`bridge.ts`, `assets.ts`, `hostAppearance.ts`, `appearance.ts`) other than the existing dynamic `import()` of the bridge (the main-bundle scan, Task 4). Its existing value imports of `reader/history`, `reader/policy` and `reader/readerText` stay.

- [ ] **Step 1: Write the failing rows** in `reader-frame.test.tsx`:
  - **seed:** the mount input's `appearanceRoot` is `document.documentElement`;
  - **after the mount resolves:** on a hosted mount, when the current stamp differs from `seed.stamp`, `follow` is called exactly once. When they are equal it is never called, even if the stamp moved during the hold, before the bridge's read;
  - **while open:** on a hosted mount, each stamp change calls `follow`, and the reader keeps the same mount (no `destroy`, no second `mount`);
  - **coalesces to the latest per frame:** three stamp changes, each in its own task (separate `await`s), inside one faked animation frame call `follow` once. Without the coalescing they would call it three times. Changes made in one task arrive as one observer callback, so they cannot show the difference;
  - **the mode-only fallback:** on a mount whose `seed` is `{hosted: false}`, `readerPrefsOf(useThemeChoice(), THEMES)` feeds `follow`'s theme, as today's `setPrefs` does;
  - **the mode-only trigger:** on a mount whose `seed` is `{hosted: false}`, on a dark device, Follow the system → Phosphor leaves the stamp unchanged but moves the derived mode from `'auto'` to `'dark'`. The kept `[prefs]` effect calls `follow('dark')` exactly once. On a mount whose `seed` is `{hosted: true}`, the same change calls nothing.
- [ ] **Step 2: Run to red** (`test/reader-frame.test.tsx`). Expected: FAIL on the new rows only.
- [ ] **Step 3: Implement.** Branch on the mount's `seed.hosted`. Hosted: compare stamps against `seed.stamp`. Not hosted: keep today's `[prefs]` effect and `seededPrefs`, calling `follow`. Keep `live.current` for the latest stamp and mode. Coalesce with one `requestAnimationFrame` handle that is local to the effect and cancelled on cleanup.
- [ ] **Step 4: Run to green**, plus `test/reader-bridge.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(docs): the reader follows ccrc's appearance while open`.

### Task 6: The browser matrix

**Files:**
- Create: `pwa/browser/reader-appearance.browser.test.ts`
- Modify: `pwa/browser/docs-compact-head.browser.test.ts`, `pwa/browser/reader-frame.browser.test.ts`, `pwa/browser/frame-cost.browser.test.ts`

Each row reads the frame's computed values through the existing harness's frame inspection, the way `reader-frame.browser.test.ts` reads the frame today. No new parent listener is added.

- [ ] **Step 1: Take BASE.** At Task 1's commit, before any edit of Tasks 2 to 5, take the per-skin `PHH-FIGURE` and `T10-FIGURES worst` lines, and `frame-cost`'s open-to-`ready` median of 9 opens at the Task 1 pin, with no appearance. Record them in Results.
- [ ] **Step 2: Write the rows**, each named by its acceptance id:
  - **AP-1 and AP-2:** iterate `SKINS` x (`THEMES` plus Follow the system under emulated light and dark), and print the count. In every open, assert:
    - each colour slot's computed value on the frame root equals the host's computed value for its mapped token (both lower-cased), and the frame's `color-scheme` equals the host's;
    - the frame's sans and mono roles resolve to the loaded ccrc faces (`document.fonts` in the frame holds both with status `loaded`, and a chrome label's computed `font-family` starts with the library's fixed family name for the host face).

    Once per skin, with Aa open and under a fine pointer, assert:
    - a popover row's height equals `--row-h`;
    - the popover's `box-shadow` equals `--elev-pop`;
    - the radii of a control, a pill and a popover equal `--r-md`, `--r-sm` and `--r-lg`;
    - the Aa group heading's `font-family` role, `font-size`, `font-weight`, `letter-spacing` and `text-transform` equal the host's section-label tokens.

    And per skin, the frame bar's height, the measure, the prose size, the gutters and the title block's sizes equal BASE. Each is compared as a computed length in px, or as an element's `getBoundingClientRect()` height for the bar and the title block, never as a token's text. BASE is taken in the library's own faces and a hosted open is in ccrc's, so the fixture's title and byline each fit on one line in both faces at every tested width: a face change then cannot wrap them and move a box.
  - **AP-3:** with a stale reader theme stored under the reader prefix (`{"theme":"dark"}` under a light palette, and the reverse), the values at first `ready` equal the host's, never the stored theme's.
  - **AP-4:** hold the chunk, change palette and skin, release; at most one `appearance` op.
  - **AP-5:** cycle every palette, flip the system mode and switch skin while open; same iframe element and nonce, scroll within 1 px, values within 100 ms, a drawn figure redrawn.
  - **AP-6:** pairs on computed values, the focus ring at 3:1 after a Tab, and a drawn figure's edge `stroke` at 3:1 on its plate. Width, font and one fold changed in Aa are back after a reopen, and the stored `pref:prefs` holds no `theme` key. Aa shows the line "Appearance follows ccrc Settings", the label ccrc sent, and no theme row. Tab never lands on the line. A lab-profile mount, which carries no appearance, keeps its theme row. **Meaning without colour** (spec §10, X1-12), on a fixture that carries a glossary term in running text: in GitHub Light, Solarized Light and Catppuccin Latte, where `term` has no hue, `a.term`'s computed `text-decoration-style` is `dotted`. The changed-mark shape is the library's test 10, on the library side; F reads it on the installed frame.
  - **AP-8:** the bridge sent `appearance`; a forced mode-only mount fails this row's own assertion.
  - Extend the geometry files to run their existing assertions once per skin (**AP-7**), the one-bar assertion included.
  - Extend `frame-cost` with the srcdoc-growth budget: at most 191 736 characters over BASE, the two faces (187 640) and the seed (4 096). BASE is taken at Task 1's pin, so it already holds every design's library growth, which Task 1 Step 2a checks share by share. Together they keep spec §9's total over the same document at the 1.1.0 pin: 224 504 plus the other designs' shares. Also extend it with the open-to-`ready` budget (median of 9 opens at most 1.10 x BASE's median of 9).
- [ ] **Step 3: Run each file through `ccrc test`**, with `CCRC_CHROME` from the brief. Expected: PASS. Record each figure line beside BASE.
- [ ] **Step 4: Measure the mutation rows** below, one at a time, from saved copies, restoring and hash-checking after each.
- [ ] **Step 5: Commit** the four browser files: `test(docs): the appearance matrix and per-skin budgets`.

### Task 7: Amend the rich-docs spec and close

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md`

- [ ] **Step 1: Amend in place, each with "(amended <date>; D-8759)", "(…; D-8760)" or "(…; D-8761)":**
  - §4.4's parent-op sentence and its op table, and the M8.6 row's text and refusal column, gain `appearance` (D-8759);
  - §3.2's `mountDocFrame` return shape gains `setAppearance(a: Appearance): void` (D-8761);
  - §4.3 gains a row for ccrc's two faces;
  - §3.2's `prefs`, `chrome` row and G7 say the hosted theme is ccrc's.
- [ ] **Step 2: Run the related suites:**
  - full pwa unit, typecheck and built suites;
  - from `pwa/`: `reader-*`, `docs-*`, `theme-catalogue`, `skin-catalogue`, `contrast`;
  - from `server/`: `docs-parity`, `citations`, `anchors`, `rings`;
  - `deviation-refs` after `git fetch origin main`.

  Record rc and counts.
- [ ] **Step 3:** Private-name scan every changed file. Then commit: `docs(spec): the reader's appearance contract in the rich-docs spec`.

## Acceptance rows (one to one with Task 17's Appearance row)

Task 17's row: "Exercise both canonical skins, all twelve canonical palettes and Follow the system; verify host-selected appearance on ordinary/lazy open, changes while open under the reviewed extension contract, native chrome/typography/surfaces/focus/accessibility and retained phone/desktop geometry budgets. No independent theme catalogue or mode-only substitution."

| Row | Clause | Wave C row | F action (installed) |
|---|---|---|---|
| AP-1 | both canonical skins | Task 6 AP-1 | Open a doc under Refined and Instrument; frame values and faces are ccrc's |
| AP-2 | all twelve palettes and Follow the system | Task 6 AP-2; Task 2 parts 2 and 5 | 14 appearances x 2 skins, the count read from the discovered catalogue |
| AP-3 | ordinary open | Task 6 AP-3 | With a stale reader theme stored, values at first `ready` are the host's. On a device, no light-then-dark flash is seen. Paint before first paint is the library's own test (spec §10) |
| AP-4 | lazy open | Task 4 "reads after the last await"; Task 6 AP-4 | Change during the chunk hold; the seed is the latest |
| AP-5 | changes while open under the reviewed contract | Task 5; Task 6 AP-5 | Cycle, flip, switch; in place, within 100 ms, figures redrawn |
| AP-6 | native chrome, typography, surfaces, focus, accessibility | Task 2 part 5; Task 6 AP-6 | Pairs meet floors on the installed frame; focus visible; Aa line; in Tokyo Night and Nord a changed block's mark differs in shape from an attention rule's, and in GitHub Light a glossary term is underlined |
| AP-7 | retained phone and desktop geometry budgets | Task 6 AP-7 | One bar, and 61, 48, 44 px on a phone; at most 1 px on tablet and desktop, per skin |
| AP-8 | no independent catalogue or mode-only substitution | Task 2 parts 3 and 4; Task 6 AP-8 | Scan green; the bridge sent `appearance` |

## Mutation rows

Each row is measured once, alone, from a saved copy, with `timeout -k 10 600` (900 for browser) and a measured process cap of at most 4096. A timeout is not a red.

| Id | Mutation | Must red |
|---|---|---|
| AP-M1 | `bridge.ts` never passes `appearance` | Task 4 "an outcome of kind `appearance`"; AP-8 browser row |
| AP-M2 | Drop one slot from `READER_APPEARANCE_MAP` | Task 2 coverage (and typecheck) |
| AP-M3 | Add `['nord', 'dracula']` to a file under `pwa/src/docs/` | Task 2 part 3 |
| AP-M4 | Move the appearance read above the assets await | Task 4 "reads after the last await"; AP-4 |
| AP-M5 | `ReaderFrame` ignores stamp changes | Task 5 "while open"; AP-5 |
| AP-M6 | One unreadable colour leaves that slot out, instead of dropping the colour group | Task 2 "one colour token answering `''`" |
| AP-M7 | Map `text ← --ink-disabled` | Task 2 part 5, in at least one palette |
| AP-M8 | Skip contract detection, so a `'none'` or `2` answer from `deps.libraryContract` still passes `appearance` | Task 4 "an older library" (the fake `mount` throws `TypeError`) |
| AP-M9 | Remove the per-frame coalescing | Task 5 "coalesces to the latest per frame" |
| AP-M10 | `readerAppearanceOf` returns the raw contract and skips `parseAppearance` | Task 2 "a skin token whose value the library refuses" |
| AP-M11 | `useHostAppearance` reads the stored choice instead of the root | Task 3 "a system flip moves the stamp" |
| AP-M12 | The lab profile passes `appearance` | Task 4 "the lab" |
| AP-M13 | A hosted mount sends neither `appearance` nor `prefs.theme`, so the stored theme rules | Task 6 AP-3 (stale stored theme) |
| AP-M14 | A dropped colour group sends `setPrefs({theme})` instead of an appearance with no colours | Task 4 "while open, hosted" |
| AP-M15 | `readerAppearanceOf` leaves the skin group out | Task 2 "every mapped token" row (its `skin` keys no longer equal `APPEARANCE_SLOTS.skin`); AP-1 skin assertions |
| AP-M16 | `bridge.ts` never passes `fonts` | Task 4 "an outcome of kind `appearance`"; AP-1 face assertion |
| AP-M17 | `sectionFamily` answers `sans` where `--family-section` equals `--family-mono` | Task 2 section-family row; AP-1 heading family under Instrument |
| AP-M18 | Map `radiusLarge ← --r-md` | AP-1 popover radius under both skins (Refined 14 against 10 px) |
| AP-M19 | `readerAppearanceOf` leaves `label` out | Task 2 "every mapped token" row; AP-6 shows the library's neutral default instead of ccrc's line |
| AP-M20 | Drop the `[prefs]` effect, so stamp changes are the only trigger | Task 5 "the mode-only trigger" |
| AP-M21 | `ReaderFrame.tsx` imports `readHostAppearance` by value | `docs-scans.test.ts`'s main-bundle scan (Task 4 "the main bundle stays library-free") |

## Deviations found

- **D-8759 (2026-11-18)**: reader-bridge-appearance-op. Issued to run 2631 (X1). It departs from the rich-docs spec's §4.4 sentence "Every later parent message goes on the port, and is `prefs`, `changes.result`, `mermaid` or `command` (amended 2026-11-10; library 1.1 take-up)". It also departs from M8.6's "Every other parent message goes on the port and is `prefs` or `changes.result`, any number of times, or, since the library 1.1 take-up, `mermaid` (once, after `ready`) or `command`", with its refusal "send an op other than `prefs`, `changes.result`, `mermaid` or `command` on the port", from §4.4's op table, whose parent-to-frame rows are `hello`, `prefs`, `changes.result`, `mermaid` and `command`, and from §4.3's Fonts row "`data:` inside the inlined CSS | About 415 KB as base64".
  - The parent also sends `appearance` on the existing port, any number of times, coalesced to one per animation frame: `{t: 'appearance', v: 1, appearance: {mode, colour?, skin?, label?}}`, the contract's one shape. §4.4's op table gains its row.
  - ccrc's two typefaces travel in the seed as base64 woff2 font assets, about 188 K characters. The library checks each one and loads it through the `FontFace` API from the decoded bytes. No CSS text is built from them.
  - This departure adds no channel, listener, frame-to-parent op or CSP change. It rules out none that another design adds on its own interface: X2's figure-image op can ride the same library release.
  - Why: the operator's 2026-11-10 amendment requires changes while open to travel on the existing checked bridge. `prefs` holds the reader's own persisted enum preferences, and appearance is ccrc's and never persisted, so it rides an op of its own (spec X1-3).
  - Task 7 amends the sentences.
- **D-8760 (2026-11-18)**: reader-hosted-theme-is-ccrcs. Issued to run 2631 (X1). It departs from the rich-docs spec's §3.2 row "`prefs`, `chrome` | The layout's own top bar and Aa menu defaults | ccrc's current theme as the starting value. Later changes arrive by the `prefs` op. Reader prefs are stored apart from console prefs." It also departs from G7's "Theme, width, marks and last visit live in ccrc's own localStorage, per device, under the reader prefix `ccrc:reader:v1:`".
  - While ccrc hosts the reader with an appearance, theme is not a reader preference. The frame ignores a stored theme and never writes one, and Aa shows one line in place of its theme row: the host's validated `label`, which ccrc sends as "Appearance follows ccrc Settings" (ask 594, answered by the coordinator 2026-11-18, option 0; the label ruled at review 2645 F6).
  - Width, marks, last visit, font and folds stay reader preferences under `ccrc:reader:v1:`.
  - Why: the operator's 2026-11-10 amendment gives global appearance one owner, ccrc.
  - Task 7 amends the sentences.
- **D-8761 (2026-11-18)**: reader-frame-handle-set-appearance. Issued to run 2631 (X1) as its reserve, and defined at fix round 1 (review 2645 F5(e), the coordinator's mail 25349). It departs from the rich-docs spec's §3.2 API line `{ update(d: RenderInput): void; setPrefs(p: Prefs): void; destroy(): void };`, the return shape of `mountDocFrame`.
  - The handle also carries `setAppearance(a: Appearance): void`. Before `ready` it queues, latest wins. After `ready` it posts the `appearance` op (D-8759), and it seeds every later remount.
  - Why: changes while open need a host-side call beside `setPrefs`, which carries only the reader's enum preferences.
  - Task 7 amends the line.

All of run 2631's block is defined: 8759, 8760, 8761.

## Results

**X1, run 2631, 2026-11-18.** This is a design wave and writes no source. The base is `main` at `6f5421139`.

### What was read and measured

- **ccrc's catalogue** (Sonnet · medium fact check, then confirmed by hand):
  - the skins live in `ui/src/styles/skins.ts#SKINS` (`refined`, `instrument`, stored `auto`), with `data-skin` on the root;
  - the palettes live in `ui/src/styles/themes.ts#THEMES`: 12 rows, 8 dark and 4 light, with `SYSTEM` a stored choice that resolves to `light` or `phosphor`;
  - the values are in `ui/src/styles/tokens.css`, generated by `ui/design/make-themes.mjs`;
  - the preference sits in per-device storage, through `pwa/src/lib/theme.ts` and `skin.ts`, each with one writer.
- **The adapter today:**
  - `policy.ts#readerPrefsOf` folds a palette to its `mode`, and `system` to `auto`;
  - `bridge.ts#mountReader` passes `prefs: {theme}`, and `setPrefs` afterwards;
  - `ReaderFrame.tsx` re-sends the latest mode after a lazy mount (`seededPrefs`);
  - no skin is sent;
  - the reader lab mounts with `theme: 'auto'` and profile `lab-draw`.
- **Library 1.1.0, installed copy** (Sonnet · medium fact check):
  - `HostAdapters` carries only `prefs {theme, width, font}`, and `mountDocFrame` throws `TypeError` on an unknown adapter key (`mount.js#ownData`);
  - the frame stylesheet has 54 custom properties, 36 of them colours;
  - the `.hljs-*` rules use hard-coded hex;
  - Mermaid draws with one fixed light palette on a white plate, with an invert filter in dark;
  - the bridge is `v: 1`, and a frame ignores a parent op it does not know;
  - the frame's CSP is `style-src 'unsafe-inline' data:` and `font-src data:`;
  - the host's precedence is defaults, then stored, then host values.
- **Frame asset sizes:** `reader.css` is 549 069 characters, 413 096 of them base64 fonts (4 faces); `enhance.js` 198 234; `bootstrap.js` 30 153; `guard.js` 3 643; 781 099 in all. The library's faces, as base64: serif 163 148 and 173 584 (italic), sans 38 320 and 38 044 (italic). ccrc's faces are 69 492 and 71 236 bytes, exactly 187 640 characters as base64 (the seed does not escape base64). Spec §9 splits the srcdoc budget on these numbers (fix round 1, F10).
- **The mapped tokens are literal in every palette.**
  - A script parsed `tokens.css`, merged both default blocks, took the default as `phosphor`, overlaid each `[data-theme]` block, and followed `var()` chains.
  - Under the fix-round-1 map, the 30 distinct colour tokens it names resolve to `#rrggbb` in all 12 palettes: 0 misses (33 slots; `focus` shares `--accent`, and `info` and `path` share `--ink-secondary`).
  - Every palette declares `color-scheme` as `light` or `dark`.
  - Skin values: `--r-md`, `--r-sm` and `--r-lg` are 10, 6 and 14 px (Refined) and 5, 3 and 8 px (Instrument). `--row-h` is 52 px for Refined, and 44 px or 32 px under a fine pointer for Instrument. `--case-section` is `none` or `uppercase`. `--fs-section` is 15 or 11 px. `--weight-section` is 600 or 500. `--ls-section` is -0.011em or 0.08em. `--elev-pop` takes two forms in all 12 palettes x 2 skins, 14 distinct values: `0 12px 40px rgba(0, 0, 0, 0.55)` or `rgba(26, 32, 27, 0.22)` (Refined), and `0 0 0 1px #<--edge-strong>` (Instrument). Each fits the `popShadow` grammar of spec §2.
  - Every skin token's value per skin (fix round 1, F3), read from `tokens.css` and `skins.css`, is in spec §2.3, with its verdict. The library's in-document cards draw no shadow, a read of its frame stylesheet: figures and tables set `box-shadow: none`. Its popovers draw `--pop-shadow`, or a fixed shadow for quick jump, keys and the contents drawer.

### Contrast under the map (fix round 1, F1)

Measured 2026-11-18 with a script over `ui/src/styles/tokens.css` (both default blocks merged, `var()` chains followed, WCAG 2.1 relative luminance), worst palette per pair:

| Pair | Worst | Palette | Floor |
|---|---|---|---|
| `text-faint` on `surface2` | 4.52 | Solarized Dark | 4.5 |
| `accent` on `surface2` | 4.57 | Phosphor Daylight | 4.5 |
| `chg` (`--acct-magenta`) on `surface2` | 4.73 | Solarized Dark | 4.5 |
| `wait` (`--status-attention-text`) on `surface2` | 4.77 | Solarized Dark | 4.5 |
| `no` (`--status-dead-text`) on `surface2` | 4.77 | Solarized Dark | 4.5 |
| `ok` (`--status-done-text`) on `surface2` | 4.82 | Nord | 4.5 |
| `accent` (focus) on `bg` | 4.92 | Phosphor Daylight | 3 |
| `accent-ink` on `accent` | 5.19 | GitHub Light | 4.5 |
| `syn-comment` on `code-block-bg` | 5.24 | Solarized Light | 4.5 |
| `violet` (`--acct-violet`) on `surface2` | 4.79 | Solarized Dark | 4.5 |
| `id` (`--acct-blue`) on `surface2` | 4.80 | Solarized Dark | 4.5 |
| `term` (`--acct-cyan`) on `surface2` | 5.00 | Solarized Dark | 4.5 |
| `info` and `path` (`--ink-secondary`) on `surface2` | 5.54 | Catppuccin Mocha | 4.5 |
| `code-ink` on `code-block-bg` | 6.49 | Solarized Dark | 4.5 |
| `border` (`--edge-strong`) on `bg` | 1.54 | Phosphor Daylight | none: decorative |

Every other mapped pair on `bg`, `surface` and `surface2`, and every `syn-*` on the well, is higher. The review's measurement of the earlier fill mapping (`--diff-add` 1.69:1, `--status-dead` 3.85:1) is why the semantic slots moved to text variants.

**Cross pairs (fix round 2, review 2657 F1).** Remeasured over the product spec §5 defines: 14 text colours (`accent-hover` as `color-mix(in srgb, accent 80%, text)`) on `bg`, `surface`, `surface2`, and the `chg`, `wait`, `no` and `accent` tints at 4% over `bg` and over `surface`, each tint rounded to 8 bits; plus the code, accent-ink, focus and Mermaid pairs. 67 worst-case rows, 0 below their floor. The lowest per kind:

| Pair | Worst | Palette | Floor |
|---|---|---|---|
| `text-faint` on any 4% tint | 4.57 | Catppuccin Latte | 4.5 |
| `accent` (links, and inline code inside a link) on `surface2`, inline code's ground | 4.57 | Phosphor Daylight | 4.5 |
| `accent` on any 4% tint (a link in a changed block) | 4.64 | Phosphor Daylight | 4.5 |
| `chg` on any 4% tint | 4.83 | Catppuccin Latte | 4.5 |
| `accent-hover` on `surface2` | 5.13 | Solarized Dark | 4.5 |
| `text-muted`, `info`, `path` on any 4% tint (table heads on `th-bg`) | 5.74 | Catppuccin Latte | 4.5 |
| `text` on any 4% tint | 7.15 | Catppuccin Latte | 4.5 |
| `focus` on `surface2` (the Aa checked row) | 4.57 | Phosphor Daylight | 3 |
| `focus` on any 4% tint | 4.64 | Phosphor Daylight | 3 |
| Mermaid lines (`text-muted`) on `surface2`, node fill | 5.54 | Catppuccin Mocha | 3 |
| Mermaid lines (`text-muted`) on `surface`, the plate | 6.74 | Solarized Light | 3 |
| Mermaid labels (`text`) on `surface2` | 6.75 | Catppuccin Mocha | 4.5 |

What the review measured at the old rules, and what changed:

| Review 2657 F1 pair | At the old rule | Now |
|---|---|---|
| (a) `accent` on the 6% `chg` tint over `bg` | 4.48 | 4% tint: 4.64 |
| (b) inline code in a link: `accent` on the 6% `text` tint over `bg` | 4.39 | inline code on `surface2`: 4.57 |
| (c) `text-faint` on the 6% `no` tint over `bg` | 4.44 | 4% tint: 4.57 |
| (d) `:719`'s `chg` at 7% over `short-bg`, ground unstated | unstated | `short-bg` is `surface`; `chg` at 4% over it is in the product |

Why 4% and an opaque inline-code ground: the worst text-on-tint pair over all four coloured tints and all 14 text colours is 4.73 at 2%, 4.65 at 3%, 4.58 at 4%, 4.51 at 5% and 4.44 at 6% (unrounded; 5% rounds to 4.50, too close). Inline code on a text tint over a coloured tint fails at every cap from 3% to 6% for either tint (4.44 at the lowest), so it takes an opaque ground.

### Commands

```text
git fetch origin; git log -1 origin/HEAD                      -> 6f5421139
grep / sed over pwa/src/docs/reader/{bridge,policy}.ts, pwa/src/docs/ReaderFrame.tsx,
  ui/src/styles/{themes,skins}.ts, ui/src/styles/tokens.css    (read only)
ls / grep over the installed library 1.1.0                     (read only)
python3 -I <inline script> over ui/src/styles/tokens.css       -> 12 palettes, bad 0
python3 -I <inline script> over the library's frame stylesheet -> fonts 4, 413096 base64 chars
```

No test, build or install ran: nothing in this wave changes code.

### Asks

- **Ask 594, Aa's line while hosted.** The coordinator answered option 0 (mail 25232): one static line, "Appearance follows ccrc Settings", with no button. It added three conditions:
  - the copy and its accessibility are in the spec (§6);
  - outside ccrc, Aa keeps its theme row, as the host adapter decides;
  - a Settings shortcut is not added in this wave.

  All three are folded into spec §6, §10 and Where things stand.
- **Ask 600, the brief's first item.** The coordinator answered option 1 (mail 25257): the item is deferred and `main` is not merged. The item was the completion plan's D2 Results correction: row `W4-T10-M10`'s count, and D-8730's two clauses missing from fix round 2's F4 lists. Its section reached `main` with #3026 at 21:24Z, after this workspace was cut from `6f5421139`, and no clause-16 trigger licensed absorbing `main`. The coordinator carries both items to the first wave cut from a base that has #3026. This wave did not edit the completion plan. Its claim attempt was refused whole (409, held by D2's claim), so nothing was acquired.

### The adversarial pass (Opus · high, one pass over the spec and this plan)

It returned 1 critical, 8 important and 10 minor findings. Each was fixed, or recorded below.

| Finding | Disposition |
|---|---|
| C1: the 36 library colour properties include tints and composites that ccrc carries as `color-mix(...)` in some palettes, so all or nothing would drop Phosphor or Nord to mode only | Fixed. Version 1 carries base colours only (30 at the adversarial pass, 33 after review 2645 F2), and the library derives tints with `color-mix` (spec §2, X1-11). Measured: every mapped token is a literal in all 12 palettes |
| I1: `audit.mjs` cannot resolve palettes for part 2 | Fixed. New test helper `paletteTokens.ts` (Task 2) |
| I2: a fallback while open left the old palette on screen, and `prefs` persists `theme` | Fixed. An appearance with no colour group drops host colours and stays hosted. While hosted, `theme` is never sent or stored (spec §2.1, §7, §10) |
| I3: `./host` may be imported only by `bridge.ts` | Fixed. The pure exports live in `./frame` (spec §10, Task 1) |
| I4: fonts could push a document past the library's srcdoc cap, or fail the mount | Fixed. The cap rises by the fonts' cap, a bad font is dropped, and ccrc loads fonts on their own path (spec §2.2) |
| I5: AP-M9 could stay green | Fixed. The changes are spaced across tasks (Task 5) |
| I6: the older-library row could not be built | Fixed. `ReaderMountDeps.contract`, a test seam (Task 4) |
| I7: density and controls were dropped without an ask | Fixed in the design. The skin's radius, popover row height and section-label case are carried. The bar and reading layout stay, as the operator's own reading-layout and budget constraints require (X1-7). Reported to the coordinator in the wave-done mail |
| I8: no red-capable row for "a stale reader preference never overrides" | Fixed. AP-3 seeds a stale stored theme, and new mutation row AP-M13 |
| Minor: palette counts | Fixed: 8 dark, 4 light |
| Minor: D-8729 is not on `main` | Fixed at the time: wave C waited for #3026, which has since merged (`839c05e46`) |
| Minor: AP-3 cannot see a pre-`ready` flash | Recorded. The library's own test owns paint before first paint (spec §10). AP-3 checks the seed and the first-`ready` values, and F's device check looks for a flash |
| Minor: a stamp read at the call made a needless follow-up op | Fixed. The bridge's read returns the stamp, and the mount carries it in `seed` (fix round 1 re-pass, I-3) |
| Minor: the scan was narrow | Fixed. It covers object keys and hex literals, and includes `pwa/src/lib/appearance.ts` |
| Minor: queued redraws could stack | Fixed. A newer appearance cancels them, with a library test |
| Minor: font CSS text | Fixed. The `FontFace` API loads decoded bytes |
| Minor: no run count for the median | Fixed: 9 opens |
| Minor: server suites | Fixed. Task 7 runs them from `server/` |
| Minor: the one-bar budget had no row | Fixed: AP-7 and spec §9 |

### The repo's review judge

At `41d3ade8d`, every required check and CodeQL passed. The repo's review judge, which is not a required check, was red on one blocking reason, `promise-delta-missing`: the new spec had no `promise-delta` fence. Fixed by spec §13, which uses the template's "none - <reason>" form.

### Fix round 1 (review run 2645, round 1 of 3, at `a2d472ea4`; the coordinator's mail 25349)

There is one commit per finding, then this Results commit. The coordinator ruled F3 and F6. Every other fix follows the report's direction.

| Finding | Disposition |
|---|---|
| F1: fill tokens in text slots; border 3:1 | Fixed. Semantic slots map to ccrc's `-text` variants, and `chg` to `--acct-magenta`. Edges are decorative, with no floor, as in ccrc's own gate. Tints hold at most 6%. Every pair is measured ("Contrast under the map", above) |
| F2: `term`, `id`, `violet`, `path` unslotted | Fixed. They are slots now (33 colour slots), mapped to lane hues and secondary ink and measured. Spec §10 names every derived colour and its source |
| F3 (ruled): density and controls | Fixed. Popover elevation and the section-label type are skin slots (10 in all). Spec §2.3 lists all 31 ccrc skin tokens, carried or rejected, with values and reasons. X1-7 is Ruled |
| F4: rows did not observe the claims | Fixed. AP-1 and AP-2 assert slot values, faces, skin values and an unchanged reading layout. AP-6 checks that width, font and folds persist with no stored theme. New rows AP-M15 to AP-M18 |
| F5: two spellings and mechanisms | Fixed. The op carries the contract's one shape. D-8759 states the `FontFace` path and the §4.4 op table. Contrast reads through the palette helper. The scan's no-stylesheet part has both a run-time and a source check. D-8761 defines the §3.2 return-shape departure |
| F6 (ruled): Aa's copy in the library | Fixed. The contract carries a validated `label`, and the library's neutral default names no host. ccrc sends its ruled copy, with new row AP-M19 |
| F7: conflicting bad-value rules | Fixed. `parseAppearance` never throws for a slot value and returns a verdict. The frame applies it to the seed and to every op. ccrc sends only the verdict and spells no range, so its colour normaliser is gone |
| F8: overloaded seam | Fixed. `libraryContract: () => number \| 'none'`, with the row and AP-M8 to match |
| F9: parser claim | Fixed. The claim is restated, and X1-3 rests on keeping appearance out of persisted prefs |
| F10: fonts against the srcdoc budget | Fixed. The budget is three measured parts (187 640 faces, at most 32 768 library growth over 781 099, at most 4 096 seed). The optional font split is dropped: it saves at most 76 364 and breaks a 1.1.0-style host |
| F11: undeclared files | Fixed. `policy.ts`, `reader-policy.test.ts` and the changed `.toEqual` rows are in Task 4 |
| F12: mode-only trigger lost | Fixed. A mode-only mount keeps its `[prefs]` effect, with a new row and AP-M20 |
| A1 to A4 | Fixed. The fonts are pinned to the `ui` files, and the cap's unit is stated. #3026 is shown as merged, the median of 9 is stated, and AP-3's action is aligned. BASE is taken at Task 1, the font route is named, and the two terms are defined. One read per library mount |
| X2 room (the coordinator's note) | Fixed. §8 and the library's boundary test pin only this contract's own additions, so X2's frame-to-parent op can ship in the same library release |

**The adversarial re-pass** (Opus · high, over the changed sections). It found no critical issue, 4 important and 9 minor. Its own recomputation reproduced all 17 contrast rows. Dispositions:

| Re-pass finding | Disposition |
|---|---|
| I-1: Refined's `--elev-pop` is `rgba()`, refused by a hex-only rule, and the shadow grammar was unbounded | Fixed. `popShadow` has an exact bounded grammar that fits both measured forms (14 distinct values over 12 palettes x 2 skins). Part 2 requires an empty `refused` list |
| I-2: AP-M15 could stay green | Fixed. The full-map row asserts both key sets against `APPEARANCE_SLOTS` and an empty `refused` |
| I-3: "hosted" read from an overloaded null | Fixed. `ReaderMount.seed` is `{hosted: true, stamp}` or `{hosted: false}`, and a mount that is not hosted never reads the root |
| I-4: the srcdoc ceiling over the wrong BASE | Fixed. The browser row is at most 191 736 over a BASE taken at the new pin. Task 1 measures the library's part |
| M-5: two more pinned `readerMountPlan` rows | Fixed. Named in Task 4 |
| M-6: stale Results counts | Fixed |
| M-7: D-8761 missing from Task 7 | Fixed |
| M-8: tint ground unstated | Fixed. Tints mix over `bg` or `surface`, never `surface2`. Measured: 4.23:1 at 6% and 4.40:1 at 3% on `surface2` |
| M-9: types missing from §10 | Fixed |
| M-10: the library could reach the main bundle | Fixed. The bridge alone reads the root (`follow`), `ReaderFrame` imports no value from the bridge or the two new modules, the two modules join `READER_ADAPTERS`, and new row AP-M21. (Review 2657 F3 corrected this line: `ReaderFrame` does value-import `reader/history`, `reader/policy` and `reader/readerText`, and `adapterUseAllowed` needed three new edges.) |
| M-11: semantic colours lose hue in some palettes | Accepted and recorded in X1-12: these are ccrc's own text colours |
| M-12: label rules | Fixed. UTF-16 code units, bidi and format characters refused, empty refused, and the test names `ccrc` |
| M-13: scan part numbers differed | Fixed. Parts 1 to 4 follow spec §3, and part 5 is §5's contrast |

The library 1.1.0 copy used for every library read this round is the installed package from another ccrc worktree, copied read-only to this session's scratch after the D2 worktree was reclaimed. Version 1.1.0 was confirmed.

### Carried

- The library programme plans wave L from spec §10. Its release and ccrc's re-pin are the operator's.
- Wave C waits for wave R. #3026 has merged.
