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
- Contrast floors: 4.5:1 for every text colour on every ground the stylesheet paints, plain or tint, for code tokens, and for the labels of figures of the kinds in `MERMAID_HOSTED_KINDS` that are not author-styled; 3:1 for the focus ring on `bg`, `surface`, `surface2` and the tints, the grounds a ring is drawn on, and for those figures' lines; no floor for decorative edges. Every other figure draws on 1.1.0's plate and filter, as in 1.1.0 (spec §5, §10). A coloured tint holds at most 4% of its colour, mixed over `bg` or `surface`. Inline code sits on the opaque `surface2`, never on a tint (spec §5, §10).
- Budgets: payload at most 4 KiB serialised; at most one `appearance` op per animation frame, latest wins; hosted srcdoc growth over the same document at the 1.1.0 pin in three parts: ccrc's two faces exactly 187 640 characters; this contract's own frame-asset growth at most 32 768 characters over the baseline row, the sum of every `FRAME_MANIFEST` entry with Mermaid's included at the first parent of the landing that adds the table (1.1.0's 4 528 020 when no library landing comes between), measured at the library landing that lands it, with each later design in the release measured from that landing against its own share, which the coordinator sets; the appearance seed at most 4 096. So at most 224 504 plus the other designs' shares; hosted open-to-`ready` median of 9 opens at most 1.10 x the BASE median of 9; a change while open shows on the frame root within 100 ms, same iframe and nonce, scroll within 1 px; Mermaid redraw one figure per task, no gap over 200 ms.
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
| `pwa/src/docs/reader/appearance.ts` (new) | L1 | 2 | `READER_APPEARANCE_MAP`, `READER_APPEARANCE_CONTRACTS`, `readerAppearanceSupported`, `READER_APPEARANCE_LABEL`, `readerAppearanceOf` |
| `pwa/test/reader-appearance.test.ts` (new) | — | 2 | Pure rule rows |
| `pwa/test/reader-appearance-source.test.ts` (new) | — | 2 | Slot coverage, every palette resolves, contrast pairs, second-copy scan |
| `pwa/test/helpers/paletteTokens.ts` (new) | — | 2 | `resolvePaletteTokens(themeId, skinId, pointer)`: both default blocks merged, `phosphor` as the default, the skin block and its `(pointer: fine)` arm, `var()` chains, `color-scheme` |
| `pwa/src/lib/appearanceStamp.ts` (new) | L1 | 3 | `appearanceStamp(root)`, a pure read of two attributes, the one stamp function. Imported by `appearance.ts` and `hostAppearance.ts`, both inward edges |
| `pwa/src/lib/appearance.ts` (new) | L4 | 3 | `useHostAppearance()`, the stamp hook, over `appearanceStamp` |
| `pwa/test/host-appearance.test.tsx` (new) | — | 3 | Stamp rows |
| `pwa/src/docs/reader/hostAppearance.ts` (new) | L3 | 4 | `readHostAppearance(root)` over `getComputedStyle`, imported by `bridge.ts` only |
| `pwa/src/docs/reader/assets.ts` | L3 | 4 | `loadReaderFonts()` |
| `pwa/src/docs/reader/bridge.ts` | L3 | 4 | `appearance` at mount, `seed`, `follow`, contract detection, fonts |
| `pwa/src/docs/reader/policy.ts` | L1 | 4 | `readerMountPlan` gains `appearance: boolean`; `isHostedMount`, the one hosted decision |
| `pwa/test/reader-policy.test.ts` | — | 4 | The two `readerMountPlan` `.toEqual` rows gain the field |
| `pwa/test/reader-bridge.test.ts` | — | 4 | Bridge rows, and the two `readerMountPlan` rows of "readerMountPlan is the one decision" |
| `pwa/test/shadcn-alias.test.ts` | — | 4 | "nothing imports `@/`" becomes "exactly `assets.ts` imports `@/`", and its pattern catches a dynamic `import('@/…')` |
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
  - **This contract's share.** Read the library's test 8 size table at that commit, as an immutable git object (`git -C <library repo> show <sha>:<table path>`, the path the brief names; the table is committed source, so no build output needs to be committed). It holds exactly two rows, the two the landing that introduces the table must hold (spec §10 test 8): the baseline, and this contract's row, share 32 768. The baseline is the first parent's manifest total. Read it from the table, and check it against that parent's `dist/frame/manifest.generated.js` read the same way: when the parent is 1.1.0's release, `total` and `frame` are 4 528 020 characters (3 643, 30 153, 198 215, 549 069 and 3 746 940, the `chars` of 1.1.0's five `FRAME_MANIFEST` entries, Mermaid's included; 4 530 427 in bytes). Any other baseline is reported with the parent named, and the wave measures against it. The library caps the srcdoc in characters, so characters are the unit. This contract's recorded `total` or `frame` less the baseline's, above 32 768, stops the wave and is reported. Each row's measuring commit is the landing that appended it, printed by the library's test 8 from the table's history (spec §10); the brief names that landing, and the two must agree.
  - **The release.** Read the same table in the installed package (or at the release's tagged commit, the path the brief names). Every design's growth is within its shares as test 8 counts it; the last row's `total` equals the sum of every entry's characters in the installed package's manifest, and its `frame` the largest single frame's. Either failing stops the wave and is reported.

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
/** The one decision on contract support: `'none'` (1.1.0) and any number outside READER_APPEARANCE_CONTRACTS are false. */
export function readerAppearanceSupported(contract: number | 'none'): boolean;
export const READER_APPEARANCE_LABEL = 'Appearance follows ccrc Settings'; // the contract's label, ruled copy (ask 594)
export interface ReaderAppearanceOutcome {
  readonly value: Appearance;
  /** The library verdict's own list: each key it left out, and why. */
  readonly refused: readonly { readonly key: string; readonly why: string }[];
  /** `null`: every colour applied. Otherwise the colour group was dropped (spec §7): a token read empty, a value the
   * verdict refused, or a colour scheme that is neither light nor dark. */
  readonly dropped: null | { readonly why: 'colour-unreadable' | 'colour-refused' | 'scheme-unreadable'; readonly token: string };
}
/** Called only on a hosted mount, after readerAppearanceSupported answered true, so it has no mode-only case. */
export function readerAppearanceOf(read: (token: HostToken) => string, colourScheme: string): ReaderAppearanceOutcome;
// pwa/test/helpers/paletteTokens.ts
export function resolvePaletteTokens(
  themeId: string, skinId: string, pointer: 'fine' | 'coarse',
): { readonly tokens: ReadonlyMap<string, string>; readonly colourScheme: string };
```

The map is spec §3's table, slot for slot. Each mapped colour token was measured to resolve to `#rrggbb` in all twelve palettes, and every pair to meet its floor (2026-11-18, Results, "Contrast under the map"). A pair that misses its floor under this map in some palette stops the wave and is reported. It is not remapped silently.

- [ ] **Step 1: Write the failing pure rows** in `reader-appearance.test.ts`:
  - `readerAppearanceOf` builds the raw contract, each value the token's text exactly as `read` answers it (spec §2's grammars: ccrc normalises nothing, no trim and no case change), and returns `parseAppearance`'s verdict. It checks no range or grammar of its own:
  - `readerAppearanceOf`:
    - **every mapped token:** with a reader answering every mapped token and `'dark'`, the keys of its value's `colour` equal `APPEARANCE_SLOTS.colour`, and the keys of its `skin` equal `APPEARANCE_SLOTS.skin`, both ways. Its `refused` list is empty, `dropped` is `null`, and its `label` is `READER_APPEARANCE_LABEL`;
    - one colour token answering `''` gives a value with `mode` set, no colour group, and `dropped: {why:'colour-unreadable', token}`;
    - **a colour the verdict refuses:** one colour token answering a non-empty text the library refuses, `'rgb(1, 2, 3)'` for `--accent` (the row first asserts that `parseAppearance` refuses it), gives a value with `mode` set and no colour group, `dropped: {why:'colour-refused', token: '--accent'}`, and the verdict's `refused` naming `accent`;
    - an unreadable skin token keeps every colour, leaves that slot out, and has `dropped: null`;
    - **support, decided once:** `readerAppearanceSupported(1)` is true; `readerAppearanceSupported('none')` (a library without the contract) and `readerAppearanceSupported(2)` (one newer than ccrc knows) are false. Nothing else in ccrc compares a contract number;
    - a `colourScheme` of `'normal'` or `''` gives `mode: 'auto'`, no colour group, and `dropped.why: 'scheme-unreadable'`;
    - a skin token whose value the library refuses is left out by the verdict, and every colour stays. The fixture is `--row-h` answering `'60px'`, and the row first asserts `parseAppearance({mode: 'dark', skin: {controlRow: '60px'}}).refused` names `controlRow`, so the fixture never stands in for a range ccrc spells itself;
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
  3. **No second list**, over `pwa/src/docs/`, `pwa/src/readerLab/`, `pwa/src/lib/appearance.ts` and `pwa/src/lib/appearanceStamp.ts`:
     - no file holds two or more `THEMES` ids, or two or more `SKINS` ids, as string literals or as object keys, quoted or not;
     - no file under `pwa/src/docs/reader/` holds a hex colour literal;
     - only `pwa/src/docs/ReaderFrame.tsx` imports `THEMES`, and no file imports `SKINS`.
  4. **No stylesheet crosses:**
     - at run time, no string in any value `readerAppearanceOf` builds in part 2 contains `;`, `{`, `}`, `url(` or `var(`. Every top-level key is one of `mode`, `label`, `colour` and `skin`, and every key inside `colour` or `skin` is a slot of that group in `APPEARANCE_SLOTS`;
     - in source, `appearance.ts` holds no such literal.
  5. **Contrast (spec §5):** for each palette and each skin, every `APPEARANCE_PAIRS` entry over the mapped values meets its floor. The pairs are the library's product of text colours and grounds, so the cross pairs are in it: a link on the `chg` tint, inline code on `surface2` inside a link, `text-faint` on a row tint, and the summary box's `chg` tint over `surface`. Each tint is computed as the library's stated mix, rounded to 8 bits per channel as a browser paints it. The number of palettes checked equals `THEMES.length`, read at run time, never a typed 12. The case title names the palette, the pair and the measured ratio.
- [ ] **Step 3: Run both to red.** `ccrc test -- ./node_modules/.bin/vitest run test/reader-appearance.test.ts test/reader-appearance-source.test.ts` from `pwa/`. Expected: FAIL, the module is missing.
- [ ] **Step 4: Implement `appearance.ts` and the helper.** `appearance.ts` is pure (ring L1): no `document`, no `getComputedStyle`. `readerAppearanceOf` takes `mode` from `colourScheme`, trimmed: `'light'` or `'dark'`. Anything else is `'auto'` with the colour group dropped. Every palette block declares `color-scheme` (measured 2026-11-18), and part 2 pins that per palette.
- [ ] **Step 5: Run to green**, same command. Expected: PASS.
- [ ] **Step 6: Commit** the four files: `feat(docs): the reader's appearance map and its one-source scan`.

### Task 3: The host appearance stamp

**Files:**
- Create: `pwa/src/lib/appearanceStamp.ts`, `pwa/src/lib/appearance.ts`, `pwa/test/host-appearance.test.tsx`

**Interfaces:**
- Produces: `export function appearanceStamp(root: HTMLElement): string` in `pwa/src/lib/appearanceStamp.ts` (L1), the one stamp function: `` `${data-skin ?? ''}|${data-theme ?? ''}` `` of `root`, a pure read of two attributes that imports nothing. And `export function useHostAppearance(): string` in `pwa/src/lib/appearance.ts` (L4, it is a hook), which answers `appearanceStamp(document.documentElement)`, kept by one `MutationObserver` with `attributeFilter: ['data-skin', 'data-theme']`, through `useSyncExternalStore`. Both are main-bundle modules. The hook and Task 4's `readHostAppearance` (L3) each import `appearanceStamp` from the L1 module, so the stamp has one writer and both edges point inward (review 2676 A9 (1), carried at X4; placed in its own L1 module at review 2694 F6, because an L3 adapter importing the L4 hook module would point outward).

