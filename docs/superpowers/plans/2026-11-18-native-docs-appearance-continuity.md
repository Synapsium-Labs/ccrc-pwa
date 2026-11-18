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
- No value the adapter sends contains `;`, `{`, `}`, `url(` or `var(`; colours are `#rrggbb` or `#rrggbbaa` only.
- Colour slots are all or nothing: one unreadable mapped colour sends mode only for that change. Shape and font slots fall back one by one. Appearance never drops the reader to the plain view.
- Contrast floors: 4.5:1 for body text, links, code tokens, table text and figure labels; 3:1 for the focus ring, control borders and figure lines.
- Budgets: payload at most 4 KiB serialised; at most one `appearance` op per animation frame, latest wins; hosted srcdoc at most 196 608 characters over the same document at the 1.1.0 pin; hosted open-to-`ready` median at most 1.10 x BASE median; a change while open shows on the frame root within 100 ms, same iframe and nonce, scroll within 1 px; Mermaid redraw one figure per task, no gap over 200 ms.
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
| C | One ccrc run (this plan's Tasks 1 to 7) | Exact re-pin, the appearance source, mapping, adapter, frame wiring, browser matrix, rich-docs amendments | R released, and #3026 (D2) merged: Task 4 reads beside D-8729's focus sample, which is on #3026's branch and not yet on `main` (2026-11-18) |
| F | The coordinator, at completion Task 17 | AP-1 to AP-8 on the final installed release set | C merged, E reviewed |

No ccrc wave edits the library's repository. C does not start before R: its types and tests read the library's `APPEARANCE_SLOTS`, `APPEARANCE_PAIRS`, `APPEARANCE_CONTRACT` and `parseAppearance`, and it spells none of them itself. These pure exports come from the library's `./frame` entry. `docs-scans.test.ts#LIBRARY_HOMES` lets any file under `pwa/src/docs/reader/` import `./frame`, but only `bridge.ts` may import `./host`.

## File ownership (wave C)

| File | Ring | Task | Responsibility |
|---|---|---|---|
| `pwa/package.json`, `pwa/package-lock.json` | — | 1 | Exact re-pin |
| `pwa/src/docs/reader/appearance.ts` (new) | L1 | 2 | `READER_APPEARANCE_MAP`, `READER_APPEARANCE_CONTRACTS`, `normaliseHostColour`, `readerAppearanceOf` |
| `pwa/test/reader-appearance.test.ts` (new) | — | 2 | Pure rule rows |
| `pwa/test/reader-appearance-source.test.ts` (new) | — | 2 | Slot coverage, every palette resolves, contrast pairs, second-copy scan |
| `pwa/test/helpers/paletteTokens.ts` (new) | — | 2 | `resolvePaletteTokens(themeId, skinId, pointer)`: both default blocks merged, `phosphor` as the default, the skin block and its `(pointer: fine)` arm, `var()` chains, `color-scheme` |
| `pwa/src/lib/appearance.ts` (new) | L4 | 3 | `useHostAppearance()` stamp |
| `pwa/test/host-appearance.test.tsx` (new) | — | 3 | Stamp rows |
| `pwa/src/docs/reader/hostAppearance.ts` (new) | L3 | 4 | `readHostAppearance(doc)` over `getComputedStyle` |
| `pwa/src/docs/reader/assets.ts` | L3 | 4 | `loadReaderFonts()` |
| `pwa/src/docs/reader/bridge.ts` | L3 | 4 | `appearance` at mount, `setAppearance`, contract detection, fonts |
| `pwa/test/reader-bridge.test.ts` | — | 4 | Bridge rows |
| `pwa/src/docs/ReaderFrame.tsx` | L4 | 5 | Seed, post-mount resend, follow, coalesce |
| `pwa/test/reader-frame.test.tsx` | — | 5 | Frame rows |
| `pwa/browser/reader-appearance.browser.test.ts` (new) | — | 6 | AP-1 to AP-6 and AP-8 browser rows |
| `pwa/browser/docs-compact-head.browser.test.ts`, `reader-frame.browser.test.ts`, `frame-cost.browser.test.ts` | — | 6 | Per-skin geometry and cost rows (AP-7, §9 budgets) |
| `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md` | — | 7 | D-8759 and D-8760 amendments |

---

### Task 1: Re-pin the shared library to the contract release

**Files:**
- Modify: `pwa/package.json`, `pwa/package-lock.json`
- Test: the existing M8.12 rows, `pwa/test/reader-pin.test.ts` and `pwa/test/reader-assets.test.ts` (no new file)

**Interfaces:**
- Produces: from the library's `./frame` entry, `APPEARANCE_CONTRACT`, `APPEARANCE_SLOTS`, `APPEARANCE_PAIRS`, `parseAppearance`, `mermaidThemeOf` and the `Appearance` type. From its `./host` entry, `HostAdapters.appearance`, `FrameAssets.fonts` and `DocFrame.setAppearance`.

- [ ] **Step 1:** Re-read the release the brief names: registry entry, tarball integrity, attestation, signed tag. A difference from the brief stops the wave.
- [ ] **Step 2:** Set the exact version (no `^`) in `pwa/package.json` and install through the existing approved spine. `npm ls` of the library's package (the name `pwa/package.json` already carries) prints exactly that version.
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
export function normaliseHostColour(text: string): string | null; // '#rrggbb' | '#rrggbbaa', lower case
export type ReaderAppearanceOutcome =
  | { readonly kind: 'appearance'; readonly value: Appearance;
      /** `null`: every colour applied. Otherwise the colour group was dropped (spec §7). */
      readonly dropped: null | { readonly why: 'colour-unreadable' | 'scheme-unreadable'; readonly token: string } }
  | { readonly kind: 'mode-only'; readonly why: 'contract-unsupported' };
export function readerAppearanceOf(
  read: (token: HostToken) => string, colourScheme: string, contract: number | undefined,
): ReaderAppearanceOutcome;
// pwa/test/helpers/paletteTokens.ts
export function resolvePaletteTokens(
  themeId: string, skinId: string, pointer: 'fine' | 'coarse',
): { readonly tokens: ReadonlyMap<string, string>; readonly colourScheme: string };
```

The map is spec §3's table, slot for slot: 30 colour slots and 4 skin slots. Each mapped colour token was measured to resolve to `#rrggbb` in all twelve palettes (2026-11-18, Results). A pair that misses its floor under this map in some palette stops the wave and is reported. It is not remapped silently.

- [ ] **Step 1: Write the failing pure rows** in `reader-appearance.test.ts`:
  - `normaliseHostColour`:
    - `'#2E3440'` and `' #2e3440 '` give `'#2e3440'`;
    - `'#2E3440CC'` gives `'#2e3440cc'`;
    - `'rgba(4, 6, 5, 0.62)'` gives `'#0406059e'`;
    - each of `'#abc'`, `'color-mix(in srgb, #BF616A 12%, transparent)'`, `'var(--x)'`, `'url(x)'`, `'red'`, `'#2e3440;'` and `''` gives `null`.
  - `readerAppearanceOf`:
    - with a reader answering every mapped token, contract `1` and `'dark'`, it is `kind 'appearance'`, and `parseAppearance` of its value is `ok`;
    - one colour token answering `''` gives `kind 'appearance'` with `mode` set, no colour group, and `dropped: {why:'colour-unreadable', token}`;
    - an unreadable skin token keeps every colour, leaves that slot out, and has `dropped: null`;
    - contract `undefined` and contract `2` each give `{kind:'mode-only', why:'contract-unsupported'}`;
    - a `colourScheme` of `'normal'` or `''` gives `mode: 'auto'`, no colour group, and `dropped.why: 'scheme-unreadable'`;
    - `controlRow` `'52px'` is kept and `'60px'` is left out; `sectionCase` `'uppercase'` is kept and `'small-caps'` is left out;
    - its serialised value is at most 4096 bytes.
  - `resolvePaletteTokens`:
    - `('phosphor', 'refined', 'coarse')` answers `--r-md` as `'10px'` (the second default block) and `colourScheme` `'dark'`;
    - `('nord', 'instrument', 'fine')` answers `--row-h` as `'32px'` and `--bg-page` as `'#2E3440'`;
    - a `var()` chain is followed: `--status-done` answers a hex in `'light'`.
- [ ] **Step 2: Write the failing source rows** in `reader-appearance-source.test.ts`, in four describes:
  1. **Coverage:** the slot keys of `READER_APPEARANCE_MAP` equal `APPEARANCE_SLOTS`, in both directions.
  2. **Every palette resolves:** for each id in `THEMES`, each skin in `SKINS`, and each pointer, `resolvePaletteTokens` answers every mapped token, and `parseAppearance` accepts the value `readerAppearanceOf` builds from it with `dropped: null`. The case title names the palette, skin, pointer and token. (`audit.mjs` is not reused: it keys the default palette `DARK`, reads only the first `:root` block, and never reads `skins.css` or `color-scheme`.)
  3. **Contrast:** for each palette, every `APPEARANCE_PAIRS` entry over the mapped values meets its floor. The number of palettes checked equals `THEMES.length`, read at run time, never a typed 12. Part 2 also expects each palette's `color-scheme` to be `light` or `dark`, and equal to its `THEMES` row's `mode`.
  4. **No second list**, over `pwa/src/docs/`, `pwa/src/readerLab/` and `pwa/src/lib/appearance.ts`:
     - no file holds two or more `THEMES` ids, or two or more `SKINS` ids, as string literals or as object keys, quoted or not;
     - no file under `pwa/src/docs/reader/` holds a hex colour literal;
     - only `pwa/src/docs/ReaderFrame.tsx` imports `THEMES`, and no file imports `SKINS`;
     - `appearance.ts` holds no `;`, `{`-in-a-string, `url(` or `var(` literal.
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
- Modify: `pwa/src/docs/reader/bridge.ts`, `pwa/src/docs/reader/assets.ts`, `pwa/test/reader-bridge.test.ts`

**Interfaces:**
- Consumes: Task 2's `readerAppearanceOf`, `ReaderAppearanceOutcome`; Task 1's `APPEARANCE_CONTRACT`, `HostAdapters.appearance`, `FrameAssets.fonts`, `DocFrame.setAppearance`.
- Produces:

```ts
// hostAppearance.ts (L3)
export interface HostAppearanceRead { readonly stamp: string; readonly read: (contract: number | undefined) => ReaderAppearanceOutcome }
export function readHostAppearance(doc: Document): HostAppearanceRead; // one getComputedStyle, stamp from the root's two attributes
// assets.ts
export function loadReaderFonts(): Promise<{ readonly sans: string; readonly mono: string }>; // base64 woff2
// bridge.ts: ReaderMountInput gains
readonly appearance?: () => HostAppearanceRead;     // called once, synchronously, right before mountDocFrame
// ReaderMountDeps gains
readonly contract?: number;                          // tests only; absent, the host entry's APPEARANCE_CONTRACT
readonly fonts?: () => Promise<{ sans: string; mono: string }>;
// ReaderMount gains
readonly seededStamp: string | null;                 // the stamp the seed was read under; null when no appearance was read
setAppearance(r: HostAppearanceRead, theme: 'light' | 'dark' | 'auto'): void;
```

- `readHostAppearance` calls `getComputedStyle(doc.documentElement)` once, and reads `color-scheme` and the mapped tokens through `getPropertyValue`. Its stamp has the same shape as Task 3's.
- `loadReaderFonts` reads the design system's own `Geist-Variable.woff2` and `GeistMono-Variable.woff2` through an inline asset import. No font file is copied into `pwa/`. The fonts load on their own path, beside the assets. If they fail, the bridge mounts without `fonts`, and never calls `onFallback('assets')` for them.
- On a hosted mount, `setAppearance` sends `DocFrame.setAppearance` with the outcome's value, a value with no colour group included. It never calls `setPrefs` with a theme. On a mode-only mount (contract unsupported), it sends `setPrefs({theme})`.

- [ ] **Step 1: Write the failing rows** in `reader-bridge.test.ts`, with a fake `mount`:
  - **reads after the last await:** hold `deps.assets`, change what `input.appearance` answers while held, release; the adapters' `appearance` is the post-release answer, `seededStamp` is its stamp, and `appearance` was called exactly once, with no await between that call and `mount`;
  - **an outcome of kind `appearance`** passes `adapters.appearance` and `assets.fonts`, and passes no `prefs.theme`;
  - **a dropped colour group** still passes `adapters.appearance`, with `mode` and no `c.` keys;
  - **fonts that fail to load** mount without `fonts`, and `onFallback` is never called;
  - **an older library:** with `deps.contract` absent and `deps.mount` throwing `TypeError` on any key outside 1.1.0's set, the mount succeeds in mode only (`prefs.theme`, no `appearance`). This seam is the only way to reach the case: with the exact pin it is a build error;
  - **while open, hosted:** `setAppearance` calls `DocFrame.setAppearance` once, including for a dropped colour group, and never `setPrefs`;
  - **while open, mode only:** `setAppearance` calls `DocFrame.setPrefs({theme})` once;
  - **after `destroy()`**, `setAppearance` does nothing;
  - **the lab:** with `profile: 'lab-draw'`, no `appearance` is passed and `input.appearance` is never called;
  - **the key set:** the adapters' key set is the existing set plus `appearance`, exactly.
- [ ] **Step 2: Run to red** (`test/reader-bridge.test.ts`). Expected: FAIL on the new rows only.
- [ ] **Step 3: Implement.**
  - Contract detection takes `deps.contract`, or else `APPEARANCE_CONTRACT` from the library's `./frame` entry, and checks it against `READER_APPEARANCE_CONTRACTS`.
  - The read sits beside D-8729's focus sample, after the Mermaid wait and before `mountDocFrame`, with no await between.
  - The lab path is decided by `readerMountPlan`, which gains `appearance: boolean`: `false` for `lab-draw`.
- [ ] **Step 4: Run to green**, plus `test/reader-policy.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(docs): the reader bridge carries ccrc's appearance`.

### Task 5: The frame follows the host

**Files:**
- Modify: `pwa/src/docs/ReaderFrame.tsx`, `pwa/test/reader-frame.test.tsx`

**Interfaces:**
- Consumes: Task 3's `useHostAppearance`; Task 4's `readHostAppearance`, `ReaderMountInput.appearance`, `ReaderMount.setAppearance`.

- [ ] **Step 1: Write the failing rows** in `reader-frame.test.tsx`:
  - **seed:** the mount input's `appearance` is `readHostAppearance` bound to the document;
  - **after the mount resolves:** when the current stamp differs from the mount's `seededStamp`, `setAppearance` is called exactly once, with a fresh read. When they are equal, it is never called, even if the stamp moved during the hold before the bridge's read;
  - **while open:** each stamp change calls `setAppearance` with a fresh read; the reader keeps the same mount (no `destroy`, no second `mount`);
  - **coalesces to the latest per frame:** three stamp changes, each in its own task (separate `await`s), inside one faked animation frame send one call, carrying the last read. Without the coalescing they would send three. Changes made in one task arrive as one observer callback, so they cannot show the difference;
  - **the mode-only fallback:** `readerPrefsOf(useThemeChoice(), THEMES)` still feeds `setAppearance`'s `theme` argument, which a mode-only mount sends as `prefs.theme`.
- [ ] **Step 2: Run to red** (`test/reader-frame.test.tsx`). Expected: FAIL on the new rows only.
- [ ] **Step 3: Implement.** Replace `seededPrefs` with the mount's `seededStamp`. Keep `live.current` for the latest stamp. Coalesce with one `requestAnimationFrame` handle that is local to the effect and cancelled on cleanup.
- [ ] **Step 4: Run to green**, plus `test/reader-bridge.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(docs): the reader follows ccrc's appearance while open`.

### Task 6: The browser matrix

**Files:**
- Create: `pwa/browser/reader-appearance.browser.test.ts`
- Modify: `pwa/browser/docs-compact-head.browser.test.ts`, `pwa/browser/reader-frame.browser.test.ts`, `pwa/browser/frame-cost.browser.test.ts`

Each row reads the frame's computed values through the existing harness's frame inspection, the way `reader-frame.browser.test.ts` reads the frame today. No new parent listener is added.

- [ ] **Step 1: Take BASE.** Before any edit, take the per-skin `PHH-FIGURE` and `T10-FIGURES worst` lines, and `frame-cost`'s open-to-`ready` median at the Task 1 pin, with no appearance. Record them in Results.
- [ ] **Step 2: Write the rows**, each named by its acceptance id:
  - **AP-1 and AP-2:** iterate `SKINS` x (`THEMES` plus Follow the system under emulated light and dark), and print the count.
  - **AP-3:** with a stale reader theme stored under the reader prefix (`{"theme":"dark"}` under a light palette, and the reverse), the values at first `ready` equal the host's, never the stored theme's.
  - **AP-4:** hold the chunk, change palette and skin, release; at most one `appearance` op.
  - **AP-5:** cycle every palette, flip the system mode and switch skin while open; same iframe element and nonce, scroll within 1 px, values within 100 ms, a drawn figure redrawn.
  - **AP-6:** pairs on computed values, the focus ring at 3:1 after a Tab, and Aa showing the line "Appearance follows ccrc Settings" and no theme row. Tab never lands on the line. A lab-profile mount, which carries no appearance, keeps its theme row.
  - **AP-8:** the bridge sent `appearance`; a forced mode-only mount fails this row's own assertion.
  - Extend the geometry files to run their existing assertions once per skin (**AP-7**), the one-bar assertion included.
  - Extend `frame-cost` with the srcdoc-growth and open-to-`ready` budgets.
- [ ] **Step 3: Run each file through `ccrc test`**, with `CCRC_CHROME` from the brief. Expected: PASS. Record each figure line beside BASE.
- [ ] **Step 4: Measure the mutation rows** below, one at a time, from saved copies, restoring and hash-checking after each.
- [ ] **Step 5: Commit** the four browser files: `test(docs): the appearance matrix and per-skin budgets`.

### Task 7: Amend the rich-docs spec and close

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md`

- [ ] **Step 1: Amend in place, each with "(amended <date>; D-8759)" or "(…; D-8760)":**
  - §4.4's parent-op sentence and the M8.6 row's text and refusal column gain `appearance`;
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
| AP-2 | all twelve palettes and Follow the system | Task 6 AP-2; Task 2 parts 2 and 3 | 14 appearances x 2 skins, the count read from the discovered catalogue |
| AP-3 | ordinary open | Task 6 AP-3 | First paint in host colours, no flash |
| AP-4 | lazy open | Task 4 "reads after the last await"; Task 6 AP-4 | Change during the chunk hold; the seed is the latest |
| AP-5 | changes while open under the reviewed contract | Task 5; Task 6 AP-5 | Cycle, flip, switch; in place, within 100 ms, figures redrawn |
| AP-6 | native chrome, typography, surfaces, focus, accessibility | Task 2 part 3; Task 6 AP-6 | Pairs meet floors on the installed frame; focus visible; Aa line |
| AP-7 | retained phone and desktop geometry budgets | Task 6 AP-7 | One bar, and 61, 48, 44 px on a phone; at most 1 px on tablet and desktop, per skin |
| AP-8 | no independent catalogue or mode-only substitution | Task 2 part 4; Task 6 AP-8 | Scan green; the bridge sent `appearance` |

## Mutation rows

Each row is measured once, alone, from a saved copy, with `timeout -k 10 600` (900 for browser) and a measured process cap of at most 4096. A timeout is not a red.

| Id | Mutation | Must red |
|---|---|---|
| AP-M1 | `bridge.ts` never passes `appearance` | Task 4 "an outcome of kind `appearance`"; AP-8 browser row |
| AP-M2 | Drop one slot from `READER_APPEARANCE_MAP` | Task 2 coverage (and typecheck) |
| AP-M3 | Add `['nord', 'dracula']` to a file under `pwa/src/docs/` | Task 2 part 4 |
| AP-M4 | Move the appearance read above the assets await | Task 4 "reads after the last await"; AP-4 |
| AP-M5 | `ReaderFrame` ignores stamp changes | Task 5 "while open"; AP-5 |
| AP-M6 | One unreadable colour leaves that slot out, instead of dropping the colour group | Task 2 "one colour token answering `''`" |
| AP-M7 | Map `text ← --ink-disabled` | Task 2 part 3, in at least one palette |
| AP-M8 | Skip contract detection, always pass `appearance` | Task 4 "an older library" |
| AP-M9 | Remove the per-frame coalescing | Task 5 "coalesces to the latest per frame" |
| AP-M10 | `normaliseHostColour` accepts any string starting `#` | Task 2 normaliser rows (`'#2e3440;'`) |
| AP-M11 | `useHostAppearance` reads the stored choice instead of the root | Task 3 "a system flip moves the stamp" |
| AP-M12 | The lab profile passes `appearance` | Task 4 "the lab" |
| AP-M13 | A hosted mount sends neither `appearance` nor `prefs.theme`, so the stored theme rules | Task 6 AP-3 (stale stored theme) |
| AP-M14 | A dropped colour group sends `setPrefs({theme})` instead of an appearance with no colours | Task 4 "while open, hosted" |

## Deviations found

- **D-8759 (2026-11-18)**: reader-bridge-appearance-op. Issued to run 2631 (X1). It departs from the rich-docs spec's §4.4 sentence "Every later parent message goes on the port, and is `prefs`, `changes.result`, `mermaid` or `command` (amended 2026-11-10; library 1.1 take-up)". It also departs from M8.6's "Every other parent message goes on the port and is `prefs` or `changes.result`, any number of times, or, since the library 1.1 take-up, `mermaid` (once, after `ready`) or `command`", with its refusal "send an op other than `prefs`, `changes.result`, `mermaid` or `command` on the port", and from §4.3's Fonts row "`data:` inside the inlined CSS | About 415 KB as base64".
  - The parent also sends `appearance` on the existing port, any number of times, coalesced to one per animation frame. It is a flat object under the library's closed key table: `v`, `mode`, `c.<slot>`, `s.<slot>`.
  - ccrc's two typefaces travel as `data:` font assets the library checks and declares, about 188 K characters of base64.
  - No channel, listener, frame-to-parent op or CSP change is added.
  - Why: the operator's 2026-11-10 amendment requires changes while open to travel on the existing checked bridge, and `prefs` cannot carry them (spec X1-3).
  - Task 7 amends the sentences.
- **D-8760 (2026-11-18)**: reader-hosted-theme-is-ccrcs. Issued to run 2631 (X1). It departs from the rich-docs spec's §3.2 row "`prefs`, `chrome` | The layout's own top bar and Aa menu defaults | ccrc's current theme as the starting value. Later changes arrive by the `prefs` op. Reader prefs are stored apart from console prefs." It also departs from G7's "Theme, width, marks and last visit live in ccrc's own localStorage, per device, under the reader prefix `ccrc:reader:v1:`".
  - While ccrc hosts the reader with an appearance, theme is not a reader preference. The frame ignores a stored theme and never writes one, and Aa shows "Appearance follows ccrc Settings" in place of its theme row (ask 594, answered by the coordinator 2026-11-18, option 0).
  - Width, marks, last visit, font and folds stay reader preferences under `ccrc:reader:v1:`.
  - Why: the operator's 2026-11-10 amendment gives global appearance one owner, ccrc.
  - Task 7 amends the sentences.

Unused from run 2631's block: 8761.

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
- **Frame asset sizes:** `reader.css` is 549 069 characters, 413 096 of them base64 fonts (4 faces); `enhance.js` 198 234; `bootstrap.js` 30 153; `guard.js` 3 643. ccrc's faces are 69 492 and 71 236 bytes, about 188 K characters as base64.
- **The mapped tokens are literal in every palette.**
  - A script parsed `tokens.css`, merged both default blocks, took the default as `phosphor`, overlaid each `[data-theme]` block, and followed `var()` chains.
  - The 29 distinct colour tokens the map names (focus and accent share `--accent`), `--accent-on-well`, and the 2 radius tokens resolve to `#rrggbb` or whole px in all 12 palettes: 0 misses.
  - Every palette declares `color-scheme` as `light` or `dark`.
  - Skin values: `--row-h` is 52 px for Refined and 32 px for Instrument under a fine pointer; `--case-section` is `none` or `uppercase`.

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
| C1: the 36 library colour properties include tints and composites that ccrc carries as `color-mix(...)` in some palettes, so all or nothing would drop Phosphor or Nord to mode only | Fixed. Version 1 carries 30 base colours only, and the library derives tints with `color-mix` (spec §2, X1-11). Measured: every mapped token is a literal in all 12 palettes |
| I1: `audit.mjs` cannot resolve palettes for part 2 | Fixed. New test helper `paletteTokens.ts` (Task 2) |
| I2: a fallback while open left the old palette on screen, and `prefs` persists `theme` | Fixed. An appearance with no colour group drops host colours and stays hosted. While hosted, `theme` is never sent or stored (spec §2.1, §7, §10) |
| I3: `./host` may be imported only by `bridge.ts` | Fixed. The pure exports live in `./frame` (spec §10, Task 1) |
| I4: fonts could push a document past the library's srcdoc cap, or fail the mount | Fixed. The cap rises by the fonts' cap, a bad font is dropped, and ccrc loads fonts on their own path (spec §2.2) |
| I5: AP-M9 could stay green | Fixed. The changes are spaced across tasks (Task 5) |
| I6: the older-library row could not be built | Fixed. `ReaderMountDeps.contract`, a test seam (Task 4) |
| I7: density and controls were dropped without an ask | Fixed in the design. The skin's radius, popover row height and section-label case are carried. The bar and reading layout stay, as the operator's own reading-layout and budget constraints require (X1-7). Reported to the coordinator in the wave-done mail |
| I8: no red-capable row for "a stale reader preference never overrides" | Fixed. AP-3 seeds a stale stored theme, and new mutation row AP-M13 |
| Minor: palette counts | Fixed: 8 dark, 4 light |
| Minor: D-8729 is not on `main` | Fixed: wave C waits for #3026 |
| Minor: AP-3 cannot see a pre-`ready` flash | Recorded. The library's own test owns paint before first paint (spec §10). AP-3 checks the seed and the first-`ready` values, and F's device check looks for a flash |
| Minor: a stamp read at the call made a needless follow-up op | Fixed. The bridge's read returns the stamp, and the mount carries `seededStamp` |
| Minor: the scan was narrow | Fixed. It covers object keys and hex literals, and includes `pwa/src/lib/appearance.ts` |
| Minor: queued redraws could stack | Fixed. A newer appearance cancels them, with a library test |
| Minor: font CSS text | Fixed. The `FontFace` API loads decoded bytes |
| Minor: no run count for the median | Fixed: 9 opens |
| Minor: server suites | Fixed. Task 7 runs them from `server/` |
| Minor: the one-bar budget had no row | Fixed: AP-7 and spec §9 |

### The repo's review judge

At `41d3ade8d`, every required check and CodeQL passed. The repo's review judge, which is not a required check, was red on one blocking reason, `promise-delta-missing`: the new spec had no `promise-delta` fence. Fixed by spec §13, which uses the template's "none - <reason>" form.

### Carried

- The library programme plans wave L from spec §10. Its release and ccrc's re-pin are the operator's.
- Wave C waits for wave R and for #3026.
