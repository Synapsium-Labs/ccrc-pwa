# Task T3b: names whole at the desk, and the row's ⋯ revealed under a mouse

A task note for the programme ledger (Task T3b, D-6332). The coordinator folds what it needs into the ledger; this
file is not the ledger.

**Where the figures come from.** The track widths and row heights below are a probe the worker ran in real Chrome on
production builds of the base (`66fd18299`) and the branch, on 2026-10-27. Its fixture is not committed, so the tables
cannot be reproduced from the tree as they stand; what the tree holds is `pwa/browser/row-fit.browser.test.ts`, whose
D-6332 block asserts the behaviour (forms drawn, at most two lines, nothing out of its box sideways) on a fixture of
its own. The probe's fixture: one project of seven busy rows named with 5 (`ws-br`), 7 (`ws-open`, the selected row),
12, 30, 60 and 104 hyphen-joined characters and one 60-character name joined by `_`. Every row's branch is
`ws/<name>`, which the row shows as its context cell whenever it differs from the name, except `ws-br`, whose branch is
48 characters. Heights were rounded to whole pixels. The review of this task reproduced the branch column on a fixture
of its own: Instrument status mode at 1280, 75.5 and 90.5 px; Refined at 1280, 94.5 px. The probe's unrounded
readings agree (75.5 and 94.5 for the 30-character row, re-read at the fix-round head).

## Step 0: the track the name has

The `.sess-body` track, in px, on the base:

| View | 360 | 390 | 1280 | 1600 | 1920 |
|---|---|---|---|---|---|
| Refined | 226 | 256 | 185 | 265 | 265 |
| Instrument, status mode (the default) | 244 | 274 | 223 | 303 | 303 |
| Instrument, project mode | 226 | 256 | 205 | 285 | 285 |

The name's font is 500 15px/18.75px Geist. The plan's mechanism, `.sess-body`'s container query at 320 px, never
fires at any of these widths: the desk's narrowest track (185) is narrower than a phone's (226). So on the base every
name over 28 characters drew its token-shortened form at the desk too.

## The mechanism: `desk-rule-not-container-threshold`

A width threshold on the track cannot tell the desk from a phone, so the desk is picked by the viewport instead:

- From `@media (min-width: 900px)` (the desk breakpoint), the full form of every `Fit` pair draws: the name, the
  branch or PR context cell, and the programme slug.
