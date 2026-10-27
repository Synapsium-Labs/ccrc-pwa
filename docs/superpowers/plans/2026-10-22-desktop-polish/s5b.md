# Task S5b: the lanes fold at every width, the run's record

A task note for the programme ledger (Task S5b, D-6530, with the operator's R120 amendment). The coordinator folds what
it needs into the ledger; this file is not the ledger. Times are UTC, 2026-10-27.

## Starting point and the one sync

- The workspace branch started at `f75e8abae` (`main` after T2c's merge).
- One sync: `e63183700` merges `main` at `bb884cb7f`. Its one conflict was `pwa/test/plain-words.test.ts`, where S5b's
  case for `stripFold.ts`'s words and B5's rewrite of the dialog-open case sat at the same point. Both are kept.

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
- **Instrument's folded figure is above the 440 px target.** The fold saves the same 386 px in both skins. The 115 px
  between them is Instrument's own chrome above the strip, unchanged by S5b, and in no file S5b touches. The plan's
  target is derived from Refined's 422 and 761 and is asserted for Refined only (`refined-phone.browser.test.ts`). Read
  literally, the Acceptance paragraph says "a phone", so this is left to the coordinator to rule.
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
- **Parked:** at the desk, the first frame may paint the full strip before the row is measured and folds. Removing it
  needs a synchronous layout read in `useRowWidth`.

## Deviations, by slug

The R120 amendment's two items are named here by slug only: `strip-hover-flyout` (a hover flyout of every lane over the
desk's folded line) and `lanes-tie-break-soonest-reset` (lanes that tie on binding use sort by the binding window's
reset, soonest first, then by the other window's use, then by the roster). The pull request gives both numbers.