- [ ] **Step 1: Write the failing rows:**
  - renders the current stamp;
  - `applyTheme('nord', root, false)` re-renders with `|nord`;
  - `applySkin('instrument', root)` re-renders with `instrument|`;
  - **a system flip moves the stamp:** with stored choice `system`, `initTheme` given a fake media query that flips to light moves the stamp to `|light`;
  - a change to any other attribute does not re-render;
  - unmounting the last subscriber disconnects the observer;
  - **one stamp:** for roots carrying each of `''`, `'instrument'` and `'refined'` as `data-skin` and `''` and `'nord'` as `data-theme`, `useHostAppearance()` answers exactly `appearanceStamp(root)`.
- [ ] **Step 2: Run to red** (`test/host-appearance.test.tsx`). Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement** `appearanceStamp` in `pwa/src/lib/appearanceStamp.ts`, and `useHostAppearance` in `pwa/src/lib/appearance.ts` over it. The hook has one observer shared by all subscribers, created on first subscribe.
- [ ] **Step 4: Run to green.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(pwa): one stamp for the applied appearance`.

### Task 4: The bridge carries the appearance

**Files:**
- Create: `pwa/src/docs/reader/hostAppearance.ts`
- Modify: `pwa/src/docs/reader/bridge.ts`, `pwa/src/docs/reader/assets.ts`, `pwa/src/docs/reader/policy.ts`, `pwa/test/reader-bridge.test.ts`, `pwa/test/reader-policy.test.ts`, `pwa/test/docs-scans.test.ts`, `pwa/test/shadcn-alias.test.ts`

**Interfaces:**
- Consumes: Task 2's `readerAppearanceSupported`, `readerAppearanceOf`, `ReaderAppearanceOutcome`; Task 1's `APPEARANCE_CONTRACT`, `HostAdapters.appearance`, `FrameAssets.fonts`, `DocFrame.setAppearance`.
- Produces:

```ts
// hostAppearance.ts (L3). Imported by bridge.ts only, so the library stays in the lazily loaded chunk.
export function readHostAppearance(root: HTMLElement): { readonly stamp: string; readonly outcome: ReaderAppearanceOutcome }; // hosted mounts only
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
// policy.ts (L1, beside readerMountPlan): the one hosted decision (F6). Pure: it takes booleans, imports no library, and stays in the main bundle
export function isHostedMount(plan: ReaderMountPlan, supported: boolean, hasRoot: boolean): boolean; // supported && plan.appearance && hasRoot
```

- **Hosted, explicitly, decided once.** A mount is hosted when all three hold: `readerAppearanceSupported(contract answer)` is true, `readerMountPlan(...).appearance` is true (it is false for `lab-draw`), and the mount was given an `appearanceRoot`. One pure function, `isHostedMount(plan, supported, hasRoot)` in `policy.ts` (L1, beside `readerMountPlan`), decides it, and nothing else in ccrc combines the three (review 2676 F6, carried at X4; placed in L1 at review 2694 M1). `bridge.ts` (L3) only gathers its inputs and acts on the answer, before any read: `supported` from `readerAppearanceSupported(contract answer)`, the one support decision in `appearance.ts`, and `hasRoot` from `input.appearanceRoot !== undefined`. `policy.ts` takes booleans, so it imports neither `appearance.ts` nor the library, and the main bundle stays library-free. So `readHostAppearance` runs on hosted mounts only, a `{hosted: true}` seed always carries an appearance, and a mount that is not hosted never reads the root. `seed` says which case holds, with no overloaded null.
- `readHostAppearance` calls `getComputedStyle(root)` once, and reads `color-scheme` and the mapped tokens through `getPropertyValue`. Its stamp is Task 3's `appearanceStamp(root)`, imported from the L1 module `pwa/src/lib/appearanceStamp.ts`, an inward edge from this L3 adapter: it builds no stamp of its own, and it imports nothing from the L4 hook module. It runs `readerAppearanceOf`, so it imports `appearance.ts`, which imports the library's `./frame` entry. Only `bridge.ts` imports it, and the main bundle reaches `bridge.ts` only through `lazyMountReader`'s dynamic import. `ReaderFrame.tsx` imports neither file by value.
- `loadReaderFonts` reads the design system's own `Geist-Variable.woff2` and `GeistMono-Variable.woff2` through an inline asset import: `@/fonts/Geist-Variable.woff2?inline` and `@/fonts/GeistMono-Variable.woff2?inline`, through pwa's `@` alias to `ui/src` (`pwa/vite.config.ts`). It strips the `data:` prefix to the base64. No font file is copied into `pwa/`. The fonts load on their own path, beside the assets. If they fail, the bridge mounts without `fonts`, and never calls `onFallback('assets')` for them.
- On a hosted mount, `follow` re-reads the root and sends `DocFrame.setAppearance` with the verdict, a verdict with no colour group included. It never calls `setPrefs` with a theme. On a mount that is not hosted, it sends `setPrefs({theme})`.

- [ ] **Step 1: Write the failing rows** in `reader-bridge.test.ts`, with a fake `mount`:
  - **reads after the last await:** three holds, one case each: hold `deps.assets`, hold the Mermaid wait, and hold `deps.fonts`. In each, change the root's tokens and `data-theme` while held, then release. The adapters' `appearance` is the post-release verdict, `seed` is `{hosted: true, stamp}` with the post-release stamp, and the root was read exactly once per library mount, after all three settled, with no await between that read and `mount`. An `openAt` remount, which rebuilds the adapters, reads once more, and its stamp updates `seed` (review 2676 F7, carried at X4);
  - **a hosted mount** passes `adapters.appearance` and `assets.fonts`, and passes no `prefs.theme`;
  - **a dropped colour group** still passes `adapters.appearance`, with `mode` and no `colour` group;
  - **fonts that fail to load** mount without `fonts`, and `onFallback` is never called;
  - **the faces are ccrc's files:** the base64 `loadReaderFonts` answers decodes to bytes whose sha256 equals the sha256 of `ui/src/fonts/Geist-Variable.woff2` and `ui/src/fonts/GeistMono-Variable.woff2`, read from disk in the test;
  - **an older library:** with an `appearanceRoot` given, `deps.libraryContract` answering `'none'`, and `deps.mount` throwing `TypeError` on any key outside 1.1.0's set, the mount succeeds as a mode-only mount: `prefs.theme`, no `appearance`, no `fonts`, `seed` `{hosted: false}`, and the root is never read (a spy on `getComputedStyle` sees no call). With `deps.libraryContract` answering `2`, the same. This seam is the only way to reach the case: with the exact pin it is a build error;
  - **while open, hosted:** `follow` re-reads the root and calls `DocFrame.setAppearance` once, including for a dropped colour group, and never `setPrefs`;
  - **one warning per drop:** a mount whose outcome has `dropped` set calls `console.warn` once, with a message starting `ccrc-reader: ` and naming `dropped.why` and `dropped.token`; a second `follow` with the same drop warns again only if the token or the why changed;
  - **while open, mode only:** `follow` calls `DocFrame.setPrefs({theme})` once and reads nothing;
  - **after `destroy()`**, `follow` does nothing;
  - **the lab:** with `profile: 'lab-draw'` and an `appearanceRoot` given, so that only the plan's `appearance: false` can decide it, no `appearance` is passed, `seed` is `{hosted: false}` and the root is never read (a spy on `getComputedStyle` sees no call);
  - **the hosted decision:** in `reader-policy.test.ts`, `isHostedMount` over all eight combinations of `supported`, the plan's `appearance` (the Docs plan and the `lab-draw` plan) and `hasRoot` answers `true` for exactly one, all three true;
  - **the plan:** in `reader-policy.test.ts`, the Docs row (`readerMountPlan(undefined, 100, chrome, e17)`) expects `{ draw: docsDrawFor(e17), watchdogMs: readerWatchdogMs(100), store: true, chrome, history: true, appearance: true }`, and the lab row (`readerMountPlan('lab-draw', …)`) expects `{ draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false, chrome: 'frame-bar', history: false, appearance: false }`. Both rows exist on `main` today without the field, so they go red until Step 3. So do the two rows of `reader-bridge.test.ts`'s case "readerMountPlan is the one decision, and only lab-draw maps to drawing on open", which gain `appearance: false` (lab-draw) and `appearance: true` (Docs);
  - **the main bundle stays library-free:** in `docs-scans.test.ts`:
    - `LIBRARY_HOMES`' `/frame` home admits any `src/docs/reader/` file today. Its predicate also excludes the three reader modules `ReaderFrame.tsx` imports by value, `src/docs/reader/policy.ts`, `src/docs/reader/history.ts` and `src/docs/reader/readerText.ts`, so a library import in any of them answers `library:/frame`. Planted in a tree copy of `policy.ts`, which now holds `isHostedMount`, a `/frame` import answers it, and the unplanted tree answers none;
    - `READER_ADAPTERS` becomes `['src/docs/reader/bridge', 'src/docs/reader/assets', 'src/docs/reader/hostAppearance', 'src/docs/reader/appearance']`;
    - `adapterUseAllowed(file, target, dynamic)` keeps its two arms and gains exactly three, each a static value import made inside the lazily loaded chunk: `bridge.ts` → `src/docs/reader/hostAppearance` (the read), `bridge.ts` → `src/docs/reader/appearance` (`readerAppearanceSupported`, the one support decision), and `hostAppearance.ts` → `src/docs/reader/appearance` (`readerAppearanceOf`). Without them, the existing case "Library imports: the reader adapters reach the main bundle only through ReaderFrame's two dynamic imports" reds `main-bundle:value-import` on the plan's own imports. That case also gains one count: the uses of `hostAppearance` and `appearance` across `pwa/src` are exactly these three, as an exact list by specifier (Step 2). Its existing counts stay: `ReaderFrame.tsx` names `./reader/bridge` twice (its `import type` and the dynamic import), so Task 5's new types ride that existing `import type`;
    - a new case in clause W8a plants, in a tree copy, a value import of `hostAppearance` and one of `appearance` in `src/docs/ReaderFrame.tsx`, and one of `appearance` in `src/docs/DocsHead.tsx`. Each answers `main-bundle:value-import`, and the unplanted tree answers none;
  - **the font route's one importer:** `assets.ts` is the first file to import through the `@/` alias, which `shadcn-alias.test.ts` pins as unused ("nothing in the tree imports `@/` yet"). That case becomes: the files under `ui/src` and `pwa/src` that import `@/` are exactly `['pwa/src/docs/reader/assets.ts']`. Its pattern gains the dynamic form, `import\s*\(\s*'@\/`, beside `(?:from|import)\s+'@\/`. Planted in a tree copy, a second static importer and a dynamic `import('@/fonts/x.woff2?inline')` each red it;
  - **the key set:** the adapters' key set is the existing set plus `appearance`, exactly;
  - **only the verdict is passed:** the row first asserts that `parseAppearance` refuses `radius: '99px'`. Then, with a reader whose `--r-md` answers `'99px'`, the adapters' `appearance` has no `radius`, and the fake `mount` (which throws on any value `parseAppearance` would leave out) does not throw.
- [ ] **Step 2: Run to red** (`test/reader-bridge.test.ts test/reader-policy.test.ts test/docs-scans.test.ts test/shadcn-alias.test.ts`). Expected: FAIL on the new rows, the four changed `readerMountPlan` rows (two in each file), `shadcn-alias`'s changed case, which expects `assets.ts` to import `@/` before it does, and `docs-scans`' "Library imports" case on its new count: the uses of `hostAppearance` and of the reader's `appearance` are exactly three, and before Step 3 there are none. Its planted case passes on a tree copy once `READER_ADAPTERS` names them. Two modules are called `appearance`, `pwa/src/lib/appearance.ts` (Task 3) and `pwa/src/docs/reader/appearance.ts` (Task 2). `readerScan` records a use only when its specifier resolves to one of `READER_ADAPTERS`, so neither the hook module nor `hostAppearance.ts`'s import of `../../lib/appearanceStamp` (A9 (1), review 2694 F6) is ever recorded. The case's existing count is a regex over the recorded specifier text, `/\/reader\/(?:bridge|assets)$/`, which matches none of the new edges' specifiers (`./hostAppearance` and `./appearance`), so it stays 3 and cannot count them (corrected at review 2694 M7; the first text said the case already counted them). The new count is its own assertion, an exact list: the recorded uses whose specifier is `./hostAppearance` or `./appearance` equal `['src/docs/reader/bridge.ts ./hostAppearance', 'src/docs/reader/bridge.ts ./appearance', 'src/docs/reader/hostAppearance.ts ./appearance']` (review 2676 A3, carried at X4).
- [ ] **Step 3: Implement.**
  - Contract detection asks `deps.libraryContract`. Its default reads `APPEARANCE_CONTRACT` from a namespace import of the library's `./frame` entry, and answers `'none'` when that export is absent. The answer goes to `readerAppearanceSupported`, the one place that decides support.
  - The read sits beside D-8729's focus sample, after the Mermaid wait and before `mountDocFrame`, with no await between.
  - The lab path is decided by `readerMountPlan`, which gains `appearance: boolean`: `false` for `lab-draw`.
- [ ] **Step 4: Run to green:** `test/reader-bridge.test.ts test/reader-policy.test.ts test/docs-scans.test.ts test/shadcn-alias.test.ts`. Expected: PASS, with `docs-scans`' "Library imports" case green over the three new edges.
- [ ] **Step 5: Commit**: `feat(docs): the reader bridge carries ccrc's appearance`.

### Task 5: The frame follows the host

**Files:**
- Modify: `pwa/src/docs/ReaderFrame.tsx`, `pwa/test/reader-frame.test.tsx`
- Modify, the `ReaderMount` fakes outside this plan's other Files (review 2676 F5, carried at X4): `pwa/test/docs-one-bar.test.tsx`, `pwa/test/docs-version.test.tsx`, `pwa/test/reader-history-adapter.test.tsx`, `pwa/test/tap-targets.test.tsx` and `pwa/test/reader-lab-run.test.ts`. Each fake gains `seed: {hosted: false}` and a `follow` that records its calls. `ReaderFrame` reads a missing `seed` as `{hosted: false}`, so a fake older than Task 4's type still mounts as not hosted at run time; it reads no missing `follow`, because a not-hosted mount's theme changes go to `follow`, so every fake carries one. The typecheck does not enforce that: the fakes are cast (`as ReaderMount`, `as unknown as ReaderMount`), and a cast skips the missing-property check (only `reader-lab-run.test.ts` uses `satisfies`). The fake lists here are what ensures it, and Step 4 runs every listed file (corrected at the X4 fix round's adversarial pass). `reader-lab-run.test.ts`'s `satisfies ReaderMount` typechecks once its fake carries both.
- The fakes inside `pwa/test/reader-frame.test.tsx` itself (review 2694 M6), four of them: the `harness()` handle (`{destroy, setPrefs, command, openAt}`), the two inline mounts that return `{destroy, setPrefs}` (in "a fallback before the mount lands keeps the fragment for the plain view" and "a mount with no openAt takes a same-page link as an address rewrite alone"), and the late mount `{destroy, setPrefs, command}` in the sign-in case ("the late first mount is destroyed when it lands"). Each gains `seed: {hosted: false}` and `follow: vi.fn()`, except the fake of the "fake with no seed" row below, which has `follow` and no `seed`.

