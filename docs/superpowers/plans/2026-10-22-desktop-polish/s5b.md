# Task S5b: the lanes fold at every width, the run's record

A task note for the programme ledger (Task S5b, D-6530, with the operator's R120 amendment). The coordinator folds what
it needs into the ledger; this file is not the ledger. Times are UTC, 2026-10-27.

## Starting point and the syncs

- The workspace branch started at `f75e8abae` (`main` after T2c's merge).
- `e63183700` merges `main` at `bb884cb7f`. Its one conflict was `pwa/test/plain-words.test.ts`, where S5b's case
  for `stripFold.ts`'s words and B5's rewrite of the dialog-open case sat at the same point. Both are kept.
- `e1ce78246` merges `main` at `244cf377e`, a sync the coordinator licensed. Its conflicts were the header blocks of
  `pwa/test/instrument-shell.test.tsx` and an import in `pwa/browser/refined-bar.browser.test.ts`, both against T2d
  (#1706). Both sides are kept.

## Step 0, measured on `f75e8abae` (real Chrome, the shared 17-lane fixture, unfolded)

- Refined at 390×844: the strip's top at 88 px and its height 556 px, the first `.sess-line` at 805 px. Cards `w0` and
  `w5` 50 px, `w3` and `w4` 63.8 px, the end cell 44 px.
- Instrument at 390×844: the strip's top at 116 px, the first `.sess-line` at 920 px.
- The desk's cards group, both skins: 868, 1248 and 1888 px wide at 900, 1280 and 1920, an 8 px gap, so 3, 4 and 7
  tracks, as the plan said.
- R18's 761 px on S5a's tree was not re-measured: that tree's build passed its 170 s limit under memory pressure.
- C8 had not merged, so the strip still runs its own poll. No PWA surface renders the rate-limited state word yet.

## Step 4, measured on the final tree

| View | Folded | Expanded | Before |
|---|---|---|---|
| Refined, 390×844, first session row | 418.8 px | 805 px | 805 px |
| Instrument, 390×844, first session row | 533.8 px | 920 px | 920 px |
| Desk cards in the folded line, 900 / 1280 / 1920, both skins | 2 / 3 / 6 | every lane | every lane |

- 360 and 438 measure as 390 does. No view scrolls sideways, and the control is 44 px under coarse emulation.
- **Instrument's folded figure is above the 440 px target, and its bound is its own
  (`instrument-first-row-is-its-chrome`).** The fold saves the same 386 px in both skins, and the strip is the same
  height in both. The 115 px between the skins is Instrument's own chrome, none of it S5b's:
  - 28 px sits above the strip: Instrument's fleet head puts the strip at 116 px against Refined's 88.
  - 87 px sits between the strip and the first row: Instrument's table toggle, tabs and group header take 140 px
    against Refined's 53.

  The coordinator ruled: Refined keeps "at most 440 px", and Instrument is held to its measured figure, at most 540 px
  at 390×844, folded. `refined-phone.browser.test.ts` asserts each bound, and its case titles name the skin.
- At 900 and 1920 the desk control's words wrap to three lines inside the end cell, as the plan asks ("their words
  wrapping inside it, never widening it"). The folded strip is then 51 px against 44 px cards, every item at one top.

## What the plan did not foresee

- **The flyout's Escape.** R120's Escape closes the flyout. At the desk, an Escape that reached the window would also
  run the session screen's Escape interrupt (`useEscapeInterrupt`), with no confirmation. The strip now prevents the
  default of an Escape it handles, the rule D-5235 set for sheets, and an Escape with nothing to close goes on.
- **The flyout's name.** It is a second group of the same lanes, so it carries its own name (`FLYOUT_LABEL`, "every
  lane"), not the line's.
- **A focus guard proved dead and was removed.** Focus handed back to the line on Escape starts inside the strip, so the
  `relatedTarget` test already reads it as a move.
- **The flyout's close rule, as ruled.** The flyout stays open while either the pointer or focus is inside the line or
  the flyout, and closes when neither is. This clarifies `strip-hover-flyout`'s "closes when focus leaves both"; it
  does not change it. Until the fix round, a pointer leaving with focus inside started the close grace anyway, and it
  cancelled an open that focus had started. Both now wait for focus.
- **A flyout made moot while it holds focus.** If another tab expands the strip, a poll leaves nothing to fold, or the
  desk ends, the flyout leaves the DOM in the same commit. Its focus now goes to the line's tab stop, through the same
  hand-back as Escape, not to the page.
- **Parked, measured:** at the desk, the first frame with lanes paints the full strip before the row is measured and
  folds. The review saw it on every load it sampled (3 of 3), for one animation frame. Removing it needs a synchronous
  layout read in `useRowWidth`.

## CI

- **A guard reached CI unrun.** CI's first run (`ac89e9bd2`) went red in `css-vars.test.ts`. The strip set
  `--lane-card-min` only in its inline style, so no stylesheet declared it. Step 5's sixth command, the full pwa suite,
  runs that guard, and it was not run locally. The miss came from skipping that command, not from a gap in the plan.
  The fix declares the token `initial` in the strip's rule. The inline style always outranks it, and the figure is
  still written once.
- **The browser leg hit its time cap.** `browser (pwa)` was cancelled at its 15-minute cap on `ac89e9bd2` and on
  `e1ce78246`, after all of its files had passed. Main's own merge-queue runs of that leg already took 860 to 886 s of
  its 900 s. S5b's new cases added about 56 s. The fix round runs S5b's geometry-only browser cases under one theme:
  they measure counts, tops, lefts, overlap and scroll width, which the palette does not change. The leg's cap is
  `ci.yml`'s, and S5b leaves it alone.

## Deviations, by slug

The R120 amendment's two items are named here by slug only: `strip-hover-flyout` (a hover flyout of every lane over the
desk's folded line) and `lanes-tie-break-soonest-reset` (lanes that tie on binding use sort by the binding window's
reset, soonest first, then by the other window's use, then by the roster). The pull request gives both numbers.
