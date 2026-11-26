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
- Contrast floors: 4.5:1 for every text colour on every ground the stylesheet paints, plain or tint, for code tokens, and for the labels of figures of the kinds in `MERMAID_HOSTED_KINDS` that are not author-styled, on the shapes painted behind them; 3:1 for the focus ring on `bg`, `surface`, `surface2` and the tints, the grounds a ring is drawn on, and for those figures' lines; no floor for decorative edges. Every other figure draws on 1.1.0's plate and filter, as in 1.1.0 (spec §5, §10). A coloured tint holds at most 4% of its colour, mixed over `bg` or `surface`. Inline code sits on the opaque `surface2`, never on a tint (spec §5, §10).
- Budgets: payload at most 4 KiB serialised; at most one `appearance` op per animation frame, latest wins; hosted srcdoc growth over the same document at the 1.1.0 pin in three parts: ccrc's two faces exactly 187 640 characters; this contract's own frame-asset growth at most 32 768 characters over the baseline row, the sum of every `FRAME_MANIFEST` entry with Mermaid's included at the first parent of the landing that adds the tables (1.1.0's 4 528 020 when no library landing comes between), measured at the library landing that lands it, with each later design in the release measured from that landing against its own share, which the coordinator sets; the appearance seed at most 4 096. So at most 224 504 plus the other designs' shares; hosted open-to-`ready` median of 9 opens at most 1.10 x the BASE median of 9; a change while open shows on the frame root within 100 ms, same iframe and nonce, scroll within 1 px; Mermaid redraw one figure per task, no gap over 200 ms.
  - **Timing amendment (2026-11-24; D-9018):** On desktop Chromium, the hosted nine-open median may add at most 30 ms over its paired BASE per skin. Mode-only keeps the 1.10× limit. On a phone engine F records the paired figure; more than 100 ms added stops and returns to the coordinator. The other budgets above are unchanged.
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

No ccrc wave edits the library's repository. C does not start before R: its types and tests read the library's `APPEARANCE_SLOTS`, `APPEARANCE_PAIRS`, `APPEARANCE_CONTRACT` and `parseAppearance`, and it spells none of them itself. These pure exports come from the library's `./frame` entry. `docs-scans.test.ts#LIBRARY_HOMES` lets any file under `pwa/src/docs/reader/` import `./frame` today, and Task 4 narrows that to an allow-list; only `bridge.ts` may import `./host`.

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

## Amendment 2026-11-24: wave C on 1.2.0, under the library's new name (wave 41, run 3605)

The operator's priority of 2026-11-24 puts Reader Mode in the console first. Its order (the reader-mode plan, `2026-11-20-native-docs-reader-mode.md`, § Amendment 2026-11-24, D-8974) starts with this plan's wave C. Where this section and the rest of the plan differ, the task bodies below included, this section governs.

- **R is 1.2.0.** The release this wave pins is the library's 1.2.0, at `996a39b2602d2e1e636c54c95cc9e403fe55cf88`. It is verified as a candidate and not yet tagged or published. It carries this contract, X2's places and layouts, and reader mode's LX6. Its signed tag and publication stay the operator's. Task 1 Steps 1 and 2a read that tag and its test 8 tables once they exist. The tables hold rows for X1, X2 and X6, and Step 2a's release read already checks each design against its own share.
- **The package's name changes with its version (D-8976, below).** Task 1 moves every file that names `@synapsium-labs/docserver` or `Synapsium-Labs/docserver` to `@synapsium-labs/pinax-lib` and `Synapsium-Labs/pinax-lib`, in two parts. The reader-mode plan's amendment §3 lists every file, and they join this wave's file ownership for Task 1.
  - **Task 1's first commit, on the branch as it is built,** ahead of Tasks 2 to 7 and of PH: every import, test and script reference. That is the four source files, the pwa and server tests' imports, specifiers and pins, and the provenance step's repository, signer, lock key and pack name.
  - **The wave's last commit:** only what needs the registry. That is the package file's dependency, the lock's `resolved` and `integrity`, and `reader-pin.test.ts`'s and `reader-assets.test.ts`'s literals.
- **How Task 1's steps fall under that split** (amendment note; the steps' text stands):
  - Step 1 runs at publication, before the last commit, and also reads the import list (rich-docs §4.7, M8.10): every library subpath and asset specifier the console imports, against 1.2.0's `exports` and files, with each change named in Results. Until this amendment no wave owned that per-release read for 1.2.0.
  - Step 2a's two reads are git objects, so they may run ahead.
  - Steps 2 to 4 (install from the registry, `npm ls` of the new name, the M8.12 rows PASS, and the commit of the package file and lock) make the wave's last commit, after Tasks 2 to 7. Their "commit the pin first" order gives way to the split.
- **Task 6 Step 1's BASE "at Task 1's commit"** is taken at Task 1's rename commit, on the built-ahead tree with the packed tarball installed, before any edit of Tasks 2 to 5. It stands only if the reader-mode plan's hold condition 5 holds: the registry's `assets/assets.json` equals the commit's, hash for hash. Otherwise BASE is taken again at the registry pin, and Tasks 2 to 6 are judged against the new one.
- **Built ahead, landed after publication.** The wave may be built and tested against a tarball packed from that commit and installed without saving, with the coordinator's word for that install. Its pull request is opened only after publication, under the six conditions of the reader-mode plan's amendment §4: the registry resolves the release; the signed tag is on the commit; the provenance step verifies the attestation; `npm audit signatures` is clean; the installed asset hashes equal the commit's; and the last commit, the only registry-dependent one, is the branch's last. No pin or provenance check is weakened.
- **Tasks 2 to 7 are unchanged in content.** They are built after Task 1's rename commit, and the wave's last commit follows them.

**Deviation defined by this amendment** (the plan's `## Deviations found` stays as it was):

- **D-8976 (2026-11-24)** — library-package-rename. Wave C's re-pin (Task 1) changes the library's package name as well as its version: `@synapsium-labs/docserver` 1.1.0 becomes `@synapsium-labs/pinax-lib` 1.2.0. The change covers the package file, the lock, every source import, the pwa and server tests, and the provenance step's repository, signer and pack name. Every reference moves in Task 1's first commit, and only the registry-dependent pin, lock and test literals wait for the wave's last commit. It departs from:
  - Task 1 Step 2: "`npm ls` of the library's package (the name `pwa/package.json` already carries)";
  - this plan's wave C file ownership, which gives Task 1 the package file and the lock only;
  - X2's plan's Global Constraint and Tech Stack: "`@synapsium-labs/docserver` exactly 1.1.0 until P5 adopts".

  Argued:
  - the library renamed its package with 1.2.0, and its repository on 2026-11-24, with the old address redirecting;
  - 1.2.0 is published under the new name only, and the old name gets no further version, so the re-pin is a rename;
  - every reference moves first, because the built-ahead tarball installs under the new name, and code left on the old one would resolve to the locked 1.1.0;
  - the provenance step checks the attestation's repository and signer by name, and those are now the new repository's.

  Issued to run 3605 (wave 41), block 8974 to 8976.

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
  - **This contract's share.** Read the library's two test 8 tables at that commit, the shares table and the growth table, as immutable git objects (`git -C <library repo> show <sha>:<table path>`, the paths the brief names; the tables are committed source, so no build output needs to be committed). They hold exactly the rows the landing that introduces them must hold (spec §10 test 8). The shares table holds two: this contract's share, 32 768 on both totals, and X2's, equal to the figures in the brief. Any other share row, or a share that differs, stops the wave and is reported: at that landing test 8 has no first-parent shares table, so this read is what holds its ceiling. The growth table holds two rows: the baseline, and this contract's row. The baseline is the first parent's manifest total. Read it from the growth table, and check it against that parent's committed `src/frame/manifest.generated.ts` read the same way (`git show <parent>:src/frame/manifest.generated.ts`; the library ignores `dist/`, so no built file is in its history): when the parent is the library main line's commit that carries 1.1.0, whose committed manifest matches the published package, `total` and `frame` are 4 528 020 characters (3 643, 30 153, 198 215, 549 069 and 3 746 940, the `chars` of 1.1.0's five `FRAME_MANIFEST` entries, Mermaid's included; 4 530 427 in bytes). Any other baseline is reported with the parent named, and the wave measures against it. The library caps the srcdoc in characters, so characters are the unit. This contract's recorded `total` or `frame` less the baseline's, above 32 768, stops the wave and is reported. Each row's measuring commit is the landing that appended it, printed by the library's test 8 from the table's history (spec §10); the brief names that landing, and the two must agree.
  - **The release.** Read both tables at the release's tagged commit, the paths the brief names (the installed package need not ship them). Every design's growth is within its shares as test 8 counts it, each design's shares read from the shares table; the last row's `total` equals the sum of every entry's characters in the installed package's manifest, and its `frame` the largest single frame's. Either failing stops the wave and is reported.

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
- Modify, its one checked `ReaderMount` fake (Step 1, review 2714 M6): `pwa/test/reader-lab-run.test.ts`
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
    - `LIBRARY_HOMES`' `/frame` home admits any `src/docs/reader/` file today. It becomes an allow-list (review 2714 M5), so a new reader module is library-free unless named: the files that import `./frame` today, `src/docs/reader/bridge.ts`, `src/docs/reader/assets.ts` (a type import) and `src/docs/reader/labPolicy.ts` (the lab's), and Task 2's `src/docs/reader/appearance.ts`. A library import in any other file answers `library:/frame`, the main-bundle modules among them: `policy.ts`, `history.ts` and `readerText.ts`, which `ReaderFrame.tsx` imports by value, `images.ts` (by value in `pwa/src/screens/DocsScreen.tsx`) and `diff.ts` (by value in `pwa/src/docs/readerHistory.ts`). Planted in a tree copy of `policy.ts`, which now holds `isHostedMount`, and in one of `images.ts`, a `/frame` import answers it, and the unplanted tree answers none;
    - `READER_ADAPTERS` becomes `['src/docs/reader/bridge', 'src/docs/reader/assets', 'src/docs/reader/hostAppearance', 'src/docs/reader/appearance']`;
    - `adapterUseAllowed(file, target, dynamic)` keeps its two arms and gains exactly three, each a static value import made inside the lazily loaded chunk: `bridge.ts` → `src/docs/reader/hostAppearance` (the read), `bridge.ts` → `src/docs/reader/appearance` (`readerAppearanceSupported`, the one support decision), and `hostAppearance.ts` → `src/docs/reader/appearance` (`readerAppearanceOf`). Without them, the existing case "Library imports: the reader adapters reach the main bundle only through ReaderFrame's two dynamic imports" reds `main-bundle:value-import` on the plan's own imports. That case also gains one count: the uses of `hostAppearance` and `appearance` across `pwa/src` are exactly these three, as an exact list by specifier (Step 2). Its existing counts stay: `ReaderFrame.tsx` names `./reader/bridge` twice (its `import type` and the dynamic import), so Task 5's new types ride that existing `import type`;
    - a new case in clause W8a plants, in a tree copy, a value import of `hostAppearance` and one of `appearance` in `src/docs/ReaderFrame.tsx`, and one of `appearance` in `src/docs/DocsHead.tsx`. Each answers `main-bundle:value-import`, and the unplanted tree answers none;
  - **the font route's one importer:** `assets.ts` is the first file to import through the `@/` alias, which `shadcn-alias.test.ts` pins as unused ("nothing in the tree imports `@/` yet"). That case becomes: the files under `ui/src` and `pwa/src` that import `@/` are exactly `['pwa/src/docs/reader/assets.ts']`. Its pattern gains the dynamic form, `import\s*\(\s*'@\/`, beside `(?:from|import)\s+'@\/`. Planted in a tree copy, a second static importer and a dynamic `import('@/fonts/x.woff2?inline')` each red it;
  - **the one checked fake (review 2714 M6):** `pwa/test/reader-lab-run.test.ts` holds the only `ReaderMount` fake written `satisfies ReaderMount`, so this task's required `seed` and `follow` red the type check of pwa's tests there. That fake gains `seed: {hosted: false}` and a `follow` that records its calls in this task, so this task's commit type-checks. The cast fakes, which the type check does not hold to the type, move in Task 5;
  - **the key set:** the adapters' key set is the existing set plus `appearance`, exactly;
  - **only the verdict is passed:** the row first asserts that `parseAppearance` refuses `radius: '99px'`. Then, with a reader whose `--r-md` answers `'99px'`, the adapters' `appearance` has no `radius`, and the fake `mount` (which throws on any value `parseAppearance` would leave out) does not throw.
- [ ] **Step 2: Run to red** (`test/reader-bridge.test.ts test/reader-policy.test.ts test/docs-scans.test.ts test/shadcn-alias.test.ts`). Expected: FAIL on the new rows, the four changed `readerMountPlan` rows (two in each file), `shadcn-alias`'s changed case, which expects `assets.ts` to import `@/` before it does, and `docs-scans`' "Library imports" case on its new count: the uses of `hostAppearance` and of the reader's `appearance` are exactly three, and before Step 3 there are none. Its planted case passes on a tree copy once `READER_ADAPTERS` names them. Two modules are called `appearance`, `pwa/src/lib/appearance.ts` (Task 3) and `pwa/src/docs/reader/appearance.ts` (Task 2). `readerScan` records a use only when its specifier resolves to one of `READER_ADAPTERS`, so neither the hook module nor `hostAppearance.ts`'s import of `../../lib/appearanceStamp` (A9 (1), review 2694 F6) is ever recorded. The case's existing count is a regex over the recorded specifier text, `/\/reader\/(?:bridge|assets)$/`, which matches none of the new edges' specifiers (`./hostAppearance` and `./appearance`), so it stays 3 and cannot count them (corrected at review 2694 M7; the first text said the case already counted them). The new count is its own assertion, an exact list: the recorded uses whose specifier is `./hostAppearance` or `./appearance` equal `['src/docs/reader/bridge.ts ./hostAppearance', 'src/docs/reader/bridge.ts ./appearance', 'src/docs/reader/hostAppearance.ts ./appearance']` (review 2676 A3, carried at X4).
- [ ] **Step 3: Implement.**
  - Contract detection asks `deps.libraryContract`. Its default reads `APPEARANCE_CONTRACT` from a namespace import of the library's `./frame` entry, and answers `'none'` when that export is absent. The answer goes to `readerAppearanceSupported`, the one place that decides support.
  - The read sits beside D-8729's focus sample, after the Mermaid wait and before `mountDocFrame`, with no await between.
  - The lab path is decided by `readerMountPlan`, which gains `appearance: boolean`: `false` for `lab-draw`.
- [ ] **Step 4: Run to green:** `test/reader-bridge.test.ts test/reader-policy.test.ts test/docs-scans.test.ts test/shadcn-alias.test.ts`. Expected: PASS, with `docs-scans`' "Library imports" case green over the three new edges. Also run `test/reader-lab-run.test.ts` and the type check of pwa's tests, which its updated fake now passes (review 2714 M6).
- [ ] **Step 5: Commit**: `feat(docs): the reader bridge carries ccrc's appearance`.

### Task 5: The frame follows the host

