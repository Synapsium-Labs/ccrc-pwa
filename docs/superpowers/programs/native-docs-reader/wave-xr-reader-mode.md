# Wave XR: reader mode (X6 XR1 and XR2 as one wave), task note for the ledger

Run 3992, wave 54, the native Docs reader programme. The plan is `docs/superpowers/plans/2026-11-20-native-docs-reader-mode.md` (its "Amendment 2026-11-24" governs); every task's full record is in that plan's Results, under "Wave XR (run 3992, wave 54, 2026-11-26)". This note is what the ledger should learn from the wave.

## What shipped

Reader mode in the console's Docs reader, on the library's 1.2.0 release: a Reader mode action (the desk head's first action, the phone one bar's last control, the compact row's control) and the `r` key take the open document into a reading container drawn over the console and asked for element full screen; the library hides its chrome in place and turns screen pages (Pages by default, Scroll as a per-device switch in the overlay); a tap on the frame's top band shows a small overlay (the title at the top; Exit, Pages or Scroll, Aa and the percentage with the time left at the bottom); Esc, Back, Exit and the browser's own exit each leave once, through one reader place in wave PH's Back places; the place in the document is kept; a screen wake lock is held while reading, with a five-minute idle release.

## Commits, in order

| Commit | Task |
|---|---|
| `0793a3d1f8`, `4a20b34b6b` | the base: wave PH at `39e4db2ca1`, then the appearance wave at `a042be374f`, merged |
| `5b4c5f93b7` | XR1.1 Step 0: the 1.2.0 facts re-read, and the browser leg's M-3, M-4 and M-7 |
| `a992c9c02c` | XR1.1: the L1 decisions |
| `5adbb18e89` | the bound first item: the hosted faces wait ends at the frame's watchdog |
| `937a5403ba` | XR1.2: the reading container, full screen, the hidden console, the wake lock |
| `c6c1d530f9` | XR1.3: the reader place |
| `a8951a5c38` | absorb of `main` (the appearance wave squashed) |
| `f815762799` | XR1.4 with XR2.1 folded in: the reading mount and the overlay; the rich-docs spec's amendments (D-8803, D-8804, D-8805, D-8831); the design's History row (D-9139) |
| `8d1ff446a1` | XR1.5: entry from the head, the one bar and `r`; `book-open` vendored |
| `4de222cfe3` | absorb of `main` (wave PH squashed) |
| `3944cffb09` | XR2.2: the turn setting and time left |
| `4870f4f045` | XR2.3: the reading proved end to end, and the wave's browser leg; one product fix, a mount made while reader mode is on held hidden until its turn is applied (the first-paint row) |
| `965366e64e` | the gate before the push: the Reader mode control and the focus guard each written once (two census reds), the review lab's fixture regenerated |
| `924e77b62e` | fix round 1: the link sheet's row asserts the full address (code scanning) |
| `2724fb178a` | fix round 1, item 1: the mouse link-tap row split (a plain row for the jump, a narrow known-failure row) |
| `3fee0264b2` | fix round 1, item 7: the compact control's tooltip pinned |
| `899c0d6c9e` | fix round 1, item 2: an Exit with no frame standing |
| `f9779b2c25` | fix round 1, item 3: not offered while a figure is open |
| `e9e0806c57` | fix round 1, item 5: a refused wake lock remembered |
| `548357e5b8` | fix round 1, item 4: an exit steps over an entry the record does not hold |
| `21fa9f982f` | fix round 1, review I1: an exit's step-back that falls short steps once more (decidePop) |
| `0b1f4e5f7e` | fix round 1, review M1: a replaced frame has no figure open |
| `c978869ff7` | fix round 1, review M2: the focus guards' target decided in L1, the Exit-only form wraps |
| `190e509148` | fix round 1, review M3: only the current wake-lock request's refusal is remembered; the nits |
| `b11a798006` | fix round 1, review M4: the mouse jump measured in the frame in one step |
| (next) | fix round 1: the records (the design's frame row, the plan's Results, this note) |

## Deviation numbers

The run was issued 9142, 9143 and 9144. None was defined: every departure below is a layout or test-placement choice argued in the plan's Results, or a step the amendment already licenses, and no wall, op or decider departs from the plan or the specs beyond the deviations the plan already carries (D-8803, D-8804, D-8805, D-8831, D-8974, D-8975, D-9139). The three numbers are returned unused.

## Departures from the task text the ledger should know

- **Test files of other waves stay unedited**: the reader place's rows are in `pwa/test/reader-mode-places.test.ts` and `pwa/test/reader-mode.test.tsx`, not wave PH's held `reader-places.test.ts`; the mount rows in `pwa/test/reader-mode-mount.test.tsx`; the `r` command's rows in `pwa/test/reader-mode-commands.test.ts` (`command-registry.test.ts` was released to another programme's flake fix). Where an existing pin met an intended change, it changed with its holder's agreement, by an exact diff sent first: one case of `reader-bridge.test.ts` (D-8805), three pins of `command-registry.test.ts`, six TOKEN entries of `control-census.test.ts`; and without a holder, one case of `reader-frame.test.tsx` (D-8805) and two CSS-chain pins (`docs-compact-css.test.ts`, `docs-compact-head.test.tsx`) for the reading container.
- **`readerMountPlan`'s shape is unchanged**: reader mode's asks of a mount (progress on every production mount, the frame's reader acts, the reading it is made under) are a separate L1 function, `readerMountAsks`, because wave PH's pins hold the plan's shape whole.
- **The decider's acts** include `start-reading` and `stop-reading` (XR2.1's `setReading`, folded into the table), and events beyond the task's list: `frame-exit`, `frame-toggle`, `leave`, `frame-ready {planned, turn}`, `turn-changed`. The plan's `toggle-overlay` act is not defined (the overlay is the state's own field).
- **The browser leg** is written after the entry existed (XR1.5), not with each task; XR1.5's head rows moved into `docs-compact-head.browser.test.ts` (released by wave C's worker and taken by this wave), with the head's budgets in one shared file, `pwa/browser/docsHeadBudgets.ts`.
- **The desk row at 1280 by 800** shows Share, Export and the GitHub links as icons with tooltips (accepted by the coordinator with two conditions, both met: Reader mode keeps its word wherever the row showed words before, and every icon keeps its name and tooltip).
- **The compact row** draws the Reader mode control too: a frame mounted at desk width keeps no host bar, so the compact row can sit over a ready frame, which spec §3.1 did not foresee.