**Interfaces:**
- Consumes: Task 3's `useHostAppearance`; Task 4's `ReaderMountInput.appearanceRoot`, `ReaderMount.seed` and `ReaderMount.follow`, as types. It imports no value from the four `READER_ADAPTERS` (`bridge.ts`, `assets.ts`, `hostAppearance.ts`, `appearance.ts`) other than `lazyMountReader`'s two existing dynamic imports, of the bridge and of `./reader/assets` (the main-bundle scan, Task 4). Its existing value imports of `reader/history`, `reader/policy` and `reader/readerText` stay, and so does `lazyMountReader`'s second dynamic import, `./reader/assets`, beside the bridge's.

- [ ] **Step 1: Write the failing rows** in `reader-frame.test.tsx`:
  - **seed:** the mount input's `appearanceRoot` is `document.documentElement`;
  - **after the mount resolves:** on a hosted mount, when the current stamp differs from `seed.stamp`, `follow` is called exactly once. When they are equal it is never called, even if the stamp moved during the hold, before the bridge's read;
  - **while open:** on a hosted mount, each stamp change calls `follow`, and the reader keeps the same mount (no `destroy`, no second `mount`);
  - **coalesces to the latest per frame:** three stamp changes, each in its own task (separate `await`s), inside one faked animation frame call `follow` once. Without the coalescing they would call it three times. Changes made in one task arrive as one observer callback, so they cannot show the difference;
  - **the mode-only fallback:** on a mount whose `seed` is `{hosted: false}`, `readerPrefsOf(useThemeChoice(), THEMES)` feeds `follow`'s theme, as today's `setPrefs` does;
  - **the mode-only trigger:** on a mount whose `seed` is `{hosted: false}`, on a dark device, Follow the system → Phosphor leaves the stamp unchanged but moves the derived mode from `'auto'` to `'dark'`. The kept `[prefs]` effect calls `follow('dark')` exactly once. On a mount whose `seed` is `{hosted: true}`, the same change calls nothing;
  - **a fake with no seed:** a mount object that has `follow` and no `seed` field mounts, is treated as `{hosted: false}`, and gets `follow` with the theme where today's code calls `setPrefs({theme})`;
  - **the mode-only rows move to `follow`:** the three existing rows that assert `setPrefs({theme})`, "a theme change calls setPrefs once and never remounts", "the palette decides the frame theme: dark seeds dark, system is auto, and a switch within a mode sends nothing" and "a theme change while the mount is pending reaches the frame once it lands", stay in this file on the `harness()` fake, now `{hosted: false}`. Each asserts `follow` with the same theme (`'dark'`; `'auto'` after the switch to system; `'dark'`) where it asserted `setPrefs({theme})`, and that `setPrefs` is never called with a `theme`. The first is renamed "a theme change calls follow once and never remounts".
