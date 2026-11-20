# Native Docs reader: reader mode (X6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task, under the dispatched `ccrc-worker` role. XR1 and XR2 are each their own run, dispatched by the coordinator; one worker never executes more than its wave. The library landing LX6 is the library programme's, built in its own repository. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Reader mode button that takes the open Docs page full screen, Kindle-like: only the text, turned one screen at a time, with a minimal overlay, one Back model and the place kept.

**Architecture:** ccrc owns the view: a reading container around the Docs screen's body that draws a fill over the console and asks for element full screen on itself, an overlay, a history place through X2's popstate dispatcher, and a screen wake lock (XR1, on library 1.1.0, entering by a remount with the reader's chrome off). The library adds screen pages, in-place reading chrome, a text size and one `reader` op each way on the existing port (LX6). XR2 adopts that release and drops the remount.

**Tech Stack:** TypeScript, React 19, the existing `@ccrc/ui` sheet primitive (vaul), the Fullscreen and Screen Wake Lock APIs, package-local vitest, the existing `browser (pwa)` leg (Playwright-driven Chrome), `@synapsium-labs/docserver` 1.1.0 until XR2 adopts the release carrying LX6.

**Spec:** `docs/superpowers/specs/2026-11-20-native-docs-reader-mode-design.md` (read it with this plan). Also the rich-docs spec `2026-10-12-rich-docs-reader-and-shared-renderer-design.md` §4.1, §4.4 and §5; X1's spec `2026-11-18-native-docs-appearance-continuity-design.md` §2, §6 and §10 (test 8, test 9); X2's spec `2026-11-18-native-docs-parity-design.md` §4.7 and its plan's Task P5.3; the completion plan `2026-11-07-native-docs-reader-completion.md` (Global Constraints, Task 17).

**Status:** 2026-11-20, X6 design wave (run 2847). No implementation is claimed by this document. Run ids and deviation blocks for XR1 and XR2 are issued when each opens.

## Global Constraints

- Reader frame sandbox exactly `allow-scripts`; no `allow`, no `allowfullscreen` on it; shell CSP meta exactly `frame-src 'none'`; no parent-DOM access by any frame; no extra message channel; no window `message` listener anywhere in `pwa/src`; never `allow-modals`.
- `@synapsium-labs/docserver` exactly 1.1.0 until a reviewed release is adopted by exact pin, with provenance, `npm audit signatures` and the import list (rich-docs §4.7). No library repository edit from a ccrc wave.
- Both 2026-11-06 phone blocks byte for byte; production Mermaid stays on request (`E17-READING does-not-hold`).
- Tap floor `--tap-min` 44 px; the one bar 44 px tall, its title at most 61 px down with at most 48 px of it the console's (`docs-compact-head.browser.test.ts`: `TAP = 44`, `ONE_BAR_TITLE_MAX = 61`, `CONSOLE_PART_MAX = 48`); the desktop head at most 80 px (`HEAD_MAX`) and its row on one line, at 1280 by 800.
- Reader mode's values, each one constant in `pwa/src/docs/reader/readerMode.ts`: `READER_WAKE_IDLE_MS = 300000`; `READER_TOP_BAND_PX = 44` (XR1's host strip). The layer token `--z-reading: 70` in `ui/src/styles/tokens.css`, between `--z-toast` (60) and `--z-block` (100).
- No new `popstate` listener (X2's `lib/popstate.ts` is the only one), no new window `keydown` listener (the command registry), no second progress mechanism (`readerBar.ts#createReaderProgress`).
- Fixture HOMEs only where a fixture spawns tools; `ccrc test -- <command>` for every test and typecheck, foreground, timeout at least 600000 ms; mutation runs through the coordinator's mutation runner, scratch outside the worktree.
- Public repository: neutral names only; private-name scan of every changed file and every commit message before each push.
- Each wave opens with its own run and issued deviation block; a departure found mid-wave is `D-TBD-<slug>` and reported.
- Ownership against the sibling waves: X1's host wave owns the reader's prefs and appearance; X2's P5.3 owns `lib/popstate.ts`, `lib/historyPlaces.ts` and `docs/reader/places.ts`, which XR1 extends by one place kind after P5.3 merges; X2's P6 and P5 edit `ReaderFrame.tsx`, `DocsHead.tsx`, `docs.css` and `reader/{bridge,policy}.ts`, so XR1 and XR2 claim those files only while no X1 or X2 wave holds them.

## Review Focus

- The browser leaves full screen while a sheet raised from the frame is open (the external-link sheet in reader mode): reader mode ends once, the sheet stays open and usable in the normal view, and nothing is left in the hidden portal target. Owned by Task XR1.2 (`reader mode: losing full screen with a sheet open keeps the sheet usable`).
- The frame falls back to the plain view while reader mode is on (the reading remount's watchdog): reader mode ends, the fallback note shows, and the reader place is consumed, so the next Back leaves the doc and is not spent on a dead place. Owned by Task XR1.4 (`reader mode: a fallback after entering ends reader mode and consumes its place`).
- Esc or the browser's exit and a Back land together (Android Back in full screen, a double press): exactly one exit, at most one history step, the doc still shown. Owned by Task XR1.3 (`reader place: fullscreenchange and popstate in either order exit once`).
- The page is hidden and shown again (a tab switch, the phone locked) while reading: the wake lock is requested again on return if reader mode is still on; if the browser dropped full screen on the way, reader mode has ended once and the wake lock is released. Owned by Task XR1.2 (`wake lock: re-requested on visible, released when reader mode ended while hidden`).
- A rotation or a resize while reading: the place is kept and, in screen pages, the top lands on a whole line. Owned by Task XR2.3 (`screen pages: a resize keeps the place and lands on a whole line`).

---

## Waves, order and file ownership

| Wave | Tasks | Depends on | Owns (create or modify) |
|---|---|---|---|
| XR1 reader mode on 1.1.0 | XR1.1 to XR1.5 | X1's host wave; X2 P5.3 (the dispatcher and the decider) | `pwa/src/docs/reader/{readerMode,readerModeWords}.ts` (new), `pwa/src/docs/{useReaderMode.ts,DocsReading.tsx,ReaderModeOverlay.tsx}` (new), `pwa/src/screens/DocsScreen.tsx` (the container around `{body}`), `pwa/src/docs/ReaderFrame.tsx`, `pwa/src/docs/reader/{bridge,policy}.ts` (the `reading` chrome), `pwa/src/docs/DocsHead.tsx` (`ActionsRow`, `OneBarControls`), `pwa/src/docs/docs.css`, `pwa/src/command/commands.ts` and the command layer's key-holding check, `pwa/src/lib/historyPlaces.ts` and `pwa/src/docs/reader/places.ts` (the `reader` kind), `ui/src/primitives/sheet.tsx` (the portal target context), `ui/src/styles/tokens.css` (`--z-reading`), rich-docs spec §4.4 (D-8803, D-8805) |
| LX6 the library landing | LX6.1 to LX6.3 | the library wave's X1 and X2 landings | the library's repository only: designed here (§ Library landing LX6), built by the library programme |
| XR2 reader ops | XR2.1 to XR2.3 | XR1; the release carrying LX6; X2 P5's adoption | `pwa/package.json` and lock (only if P5 pinned a release without LX6), `pwa/src/docs/reader/{bridge,policy,readerMode}.ts`, `pwa/src/docs/{ReaderFrame.tsx,ReaderModeOverlay.tsx,useReaderMode.ts}`, `pwa/src/lib/readerRenderJob.ts` (reading time), rich-docs spec §4.4 (D-8804) |

If the coordinator lands P5.3's host half (`popstate.ts`, `historyPlaces.ts`, the listeners through `onPop`) before the library release, XR1 can run ahead of the release; otherwise XR1 follows P5. Every wave ends with the common acceptance cycle of the completion plan (exact-tip CI and CodeQL, privacy scan, review run).

## Acceptance row (proposed for completion Task 17)

| Row | Task 17 row | Installed action and observation | Waves |
|---|---|---|---|
| AR-X6 | Reader mode | On the installed release: open a spec on a phone (412 by 915, in the browser and installed) and on a desktop (1280 by 800 and 1920 by 1080). Enter by the button and by `r`. Only the text remains. Turn forward and back by a side tap, a swipe and the arrow keys; every turn lands on a whole line; a link, a selection and a Render button never turn; a wide table scrolls under a swipe. Switch to Scroll and back. A tap at the top shows the percentage, the time left, Aa and Exit. Leave by Esc, Back (Android Back, iOS swipe), Exit and the browser's own exit, each once. Reopen the doc: the place is kept. The screen stays on while reading and sleeps after the idle release. An external link's sheet shows inside reader mode. Every control meets 44 px. Device rows FS-1 to FS-7 (spec §4.4) recorded per engine | XR1, XR2 |

---

## Wave XR1: reader mode on library 1.1.0

### Task XR1.1: The decisions (L1), and the measurements first

**Files:** Create `pwa/src/docs/reader/readerMode.ts`, `pwa/src/docs/reader/readerModeWords.ts`; Test `pwa/test/reader-mode-policy.test.ts` (new), browser `pwa/browser/reader-mode-lab.browser.test.ts` (new); `server/test/single-definition/docs-ring.test.ts` if it lists `docs/reader/*` modules by ring.

**Interfaces:**
- Produces:
  - `type ReaderTurn = 'screens' | 'scroll'`
  - `type ReaderModeHow = 'full-screen' | 'fill'`
  - `type ReaderModeState = { on: false } | { on: true; doc: string; how: ReaderModeHow; overlay: boolean }`
  - `type ReaderModeEvent = { kind: 'enter'; doc: string; activation: boolean; fullscreenEnabled: boolean } | { kind: 'full-screen-granted' } | { kind: 'full-screen-refused' } | { kind: 'full-screen-lost' } | { kind: 'esc' } | { kind: 'exit-tap' } | { kind: 'place-popped' } | { kind: 'doc-changed'; doc: string } | { kind: 'fallback' } | { kind: 'menu' }`
  - `type ReaderModeAct = 'draw-fill' | 'request-full-screen' | 'exit-full-screen' | 'clear-fill' | 'push-place' | 'step-back' | 'focus-frame' | 'restore-focus' | 'acquire-wake' | 'release-wake' | 'toggle-overlay' | 'announce'`
  - `readerModeStep(state: ReaderModeState, event: ReaderModeEvent): { state: ReaderModeState; acts: readonly ReaderModeAct[] }`
  - `readerModeOffered(input: { frameReady: boolean; plainView: boolean }): boolean`
  - `wakeLockWanted(input: { on: boolean; visible: boolean; lastActivityMs: number; nowMs: number }): boolean`
  - `timeLeftMinutes(readingMinutes: number, share: number): number`
  - `READER_WAKE_IDLE_MS = 300000`, `READER_TOP_BAND_PX = 44`
  - In `readerModeWords.ts`: `READER_MODE_TEXT` (`enter: 'Reader mode'`, `exit: 'Exit reader mode'`, `live: 'Reader mode. Esc or Back leaves it.'`, `toolbar: 'Reader mode'`) and `timeLeftText(minutes: number): string` (`'less than a minute left'` below 1, else `'about N min left'`).

- [ ] **Step 0: Measure before any code (spec §4.5).** In `pwa/browser/reader-mode-lab.browser.test.ts`, against a page of the built PWA with a ready reader frame: M-1 (a `page.click` on a host button that calls `requestFullscreen` on a wrapper resolves; the same call from `page.evaluate` with no activation rejects), M-3 (inside the frame, `document.fullscreenEnabled` is false and `requestFullscreen` rejects), M-4 (with the wrapper full screen and the frame focused, a key reaches the frame: assert through the library's existing behaviour, `?` opening its keys sheet), M-7's frame half (`navigator.wakeLock` absent or refused inside the frame), and at 1.1.0 whether `features.chrome.settings: false` still lets `command('settings')` open the frame's Aa. Record each as a line in Results. If M-3 shows the frame CAN enter full screen, stop and report: the sandbox reading is wrong.
- [ ] **Step 1: Failing tests** in `reader-mode-policy.test.ts`: `reader mode: enter draws the fill, pushes the place, focuses the frame, acquires the wake lock and announces, in that order` (acts equal `['draw-fill','request-full-screen','push-place','focus-frame','acquire-wake','announce']` with activation and `fullscreenEnabled`); `reader mode: enter without fullscreenEnabled draws the fill and never requests full screen`; `reader mode: enter without activation draws the fill alone`; `reader mode: a refusal keeps reader mode on as fill`; `reader mode: losing full screen exits and steps back once`; `reader mode: a popped place exits without stepping back`; `reader mode: Esc, Exit and losing full screen each step back exactly once` (table); `reader mode: a place popped after an exit is a no-op`; `reader mode: a doc change exits and steps back nothing` (the place is stale, X2's skip rule); `reader mode: a fallback exits and steps back once`; `reader mode: menu toggles the overlay`; `reader mode: every exit releases the wake lock and restores focus`; `offered: only a ready frame outside the plain view`; `wake: wanted at 299999 ms idle, not at 300000`; `wake: never while hidden or off`; `time left: 10 minutes at share 0.5 is 5, at 1 is 0, 0.6 minutes is less than a minute`.
- [ ] **Step 2:** run, expect red (module missing).
- [ ] **Step 3:** implement `readerModeStep` as one table over (state, event); no I/O, no DOM.
- [ ] **Step 4:** run, expect green; run `pwa` typecheck.
- [ ] **Step 5: Commit** `feat(docs): reader mode decisions (X6 XR1.1)`.

### Task XR1.2: The reading container, fill, full screen, sheets and the wake lock

**Files:** Create `pwa/src/docs/DocsReading.tsx`, `pwa/src/docs/useReaderMode.ts`; Modify `pwa/src/screens/DocsScreen.tsx` (wrap `{body}` in `<DocsReading>`, no React key), `pwa/src/docs/docs.css` (the container's normal flex rules and its `[data-reader-mode]` fill rules), `ui/src/styles/tokens.css` (`--z-reading: 70`), `ui/src/primitives/sheet.tsx` (the portal target from context); Test `pwa/test/reader-mode.test.tsx` (new), browser `pwa/browser/reader-mode.browser.test.ts` (new).

**Interfaces:**
- Consumes: Task XR1.1's `readerModeStep`, `wakeLockWanted`, `READER_MODE_TEXT`.
- Produces:
  - `ReaderModeContext` (in `useReaderMode.ts`): `{ state: ReaderModeState; enter(): void; exit(cause: 'esc' | 'exit-tap'): void; menu(): void; activity(): void; setFrame(f: { focus(): void } | null): void; setFallback(): void }`, provided by `DocsReading`.
  - `SheetPortalContext` (in `ui/src/primitives/sheet.tsx`): `HTMLElement | null`; `Sheet` passes it as `Drawer.Portal`'s `container` when non-null.
  - The container: `<div className="docs-reading" data-reader-mode={'full-screen' | 'fill' | undefined}>`, holding `{body}`, the overlay (Task XR1.4) and a `div.docs-reading-portal` given to `SheetPortalContext` while on.

- [ ] **Step 1: Failing tests** (jsdom, the Fullscreen and Wake Lock APIs faked): `reader mode: enter sets data-reader-mode to fill before requestFullscreen resolves`; `reader mode: requestFullscreen is called on the container with navigationUI hide, in the same task as enter`; `reader mode: granted sets full-screen, refused keeps fill`; `reader mode: fullscreenchange to no element ends reader mode once`; `reader mode: exitFullscreen is called only when the container is the full-screen element`; `reader mode: a sheet opened while on portals into the container, after exit into the body`; `reader mode: losing full screen with a sheet open keeps the sheet usable`; `wake lock: requested on enter, released on exit`; `wake lock: released after 300000 ms with no activity and requested again on the next activity`; `wake lock: re-requested on visible, released when reader mode ended while hidden`; `wake lock: a missing API or a refusal changes nothing`; `docs screen: the container wraps the body and remounts nothing` (the reader host element is the same node before and after the wrap renders twice). Browser (`reader-mode.browser.test.ts`, desktop Chrome): `reader mode: the container goes full screen and the frame does not reload` (one `load`); `reader mode: refused full screen leaves the fill covering the head and banners` (`elementFromPoint` at the head's centre is inside the container); `reader mode: the external-link sheet shows inside reader mode`; `reader mode: no allowfullscreen or allow attribute on the reader frame`.
- [ ] **Step 2:** run, expect red.
- [ ] **Step 3:** implement. `useReaderMode` applies `readerModeStep`'s acts in order; it holds the one `fullscreenchange` and `visibilitychange` subscription of the Docs screen, and the wake lock sentinel. The fill rule: `position: fixed; inset: 0; z-index: var(--z-reading)`, padding from `--safe-top`, `--safe-bottom` and `env(safe-area-inset-left/right)`, background the reader's ground.
- [ ] **Step 4:** run, expect green; run the `ui` typecheck and the `pwa` suite's tap-target and theme tests (`tap-targets.test.tsx`, `contrast.test.ts`).
- [ ] **Step 5: Commit** `feat(docs): the reading container, full screen and the wake lock (X6 XR1.2)`.

### Task XR1.3: The reader place

**Files:** Modify `pwa/src/lib/historyPlaces.ts` (place kind `reader`, answer `exit-reader`), `pwa/src/docs/reader/places.ts` (`pushReaderPlace`, the host's `exitReader`); Test `pwa/test/reader-places.test.ts` (extend X2's), browser `pwa/browser/reader-places.browser.test.ts` (extend X2's).

**Interfaces:**
- Consumes: X2 P5.3's `decidePop`, `onPop`, `setPlaceHost`, the tab record and `PLACES_MAX`.
- Produces: `Place.kind` gains `'reader'`; `decidePop` gains the answer `{ kind: 'exit-reader' }` for a popped entry whose `docsIdx` is below a current-visit `reader` place's; `setPlaceHost`'s host gains `exitReader(): void`; `pushReaderPlace(): boolean` (false when the visit's budget is spent, and then reader mode still opens, with no place).

- [ ] **Step 1: Failing tests:** `reader place: Back exits reader mode and stays on the doc` (no router subscriber runs); `reader place: Esc, Exit and losing full screen each consume exactly one entry`; `reader place: fullscreenchange and popstate in either order exit once`; `reader place: a stale reader place after leaving the doc costs no Back`; `reader place: a pop below the reader place after Chromium skipped it still exits`; `reader place: counts toward PLACES_MAX`; `reader place: the pushed entry's URL is the doc's current URL and keeps only`. Browser: `reader place: Back from reader mode shows the doc in the normal view, a second Back leaves it`.
- [ ] **Step 2 to 4:** run, implement, run.
- [ ] **Step 5: Commit** `feat(docs): Back leaves reader mode (X6 XR1.3)`.

### Task XR1.4: The reading mount and the overlay

**Files:** Create `pwa/src/docs/ReaderModeOverlay.tsx`; Modify `pwa/src/docs/reader/policy.ts` (`ReaderChrome` gains `'reading'`; `readerMountPlan` takes it), `pwa/src/docs/reader/bridge.ts` (a `reading` mount passes `features: { chrome: { bar: false, rail: false, settings: <Step 0's reading>, topSpace: false } }` and `onProgress`), `pwa/src/docs/ReaderFrame.tsx` (chrome `reading` while reader mode is on, a remount on change; progress through `createReaderProgress`; `setFrame` and `setFallback` to the context), `pwa/src/docs/docs.css` (overlay rules), rich-docs spec §4.4 (D-8803, D-8805); Test `pwa/test/reader-mode-mount.test.tsx` (new), `pwa/test/reader-bridge.test.ts` (rows for `reading`).

**Interfaces:**
- Consumes: `ReaderModeContext`; `readerBar.ts#createReaderProgress`; `ReaderMount.command`.
- Produces: `ReaderModeOverlay(props: { title: string; progress: ReaderProgress; onExit(): void; onAa(): void })`, a `role="toolbar"` named `READER_MODE_TEXT.toolbar`: Exit, Aa, then a `role="status"` percentage updated at most once a second; XR1's top band, a transparent `button` of `READER_TOP_BAND_PX` height over the frame's top that calls `menu()`.

- [ ] **Step 1: Failing tests:** `reading mount: chrome off and onProgress passed` (the adapter's `features` and `onProgress`); `reading mount: entering remounts the same document once with no body read`; `reading mount: leaving remounts back to the bar the width asks for`; `reader mode: a fallback after entering ends reader mode and consumes its place`; `overlay: hidden on entry, the top band shows it, Esc on it hides it and returns focus to the frame`; `overlay: Exit leaves reader mode`; `overlay: Aa sends command settings`; `overlay: the percentage follows progress, at most once a second`; `overlay: every control is at least the tap floor`. Mutation-proof rows listed under Mutation rows.
- [ ] **Step 2 to 4:** run, implement, run.
- [ ] **Step 5: Amend rich-docs §4.4.** In the `command` row, after "Sent only from a tap on ccrc's own bar", add ", or from the reader-mode overlay's Aa (amended <date>; X6 XR1, D-8803)". In the `progress` row, after "ccrc asks only for a frame mounted on its own bar", add ", and for a reader-mode mount (amended <date>; X6 XR1, D-8805)".
- [ ] **Step 6: Commit** `feat(docs): the reading mount and the overlay (X6 XR1.4, D-8803, D-8805)`.

### Task XR1.5: Entry: the head action, the one-bar control, `r` and the palette

**Files:** Modify `pwa/src/docs/DocsHead.tsx` (`ActionsRow` first action; `OneBarControls` last control), `pwa/src/command/commands.ts` (one command, key `r`, offered on a Docs page where `readerModeOffered` holds), the command layer's key-holding check (an element with `data-reader-mode` holds every key but `r` and Escape, beside its `[role="dialog"][data-state="open"]` arm), `pwa/src/docs/docs.css`; Test `pwa/test/docs-desk-head.test.tsx`, `pwa/test/docs-one-bar.test.tsx`, `pwa/test/tap-targets.test.tsx`, `pwa/test/command-registry.test.ts`, browser `pwa/browser/docs-compact-head.browser.test.ts`.

- [ ] **Step 1: Failing tests:** `desk head: Reader mode leads the actions row, a word at stage 0 and an icon after`; `desk head: no Reader mode on the plain view or before ready`; `one bar: Reader mode is the last control, after Jump, Contents and a plan's Outline, labelled Reader mode`; `one bar: oneBarTools is unchanged` (the library command names only); `tap targets: the reader mode control floors on --tap-min`; `commands: r enters reader mode on a Docs page with a ready frame, and nowhere else`; `commands: while reader mode is on, Ctrl+K and the single keys are held, r and Escape are not`. Browser (`docs-compact-head.browser.test.ts`): `one bar: with Reader mode the bar stays 44 px, the title at most 61 px down, every control at least 44 by 44, at 412 by 915 and 915 by 412`; `desk head: with Reader mode the row stays one line and the head at most 80 px at 1280 by 800 and 1920 by 1080`.
- [ ] **Step 2 to 4:** run, implement, run. Confirm `git diff` of this wave leaves both 2026-11-06 phone blocks untouched.
- [ ] **Step 5: Commit** `feat(docs): enter reader mode from the head, the one bar and r (X6 XR1.5)`.

---

## Library landing LX6 (designed here, built by the library programme)

The library programme builds it after the X1 and X2 landings of its wave, in the same release if that release is not cut yet, else the next minor. A shares-only landing first records X6's shares: frame 15 360 characters, total 59 392 (spec §7.4). If the landing measures above either, it stops and asks the coordinator with its rows.

### Task LX6.1: The `reader` ops and in-place reading chrome

**Interfaces:**
- Parent to frame: `{t: 'reader', mode: 'screens' | 'scroll' | 'off'}`; `FRAME_ACCEPTS` gains `'reader'`; `DocFrame.setReader(mode)` queues before `ready`, latest wins, and seeds a later remount.
- Frame to parent: `{t: 'reader', act: 'menu' | 'exit' | 'toggle'}`; `FRAME_OPS` gains `'reader'`; the host parser refuses any other key or act; at most 4 a second, coalesced; `HostAdapters` callback `onReader(act)`; sent only when the seed's `bridge.reader` is true (the host passed `onReader`).
- While `mode` is not `off`: the root carries `data-reading`; the bar, running head, progress line, rail, settings button and top space are hidden in place; `r` and Esc (with no frame overlay open) send `exit`; while `off`, `r` sends `toggle`; the keys sheet lists `r` when `bridge.reader` is true.
- **Cases:** the op parser rows for both directions (an unknown mode ignored by the frame; an unknown act, an extra key and a fifth act within a second refused by the host); a 1.1 host (no `onReader`) receives no `reader` op and counts no refusal; in-place chrome hides and restores without a remount (the same nonce); Esc with the jump open closes the jump and sends nothing; test 9's record gains one entry.

### Task LX6.2: Screen pages

**Interfaces:** a module beside `nav` and `position`, active only in `screens` mode: the turn (spec §5.3), the tap zones and top band (spec §5.4, Figure 4), the swipe, the keys (ArrowRight, PageDown, Space forward; ArrowLeft, PageUp, Shift+Space back), the interactive-target selector list, and the re-snap after a resize, a text size or a width change through `tokenOf`.

- **Cases (real browser):** a forward and a back turn land on a whole line in a fixture of known line boxes, at three widths and both fonts; a block taller than the screen is stepped through with one line of overlap; every turn moves at least a third of a screen; a tap on a link, a button, a Render button, a summary and a card never turns; a non-empty selection never turns; a swipe inside a wide table scrolls the table; the top band sends `menu` in both modes; turns are instant with and without reduced motion; a resize keeps the place and lands on a whole line; `scroll` mode turns nothing.

### Task LX6.3: Text size and reading time

**Interfaces:** `FRAME_PREF_VALUES.size: 's' | 'm' | 'l' | 'xl'` (16, 18, 20, 22 px, scaling `--rem`), an Aa row, absent reads as `m`, stored with width and font; `render()`'s `meta.readingMinutes: number`, by the rule `reading.js` already applies (230 words a minute prose, 520 code, half a minute per figure), equal to the byline's figure for every conformance document.

- **Cases:** each size's computed body size; an absent or unknown size reads `m`; `meta.readingMinutes` equals the enhance byline's minutes across the corpus; test 8's growth row under X6's `Size-Design:` line, within both shares.

---

## Wave XR2: adopt the reader ops

### Task XR2.1: In place, and progress for every mount

**Files:** Modify `pwa/package.json` and lock (only if P5 pinned a release without LX6), `pwa/src/docs/reader/{bridge,policy}.ts` (pass `onReader`; `setReader`; `ReaderChrome` loses `'reading'`; every production mount passes `onProgress`), `pwa/src/docs/ReaderFrame.tsx` (no remount on entering or leaving), `pwa/src/docs/useReaderMode.ts` (`onReader` acts: `menu`, `exit`, `toggle`), rich-docs spec §4.4 (D-8804, D-8805); Test `pwa/test/reader-bridge.test.ts`, `pwa/test/reader-mode-mount.test.tsx`, browser `pwa/browser/reader-mode.browser.test.ts`.

**Interfaces:** `ReaderMount.setReader(mode: 'screens' | 'scroll' | 'off'): void`; `ReaderMountInput.onReader?(act: 'menu' | 'exit' | 'toggle'): void`; `readerModeStep` gains events `{kind: 'frame-exit'}` and `{kind: 'frame-toggle'; activation: boolean; frameFocused: boolean}`.

- [ ] **Step 1: Failing tests:** `reader ops: entering sends setReader with the stored turn and remounts nothing` (the same nonce); `reader ops: leaving sends off`; `reader ops: frame exit leaves reader mode`; `reader ops: frame toggle enters as fill without activation, and asks for full screen with it`; `reader ops: frame toggle is refused unless the frame is ready and focused`; `reader ops: every production mount asks for progress, the lab's does not`; `reader ops: with the frame accepting reader, ccrc's top band is not drawn`. Browser: `reader ops: Esc in the fill, focus in the frame, leaves reader mode`.
- [ ] **Step 2 to 4:** run, implement, run.
- [ ] **Step 5: Amend rich-docs §4.4:** add the `reader` rows in both directions and, in the hello paragraph's list of later parent messages, `reader` (amended <date>; X6 XR2, D-8804); in the `progress` row replace XR1's clause with ", and for every production mount (amended <date>; X6 XR2, D-8805)".
- [ ] **Step 6: Commit** `feat(docs): reader mode in place (X6 XR2.1, D-8804, D-8805)`.

### Task XR2.2: The turn setting and time left

**Files:** Modify `pwa/src/docs/ReaderModeOverlay.tsx` (a Pages or Scroll switch), `pwa/src/docs/useReaderMode.ts` (the turn stored in the console's storage, one writer, named by the convention `pwa/test/w7-storage-keys.test.ts` holds), `pwa/src/lib/readerRenderJob.ts` (carry `meta.readingMinutes`), `pwa/src/docs/reader/readerMode.ts` (`timeLeftMinutes` used); Test `pwa/test/reader-mode-overlay.test.tsx` (new), `pwa/test/w7-storage-keys.test.ts`.

- [ ] **Step 1: Failing tests:** `turn: Pages by default, Scroll kept per device, sent with setReader`; `turn: the storage key is in the census and written in one place`; `time left: the overlay reads about N min left from readingMinutes and the share`; `time left: absent readingMinutes shows the percentage alone`.
- [ ] **Step 2 to 5:** run, implement, run, commit `feat(docs): screen pages and time left (X6 XR2.2)`.

### Task XR2.3: The reading proved end to end

**Files:** Test browser `pwa/browser/reader-mode.browser.test.ts`.

- [ ] **Step 1: Browser rows on the real release:** `screen pages: ArrowRight, a right tap and a swipe each turn forward and the progress rises`; `screen pages: a link tap opens the link, not a turn`; `screen pages: a resize keeps the place and lands on a whole line`; `scroll: a tap below the band turns nothing`; `size: Aa's text size applies in reader mode and after it`.
- [ ] **Step 2 to 3:** run, fix only integration defects in ccrc (a library defect goes to the coordinator), commit `test(docs): reader mode end to end (X6 XR2.3)`.

---

## Mutation rows

Each row ships with the task that owns it; it is red when the guard is removed and green when restored. Run through the coordinator's mutation runner.

| Row | Task | Mutation | Red test |
|---|---|---|---|
| X6.1 | XR1.1 | `readerModeStep`'s enter drops `request-full-screen` | reader mode: enter draws the fill, pushes the place, focuses the frame, acquires the wake lock and announces, in that order |
| X6.2 | XR1.1 | Enter requests full screen without `fullscreenEnabled` | reader mode: enter without fullscreenEnabled draws the fill and never requests full screen |
| X6.3 | XR1.1 | A refusal sets the state off | reader mode: a refusal keeps reader mode on as fill |
| X6.4 | XR1.1 | `full-screen-lost` omits `step-back` | reader mode: losing full screen exits and steps back once |
| X6.5 | XR1.1 | `place-popped` adds `step-back` | reader mode: a popped place exits without stepping back |
| X6.6 | XR1.1 | `READER_WAKE_IDLE_MS` compared with `<=` | wake: wanted at 299999 ms idle, not at 300000 |
| X6.7 | XR1.1 | `readerModeOffered` ignores `plainView` | offered: only a ready frame outside the plain view |
| X6.8 | XR1.2 | The fill drawn after the request resolves | reader mode: enter sets data-reader-mode to fill before requestFullscreen resolves |
| X6.9 | XR1.2 | `SheetPortalContext` not provided | reader mode: a sheet opened while on portals into the container, after exit into the body (and the browser row) |
| X6.10 | XR1.2 | The wake lock not released on exit | wake lock: requested on enter, released on exit |
| X6.11 | XR1.2 | `visibilitychange` not handled | wake lock: re-requested on visible, released when reader mode ended while hidden |
| X6.12 | XR1.2 | A React key on the container | docs screen: the container wraps the body and remounts nothing |
| X6.13 | XR1.3 | `decidePop` answers `router` for a reader place | reader place: Back exits reader mode and stays on the doc |
| X6.14 | XR1.3 | The pending landing not recorded on an exit | reader place: Esc, Exit and losing full screen each consume exactly one entry |
| X6.15 | XR1.4 | The `reading` mount keeps the bar | reading mount: chrome off and onProgress passed |
| X6.16 | XR1.4 | The fallback does not reach the context | reader mode: a fallback after entering ends reader mode and consumes its place |
| X6.17 | XR1.4 | Esc on the overlay leaves reader mode | overlay: hidden on entry, the top band shows it, Esc on it hides it and returns focus to the frame |
| X6.18 | XR1.5 | The one-bar control below the tap floor | tap targets: the reader mode control floors on --tap-min |
| X6.19 | XR1.5 | The key-holding arm for `data-reader-mode` removed | commands: while reader mode is on, Ctrl+K and the single keys are held, r and Escape are not |
| X6.20 | XR1.5 | Reader mode offered before ready | desk head: no Reader mode on the plain view or before ready |
| X6.21 | XR2.1 | `onReader` not passed | reader ops: frame exit leaves reader mode |
| X6.22 | XR2.1 | Frame toggle accepted without focus | reader ops: frame toggle is refused unless the frame is ready and focused |
| X6.23 | XR2.1 | Frame toggle requests full screen without activation | reader ops: frame toggle enters as fill without activation, and asks for full screen with it |
| X6.24 | XR2.1 | Entering still remounts | reader ops: entering sends setReader with the stored turn and remounts nothing |
| X6.25 | XR2.2 | A second writer of the turn key | turn: the storage key is in the census and written in one place |

## Deviations found

- **D-8803 (2026-11-20)** — reader-overlay-commands. Wave XR1 (Task XR1.4): the reader-mode overlay's Aa sends `command settings` to the frame. Departs from rich-docs spec §4.4's `command` row: "Sent only from a tap on ccrc's own bar, through the library's `DocFrame.command`, which focuses the frame first and sends nothing before `ready`". Argued: the overlay is ccrc's own chrome, outside the frame, and the tap is yours on it; the command is one of the four existing names, through the same `DocFrame.command`, under the same parser and limits, with no new channel. XR1 amends §4.4 (Task XR1.4 Step 5). Issued to run 2847 (X6) in its brief's block 8803 to 8805.
- **D-8804 (2026-11-20)** — reader-mode-ops. Wave XR2 (Task XR2.1) and the library landing LX6: one new op in each direction on the existing port, `reader {mode}` from ccrc and `reader {act}` from the frame. Departs from rich-docs spec §4.4: "Every later parent message goes on the port, and is `prefs`, `changes.result`, `mermaid` or `command`", and from the closed frame-op table. Argued against the checked-bridge boundary: both are additive with closed value sets, ride the existing port, parser and `BRIDGE_LIMITS` (at most 4 acts a second), send no URL or position, are sent by the frame only when the seed says ccrc accepts them, and add no channel, window listener, parent-DOM access or CSP source (spec §7.2, §8). XR2 amends §4.4 (Task XR2.1 Step 5). Issued to run 2847 (X6).
- **D-8805 (2026-11-20)** — progress-beyond-the-bar. Waves XR1 (Task XR1.4) and XR2 (Task XR2.1): ccrc asks for `progress` from a reader-mode mount, then from every production mount. Departs from rich-docs spec §4.4's `progress` row: "ccrc asks only for a frame mounted on its own bar". Argued: the op is unchanged, already allowed with the bar off (the library's `onProgress` contract), at most four a second, and carries a share only; the overlay's percentage and time left need it on a desktop. XR1 and XR2 amend §4.4 (Task XR1.4 Step 5, Task XR2.1 Step 5). Issued to run 2847 (X6); the block is spent.

## Results

### What was read and measured (2026-11-20)

- Read at `main` `62276e71b`: `pwa/src/docs/{ReaderFrame.tsx,DocsHead.tsx,readerBar.ts,docs.css}`, `pwa/src/docs/reader/{bridge,policy}.ts`, `pwa/src/screens/DocsScreen.tsx`, `pwa/src/command/useShortcuts.ts`, `ui/src/primitives/sheet.tsx`, `ui/src/styles/tokens.css`, `pwa/vite.config.ts`'s manifest, the browser leg's harness and budgets (`docs-compact-head.browser.test.ts`, `tap-targets.test.tsx`). The installed library 1.1.0's `dist/` and `README.md`, read from an existing install on the box, never installed here. Two of the reads were Sonnet fact checks with citations; the design reads were the worker's.
- Measured: element full screen around a `sandbox="allow-scripts"` srcdoc frame on headless Chromium 156, rows M-1, M-2, M-6, M-7 (the console's half) and M-8 (spec §4.5). M-3, M-4, M-5 and M-7's frame half are UNMEASURED; Task XR1.1 Step 0 and the device item take them.

### Asks and rulings

- **Ask 656, pages or scroll (product):** screen pages, with scroll kept as a reader setting; the operator's answer, relayed by the coordinator on 2026-11-20.
- **Three refusals, each reported and answered by the coordinator before any retry:** the session hook refused an edit of the scratch measurement script after a `cd` whose target it could not resolve; it refused the first draft of that report, which quoted the refusal's text naming the account secrets directory; and the graph gate refused a source grep before one graph query. The coordinator allowed the script to be edited by its absolute temp-root path with the Edit tool and run twice, then deleted (done), and allowed one graph query followed by free reads (done).

### Commands

- The measurement: `node <session temp root>/x6fs/measure.mjs <the cached Chromium 156>`, run three times: once before the first refusal (its values empty), then twice under the coordinator's word, the last after the one-line fix that made the host page's script run. Chromium was killed by its own PID each time; the script and its three profile directories are deleted.
- No test, typecheck or install ran: this wave is docs only.