## Not right yet

With a mouse, in full screen, a link to a place inside the document jumps and then returns (160 to 200 ms later), in automated Chromium. The second bounded diagnosis (fix round 1) found the library is not needed: the revert follows a focus move without scroll inside the frame while an ancestor is the full-screen element, and no script of the library's or the console's causes it. Whether a person's browser shows it is not measured (device row FS-11). The browser row's known-failure part holds only the stays-at-the-target assertion and reds the day it holds; a plain row proves the jump itself.

## Stated residues

- The first-paint hold releases two animation frames after the mount's `ready` (a margin, not a signal: the library acknowledges no `reading`), so a frame that applies the turn late could still show its chrome for a frame.

- An entry within 100 ms of a lost full screen leaves the old reader place below the new one: one extra Back after the second exit.
- A router push onto an unnumbered entry does not drop recorded places above it (wave PH's rows pin that); a discarded reader place is never treated as a dead entry (the crossing rule).
- After the release gate's full-page replace, a Docs page that has not started its own visit (an index) bounces a Forward onto a dead reader entry back.
- The console's hiding is a snapshot taken at entry: a toast host mounted later is neither inert nor hidden (spec §4.1 accepts toasts behind reader mode).
- X6.72 as worded is an equivalent mutant in the real wiring (the hook marks before every step-back); the guard measured is the step-back's own mark.

## Not measured here

Firefox, phones, full screen and the wake lock on real devices: the device rows FS-1 to FS-10 (FS-9 moved to X2's P5.1 with the layout rule; FS-10 against the overlay's Aa) belong to acceptance (AR-X6). Beside them, FS-11 (fix round 1, the coordinator's ruling): on a desktop browser with a real mouse, in full screen, in Pages, a click on a link to a place further down the same document stays there.

## Slips

Implementer subagents broke the "edit tools only" rule four times: one edited `pwa/src/screens/DocsScreen.tsx` once with a script (two imports and a function; the review read the result and found it right, and the function was then moved to `readerMode.ts` with the edit tools); two ran stray shell heredocs that wrote nothing; one appended a temporary debug block to the new browser test file with a shell heredoc while measuring, then removed it with the edit tool. No commit carries text written outside the edit tools other than that one edit, and the version-control tool's own merges and the icon generator (run by the coordinator's ruling).
