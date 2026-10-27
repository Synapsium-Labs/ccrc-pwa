# Task T3b: names whole at the desk, and the row's ⋯ revealed under a mouse

A task note for the programme ledger (Task T3b, D-6332). The coordinator folds what it needs into the ledger; this
file is not the ledger. Measured 2026-10-27 in real Chrome, on production builds of the base (`66fd18299`) and the
branch, with a fixture fleet of one project: rows named with 5, 7, 12, 30, 60 and 104 hyphen-joined characters and one 60-character name joined by `_`, every row busy, the
5-character row's branch 48 characters long, and a short row selected at the desk.

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
  ends (the browser's line clamp, which draws an "…" only there). Both boxes carry `overflow-wrap: anywhere`, so a
  token CSS cannot break (a name joined by `_` or `.`) wraps inside the box instead of running out of it sideways
  with no "…"; the hyphenated rows' heights are the same with and without it. The full text stays in the row button's `title` and
  in the `sr-only` accessible name.
- The programme slug and its wave tail are never clamped: the clamp is named for the name's box and the branch cell
  alone, and `fleet-css.test.ts` pins that no other rule declares one.
- Below 900 px nothing changes: the token-shortened form, with the 320 px container rule kept for a wide tablet's
  track.

The ⋯ reveal: inside `@media (hover: hover) and (pointer: fine)`, `.sess-actions` is `opacity: 0` until its row is
hovered, holds focus or is the selected row. Opacity only, with no transition: the button stays mounted, focusable,
in the accessibility tree, with its 44 px overlay and its `open-actions` door. A touch screen draws every row's ⋯.

## Row heights, base and branch (px)

The row's height (`.sess-line`) by name length. "br" is the 5-character row with the 48-character branch.

| View, width | track | br | 12 | 30 | 60 | 104 | base: br / 12 / 30 / 60 / 104 |
|---|---|---|---|---|---|---|---|
| Instrument status, 1280 | 223 | 55 | 40 | 76 | 91 | 91 | 40 / 40 / 57 / 57 / 57 |
| Instrument status, 1600 and 1920 | 303 | 40 | 40 | 40 | 91 | 91 | 40 / 40 / 40 / 40 / 40 |
| Instrument project, 1280 | 205 | 76 | 61 | 80 | 95 | 95 | 61 / 61 / 80 / 80 / 80 |
| Instrument project, 1600 and 1920 | 285 | 61 | 61 | 61 | 95 | 95 | 61 / 61 / 61 / 61 / 61 |
| Refined, 1280 | 185 | 76 | 61 | 95 | 95 | 95 | 61 / 61 / 80 / 80 / 80 |
| Refined, 1600 and 1920 | 265 | 76 | 61 | 61 | 95 | 95 | 61 / 61 / 61 / 61 / 61 |
| Every view, 360 | 226-244 | 61 | 61 | 61 | 61 | 61 | unchanged |

A long name or branch now costs its second line where the base shortened it to one. In Instrument's status mode at
1280 a name on two lines also moves the row's state word onto a line of its own, which is why the 30-character row
is 76 and not about 57.

## R21 F2 and R32 F2

The ledger gives T3b R21's F2 (a needs-you row's state word on the context line, or a wrapping name, in Instrument's
340 px column) and R32's F2 (a two-line row with no context is 53 px). T3b takes the wrapping-name arm and leaves
`instrument.css` alone. The state word dropping to a line of its own under a two-line name (the 76 and 91 above) is
what the other arm would remove. That is a layout change in `instrument.css`, outside this task's files, and is left
for a ruling.

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
| the focus-within arm removed | fleet-css | red: same case |
| a clamp on the programme slug | fleet-css | red: the clamp-scope case and "the programme half never ends in an ellipsis" |
| the clamp on the whole context line instead of the branch cell | fleet-css | red: the clamp-scope case |
| `overflow-wrap: anywhere` removed | row-fit (browser), fleet-css | red: the `_`-joined name runs out of its box sideways; the clamp-scope case |
| a clamp declaration moved out of the desk block | fleet-css | red: the clamp-scope case |

No survivors among the rows run. Not run: a browser mutant for the branch clamp alone.