- The name and a branch cell may take two lines, wrapping at their token breaks, and are cut where the second line
  ends (the browser's line clamp, which draws an "…" only there). That holds for every name: a `Fit` pair's
  (`.sess-label-fit`) and a plain one that `shortenByToken` leaves whole, within the budget or one unbroken token
  (`.sess-open > .sess-label`). Every clamp box carries `overflow-wrap: anywhere`, so a token CSS cannot break (a name
  joined by `_` or `.`, or one with no separator at all) wraps inside the box instead of running out of it sideways
  with no "…"; the hyphenated rows' heights are the same with and without it. The full text stays in the row button's
  `title` and in the `sr-only` accessible name.
- The programme slug and its wave tail are never clamped: the clamp is named for the name's boxes and the branch cell
  alone, and `fleet-css.test.ts` pins that no other rule declares one.
- Below 900 px nothing changes: the token-shortened form, with the 320 px container rule kept for a wide tablet's
  track.

The ⋯ reveal: inside `@media (hover: hover) and (pointer: fine)`, `.sess-actions` is `opacity: 0` until its row is
hovered, holds a keyboard's focus (`:has(:focus-visible)`) or is the selected row. A pointer's focus reveals nothing:
a row whose ⋯ took the focus from a click, or got it back from a sheet closed with the mouse, lights no second ⋯
beside the selected row's. While any row of the fleet is hovered, every other row's ⋯ goes dark,
the selected and the focused row's included, unless that ⋯ itself holds the keyboard's focus: one ⋯ at a time under a
mouse, the plan's acceptance. Opacity only, with no transition: the button stays mounted, focusable, in the
accessibility tree, with its 44 px overlay and its `open-actions` door. A touch screen draws every row's ⋯.

## Row heights, base and branch (px)

The row's height (`.sess-line`) by name length, from the probe above. The Instrument status rows were measured again
after the state-word arm (below), on the same fixture rebuilt, and are given unrounded; the base's were measured before it. "br" is the 5-character row with the
48-character branch; every other row's context cell is its `ws/<name>` branch.

| View, width | track | br | 12 | 30 | 60 | 104 | base: br / 12 / 30 / 60 / 104 |
|---|---|---|---|---|---|---|---|
| Instrument status, 1280 | 223 | 55 | 40 | 73.5 | 73.5 | 73.5 | 40 / 40 / 57 / 57 / 57 |
| Instrument status, 1600 and 1920 | 303 | 40 | 40 | 40 | 73.5 | 73.5 | 40 / 40 / 40 / 40 / 40 |
| Instrument project, 1280 | 205 | 76 | 61 | 80 | 95 | 95 | 61 / 61 / 80 / 80 / 80 |
| Instrument project, 1600 and 1920 | 285 | 61 | 61 | 61 | 95 | 95 | 61 / 61 / 61 / 61 / 61 |
| Refined, 1280 | 185 | 76 | 61 | 95 | 95 | 95 | 61 / 61 / 80 / 80 / 80 |
| Refined, 1600 and 1920 | 265 | 76 | 61 | 61 | 95 | 95 | 61 / 61 / 61 / 61 / 61 |
| Every view, 360 | 226-244 | 61 | 61 | 61 | 61 | 61 | unchanged |

What a row pays, read from the boxes inside it:

- At 1280 the base already wrapped a long name's shortened form onto two lines, and the full name takes the same two
  lines. What the row gains there is its branch's second line, 15 px: the 48-character branch row (61 to 76 in
  Refined) and every long name's `ws/<name>` branch (80 to 95).
- At 1600 and 1920 a 60- or 104-character name takes a second line it did not have (about 19 px), and its branch a
  second line too (15 px): 61 to 95 in Refined.
- In Instrument's status mode the state word now sits on the context line (below). A long name's two lines and its
  `ws/<name>` branch, which wraps beside the state word to two lines of its own, make 73.5 px; before the arm the state
  word took a line of its own under a two-line name, and those rows were 76 and 91.

## R21 F2 and R32 F2

The ledger gives T3b R21's F2 (a needs-you row's state word on the context line, or a wrapping name, in Instrument's
340 px column) and R32's F2 (a two-line row with no context is 53 px). T3b first took the wrapping-name arm alone. The
operator then ruled (R121, Q2, option 1) that T3b takes the other arm too before it lands: the state word on the
context line, so a long needs-you name no longer pushes it onto a line of its own.

The arm (`instrument.css`, the fine-pointer desk block): a status row with a context fact gives its name the whole
first line, or two, and draws the state word at the end of the context line; the context takes what the state leaves
(`flex-basis: 0`, so the two always share one flex line) and wraps inside it. The state stays first in the document,
so the reading order is unchanged. A row with no context (a main checkout) keeps the state beside its name, so R32's
F2 row (53 px) is unchanged.

Needs-you rows with a short branch for context, in px, measured in real Chrome on production builds of this branch
with and without the arm:

| Width | 30 characters | 60 characters | 104 characters |
|---|---|---|---|
| 1280 | 58.5 (75.5 without) | 58.5 (75.5) | 58.5 (75.5) |
| 1600 and 1920 | 39.75 (56.75) | 58.5 (75.5) | 58.5 (75.5) |

D-6716 records a long needs-you name at three lines, about 57 px, on `main`, where the name was shortened. With the arm
a two-line name is back at 58.5, and a name that fits one line at 1600 is two lines, 39.75 px. On the realistic
fixture of `instrument-desk.browser.test.ts` (names of 17 to 25 characters, each with its `ws/<name>` branch), the two
needs-you rows are 54.75 at 1280 (56.75 without), `project-a-review-wave-two` is 39.75 at 1600 (56.75), and every other
row is unchanged. No row grew.

