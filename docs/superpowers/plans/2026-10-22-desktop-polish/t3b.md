# Task T3b: names whole at the desk, and the row's ⋯ revealed under a mouse

A task note for the programme ledger (Task T3b, D-6332; the state-word arm: R21's F2, the operator's R121 Q2, and
D-7252). The coordinator folds what it needs into the ledger; this file is not the ledger.

**Where the figures come from.** The track widths and row heights below are a probe the worker ran in real Chrome on
production builds of the base (`66fd18299`) and the branch, on 2026-10-27. Its fixture is not committed, so the tables
cannot be reproduced from the tree as they stand; what the tree holds is `pwa/browser/row-fit.browser.test.ts`, whose
D-6332 block asserts the behaviour (forms drawn, at most two lines, nothing out of its box sideways) on a fixture of
its own. The probe's fixture: one project of seven busy rows named with 5 (`ws-br`), 7 (`ws-open`, the selected row),
12, 30, 60 and 104 hyphen-joined characters and one 60-character name joined by `_`. Every row's branch is
`ws/<name>`, which the row shows as its context cell whenever it differs from the name, except `ws-br`, whose branch is
48 characters. The base's heights were rounded to whole pixels; the branch's are given unrounded, measured again in
fix round 2 at its head, on the same fixture rebuilt. The first review of this task reproduced the branch column,
before the state-word arm existed, on a fixture of its own: Instrument status mode at 1280, 75.5 and 90.5 px; Refined
at 1280, 94.5 px. The table gives those figures today too: fix round 2's arm changes none of these rows.

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
  with no "…"; the hyphenated rows' heights are the same with and without it. A `Fit` pair's full text stays in the
  row button's `title` and in its accessible name. A plain name has no `title`: the clamp cuts it only as one unbroken
  token longer than two lines of its track, and its full text stays in the DOM, which is its accessible name, and in
  the session header (review 1115's F8; no `title` is added).
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

The row's height (`.sess-line`) by name length, from the probe above. The branch's figures are unrounded, measured at
fix round 2's head; the base's, in the last column, are the first probe's, rounded to whole pixels. In Instrument's
status mode the state-word arm (below) changes none of these rows: each long row's branch would not fit whole beside
the state word, so the figures are what the branch draws with or without the arm. "br" is the 5-character row with
the 48-character branch; every other row's context cell is its `ws/<name>` branch.

| View, width | track | br | 12 | 30 | 60 | 104 | base, rounded: br / 12 / 30 / 60 / 104 |
|---|---|---|---|---|---|---|---|
| Instrument status, 1280 | 223 | 54.75 | 39.75 | 75.5 | 90.5 | 90.5 | 40 / 40 / 57 / 57 / 57 |
| Instrument status, 1600 and 1920 | 303 | 39.75 | 39.75 | 39.75 | 90.5 | 90.5 | 40 / 40 / 40 / 40 / 40 |
| Instrument project, 1280 | 205 | 75.75 | 60.75 | 79.5 | 94.5 | 94.5 | 61 / 61 / 80 / 80 / 80 |
| Instrument project, 1600 and 1920 | 285 | 60.75 | 60.75 | 60.75 | 94.5 | 94.5 | 61 / 61 / 61 / 61 / 61 |
| Refined, 1280 | 185 | 75.75 | 60.75 | 94.5 | 94.5 | 94.5 | 61 / 61 / 80 / 80 / 80 |
| Refined, 1600 and 1920 | 265 | 75.75 | 60.75 | 60.75 | 94.5 | 94.5 | 61 / 61 / 61 / 61 / 61 |
| Every view, 360 | 226-244 | 61 | 61 | 61 | 61 | 61 | unchanged |

The 360 row is the first probe's, rounded. Fix round 1's head carried a first build of the arm, which squeezed these
rows' branch beside the state word: 73.5 px for the 30-, 60- and 104-character rows in status mode, and 54.75 for `br`
at 1600 and 1920 (this note then gave `br` there as 40, a reading from before that build). D-7252 retired it (below).

What a row pays, read from the boxes inside it:

- At 1280 the base already wrapped a long name's shortened form onto two lines, and the full name takes the same two
  lines. What the row gains there is its branch's second line, 15 px: the 48-character branch row (61 to 75.75 in
  Refined) and every long name's `ws/<name>` branch (80 to 94.5).
- At 1600 and 1920 a 60- or 104-character name takes a second line it did not have (about 19 px), and its branch a
  second line too (15 px): 61 to 94.5 in Refined.
- In Instrument's status mode a long name's two lines, its state word on a line of its own and its two-line branch
  make 90.5 px; the base, with the name shortened and the branch on one line, drew 57.