**Files:**
- Modify: `pwa/src/docs/ReaderFrame.tsx`, `pwa/test/reader-frame.test.tsx`
- Modify, the `ReaderMount` fakes outside this plan's other Files (review 2676 F5, carried at X4): `pwa/test/docs-one-bar.test.tsx`, `pwa/test/docs-version.test.tsx`, `pwa/test/reader-history-adapter.test.tsx`, `pwa/test/tap-targets.test.tsx` and `pwa/test/reader-lab-run.test.ts`. The last of them, the one written `satisfies`, is updated in Task 4 (review 2714 M6), so this task only runs it. Each other fake gains `seed: {hosted: false}` and a `follow` that records its calls. `ReaderFrame` reads a missing `seed` as `{hosted: false}`, so a fake older than Task 4's type still mounts as not hosted at run time; it reads no missing `follow`, because a not-hosted mount's theme changes go to `follow`, so every fake carries one. The typecheck does not enforce that: the fakes are cast (`as ReaderMount`, `as unknown as ReaderMount`), and a cast skips the missing-property check (only `reader-lab-run.test.ts` uses `satisfies`). The fake lists here are what ensures it, and Step 4 runs every listed file (corrected at the X4 fix round's adversarial pass). `reader-lab-run.test.ts`'s `satisfies ReaderMount` typechecks once its fake carries both.
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
      **Aa row amendment (2026-11-25; D-9053):** at default text size under a fine pointer, the row's computed minimum height equals the probe's height exactly and the rendered row is between that floor and 2 px above it, inclusive. A larger text size may grow the row and is not compared.
    - the popover's `box-shadow` equals the probe's;
    - the radii of a control, a pill and a popover equal the probes' for `--r-md`, `--r-sm` and `--r-lg`;
    - the Aa group heading's `font-size`, `font-weight`, `letter-spacing` and `text-transform` equal the probe's; its `font-family` starts with the library's fixed family name for the role `sectionFamily` names.

    And per skin, the frame bar's height, the measure, the prose size, the gutters and the title block's sizes equal BASE. Each is compared as a computed length in px, or as an element's `getBoundingClientRect()` height for the bar and the title block, never as a token's text. BASE is taken in the library's own faces and a hosted open is in ccrc's, so the fixture's title and byline each fit on one line in both faces at every tested width: a face change then cannot wrap them and move a box.
  - **AP-3:** with a stale reader theme stored under the reader prefix (`{"theme":"dark"}` under a light palette, and the reverse), the values at first `ready` equal the host's, never the stored theme's.
  - **AP-4:** hold the chunk, change palette and skin, release; at most one `appearance` op.
  - **AP-5:** while open, under both emulated device modes (light and dark), run every transition of the palette set, Follow the system included as a start and as an end: each palette to the next, each palette to Follow the system and back, and, while on Follow the system, the device mode flipping light to dark and dark to light. Then switch skin both ways. After each transition: same iframe element and nonce, scroll within 1 px, values within 100 ms, a drawn figure redrawn. The number of transitions is printed from the discovered catalogue.
    **Live-follow measurement amendment (2026-11-25; D-9030):** the ordinary browser leg checks one matching in-frame write per applied transition, in order, and no write on an applied-appearance no-op. It keeps the existing liveness wait and the other checks. Run the unchanged 100 ms ceiling in both modes with `CCRC_MEASURE=1`, the same switch as the paired open measurements. A quiet start and end are required for a verdict.
    **Separate redraw row (2026-11-25; D-9054):** keep the AP-5 fixture. Add a four-figure desktop fixture for the design's §9 Mermaid redraw budget. The ordinary run checks nearest-first ordering, one figure per browser task, and cancellation of queued work when a newer appearance arrives. Under D-9030, `CCRC_MEASURE=1` records the gaps and asserts the unchanged 200 ms ceiling on a quiet box.
  - **AP-6:** pairs on computed values, the focus ring at 3:1 after a Tab, and a drawn figure's edge `stroke` at 3:1 on its plate. Width, font and one fold changed in Aa are back after a reopen, and the stored `pref:prefs` holds no `theme` key. Aa shows the line "Appearance follows ccrc Settings", the label ccrc sent, and no theme row. Tab never lands on the line. A lab-profile mount, which carries no appearance, keeps its theme row. **Meaning without colour** (spec §10, X1-12), on a fixture that carries a glossary term, an id link and an ordinary link in running text, and opens the contents index and quick jump: in GitHub Light, Solarized Light and Catppuccin Latte, where `term` has no hue, `a.term`'s computed `text-decoration-style` is `dotted`, `a.xref`'s `dashed` and the link's `solid`; in Phosphor and Phosphor Daylight, where `ok` equals `info`, the index's `ok` and `info` dots have different computed `border-radius` or size; in Solarized Dark and Solarized Light, where `id` equals `accent`, `a.xref`'s and the ordinary link's computed `text-decoration-style` differ; in Tokyo Night, Nord, Gruvbox Dark and One Dark, where `chg` collides, a changed block's mark is the double bar; and quick jump's selected row has an inset `accent` box-shadow. The changed-mark geometry is the library's test 10, sampled from pixels; F reads it on the installed frame. **Mermaid, live:** one figure of each kind in the library's `MERMAID_HOSTED_KINDS` (read from the installed package, never typed), drawn in every palette: every label meets 4.5:1 on the shape painted behind it and every line that is not `border` or `rule` meets 3:1 on `surface` and `surface2`, on computed values; and a figure with a fill-only `classDef`, and a `journey`, each draw on 1.1.0's plate and filter.
  - **AP-8:** the bridge sent `appearance`; a forced mode-only mount fails this row's own assertion.
  - Extend the geometry files to run their existing assertions once per skin (**AP-7**), the one-bar assertion included.
  - Extend `frame-cost` with the srcdoc-growth budget, for the default layout (X2's wave P5 adds a row per layout, each over its own BASE): at most 191 736 characters over BASE, the two faces (187 640) and the seed (4 096). BASE is taken at Task 1's pin, so it already holds every design's library growth, which Task 1 Step 2a checks share by share. Together they keep spec §9's total over the same document at the 1.1.0 pin: 224 504 plus the other designs' shares. Also extend it with the open-to-`ready` budget (median of 9 opens at most 1.10 x BASE's median of 9).
    **Timing amendment (2026-11-24; D-9018):** The timing row uses the D-9017 paired method, with separate hosted (+30 ms) and mode-only (1.10×) limits on desktop Chromium, per skin. The ordinary run still asserts the srcdoc growth independently. F records the phone-engine timing as a device item, with a stop above +100 ms.
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
  - §4.7, what ccrc imports (review 2714 M7, D-8759): the `./frame` row gains the appearance exports ccrc now imports (`APPEARANCE_CONTRACT`, `APPEARANCE_SLOTS`, `APPEARANCE_PAIRS`, `parseAppearance` and the `Appearance` type), and its "Where ccrc uses it" cell becomes Task 4's allow-list, `docs/reader/bridge.ts`, `docs/reader/assets.ts`, `docs/reader/labPolicy.ts` and `docs/reader/appearance.ts`, in place of "In `docs/reader/` only"; the bridge bullet's adapters gain the `appearance` adapter and its assets the `fonts` asset; and the M8.10 bullet says the `./frame` home is that allow-list. The lab bullet's "`./frame`'s one home" is read the same way, `labPolicy.ts` being on the list.
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
| AP-M23 | Add 1 px to the hosted Aa row's computed minimum without exceeding the rendered ceiling | AP-6's exact minimum-height comparison (D-9053) |
| AP-M24 | Add 2 px to each side of the Aa label's block padding, leaving the minimum unchanged | AP-6's rendered-height ceiling in Instrument (D-9053) |
| AP-M25 | Drop an in-frame appearance write while still redrawing the figure | AP-5 ordinary mode: in-frame write count is zero instead of one (D-9030) |
| AP-M26 | Deliver two successive appearance writes out of order | AP-5 ordinary mode: the first in-frame appearance does not match that transition (D-9030) |
| AP-M27 | Delay an appearance write beyond 100 ms without hitting the liveness wait | AP-5 measurement mode, with a quiet start and end: the stamp-to-write ceiling assertion (D-9030) |
| AP-M28 | Start two figure redraws in one browser task | D-9054 ordinary mode: the one-figure-per-task assertion |
| AP-M29 | Reverse the nearest-first redraw order | D-9054 ordinary mode: the observed figure order differs from the order by viewport distance |
| AP-M30 | Let an older appearance's queued redraws continue after a newer appearance arrives | D-9054 ordinary mode: the latest appearance did not cancel the older queue |
| AP-M31 | Delay the next figure redraw so a consecutive gap exceeds 200 ms | D-9054 quiet measurement mode: the gap ceiling, not the liveness wait |

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
- **D-8816 (2026-11-20)**: gitgraph-cherry-pick-disc. Issued to run 2843 (L1, the library's appearance contract, built in the library's repository) and defined here, because a library wave's departures are asked and defined in ccrc. It departs from X1 spec §10's sentence "gitGraph's cherry-pick mark, `#ffffff` (`.commit-cherry-pick`, fill and stroke), painted `bg`, which meets 4.5:1 on its commit's series colour". It also departs from §10's measured "and the cherry-pick mark in `bg`), each at 4.57:1 or better on its commit's series colour", and from test 5's closed colours "`bg` on the cherry-pick mark".
  - Measured by L1 on Mermaid 12.1.0 (the cherry-pick branch of the gitGraph renderer's commit bullet): the disc carries `commit <id> commit-cherry-pick` and no `commit<n>` class. No theme key or series colour reaches it, and it draws black in library 1.1.0 too. Only its two dots and two stems carry the inline `#fff`. A rule on `.commit-cherry-pick` paints the disc and the mark alike, which would leave the mark at 1:1.
  - While hosted, the disc is `text-muted`, fill and stroke, and the mark is `bg`. Each rule carries `!important` and is scoped to the hosted mark, and the disc's rule never reaches the mark. The mark on the disc is the gate's `text-muted`-on-`bg` pair, 4.5:1 or better in every palette, and the disc meets 3:1 on `surface` and `surface2` as a line does. Test 5's drawn-pairs and closed-colours rows read both. A library mutation that drops the disc's rule, or lets it reach the mark, reds a row.
  - Why: the sentence cannot be built as written. `text-muted` is already a closed colour of the drawing and a measured line colour. The branch's own colour would need the library to infer a commit's branch from the layout, and a black disc fails the closed colours and the dark palettes (L1's ask 660, answered by the coordinator 2026-11-20, option 0).
  - Amended in place in §10 and test 5, each marked "(amended 2026-11-20; D-8816)".
- **D-8824 (2026-11-20)**: old-cap-row-frames-in-ci. Issued to run 2843 (L1, the library's appearance contract) and defined here, because a library wave's departures are asked and defined in ccrc. It departs from X1 spec §10 test 7's "a document at the old srcdoc cap still mounts with both faces and the largest appearance the validator accepts." It also departs from test 8's closing "a document at 1.1.0's default cap mounts in every layout with both faces and the largest appearance."
  - CI's row frames the document at 1.1.0's default cap with both faces and the largest appearance; it is a unit row.
  - The browser mount at that size is a measured row, gated off CI. It is measured once on Chromium with headroom, and on WebKit through a workflow input, before the library's release.
  - CI's browser run mounts a document of about 1.4 MiB.
  - **Figures,** printed by the Node row in CI at the landing tip `4c7b2ac`:
    - the document is 114 584 725 characters at the landing's assets (4 558 002);
    - at 1.1.0's asset lengths it is 114 554 743, under 1.1.0's cap of 114 569 828;
    - with both faces and the largest appearance it is 114 935 752, within the derived `MAX_SRCDOC_CHARS_DEFAULT` of 114 950 837.
  - The gated row leaves out the snapshot and the 64 Mermaid secure keys, so it is not a full mount at the cap.
  - Why: the shared test slice's memory cap killed the browser mount of a document at the cap (reviews 2906 F1 and 2945 F4).
  - Amended in place in §10 tests 7 and 8, each marked "(amended 2026-11-20; D-8824)".
- **D-8825 (2026-11-20)**: stick-arrowhead-by-stroke. Issued to run 2843 (L1) and defined here. It departs from X1 spec §10's "The stylesheet paints those markers' paths (`marker[id$="-stickTopArrowHead"] path` and `marker[id$="-stickBottomArrowHead"] path`) `text-muted`".
  - The stylesheet selects those paths by their literal stroke, `marker path[stroke="black"]`, under the hosted figure's mark. The full-screen copy remaps every id, so an id-suffix selector would miss the copy.
  - Test 5 still finds the paths by marker id, so a rule that missed one reds.
  - Why: review 2906 F2.
  - Amended in place in §10, marked "(amended 2026-11-20; D-8825)".
- **D-8826 (2026-11-20)**: author-styled-scan-widened. Issued to run 2843 (L1) and defined here. It departs from X1 spec §10's "Author-styled" sentences: "The scan reads the figure's text outside front matter as statements: split at every line break and every `;` (flowchart, ER and sequence diagrams accept `;` between statements), each trimmed of any leading white space, tabs included." It also departs from the two sentences that follow, on the heads and on the `<` rule.
  - The scan removes only the init directives that Mermaid 12.1.0 itself removes: its own `directiveRegex`, closed by `}%%`.
  - A head counts after the text's start, white space, a `;` or a `}`, and before white space, a `;`, a `:` or the end.
  - A `<<name>>` is spared only where an annotation stands, in class and state diagrams.
  - The scan errs toward 1.1.0's drawing.
  - Why: §10's split rule and `<` wording missed figures the bundled Mermaid draws styled, which is the 1.07:1 case (review 2906 F5, review 2945 F1 and F12, review 2965 F1).
  - Amended in place in §10, marked "(amended 2026-11-20; D-8826)".
- **D-8827 (2026-11-20)**: test-4-length-tolerance. Issued to run 2843 (L1) and defined here. It departs from X1 spec §10 test 4's "with no appearance, the rendered output and computed styles equal 1.1.0's for the corpus;".
  - Two lengths in px within 0.1 px are taken as equal, the repository's visual-comparison tolerance.
  - The width is pinned: a row reds when the tolerance is widened to 0.5 px.
  - Why: a box the reader sizes from measured text can land a sub-pixel apart between two pages that differ in nothing a rule sets (review 2945 F5).
  - Amended in place in §10 test 4, marked "(amended 2026-11-20; D-8827)".

All of run 2631's block is defined: 8759, 8760, 8761. Run 2843's numbers are defined: 8816 and 8824 to 8827.

- **D-8994 (2026-11-24)**: reader-assets-holds-no-hash-literals. Issued to run 3639 (wave C, wave 43). It departs from the reader-mode plan's amendment §3 row for `pwa/test/reader-assets.test.ts` ("its hash rows in the last commit") and its §4 list of what waits for the registry ("`reader-pin.test.ts`'s and `reader-assets.test.ts`'s literals"), and from this plan's amendment bullet "the wave's last commit: … `reader-pin.test.ts`'s and `reader-assets.test.ts`'s literals".
  - `reader-assets.test.ts` holds no registry-dependent literal: its hash rows compare each asset's sha256 against the installed package's own `FRAME_MANIFEST` entry, read at run time, and its specifiers are built from `FRAME_MANIFEST[k].path`. Measured at Task 1 on `main` at `fff0917bf7`: no 64-hex literal and no version literal in the file. So it takes only its renames, in Task 1's first commit, and the last commit holds `reader-pin.test.ts`'s literals alone among the tests.
  - Why: review 3635's advisory A1 found the file holds no hash rows; the brief asked Task 1 to confirm it and define the correction.
- **D-8995 (2026-11-24)**: m79-library-exception-retired. Issued to run 3639 (wave C, wave 43). It departs from the reader-mode plan's amendment §3 row for `server/test/docs-parity.test.ts` ("M79's specifier rule and its planted cases, the near-miss cases (`@synapsium-labs/docserverx`, `@other/docserver`) included"), and from the rich-docs spec's A21 and M8.18, the exception that let the library's import specifiers carry the standalone server's name in `pwa/src`.
  - M7.9's needle is that name. The library's new name, `@synapsium-labs/pinax-lib`, does not hold it, so renamed planted cases are no hits and the nine "is a hit" cases go red. The plan's text cannot be built as written.
  - The exception is retired instead: `M79_LIBRARY_SPECIFIER` and its code-position reader `m79InCode` are removed, so no import specifier is excepted. The planted cases keep the old name, and stay hits. The three cases that held an old-name import specifier green now hold it a hit, and a new case holds the new name's four specifiers clean. Measured: restoring the exception over the old name reds the three (Results, wave C).
  - Why: the exception existed only because the package was named after the needle (spec R-f). Kept over the new name it would except nothing; kept over the old one it would let the retired package back into the PWA unseen.
  - It is a second edit in place of `docs-parity.test.ts`'s append-only M7.9 block, after W8a's, and its header says so.
  - Task 7 amends A21 and M8.18 in place, marked "(amended 2026-11-24; D-8995)".

- **D-8996 (2026-11-24)**: checked-reader-mount-casts. Issued to run 3639 (wave C, wave 43). Task 4 Step 4 requires a clean PWA type check, but Task 4 Step 1 and Task 5's Files list defer all cast fakes to Task 5 on the premise that their casts bypass the check.
  - Measured with the required `ReaderMount.seed` and `follow`: eight TS2352 errors from direct `as ReaderMount` casts in `reader-frame.test.tsx`, `docs-version.test.tsx` and `reader-history-adapter.test.tsx`. Unlike a cast through `unknown`, the direct assertions still require sufficient overlap.
  - The affected fakes gain `seed` and `follow` with Task 4's interface, without changing any test's expectations. Both double-cast files and the late sign-in fake stay with Task 5, as does the component behavior. No cast is widened to hide a missing field.

Run 3639's block (8994 to 8996) is defined.

- **D-9017 (2026-11-24)**: same-session-reader-timing-base. Issued to run 3639 (wave C, wave 43). It departs from Task 6 Step 1 and the 2026-11-24 amendment only in how the timing BASE is taken. The geometry and srcdoc-size BASE remain at Task 1's commit.
  - For timing, build the Task 1 tree with the same candidate library as the hosted tree. Use the same ordinary Docs fixture and mount-start and ready marks for both. In one stock Chromium session, interleave the builds, alternating which goes first. Measure nine fresh opens per build per skin in each of two rounds, reversing the order in the second round. Each hosted median must be at most 1.10 times its own same-round BASE median; all four comparisons must pass.
  - The ordinary browser suite asserts the srcdoc size budget independently. `frame-cost.browser.test.ts` runs the timing comparison on demand: set `CCRC_MEASURE=1` and `CCRC_PAIRED_READER_BASE_DIST` to that built BASE, and select `reader paired timing`. Each comparison prints the samples and their spread. The earlier standalone timing figures remain Results evidence, not a fixed ceiling in the ordinary suite.
  - Why: the paired BASE medians were near 200 ms on the same machine that previously measured near 88 ms. A historical wall-clock comparator mixes the build's cost with changes in load. The fixture, library pin, measurement endpoints and 1.10 ceiling are unchanged.

- **D-9018 (2026-11-24)**: hosted-open-budget-after-measurement. Issued to run 3639 (wave C, wave 43). The earlier 1.10× hosted ceiling was a regression guard written before the host faces and first appearance were measured; this ruling supersedes that number for hosted mounts, not D-9017's comparator or any non-timing budget.
  - **Evidence:** the live hosted path added about 12–24 ms across the four measurement sessions. In the checkpoint run, the first shipped hosted mount added 23.8 ms Refined and 18.6 ms Instrument by the paired medians; all 18 individual deltas were positive. The mode-only bridge and the tip with all hosted work bypassed had mixed-sign paired deltas, with no consistent positive remainder. The measured cost belongs to the live hosted path as a group (the faces, seed, and first appearance), not to a separately measured stage. The reviewed overlap remains; the measurements isolated no timing effect from it.
  - **Desktop Chromium:** per skin, the median of nine hosted opens may add at most 30 ms over the median of nine BASE opens in the same session, interleaved per D-9017. Each of the two rounds must meet its own BASE. The mode-only mount keeps its separate 1.10× guard over its own same-session BASE in both rounds; build it with the same candidate library and the hosted decision forced false, not with a different reader or layout.
  - **What is asserted:** the ordinary `frame-cost` browser suite asserts the hosted srcdoc growth for both skins. Timing is a recorded opt-in `frame-cost` run, with an executable budget assertion for each arm, skin and round; run it against builds with the same corrected library, matching the BASE and fixtures. An ordinary suite pass is not a timing result.
  - **Phone engine:** F records a paired figure in its device item. More than 100 ms added is a stop to bring back to the coordinator. The desktop measurement is not phone evidence.

- **D-9030 (2026-11-25)**: quiet conditions for reader wall-clock measurements. Issued to run 3639 (wave C, wave 43). It adds a validity gate before D-9018's desktop budgets and before AP-5's live-follow ceiling, without changing either budget, the fixtures, or the paired open method.
  - A row is valid only when its BASE median is at most 1.25 times the quiet BASE recorded under D-9017 for its skin, and its BASE interquartile range is at most 20 ms. Otherwise the row reads **not measured: reference not quiet**, even if its candidate falls under the ceiling. Only valid rows get a D-9018 verdict.
  - The quiet reference is 81.4 ms for Refined and 86.6 ms for Instrument, giving ceilings of 101.75 ms and 108.25 ms respectively. Use one reference per skin in both arms and both rounds. These are the larger of the two quiet after-overlap D-9017 BASE medians per skin: both readings were quiet, and the bound admits both. Round numbers do not pair across sessions, and the diagnostic checkpoint medians had a different purpose.
  - Retain every attempt in Results, with raw rows, one-minute load at start and end, and validity and verdict per row. Attempt 1 below is not a measurement in any row; its start and end loads were not captured. Identical BASE bytes gave medians from 113.0 to 203.4 ms and a sample of 844.8 ms, versus quiet medians around 80 ms. Hosted deltas reversed sign per skin between rounds. The coordinator observed one-minute load of 9 to 11 on a 16-core box during the run; a reference that moves by 90 ms cannot decide a 30 ms budget.
  - For paired open timing, start at most three further attempts, only with one-minute load below 4. The first valid result decides its row; a valid red stops and returns to the coordinator, without optimisation or retry of that row. If three further attempts leave any row unmeasured, stop and report it; the coordinator chooses where to measure next. If no exact per-skin quiet figure is identifiable in D-9017, refer the recorded evidence back before a new attempt.
  - For a wall-clock ceiling without a reference arm, the one-minute load must be below 4 at both the start and end of the row. Otherwise the row reads **not measured: box not quiet**, whether its raw time was above or below the ceiling. This applies to AP-5's stamp-to-write ceiling in both emulated modes. Keep the 100 ms ceiling and fixtures unchanged. The one diagnostic replay counts as the next attempt if valid; name every transition and record its host stamp, operation send and frame write times. A valid red stops that row; report the worst transition without optimisation.
  - The ordinary AP-5 browser rows check matching writes in order, exactly one per applied transition and none at all for a no-op, under their existing liveness wait. Only `CCRC_MEASURE=1` measures the 100 ms ceiling; this is the same switch as for the paired open budgets. Record verdicts and loads separately by emulated mode. AP-M25 and AP-M26 are ordinary-mode mutations.
  - **Amendment (2026-11-25):** after four scheduled checks found no quiet window, start irrespective of one-minute load. The reason is directional: box load can add time, so an absolute reading at or below its ceiling still proves the budget, but an overrun does not by itself distinguish the reader from the box. The rules below replace the original start gate, absolute-row validity and attempt limits above; fixtures, sampling and budgets stay unchanged.
    - **Absolute ceilings:** AP-5 light and dark at 100 ms and D-9054 at 200 ms pass at any load when the reading is at or below the ceiling. An overrun is red only from a quiet sitting, otherwise record **over, box busy** and leave the row unsettled. A sitting is quiet if its start and end one-minute loads are both below 4, or if the paired readings bracketing the ceiling block are both valid by the BASE median and IQR rule.
    - **Paired open speed:** the BASE median (at most 101.75 ms Refined or 108.25 ms Instrument) and IQR (at most 20 ms) alone decide whether the row is valid. Log the one-minute load at both ends; it no longer gates the reading. The first valid result decides the row.
    - **Delay controls:** AP-M27 and AP-M31 must fail on their own ceiling assertions at any load, not on startup, liveness or timeout. A control that completes without tripping its ceiling is a finding at any load. In a measurement run, `CCRC_READER_DELAY_CONTROL` names the exact control whose ceiling must assert without a quietness check.
    - **Sittings:** take the first sitting in order: paired rows, ceiling rows and gap, delay controls, paired rows again. Take up to five more sittings, at least 45 minutes apart by timer, only for unsettled rows; do not watch the load between sittings. Record each sitting's readings, start and end loads, and rows settled in Results. Stop when all rows are settled. Report a valid red immediately without retry or optimisation. If six sittings leave rows unsettled, report those rows and the BASE figures and stop for a ruling on the next venue.
  - **Second amendment (2026-11-25; paired rows only):** this rule changed after sitting 1, before any further reading. A quiet BASE arm does not show that the candidate arm escaped a load burst. Mode-only Instrument round 1 read 1.0168× and 1.1272× while the two eligible BASE medians differed by only 0.1 ms (95.0 and 95.1 ms). Both are readings, neither is a verdict. The first-valid-reading rule above is superseded. Both AP-5 ceilings, the four-figure gap and the two delay controls settled in sitting 1; do not take them again.
    - Count a paired reading only if its BASE meets the same median and IQR bounds. Keep both medians from each counted reading. Load can add time to either arm, so with at least three counted readings take the lowest candidate median over the lowest BASE median, independently even if they come from different brackets. Compare those minima with the unchanged budget: hosted candidate ≤ BASE + 30 ms, mode-only candidate ≤ 1.10 × BASE. Fewer than three counted readings leave the row undecided. An aggregate red returns immediately with every reading, without retry or optimisation.
    - Show every reading's own ratio and the median of the counted ratios. For the hosted diagnostic, express BASE + 30 ms as a ratio using the lowest counted BASE. If that median ratio exceeds the ceiling but the aggregate passes, mark the disagreement and leave the pass in place; the coordinator names the row to the reviewer.
    - Keep the existing alternating BASE/candidate samples and reverse the lead in round two. The opt-in browser bracket reports each requested reading without asserting a timing budget on it; its fixture and size controls and the ordinary CI checks are unchanged. The cumulative rule has its own focused cases in `pwa/test/reader-paired-verdict.test.ts`.
    - Use opening and closing paired brackets only in up to five more sittings, at least 45 minutes apart by timer. Take only rows still undecided, evaluate after each bracket, and stop when all eight are decided or an aggregate is red. After the sixth sitting, report any undecided rows and their readings and stop for the coordinator's decision on acceptance or a window.
  - **Final form for paired rows (2026-11-25):** the quiet-BASE rule and lowest-of-three rule above were tried and withdrawn on the same day. In sitting 1, nearly identical eligible BASE medians (95.0 and 95.1 ms) accompanied ratios of 1.0168× and 1.1272× for the same comparison. In sitting 2, hosted BASE medians rose to 204.8–315.8 ms against the earlier quiet references of 81.4 and 86.6 ms, and a 90 s ready wait expired before a mode-only row completed. Sitting 2 is a recorded attempt, not a counted sitting or a timing red. None of the earlier paired readings counts under the final method. The two AP-5 ceilings, four-figure gap and both delay controls remain settled; do not retake them.
    - Within each comparison take 20 adjacent BASE/candidate pairs in one Chromium session, flipping which arm leads each pair (`BASE, candidate, candidate, BASE, …` in round one; the inverse in round two). This retains the original sampling order and makes the pairing explicit. Compute each statistic on the pairs before taking its median; do not compare independent arm medians. Fix the count for all rows before taking the first sitting. Keep the fixture, open-to-ready witness and ordinary CI unchanged.
    - Before the comparisons and again after them, take one BASE/BASE row in each skin using the same 20-pair sampler. All four control medians must be in [0.97, 1.03], inclusive. An out-of-range control excludes the entire sitting; neither load nor a BASE median or spread determines whether a completed reading counts. Record each pair and all four controls, without a timing budget assertion in the browser run. A ready timeout ends the sitting without a verdict; retain its completed pairs.
    - Mode-only uses the median of candidate/BASE for each pair against 1.10×. Hosted uses the median of candidate minus BASE for each pair against 30 ms, with no ratio conversion. Record the BASE/BASE controls' median differences in milliseconds beside their ratios; only the ratios determine validity. A counted reading at or under its ceiling passes. A counted mode-only overrun is red. A counted hosted overrun is referred for a ruling, with its pairs, median BASE time and median per-pair ratio: a busy box stretching the measured time makes the 30 ms comparison stricter, not looser, so a pass stands but an overrun alone does not distinguish the reader from stretch. Return either kind of overrun immediately, without retry or optimisation.
    - For the initial sequence, read one-minute load once immediately before a sitting. Above 16, defer by timer for 45 minutes without starting a browser; do not poll. Record endpoint loads for started sittings as observations. Take at most four sittings in this form, taking only undecided comparisons with all four controls. Stop when all eight rows are decided and report the table, or report remaining rows and control readings after four sittings for acceptance.
  - **Close-out disposition (2026-11-25):** none of the four final-form sittings counted: two ended at the ready wait and two completed with BASE/BASE controls outside [0.97, 1.03]. All eight rows are undecided, not passed and not red. They no longer hold Wave C. At programme close-out, take the same eight rows and four controls in the same form, with the same verdict rules, before calling the programme done.
    - Sitting 4 is evidence only and decides nothing. Hosted medians were 16.60–20.55 ms over BASE against the 30 ms budget; the absolute median differences of the BASE/BASE controls were at most 5.60 ms. Three mode-only ratios were 1.003–1.027×; Instrument round two was 1.112× against 1.10×, in a sitting whose Instrument closing control was 0.960×. The coordinator will flag that comparison to the reviewer.
    - **While awaiting publication:** at most eight timer checks of one-minute load, at least 90 minutes apart. Start only at load ≤6, with at most four more sittings. This changes the start gate and cap only; use the same method and verdict rules. Record every further sitting in Results whether it counted or not. Stop at the first counted sitting and send the table; report any counted red immediately with its pairs, and refer any counted hosted overrun as above. Stop altogether on publication authority or after the eighth check; record the number of checks and sittings in Results. If none counted, the close-out disposition stands and no further sitting is owed by Wave C. Publication, the final dependency/lock/pin and push remain on hold pending separate authority.

- **D-9053 (2026-11-25)**: hosted-Aa-row-floor-and-ceiling. Issued to run 3639 (wave C, wave 43). It departs from Task 6 Step 2's equality of rendered row height with the host probe. Under a fine pointer at default text size, the Aa row's minimum height must exactly equal the host's height; the rendered height may be between that floor and 2 px above it, inclusive. A row at larger text size may grow and is not compared. Shadow and radius comparisons remain exact.
  - Refined measured 52 px for the host probe, minimum and rendered height. Instrument measured 32 px for the host probe and minimum, and 33.0469 px rendered. The label has a computed 21.06 px line box and 6 px padding above and below, with no block border; in Instrument, those are the full row height to layout rounding (0.0131 px). The row itself adds no block padding or border and its container has no explicit row gap. The label's own content and padding exceed Instrument's floor by about 1.05 px. The library intentionally uses `min-height` so text size and zoom can grow the row.

- **D-9054 (2026-11-25)**: multi-figure redraw witness in the console. Issued to run 3639 (wave C, wave 43). Task 6's original AP-5 case observes one drawn figure and stays intact. A separate desktop case covers the design §9 redraw budget using at least four already drawn, unstyled figures of covered kinds at distinct viewport distances. It checks every redraw's order, browser task and new paint after one appearance change. Then it sends a newer appearance with older work demonstrably queued, and checks that only the newest queue completes and that no old paint is installed after the newer appearance. This is a browser test, not a new library hook or a substitute for F's phone evidence.
  - A consecutive redraw gap above 200 ms fails only in `CCRC_MEASURE=1` on a valid D-9030 row; log all gaps and load at both ends. AP-M28, AP-M29 and AP-M30 run in ordinary mode; AP-M31 is the quiet measurement-mode control.

- **D-9056 (2026-11-25)**: the Wave C file list omitted `pwa/test/skin-identity.test.ts`. Issued to run 3639. Add only the exact-path registry entries for `pwa/src/lib/appearance.ts`, which observes changes to the root's skin attribute for the applied appearance, and `pwa/src/lib/appearanceStamp.ts`, which reads the same attribute to derive the applied appearance stamp. Neither writes it. Leave the scanner and every standing negative control unchanged. Removing either new entry must red its own row; a third, unregistered neighbouring reader must still red the guard.

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
| Mermaid (X4): `accent` on `surface2`, a gantt task label Mermaid marks clickable | 4.57 | Phosphor Daylight | 4.5 |
| Mermaid (X4): `text-muted` on `surface2`, a vertical marker's text over a gantt row | 5.54 | Catppuccin Mocha | 4.5 |
| Mermaid (X4, corrected in fix round 2, review 2714 F7): `text` on a gitGraph commit label, opaque `surface2` by the hosted rule, ground from pixels with the branch lines under it | 6.57 | Catppuccin Mocha | 4.5 |
| Mermaid (X4): a mark inside a commit (`surface2` or `bg`) on its commit's series colour, `git0` to `git7` (corrected in X4 fix round 1, review 2694 F4) | 4.57 (`surface2` on `accent`) | Phosphor Daylight | 3 |
| Mermaid (X4 fix round 1): a sequence stick half arrowhead, `text-muted` by the stylesheet, on `surface` | 6.74 | Solarized Light | 3 |
| Mermaid (X4 fix round 1): the same on `surface2` | 5.54 | Catppuccin Mocha | 3 |
| Mermaid (X4 fix round 2): a definition ring, `focus` by the stylesheet, on `surface` (the focused node's only focus indicator) | 5.19 | GitHub Light | 3 |
| Mermaid (X4 fix round 2): the same on `surface2` | 4.57 | Phosphor Daylight | 3 |
| Mermaid (X4 fix round 2): a `click` tooltip's `text` on `surface`, at Mermaid's 0.9 opacity over any slot colour | 6.30 | Solarized Light | 4.5 |

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
- **The derivation, drawn.** Each fixture was drawn under the candidate `mermaidThemeOf` in all twelve palettes. A text's ground was read from the shapes painted behind three points of its box, composited with their opacity over the plate (`elementsFromPoint`, then `isPointInFill`), and the sequence number from its marker's circle, which hit-testing skips. That method cannot see strokes: review 2714 F7 found gitGraph commit labels over the 8 px branch lines, at Mermaid's 0.5 label-box opacity. Re-measured from pixels at fix round 2, the label's box with its text shown and hidden: 2.19:1 at worst without the hosted rule, 6.57:1 with `.commit-label-bkg { opacity: 1 !important }` (both Catppuccin Mocha). Test 5 samples pixels. Every text in all 96 drawings met 4.5:1, and every line (a stroke in `text-muted`, `accent`, `no` or a series colour) met 3:1 on `surface` and `surface2`. The strokes the drawings hold that are not lines were judged against what they sit on: the plate-coloured gaps between pie slices have no floor by design, and the marks inside a commit (`surface2`, and `bg` for the cherry-pick) meet 4.57:1 or better on their commit's series colour (`surface2` on `accent`, Phosphor Daylight; the first draft's 4.52 named a series colour no commit takes, corrected at review 2694 F4). The adversarial pass caught a first draft of this sentence that read the data as every stroke meeting 3:1 on the plate, which the pie gaps and commit marks do not. The worst pairs are in the Cross pairs table (the rows marked X4) and in spec §10.
- **Author colour.** Eleven statement forms (a `:::` class among them), each in a one-node fixture, were drawn under the derivation. Each put the author's colour into the drawing: `classDef`, `style`, `linkStyle` and a `:::` class in a flowchart; `style` and `classDef` in a class diagram; `classDef` in a state diagram; `style` and `classDef` in an ER diagram; and `rect` and a coloured `box` in a sequence diagram.
- **F2, from pixels.** A flowchart whose one style is `classDef c fill:#D4EDDA` on one node was drawn three ways, and its label box was screenshot. The label's contrast was read as the ratio between the box's commonest pixel (the fill) and the pixel farthest from it. Hosted with no plate it is 1.07 to 1.30:1 in all eight dark palettes. On 1.1.0's dark plate and filter it is 7.95:1, and on its light plate 13.49:1.
- **The label route F2 allows.** For every fill on a 52-step grid of the RGB cube, the better of `text` and `bg` was taken. The worst falls between 2.77 (Catppuccin Latte) and 4.12 (Phosphor), so no route reaches 4.5:1 for every author fill in any palette, and it is not taken.
- **The budget.** 1.1.0's `dist/frame/manifest.generated.js`, in the installed package (its committed source is `src/frame/manifest.generated.ts`), has five entries: `chars` 3 643, 30 153, 198 215, 549 069 and 3 746 940, which is 4 528 020 characters (4 530 427 bytes). X2's comparators are in X2's plan Results.
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
| F4: the sum, append-only rows, X1's 32 768 | Spec §9's srcdoc row, part (2); §10 test 8, its "the rule" and "one landing, one line, and what its word appends" bullets (the coordinator's ruling on ask 608, mail 25627; the second bullet was called "one row per change of the assets" until fix round 1); "Which of these constrain later additive work", Test 8; "One release for more than one design". Plan: Global Constraints' budgets; Task 1 Step 2a; Task 6's `frame-cost` |
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
- **The measuring commit is read from the table's history,** never typed: the commit that lands a row cannot know its own sha, and a squash merge would change it. This reshapes the ruling's "each row names the library commit that measured it", so it went to the coordinator as a structured ask (ask 608), who ruled it with conditions (mail 25627): the row's measuring commit is the commit that appended it, read from history, and no row or follow-up commit types a sha; at every commit test 8 recomputes the newest row from that commit's own manifest and requires every earlier row byte-equal to the parent commit's table, so by induction each row is what its commit measured and no deep history is needed; a commit that changes no frame asset appends no row, and one that changes one appends exactly one, attributed to the design whose share it spends. Review 2694 F1 found two cases the ruling left open, the landing that introduces the table and a landing of several commits, and the coordinator completed the ruling: the unit is a landing, not a commit ("Fix round 1", below). Review 2714 moved the shares into a table of their own ("Fix round 2", below). Spec §10 test 8 states the rule as it now stands.
- **A layout is never larger than the default bundle,** so the largest frame is bounded by the default, and X2's frame share covers only the default's growth. For X2's four layouts this is an assumption that test 8's layout row enforces, not a measurement (fix round 1, F5).
- **X2 F10's chips and step labels fold into row PR6.** The rich-docs spec's Print row counts "PR1 to PR15", and a 16th row would need an edit outside this wave's four files. The coordinator ruled that such a sentence goes to them as a separate question; folding the labels into PR6 needs none.

#### The adversarial pass (Opus · high, one pass over the changed sections)

It found no critical issue, 9 important and 14 minor. It reproduced every X4 contrast figure, the 110-key coverage, the series, the 4 528 020 baseline and every terser comparator. Dispositions:

| Finding | Disposition |
|---|---|
| 1: test 5's stroke row, and AP-6's, could never pass: pie gaps and in-commit marks are near 1:1 on the plate, and the Results line misread its own data | Fixed. Spec test 5 and §10 judge lines (`text-muted`, `accent`, `no`, series) on both grounds, in-commit marks on their commit's series colour (4.57 at worst, corrected at review 2694 F4), and pie gaps as plate by design; the Results sentence is corrected; a Cross pairs row is added |
| 2: the sequence fixture's colourless `box` made it author-styled, so test 5 never drew sequence hosted | Fixed. The fixture has no `box`; a separate row asserts that a colourless `box` alone takes the fallback |
| 3: the scan could be bypassed by case, by `;` and by tabs, and missed state `style` | Fixed. Statements split at line breaks and `;`, any leading white space, heads compared without case, every head applied to every covered kind; test 5 gains `STYLE`, a `;`-joined line, `RECT`, a tab-indented line and state `style`; the form count is eleven, `:::` among them |
| 4: append-only against `HEAD~1` let an earlier commit of a multi-commit change rewrite a row, and a shallow checkout broke it | Superseded at fix round 1 (review 2694 F1), which made the unit a landing. What the coordinator first ruled (ask 608, mail 25627), since replaced by the landing rule: test 8 ran at every commit, recomputed the newest row from that commit's manifest and held every earlier row byte-equal to the parent's table, so by induction no commit can rewrite a row and one parent of history is enough. A first draft of this fix used the merge base and full history; the ruling replaced it |
| 5: a row's design was self-declared, and upkeep such as a Mermaid bump had no row kind | Fixed. A `Size-Design:` line is checked against the row, a `rebaseline` row counts against no design and is approved by the coordinator, and shrinking frees room in the same design only |
| 6: naming the measuring commit by history reshaped the ruling | Asked (ask 608); the coordinator ruled for history, with the conditions above |
| 7: X2's frame share left out R7 and R9, layout stylesheets and the bootstrap, and wrote estimates as bounds | Fixed in X2 §6: rows for R7 and R9 and the bootstrap, layout stylesheets inside each layout's bound, "at most" dropped. The shares rise to 1 148 928 and 45 056; fix round 1 (F5) revised them to 1 166 336 and 72 704 |
| 8: whether the default bundle is a layout bundle was undefined | Fixed. `default` is a layout; a frame inlines exactly one layout's assets |
| 9: M11.74 could not fail, and the class list missed `tmeta`, the count's status class, `attn`, `yours` and the hidden brackets | Fixed. P5.5's assertions read structure and classes; the class list is derived from the conformance output; print mode emits no bracket or colon |
| 10: test 9's parent-to-frame row could not catch an added op | Fixed. The bootstrap's list is exported as `FRAME_ACCEPTS`, compared with the parent's, and the parser is driven over every name in both op lists and a planted one |
| 11: the series worst palette differed between spec and plan, and `accent` and `no` read as 4.52 | Fixed. Solarized Dark, 4.515; `accent` 4.57 and `no` 4.77 stated apart |
| 12: §5's Mermaid row missed the `text-muted` and `accent` labels and the `text` filled arrowhead | Fixed |
| 13: `excludeBkgColor` missing from the literals; cScale unmentioned | Fixed: ten literals (superseded at fix round 1, review 2694 M4: fourteen); none of the 66 cScale, fillType and surface keys reaches a covered drawing, stated |
| 14: drawn pairs with no row, and a fixture claiming every shape | Fixed. Cross pairs rows for a clickable label, marker text over a row, commit labels and in-commit marks; the fixture names the classic shapes. |
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
| F1: test 8 could not run at the genesis landing or at a multi-commit landing (the coordinator's ruling, completing ask 608) | Spec §10 test 8: "the rule" (the test judges a commit against its first parent, and CI runs it on the landing), "the landing that introduces the tables", "one landing, one design, one row" and "history depth"; "Which of these constrain", Test 8; "One release for more than one design". Plan Task 1 Step 2a. X2 spec §6, "Size, and X2's share" |
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
| I4: test 8 could not run as a merge gate (a merge ref has no trailer, a squash may hold two) | Fixed. Spec test 8: a candidate run judges the merge ref or queue entry against its first parent; the design is one `Size-Design:` line in the pull request's description, which the landing commit's message carries. A squash-only landing this row first required was dropped at fix round 2 (review 2714 F1): a squash and a merge commit are both allowed, as the coordinator ruled |
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

#### Fix round 2 (review 2714, round 2 of 3, at `783cef4e7`)

The review closed round 1's F2 to F6 and M1 to M8, re-added every figure and reproduced the worst cases, the 14 literals, the eight stick spellings, the 0 filters and the rings. It found 7 important and 10 minor issues. The coordinator ruled F1 to F3 and directed the rest. Each finding is one commit, closed at the line below.

| Finding | Closed by |
|---|---|
| F1: the spec required a squash landing | Spec §10 test 8, "where the design is named": a squash or a merge commit, the message carrying exactly one `Size-Design:` line, the setting the library programme's choice with GitHub's as examples. This plan's adversarial row I4 no longer gives the squash rationale |
| F2: a share a landing writes was no ceiling | Spec §10 test 8: two append-only tables, its lead and "the rule"; "the landing that introduces the tables" (X1's and X2's share rows, and the genesis ceiling held by review and by Task 1 Step 2a); the new "the shares table" bullet; "within the share"; "Which of these constrain", Test 8. Task 1 Step 2a reads both tables and checks both share rows against the brief. X2 spec §6's ceiling bullet |
| F3: the two-design refusal as a test | Spec §10 test 8: "where the design is named" (one parse for both runs, the description edit, the main line authoritative), "one landing, one line, and what its word appends" (what the test enforces and what review checks; reserved words), the new "correcting a row" bullet, and the closing paragraph. X2 spec §6's first paragraph says line, not trailer |
| F4: `FRAME_ACCEPTS` at genesis, `hello`, the parent's values | Spec §10's `FRAME_ACCEPTS` export row and test 9's parent-to-frame row (1.1.0's four port ops plus `appearance`; `hello` out); the new paragraph "How tests 8 and 9 read the first parent" |
| F5: the parent read named an ignored file | Task 1 Step 2a: `src/frame/manifest.generated.ts`; the budget note names the committed source |
| F6: the definition cues and Mermaid's tooltip | Spec §10's new bullet "The library's own cues on a figure, and Mermaid's tooltip"; test 4's recorded difference; test 5's fixture, closed-colours row (with `body`-level overlays) and the new cues-and-tooltip pair row; "Everything else"'s restated claim. Cross pairs: three fix-round-2 rows |
| F7: gitGraph commit labels over the branch lines | Spec §10's new bullet "Commit labels"; the measured paragraph; test 5's drawn-pairs row (pixels, with a mutation row). Cross pairs: the commit-label row corrected; the derivation note's method sentence |
| M1: a queue entry's first parent | Spec §10 test 8, "the rule" |
| M2: a revert | Spec §10 test 8, "correcting a row": a revert is a forward row with negative growth |
| M3: stale lines | X2 spec §6's first paragraph (the baseline row); this plan's carry table (the bullet's current name); adversarial row 4 and the measuring-commit choice |
| M4: PR #3055's body | Patched over REST at this round's push: both fix rounds, and the shares in characters |
| M5: the `/frame` home | Task 4's docs-scans bullet: an allow-list, with planted rows in `policy.ts` and `images.ts`; the Wave order paragraph |
| M6: Task 4's red commit | Task 4's Files, Step 1 ("the one checked fake") and Step 4; Task 5's Files. Made with the editor after a guard refusal, with the coordinator's leave (mail 25889) |
| M7: rich-docs §4.7 | Task 7 Step 1's new §4.7 item, which lands in wave C's Task 7 |
| M8: which heads are `text` | Spec §5's Mermaid row; §10's stick-arrowhead bullet |
| M9: the KiB gloss | X2 spec §6: the shares without it, the table's unit sentence, the stylesheet row's class-token clause |
| M10: transparent paint | Spec §10 test 5's closed-colours row |

What fix round 2 measured, in the same read-only way as above:
- **Commit labels, from pixels.** A new probe drew test 5's gitGraph fixture in all twelve palettes, took a screenshot of the drawing with the commit labels shown and again with their text hidden, and read each glyph pixel's ground from the second: worst 2.19:1 without the hosted rule (Catppuccin Mocha, under 4.5:1 in eleven palettes; the review's 2.62 to 2.90 are One Dark-like samples), and 6.57:1 with `.commit-label-bkg { opacity: 1 !important }` (Catppuccin Mocha; the analytic `text` on `surface2` is 6.75, and the box's antialiased edges take the rest).
- **The definition cues and the tooltip.** 1.1.0's cue colour `#0b6b66` is 1.36 to 2.85:1 on `surface` and `surface2` in the eight dark palettes and 6.35 on white. `focus`, the hosted ring, is at worst 5.19 on `surface` (GitHub Light) and 4.57 on `surface2` (Phosphor Daylight). 1.1.0's tooltip text is the browser's default black, about 16.5:1 or better on its own ground (the adversarial pass, below, corrected a first figure that assumed `text`); hosted, `text` on `surface` at its 0.9 opacity over any slot colour is at worst 6.30 (Solarized Light). `focus` equals `accent` in all twelve palettes.
- **The port parser's list.** The built `frame/bootstrap.js` in 1.1.0 accepts `prefs`, `changes.result`, `mermaid` and `command` on the port, and takes `hello` only in its window listener; its frame-to-parent list is `ready`, `error`, `store.set`, `navigate`, `copy`, `changes`, `hash`, `version` and `progress`.
- **The sequence heads,** from the fix-round-1 probe's marker paints: the full arrowhead and the cross head are `text-muted` and the filled head is `text`, in every palette.

The adversarial pass over fix round 2 (Opus · high, one pass over the changed sections, reading computed styles, opacity, the cascade and `body`-level overlays) found 10 important and 10 minor issues. Dispositions:

| Finding | Disposition |
|---|---|
| A1: dropping the cues' inline `!important` lets a `classDef` recolour them | Fixed. The inline declarations keep `!important` and read `--dn-ring`, `--dn-dot` and `--dn-dot-edge` with 1.1.0's values as fallbacks; the hosted rule sets the properties. Test 4's note and test 5's mutation row follow |
| A2: a root-scoped tooltip rule cannot match, and 1.1.0's tooltip text is black, not `text` | Fixed. The frame marks `html` while hosted and sets three properties there, and the rule is `html[data-docreader-hosted] > body > .mermaidTooltip`. The premise now reads 1.1.0's black, about 16.5:1 |
| A3: `.commit-label-bkg { opacity: 1 }` loses to Mermaid's id-scoped rule | Fixed. The rule carries `!important`, and a new bullet says every hosted Mermaid rule does, and why. The 6.57 was measured with an id-scoped selector, which wins as `!important` does |
| A4: pixel grounds fail the pie and sequence fixtures | Fixed. Test 5 reads pixels for gitGraph commit labels only; the spec names the crossings it measured (3.01 to 4.06 under a lifeline, 1.23 to 1.88 on small pie slices) as Mermaid's layout |
| A5: a correction pair against "no growth row" and line-to-row agreement | Fixed. Test 8's words bullet states what each word appends |
| A6: no word for a landing that appends nothing | Fixed. `none`, and a design's name on a landing with no asset change appends nothing |
| A7: reserved-word rows and the share-row rule; the baseline row's name | Fixed. `baseline` is reserved and named; reserved-word rows need no share row |
| A8: no route to change a share | Fixed. A later shares-only landing appends a superseding row; the newest at the first parent binds. An over-large layout goes to the coordinator, and allowing it is a change to the layout row |
| A9: "no design spends another's share" overclaimed | Fixed. Test 8 holds the share on the attributed growth; attribution, `rebaseline` and corrections are review checks. X2 §6's ceiling bullet says the same |
| A10: test 9's first entry checked by nothing | Fixed. `FRAME_OPS` is parsed from the parent's committed `src/frame/protocol.ts`, `FRAME_ACCEPTS` equals the four-op literal, and the masked 1.1.0 CSP, which has no committed literal, is a review check |
| M-a: X2's per-layout CSP in the record | Fixed. The record extends to one CSP per layout in X2's landing, a new layout's first entry a review check |
| M-b: a queue entry's line; rebase landings | Fixed. A queue entry's run reads the entry commit's message; a rebase landing is not allowed |
| M-c: Step 2a's release read | Fixed. Both tables, at the tagged commit |
| M-d: the I4 row's "queue group"; row 5's "trailer" | Fixed |
| M-e: the M6 row names the editor | Kept. The coordinator's leave for that edit asked for this one neutral line |
| M-f: `mermaidThemeOf` among ccrc's imports | Fixed. Dropped from Task 7's §4.7 item; no ccrc task imports it |
| M-g: X2 §6's one-row sentence | Fixed. It names the correction and shares-only landings |
| M-h: "rounded up" to what | Fixed. To a multiple of 1 024 characters |
| M-i: the tooltip on fallback figures | Fixed. It is one element for the document, chrome over the figures, and takes the host's colours for every figure while hosted, as the spec now says |
| M-j: the genesis share's source | Fixed. The coordinator's figures, given in the library wave's brief |

Choices fix round 2 made:
- **The genesis landing stays X1's contract landing,** as round 1's ruling shaped it, and records both share rows. With no shares table at its parent, its own ceiling is held by review and by ccrc's Task 1 Step 2a, which reads the released tables and stops ccrc's wave unless both share rows match the brief. A shares-only first landing would close that by test, but it would change the ruled genesis shape, so it was not taken.
- **Test 9's parent values are a committed record,** not a build of `HEAD^1`: one entry by hand per landing that changes an op list or the CSP's shape, against a second install and build on every run.
- **The cues keep their inline `!important`** and take resolved colours, never a `var()` (review 2732: a state diagram's `classDef` can set a custom property on the cues, which a `var()` would read), so an author's `classDef` cannot recolour them, the full-screen copy carries them, and with no appearance the inline style text equals 1.1.0's.
- **The tooltip is styled from the `html` element,** because it is a `body` child outside the library's root scope: the frame marks `html` while hosted and sets three custom properties there.
- **Pixel grounds stay with the gitGraph commit labels.** On every fixture the method also catches Mermaid's layout crossings, a lifeline through a sequence label and crowded small pie labels, which no colour clears; they are named in the spec rather than failed or passed silently.
- **The tooltip's opacity stays Mermaid's,** because Mermaid fades it to 0 to hide it; a forced opacity would show it always. Its contrast is measured at 0.9.
- **`labPolicy.ts` is on the `/frame` allow-list,** because it imports `./frame` today, for the reader lab.

#### Review 2732 (round 3 of 3, at `40b31c959`)

The coordinator accepted X4 at the review cap, on the condition that the reviewer's replacement sentences land verbatim, with no further fix round. Each landed as its own commit: F1, the sequence-label halo (spec §10, "Crossings, and the hosted halo"; the pie stays outside the floor); F2, the cues' resolved inline colours and the hosted rules' `svg` mark, which reaches the full-screen copy (spec §10; test 4's recorded difference deleted); F3, this plan's cues choice; F4, the clickable gantt label under `strict`; F5, the superseding-share guard and "within the share"; F6, the correction's double equality; F7, test 9's drive over `OP_KEYS`; M1, the bullet names; M2, the shares table's lead; M3, the words `x1` and `x2`, the line's grammar and asset detection by sha256; R3 and R7, the main-line commit that carries 1.1.0 (Task 1 Step 2a); R4, the label floors on the shapes behind them; and X2's share, set by the coordinator on 2026-11-19 at 1 166 336 characters total and 72 704 frame. With the coordinator's leave, test 5's drawn-pairs row was brought into line with the halo paragraph.

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
node <scratch>/gitlabel.mjs gitGraph commit labels, 12 palettes, pixels -> worst 2.19 without the rule, 6.57 with it
node <scratch>/cues.mjs     the cues under a classDef, inline normal and !important -> normal takes the class colours; !important keeps 1.1.0's
node <scratch>/tipcolor.mjs the tooltip under 1.1.0's stylesheet       -> root-scoped rule does not match; text is the default black
node <scratch>/spec.mjs     .commit-label-bkg opacity under four rules  -> 0.5 unless !important
node <scratch>/pxall.mjs    pixel grounds, every fixture, 12 palettes   -> lifeline crossings 3.01 to 4.06; small pie labels 1.23 to 1.88
python3 <scratch> cues      12 palettes, the cue, ring and tooltip pairs -> #0b6b66 1.36 to 2.85 dark; focus 5.19 / 4.57; tooltip 6.30
grep over the built frame/bootstrap.js (read only)                  -> port ops prefs, changes.result, mermaid, command; hello in the window listener
```

No test, build or install ran: nothing in this wave changes code. Every commit was scanned for private names before it was made, and again before the push.

### Wave C, run 3639: built ahead of publication (2026-11-24)

**Base.** `main` at `fff0917bf7`. The workspace branch only; nothing pushed and no pull request opened before publication (the reader-mode plan's amendment §4).

#### The built-ahead library

The coordinator's word for the install is the brief of run 3639. The library's repository was cloned bare from `https://github.com/Synapsium-Labs/pinax-lib.git` into the session temp root, and `996a39b2602d2e1e636c54c95cc9e403fe55cf88` ("Prepare library version 1.2.0 (#94)", 2026-11-24) exported from it with `git archive`, never from a working tree. No tag pointed at it when read.

| Step, in the export | Result |
|---|---|
| `npm ci` | rc 0. npm's install-scripts gate skipped esbuild's postinstall; the build did not need it |
| `npm run build` | rc 0 |
| Built `assets/` against the commit's blobs (`git hash-object` of each built file against the tree's blob) | 0 differ |
| `npm pack` (its `prepack`, `scripts/verify-assets.mjs`) | rc 0; "every file under assets/ is named by assets/assets.json"; 514 files, 3.7 MB packed, 12.2 MB unpacked |
| Tarball `synapsium-labs-pinax-lib-1.2.0.tgz` | sha512 `sha512-vZTiHrZvQBz/AfY8tD5/URE0yrDOjA/ANtmgsy4PE7J5H7DAUu/LxSZpsuna6RsAXwcCkikD+dsV7vN3VZOhlQ==`; sha256 `f2d71d20ea59f44f63a75677e029d33be8ba494efb74d1fb7f7ac1ede5c83757`; 3 678 313 bytes; npm's shasum `5efbe62d23aaceb845a74a4cc726fbc9d23eb950` |
| `npm install --no-save <tarball>` in `pwa/` | rc 0; `pwa/package.json` and the lock unchanged (`git status` clean); `node_modules/@synapsium-labs/pinax-lib` 1.2.0 beside the locked `docserver` 1.1.0; its `assets/assets.json` byte-identical to the commit's |

The registry tarball's integrity need not equal this local pack's; the lock takes the registry's at the last commit.

**Task 1 Step 2a, Git-object read ahead of publication (rc 0).** At `aacae4c56dcbf3d8da4069957a957eb530e2ac17`, `conformance/size/shares.json` holds exactly X1 and X2's rows below, and `conformance/size/growth.json` holds exactly `baseline` and `x1`. The first parent `aceb346ae09ac65b70b5587a5676f941056ca3a1` counts 4 528 020 characters (4 530 427 bytes), in entries of 3 643, 30 153, 198 215, 549 069 and 3 746 940 characters. Both genesis rows trace to the X1 landing by first-parent line history. Its own row is 4 558 002 on each measure, a rise of 29 982.

At the 1.2.0 candidate, each design row equals its landing's manifest as read from its Git object. The cumulative deltas and the release's recorded ceilings are:

| Design | Growth (total / largest frame, characters) | Share (total / largest frame, characters) |
|---|---:|---:|
| X1 | 29 982 / 29 982 | 32 768 / 32 768 |
| X2 (four rows) | 721 478 / 13 423 | 1 166 336 / 72 704 |
| X6 | 37 411 / 8 788 | 59 392 / 15 360 |

The candidate's last row (`x6`, at `61c4bdfde06b99738e0df4a87cf0e8489c9cd4ec`) matches the installed `FRAME_MANIFEST`: 5 316 891 characters over all 13 entries and 4 580 213 in the largest frame (common entries plus the largest layout). Each counted file's character count, byte length and sha256 match the committed manifest and the installed `assets/assets.json` hashes. This is the local candidate check only; it does not verify a tag or registry publication.

The installed `assets/assets.json` (manifest 1, package `@synapsium-labs/pinax-lib`, version 1.2.0, bridge protocol 1), every entry:

| Asset | sha256 | CSP source |
|---|---|---|
| `fonts/OFL.txt` | `18aabf190848725e2576eefb5c29ba06aac1029d02132252a7f312eac2e50cf3` |  |
| `fonts/README.md` | `cfd817cfc6a573679d6961ed40a410b9c0c87ccd1af8bdce2d28c00846e314e9` |  |
| `fonts/source-sans-3-latin-wght-italic.woff2` | `9a15dafc2c2b2414aaa9d6c30830d9aab4361329d8495b1574633603b994b411` |  |
| `fonts/source-sans-3-latin-wght-normal.woff2` | `7a19a7027e125257d310c6dbd78ae3a30b5ea1e3794d60b12bb28227a003bfda` |  |
| `fonts/source-serif-4-latin-opsz-italic.woff2` | `96e6393209728ab93c334ae739af8a040cd2006c82e8614d6465a8084db88f89` |  |
| `fonts/source-serif-4-latin-opsz-normal.woff2` | `f2ea9c12d2fe9bd3a9589b02ad2c0909da88f30938c91adc838c4f4098f9f9e0` |  |
| `frame/bootstrap.js` | `d0ab0f7e312251e25005b7c090dbb8129a971c0755d456cf35f82fe450d26c63` | `'sha256-0KsPfjEiUeJQBbfAkNu4EpqXHAdV1FbPNfgv5FDSbGM='` |
| `frame/enhance-classic.js` | `608037f6acd409299b19fa32b65c2488dd8bbf276da3d182d38a298d9c5af86a` | `'sha256-YIA39qzUCSmbGfoytlwkiN2Lvydto9GC04opjZxa+Go='` |
| `frame/enhance-editorial.js` | `91948b8a6af0c8f0c30b36a5a935f71c727fdb386e1f6ce58ee4a4be38f66edd` | `'sha256-kZSLimrwyPDDCzalqTX3HHJ/2zhuH2zljuSkvjj2bt0='` |
| `frame/enhance-guided.js` | `152934356f24ee2286a67176d0497213c97825fe36b1344622df46fc26273a14` | `'sha256-FSk0NW8k7iKGpnF20ElyE8l4Jf42sTRGIt9G/CYnOhQ='` |
| `frame/enhance-review.js` | `920c60b298691f8293b79df9208e96f4a54cf4260a7f4501bf4ee30aa51a51a3` | `'sha256-kgxgsphpH4KTt535II6W9KVM9CYKf0UBv07jCqUaUaM='` |
| `frame/enhance.js` | `0a1b49f4a8c20dd3fe7df8d4589cc7ff5030fde2cc548015d2d7ff47d5c787ef` | `'sha256-ChtJ9KjCDdP+ffjUWJzH/1Aw/eLMVIAV0tf/R9XHh+8='` |
| `frame/guard.js` | `ff3c25da5703bc06d40ca0412b2e760c619a73a4153306f4d0f3b662bda65c4d` | `'sha256-/zwl2lcDvAbUDKBBKy52DGGac6QVMwb00PO2Yr2mXE0='` |
| `frame/layout-classic.css` | `90de780c9e0f98fea4bb916357b1ce74a962e577027e1cb88f28e0470b7ea23c` |  |
| `frame/layout-editorial.css` | `c15993de4b7d34298fe9287c25516e8254cc1ff70f5b4c9eca92f731b8835dda` |  |
| `frame/layout-guided.css` | `9ceef0b3f36b5d9ec611767f20622d0edc7cf0a91f76be65e34f61dbb897304c` |  |
| `frame/layout-review.css` | `920780aaeccf034223d33179d0f1a77fab74663d317825f75960b7920a7def68` |  |
| `frame/reader.css` | `32aa81ef916560fe4a304599dfcebcd96cd4825e1d8c33d0e6ae81916d563529` |  |
| `layouts/classic.css` | `90de780c9e0f98fea4bb916357b1ce74a962e577027e1cb88f28e0470b7ea23c` |  |
| `layouts/editorial.css` | `c15993de4b7d34298fe9287c25516e8254cc1ff70f5b4c9eca92f731b8835dda` |  |
| `layouts/guided.css` | `9ceef0b3f36b5d9ec611767f20622d0edc7cf0a91f76be65e34f61dbb897304c` |  |
| `layouts/review.css` | `920780aaeccf034223d33179d0f1a77fab74663d317825f75960b7920a7def68` |  |
| `mermaid/mermaid.frame.js` | `7585b2055ba386b9acff71b9c8a0c40b36dec79c2106a4aa56048c8fe59832c3` | `'sha256-dYWyBVujhrms/3G5yKDECzbex5whBqSqVgSMj+WYMsM='` |
| `mermaid/mermaid.mjs` | `dfba66fc5c75e030c35bf16d5e7a62bbee7be5496cabec94ec93f85d626b38df` |  |
| `print.css` | `2ba6cfdc58eaf2e5bced8b767eb85fb3255bcd1c9a23ee1e62ee5add4bfb6113` |  |
| `reader.css` | `816db9774bbda71b99b85d1404523c8c837866bee2072eae0806339405cc2996` |  |

**The import list, read ahead on the tarball** (Task 1 Step 1 reads it again at publication): 1.2.0's `exports` are 1.1.0's, key for key (`./render`, `./conformance`, `./enhance`, `./frame`, `./host`, `./highlight`, `./assets/*`, `./package.json`), and every asset the console imports by specifier (`frame/guard.js`, `frame/bootstrap.js`, `frame/enhance.js`, `frame/reader.css`, `mermaid/mermaid.frame.js`) and the two deep paths the tests read (`dist/frame/seed.js`, `dist/host`) exist in it. No change to the list.

#### Task 1's first commit: the rename (D-8976)

Every file of the reader-mode plan's amendment §3 outside the package file, the lock and the pin's literals moved to `@synapsium-labs/pinax-lib` and `Synapsium-Labs/pinax-lib`: the four source files, the pwa and server tests, the browser test, and the provenance step's repository, signer, lock key, pack spec, tarball name and closing line. `git grep` of the old name outside `docs/` then answers only the package file, the lock, `reader-pin.test.ts`'s `resolved` prefix, `docs-parity.test.ts`'s planted old-name cases (D-8995), and the standalone docs server's own lines that §3 leaves alone. `reader-pin.test.ts` changed only its `LIB` constant and its title's package name. `reader-assets.test.ts` took its renames only (D-8994). `docs-parity.test.ts`'s M7.9 exception is retired, not renamed (D-8995).

| Check, on the built-ahead tree (`ccrc test`, foreground) | Result |
|---|---|
| `pwa`: `tsc --noEmit` | rc 0 |
| `pwa`: the 14 renamed files (`docs-scans`, `markdown-purity`, `reader-assets`, `reader-bridge`, `reader-built`, `reader-commands.test-d`, `reader-diff`, `reader-history-types.test-d`, `reader-images`, `reader-lab-bridge`, `reader-lab-frames`, `reader-pin`, `reader-policy`, `w7-storage-keys`) | 503 of 508 pass; the 5 reds are `reader-pin.test.ts`'s 1.1.0 literals, red by design until the last commit |
| `server`: `ci-pipeline`, `docs-parity` | 214 of 214 pass |
| D-8995's mutation: the exception restored over the old name, from a saved copy, restored and hash-checked | the three retired-exception cases red |
| The browser leg, renamed `reader-frame.browser.test.ts` included | run as Task 6 Step 1's BASE, on this commit (below) |

#### Task 6 Step 1: BASE, at Task 1's commit

Taken at `63ba659ed5` (Task 1's rename and its follow-up, below), on the built-ahead tree, before any edit of Tasks 2 to 5, with no appearance: Chromium (Playwright's build), this box, each file once through `ccrc test`, foreground. The per-skin extensions Task 6 Step 2 keeps (every one-skin case of `docs-compact-head` and `reader-frame`'s worst case once per skin, and `frame-cost`'s reader-open measurement, on demand under `CCRC_MEASURE=1`) were written for this measurement and held out of the tree until Task 6. Runs: `docs-compact-head` 132 of 132, `reader-frame` 55 of 55, `frame-cost` reader-open 2 of 2.

| Figure | Refined | Instrument |
|---|---|---|
| Open to `ready`, an ordinary page (6 sections, 42 paragraphs, no image, no figure), 9 opens | median 88.4 ms (80.0 to 109.1) | median 84.4 ms (77.2 to 100.3) |
| srcdoc of that page | 839 815 characters | 839 815 characters |
| `T10-FIGURES worst` (30 images, 5 MiB) | srcdoc 13 600 319; mount 109.7 ms; ready 2 085.5 ms; wall 2 540 ms; 57 316 elements | srcdoc 13 600 319; mount 105.0 ms; ready 2 061.2 ms; wall 2 557 ms; 57 316 elements |
| One bar at 412 x 915 (`L11-FIGURE`) | title 56 px down, frame at 48 | title 56 px down, frame at 48 |
| Full head, `above` at 600, 768 and 1280 | 233, 213, 306 | 233, 213, 310 |
| Touch laptop `above`, 1280 and 915 x 412 | 322, 342 | 326, 346 |

All 142 `PHH-FIGURE`, `L11-FIGURE`, `T10-FIGURES worst` and `FRAME-COST-READER` lines are kept with the wave's scratch and summarised here; Task 6 compares each against its own line. Hold condition 5 decides whether this BASE stands at the registry pin.

**Task 1 follow-up (`63ba659ed5`).** The browser leg's first run at the rename commit failed to collect `reader-frame.browser.test.ts`: its fixture read the installed bootstrap's global list by the name 1.1.0's minifier gave it (`var O=[…]`), and 1.2.0's names it `M` (118 names; 117 in 1.1.0). The case's comment already says it reads the first array literal, so the code now matches any name. No assertion changed.

#### Task 4: Bridge checks

- Red: the new hosted-policy row failed before the function existed. A subsequent three-file run had eight failing and 149 passing rows, one failure a font-loader timeout. The four-file red run as a single command was not captured. The first full PWA type check of Task 4 exited 2 on the eight direct casts recorded in D-8996.
- Green after the fix and re-review: the PWA type check exited 0. The bridge, policy, scan, alias, lab-run, frame, version, history-adapter and host-appearance files passed 512 of 512 through `ccrc test` (rc 0). The wrapper ran locally with the unsaved candidate.
- Assertion-red and restored with hash checks: AP-M1, AP-M4, both AP-M22 holds, AP-M8, AP-M12 (including the lab row), AP-M14 and AP-M16. A compile-valid microtask yield immediately after the appearance read also reddened the timing assertion. AP-M21 has a matching planted-import control; the actual source mutation remains for Task 6.
- Re-review found no production blocker. Follow-up for the whole-branch review: stripping fonts copies the base asset object, so a non-production `deps.assets` implementation that supplies asset fields through inherited or non-enumerable properties could lose them. The shipped loader supplies ordinary own fields.

#### Task 6: Hosted measurements at the build-ahead pin

The timing row remains **red** (D-9017). The first, standalone hosted run gave medians of 107.3 ms (92.5–113.3) for Refined and 96.5 ms (92.1–106.8) for Instrument, both over 1.10 times the historical BASE. The same-library, same-session comparison below used the same fixture and the same mount-start and `ready` endpoints. Each cell reports medians with min–max in ms, from nine fresh opens per build; the first build alternated and the lead was reversed in round 2.

| Test | Round | Skin | BASE | Hosted | Ratio |
|---|---:|---|---:|---:|---:|
| Before overlap | 1 | Refined | 206.2 (141.4–393.9) | 227.9 (177.1–278.6) | 1.1052 |
| Before overlap | 1 | Instrument | 193.8 (138.8–378.8) | 214.7 (163.2–278.5) | 1.1078 |
| Before overlap | 2 | Refined | 185.1 (128.6–240.2) | 203.1 (146.1–259.3) | 1.0972 |
| Before overlap | 2 | Instrument | 177.6 (98.7–219.0) | 196.8 (120.7–268.0) | 1.1081 |
| After overlap | 1 | Refined | 79.9 (76.2–94.6) | 100.3 (95.7–122.0) | 1.2553 |
| After overlap | 1 | Instrument | 82.9 (78.7–98.5) | 97.5 (91.0–107.9) | 1.1761 |
| After overlap | 2 | Refined | 81.4 (76.3–90.9) | 97.5 (93.8–110.0) | 1.1978 |
| After overlap | 2 | Instrument | 86.6 (75.2–103.9) | 102.9 (91.4–110.6) | 1.1882 |

- Both paired runs exited 1. Three comparisons missed before the experiment and four after it. The across-run change in the ratios does not isolate the effect of the overlap: the BASE and hosted builds both ran much faster in the later session, despite the fixtures and procedure matching. No second timing experiment was attempted. The bridge unit run failed on serial loading (3 failed, 79 passed) and on faces-first ordering (1 failed, 81 passed), then passed 82 of 82 after base-first overlap. Read-only review found no production blocker; late face rejection after the base fallback returned was not tested independently. The full PWA suite attempt stopped after the runner's budget warning; the focused run is not a full-suite result.
- Ordinary-page srcdoc independently passed in each skin after the experiment (2 passed, 51 skipped, rc 0). The paired run measured the same sizes in all opens: 1 028 425 Refined and 1 028 424 Instrument, against BASE 839 815 and limit 1 031 551. No timing result is inferred from the size pass.
- The production CSS guard is assertion-red on the build-ahead candidate (1 failed, 13 skipped, rc 1). The complete scratch comparison covered 12 explicit palettes and two system modes × two skins × two pointer kinds × 43 slots = 2 408 values. Of 1 844 spelling differences, the library accepted 1 720 case-only changes and 28 alpha-hex shadow conversions. It refused 40 short hex occurrences (`#FFFFFF` → `#fff`, in `accent-ink`, `surface` and `bg`) and 56 leading-dot tracking occurrences (`-0.011em` → `-.011em` and `0.08em` → `.08em`). 620 individually accepted colour values were also omitted when one other colour slot dropped their group. No host-side normalisation was introduced. AP-1, AP-2, AP-3, and AP-6 remain open; the corrected package must turn the ordinary guard green.
- The Chromium compact-head suite passed 132 of 132 (rc 0). Both skins have one phone bar, the title at 56 px, console part 48 px, and the 44 px tap floor. In the 26 matched figure rows, maximum delta in `above`, `frameTop`, `screenTop`, `titleInFrame` and measured head height was 0 px; head mode never differed. This is not a phone-engine run or a comparison of the frame's own measure, prose, gutters and title-block dimensions.
- The Chromium reader-frame suite passed 55 of 55 (rc 0). The worst fixture decoded all 30 images in each skin; Refined / Instrument respectively: srcdoc 13 788 256 / 13 788 255, mount 117.5 / 117.9 ms, ready 2 750.4 / 2 134.5 ms, wall 3 266 / 2 647 ms. The fixture remained at the 5 MiB image budget; the ordinary-page srcdoc cap above does not apply to this row.
- AP-8 passed on the production build (1 passed, 13 skipped, rc 0). The same row on a separate build forced to take the mode-only mount failed at its appearance-seed assertion (`undefined` vs the expected object, 1 failed, 13 skipped, rc 1). The live working-tree source was not mutated.

#### Task 6: Bounded timing diagnostic after the stop

The coordinator kept the red-first overlap and authorised one diagnostic, not a second optimisation. Task 2 adds the map and Task 3 the stamp helper, but neither can mount hosted. Task 4 (`e1ce2bb945`) exposes the new bridge interface without the shipped caller supplying its appearance root, so its measured mount is still mode-only. Task 5 (`59a0423d13`) is the first shipped hosted mount. In the overlap tip's scratch control the caller omits the appearance root and substitutes a constant for the stamp hook; it loads no hosted faces, sends no appearance seed or appearance op, and leaves the rest of the mount and its lazy bridge in place.

One paired round per checkpoint, nine opens per skin/build, alternating lead, same fixture and ready mark, one Chromium session. Values are medians (sample min–max) in ms; the paired delta range is over the nine individual pairs, not a confidence interval.

| Checkpoint | Skin | BASE | Checkpoint median | Added by medians | Paired delta range |
|---|---|---:|---:|---:|---:|
| Task 4, mode-only | Refined | 83.9 (78.2–104.5) | 86.2 (80.9–104.8) | +2.3 | −10.3 to +16.2 |
| Task 4, mode-only | Instrument | 85.6 (73.7–88.1) | 80.6 (74.7–86.4) | −5.0 | −12.7 to +9.7 |
| Task 5, hosted | Refined | 75.6 (72.5–81.5) | 99.4 (91.9–101.4) | +23.8 | +13.3 to +27.6 |
| Task 5, hosted | Instrument | 79.4 (73.0–82.7) | 98.0 (89.4–108.1) | +18.6 | +11.3 to +27.2 |
| Tip, all hosted work bypassed | Refined | 80.8 (76.7–87.6) | 81.6 (76.9–90.6) | +0.8 | −6.9 to +10.3 |
| Tip, all hosted work bypassed | Instrument | 80.2 (75.9–87.8) | 78.1 (74.5–81.3) | −2.1 | −11.5 to +1.2 |

The diagnostic completed all six comparisons. Srcdoc was 839 815 in every BASE and mode-only/control open and 1 028 425 / 1 028 424 in the hosted opens. Task 5 added time in every pair; both mode-only checkpoints have mixed signs and no consistent positive remainder. This locates the cost in the hosted path as a group, not in a particular stage or asset. It does not change the ceiling, and it is not timing acceptance.

#### Scratch profiling before the overlap: removals, not acceptance

Nine adjacent control and variant opens per skin and variant. In the table, positive means the removal saved time (median of per-pair open savings, ms). Each row's sample range included both signs.

| Removal | Refined | Instrument |
|---|---:|---:|
| Omit the font payload, still wait for the chunks | +3.1 | +5.6 |
| Keep the payload, bypass font decode and registration | +1.3 | −0.8 |
| Bypass first appearance application, keep seed and faces | −4.0 | +0.5 |
| Omit the appearance seed, keep root read and faces | −2.7 | +0.3 |
| Bypass the stamp hook | −0.8 | +11.4 |

The unmodified measurement path in the scratch control took 2.4–3.3 ms for the face chunk wait, 1.0–1.3 ms for the host read and verdict, 0.3–0.4 ms for the initial apply, and 4.9–5.2 ms for synchronous font handling. Face loads settled 16.8–18.1 ms from entry, while other readiness work was running; those spans are not additive. The no-font-payload variant removed 187 670 srcdoc characters including the envelope. Refined / Instrument reductions: mount preparation 3.2 → 0.8 ms in each; srcdoc build 11.9 → 9.5 / 9.6 ms; append to seed parse 14.4 → 11.9 / 12.3 ms; parse and validate 1.2 / 1.1 → 0.4 / 0.4 ms. Both font-removal variants loaded neither face; the control loaded both. The profiling was deliberately instrumented; five diagnostic cases passed, not an acceptance budget.

**Known cost, candidate follow-up:** the two faces travel as text inside the frame document. A cheaper way to carry them may exist within the unchanged sandbox and frame policy. Neither the measurements nor D-9018 promise or authorise a different carriage in this wave. The corrected library still needs its own paired measurement.

#### D-9018 harness verification (2026-11-24)

The ordinary size rows still passed independently after the paired harness changed (2 passed, 51 skipped): 1 028 425 characters Refined and 1 028 424 Instrument, against 839 815 BASE and a 1 031 551 ceiling. TypeScript passed on retry at the same test-slice cap after the first run exited 137. The restated timing gate was not run: desktop timing acceptance waits for three matching corrected-library builds, and F owns the phone-engine pair.

#### Task 6: Paired reading geometry in scratch

On the build-ahead library, a separate Chromium probe paired both skins at 412 × 915, 600 × 960, 768 × 1024 and 1280 × 800. Both builds had identical one-line byline metadata and the probe selected the same visible prose paragraph. Across all eight pairs the maximum delta was 0 px for the reader bar, measure, gutters and padding, visible prose size, title and byline heights, and full title block. The title and byline each stayed on one line. This diagnostic used a different fixture from the protected phone title-budget row and does not replace the phone-engine run.

#### Task 6: Lazy-open check on the held pin

AP-4 initially stopped at the browser's command-palette locator: the option's accessible name includes its group, and the choice page renames the search box. The test now selects the option by its exact visible title and uses the choice page's own search box. One retry stopped during Vitest startup with `code.charCodeAt is not a function` and reported test-slice OOM kills. The next run applied both choices and passed the full seed-colour comparison, then failed the seed-skin comparison: Instrument's `.08em` was absent from `sectionTracking` (one failed, 13 skipped). AP-4 remains open until the corrected library; the test still requires all skin slots.

#### Task 7: Verification while the pin is held

- Scoped PWA tests and built guards: 4 593 passed, five failed. The five are `reader-pin` checks for the exact manifest and lock entry, installed version, installed asset manifest version and protocol, and its pinned hashes. The local build-ahead install and the committed 1.1.0 pin intentionally differ. The scoped rerun passed the asset-import census with the five manifest-derived entries and exactly two inline faces. The first full run is recorded below.
- Scoped server guards: 261 passed, one failed. The deviation cross-tree case timed out at its 20 s limit both in the batch and alone. A one-off 60 s diagnostic passed 34 of 34; it does not clear the default failure. Neither the guard nor its timeout was changed.
- The Task 7 rich-reader amendment passed scoped re-review after clarifying that a hosted theme is not stored as a reader preference. Both protected 2026-11-06 phone evidence blocks and the rich-reader spec's E17 summary row were compared byte for byte and were unchanged.

#### Corrected local library (2026-11-25)

After merging `bce2bc52fd` locally, the named producer-main object `59d4d18a98e14b9edc6fbe9f64d3d39793347502` was exported from Git, rebuilt, packed and installed without saving. The local pack has 514 entries, 3 681 976 bytes, SHA-256 `c8cfafcf0537a642d0d87d0f1f6d1e254e2880f56b1691d269bc1cbf32b39d8b`, npm shasum `40f825be68ae586bfcea9bbdd05ded8290c9e3d7` and integrity `sha512-V4QhSgY5HwSQ/yhy2G/I6VB9gO/3LEGrv+bJUd+6+E7dnaBEqWCK4iXN309h+7G7y/T5N1JEhI26tO29hFkJ4g==`. Asset-manifest SHA-256 is `179a330da49ad4fefc8ba51a00f6f0eb0da9464c0868178fe18a7150d430dfa9`. All 26 asset hashes and applicable script CSP hashes matched the installed and rebuilt manifests. The five enhancer hashes changed; the committed pin and lock did not. This is local evidence, not the producer's browser acceptance or registry provenance.

- The production CSS guard passed all 56 contexts and 2 408 values without a refusal, against the identical guard's red on the held package above. No host normalisation was introduced.
- A scoped browser run passed twelve tests, two AP-5 cases skipped. It included 28 catalogue opens, both first-ready stale-theme controls, the lazy-open seed including Instrument's `.08em`, the implemented chrome, preference, contrast, cue and fallback rows, and AP-8. This was not the complete AP-6 matrix.
- The corrected Task 1 BASE rebuilt at `63ba659ed5` reads 840 371 srcdoc characters in both skins. Mode-only equals BASE; hosted reads 1 029 009 in Refined and 1 029 006 in Instrument, against 1 032 107. Both ordinary size checks and every paired size control passed.

#### Corrected AP-6, geometry and census (2026-11-25)

- Five post-merge PWA import, storage, control and role census files: 238 passed, no reported type errors, rc 0. The wrapper also reported one shared test-slice OOM kill.
- The built lab-profile control kept Aa's selected Auto theme and had no hosted label. The revised live figure probe passed all 12 canonical palettes × eight installed kinds. Phosphor Daylight's ER cardinality circle had an opaque `rgb(234, 238, 234)` interior and a 1 px `rgb(78, 88, 80)` outline. The previous false failure counted the interior as a line; the outline was checked on both grounds. The producer's pixel checks and F's installed-device checks are separate.
- The exact-height Aa check was assertion-red on Instrument, then the D-9053 floor and ceiling check passed in both skins with the same computed heights. AP-M23 set the rendered Refined row and its minimum to 53 px against a 52 px host floor. It failed the exact minimum comparison, not the ceiling. AP-M24 held Instrument's 32 px minimum and increased the rendered row to 37.0469 px, which failed the 34 px ceiling. Both were measured independently by mutating the open frame's CSSOM; the test input was restored and hash-checked after each. Initial startup and mount failures did not count as red. Candidate for a later library release, not a promise: make Instrument's default label content fit its 32 px floor while preserving text-size and zoom growth.
- The corrected same-library geometry row passed all eight pairs: two skins at 412 × 915, 600 × 960, 768 × 1024 and 1280 × 800. Across all pairs, head mode stayed the same, each title and byline stayed on one line, and every measured length had a 0 px delta. This fixture's byline makes it different from the one-bar title-budget fixture. The separate 412 × 915 browser rows passed in both skins: one bar, no frame bar, frame at 48 px, title starts at 56 px, tap row 44 px. This is not phone-engine evidence.
- The four corrected-package browser files passed together before the D-9054 case was added: 226 passes, one expected failure and 41 skips, rc 0. Both worst-frame rows painted and decoded all 30 images within the unchanged 5 MiB image budget. Hosted worst-frame srcdoc was 13 789 513 characters in Refined and 13 789 510 in Instrument (earlier Task 1 witness: 13 600 319 each). The measured mount/ready times were 253.1/2 792.1 ms and 142.3/2 674.2 ms respectively; these are ordinary-run diagnostics, not paired timing acceptance.

#### Corrected AP-5 live-follow timing, attempt 1 (D-9030)

The coordinator measured one-minute load of 14.49 on the 16-core host during the run; individual row start and end loads were not captured. The wrapper reported three shared test-slice OOM kills. The two selected files together had three passes, one failure and 156 skips, rc 1. The light assertion stopped the light row; neither observed timing result is an acceptance verdict.

| Emulated device mode | What was observed | Validity / verdict |
|---|---|---|
| Light | In-frame write 152.599853515625 ms after the host stamp, above 100 ms; the transition was not named in that run's output | Not measured: box not quiet |
| Dark | The timing assertions completed over 41 transitions (38 effective, three applied-appearance no-ops); individual times were not printed | Not measured: box not quiet |

After the D-9030 split, the ordinary correctness checks passed 41 transitions in each mode: light had 39 effective and two no-ops; dark had 38 effective and three no-ops. The probes stayed active across the sequence and counted complete in-frame slot writes synchronously, not MutationObserver batches. The same run passed the restored Aa case (three selected passes, 24 skipped). Ordinary results do not measure latency.

AP-M25 in ordinary mode red on `phosphor → light`: the figure redrew, but there were zero in-frame writes instead of one. AP-M26 in ordinary mode captured two real host appearance messages and forwarded their appearances in reverse order on the next pass; both transitions failed the matching-write assertion. Each input was restored and hash-checked. The initial M25 startup error and M26 setup on a no-op did not count. The later isolated AP-M23–26 runs reproduced each intended assertion with a measured process cap of 4 096 and the 900 s browser deadline, with the input restored and hash-checked after each. AP-M27 has no quiet measurement yet.

#### First full PWA unit run against the corrected package (2026-11-25)

20 970 passed, two skipped and 13 failed across 617 files; no reported type errors, rc 1. Five `reader-pin` assertions still see the deliberately held pin. `browser-dist` caught the new test calling `serveDist(sharedDist())` rather than the existing two-step shared-build idiom. The exact-input unit test saw `#2e3440` from the corrected library instead of `#2E3440`; the raw host input was still uppercase. Six `skin-identity` assertions failed because the existing registry did not list the two applied-appearance readers. The registry-only fix was approved as D-9056.

After the two in-scope test fixes and the D-9056 registry entries, the restored `browser-dist`, `reader-appearance`, `skin-identity` and `docs-scans` suites passed 289 tests with no reported type errors. The raw-input check still requires uppercase from the host, separately from the canonical lowercase library verdict.

D-9056 controls: removing either entry in isolation failed the existing census on that exact module. A third reader planted in the copied tree's `pwa/src/lib/theme.ts` failed on that path with both valid entries still present. All three controls ran with the 4 096 process cap and 600 s deadline and were assertion-red, not timeouts. The temporary cases were removed and the test file restored and hash-checked; only the two registry entries remain. The AP-M21 real-source mutation likewise failed with `src/docs/ReaderFrame.tsx main-bundle:value-import` at the same cap and deadline; the frame source was restored and hash-checked before the green run.

The full restored PWA rerun had 20 978 passes, two skips, five failures across 617 files, and no reported type errors (rc 1). Only `reader-pin` failed: package manifest exact pin; lock root and package integrity; installed package version; installed asset manifest version and protocol; installed asset manifest's pinned hashes. All five require the held final pin; no other case failed.

The restored production build (`tsc --noEmit && vite build`) exited 0. Vite reported a 12.91 s build and the PWA precache had 76 entries; the wrapper reported one kill in the shared test slice, not a failed build or typecheck.

The producer's separate Chromium and WebKit opt-in runs passed on the exact packed commit, each with one ready and no fallback. Signed tag, registry publication and the final pin remain separate gates.

#### Remaining ordinary appearance mutations (2026-11-25)

| Mutation | Intended assertion observed |
|---|---|
| AP-M7 | `text` sourced from disabled ink: Refined Phosphor text on page measured 3.226:1 and Refined Light 2.425:1, both below 4.5:1. |
| AP-M13 | With the hosted seed and fallback preference both absent, the first ready had the stored dark appearance instead of the console's light appearance. |
| AP-M15 | Removing the skin group produced zero of the ten required skin slots in both the unit and live frame assertions. |
| AP-M17 | Forcing the section family to sans failed the unit mono comparison and the live Instrument family comparison. |
| AP-M18 | Substituting the medium token for the large radius made Refined's popover 10 px instead of 14 px. |
| AP-M19 | Removing the host label failed the unit assertion and showed the library's neutral text instead of the console's Aa label. |

Each selected run exited 1 on a named assertion under the 4 096 process cap and the applicable 600 s or 900 s deadline. The source files were restored and compared to their saved copies.

#### Desktop multi-figure redraw (D-9054)

On the restored package, the four drawn figures sat 3 996.70, 2 528.44, 1 060.17 and 0 px from the viewport in document order. They started and replaced their SVGs in order `[3, 2, 1, 0]`, with four distinct Chromium tasks and the new node fill in each replacement. In the cancellation control, one older timer was held after the first old SVG replacement; the newer appearance then canceled the old queue and every figure finished with the newest node fill (`#434c5e`). The scoped ordinary run passed (one selected, 27 skipped, rc 0). After review, the witness traced both the starts and the SVG replacements, and took the final exact-count and paint snapshot after the released and scheduled zero-delay timers and temporary redraw stages drained. The restored four-file browser run passed (227 passes, one expected failure, 41 skips, rc 0). Each start and its corresponding replacement shared a Chromium task, with four distinct tasks across the four figures. Both AP-5 modes also passed again. Neither ordinary run measured gaps.

| Mutation | Ordinary assertion result |
|---|---|
| AP-M28 | Two starts per task: four redraw markers in two Chromium tasks; failed the one-figure-per-task assertion. |
| AP-M29 | Reversed the distance sort: observed `[0, 1, 2, 3]` instead of `[3, 2, 1, 0]`; failed nearest-first order. |
| AP-M30 | Removed generation cancellation: after the newer appearance, observed `[2, 3, 1, 2, 0, 1]` instead of `[3, 2, 1, 0]`; failed the old-queue cancellation assertion. |

Each mutant was built separately from the exact producer checkout with matching generated asset manifests. The browser ran with a 4 096 process cap and the 900 s deadline; each exited 1 on its named assertion, not the deadline. The five installed enhancer variants and both manifests were restored and SHA-256 checked after each run. No producer source or release change is needed for these ordinary rows. The quiet gap row and AP-M31 have no timing verdict yet.

#### Docs tab carry after #3289 (2026-11-25)

Main's Docs tab cases and Wave C's per-skin console rows were retained as separate witnesses. The appearance and open-cost fixtures now mark that they open in the console, rather than letting a direct URL choose a standalone Docs tab. The checked tap-target mount fake survived the merge. Post-carry typecheck exited 0; the four scoped unit files passed 196 tests, and the four ordinary browser files passed 241 tests with one expected failure and 41 skips (rc 0). Both AP-5 modes and the task/queue redraw checks passed on the carried build. The eight unchanged corrected-library console BASE pairs had a 0 px maximum delta. The standalone 412 × 915 Docs tab draws one bar with frame at 48 px and title at 56 px in both skins. Those are Chromium fixture measurements, not F's phone-engine evidence.

#### Corrected desktop timing, attempt 1 (D-9030)

Start and end loads were not captured in the original command. The coordinator measured a load of 9 to 11 during the run. The old harness exited 1 on three ceilings before the validity rule was written; those assertion results are not acceptance verdicts. All eight rows are invalid on BASE spread alone (IQR here uses the seventh minus the third sorted sample). D-9018 therefore has no verdict in any row.

| Arm, skin, round | BASE → candidate median (ms) | Hosted delta or mode-only ratio | BASE IQR (ms) | Validity / verdict |
|---|---:|---:|---:|---|
| Hosted, Refined, 1 | 151.4 → 217.1 | +65.7 ms | 86.6 | Not measured: reference not quiet |
| Hosted, Instrument, 1 | 175.3 → 135.1 | −40.2 ms | 80.4 | Not measured: reference not quiet |
| Hosted, Refined, 2 | 139.7 → 116.7 | −23.0 ms | 72.5 | Not measured: reference not quiet |
| Hosted, Instrument, 2 | 113.0 → 205.5 | +92.5 ms | 90.7 | Not measured: reference not quiet |
| Mode-only, Refined, 1 | 133.9 → 171.5 | 1.281× | 113.6 | Not measured: reference not quiet |
| Mode-only, Instrument, 1 | 134.8 → 132.6 | 0.984× | 105.9 | Not measured: reference not quiet |
| Mode-only, Refined, 2 | 134.8 → 134.9 | 1.001× | 27.3 | Not measured: reference not quiet |
| Mode-only, Instrument, 2 | 203.4 → 192.9 | 0.948× | 122.4 | Not measured: reference not quiet |

At the local build-ahead cut, including the #3289 carry, no further paired attempt started below the D-9030 load threshold. The one-minute load after the final ordinary checks was 6.51. Both hosted skins and both mode-only skins remain unmeasured in rounds 1 and 2. The AP-5 light and dark ceilings, the multi-figure redraw-gap ceiling, and the AP-M27 and AP-M31 delay controls also remain unmeasured; their ordinary counterparts are not timing evidence. A quiet retake and F's phone/pixel checks are separate from this local proof.

Raw samples, in open order, milliseconds displayed to a tenth; the harness log retains full precision:

| Arm, skin, round | BASE samples | Candidate samples |
|---|---|---|
| Hosted, Refined, 1 | 198.1, 119.3, 151.4, 269.4, 199.5, 98.8, 81.6, 176.7, 111.5 | 318.4, 217.1, 320.4, 123.9, 229.7, 146.8, 113.9, 191.0, 243.0 |
| Hosted, Instrument, 1 | 231.5, 252.9, 151.1, 289.0, 131.4, 208.7, 175.3, 135.9, 169.2 | 167.5, 130.0, 135.1, 106.8, 206.0, 153.7, 103.8, 106.0, 150.9 |
| Hosted, Refined, 2 | 88.0, 139.7, 203.4, 207.2, 83.3, 185.9, 115.7, 113.4, 181.6 | 299.3, 173.1, 273.0, 116.7, 103.5, 104.4, 102.5, 144.9, 107.1 |
| Hosted, Instrument, 2 | 216.3, 95.7, 138.1, 108.6, 286.9, 186.4, 113.0, 89.5, 86.1 | 318.6, 205.5, 375.7, 168.2, 151.2, 118.0, 203.0, 220.7, 265.9 |
| Mode-only, Refined, 1 | 94.9, 208.5, 135.9, 564.5, 844.8, 81.1, 83.4, 100.2, 133.9 | 81.3, 171.5, 159.4, 210.8, 123.7, 209.9, 222.2, 150.0, 204.4 |
| Mode-only, Instrument, 1 | 221.6, 189.8, 102.1, 107.6, 94.4, 134.8, 94.4, 208.0, 288.7 | 97.3, 111.7, 109.7, 265.4, 194.8, 132.6, 295.5, 375.5, 123.3 |
| Mode-only, Refined, 2 | 321.8, 135.9, 138.5, 110.5, 111.2, 114.2, 134.8, 190.9, 103.8 | 186.8, 138.5, 134.9, 89.8, 93.8, 153.3, 123.4, 109.7, 143.8 |
| Mode-only, Instrument, 2 | 210.9, 130.4, 115.8, 98.4, 305.2, 270.6, 203.4, 102.8, 238.2 | 122.0, 142.4, 172.5, 237.2, 96.7, 192.9, 204.8, 499.6, 313.5 |

#### D-9030 amended timing, sitting 1 (2026-11-25)

The four scheduled pre-amendment checks (5.81, 4.19, 6.76 and 9.18) started no tests. Under the amendment, sitting 1 ran from 11:50:03 to 11:58:37 UTC, one-minute load 6.87 → 11.15. The opening paired bracket ran at 7.14 → 15.12 (exit 0), the ceiling block passed three selected browser cases, both delay controls hit their intended assertions, and the closing bracket ran at 8.08 → 10.98 (exit 1 on an eligible BASE comparison). Neither bracket was quiet overall. The ceiling passes stand independently of its load.

| Measurement | Start → end load | Reading | Outcome |
|---|---:|---|---|
| AP-5 light | 13.72 → 13.88 | Worst 49.5999 ms (`skin refined → instrument`), ceiling 100 ms | Pass |
| AP-5 dark | 13.88 → 17.63 | Worst 19.5999 ms (`skin refined → instrument`), ceiling 100 ms | Pass |
| Four-figure redraw | 17.63 → 19.02 | Consecutive gaps 49.2, 23.4, 23.2 ms, ceiling 200 ms | Pass |
| AP-M27 | 18.12 → 11.24 | Worst 213.3999 ms (`Follow system → phosphor`), ceiling 100 ms | Intended assertion red |
| AP-M31 | 8.74 → 10.40 | Consecutive gaps 286.9, 22.3, 20.8 ms, ceiling 200 ms | Intended assertion red |

AP-5 logged 41 named transitions in each mode and 41 in AP-M27. In the worst normal light transition, the host stamp, operation send and frame write read 1795607586633.1, 1795607586681.0 and 1795607586682.7 ms; in dark they read 1795607637375.4, 1795607637394.4 and 1795607637395.0 ms. Each control ran with the measured 4 096 process cap and 900 s browser deadline and exited 1 on its named ceiling assertion. AP-M27 delayed the real port send; AP-M31 delayed the second real redraw timer by 250 ms in a scratch producer build with matching manifests. Both inputs were restored and SHA-256 checked before the closing paired run.

| Paired row | Opening BASE → candidate median (ms); BASE IQR (ms); verdict | Closing BASE → candidate median (ms); BASE IQR (ms); verdict |
|---|---|---|
| `hosted:refined:1` | 106.3 → 133.0; IQR 45.8; invalid | 181.6 → 211.2; IQR 23.1; invalid |
| `hosted:instrument:1` | 127.3 → 144.5; IQR 11.4; invalid | 194.7 → 214.6; IQR 10.9; invalid |
| `hosted:refined:2` | 135.4 → 144.2; IQR 27.3; invalid | 191.9 → 228.2; IQR 36.7; invalid |
| `hosted:instrument:2` | 208.9 → 329.0; IQR 273.0; invalid | 176.1 → 204.5; IQR 61.2; invalid |
| `mode-only:refined:1` | 218.0 → 140.4; IQR 40.9; invalid | 101.2 → 105.2; IQR 6.8; **pass** |
| `mode-only:instrument:1` | 95.0 → 96.6; IQR 9.0; **pass** | 95.1 → 107.2; IQR 11.5; **red** |
| `mode-only:refined:2` | 138.5 → 157.6; IQR 33.1; invalid | Not reached |
| `mode-only:instrument:2` | 125.9 → 120.4; IQR 80.9; invalid | Not reached |

Under the rule in force at the sitting, the opening Instrument round 1 reading was an eligible 1.0168× pass. The closing reading also had an eligible BASE, but its 1.1272× exceeded the 1.10× ceiling (107.20 vs 104.61 ms). Both readings were reported immediately for a ruling. Closing also recorded an eligible Refined round 1 pass under that rule. No further timing, optimisation or release action followed the stop before the rule changed.

The second D-9030 amendment sets aside the historical pass/red labels above, not the readings. **No paired row is yet decided.** The three eligible readings carry forward: two for mode-only Instrument round 1 and one for mode-only Refined round 1. The five non-paired results above are final and will not be repeated. BASE and candidate samples already alternated in both brackets with the lead reversed in round two; no sampling-order change was needed.

| Paired row | Opening ratio | Closing ratio | Counted readings | Median counted ratio | Lowest counted BASE → candidate (ms) |
|---|---:|---:|---:|---:|---:|
| `hosted:refined:1` | 1.2512× (excluded) | 1.1630× (excluded) | 0 | — | — |
| `hosted:instrument:1` | 1.1351× (excluded) | 1.1022× (excluded) | 0 | — | — |
| `hosted:refined:2` | 1.0650× (excluded) | 1.1892× (excluded) | 0 | — | — |
| `hosted:instrument:2` | 1.5749× (excluded) | 1.1613× (excluded) | 0 | — | — |
| `mode-only:refined:1` | 0.6440× (excluded) | 1.0395× | 1 | 1.0395× | 101.20 → 105.20 |
| `mode-only:instrument:1` | 1.0168× | 1.1272× | 2 | 1.0720× | 95.00 → 96.60 |
| `mode-only:refined:2` | 1.1379× (excluded) | — | 0 | — | — |
| `mode-only:instrument:2` | 0.9563× (excluded) | — | 0 | — | — |

Raw paired samples, in open order, in milliseconds to a tenth:

| Bracket | Row | BASE samples | Candidate samples |
|---|---|---|---|
| Opening | `hosted:refined:1` | 88.2, 87.6, 106.3, 99.2, 89.1, 231.8, 134.8, 196.0, 134.9 | 118.5, 111.4, 115.5, 119.1, 133.0, 222.0, 176.9, 193.0, 207.5 |
| Opening | `hosted:instrument:1` | 163.6, 130.9, 135.5, 125.9, 124.1, 153.3, 122.7, 127.3, 98.4 | 282.5, 143.8, 281.7, 144.5, 212.1, 139.1, 172.8, 129.1, 143.9 |
| Opening | `hosted:refined:2` | 133.0, 139.2, 137.6, 137.4, 144.6, 135.4, 110.3, 94.0, 82.0 | 198.2, 190.7, 266.1, 113.2, 144.2, 100.7, 152.7, 92.7, 106.5 |
| Opening | `hosted:instrument:2` | 85.5, 108.2, 90.0, 114.7, 208.9, 365.3, 499.7, 381.2, 400.0 | 104.2, 105.6, 101.1, 275.7, 426.3, 390.4, 622.2, 329.0, 374.7 |
| Opening | `mode-only:refined:1` | 312.0, 218.0, 194.5, 223.1, 207.5, 235.4, 250.3, 103.4, 151.9 | 280.0, 210.2, 140.4, 138.2, 296.6, 211.5, 117.5, 124.8, 103.8 |
| Opening | `mode-only:instrument:1` | 95.0, 94.4, 85.3, 97.1, 84.1, 96.2, 101.0, 125.5, 88.1 | 96.6, 84.5, 97.0, 88.1, 88.5, 100.6, 100.5, 96.6, 99.8 |
| Opening | `mode-only:refined:2` | 120.1, 138.5, 153.2, 128.7, 99.3, 222.6, 146.7, 233.2, 113.4 | 98.9, 173.8, 139.8, 152.3, 157.6, 253.4, 133.5, 293.0, 175.1 |
| Opening | `mode-only:instrument:2` | 115.3, 101.3, 125.9, 262.5, 142.3, 182.2, 88.8, 183.7, 90.6 | 119.4, 101.2, 114.2, 193.1, 114.7, 132.2, 120.4, 194.4, 167.4 |
| Closing | `hosted:refined:1` | 208.8, 154.0, 181.8, 183.7, 161.4, 160.6, 155.8, 249.6, 181.6 | 239.8, 205.6, 271.8, 154.9, 211.2, 209.5, 262.3, 201.4, 220.6 |
| Closing | `hosted:instrument:1` | 192.3, 202.0, 146.5, 224.2, 208.9, 202.7, 191.8, 187.3, 194.7 | 214.6, 211.9, 208.3, 249.6, 200.3, 252.0, 280.2, 228.4, 206.6 |
| Closing | `hosted:refined:2` | 215.2, 228.3, 191.9, 140.5, 204.4, 190.4, 227.2, 165.8, 178.5 | 203.2, 228.2, 229.9, 220.5, 306.8, 197.5, 255.8, 309.3, 219.1 |
| Closing | `hosted:instrument:2` | 154.2, 255.3, 176.1, 182.2, 191.9, 299.3, 130.7, 82.6, 109.7 | 204.5, 270.9, 218.3, 211.6, 195.8, 217.2, 135.3, 114.2, 115.2 |
| Closing | `mode-only:refined:1` | 225.6, 98.5, 88.6, 105.3, 103.4, 98.5, 85.6, 109.5, 101.2 | 198.1, 207.0, 95.8, 120.0, 105.8, 102.0, 96.9, 105.2, 90.2 |
| Closing | `mode-only:instrument:1` | 99.7, 106.3, 94.8, 92.5, 93.6, 126.6, 95.1, 94.9, 119.4 | 221.1, 111.8, 97.4, 127.8, 107.2, 102.5, 96.0, 94.1, 112.2 |

#### D-9030 paired timing, sitting 2 (2026-11-25)

The sitting ran from 12:45:13 to 12:48:58 UTC, one-minute load 10.46 → 37.66. The opening bracket logged 9.41 → 37.66 and exited 1: a 90 s wait for the ready witness expired during `mode-only:refined:1`, after all four hosted rows logged. The log does not identify which arm or sample timed out. No mode-only row produced medians. This was not a timing-budget assertion and does not show why the witness was absent. The closing bracket was not run; none of the five settled non-paired cases was repeated.

| Paired row | BASE → candidate median (ms) | BASE IQR (ms) | Reading ratio |
|---|---:|---:|---:|
| `hosted:refined:1` | 245.00 → 286.80 | 81.20 | 1.1706× (excluded) |
| `hosted:instrument:1` | 275.80 → 280.30 | 149.20 | 1.0163× (excluded) |
| `hosted:refined:2` | 204.80 → 233.30 | 81.50 | 1.1392× (excluded) |
| `hosted:instrument:2` | 315.80 → 334.70 | 89.30 | 1.0598× (excluded) |

All four recorded BASE arms missed both bounds. No counted median or ratio changed, and **all eight rows remain undecided**. Raw samples from the four completed rows, in open order, in milliseconds to a tenth:

| Paired row | BASE samples | Candidate samples |
|---|---|---|
| `hosted:refined:1` | 245.0, 207.0, 332.2, 120.6, 290.8, 266.7, 204.9, 235.9, 288.2 | 479.4, 317.9, 301.7, 265.0, 266.6, 286.8, 218.2, 221.9, 314.5 |
| `hosted:instrument:1` | 275.8, 401.3, 311.8, 297.5, 282.3, 112.4, 204.5, 148.3, 128.1 | 396.4, 275.3, 280.3, 514.3, 236.1, 155.3, 195.6, 290.1, 293.0 |
| `hosted:refined:2` | 224.9, 244.0, 162.5, 119.0, 204.8, 317.4, 194.0, 93.3, 291.3 | 303.6, 233.4, 233.3, 106.5, 129.4, 315.2, 188.7, 235.2, 197.5 |
| `hosted:instrument:2` | 315.8, 319.7, 297.9, 393.6, 244.2, 340.0, 211.0, 250.7, 480.6 | 384.6, 294.3, 399.8, 227.4, 334.7, 287.4, 334.7, 491.3, 308.2 |

#### D-9030 final method, sitting 1 of at most 4 (2026-11-25)

The start check was 12.53 at 13:08:54 UTC; the sitting ended at 13:14:24 UTC at 11.68. The browser bracket ran at 11.76 → 11.68 and exited 0 with all 12 rows, 20 pairs apiece. The BASE/BASE control excluded the sitting: three of the four control ratios were outside [0.97, 1.03]. **All eight comparisons remain undecided.** In particular, the below-budget figures in the table are not passes. All decisions used the full-precision receipt, not the displayed rounding.

| Row | Median BASE (ms) | Median paired difference (ms) | Median paired ratio | Outcome |
|---|---:|---:|---:|---|
| `control:opening:refined` | 288.90 | −47.05 | 0.845492× | Outside |
| `control:opening:instrument` | 191.80 | +10.10 | 1.055437× | Outside |
| `hosted:refined:1` | 168.80 | −7.65 | 0.954181× | Not counted |
| `hosted:instrument:1` | 96.35 | +28.80 | 1.344848× | Not counted |
| `hosted:refined:2` | 86.90 | +14.05 | 1.157013× | Not counted |
| `hosted:instrument:2` | 113.45 | +14.85 | 1.146395× | Not counted |
| `mode-only:refined:1` | 104.70 | +1.65 | 1.016526× | Not counted |
| `mode-only:instrument:1` | 91.40 | −2.05 | 0.982281× | Not counted |
| `mode-only:refined:2` | 91.00 | −0.40 | 0.995056× | Not counted |
| `mode-only:instrument:2` | 99.35 | −0.25 | 1.001976× | Not counted |
| `control:closing:refined` | 147.15 | +2.00 | 1.015249× | Within |
| `control:closing:instrument` | 161.45 | −5.60 | 0.969605× | Outside |

Raw pairs are shown in sampling order, always `BASE/second arm` in milliseconds to a tenth, regardless of which arm led:

| Row | Open-to-ready pairs |
|---|---|
| `control:opening:refined` | 202.0/203.6, 399.0/150.6, 290.8/215.9, 318.5/291.5, 220.9/281.4, 143.4/199.6, 318.2/303.4, 224.7/272.0, 317.0/126.1, 255.5/188.4, 230.3/210.5, 197.9/226.9, 186.0/197.1, 396.0/300.4, 317.5/211.2, 291.3/131.8, 402.6/304.9, 277.1/294.2, 393.2/305.5, 287.0/203.2 |
| `control:opening:instrument` | 230.2/352.0, 169.7/198.0, 131.9/219.2, 225.2/93.8, 133.6/138.8, 184.2/134.3, 108.3/104.2, 153.5/199.0, 176.1/206.8, 155.2/135.5, 244.5/301.2, 143.8/208.5, 154.7/131.2, 249.9/189.9, 199.4/287.7, 347.8/308.2, 218.2/233.9, 305.3/170.3, 366.2/309.0, 201.9/216.9 |
| `hosted:refined:1` | 144.9/254.5, 283.9/170.3, 438.8/260.1, 178.5/208.9, 288.6/215.8, 114.5/225.2, 171.2/119.9, 196.6/282.9, 286.6/172.5, 175.7/257.5, 218.3/174.5, 119.8/278.4, 166.4/150.6, 150.9/151.4, 82.5/125.2, 194.2/100.2, 135.7/214.1, 121.5/156.0, 135.2/100.3, 127.1/103.5 |
| `hosted:instrument:1` | 118.1/255.2, 88.4/151.1, 90.6/145.7, 201.8/200.4, 180.9/248.5, 163.8/249.6, 84.5/107.0, 146.7/130.9, 150.4/104.2, 85.7/137.3, 89.4/108.0, 115.0/157.8, 133.4/145.1, 100.1/143.9, 82.7/118.7, 92.7/109.0, 83.1/108.3, 100.0/102.8, 82.8/115.2, 75.9/100.0 |
| `hosted:refined:2` | 83.3/100.2, 81.2/92.5, 86.4/112.5, 80.3/101.8, 93.9/103.1, 89.1/104.0, 97.9/96.0, 80.0/101.9, 89.6/97.2, 83.3/94.1, 107.7/94.5, 87.4/92.8, 81.7/96.5, 90.6/103.9, 82.4/102.6, 83.9/94.0, 83.7/93.6, 95.8/113.6, 92.1/154.8, 105.1/149.5 |
| `hosted:instrument:2` | 134.2/144.8, 102.6/135.7, 141.0/118.1, 102.1/115.5, 112.4/117.9, 109.7/118.0, 100.9/117.2, 112.2/105.3, 94.1/128.5, 87.8/174.4, 135.6/135.7, 146.1/155.2, 114.5/193.3, 128.7/179.7, 128.8/156.4, 163.7/156.7, 91.3/111.5, 126.3/131.5, 96.4/128.8, 115.2/136.8 |
| `mode-only:refined:1` | 110.7/122.2, 144.4/112.7, 108.1/93.6, 134.7/175.3, 128.6/133.8, 95.4/132.6, 79.0/96.8, 84.9/100.9, 102.9/84.2, 106.5/100.3, 100.4/102.3, 86.6/100.9, 90.6/85.1, 119.0/84.4, 117.0/130.4, 93.7/88.3, 107.8/90.7, 107.4/92.2, 84.9/89.2, 99.1/100.5 |
| `mode-only:instrument:1` | 85.4/97.1, 79.1/96.8, 90.0/102.3, 134.0/99.9, 120.1/90.8, 110.3/85.9, 111.9/107.2, 145.0/97.2, 120.7/98.4, 92.5/93.5, 89.7/90.6, 85.5/86.4, 91.4/92.0, 125.1/86.4, 95.5/85.0, 82.5/85.5, 85.9/87.6, 91.4/84.4, 78.0/101.8, 89.9/80.4 |
| `mode-only:refined:2` | 91.1/86.1, 83.3/87.5, 83.4/88.5, 96.6/106.1, 92.3/92.2, 90.9/82.9, 95.7/93.9, 104.2/88.1, 81.0/82.0, 78.7/87.5, 91.4/86.9, 87.4/88.9, 79.5/78.8, 92.1/95.9, 85.5/85.6, 96.3/83.5, 77.3/91.1, 94.7/85.0, 92.8/84.1, 87.1/80.8 |
| `mode-only:instrument:2` | 82.2/78.4, 78.2/91.0, 82.9/87.7, 88.3/84.7, 88.8/92.9, 99.9/82.3, 82.6/83.8, 75.6/95.6, 98.8/86.0, 116.1/87.7, 93.3/96.7, 91.5/94.4, 122.5/124.0, 195.5/152.5, 205.0/203.3, 195.3/211.7, 100.2/195.5, 141.2/116.8, 195.1/154.0, 207.3/197.2 |
| `control:closing:refined` | 174.5/182.6, 159.9/169.4, 124.7/126.6, 137.6/139.7, 147.8/174.3, 176.5/150.8, 141.9/130.4, 90.7/121.7, 111.6/126.5, 179.4/107.3, 130.1/129.3, 146.5/222.5, 154.0/149.8, 150.9/145.1, 171.6/142.2, 115.4/112.6, 231.7/413.3, 158.9/131.6, 130.1/137.5, 137.7/520.7 |
| `control:closing:instrument` | 709.6/289.1, 292.9/220.2, 110.7/1618.9, 162.1/127.8, 118.7/147.5, 157.2/119.6, 136.2/142.1, 123.7/494.9, 297.3/294.5, 309.1/494.9, 706.0/288.9, 142.2/226.7, 213.7/197.4, 213.7/206.2, 225.9/203.5, 186.3/195.9, 119.7/145.9, 142.6/132.5, 144.0/140.3, 160.8/120.1 |

#### D-9030 final method, sitting 2 of at most 4 (2026-11-25)

The start check was 8.99 at 14:01:27 UTC; the sitting ended at 14:04:52 UTC at 14.56. The browser bracket ran at 9.44 → 14.56 and exited 1. The candidate arm of pair 9 in `hosted:instrument:1` hit the 90 s ready-witness timeout after eight complete pairs. Both opening controls were within range, but neither closing control ran. The timeout excludes this sitting: **all eight comparisons remain undecided**. The completed hosted Refined row is evidence only; the load observations do not establish the cause of the timeout.

| Completed row | Median BASE (ms) | Median paired difference (ms) | Median paired ratio | Outcome |
|---|---:|---:|---:|---|
| `control:opening:refined` | 96.75 | +1.10 | 1.011476× | Within |
| `control:opening:instrument` | 89.05 | +1.15 | 1.013338× | Within |
| `hosted:refined:1` | 116.00 | +24.05 | 1.165747× | Not counted |

Completed pairs, in sampling order (`BASE/second arm`, milliseconds to a tenth). The interrupted row has no 20-pair statistic.

| Row | Open-to-ready pairs |
|---|---|
| `control:opening:refined` | 92.9/87.9, 96.3/99.6, 97.5/105.6, 83.4/142.5, 116.1/98.9, 144.7/86.7, 108.0/122.6, 85.5/92.9, 86.7/130.2, 84.3/81.4, 87.4/81.0, 97.2/96.1, 112.8/111.1, 103.3/127.8, 127.9/103.6, 264.3/95.5, 182.1/146.9, 90.0/102.4, 87.7/104.0, 84.0/94.8 |
| `control:opening:instrument` | 115.1/81.1, 94.9/87.6, 86.1/88.3, 91.5/94.2, 105.1/78.3, 89.0/89.1, 130.8/109.6, 88.9/98.5, 79.6/122.0, 76.9/79.2, 181.6/96.3, 81.7/92.4, 92.6/90.9, 75.1/116.2, 82.1/79.7, 77.0/81.0, 81.6/84.3, 104.1/111.3, 89.1/78.6, 91.1/81.7 |
| `hosted:refined:1` | 113.5/93.7, 95.6/104.6, 106.8/134.3, 108.1/194.7, 82.2/144.6, 108.4/120.6, 118.5/135.9, 101.3/204.7, 137.9/133.2, 89.8/175.9, 94.3/217.9, 128.0/94.2, 107.9/204.5, 212.2/155.1, 279.5/301.6, 140.8/166.8, 311.8/198.7, 269.3/174.4, 137.2/413.9, 148.2/198.9 |
| `hosted:instrument:1` | 514.9/418.4, 216.7/572.5, 299.9/494.4, 397.3/6785.1, 393.5/587.0, 372.4/487.8, 494.9/688.7, 687.2/499.5 |

#### D-9030 final method, sitting 3 of at most 4 (2026-11-25)

The start check was 9.59 at 14:52:41 UTC; the sitting ended at 14:56:15 UTC at 12.71. The browser bracket ran at 8.29 → 12.71 and exited 1. The candidate arm of pair 5 in `mode-only:refined:1` hit the 90 s ready-witness timeout after four complete pairs. Both opening controls were within range, but neither closing control ran. The timeout excludes this sitting: **all eight comparisons remain undecided**. All four hosted rows completed, but their below-budget figures are evidence only, not passes. The cause of the timeout was not established.

| Completed row | Median BASE (ms) | Median paired difference (ms) | Median paired ratio | Outcome |
|---|---:|---:|---:|---|
| `control:opening:refined` | 95.65 | −0.50 | 1.000598× | Within |
| `control:opening:instrument` | 80.05 | +1.00 | 1.011291× | Within |
| `hosted:refined:1` | 82.80 | +15.50 | 1.176311× | Not counted |
| `hosted:instrument:1` | 85.30 | +15.85 | 1.171510× | Not counted |
| `hosted:refined:2` | 90.70 | +14.20 | 1.170265× | Not counted |
| `hosted:instrument:2` | 101.50 | +15.00 | 1.133921× | Not counted |

Completed pairs in sampling order (`BASE/second arm`, milliseconds to a tenth). The interrupted row has no 20-pair statistic.

| Row | Open-to-ready pairs |
|---|---|
| `control:opening:refined` | 122.8/129.0, 114.2/120.4, 116.2/112.8, 79.6/117.1, 132.7/122.7, 94.9/114.5, 97.6/109.2, 115.2/97.2, 106.9/93.0, 96.4/149.3, 141.9/89.7, 78.8/81.2, 89.3/85.1, 92.3/78.8, 88.9/103.7, 91.9/77.8, 73.3/104.0, 75.7/86.6, 93.7/89.2, 98.9/81.1 |
| `control:opening:instrument` | 76.6/90.8, 78.8/77.3, 79.9/76.3, 79.3/84.5, 79.1/75.7, 79.4/91.5, 76.7/85.8, 86.8/79.0, 78.6/85.8, 74.3/81.1, 116.0/93.4, 85.5/78.8, 86.0/81.4, 84.3/80.1, 84.1/87.6, 81.7/79.6, 76.7/88.5, 80.2/85.4, 107.3/79.6, 81.3/88.0 |
| `hosted:refined:1` | 109.9/100.1, 80.4/99.3, 81.4/102.9, 82.7/97.2, 77.0/105.0, 86.9/92.4, 99.2/101.8, 85.4/109.7, 87.8/96.7, 81.7/94.1, 79.8/97.2, 82.9/104.1, 86.3/101.6, 102.2/120.0, 120.4/100.8, 82.1/102.9, 78.3/94.0, 85.3/94.9, 81.2/94.9, 76.1/105.4 |
| `hosted:instrument:1` | 89.1/106.2, 113.6/130.4, 85.1/95.0, 80.0/105.0, 85.9/92.5, 84.8/103.7, 78.6/97.0, 100.4/127.2, 108.3/102.9, 80.0/93.5, 91.6/100.7, 87.1/89.7, 83.5/94.0, 79.5/109.1, 133.2/104.0, 81.0/106.1, 80.1/103.5, 76.1/107.8, 85.5/100.4, 119.7/95.5 |
| `hosted:refined:2` | 90.3/105.5, 88.3/94.2, 105.2/106.9, 97.5/174.4, 80.1/106.3, 108.8/121.6, 88.2/103.8, 185.7/101.4, 91.1/99.8, 92.3/126.8, 81.9/101.8, 82.6/182.9, 96.6/150.9, 85.5/95.9, 81.5/95.9, 115.6/95.2, 82.0/143.8, 106.8/98.9, 94.2/99.1, 81.3/95.3 |
| `hosted:instrument:2` | 167.9/101.0, 85.3/120.5, 100.0/96.9, 79.9/113.3, 84.7/93.9, 94.4/97.2, 103.1/157.1, 123.3/107.3, 114.4/100.8, 83.6/121.4, 103.0/119.4, 84.5/160.8, 75.9/114.2, 87.0/147.1, 91.7/183.2, 128.0/141.6, 146.7/114.9, 121.8/216.8, 163.8/146.7, 164.0/122.2 |
| `mode-only:refined:1` | 84.1/103.3, 104.4/111.9, 92.1/80.7, 138.1/187.5 |

#### D-9030 final method, sitting 4 of 4 (2026-11-25)

The start check was 8.10 at 15:43:25 UTC; the sitting ended at 15:47:10 UTC at 14.87. The browser bracket ran at 9.03 → 14.87 and completed all 240 pairs (exit 0). Three of four BASE/BASE controls were outside the inclusive [0.97, 1.03] band. The opening Instrument control was below the band at 0.9679959724328056×; rounding to two decimal places would hide the miss. The four hosted figures were below 30 ms, and the mode-only Instrument round-two figure was above 1.10×, but neither is a timing verdict without valid controls.

**All eight comparisons remained undecided at the initial four-sitting cap.** Sittings 1 and 4 completed with out-of-band controls; sittings 2 and 3 ended at the ready wait without closing controls. The separate live-follow and redraw results are unchanged.

| Completed row | Median BASE (ms) | Median paired difference (ms) | Median paired ratio | Outcome |
|---|---:|---:|---:|---|
| `control:opening:refined` | 92.20 | +1.85 | 1.019391× | Within |
| `control:opening:instrument` | 101.65 | −2.80 | 0.967996× | Outside |
| `hosted:refined:1` | 100.65 | +17.70 | 1.183288× | Not counted |
| `hosted:instrument:1` | 96.35 | +20.55 | 1.220365× | Not counted |
| `hosted:refined:2` | 86.20 | +17.75 | 1.205767× | Not counted |
| `hosted:instrument:2` | 84.40 | +16.60 | 1.204474× | Not counted |
| `mode-only:refined:1` | 87.20 | +0.25 | 1.002860× | Not counted |
| `mode-only:instrument:1` | 80.30 | +0.25 | 1.003176× | Not counted |
| `mode-only:refined:2` | 82.25 | +2.20 | 1.026554× | Not counted |
| `mode-only:instrument:2` | 84.45 | +8.95 | 1.111888× | Not counted |
| `control:closing:refined` | 83.30 | +5.60 | 1.067639× | Outside |
| `control:closing:instrument` | 87.35 | −3.30 | 0.960134× | Outside |

Completed pairs in sampling order (`BASE/second arm`, milliseconds to a tenth).

| Row | Open-to-ready pairs |
|---|---|
| `control:opening:refined` | 98.8/100.6, 99.1/85.3, 83.5/170.1, 83.6/89.6, 89.3/86.8, 83.3/80.5, 83.9/93.0, 85.2/91.6, 91.3/90.0, 92.9/90.2, 89.2/144.5, 123.6/133.9, 135.9/135.8, 145.3/111.7, 92.0/116.5, 92.4/94.3, 89.1/100.6, 120.4/101.9, 106.9/121.0, 150.9/112.0 |
| `control:opening:instrument` | 127.4/107.4, 150.6/138.4, 120.5/95.6, 157.1/129.5, 147.5/201.6, 104.6/324.2, 98.7/187.4, 127.9/115.8, 170.7/157.9, 114.4/163.1, 88.1/80.7, 98.0/79.1, 123.7/81.3, 87.8/83.1, 85.4/87.5, 85.9/85.0, 81.3/84.0, 82.0/81.8, 83.6/93.4, 83.5/99.0 |
| `hosted:refined:1` | 92.0/110.0, 87.9/107.5, 92.5/103.3, 76.6/99.8, 100.0/121.9, 101.3/137.9, 88.6/110.5, 112.2/116.2, 99.4/126.6, 136.8/106.8, 111.5/116.0, 84.9/130.3, 271.0/132.7, 94.8/100.5, 104.2/198.6, 110.5/108.2, 101.8/119.2, 107.3/109.5, 86.1/111.3, 108.3/116.8 |
| `hosted:instrument:1` | 106.8/112.3, 83.4/102.0, 112.5/107.2, 78.2/117.6, 88.9/128.0, 119.7/113.4, 106.2/113.1, 90.8/126.0, 109.2/129.4, 82.4/173.7, 123.0/100.9, 79.2/91.6, 104.0/166.6, 96.0/116.9, 96.7/112.4, 95.0/113.4, 92.7/120.6, 108.1/184.2, 98.1/186.5, 79.2/136.8 |
| `hosted:refined:2` | 89.6/192.6, 99.2/126.6, 100.0/106.5, 121.0/137.7, 86.0/102.8, 82.8/104.2, 94.3/103.3, 75.8/106.6, 126.1/102.6, 92.5/102.8, 90.3/98.9, 81.8/108.5, 83.8/113.9, 79.1/132.7, 79.8/100.6, 81.4/96.0, 86.5/105.2, 86.4/98.5, 82.2/142.5, 79.6/93.5 |
| `hosted:instrument:2` | 87.7/102.8, 77.6/107.2, 84.7/100.2, 95.5/97.0, 79.3/99.9, 114.7/152.3, 81.8/119.9, 90.5/99.6, 74.9/116.1, 84.1/101.2, 102.5/101.2, 87.1/93.5, 77.8/98.4, 101.2/108.8, 82.9/100.8, 78.3/94.4, 90.8/126.2, 81.9/113.0, 85.3/97.2, 80.5/96.5 |
| `mode-only:refined:1` | 100.8/78.6, 126.4/79.4, 87.0/77.3, 85.1/92.6, 82.1/75.3, 97.9/81.5, 77.9/93.8, 81.2/79.7, 89.5/78.6, 87.4/87.9, 83.5/83.5, 74.1/83.9, 95.5/90.2, 84.4/88.5, 85.1/87.5, 84.0/103.2, 123.8/135.0, 127.7/120.8, 98.7/118.0, 94.0/103.7 |
| `mode-only:instrument:1` | 78.5/78.4, 80.9/81.8, 83.2/77.1, 84.3/80.3, 99.8/82.4, 78.3/89.2, 78.1/78.7, 86.4/80.7, 81.9/130.9, 80.2/79.3, 79.9/80.6, 80.8/82.3, 82.9/78.1, 126.8/78.6, 78.7/79.3, 80.0/78.0, 80.4/102.0, 77.7/84.6, 75.4/87.2, 78.6/78.5 |
| `mode-only:refined:2` | 75.6/83.1, 79.7/89.2, 80.3/82.3, 80.5/91.8, 82.1/85.1, 89.2/87.7, 87.4/82.7, 81.2/104.5, 82.8/79.0, 83.6/79.2, 198.7/85.8, 97.9/84.9, 80.3/85.3, 85.1/87.5, 82.1/86.4, 82.7/73.9, 86.9/88.3, 80.3/98.1, 80.2/83.9, 82.4/82.9 |
| `mode-only:instrument:2` | 78.5/87.9, 89.7/87.9, 76.9/84.9, 85.6/115.6, 101.6/89.3, 101.1/79.7, 83.5/90.2, 92.9/122.3, 78.5/102.8, 82.7/83.0, 85.9/97.1, 74.5/117.0, 82.1/137.8, 85.5/110.4, 82.0/106.9, 75.7/118.1, 119.6/128.1, 85.4/77.6, 101.5/85.6, 82.3/75.2 |
| `control:closing:refined` | 83.1/85.7, 75.3/91.8, 117.6/119.2, 79.7/87.5, 164.5/106.0, 169.6/140.0, 82.0/91.1, 92.8/78.4, 83.5/89.8, 79.0/113.2, 80.4/137.0, 78.7/86.0, 82.2/137.9, 84.7/83.2, 130.3/88.3, 82.4/97.2, 81.9/86.8, 154.3/79.4, 125.1/89.5, 106.9/132.9 |
| `control:closing:instrument` | 148.0/207.1, 88.5/88.2, 114.9/107.3, 218.9/170.6, 83.7/123.6, 86.2/101.7, 79.3/130.9, 83.0/75.3, 84.3/76.5, 78.3/83.0, 90.0/76.2, 103.9/81.7, 85.8/100.5, 72.9/74.8, 89.5/93.7, 126.7/76.4, 83.3/78.7, 137.1/88.6, 81.6/79.6, 126.3/78.8 |

#### D-9030 close-out disposition (2026-11-25)

None of the four final-form sittings counted: two ended at the ready wait and two completed with controls outside [0.97, 1.03]. **All eight comparisons are undecided, not passed and not red.** They no longer hold Wave C and carry to programme acceptance. At close-out, take the same eight rows and four BASE/BASE controls again in the same form and apply the same verdict rules before calling the programme done.

Sitting 4 is evidence only and decides nothing. The four hosted rows were 16.60–20.55 ms over BASE against the 30 ms budget, while the BASE/BASE controls' median paired differences were at most 5.60 ms in absolute value. Three mode-only ratios were 1.003–1.027×; Instrument round two was 1.112× against 1.10×, in a sitting whose Instrument closing control was 0.960×. The coordinator will flag that comparison to the reviewer.

While waiting for publication, D-9030 permits at most eight timer checks at least 90 minutes apart and at most four more sittings, with a preflight of 6 or under. The sampling and verdict rules are unchanged, as is the publication and final-pin hold.

#### D-9030 publication wait, check 1 of 8 and optional sitting 1 of 4 (2026-11-25)

The one-minute preflight was 5.27 at 17:22:06 UTC. The sitting started at 17:22:18 UTC, with an opening bracket load of 5.04, and ended at 17:25:15 UTC at a process endpoint load of 16.35. The test runner exited 1 after its worker received `SIGKILL`. There was no ready-timeout record, closing bracket load, or closing control. The last completed comparison was mode-only Refined round one; the interrupted pair and arm, and the cause of the signal, were not established. This uses one optional sitting but is not counted. **All eight comparisons remain undecided.**

| Completed row | Median BASE (ms) | Median paired difference (ms) | Median paired ratio | Outcome |
|---|---:|---:|---:|---|
| `control:opening:refined` | 79.70 | +0.90 | 1.011513× | Within |
| `control:opening:instrument` | 83.25 | −0.55 | 0.993007× | Within |
| `hosted:refined:1` | 80.90 | +17.55 | 1.224925× | Not counted |
| `hosted:instrument:1` | 81.55 | +16.20 | 1.214072× | Not counted |
| `hosted:refined:2` | 86.00 | +14.30 | 1.162276× | Not counted |
| `hosted:instrument:2` | 94.55 | +16.30 | 1.186129× | Not counted |
| `mode-only:refined:1` | 139.40 | −5.75 | 0.932133× | Not counted |

Completed pairs in sampling order (`BASE/second arm`, milliseconds to a tenth).

| Row | Open-to-ready pairs |
|---|---|
| `control:opening:refined` | 83.6/85.1, 76.0/80.1, 78.7/79.1, 79.5/79.3, 79.9/78.3, 93.6/83.2, 76.7/74.1, 77.3/74.1, 74.1/84.3, 77.3/80.0, 81.1/75.0, 74.9/77.0, 75.4/76.8, 81.3/77.4, 80.2/72.8, 85.7/89.1, 93.6/92.4, 83.1/106.4, 80.2/83.8, 78.3/94.4 |
| `control:opening:instrument` | 87.3/78.3, 78.7/78.2, 79.5/90.4, 80.3/78.8, 83.0/78.7, 79.4/85.1, 83.6/78.5, 87.7/79.7, 98.6/83.0, 76.5/80.2, 84.2/78.0, 83.5/81.8, 87.5/90.5, 76.3/81.5, 78.1/80.3, 78.6/78.0, 83.7/104.5, 78.8/88.1, 97.6/90.6, 92.3/102.3 |
| `hosted:refined:1` | 86.2/106.3, 80.4/98.3, 95.9/104.0, 83.1/95.6, 76.7/95.3, 86.6/99.9, 82.2/99.0, 76.5/95.0, 77.1/97.1, 74.2/95.4, 78.7/93.9, 80.6/91.2, 81.2/101.9, 81.4/101.7, 87.6/93.5, 74.4/93.0, 82.3/90.8, 73.8/92.4, 89.4/88.6, 75.7/92.9 |
| `hosted:instrument:1` | 74.8/89.3, 90.8/90.0, 75.3/98.3, 74.5/96.8, 77.2/98.7, 84.2/89.7, 73.0/92.7, 86.4/96.4, 78.2/88.7, 76.4/94.3, 88.5/124.9, 123.8/93.9, 96.2/105.9, 89.3/113.6, 81.4/95.8, 106.5/103.6, 81.7/102.5, 81.2/109.5, 85.2/98.9, 80.5/99.6 |
| `hosted:refined:2` | 82.7/94.8, 84.4/98.3, 85.7/99.4, 94.3/109.0, 79.2/96.6, 86.0/107.5, 77.5/92.8, 117.6/99.4, 91.8/100.7, 92.6/112.6, 83.9/101.8, 96.7/109.2, 82.2/104.4, 79.9/104.5, 89.6/99.1, 87.5/103.0, 91.6/95.4, 86.0/96.8, 83.9/109.2, 89.5/102.8 |
| `hosted:instrument:2` | 84.9/116.8, 93.0/102.5, 96.4/108.7, 89.1/127.2, 82.8/113.8, 89.4/100.1, 109.0/109.2, 97.6/99.2, 102.0/110.5, 89.1/121.7, 83.8/99.3, 91.3/108.4, 96.8/111.7, 93.3/101.5, 91.7/103.2, 142.4/292.9, 95.8/116.7, 210.8/427.5, 222.8/401.3, 130.6/390.2 |
| `mode-only:refined:1` | 210.7/220.5, 155.6/300.6, 198.3/164.1, 226.2/99.8, 193.1/480.7, 176.8/225.8, 176.6/120.8, 117.0/88.8, 103.4/90.1, 100.5/114.6, 117.8/86.5, 84.0/84.1, 81.7/76.6, 78.7/79.3, 87.3/80.9, 130.6/93.2, 299.2/138.9, 148.2/184.6, 201.2/176.9, 85.7/130.5 |

#### D-9030 publication wait, final optional totals (2026-11-26)

Eight one-minute load checks yielded 5.27, 14.90, 8.75, 28.27, 13.09, 11.20, 22.20 and 8.75, in order. The final check at 04:05:31 UTC was above 6, so no browser started. Only the first check qualified. Its interrupted run was the only optional sitting and did not count: **eight checks, one sitting, zero counted**. No further optional check or sitting is planned. All eight comparisons remain undecided, not passed and not red; they carry to programme acceptance under the unchanged method and no longer hold Wave C. The separate publication and final-pin hold remains.

#### Wave C local main absorption (2026-11-26)

- Merged `86a8c90390fda4cc388c07bb5b3342adf610a1bc` once, locally, at `5081e50dc0fa4335a5aecf9fc2fe83b1c4d92b67`. The only conflict was the rich-reader spec's M8.10 row: the resolution keeps main's review-page guard clause and Wave C's package rename. Main's PDF dependency (`pdfjs-dist` 6.5.438) stays intact; the committed reader pin is still `@synapsium-labs/docserver` 1.1.0. The corrected `@synapsium-labs/pinax-lib` 1.2.0 candidate remains installed unsaved.
- The new offered-command guard reproduced one failure (five other checks passed): Wave C's static Aa label was read as a CLI verb. Ask 594 fixes those words. A separate test-only commit, `2baae355cdcedbef12cfbe4d7b016d80faab5653`, adds the documented allowance for that sentence, not for the word everywhere. The guard then passed all six checks. No label or scan rule changed.
- The first preflight measured a one-minute load of 18.90; no browser started. At the next wake, both AP-3 cases passed in one isolated built-PWA run (light over stale dark and Phosphor over stale light), with one-minute load 5.52 → 4.51. The first-ready mismatch did not reproduce; its cause is unestablished.
- AP-1/2 passed its complete palette and skin matrix in a separate one-worker run, with one-minute load 4.31 → 15.17. The test exited 0 without a ready timeout; the wrapper separately reported five kills in the shared test slice during the run, not which processes were killed. The case passed even as load rose, but this is not an unloaded bracket and does not establish why the earlier timeout happened. No AP code, assertion or timeout changed.
- The first typecheck and scoped unit attempts did not start: both foreground waits expired in the test queue. On the next wake the one-minute load was 20.91, so no browser was started. The test wrapper's remote route refused the combined command's multiline argument and the wrapper itself fell back to the local queue. The slot opened after 493 seconds. The PWA typecheck exited 0; the scoped unit run printed the five expected held-pin failures but was cut off by the outer deadline (exit 124) before it printed a suite summary. That invocation produced no scoped-suite verdict. After the coordinator cleared the refusal, a separate invocation with the package runner named directly finished at `2baae355cdcedbef12cfbe4d7b016d80faab5653`: **2,327 passed, five failed** across eight files, with no type errors (exit 1). Only the five deliberately held checks in `reader-pin` failed: manifest, lock, installed version, asset manifest version and pinned hashes. No paired timing was retaken.

#### Published 1.2.0: final pin verification (2026-11-26)

- The final local merge took `595d9c5c0f9e1b4721c184a50bb65425678865de` at `a58175327b3274327e3b95cd143130e7e352aa74`. The sentence allowance remains intact. Tag `v1.2.0` is the annotated object `4f47315a512f5438b686ed67f6494181f1ca5dcf` on the corrected producer commit `59d4d18a98e14b9edc6fbe9f64d3d39793347502`. GitHub did not recognize the SSH key. Against the producer's release signers file on `main`, SSH verification exited 0: `Good "git" signature for release-signer with ED25519 key SHA256:+t7W33ECSXbsX0w4muCbYQ5o1Xvp23h9VMJHmnBv8nU`.
- Registry SRI: `sha512-V4QhSgY5HwSQ/yhy2G/I6VB9gO/3LEGrv+bJUd+6+E7dnaBEqWCK4iXN309h+7G7y/T5N1JEhI26tO29hFkJ4g==`. Registry tarball SHA-256: `c8cfafcf0537a642d0d87d0f1f6d1e254e2880f56b1691d269bc1cbf32b39d8b`. The packed bytes match the lock's integrity and verify against the producer's release workflow at `refs/tags/v1.2.0`, with the provenance script unchanged. The clean lockfile install replaced the unsaved candidate. Installed `assets/assets.json` SHA-256: `179a330da49ad4fefc8ba51a00f6f0eb0da9464c0868178fe18a7150d430dfa9`; it also compared byte-for-byte with the tested candidate's manifest. `npm audit signatures` exited 0: 1,224 verified registry signatures and 327 verified attestations.
- Offered-command guard: 6/6 after the merge. The first registry-pin scoped run passed 2,335 cases, including all five previously held pin cases, and failed one incoming warm-cache planted control. The fixture planted the retired package name while the scanner looks for the renamed package. Re-anchoring the fixture to the current specifier, without changing its assertion or the scan, gave **2,336/2,336** across eight files with no type errors. The separate PWA compile check exited 0.
- The five-file ordinary Chromium gate has no verdict yet. A wrong-package startup did not run any cases. The two corrected attempts reached the sealed PWA build but ran out of the foreground deadline before a browser summary (both exit 124); the second also reported five kills in the shared test slice. No individual browser case is declared red on those receipts. Firefox, phone-device evidence and the eight paired timing comparisons remain unmeasured here; paired timing stays with programme acceptance.
- The subsequent file-alone appearance run on the committed pin `b043177988174c318954e555070ce146ef3cc3dc` completed with **27 passed, one failed** (exit 1; one-minute load 12.32 → 15.98). AP-3 Phosphor over stale Light reported `expected undefined to deeply equal { scheme: 'dark', colour: { …(33) } }`: the first-ready witness was absent, not a measured wrong palette. This is an isolated-file assertion failure, not a no-summary attempt. Stopped before the other browser files or a push; the cause is not established.
- AP-3 diagnosis took the pre-document capture branch: the test awaits the browser context's init script before navigating. The child document runs that script before its own scripts, and the host transfers the port after the iframe's first load. A send before instrumentation would be lost, but the documented ordering shows no late-attachment window. An absent witness does not distinguish a missing hook, a missed send, or a missing sample root. Two unchanged Phosphor case runs, each alone, passed at one-minute loads 19.02 → 19.14 and 18.81 → 19.94.
- Test-only failure evidence now distinguishes hook installation, the first observed frame send and its seed and message appearance fields, host admission, and fallback relative to the first observed mount. The expected appearance and wait remain unchanged. Five further isolated Phosphor runs passed at one-minute loads 17.45 → 17.98, 17.58 → 17.34, 17.34 → 16.87, 16.96 → 17.84, and 17.62 → 17.46. There is no new failing trace, no product fix, and no explanation established for either the earlier first-ready mismatch or the AP-1/2 timeouts. The diagnostics are retained to identify the missing step if the failure returns.
- On the diagnostic-only commit `519625ae55d85ab841de8f3b7ee8c6506b56d6c7`, the whole appearance file passed **28/28** (one-minute load 20.67 → 22.90), reader frame **61/61** (22.70 → 23.93), and reader history **12/12** (23.45 → 24.34), one file per run. The first two runs reported shared-slice kills but each returned a passing test summary and exit 0. The earlier AP-3 failure remains unexplained, not cleared by the green rerun.
- The compact-header file alone passed 140 and failed one (load 23.91 → 31.99, exit 1). The GitHub-refusal case for Instrument at 600 × 960 under a mouse (F1) reported `TimeoutError: page.waitForFunction: Timeout 30000ms exceeded.` It did not observe the disabled GitHub action in the desk head before the first wait ended; the later Export and geometry checks were not reached in that case. This is a completed file failure, not an outer timeout with no summary. Its cause is unestablished. Stopped before the remaining frame-cost file and before any push. The wave changes hosted reader appearance and other compact-header checks, but not this case's fixture or selector, the desk header's disabled GitHub action, or the definition of Instrument.
- The one ruled isolated F1 retry passed (one passed, 140 skipped; one-minute load 20.41 → 21.31). The original 30 s wait expiry remains unattributed: an isolated pass does not show that load caused it. The temporary failure-only page receipt did not run on the pass and was removed. The frame-cost file was **not measured locally at the registry pin**; the hosted run will check its ordinary rows, and the eight paired timing rows stay with programme acceptance.