- [ ] **Step 2: Run to red** (`test/reader-frame.test.tsx`). Expected: FAIL on the new rows and on the three moved mode-only rows, which assert `follow` before Step 3 calls it; every other row passes.
- [ ] **Step 3: Implement.** Branch on the mount's `seed.hosted`. Hosted: compare stamps against `seed.stamp`. Not hosted: keep today's `[prefs]` effect and `seededPrefs`, calling `follow`. Keep `live.current` for the latest stamp and mode. Coalesce with one `requestAnimationFrame` handle that is local to the effect and cancelled on cleanup.
- [ ] **Step 4: Run to green**, plus `test/reader-bridge.test.ts` and the five fake files: `test/docs-one-bar.test.tsx test/docs-version.test.tsx test/reader-history-adapter.test.tsx test/tap-targets.test.tsx test/reader-lab-run.test.ts`, and pwa's typecheck of its tests. Expected: PASS.
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
    - **the live verdict refused nothing:** every colour and every skin slot's library-owned custom property is set on the frame root, and the Aa line is ccrc's label. A slot the browser's own spelling made the verdict refuse would be missing here, in the real engine, where Task 2 part 2 checks only the helper's reading of the stylesheets;
    - the frame's sans and mono roles resolve to the loaded ccrc faces (`document.fonts` in the frame holds both with status `loaded`, and a chrome label's computed `font-family` starts with the library's fixed family name for the host face).

    Once per skin, with Aa open and under a fine pointer, assert the rows below. Each compares the browser's computed value on both sides, never a token's text with a computed value. The host side is a probe element in ccrc's own document (test-only, removed after), given the token through the same property: `box-shadow: var(--elev-pop)`, `border-radius: var(--r-md)`, `height: var(--row-h)`, and for the heading `font-size: var(--fs-section); letter-spacing: var(--ls-section)`, so an `em` resolves against the same size. Both sides then serialise alike: `rgba(0, 0, 0, 0.55) 0px 12px 40px 0px` on each, and `letter-spacing` in px on each.
    - a popover row's height equals the probe's `height`;
    - the popover's `box-shadow` equals the probe's;
    - the radii of a control, a pill and a popover equal the probes' for `--r-md`, `--r-sm` and `--r-lg`;
    - the Aa group heading's `font-size`, `font-weight`, `letter-spacing` and `text-transform` equal the probe's; its `font-family` starts with the library's fixed family name for the role `sectionFamily` names.

    And per skin, the frame bar's height, the measure, the prose size, the gutters and the title block's sizes equal BASE. Each is compared as a computed length in px, or as an element's `getBoundingClientRect()` height for the bar and the title block, never as a token's text. BASE is taken in the library's own faces and a hosted open is in ccrc's, so the fixture's title and byline each fit on one line in both faces at every tested width: a face change then cannot wrap them and move a box.
  - **AP-3:** with a stale reader theme stored under the reader prefix (`{"theme":"dark"}` under a light palette, and the reverse), the values at first `ready` equal the host's, never the stored theme's.
  - **AP-4:** hold the chunk, change palette and skin, release; at most one `appearance` op.
  - **AP-5:** while open, under both emulated device modes (light and dark), run every transition of the palette set, Follow the system included as a start and as an end: each palette to the next, each palette to Follow the system and back, and, while on Follow the system, the device mode flipping light to dark and dark to light. Then switch skin both ways. After each transition: same iframe element and nonce, scroll within 1 px, values within 100 ms, a drawn figure redrawn. The number of transitions is printed from the discovered catalogue.
  - **AP-6:** pairs on computed values, the focus ring at 3:1 after a Tab, and a drawn figure's edge `stroke` at 3:1 on its plate. Width, font and one fold changed in Aa are back after a reopen, and the stored `pref:prefs` holds no `theme` key. Aa shows the line "Appearance follows ccrc Settings", the label ccrc sent, and no theme row. Tab never lands on the line. A lab-profile mount, which carries no appearance, keeps its theme row. **Meaning without colour** (spec §10, X1-12), on a fixture that carries a glossary term, an id link and an ordinary link in running text, and opens the contents index and quick jump: in GitHub Light, Solarized Light and Catppuccin Latte, where `term` has no hue, `a.term`'s computed `text-decoration-style` is `dotted`, `a.xref`'s `dashed` and the link's `solid`; in Phosphor and Phosphor Daylight, where `ok` equals `info`, the index's `ok` and `info` dots have different computed `border-radius` or size; in Solarized Dark and Solarized Light, where `id` equals `accent`, `a.xref`'s and the ordinary link's computed `text-decoration-style` differ; in Tokyo Night, Nord, Gruvbox Dark and One Dark, where `chg` collides, a changed block's mark is the double bar; and quick jump's selected row has an inset `accent` box-shadow. The changed-mark geometry is the library's test 10, sampled from pixels; F reads it on the installed frame. **Mermaid, live:** one figure of each kind in the library's `MERMAID_HOSTED_KINDS` (read from the installed package, never typed), drawn in every palette: every label meets 4.5:1 on the shape painted behind it and every line that is not `border` or `rule` meets 3:1 on `surface` and `surface2`, on computed values; and a figure with a fill-only `classDef`, and a `journey`, each draw on 1.1.0's plate and filter.
  - **AP-8:** the bridge sent `appearance`; a forced mode-only mount fails this row's own assertion.
  - Extend the geometry files to run their existing assertions once per skin (**AP-7**), the one-bar assertion included.
  - Extend `frame-cost` with the srcdoc-growth budget, for the default layout (X2's wave P5 adds a row per layout, each over its own BASE): at most 191 736 characters over BASE, the two faces (187 640) and the seed (4 096). BASE is taken at Task 1's pin, so it already holds every design's library growth, which Task 1 Step 2a checks share by share. Together they keep spec §9's total over the same document at the 1.1.0 pin: 224 504 plus the other designs' shares. Also extend it with the open-to-`ready` budget (median of 9 opens at most 1.10 x BASE's median of 9).
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
| AP-2 | all twelve palettes and Follow the system | Task 6 AP-2; Task 2 parts 2 and 5 | 14 appearances x 2 skins, the count read from the discovered catalogue. Once more on a phone engine (WebKit, on F's device item): the live verdict refused nothing, so the grammars hold on that engine's `getPropertyValue` text, which Chromium alone does not show (review 2676 A7, carried at X4) |
| AP-3 | ordinary open | Task 6 AP-3 | With a stale reader theme stored, values at first `ready` are the host's. On a device, no light-then-dark flash is seen. Paint before first paint is the library's own test (spec §10) |
| AP-4 | lazy open | Task 4 "reads after the last await"; Task 6 AP-4 | Change during the chunk hold; the seed is the latest |
| AP-5 | changes while open under the reviewed contract | Task 5; Task 6 AP-5 | Cycle, flip, switch; in place, within 100 ms, figures redrawn |
| AP-6 | native chrome, typography, surfaces, focus, accessibility | Task 2 part 5; Task 6 AP-6 | Pairs meet floors on the installed frame; focus visible; Aa line. In every palette where `chg` collides with another meaning's hue (Tokyo Night, beside `wait`; Nord, Gruvbox Dark and One Dark, equal to `violet`), a changed block shows a double bar and an attention rule a single one. In every palette where `term` has no hue (GitHub Light, Solarized Light, Catppuccin Latte), term, id and ordinary links show three underline styles, and in both Solarized palettes, where `id` equals `accent`, an id link and an ordinary link differ by underline. In Phosphor and Phosphor Daylight, where `ok` equals `info`, the two dots differ in shape (review 2676 A2, carried at X4) |
| AP-7 | retained phone and desktop geometry budgets | Task 6 AP-7 | One bar, and 61, 48, 44 px on a phone; at most 1 px on tablet and desktop, per skin |
| AP-8 | no independent catalogue or mode-only substitution | Task 2 parts 3 and 4; Task 6 AP-8 | Scan green; the bridge sent `appearance` |

## Mutation rows

Each row is measured once, alone, from a saved copy, with `timeout -k 10 600` (900 for browser) and a measured process cap of at most 4096. A timeout is not a red.

| Id | Mutation | Must red |
|---|---|---|
| AP-M1 | `bridge.ts` never passes `appearance` | Task 4 "a hosted mount"; AP-8 browser row |
| AP-M2 | Drop one slot from `READER_APPEARANCE_MAP` | Task 2 coverage (and typecheck) |
| AP-M3 | Add `['nord', 'dracula']` to a file under `pwa/src/docs/` | Task 2 part 3 |
| AP-M4 | Move the appearance read above the assets await | Task 4 "reads after the last await"; AP-4 |
| AP-M22 | Move the appearance read between the assets await and the Mermaid wait, and, as a second run, before the fonts load settles | Task 4 "reads after the last await" (its Mermaid-wait and fonts cases) |
| AP-M5 | `ReaderFrame` ignores stamp changes | Task 5 "while open"; AP-5 |
| AP-M6 | One unreadable colour leaves that slot out, instead of dropping the colour group | Task 2 "one colour token answering `''`" |
| AP-M7 | Map `text ← --ink-disabled` | Task 2 part 5, in at least one palette |
| AP-M8 | Skip contract detection, so a `'none'` or `2` answer from `deps.libraryContract` still passes `appearance` | Task 4 "an older library": its "root is never read" spy sees a call, and the fake `mount` throws `TypeError` on the `appearance` key, so the mount does not succeed |
| AP-M9 | Remove the per-frame coalescing | Task 5 "coalesces to the latest per frame" |
| AP-M10 | `readerAppearanceOf` returns the raw contract and skips `parseAppearance` | Task 2 "a skin token whose value the library refuses" |
| AP-M11 | `useHostAppearance` reads the stored choice instead of the root | Task 3 "a system flip moves the stamp" |
| AP-M12 | `isHostedMount` ignores `readerMountPlan(...).appearance`, so a lab-draw mount given an `appearanceRoot` is hosted | Task 4 "the lab" (an `appearanceRoot` is given there, so the root test alone cannot keep it green) |
| AP-M13 | A hosted mount sends neither `appearance` nor `prefs.theme`, so the stored theme rules | Task 6 AP-3 (stale stored theme) |
| AP-M14 | A dropped colour group sends `setPrefs({theme})` instead of an appearance with no colours | Task 4 "while open, hosted" |
| AP-M15 | `readerAppearanceOf` leaves the skin group out | Task 2 "every mapped token" row (its `skin` keys no longer equal `APPEARANCE_SLOTS.skin`); AP-1 skin assertions |
| AP-M16 | `bridge.ts` never passes `fonts` | Task 4 "a hosted mount"; AP-1 face assertion |
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
- **Frame asset sizes:** `reader.css` is 549 069 characters, 413 096 of them base64 fonts (4 faces); `enhance.js` 198 215 characters (198 234 bytes); `bootstrap.js` 30 153; `guard.js` 3 643; 781 080 characters in all, as 1.1.0's `FRAME_MANIFEST` records them (783 343 bytes). Fix round 1 wrote 781 099, adding `enhance.js`'s bytes to the others' characters; review 2657 A8 corrected it. The library's faces, as base64: serif 163 148 and 173 584 (italic), sans 38 320 and 38 044 (italic). ccrc's faces are 69 492 and 71 236 bytes, exactly 187 640 characters as base64 (the seed does not escape base64). Spec §9 splits the srcdoc budget on these numbers (fix round 1, F10).
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
| `text-faint` on any 4% tint | 4.565 (4.58 unrounded; corrected at X4, review 2676 A9) | Catppuccin Latte | 4.5 |
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
| Mermaid, covered kinds (X4): `text` on `surface`, plate labels (edge labels, messages, loop text, legend, titles, a done task) | 8.36 | Solarized Light | 4.5 |
| Mermaid (X4): `text` under the gantt axis's 0.8 opacity, on `surface` | 4.93 | Solarized Light | 4.5 |
| Mermaid (X4): `text` on `accent` at 4% over `surface`, an active gantt task | 7.89 | Solarized Light | 4.5 |
| Mermaid (X4): `text` on `no` at 4% over `surface`, a critical gantt task | 7.83 | Solarized Light | 4.5 |
| Mermaid (X4): `text-muted` on `surface`, a vertical marker's text | 6.74 | Solarized Light | 4.5 |
| Mermaid (X4): `bg` on `text-muted`, a sequence number on its marker | 6.14 | Catppuccin Latte | 4.5 |
| Mermaid (X4): `bg` on a series colour, a pie slice label, a git branch label and the cherry-pick mark | 4.88 | Catppuccin Latte | 4.5 |
| Mermaid (X4): series colours as lines (branches, slices, swatches) on `surface` | 5.19 | GitHub Light | 3 |
| Mermaid (X4): series colours as lines on `surface2` | 4.52 | Solarized Dark | 3 |
| Mermaid (X4): `accent` (the today line, an active task's outline) on `surface2` | 4.57 | Phosphor Daylight | 3 |
| Mermaid (X4): `no` (a critical task's outline) on `surface2` | 4.77 | Solarized Dark | 3 |
| Mermaid (X4): `accent` on `surface2`, a gantt task label Mermaid marks clickable (not drawn under `strict`) | 4.57 | Phosphor Daylight | 4.5 |
| Mermaid (X4): `text-muted` on `surface2`, a vertical marker's text over a gantt row | 5.54 | Catppuccin Mocha | 4.5 |
| Mermaid (X4): `text` on `surface2` at Mermaid's 0.5 commit-label opacity over `surface` | 7.69 | One Dark | 4.5 |
| Mermaid (X4): a mark inside a commit (`surface2` or `bg`) on its commit's series colour, `git0` to `git7` (corrected in X4 fix round 1, review 2694 F4) | 4.57 (`surface2` on `accent`) | Phosphor Daylight | 3 |
| Mermaid (X4 fix round 1): a sequence stick half arrowhead, `text-muted` by the stylesheet, on `surface` | 6.74 | Solarized Light | 3 |
| Mermaid (X4 fix round 1): the same on `surface2` | 5.54 | Catppuccin Mocha | 3 |

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
| I6: the older-library row could not be built | Fixed at the time with a test seam, since renamed `ReaderMountDeps.libraryContract` (fix round 1 F8, Task 4) |
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
| F1: fill tokens in text slots; border 3:1 | Fixed. Semantic slots map to ccrc's `-text` variants, and `chg` to `--acct-magenta`. Edges are decorative, with no floor, as in ccrc's own gate. Tints held at most 6% then; fix round 2 lowered them to 4% (review 2657 F1). Every pair is measured ("Contrast under the map" and "Cross pairs", above) |
| F2: `term`, `id`, `violet`, `path` unslotted | Fixed. They are slots now (33 colour slots), mapped to lane hues and secondary ink and measured. Spec §10 names every derived colour and its source |
| F3 (ruled): density and controls | Fixed. Popover elevation and the section-label type are skin slots (10 in all). Spec §2.3 lists all 31 ccrc skin tokens, carried or rejected, with values and reasons. X1-7 is Ruled |
| F4: rows did not observe the claims | Fixed. AP-1 and AP-2 assert slot values, faces, skin values and an unchanged reading layout. AP-6 checks that width, font and folds persist with no stored theme. New rows AP-M15 to AP-M18 |
| F5: two spellings and mechanisms | Fixed. The op carries the contract's one shape. D-8759 states the `FontFace` path and the §4.4 op table. Contrast reads through the palette helper. The scan's no-stylesheet part has both a run-time and a source check. D-8761 defines the §3.2 return-shape departure |
| F6 (ruled): Aa's copy in the library | Fixed. The contract carries a validated `label`, and the library's neutral default names no host. ccrc sends its ruled copy, with new row AP-M19 |
| F7: conflicting bad-value rules | Fixed. `parseAppearance` never throws for a slot value and returns a verdict. The frame applies it to the seed and to every op. ccrc sends only the verdict and spells no range, so its colour normaliser is gone |
| F8: overloaded seam | Fixed. `libraryContract: () => number \| 'none'`, with the row and AP-M8 to match |
| F9: parser claim | Fixed. The claim is restated, and X1-3 rests on keeping appearance out of persisted prefs |
| F10: fonts against the srcdoc budget | Fixed. The budget is three measured parts (187 640 faces, at most 32 768 library growth over 1.1.0's frame assets, at most 4 096 seed; the baseline is 781 080 characters, corrected at fix round 2). This sum, 224 504, replaced round 1's single ceiling of 192 KiB (196 608 characters) and is 27 896 over it. The ceiling was set before the faces were measured: the faces alone are 187 640, which would have left 8 968 characters for the library's own growth and the seed, too little for a stylesheet moved onto slots. The optional font split is dropped: it saves at most 76 364 and breaks a 1.1.0-style host |
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

### Fix round 2 (review run 2657, round 2 of 3, at `f6f89be82`; the coordinator's mail 25412)

One commit per finding, then this Results commit. The coordinator ruled F2 and F4. Every other fix follows the report's direction. The review found all 16 round-1 items closed.

| Finding | Disposition |
|---|---|
| F1: cross pairs outside the measured set | Fixed. `APPEARANCE_PAIRS` is the product of every text colour (14, `accent-hover` included) and every ground the stylesheet paints (spec §5), and the library tests that its grounds are closed (test 4). Tints hold at most 4%, inline code sits on the opaque `surface2`, `short-bg` is `surface`, and the summary box's 7% mix is 4% over it. Measured: 67 worst-case rows, 0 below floor ("Cross pairs", above) |
| F2 (ruled): `chg` and `term` hues | Fixed. X1-12 accepts what each palette defines, names Tokyo Night's orange `chg`, `chg` equal to `violet` in Nord, Gruvbox Dark and One Dark, and the hueless `term` in three light palettes, and drops "keeps its magenta". Meaning never by colour alone, read from 1.1.0: the heading mark names the change in words, and a glossary link is dotted. But changed blocks and rows share their bar-and-tint shape with every attention mark (attention rules, waiting callouts, task items, stack rows), so while hosted the library draws a changed mark no attention mark has (spec §10). New library test 10 pins every cue, and AP-6 reads them installed. No distinctness gate: each cue is a shape or a word |
| F3: the main-bundle scan reds on the plan's imports | Fixed. Task 4 names `adapterUseAllowed`'s three new arms and a planted case, runs `docs-scans` in Steps 2 and 4, and narrows the `ReaderFrame` sentence to the four adapters |
| F4 (ruled): whose growth the library cap counts | Fixed. Test 8 is a share table in commit order: 1.1.0's total, then this contract's 32 768, then a row per later design with the share the coordinator sets. Spec §9 part (2) and Task 1 Step 2a read this contract's growth from the manifest at its own commit, and the release against the sum of the shares. Test 9 pins the op sets before and after this contract's commit, the canonical CSP, and two behaviour rows. Spec §10 states how tests 4, 8 and 9 bound later work. One reading of the ruling's letter: `frameCsp()` embeds one hash per inlined script (1.1.0's `dist/frame/csp.js`), so its text changes with any frame script and cannot equal 1.1.0's literally. Test 9 asserts it equals 1.1.0's value with each script hash source replaced by this version's: the same directives, order and non-hash sources, and four hash sources |
| F5: value forms not pinned | Fixed. Spec §2 gives one anchored, bounded pattern per key over the text `getPropertyValue` answers: strings only, case-insensitive hex, outer ASCII spaces ignored and dropped, one U+0020 between tokens, at most 3 decimals, and a whole-value cap of 8 192 UTF-16 code units. ccrc normalises nothing. Library test 1 and Task 2 gain the rows |
| F6: label refusal a closed list | Fixed. Refused by category, `Cc`, `Cf`, `Zl`, `Zp` and a lone surrogate, with the six rows asked for plus U+00AD and U+2029. Checked with node: the class matches a lone surrogate and U+061C, and not an astral emoji |
| F7: Mermaid lines had no slot | Fixed. `mermaidThemeOf` names every input. Lines are `text-muted`: 5.54 at worst on `surface2` and 6.74 on `surface`. The §2 claim now holds and points at the rows |
| A1 | Fixed. AP-1 compares computed lengths and boxes, on a fixture whose title and byline stay on one line in either face |
| A2 | Fixed. AP-5 runs every palette and Follow the system transition under both device modes, the device flipping while on Follow the system |
| A3 | Fixed. AP-1's host side is a probe element given the same token, so both sides are the browser's serialisation |
| A4 | Fixed. Figure 3 goes through the bridge; Figure 1 uses §7's term |
| A5 | Fixed. One reading of the key rule; the vacuous `rgba(` exception is gone; the `'60px'` and `'99px'` fixtures first assert the verdict refuses them |
| A6 | Fixed. Support is decided once, by `readerAppearanceSupported`; `readerAppearanceOf` runs on hosted mounts only and has no mode-only case; new rows for a refused non-empty colour and the warning; AP-M8 names the assertions that red |
| A7 | Fixed. Task 4 owns `shadcn-alias.test.ts`: exactly `assets.ts` imports `@/`, and the pattern catches a dynamic `import('@/…')` |
| A8 | Fixed. The baseline is 781 080 characters (783 343 bytes). The F10 row says the three-part sum replaced round 1's 192 KiB ceiling, and why |
| A9 | Fixed in F1's commit: `accent-hover` is `color-mix(in srgb, accent 80%, text)`, gated on every ground (5.13 at worst), and the focus ring is measured on every ground (4.57 at worst, on `surface2`) |
| A10 | Fixed. Colour slots are `#rrggbb` only in version 1; alpha only inside `popShadow` |
| A11 | Fixed. Units stated (the cap rises by 349 528 characters), the CSP sentence scoped to the policy, and `TypeError` stated for `setAppearance` on a non-object and a malformed `fonts` asset |

**The adversarial re-pass** (Opus · high, over the changed sections, with an independent recomputation of the contrast rows). It found no critical issue, 8 important and 13 minor. It reproduced the lowest contrast rows independently (4.515 at the bottom), and found every mapped ccrc value accepted by its grammar in all 12 palettes and both skins. Dispositions:

| Re-pass finding | Disposition |
|---|---|
| I-1: the ground list missed the well and `accent`; 1.1.0 draws code-block text in `text` (about 1.1:1 on a dark well in light palettes); the `.hljs-*` classes had no mapping; fixed colours remained (diff backgrounds, tool buttons, the figure overlay, selection) | Fixed. Spec §5 says which text each ground admits. §10 maps every class 1.1.0 colours onto a slot by ccrc's own chat mapping (`ui/src/components/prose.css`), drops the diff backgrounds, and derives the other fixed colours while hosted. Test 4's walk opens every popover and the overlay, and forces hover and focus |
| I-2: `mermaidThemeOf` named five inputs, while 1.1.0 sets 15 theme variables and Mermaid's base theme falls back to its own defaults | Fixed. Every key 1.1.0 sets and every base-theme text key has a slot; test 5 checks the key set and the drawn SVG fills of four diagram kinds |
| I-3: test 4 contradicted itself; the derivations had no hosted qualifier; 1.1.0's light defaults put `text-faint` on `surface2` at 4.44 | Fixed. Every derivation applies while an appearance is applied, and 1.1.0's values stand otherwise. The gate rows run on a fixture appearance. The 4.44 default is carried as the library's own matter |
| I-4: meaning by colour alone beyond `chg` and `term`: `ok` equals `info` in Phosphor and Phosphor Daylight, and `term` in Dracula, Solarized Light and Catppuccin Latte; index dots carry status only in a tooltip; term and id links share one underline | Fixed while hosted: status dots take a shape each, the colour key a word and a shape, and term, id and ordinary links three underline styles. Measured equalities are in X1-12 |
| I-5: test 10's shape row could not fail (1.1.0's block bar is a box-shadow, the attention bar a border) | Fixed. The changed mark is a stated double bar (2, 2 and 2 px) that paints no further into the margin than 1.1.0's, sampled from pixels, with a library mutation that must red |
| I-6: test 8 summed shares, so one design could spend another's unused share | Fixed. The table records each row's measured total; each design's growth is counted row by row against its own share; the current total must equal the last row's |
| I-7: "test 9 constrains nothing later" was false: the CSP row pinned four hashes | Fixed. One hash per `KNOWN` entry, as many as the parent's; a design that inlines a script raises it in its own commit |
| I-8: at 4% the quick-jump selection was 1.05:1 | Fixed. It gains an inset 2 px `accent` bar; no state but a hover is shown by a tint alone while hosted |
| M-1 to M-8, M-10, M-11 | Fixed: the 154-character bound excludes outer spaces; size by the validator's own typed walk, so a cycle or BigInt never throws; three values named as not token text; the label claim scoped; the bridge imports `readerAppearanceSupported`; the right `docs-scans` case named; Step 2's expected reds complete; the Aa line on `bg`; AP-2 checks the live verdict; two history rows annotated |
| M-9 | Fixed with I-4 and I-5: the wide-layout attention row is named |
| M-12, M-13 | Fixed with I-6 and I-7: the baselines are the parent commit's, and Task 1 Step 2a reads the committed size table, so no generated manifest needs to be committed |

### Carried

- The library programme plans wave L from spec §10. Its release and ccrc's re-pin are the operator's.
- Wave C waits for wave R. #3026 has merged.

### Library input (X4)

**X4, run 2680, 2026-11-19.** This is a text wave, docs only, and writes no source. The base is `main` at `8781ef20a`, where X1 merged (#3048). It carries the coordinator's rulings on review 2676 (X1, accepted at the review cap) into spec §10 before the library programme plans wave L, and folds wave C's first items into this plan. X2's library-side items land in the same wave, in X2's own spec and plan.

#### What was measured, and how

Library 1.1.0 was read from an installed copy in another ccrc worktree, read-only (version 1.1.0 confirmed in its `package.json`). Nothing was installed, copied into a repository or checked out. The Mermaid measurements drove that copy's `assets/mermaid/mermaid.mjs`, the module build of the same Mermaid core the frame inlines as `mermaid.frame.js`, in headless Chromium (Playwright's, already on the box), from scripts in this session's temp directory. Each run gave Mermaid the library's own configuration: `theme: 'base'`, `securityLevel: 'strict'` and `layout: 'dagre'`.

- **The bundled Mermaid** is 12.1.0. It registers 37 diagram kinds: `c4`, `flowchart-v2`, `agentflow`, `swimlane`, `er`, `gitGraph`, `gantt`, `info`, `pie`, `quadrantChart`, `xychart`, `requirement`, `sequence`, `classDiagram`, `stateDiagram`, `journey`, `flowchart-elk`, `timeline`, `mindmap`, `kanban`, `sankey`, `packet`, `radar`, `block`, `treeView`, `architecture`, `eventmodeling`, `ishikawa`, `venn`, `treemap`, `usecase`, `wardley`, `cynefin`, `railroad`, `railroadEbnf`, `railroadAbnf` and `railroadPeg`. Its `parse` answers `flowchart-v2`, `sequence`, `classDiagram`, `stateDiagram`, `gantt`, `pie`, `er` and `gitGraph` for the eight fixtures.
- **The base theme.** After Mermaid computes the theme from 1.1.0's `THEME_VARIABLES`, it holds 245 colour keys. Its `applyOverride` puts back the host's value for every key the host sets, after its own derivations, so a value `mermaidThemeOf` sets is drawn as set. Measured: with every one of the 245 keys set to a sentinel colour, 0 changed.
- **What each kind reads.** One fixture per kind, the features spec §10 test 5 lists, was drawn with every colour key set to its own sentinel colour. A key counts as read when its sentinel appears in the drawing's stylesheet, or as a computed colour of a drawn element (markers included). Keys read: flowchart 14, sequence 21, class 14, state 21, gantt 25, pie 22, ER 14 and gitGraph 35, which is 110 distinct keys. 1.1.0's `THEME_VARIABLES` sets 15 keys and leaves 99 of the 110 to Mermaid. Fourteen of those fall back to a literal, 13 in the `base` theme's `updateColors` and `background` in its constructor (spec §10; the first draft's nine, and the spec's ten, missed `critBorderColor`, `taskTextClickableColor`, `noteTextColor` and `background`, corrected at review 2694 M4). The derivation table assigns all 110 (checked by script against the measured set: 0 missing).
- **Colours no key reaches.** In the same drawings, the only colour outside the sentinel set was gitGraph's cherry-pick mark, `#ffffff`. d3's axis ticks and some label wrappers draw in `currentColor`, the container's colour. These fixtures held no sequence half arrow, so they could not show the stick arrowheads' literal black, and the sentinel method read fill, stroke and colour only, so it could not show the theme's shadow filter. Fix round 1 found both ("Fix round 1", below).
- **The derivation, drawn.** Each fixture was drawn under the candidate `mermaidThemeOf` in all twelve palettes. A text's ground was read from the shapes painted behind three points of its box, composited with their opacity over the plate (`elementsFromPoint`, then `isPointInFill`), and the sequence number from its marker's circle, which hit-testing skips. Every text in all 96 drawings met 4.5:1, and every line (a stroke in `text-muted`, `accent`, `no` or a series colour) met 3:1 on `surface` and `surface2`. The strokes the drawings hold that are not lines were judged against what they sit on: the plate-coloured gaps between pie slices have no floor by design, and the marks inside a commit (`surface2`, and `bg` for the cherry-pick) meet 4.57:1 or better on their commit's series colour (`surface2` on `accent`, Phosphor Daylight; the first draft's 4.52 named a series colour no commit takes, corrected at review 2694 F4). The adversarial pass caught a first draft of this sentence that read the data as every stroke meeting 3:1 on the plate, which the pie gaps and commit marks do not. The worst pairs are in the Cross pairs table (the rows marked X4) and in spec §10.
- **Author colour.** Eleven statement forms (a `:::` class among them), each in a one-node fixture, were drawn under the derivation. Each put the author's colour into the drawing: `classDef`, `style`, `linkStyle` and a `:::` class in a flowchart; `style` and `classDef` in a class diagram; `classDef` in a state diagram; `style` and `classDef` in an ER diagram; and `rect` and a coloured `box` in a sequence diagram.
- **F2, from pixels.** A flowchart whose one style is `classDef c fill:#D4EDDA` on one node was drawn three ways, and its label box was screenshot. The label's contrast was read as the ratio between the box's commonest pixel (the fill) and the pixel farthest from it. Hosted with no plate it is 1.07 to 1.30:1 in all eight dark palettes. On 1.1.0's dark plate and filter it is 7.95:1, and on its light plate 13.49:1.
- **The label route F2 allows.** For every fill on a 52-step grid of the RGB cube, the better of `text` and `bg` was taken. The worst falls between 2.77 (Catppuccin Latte) and 4.12 (Phosphor), so no route reaches 4.5:1 for every author fill in any palette, and it is not taken.
- **The budget.** 1.1.0's `dist/frame/manifest.generated.js` has five entries: `chars` 3 643, 30 153, 198 215, 549 069 and 3 746 940, which is 4 528 020 characters (4 530 427 bytes). X2's comparators are in X2's plan Results.
- **The library's code facts the advisory items cite.** `csp-rules.js` exports `HASH_SOURCE` (`^'sha256-[A-Za-z0-9+/]{43}='$`) and tests `script-src` tokens with it. `protocol.js` has `FRAME_OPS` and `PARENT_OPS`. `nav.js` has `FLASH_MS` 1 900. `reader.css` marks the Aa checked option, the pressed view button and the filter's focus as review 2676 F3 says. It turns `a.term` and `a.xref` solid on hover and when expanded, and draws `.rs-facts .sep` in `--rule`. ccrc's `ui/src/components/prose.css` paints `.well .hljs-title.function_` (invocations included) in `syn-function` and `.hljs-meta` in `syn-comment`.

#### The twelve fixture appearances (spec §10 test 5)

The 33 slot values ccrc's map (spec §3) reads in each palette, read in Chromium from `ui/src/styles/tokens.css` at `8781ef20a` (each palette applied to the root as `applyTheme` applies it, and every value read with `getPropertyValue`). All 396 values are `#RRGGBB`. The palette names are public, and the values are what a reader of ccrc's public stylesheet sees:

- **Phosphor & Ink** (`dark`): bg=#0B0D0C surface=#141715 surface2=#1C201D text=#ECF0EC text-muted=#ADB6AE text-faint=#8B948C border=#39403A rule=#262B27 accent=#45D67E accent-ink=#082312 focus=#45D67E ok=#ADB6AE wait=#F2B84B no=#E8836F info=#ADB6AE chg=#F0A3C8 term=#6FD6EA id=#96B4F4 violet=#C7A7F4 path=#ADB6AE code-block-bg=#070808 code-ink=#DEE4DE syn-comment=#8B948C syn-keyword=#C7A7F4 syn-string=#57E08B syn-number=#F2B84B syn-function=#6FD6EA syn-type=#96B4F4 syn-tag=#F0A3C8 syn-attr=#6FD6EA syn-punct=#ADB6AE syn-deleted=#F08A78 syn-inserted=#57E08B
- **Phosphor Daylight** (`light`): bg=#F4F6F3 surface=#FFFFFF surface2=#EAEEEA text=#1A201B text-muted=#4E5850 text-faint=#5F6962 border=#C3CAC2 rule=#DDE2DC accent=#0E7B3F accent-ink=#FFFFFF focus=#0E7B3F ok=#4E5850 wait=#8A5A0A no=#B2402C info=#4E5850 chg=#A62667 term=#0A6377 id=#2F55B8 violet=#6D3FB4 path=#4E5850 code-block-bg=#141715 code-ink=#DEE4DE syn-comment=#8B948C syn-keyword=#C7A7F4 syn-string=#57E08B syn-number=#F2B84B syn-function=#6FD6EA syn-type=#96B4F4 syn-tag=#F0A3C8 syn-attr=#6FD6EA syn-punct=#ADB6AE syn-deleted=#F08A78 syn-inserted=#57E08B
- **Nord** (`dark`): bg=#2E3440 surface=#3B4252 surface2=#434C5E text=#ECEFF4 text-muted=#D7DADE text-faint=#C2C5C9 border=#5F697C rule=#505A6C accent=#92CADA accent-ink=#07140C focus=#92CADA ok=#9DCAC9 wait=#F6D595 no=#FFB8BC info=#D7DADE chg=#E7BFDF term=#A4DDED id=#AFD0F2 violet=#E7BFDF path=#D7DADE code-block-bg=#242933 code-ink=#ECEFF4 syn-comment=#9AA39B syn-keyword=#C7A7F4 syn-string=#57E08B syn-number=#F2B84B syn-function=#6FD6EA syn-type=#96B4F4 syn-tag=#F0A3C8 syn-attr=#6FD6EA syn-punct=#ADB6AE syn-deleted=#ED8A92 syn-inserted=#A3BE8C
- **Tokyo Night** (`dark`): bg=#1A1B26 surface=#24283B surface2=#292E42 text=#C0CAF5 text-muted=#AAB4DE text-faint=#959FC8 border=#484D63 rule=#353B50 accent=#7AA2F7 accent-ink=#07140C focus=#7AA2F7 ok=#73DACA wait=#E0AF68 no=#F88196 info=#AAB4DE chg=#FF9E64 term=#7DCFFF id=#8AAFFE violet=#C3A2FF path=#AAB4DE code-block-bg=#16161E code-ink=#C0CAF5 syn-comment=#8B948C syn-keyword=#C7A7F4 syn-string=#57E08B syn-number=#F2B84B syn-function=#6FD6EA syn-type=#96B4F4 syn-tag=#F0A3C8 syn-attr=#6FD6EA syn-punct=#ADB6AE syn-deleted=#F7768E syn-inserted=#9ECE6A
- **Dracula** (`dark`): bg=#282A36 surface=#343746 surface2=#44475A text=#F8F8F2 text-muted=#DBDBD5 text-faint=#BFBFB9 border=#65687D rule=#515568 accent=#CDAEFD accent-ink=#07140C focus=#CDAEFD ok=#8BE9FD wait=#F1FA8C no=#FFA59F info=#DBDBD5 chg=#FDA5D4 term=#8BE9FD id=#A9BCF2 violet=#D1B4FF path=#DBDBD5 code-block-bg=#1E1F29 code-ink=#F8F8F2 syn-comment=#909991 syn-keyword=#C7A7F4 syn-string=#57E08B syn-number=#F2B84B syn-function=#6FD6EA syn-type=#96B4F4 syn-tag=#F0A3C8 syn-attr=#6FD6EA syn-punct=#ADB6AE syn-deleted=#FE716C syn-inserted=#50FA7B
- **Catppuccin Mocha** (`dark`): bg=#1E1E2E surface=#313244 surface2=#45475A text=#D4DDFB text-muted=#C0C9E7 text-faint=#ADB6D3 border=#5C5E72 rule=#525568 accent=#96BEFF accent-ink=#07140C focus=#96BEFF ok=#94E2D5 wait=#F9E2AF no=#FFA2BA info=#C0C9E7 chg=#F5C2E7 term=#89DCEB id=#9BC1FF violet=#D4B2FD path=#C0C9E7 code-block-bg=#181825 code-ink=#CDD6F4 syn-comment=#8B948C syn-keyword=#C7A7F4 syn-string=#57E08B syn-number=#F2B84B syn-function=#6FD6EA syn-type=#96B4F4 syn-tag=#F0A3C8 syn-attr=#6FD6EA syn-punct=#ADB6AE syn-deleted=#F38BA8 syn-inserted=#A6E3A1
- **Gruvbox Dark** (`dark`): bg=#282828 surface=#3C3836 surface2=#504945 text=#F1E1B7 text-muted=#DDCDA4 text-faint=#C9BA91 border=#68605C rule=#5E5753 accent=#C3C737 accent-ink=#07140C focus=#C3C737 ok=#9CCE8A wait=#FEC135 no=#FCAD9F info=#DDCDA4 chg=#FCABC1 term=#A1D38E id=#A5C8BB violet=#FCABC1 path=#DDCDA4 code-block-bg=#1D2021 code-ink=#EBDBB2 syn-comment=#8D968E syn-keyword=#C7A7F4 syn-string=#57E08B syn-number=#F2B84B syn-function=#6FD6EA syn-type=#96B4F4 syn-tag=#F0A3C8 syn-attr=#6FD6EA syn-punct=#ADB6AE syn-deleted=#FD725E syn-inserted=#B8BB26
- **One Dark** (`dark`): bg=#282C34 surface=#31353F surface2=#3E4451 text=#D1D8E6 text-muted=#BDC4D2 text-faint=#AAB1BE border=#555B69 rule=#4B515F accent=#6FBDFE accent-ink=#07140C focus=#6FBDFE ok=#65C4D0 wait=#E6C17C no=#FF9A9F info=#BDC4D2 chg=#E79EFC term=#6DCCD8 id=#81C4FE violet=#E79EFC path=#BDC4D2 code-block-bg=#21252B code-ink=#ABB2BF syn-comment=#919A92 syn-keyword=#C7A7F4 syn-string=#57E08B syn-number=#F2B84B syn-function=#6FD6EA syn-type=#96B4F4 syn-tag=#F0A3C8 syn-attr=#6FD6EA syn-punct=#ADB6AE syn-deleted=#F57F87 syn-inserted=#98C379
- **Solarized Dark** (`dark`): bg=#002B36 surface=#073642 surface2=#0E4653 text=#C5D5D5 text-muted=#B1C1C1 text-faint=#9EAEAE border=#2A5F6C rule=#1F5461 accent=#63B7FB accent-ink=#07140C focus=#63B7FB ok=#53C2B8 wait=#D7A93B no=#FD9286 info=#B1C1C1 chg=#FD8BB8 term=#56C5BB id=#63B7FB violet=#A2AAFB path=#B1C1C1 code-block-bg=#001F27 code-ink=#94A2A2 syn-comment=#8B948C syn-keyword=#C7A7F4 syn-string=#57E08B syn-number=#F2B84B syn-function=#6FD6EA syn-type=#96B4F4 syn-tag=#F0A3C8 syn-attr=#6FD6EA syn-punct=#ADB6AE syn-deleted=#FD6A5F syn-inserted=#8EA31B
- **GitHub Light** (`light`): bg=#FFFFFF surface=#FFFFFF surface2=#F6F8FA text=#1F2328 text-muted=#3F4348 text-faint=#61656B border=#CFD0D2 rule=#E5E7E9 accent=#0969DA accent-ink=#FFFFFF focus=#0969DA ok=#136F2E wait=#7F560B no=#C61427 info=#3F4348 chg=#B0297C term=#000003 id=#0B5FC5 violet=#7743D1 path=#3F4348 code-block-bg=#24292F code-ink=#A8ADB4 syn-comment=#959E96 syn-keyword=#C7A7F4 syn-string=#57E08B syn-number=#F2B84B syn-function=#6FD6EA syn-type=#96B4F4 syn-tag=#F0A3C8 syn-attr=#6FD6EA syn-punct=#ADB6AE syn-deleted=#FF807A syn-inserted=#5DBA6E
- **Solarized Light** (`light`): bg=#FDF6E3 surface=#FFFBF0 surface2=#EEE8D5 text=#3A4F55 text-muted=#475D63 text-faint=#556B72 border=#C7C1AF rule=#DED8C5 accent=#0768A3 accent-ink=#FFFFFF focus=#0768A3 ok=#000001 wait=#755804 no=#C6131A info=#475D63 chg=#B8136C term=#000001 id=#0768A3 violet=#575AAB path=#475D63 code-block-bg=#002B36 code-ink=#98AFB7 syn-comment=#929B93 syn-keyword=#C7A7F4 syn-string=#57E08B syn-number=#F2B84B syn-function=#6FD6EA syn-type=#96B4F4 syn-tag=#F0A3C8 syn-attr=#6FD6EA syn-punct=#ADB6AE syn-deleted=#FE7F73 syn-inserted=#99AE2D
- **Catppuccin Latte** (`light`): bg=#EFF1F5 surface=#FFFFFF surface2=#E6E9EF text=#474A63 text-muted=#555872 text-faint=#646782 border=#BFC2C8 rule=#D6D9DE accent=#0F59E7 accent-ink=#FFFFFF focus=#0F59E7 ok=#000003 wait=#895402 no=#C31A38 info=#555872 chg=#A7388D term=#000003 id=#0C56E4 violet=#802DE5 path=#555872 code-block-bg=#1E1E2E code-ink=#9EA2C0 syn-comment=#8B948C syn-keyword=#C7A7F4 syn-string=#57E08B syn-number=#F2B84B syn-function=#6FD6EA syn-type=#96B4F4 syn-tag=#F0A3C8 syn-attr=#6FD6EA syn-punct=#ADB6AE syn-deleted=#FD7077 syn-inserted=#53B23F

#### Every carry, and the line that closes it

| Carry | Closed by |
|---|---|
| F1, ruled (a): the covered kinds' derivation | Spec §10: the `MERMAID_HOSTED_KINDS` and `mermaidThemeOf` export rows, "Mermaid while hosted" and its derivation table; §5's Mermaid row and floors; §9's contrast row; In short; X1-9, now Ruled. Plan: Cross pairs, the rows marked X4; Task 6 AP-6's Mermaid row |
| F1: test 5 in every palette | Spec §10 test 5: the fixtures, the twelve fixture appearances, and its rows "the constant", "every key assigned", "drawn pairs, in every fixture palette", "closed colours" and "outside the constant" |
| F2: author-styled figures, and the measured label route | Spec §10, "Mermaid while hosted": "Author-styled", "Everything else" and "No label route"; test 5's "author-styled (the coordinator's F2 row)" |
| F3: three state cues, and the flash | Spec §10, "Meaning without colour": its lead sentence (the old line 415), and the bullets "The Aa menu's checked option", "The summary box's pressed view button" and "The table filter's focus"; test 10's last four rows and its note on the flash |
| F4: the sum, append-only rows, X1's 32 768 | Spec §9's srcdoc row, part (2); §10 test 8, its "the rule" and "one row per change of the assets" bullets (the coordinator's ruling on ask 608, mail 25627); "Which of these constrain later additive work", Test 8; "One release for more than one design". Plan: Global Constraints' budgets; Task 1 Step 2a; Task 6's `frame-cost` |
| F4: X2's share | X2 spec §6, "Size, and X2's share", proposed for the coordinator to set at this wave's acceptance |
| A1 | Spec §10, "Meaning without colour" (the lead sentence's `id` and `accent`, and the glossary bullet's hover and expanded rule); test 10's fixture groups and its hover row |
| A4 | Spec §10 test 9: the frame-to-parent row reads `FRAME_OPS`, the parent-to-frame row drives the frame's own parser, and the CSP row's mask is `HASH_SOURCE` on `script-src` tokens only |
| A5 | Spec §2, "Size"; test 1's "same-realm values" row |
| A6 | Spec §2.2, "Size"; §10's srcdoc-cap bullet; test 7's old-cap row |
| A8 | Spec §10, the code-on-the-well table (`invoke__` moved to `syn-function`) and the paragraph after it (the context rules and `.rs-facts .sep`) |
| A9 (2) | Spec §2, the `colour` bullet; test 1's "a missing slot" row |
| A9 (3) | Spec §5's measured paragraph; this plan's Cross pairs row: 4.565 |
| A10 | Spec §5's 3:1 floor and §9's contrast row: the ring's grounds are `bg`, `surface`, `surface2` and the tints |
| F5 | Plan Task 5: Files (the five fakes), the "a fake with no seed" row, Step 4 |
| F6 | Plan Task 4: "Hosted, explicitly, decided once" (`isHostedMount`), its interface line, "the lab" row; AP-M12 |
| F7 | Plan Task 4, "reads after the last await" (three holds); AP-M22 |
| A2 | Plan, acceptance row AP-6's F action |
| A3 | Plan Task 4 Step 2's expected reds; Task 5's Interfaces sentence (`./reader/assets`) |
| A7 | Plan, acceptance row AP-2's F action (a phone engine); "Unmeasured" below |
| A9 (1) | Plan Task 3's Interfaces (`appearanceStamp`) and its "one stamp" row; Task 4's `readHostAppearance` bullet |
| A11 | Done at acceptance (the coordinator patched PR #3048's body on 2026-11-19); nothing in this wave |
| X2 F10, the library half | X2 spec §4.6 rows PR6 and PR8, §6's print-mode row and "Print mode's strip and plan marks"; X2 plan P5.5 Step 1 and M11.74 |
| X2's figure-image op | Already designed in X2 spec §6 (`print-figures` and `print-figure`) and counted in X2's proposed share |

#### Choices this wave made, and why

- **The constant holds the eight kinds the ruling names, and no more.** Each covered kind costs a fixture, a derivation row set and test 5 in twelve palettes, and the fallback keeps every other kind safe. A kind can join later with its own measured rows.
- **The kind comes from Mermaid's own `parse`,** not from a scan of the first word, so it matches how Mermaid will draw the figure.
- **The author-styled scan errs toward 1.1.0's drawing:** any `box` line counts, coloured or not, and `class` and `:::` are covered through the `classDef` they apply.
- **No label route** (measured above).
- **Gantt task states** are told apart by their outline (`text-muted`, `accent`, `no`) and a 4% tint over `surface`, a ground the drawn-pairs row measures. A done task sits on the plate with a `text-muted` outline.
- **Labels on a series colour or a line mark are `bg`.** Every series colour is one of the gate's text colours, and the gate already holds each at 4.5:1 on `bg`, so the pair is in the gate by construction.
- **The series skips an exact repeat,** so two slices or branches are never the same colour unless a palette has fewer distinct text colours than the figure has parts. A palette has 10 to 12.
- **The measuring commit is read from the table's history,** never typed: the commit that lands a row cannot know its own sha, and a squash merge would change it. This reshapes the ruling's "each row names the library commit that measured it", so it went to the coordinator as a structured ask (ask 608), who ruled it with conditions (mail 25627): the row's measuring commit is the commit that appended it, read from history, and no row or follow-up commit types a sha; at every commit test 8 recomputes the newest row from that commit's own manifest and requires every earlier row byte-equal to the parent commit's table, so by induction each row is what its commit measured and no deep history is needed; a commit that changes no frame asset appends no row, and one that changes one appends exactly one, attributed to the design whose share it spends. Spec §10 test 8 states this as its rule. Review 2694 F1 found two cases the ruling left open, the landing that introduces the table and a landing of several commits, and the coordinator completed the ruling ("Fix round 1", below).
- **A layout is never larger than the default bundle,** so the largest frame is bounded by the default, and X2's frame share covers only the default's growth. For X2's four layouts this is an assumption that test 8's layout row enforces, not a measurement (fix round 1, F5).
- **X2 F10's chips and step labels fold into row PR6.** The rich-docs spec's Print row counts "PR1 to PR15", and a 16th row would need an edit outside this wave's four files. The coordinator ruled that such a sentence goes to them as a separate question; folding the labels into PR6 needs none.

#### The adversarial pass (Opus · high, one pass over the changed sections)

It found no critical issue, 9 important and 14 minor. It reproduced every X4 contrast figure, the 110-key coverage, the series, the 4 528 020 baseline and every terser comparator. Dispositions:

| Finding | Disposition |
|---|---|
| 1: test 5's stroke row, and AP-6's, could never pass: pie gaps and in-commit marks are near 1:1 on the plate, and the Results line misread its own data | Fixed. Spec test 5 and §10 judge lines (`text-muted`, `accent`, `no`, series) on both grounds, in-commit marks on their commit's series colour (4.57 at worst, corrected at review 2694 F4), and pie gaps as plate by design; the Results sentence is corrected; a Cross pairs row is added |
| 2: the sequence fixture's colourless `box` made it author-styled, so test 5 never drew sequence hosted | Fixed. The fixture has no `box`; a separate row asserts that a colourless `box` alone takes the fallback |
| 3: the scan could be bypassed by case, by `;` and by tabs, and missed state `style` | Fixed. Statements split at line breaks and `;`, any leading white space, heads compared without case, every head applied to every covered kind; test 5 gains `STYLE`, a `;`-joined line, `RECT`, a tab-indented line and state `style`; the form count is eleven, `:::` among them |
| 4: append-only against `HEAD~1` let an earlier commit of a multi-commit change rewrite a row, and a shallow checkout broke it | Superseded at fix round 1 (review 2694 F1), which made the unit a landing. Ruled by the coordinator (ask 608, mail 25627): test 8 runs at every commit, recomputes the newest row from that commit's manifest and holds every earlier row byte-equal to the parent's table, so by induction no commit can rewrite a row and one parent of history is enough. A first draft of this fix used the merge base and full history; the ruling replaced it |
| 5: a row's design was self-declared, and upkeep such as a Mermaid bump had no row kind | Fixed. A `Size-Design:` trailer is checked against the row, a `rebaseline` row counts against no design and is approved by the coordinator, and shrinking frees room in the same design only |
| 6: naming the measuring commit by history reshaped the ruling | Asked (ask 608); the coordinator ruled for history, with the conditions above |
| 7: X2's frame share left out R7 and R9, layout stylesheets and the bootstrap, and wrote estimates as bounds | Fixed in X2 §6: rows for R7 and R9 and the bootstrap, layout stylesheets inside each layout's bound, "at most" dropped. The shares rise to 1 148 928 and 45 056; fix round 1 (F5) revised them to 1 166 336 and 72 704 |
| 8: whether the default bundle is a layout bundle was undefined | Fixed. `default` is a layout; a frame inlines exactly one layout's assets |
| 9: M11.74 could not fail, and the class list missed `tmeta`, the count's status class, `attn`, `yours` and the hidden brackets | Fixed. P5.5's assertions read structure and classes; the class list is derived from the conformance output; print mode emits no bracket or colon |
| 10: test 9's parent-to-frame row could not catch an added op | Fixed. The bootstrap's list is exported as `FRAME_ACCEPTS`, compared with the parent's, and the parser is driven over every name in both op lists and a planted one |
| 11: the series worst palette differed between spec and plan, and `accent` and `no` read as 4.52 | Fixed. Solarized Dark, 4.515; `accent` 4.57 and `no` 4.77 stated apart |
| 12: §5's Mermaid row missed the `text-muted` and `accent` labels and the `text` filled arrowhead | Fixed |
| 13: `excludeBkgColor` missing from the literals; cScale unmentioned | Fixed: ten literals (superseded at fix round 1, review 2694 M4: fourteen); none of the 66 cScale, fillType and surface keys reaches a covered drawing, stated |
| 14: drawn pairs with no row, and a fixture claiming every shape | Fixed. Cross pairs rows for a clickable label, marker text over a row, commit labels and in-commit marks; the fixture names the classic shapes. The clickable label is not drawn under `strict` and is said so |
| 15: "old srcdoc cap" per layout was unclear | Fixed: 1.1.0's default cap, in every layout |
| 16: X2's P5.1 lacked the per-layout `frame-cost` row | Fixed in X2's plan, Task P5.1 |
| 17: X2's new seed fields were outside every share | Fixed in X2 §6: they are seed fields, counted by the derived srcdoc cap and the per-layout `frame-cost` row, not by test 8 |
| 18: an expanded `a.term` or `a.xref` showed its state by colour alone | Fixed: the open card is the cue, stated |
| 19: a fallback figure's full-screen stage was unspecified | Fixed: the same 1.1.0 drawing on its plate and filter, with a test 5 assertion |
| 20: stale plan lines (the focus floor, `appearanceRoot`'s comment, Step 3's waits, Task 6 AP-6's palettes) | Fixed |
| 21: the `parseAppearance` row did not allow whole-group refusals | Fixed |
| 22: no verdict for a top-level `too-many-keys` | Fixed: `{mode: 'auto'}`, with a test 1 row |
| 23: X2's P5.5 assertion used placeholders | Fixed: the fixture is three tasks of two, three and four steps, two of them the reader's, so "3 tasks · 9 steps" and "2 yours" |

#### Fix round 1 (review 2694, round 1 of 3, at `ed2d43cd3`)

The review held the baseline, X1's share, the Mermaid counts and worst cases, the F3 cues, the CSP mask, the per-layout accounting, every carry and ask 608's conditions. It found 6 important and 8 minor issues. The coordinator ruled F1 and directed the rest. Each finding is one commit, and each is closed at the line below.

| Finding | Closed by |
|---|---|
| F1: test 8 could not run at the genesis landing or at a multi-commit landing (the coordinator's ruling, completing ask 608) | Spec §10 test 8: "the rule" (the test judges a commit against its first parent, and CI runs it on the landing), "the landing that introduces the table", "one landing, one design, one row" and "history depth"; "Which of these constrain", Test 8; "One release for more than one design". Plan Task 1 Step 2a. X2 spec §6, "Size, and X2's share" |
| F2: the sequence stick arrowheads draw a literal black | Spec §5's Mermaid row; §10 "Marks no key reaches"; test 5's sequence fixture, its closed-colours row and the new stick-arrowhead pair row. Plan Cross pairs, the two fix-round-1 rows |
| F3: the theme's shadow filter | Spec §10's `mermaidThemeOf` export row (`dropShadow` `none`); "Shadows", with the actor boxes' `filter: none`; §5's Mermaid row; the frame-behaviour bullet; "Everything else"'s restated claim; test 5's closed-colours row reads the computed `filter` |
| F4: the in-commit mark's worst | Spec §10's measured paragraph: 4.57, `surface2` on `accent`, Phosphor Daylight. Plan Cross pairs row and the measurement note |
| F5: X2's estimate had no stylesheet term | X2 spec §6: the stylesheet row, `protocol.js` named as a proxy, the layout bound as an assumption, the shares as a ceiling, the revised shares. X2 plan Results |
| F6: `appearanceStamp` in an L4 module imported by L3 | Plan file map (`appearanceStamp.ts`, L1); Task 3's Files, Interfaces and Step 3; Task 4's read bullet and Step 2. Spec §4, "One signal" |
| M1: two-condition hosted definition; `isHostedMount` in L3 | Spec §4, "After the mount resolves". Plan file map's `policy.ts` row; Task 4's interface line, "Hosted, explicitly, decided once" and the eight-combination row |
| M2: `FRAME_ACCEPTS` missing from the export table | Spec §10's interface table |
| M3: stale counts and floors | Plan Global Constraints' floors and budget line; X2 spec §6's "one row per design", made "one row per landing" by the adversarial pass; the literal count under M4 |
| M4: the literal fallbacks | Spec §10's derivation note: 14, named; plan's measurement note |
| M5: the hosted plate and overlay stage | Spec §10's derived-colour list (`plate`) and "The other fixed colours" (the overlay stage) |
| M6: the no-seed fake and `reader-frame.test.tsx`'s own fakes | Plan Task 5's Files, Step 1 ("a fake with no seed", "the mode-only rows move to `follow`") and Step 2 |
| M7: `frameCsp`'s signature; the scan count | X2 spec §6's layout row (R19); X1 spec test 9's CSP row and "Which of these constrain", Test 9; plan Task 4 Step 1 and Step 2 |
| M8: session narration in Results | This plan's Results: the subsection is gone |

What fix round 1 measured, in the same read-only way as above:
- **Every element, markers and filters included.** A new probe drew test 5's eight fixtures and a ninth sequence fixture of the sixteen half-arrow spellings, in all twelve palettes, and read every element's computed `fill`, `stroke` and `filter`, the paths of every used marker included. Before the fixes: the stick arrowheads stroke `#000000` in every palette, and the theme's `drop-shadow(rgb(185, 185, 185) 1px 2px 2px)` filters 24 flowchart, 13 class, 21 state, 6 ER and 9 sequence elements; the sequence actor boxes carry `filter="url(#<id>-drop-shadow)"` whatever `dropShadow` is. With `dropShadow` `none`, the stick-marker rule and `rect.actor { filter: none }`: 0 filters and 0 colours outside the derived set, in all 108 drawings. The adversarial pass (below) then found typed participants that rule misses; with the attribute rule `[filter*="drop-shadow"] { filter: none }` and a tenth fixture holding all eight participant types, 0 and 0 again, in all 120 drawings.
- **The half-arrow spellings,** each drawn alone: `-\\`, `-//`, `\\-`, `//-` and their dotted forms draw the stick markers, eight spellings, not the review's six; `-|\`, `-|/`, `/|-`, `\|-` and their dotted forms draw the solid ones, which the theme fills with `text` in every palette.
- **Black, and `text-muted`, as a line:** black on `surface` is 1.16 (Phosphor) to 2.09 (Nord) in the dark palettes; `text-muted` is at worst 6.74 on `surface` and 5.54 on `surface2`. The shadow's `#B9B9B9` on `surface` is 5.13 to 9.20 in the dark palettes.
- **In-commit marks,** over `git0` to `git7` and both mark colours (`surface2`, `bg`): worst 4.566, `surface2` on `accent`, Phosphor Daylight.
- **Literal fallbacks:** the bundled `base` theme's assignments and the computed theme under 1.1.0's `THEME_VARIABLES` agree on 14 literal values among the 99 keys: 13 in `updateColors` and `background` (`#f4f4f4`) in the constructor.

The adversarial pass over fix round 1 (Opus · high, one pass over the changed sections, reading computed `filter`, markers, gradients, `flood-color`, `stop-color`, shadows and HTML label paint, as the coordinator asked) found 4 important and 9 minor issues. Dispositions:

| Finding | Disposition |
|---|---|
| I1: HTML in labels (`<font color>`, `<mark>`, a `bgcolor`) puts author colour past the scan | Fixed. A covered figure whose text holds an HTML element other than `br` is author-styled (spec §10, "Author-styled"), so it draws as 1.1.0 draws it. Measured: under the library's sanitiser `mark`, `hr`, `button`, `input`, `select`, `textarea` and `fieldset` paint browser defaults, and the rule keys on any element rather than that list. It leaves test 5's eight fixtures, class and state annotations, the arrows and `x < y` covered, and makes the review's four HTML fixtures author-styled. Test 5's author-styled row gains them |
| I2: a gantt `todayMarker` sets a colour | Fixed. `todayMarker` is a head, and the author-styled row gains `todayMarker stroke:#000000` |
| I3: six typed participants keep the actor shadow | Fixed. The rule is `[filter*="drop-shadow"] { filter: none }`, and test 5's sequence fixture holds a participant of each type |
| I4: test 8 could not run as a merge gate (a merge ref has no trailer, a squash may hold two) | Fixed. Spec test 8: a candidate run judges the merge ref or queue group against its first parent; the design is one `Size-Design:` line in the pull request's description, which a squash landing copies into its message; the candidate run is the gate |
| M-a: the genesis landing against the one-row rule; a hard-coded baseline | Fixed. The genesis landing is named as the one that appends two rows; the baseline is the first parent's manifest total, 4 528 020 when that is 1.1.0's; Task 1 Step 2a and the Global Constraints read it so |
| M-b: X2's "one row per design" | Fixed: "one row per landing", X1's and then X2's in this release |
| M-c: the typecheck does not enforce `follow` on cast fakes | Fixed. Task 5 says so; the fake lists and Step 4's runs ensure it |
| M-d: spec §3's "No second list" roots | Fixed: `appearanceStamp.ts` added |
| M-e: the closed-colours row over-broad | Fixed: rendered elements, and referenced filters only |
| M-f: test 9 in commits | Fixed: pinned at this contract's landing, judged against its first parent |
| M-g: nothing kept `policy.ts` library-free | Fixed. Task 4's docs-scans bullet: the `/frame` home excludes the three reader modules `ReaderFrame.tsx` imports by value, with a planted row |
| M-h: `htmlLabels: false` not in the fixtures | Fixed: test 5's flowchart is drawn a second time with it |
| M-i: historical rows that read as current | Fixed: adversarial-pass rows 4 and 13 marked superseded; "the review said six" |

Choices fix round 1 made:
- **Eight stick spellings, written as measured,** where the review said six: each was drawn alone and named.
- **The participants' shadow is removed by the stylesheet,** because no theme key reaches it, as the stick arrowheads and the cherry-pick mark are painted. The rule matches the filter attribute (`[filter*="drop-shadow"]`), not an element, because a typed participant carries it on six other elements.
- **`isHostedMount` takes booleans,** so it can sit in L1 `policy.ts` in the main bundle without importing the library; the one support decision stays in `appearance.ts`.
- **Fourteen literals, not thirteen:** the review counted `updateColors` only, and `background` is a constructor literal. All 14 were already assigned.

#### Deviations

None. The reserve block, 8774 and 8775, is unused: every change here carries out a coordinator ruling or a reviewer's fix direction within the completion design, the rich-docs spec and the operator's rulings.

#### Unmeasured

- The grammars' fit to `getPropertyValue` text in WebKit and Gecko (review 2676 A7). AP-2's F action now measures it on a phone engine; until F runs, it is unmeasured beyond Chromium.
- X2's code sizes. X2's shares are estimates from measured comparators (X2 plan Results), not measurements of X2's code.
- The derivation's drawings on a phone engine. Every drawing above is Chromium's. Test 5 runs on each engine the library's browser suite runs.

#### Commands

```text
git log -1 --format=%h HEAD (at start)                              -> 8781ef20a
grep / sed / python3 over the installed library 1.1.0               (read only)
node <scratch>/keys.mjs     sentinel drawing, 8 kinds               -> 245 colour keys, 110 read, 0 changed
node <scratch>/tokens.mjs   12 palettes x 33 slots in Chromium      -> 396 values, 0 not #RRGGBB
node <scratch>/pass2.mjs    derivation drawn, 12 palettes x 8 kinds -> min text 4.88, min line 4.52
node <scratch>/markers.mjs  marker colours, 2 palettes              -> every marker text-muted or text
node <scratch>/author.mjs   parse ids, 11 author statement forms    -> 8 ids; 11 of 11 put author colour in
node <scratch>/f2.mjs       label box pixels, 3 drawings x palettes -> hosted 1.07 to 1.30; plate 7.95, 13.49
python3 <scratch> grid      label route, 12 palettes                -> worst 2.77 to 4.12
node <scratch>/minsize.mjs  terser over 47 enhance modules          -> comparators (X2 plan Results)
node <scratch>/probe3.mjs   fix round 1: every element, markers and filters, 12 palettes x 9 fixtures
                            before                                  -> stick markers #000000; shadow filters on 5 kinds
                            dropShadow none + the two stylesheet rules -> 0 filters, 0 colours outside the set
node <scratch>/half.mjs     16 half-arrow spellings, each alone     -> 8 stick, 8 solid
node <scratch>/actorf.mjs   the actor box's filter, its source      -> filter attribute, feDropShadow #FFFFFF 0.06
node <scratch>/f4.mjs       in-commit marks, git0 to git7, 2 colours -> worst 4.566 (surface2 on accent, Phosphor Daylight)
python3 over the bundled base theme and keys.json (read only)       -> 14 literal fallbacks among the 99 keys
node <scratch>/tags.mjs     84 HTML elements in a label, 2 palettes  -> mark, hr, button, input, select, textarea, fieldset paint defaults
node <scratch>/htmlrule.mjs the HTML-element rule over the fixtures  -> 8 fixtures covered; 4 HTML fixtures author-styled
node <scratch>/types2.mjs   8 participant types, the attribute rule -> 0 filters
node <scratch>/probe4.mjs   12 palettes x 10 fixtures, every element -> 0 filters, 0 colours outside the set
```

No test, build or install ran: nothing in this wave changes code. Every commit was scanned for private names before it was made, and again before the push.