## R21 F2, R32 F2 and D-7252

The ledger gives T3b R21's F2 (a needs-you row's state word on the context line, or a wrapping name, in Instrument's
340 px column) and R32's F2 (a two-line row with no context is 53 px). T3b first took the wrapping-name arm alone. The
operator then ruled (R121, Q2, option 1) that T3b takes the other arm too before it lands: the state word on the
context line, so a long needs-you name no longer pushes it onto a line of its own. Review 1115 found the first build of
that arm cutting contexts (F1) and growing rows (F2), and the coordinator ruled D-7252: the arm never narrows a context
below the width it needs to sit whole (a programme with its wave tail, a child marker and a branch all stay whole), and
where the context will not fit whole beside the state word, the row lays out as it did before the arm. D-7252
supersedes D-7145's clause "does not edit instrument.css"; D-7145's "the wave tail is never cut" and D-5528 and
D-5545's "no fact dropped" stand.

The arm (`instrument.css`, the fine-pointer desk block): a status row with a context fact is a block, not the dense
flex row. Its name is an inline box at its own width, its state word floats to the end of the first line with room for
it, and its context is as wide as its text (`width: max-content`, capped at the line). A float leaves a box that will
not fit beside it to start below it, so:

- the state word stays beside the name when the two fit side by side, as before the arm;
- when they do not, it ends the context line, if the whole context fits there;
- otherwise it takes a line of its own, and the context sits below it at its whole width.

The state word never narrows the context, so no row is taller than it was before the arm. The state stays first in the
document, so the reading order is unchanged. A row with no context (a main checkout) keeps the flex row, so R32's F2 row
(53 px) is unchanged. The 2 px gap the flex row put between lines is now the float's top margin and the context's top
padding, so the state word's text stays level with the context's text when the two share a line.