## Mutation table, run

Each mutant was applied to a saved copy, its suite run, and the file restored from the copy with its sha256 checked.

| Mutant | Suite | Result |
|---|---|---|
| desk rule unreachable (the 320 px container rule alone in force) | row-fit (browser) | red: "at 1280 and 1920, a 30-character name renders whole in both skins", "a name longer than the track is shortened to fill it" |
| desk rule at `min-width: 0` | row-fit (browser) | red: the phone's token-shortened form case |
| clamp removed from the name | row-fit (browser) | red: "a name longer than the track is shortened to fill it" |
| `display: none` on the hidden ⋯ | fleet-css | red: "the ⋯'s reveal sits inside the fine-pointer media query, and uses opacity only" |
| `opacity: 0` on the unconditional `.sess-actions` rule | fleet-css | red: same case |
| the reveal under `(pointer: coarse)` | fleet-css | red: both reveal cases |
| the selected-row arm removed | fleet-css | red: "a hovered, focused or selected row shows ⋯" |
| the focus arm removed (then `:focus-within`) | fleet-css | red: same case |
| a clamp on the programme slug | fleet-css | red: the clamp-scope case and "the programme half never ends in an ellipsis" |
| the clamp on the whole context line instead of the branch cell | fleet-css | red: the clamp-scope case |
| `overflow-wrap: anywhere` removed | row-fit (browser), fleet-css | red: the `_`-joined name runs out of its box sideways; the clamp-scope case |
| a clamp declaration moved out of the desk block | fleet-css | red: the clamp-scope case |
| the plain `.sess-label` taken out of the clamp rule | row-fit (browser), fleet-css | red: "a plain name with no break point wraps inside its box on at most two lines" (6 of 6, the 40-character name 305 px wide in a 185 to 223 px box); the clamp-scope case |
| the desk's full-form rule narrowed to the name and branch cells | row-fit (browser) | red: "the programme slug renders whole at the desk" (12 of 12) |
| the rule that darkens the other rows' ⋯ under a hover removed | row-fit (browser), fleet-css, hover-states | red: "under a mouse one row shows its ⋯ at a time" (12 of 12, two ⋯ lit); "a hovered, focused or selected row shows ⋯"; the hover census |
| that rule without its `:not(:focus-visible)` | fleet-css, hover-states | red: "a hovered, focused or selected row shows ⋯"; the hover census |
| the keyboard arm widened back to `:focus-within` | row-fit (browser), fleet-css, hover-states | red: "a ⋯ given focus back by a sheet closed with the mouse lights no second ⋯ at rest" (12 of 12, two ⋯ lit); "a hovered, focused or selected row shows ⋯"; the hover census |
| the keyboard arm removed | row-fit (browser), fleet-css, hover-states | red: the same browser case (12 of 12, the Tab-focused row's ⋯ dark); "a hovered, focused or selected row shows ⋯"; the hover census |
| the state-word arm's three rules removed (`instrument.css`) | row-fit (browser), instrument-desk (browser), instrument-list | red: "a needs-you row keeps its state word on the context line, however long its name" (4 of 4); 8 instrument-desk cases (`the state word is on the context line: expected false`); the arm's rule pin |
| the context's `flex: 1 1 0` set back to `1 0 100%` | row-fit (browser), instrument-desk (browser), instrument-list | red: the same cases |
| the state's `order: 1` removed | instrument-list | red: the arm's rule pin (the browser files are not red: the state and the context share the line either way) |

No survivors among the rows run. Not run: a browser mutant for the branch clamp alone. The "stays inside its box
sideways" assertion that replaced "fills the track" (which a block box always met) failed on the base for the plain
40-character name, 305 px in a 185 to 223 px box.