Needs-you rows with a short branch for context, in px, measured in real Chrome on production builds of fix round 2's
head, and without the arm in parentheses (unchanged from fix round 1's head):

| Width | 30 characters | 60 characters | 104 characters |
|---|---|---|---|
| 1280 | 58.5 (75.5 without) | 58.5 (75.5) | 58.5 (75.5) |
| 1600 and 1920 | 39.75 (56.75) | 58.5 (75.5) | 58.5 (75.5) |

D-6716 records a long needs-you name at three lines, about 57 px, on `main`, where the name was shortened. With the arm
a two-line name is back at 58.5, and a name that fits one line at 1600 is two lines, 39.75 px. On the realistic fixture
of `instrument-desk.browser.test.ts` (names of 17 to 25 characters, each with its `ws/<name>` branch of 20 to 28
characters), the two needs-you rows' branches do not fit whole beside `waiting · needs you` in the 340 px column, so
at 1280 they are three lines, 56.75 px, as before the arm (fix round 1's arm made them 54.75 by squeezing the branch).
At 1600 `project-a-review-wave-two`'s branch fits, and the row is two lines, 39.75 px (56.75 without the arm).

### Review 1115's fixture, every row (fix round 2)

Review 1115's probe was not kept, so its fixture shape was rebuilt from its report: one project of 28 rows, needs-you
(`waiting · needs you`) and working, whose contexts are programmes with their wave tails, child markers and branches,
and names of 5 to 104 characters. Instrument status mode, fine pointer, both themes (every figure equal in the two), in
px: `main` (`2c5d8852a`) / fix round 1's head (`428a3a53e`) / that head without the arm / **fix round 2's head**. "(cut)"
marks a context cut sideways at fix round 1's head; none is cut at fix round 2's, and none runs under the state word.

| Row | State | Context | 1280 | 1600 | 1920 |
|---|---|---|---|---|---|
| `brn` | needs you | 48-character branch | 39.75 / 54.75 / 54.75 / **54.75** | 39.75 / 54.75 / 39.75 / **39.75** | 39.75 / 54.75 / 39.75 / **39.75** |
| `chnoboardn` | needs you | child marker, run not on the board | 39.75 / 39.75 (cut) / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** |
| `chrun0n` | needs you | child, `harbor-lite · wave 1 of 2` | 39.75 / 54.75 (cut) / 39.75 / **39.75** | 39.75 / 54.75 / 39.75 / **39.75** | 39.75 / 54.75 / 39.75 / **39.75** |
| `chrun1n` | needs you | child, `harbor-lights-desk · wave 12 of 14` | 39.75 / 69.75 (cut) / 54.75 / **54.75** | 39.75 / 54.75 / 39.75 / **39.75** | 39.75 / 54.75 / 39.75 / **39.75** |
| `chunreadn` | needs you | child marker unreadable | 39.75 / 39.75 (cut) / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** |
| 22-character name | needs you | `ws/nn22` | 56.75 / 39.75 / 56.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** |
| `pneed0` | needs you | programme `harbor-lite` (11), wave 1 of 2 | 39.75 / 54.75 (cut) / 39.75 / **39.75** | 39.75 / 54.75 / 39.75 / **39.75** | 39.75 / 54.75 / 39.75 / **39.75** |
| `pneed1` | needs you | programme `harbor-lights` (13), wave 3 of 5 | 39.75 / 54.75 (cut) / 39.75 / **39.75** | 39.75 / 54.75 / 39.75 / **39.75** | 39.75 / 54.75 / 39.75 / **39.75** |
| `pneed2` | needs you | programme `harbor-lights-ds` (16), wave 3 of 5 | 39.75 / 69.75 (cut) / 39.75 / **39.75** | 39.75 / 54.75 / 39.75 / **39.75** | 39.75 / 54.75 / 39.75 / **39.75** |
| `pneed3` | needs you | programme `harbor-lights-desk` (18), wave 12 of 14 | 39.75 / 69.75 (cut) / 54.75 / **54.75** | 39.75 / 54.75 / 39.75 / **39.75** | 39.75 / 54.75 / 39.75 / **39.75** |
| `pneed4` | needs you | programme `harbor-lights-desk-programme-for-rows` (37), wave 12 of 14 | 39.75 / 99.75 (cut) / 54.75 / **54.75** | 39.75 / 69.75 / 54.75 / **54.75** | 39.75 / 69.75 / 54.75 / **54.75** |
| `pneed5` | needs you | programme `harbor_lights_desk_polish` (25), wave 1 of 2 | 39.75 / 54.75 (cut) / 54.75 / **54.75** | 39.75 / 54.75 (cut) / 39.75 / **39.75** | 39.75 / 54.75 (cut) / 39.75 / **39.75** |
| 104-character name | needs you | `ws/rn104` | 56.75 / 58.5 / 75.5 / **58.5** | 56.75 / 58.5 / 75.5 / **58.5** | 56.75 / 58.5 / 75.5 / **58.5** |
| 60-character name | needs you | `ws/rn60` | 56.75 / 58.5 / 75.5 / **58.5** | 56.75 / 58.5 / 75.5 / **58.5** | 56.75 / 58.5 / 75.5 / **58.5** |
| `brw` | working | 48-character branch | 39.75 / 54.75 / 54.75 / **54.75** | 39.75 / 54.75 / 39.75 / **39.75** | 39.75 / 54.75 / 39.75 / **39.75** |
| `chnoboard` | working | child marker, run not on the board | 39.75 / 39.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** |
| `chrun0` | working | child, `harbor-lite · wave 1 of 2` | 39.75 / 54.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** |
| `chrun1` | working | child, `harbor-lights-desk · wave 12 of 14` | 39.75 / 54.75 / 54.75 / **54.75** | 39.75 / 39.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** |
| `chunread` | working | child marker unreadable | 39.75 / 39.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** |
| `ctxhi` | working | none (`ctx 90%` marker) | 36 / 36 / 36 / **36** | 36 / 36 / 36 / **36** | 36 / 36 / 36 / **36** |
| `pwork0` | working | programme `harbor-lite` (11), wave 1 of 2 | 39.75 / 54.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** |
| `pwork1` | working | programme `harbor-lights` (13), wave 3 of 5 | 39.75 / 54.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** |
| `pwork2` | working | programme `harbor-lights-ds` (16), wave 3 of 5 | 39.75 / 54.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** |
| `pwork3` | working | programme `harbor-lights-desk` (18), wave 12 of 14 | 39.75 / 54.75 / 54.75 / **54.75** | 39.75 / 39.75 / 39.75 / **39.75** | 39.75 / 39.75 / 39.75 / **39.75** |
| `pwork4` | working | programme `harbor-lights-desk-programme-for-rows` (37), wave 12 of 14 | 39.75 / 69.75 / 54.75 / **54.75** | 39.75 / 54.75 / 54.75 / **54.75** | 39.75 / 54.75 / 54.75 / **54.75** |
| `pwork5` | working | programme `harbor_lights_desk_polish` (25), wave 1 of 2 | 39.75 / 54.75 (cut) / 54.75 / **54.75** | 39.75 / 54.75 / 39.75 / **39.75** | 39.75 / 54.75 / 39.75 / **39.75** |
| `short-select` | working | none (the selected row) | 36 / 36 / 36 / **36** | 36 / 36 / 36 / **36** | 36 / 36 / 36 / **36** |
| 60-character name | working | `ws/wn60` | 56.75 / 58.5 / 75.5 / **58.5** | 39.75 / 58.5 / 75.5 / **58.5** | 39.75 / 58.5 / 75.5 / **58.5** |

No row is taller at fix round 2's head than without the arm, at any width; 12 rows at 1280 and 11 at 1600 and at 1920
are shorter than at fix round 1's head. Rows taller than on `main` (13 at 1280, 5 at 1600 and at 1920) are exactly as
tall without the arm: a long name, a 48-character branch or a long programme slug drawn whole on two lines at the
desk, D-7145's full forms, which `main` shortens. Refined's cards and Instrument's project mode: 0 rows of 28 changed
against fix round 1's head and against the head without the arm, at 1280, 1600 and 1920, in both themes.

`row-fit.browser.test.ts` commits the case ("a context the state word would cut keeps its whole width, and the row is
no taller than on main"): 16 rows (a programme and its wave tail, a child marker naming a run on the board, a child
marker whose run is not, a 26-character branch; needs-you and working; a short name and a 26-character one) at 1280,
1600 and 1920 in both themes. Nothing of a context is cut sideways (`scrollWidth` against `clientWidth`), its text
does not run under the state word, a context sharing its line with the state word is one line, and the row is no
taller than `main`'s, from a table measured on `main`'s own tree, where the same case with equality in place of the
bound passes in all six views. It was red at `428a3a53e` in all six.

## Mutation table, run

Each mutant was applied to a saved copy, its suite run, and the file restored from the copy with its sha256 checked.
The row-fit case once titled "a name longer than the track is shortened to fill it" is now "a name longer than the
track draws its full form on two lines, cut where the second ends" (review 1115's F9); the rows that name it ran under
the old title.

| Mutant | Suite | Result |
|---|---|---|
| desk rule unreachable (the 320 px container rule alone in force) | row-fit (browser) | red: "at 1280 and 1920, a 30-character name renders whole in both skins", "a name longer than the track draws its full form on two lines" |
| desk rule at `min-width: 0` | row-fit (browser) | red: the phone's token-shortened form case |
| clamp removed from the name | row-fit (browser) | red: "a name longer than the track draws its full form on two lines" |
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
| fix round 1's arm, as at `428a3a53e` (`instrument.css` at that head) | row-fit (browser) | red: "a context the state word would cut keeps its whole width, and the row is no taller than on main" (6 of 6: `cprog-n` cut, two lines beside the state word, 54.75 px) |
| the context's `width: max-content` removed (the state word may narrow the context again) | row-fit (browser), instrument-desk (browser), instrument-list | red: the same row-fit case (6 of 6: `cprog-n-quiet-harbor-lamps` cut, 54.75 px); the 1280 needs-you case (2 of 2, `the state word does not narrow the context: expected true to be false`); the arm's rule pin |
| the four state-word rules removed (`instrument.css`) | row-fit (browser), instrument-desk (browser), instrument-list | red: "a needs-you row keeps its state word on the context line, however long its name" (4 of 4); the 1600 case (2 of 2, `lines: expected 3 to be 2`); the arm's rule pin |
| the state's `float: right` removed | row-fit (browser), instrument-desk (browser), instrument-list | red: the needs-you case (4 of 4) and the D-7252 case (6 of 6); the two dense-row cases and the 1600 case (6 of 6, `rows that fit: expected [ 'project-a' ] …`); the arm's rule pin |
| the name's `display: inline-flex` removed | row-fit (browser), instrument-desk (browser), instrument-list | red: the D-7252 case (6 of 6, `cprog-n` 56.75 px against main's 39.75); the two dense-row cases (4 of 4); the arm's rule pin |

Fix round 1's three arm mutants (its rules removed, the context's `flex: 1 1 0` reverted, the state's `order: 1`
removed) were run at `b75aaea96` and are retired with those rules. With the four rules of fix round 2 removed,
instrument-desk goes red in two cases where fix round 1's rules went red in eight: under D-7252 that fixture's 1280
needs-you rows no longer take the arm, since their branches do not fit whole beside the state word.

No survivors among the rows run. Not run: a browser mutant for the branch clamp alone. Review 1079's F5 asked that
"fills the track" (which a block box always met) be replaced by an assertion that can fail. The replacement, "stays
inside its box sideways", has two copies: one in the long-name case, which measures the 60- and 104-character
hyphen-joined names, and one in "a plain name with no break point wraps inside its box on at most two lines", which
measures the plain 40-character name. The evidence is the second copy's: it failed on the base for that name, 305 px in
a 185 to 223 px box, and it is what the plain-label mutant above turns red. No recorded mutant turns the first copy red
(review 1115's F12).
