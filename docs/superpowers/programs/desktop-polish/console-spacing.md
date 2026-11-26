# Console spacing at a desk: the task note (desktop polish wave 182, run 3870)

The note for wave 182, written by its worker for the coordinator to fold into the ledger. A new user's feedback said the
console's spacing was uneven at a desk: insets that differed from pane to pane, a header button that ran into the top bar,
and a lone New project button with nothing beside it. This wave measured the console, proposed one scale, and built it as
ruled (the rulings are the coordinator's mail, outside the tree; each is cited by what it decided).

Every claim says whether it was **measured** (read in a real Chrome on the sealed production build, or in a test run by this
wave) or **inferred**. All figures are CSS px. Chrome is the shared build named by `CCRC_CHROME`; the measuring script is a
throwaway browser file that was never committed.

## 1. In short

- **Instrument (the user's skin), at a desk:** every screen in both panes starts 16 (`--gutter`, now `var(--sp-4)` at a desk)
  from its pane's edge, at 1280 and at 1440. Before: 8, 14 or 16 by screen at 1280, and 84 at 1440, where the scaffold's 960
  column was centred. Every page's title sits in one `--head-h` row from the pane's top, and the list column's head row
  (the Status / Project switch with New project at its end) is centred on the same band. In Project mode the class
  chooser has a line of its own under that row, so the row, the switch and the door are one box in both modes (ruling A).
- **Header controls** in a page's head row take `min(--row-h, --tap-min)` under a mouse (Instrument 32 in its 40 row;
  Refined 44 in its 56 row), by one rule in the scaffold; under touch they keep the 44 tap floor.
- **Refined:** its detail screens agree with each other; its list column (16) and its centred page column stay, as ruled. Its
  desk runs line no longer crushes the Runs label onto three or four lines: the door and New project share the line, and
  the chooser has a line of its own under it, as in Instrument's Project mode (ruling A, condition 3).
- **The session screen** has one edge: header, banners, transcript and composer read one `--chat-inset` (16) in both skins.
- **The phone** holds its figures, except Waiting on you, which joins its scaffold's inset (ruling 6).
- **The Accounts head block**, built on merged main after #3402: the door's reason starts on the body's edge, the roll-up
  and the projection are one group, and four points of that PR's review are closed here; see §10.

## 2. The agreed scale

Ruled on the proposal (decisions 1 to 6), with the additions (a) to (d), the head-row control rule, the run-tally addition
and the session amendment.

| Between | Token | Where it is read |
|---|---|---|
| A pane's edge and its content, at a desk | `--gutter` (Instrument `var(--sp-4)` = 16 at 900 and up; Refined `--sp-6` = 24) | PageScaffold; `.wl`, `.wi`, `.wi-nav` (ledgers.css); `.digest-screen`; the Instrument list column |
| The pane's top and the head row | 0; the row is `--head-h` (Instrument 40 under a mouse, 44 under touch; Refined 56), its title and controls centred | PageScaffold; `.wl > .wl-head`; the Instrument list column's `.ins-head-row` |
| The head row and the first line under it | `--sp-2` (8) | scaffold body; `.wl` (a `--sp-2 - --sp-3` correction on the head, since the column's row gap is `--sp-3`) |
| Groups | `--sp-3` (12) | the scaffold body's `gap-3`; `.wl`'s row gap |
| Lines of one group | `--sp-1` (4) | the door reason and its fix (wave 180's block); the roll-up and the projection (§10) |
| A page column's inline margin | `--page-margin-inline`: `auto` (centred, the default and Refined's) or `0` (Instrument at a desk: the column starts at the gutter and its measure caps only the right) | a new skin role (ruling 2 (b)): tokens.css, the density class in skins.ts, Instrument's desk block in skins.css; read by PageScaffold and the column-role roots |
| A head-row control's height under a mouse | `min(var(--row-h), var(--tap-min))` | `PAGE_HEAD_CONTROLS` on `PAGE_HEAD_ROW` (page-scaffold.tsx) |
| The session screen's sides | `--chat-inset` = `var(--sp-4)` | `.chat` (chat.css): `.chat-head` at a desk, `.chat-banner`, `.chat-item`, `.composer`, the card's measure |

No new spacing value: every figure is an existing `--sp-*`, `--gutter`, `--head-h`, `--row-h` or `--tap-min`. The one fixed
pixel value this wave removed is Instrument's desk `--gutter: 14px`.

## 3. Measured before (main f07c1759ef)

PHOSPHOR palette, two fixtures: FIRST (one account, two exited main checkouts, no live session, the pool projection lagging
"epoch 0 / observed never synced", nothing waiting, the Add account door narrowed because sign-in is dark) and BUSY (three
accounts, eight sessions over three projects, two runs, three waiting items). The FIRST Instrument 1280 home and Accounts
shots reproduce the user's two screenshots. L and R are the pane's edge to the content's edge; the top is the first ink
below the pane's top.

| Skin, width | Pane / screen | L | R | First ink below the pane top |
|---|---|---|---|---|
| Instrument 1280 | list column | 16 (the lag line 20) | 16 | 14 (lag) / 12 box (New project, 44 tall, on its own row) |
| Instrument 1280 | Accounts, Settings, Mail (PageScaffold) | 14 | 14 | 10 to 12 (title centred in a 40 row) |
| Instrument 1280 | Waiting on you | 8 | 8 | 7 |
| Instrument 1280 | session header | 8 | 12 | 7 to 8 (transcript and composer at 16) |
| Instrument 1440 | Accounts, Settings, Mail | 84 (the 960 column centred) | 84 | 10 to 12 |
| Instrument 1440 | Waiting / session | 8 / 8 | 8 / 12 | 7 |
| Refined 1280 | list column | 16 | 16 | 14 |
| Refined 1280 | Accounts, Settings, Mail | 124 (the 760 column centred, gutter 24) | 124 | 12 (title centred in a 56 row) |
| Refined 1280 / 1440 | Waiting / session | 8 / 8 | 8 / 12 | 7 / 14 to 20 |
| Refined 1440 | Accounts, Settings, Mail | 191 | 191 | 12 |
| Instrument 390 | scaffold / Waiting / session / list | 12 / 8 / 8 / 16 | same | 5 / 7 / 13 / 16 to 19 |
| Refined 390 | scaffold / Waiting / session / list | 16 / 8 / 8 / 16 to 20 | same | 11 / 7 / 13 / 22 |

The Instrument 1280 Accounts head block (FIRST): the 40 head row with the title centred; Add account 44 tall under a mouse,
overflowing the row by 4 and touching the top bar; the door's reason 8 below; its command field 4 below that; "1 account" 12
below; "Next workspace lands on …" 12 below; the first card 12 below.

## 4. Measured after: every detail-pane screen (addition (a))

Measured on this branch's head (e7d1e395ba, before any merge of main), the same build and fixtures as §3, every screen that
draws in the detail pane, at both desk sizes. "L" is the pane's edge to the content's left edge; "top" is the first ink
(or a control's box) below the pane's top. The figure before is main's, measured the same way. The BUSY fixture's figures
are given; the FIRST fixture's agree wherever a screen draws the same content (Run detail and Runs advanced draw only with
BUSY's run; Overlord with BUSY's designation). The Docs reader is out of scope.

| Screen | Instrument 1280: L before → after, top | Instrument 1440: L before → after | Refined 1280: L before → after, top | Refined 1440: L before → after | Top line after |
|---|---|---|---|---|---|
| List column | 16 (lag 20) → 16, 12 | 16 → 16 | 16 → 16, 14 | 16 → 16 | Instrument: the head row (switch and New project; Project mode's chooser on the line under it) centred in `--head-h`; Refined: its runs line (door and New project), the chooser on the line under it |
| Accounts | 14 → 16, 10 | 84 → 16 | 124 → 124, 12 | 191 → 191 | scaffold head row |
| Settings | 14 → 16, 10 | 84 → 16 | 124 → 124, 12 | 191 → 191 | scaffold head row |
| A Settings section (`/settings/updates`) | 14 → 16, 3 (the Back glyph; its box 4 to 36) | 84 → 16 | 124 → 124, 11 | 191 → 191 | scaffold head row with Back |
| Mail | 14 → 16, 10 | 84 → 16 | 124 → 124, 12 | 191 → 191 | scaffold head row |
| Archive | 14 → 16, 10 | 84 → 16 | 124 → 124, 12 | 191 → 191 | scaffold head row |
| Overlord (designated) | not drawn before (fixture) → 16, 10 | → 16 | → 124, 12 | → 191 | scaffold head row |
| Runs | 14 → 16, 10 | 14 → 16 | 24 → 24, 12 | 24 → 24 | scaffold head row (wide column) |
| Run detail | not drawn before (fixture) → 16, 10 | → 16 | → 124, 12 | → 191 | scaffold head row |
| Runs advanced | not drawn before (fixture) → 16, 10 | → 16 | → 24, 12 | → 24 | scaffold head row (wide column) |
| Waiting on you | 8 → 16, 10 | 8 → 16 | 8 → 24, 18 | 8 → 24 | `.wl` head row in `--head-h` (Refined's title is centred in its 56 row; its ink starts lower than the page titles' because the type is smaller) |
| A Waiting item (`/waiting/1`) | 8 → 16, 22 | 8 → 16 | 8 → 24, 21 | 8 → 24 | the step strip, held at 44 (§8) |
| Programme | 8 → 16, 15 | 8 → 16 | 8 → 24, 15 | 8 → 24 | its own first line, not a head row: needs more (§11) |
| Upkeep | 8 → 16, 15 | 8 → 16 | 8 → 24, 15 | 8 → 24 | as Programme (§11) |
| Coordinator digest | 8 → 16, 7 | 8 → 16 | 8 → 24, 7 | 8 → 91 (its own measure, centred) | its own heading, not a head row: needs more (§11) |
| Session | header 8 → 16, 7 | 8 → 16 | 8 → 16, 14 | 8 → 16 | its own bar (header, transcript and composer on one 16 edge; §9) |

At 390x844 (measured, same run): Waiting on you moved 8 → 12 (Instrument) and 8 → 16 (Refined), its scaffold's inset (ruling
6); every other phone figure is as before: scaffold 12 / 16, list column 16, session 8, and the phone bar's own back row
(Digest, a Waiting item) at 8.

The Epic screen shares Upkeep's root (`wl ep`) and so its inset; it was not opened by the measure (inferred).

## 5. What changed, by file

- `ui/src/styles/tokens.css`, `ui/src/styles/skins.ts`, `ui/src/styles/skins.css`: the role `--page-margin-inline` (default
  `auto`), listed in the density class; Instrument's desk block sets `--gutter: var(--sp-4)` (was `14px`) and
  `--page-margin-inline: 0`.
- `ui/src/primitives/page-scaffold.tsx` (ruling 2 (b), the coordinator's word for this one ui change): the head row, the
  body and the nav grid read `mx-(--page-margin-inline)` instead of `mx-auto`; the head row carries `PAGE_HEAD_CONTROLS`.
  No primitive's own padding changed. Its story and the token census say the same.
- `pwa/src/ledgers/ledgers.css`: `.wl` reads `--gutter` at every width; at a desk `.wl`, `.wi` and `.wi-nav` take their
  full width, `--gutter` and the page margin role, and a `.wl` with a head starts with a `--head-h` head row. `.wl` is also
  the root of Programme, Epic and Upkeep and of the item route's notes, so they move with it.
- `pwa/src/screens/digest.css`: the digest screen takes the gutter and the page margin role at a desk.
- `pwa/src/session/chat.css`: `--chat-inset` on `.chat`, read by the header (at a desk, in the file's existing desk block),
  the banner, the transcript items, the composer and the card's measure.
- `pwa/src/skins/instrument/FleetTable.tsx`, `instrument.css`: at a desk the list column's head row holds the switch and New
  project, at `--row-h`, centred in `--head-h`. In Project mode the class chooser takes a line of its own under the row
  (`.ins-chooser-line`), `--sp-2` above and below it, to the lag line or the first group alike (ruling A, condition 1); the
  pool lag line sits under it. When a banner shows on top of the column, the column keeps the
  `--sp-3` gap above it that the item route's banner stack has, instead of the band's centring.
- `pwa/src/screens/FleetScreen.tsx`, `pwa/src/fleet/NewProjectDoor.tsx`: the screen draws no door row and no lag line of
  its own where a skin's list heads itself (and keeps the lag where no list is drawn yet, the first-run panel). At a desk
  the runs line (Refined's) holds the Runs door and New project, and the class chooser has a line of its own under it
  (`.fleet-chooser-line`), spaced by the column's own `--sp-3` gap above and below; the phone keeps the three on one line.
- `pwa/src/fleet/fleet.css`, `pwa/design/audit.mjs`, `pwa/test/role-census.test.ts`: the Accounts head block, after #3402
  (§10).
- `pwa/src/fleet/fleet.css` (a peer packet, agreed by the file's holder, wave 180): in the sheet's existing desk block,
  the runs line wraps, the Runs door is never narrower than its words, and New project takes a second line at its end.
  With the chooser on its own line the door and New project fit the line at 1280 and 1440, so the wrap is now only the
  guard for a narrower fit (the file's holder agreed this hunk before ruling A; it is unchanged).

## 6. New pins, each red first

All in `pwa/browser/console-spacing.browser.test.ts`, 50 cases, at 1280x800 and 1440x900, both skins and both palettes
(PHOSPHOR and light) where the case names them, and at 390x844. Every case was run against the source before its fix and
failed for the reason it pins (measured; the logs are the worker's, outside the tree):

| Describe | Red first | Why it was red |
|---|---|---|
| Instrument at a desk: one inset and one head line (insets, the title band, New project and the lag line, the head-block gaps) | 16 of 16 | insets 8, 14 and 84; the list column's head at 12 and the lag at 20; New project 44 tall on its own row |
| Refined at a desk: its detail screens agree | 8 of 8 | Waiting and the session header at 8; the Waiting title outside the head band |
| The phone holds its figures; Waiting joins its scaffold's inset | 2 of 2 (with the two describes above: 26 of 26 in one run) | Waiting at 8 against the scaffold's 12 / 16 |
| A page's head-row controls (rule (c)) | 4 of 8 (Instrument; Refined's 44 in a 56 row passed before, as it should) | Add account and the scaffold's controls 44 in a 40 row: the row grew to 44 and the title moved off the band |
| A session screen has one edge | 4 of 8 (Refined; Instrument passed before at 16) | Refined's header 8 right of the transcript after the gutter rule; 8 left of it on main |
| Refined's desk runs line: the door and New project share it, the chooser has a line of its own | 4 of 4, twice: first as "the line wraps" (the door's words on 3 and 4 lines, red before the `fleet.css` hunk), then as ruling A's arrangement (red before the chooser moved: the line held the door, the chooser and New project) | as named |
| The Accounts head block on the merged door (#3402) | 4 of 4, each of its three claims in turn (§10) | the reason 8 right of the body's edge; the roll-up and projection 12 apart; the live region's margin overridden |

Outside that file, ruling A's new case in `pwa/browser/fleet-toggle-row.browser.test.ts` ("the head row, the switch and New
project hold one box in both modes, the chooser's line on the rhythm", at 900, 1280 and 1440, mouse and touch) was red on
6 of 6 (the head row 68 in Project mode against 32 under a mouse, 92 against 44 under touch), with the file's changed
(a) cases red on 4 of 4 for the same reason, and green after (14 of 14).

The ring check (the focus ring inside the 40 row) is a mouse-only assertion; under touch a 44 control in a 44 row puts its
2 px ring outside the row by design (§8). The label check measures each control's em box against its own box, not its
scroll box, so the Back chevron's glyph overhang does not read as a cut.

## 7. Changed claims (existing tests whose claim moved with the ruling)

- `pwa/test/instrument-shell.test.tsx`: at a desk the column draws no `.fleet-head`; `.ins-head-row` holds the door, and
  the `.ins-lag` line after it carries the lag text only when the epochs differ.
- `pwa/test/older-server-render.test.tsx`: the head row's class is stripped before the byte comparison; Instrument's
  projects-head count stays 0.
- `pwa/test/fleet-add-project.test.tsx`: one case renamed (a bare screen heads the list itself); two new cases for a skin
  whose list heads itself (no door row, no lag line) and for no list drawn yet (the head keeps the lag).
- `pwa/test/page-scaffold.test.tsx`: the body and the head row read the role class and not `mx-auto`; the token census
  has `--page-margin-inline`.
- `pwa/test/role-census.test.ts` (a peer packet, agreed by its holder): the scaffold's control rule is allowlisted with its
  reason, and the D-5102 assertion names it.
- The tap-floor pins on the head-row controls (condition 3 of the (c) ruling). A first pass over every `pwa/browser` file
  on this branch (124 files, in batches of six) found one: `pwa/browser/runs-widths.browser.test.ts`'s "puts Start a
  program in the header …" case held the door at `--tap-min`; the door is a head-row control, so its floor is now
  `min(--row-h, --tap-min)` read from the page (32 under a mouse in Instrument; 44 in Refined and under touch). It was red
  on six cases (Instrument, both palettes, 1280, 1470 and 1920: 32 against 43), and is green after (231 of 231). Every
  other control outside a head row is still held at 44 by its own file, and the head-row describe in
  `console-spacing.browser.test.ts` asserts a body control in the same screen stays at the tap floor.
- `pwa/browser/fleet-toggle-row.browser.test.ts` (ruling A, condition 2): "the chooser is on the toggle row" is now "the
  chooser is under the head row, never on it, never overlapping the radiogroup or New project"; "one height in both modes"
  and the 150% and 200% text cases stay as they were; the header comment says the claim changed and why.
- `pwa/test/instrument-list.test.tsx`: Project mode's chooser is on `.ins-chooser-line`, the row's next sibling, not on the
  toggle's row.
- `pwa/test/instrument-shell.test.tsx`'s "Refined keeps its runs row at every width": at 900 and up the chooser is on
  `.fleet-chooser-line` under the runs line; at 390 and 899 it is on the runs line as before.
- `pwa/test/fleet-characterization.test.tsx` (came with main): the Fleet's desk picture reads New project before the class
  chooser, which now has a line of its own (ruling A). The file forbids editing its text by hand, so the desk `column`
  was re-measured by the file's own measuring code on 9b5c885f1c, through a probe run once and then removed (the file
  restored from a saved copy and compared with `cmp`), and a note in its header says so; every other field of both
  pictures is still the base's.
- `pwa/generated/reviewLabFixture.ts`: Export's bytes inline `@ccrc/ui`'s tokens, so the fixture gains
  `--page-margin-inline: auto;` in its two copies; regenerated with the one command its test names, never edited.
- `pwa/browser/item-nav.browser.test.ts` was red on its banner case (a banner atop the list column at 4 against the item
  route's 12) and was not changed: the source was, so a banner keeps the 12 gap (§5).

## 8. Rule (c): head-row controls under a mouse

One rule, `pointer-fine:[&_:is(button,select)]:min-h-[min(var(--row-h),var(--tap-min))]` on the scaffold's head row. Under
a mouse it is `@media (pointer: fine)`, the same condition as Instrument's density rule that already gives the Status /
Project switch its 32. A touch laptop gets whatever its browser reports as its primary pointer: with a trackpad or mouse as
the primary pointer it reports `fine` and the head controls are 32 (Instrument) in a 40 row; a touch-only screen reports
`coarse` and keeps 44 in a 44 row (inferred from the media query's definition; no touch laptop was measured).

What stays 44, and why:

- **The session screen's keycaps** (the header's controls on the session screen): that header is not a PageScaffold head
  row and keeps its own bar; the ruling held it at 44.
- **The item view's step strip** (‹ and the step controls on a Waiting item): held at 44 by the ruling, with no step-strip
  head row; its top line is the strip's (22 below the pane top at 1280).
- **Every control outside a head row**: the rule is scoped to the head row's descendants, and the head-row case asserts a
  body control in the same screen stays 44.

## 9. What was held

- **Refined's session sits at 16** while Refined's other detail screens sit on its 24 gutter: header, transcript and
  composer share `--chat-inset` (16), an accepted limit (the session amendment). Moving the transcript and composer onto
  `--gutter` would move every Refined session's reading column, which is more than this wave.
- **Refined's list column stays at 16 and its page column stays centred** (ruling 4): equal panes would mean a 24 list
  column, which worsens the runs line, or dropping Refined's centred column, which is its look.
- **The touch focus ring**: a 44 control in a 44 head row draws its 2 px ring outside the row under touch, as before.
- **The pool lag line on a single-box install** ("epoch 0 / observed never synced") is something a first-run person
  cannot act on; whether it shows there at all is its owner's question, not this wave's. It now sits under the head row,
  so the head row's position no longer depends on it.
- **The session keycaps and the item step strip at 44** (§8).

## 10. The Accounts head block (built after #3402 merged)

Built after #3402 merged (main 277d443e63; this branch absorbed main once, at the coordinator's word, as the second of the
two waves to land). Re-measured first on the merged tree, Instrument 1280, FIRST (measured):

| Line | On merged main, before this part | After |
|---|---|---|
| Head row | 40, title centred; Add account 32 (rule (c), already on this branch) | unchanged |
| The door's reason, its disclosure and its command field | starts 24 from the pane (the reason's permanent `--sp-2` start padding, the first review's deferred F10) | 16, the body's edge: the reason hangs its padding into the gutter with a negative start margin at a desk, so the tap mark (the 3 px bar, and the 2 px outline under forced colours) keeps its 8 px room outside the words |
| "1 account" to "Next workspace lands on …" | 12 | 4 (`--sp-1`): one group in the body's `--sp-3` grid |
| Reason block to "1 account" | 12 | 12 (`--sp-3`, unchanged) |

Both rules sit in `fleet.css`'s first desk block, so the phone keeps its figures. From the second review of #3402 (run
3901), also this wave's:

- **A1:** the reason's paragraph rule is `.acct-door-reason > p:not(.sr-only)`, so the visually hidden live region keeps its
  `sr-only` margin (-1px; it was `0px -1px`). The role census and the contrast registry's `INHERITED_GROUNDS` entry (in
  `pwa/design/audit.mjs`, claimed free of any other holder before the edit) are keyed to the same text; nothing else in
  that list moved. The disabled-door selector list the contrast exemption is keyed by (A2) is untouched.
- **A3:** `pwa/browser/connect-sheet.browser.test.ts` checks that the chevron turns to 45° when the disclosure opens and
  back to -45° when it closes, in every cell. Red first by mutation (the `.acct-door-more[open]` selector dropped, the
  sheet restored from a saved copy and compared with `cmp`): 16 of 20 cases red (every cell's door case timed out waiting
  for the open turn); green on the source, 20 of 20.
- **A9:** D-9106 is cited beside the stood-down rules in `fleet.css`.
- **F10:** as above. The forced-colours case in `connect-sheet.browser.test.ts` stays green.
- **Add account's pin:** the head-row control case asserts Add account is one of the Accounts head row's controls,
  measured at the head-row figure (it was among the controls red first under rule (c): 44 in a 40 row).

The new Accounts case in `console-spacing.browser.test.ts` ("the door's reason starts on the body's edge …") was red on
4 of 4 (both skins, both desk sizes), and each of its three claims was shown red in turn by fixing the others first: the
reason 8 right of the body's edge; then the roll-up and projection 12 apart against 4; then the live region's margin
`0px -1px` against `-1px`. Green after, with the head-row control cases (12 of 12).

By hand, as the coordinator asked after a padding change: the insecure-origin sentence is 2 lines at 360 and 390 in
both skins (33 px Instrument, 36 px Refined) and 1 at 1280 (measured with a throwaway browser file, not committed). The
desk-only rules cannot reach the phone widths, and the figures match the review's.

Not touched: `accountWords.ts`, `ConnectSheet.tsx` and their tests (wave 181's claim), the words, the door's press look,
and the chevron's shared rules with the Settings fold.

## 11. Unmeasured, and what needs more than the two roles

What needs more than the two roles (`--gutter` and `--page-margin-inline`), listed as the ruling's addition (a) asks, not
built:

- **Programme, Epic and Upkeep** take the inset now, but their first line is their own title block (15 below the pane's
  top), not a `--head-h` head row: giving them one means a head row in each screen's markup, not a role.
- **Coordinator digest** takes the inset, but its heading is its own (7 below the top), and in Refined at 1440 its column
  centres at the digest's own measure (91 from the pane), not at `--page-max` (191). Both are the screen's own rules.
- **A Waiting item's step strip** keeps its 44 controls and its top line (21 to 22), held by the ruling (§8).

Unmeasured:

- **A touch laptop** (§8): what a real one reports as its primary pointer was not measured; the 32 / 44 split follows the
  media query's definition.
- **The Epic screen** was not opened by the measure (it shares Upkeep's root; inferred).
- **Widths between the two desk sizes, and above 1440**: the pins and the measure ran at 1280x800 and 1440x900 only. Every
  rule reads tokens that change at 900, and none reads the window's width otherwise, so 900 to 1279 and above 1440 are
  inferred to hold, not measured.
- **Themes other than PHOSPHOR and light**: spacing reads no colour, so the other palettes are inferred to match.

## 12. tally-clock-test: the run tally browser file's page clock

`pwa/browser/run-tally.browser.test.ts` built its fixture's "last seen 5m ago" from the file's `NOW`, while the page read
its own clock, so a case rendered more than about a minute after the file loaded (the 1920 cases, last, on a loaded box)
read "6m" and failed. A commit of its own (f9b2d0d3a5) pins the page clock to the file's `NOW` with
`page.clock.setFixedTime(NOW)` before each `page.goto`, leaving the page's timers running.

- Red first (measured): with the page clock set 90 s ahead of `NOW` and no pin, 40 of 40 cases failed (the words read
  "6m ago" against "5m ago").
- After (measured): 40 of 40 pass, run alone.

## 13. Pictures (addition (d))

Taken from the sealed build of main f07c1759ef (before: a detached checkout of that commit in the worker's temp root, built by
the browser harness) and of this branch's head (after), PHOSPHOR, the FIRST fixture unless named, in
`docs/design/2026-10-22-desktop-polish/console-spacing/`, beside the programme's other tasks' pictures (the judge's layout
keeps images out of the notes folder):

| What | Before | After |
|---|---|---|
| Instrument, 1280x800, home (the user's first screenshot) | [before](../../../design/2026-10-22-desktop-polish/console-spacing/before-first-instrument-1280-home.png) | [after](../../../design/2026-10-22-desktop-polish/console-spacing/after-first-instrument-1280-home.png) |
| Instrument, 1280x800, Accounts (the user's second) | [before](../../../design/2026-10-22-desktop-polish/console-spacing/before-first-instrument-1280-accounts.png); on merged main, before this wave's Accounts part: [merged main](../../../design/2026-10-22-desktop-polish/console-spacing/merged-main-first-instrument-1280-accounts.png) | [after](../../../design/2026-10-22-desktop-polish/console-spacing/after-first-instrument-1280-accounts.png) |
| Refined, 1280x800, home | [before](../../../design/2026-10-22-desktop-polish/console-spacing/before-first-refined-1280-home.png) | [after](../../../design/2026-10-22-desktop-polish/console-spacing/after-first-refined-1280-home.png) |
| Instrument, 1280x800, Project mode (ruling A, condition 4) | [before](../../../design/2026-10-22-desktop-polish/console-spacing/before-first-instrument-1280-project.png) | [after](../../../design/2026-10-22-desktop-polish/console-spacing/after-first-instrument-1280-project.png) |
| Refined, 1280x800, home, BUSY fixture (Refined has no Project mode: its list is always by project, so this is its Project view, with "Runs · 2 active") | [before](../../../design/2026-10-22-desktop-polish/console-spacing/before-busy-refined-1280-home.png) | [after](../../../design/2026-10-22-desktop-polish/console-spacing/after-busy-refined-1280-home.png) |

Each was viewed after it was taken (measured). In the Instrument after pictures the switch, New project and the Accounts
title share one band, Add account is 32 tall inside its row, and both panes start at 16; in Project mode the head row is
the same as in Status mode, with the chooser on its own line under it. In Refined's, "Runs · —" and "Runs · 2 active" are
one line beside New project, with the chooser on the line under them (before: four lines in a 27 px box).

## 14. Evidence runs

Every run went through `ccrc test`, one process at a time, on this branch merged with main (merge 3c49ad6e26, main
44f2b15a3b, which holds #3402's merge 277d443e63; main had not moved when the runs started). Measured.

| Run | Head | Result |
|---|---|---|
| The whole pwa jsdom set, 626 files (622 under `test/`, 4 under `src/`), in eight parts | 9b5c885f1c | 624 files green; 2 files red, 3 cases: `fleet-characterization.test.tsx` (the desk column's order after ruling A) and `review-lab-fixture.test.tsx` (the generated fixture missing the new token), both changed claims this wave had not yet carried, fixed in bc14acde87 (§7). 19,464 passed, 3 failed, 2 skipped |
| The two red parts again, whole (160 files) | bc14acde87 | green: 2,710 passed and 2 skipped; 1,707 passed |
| Every file under `pwa/browser`, 125 files, in 21 parts of six | parts 2 to 21 on bc14acde87; part 1 started 40 s before that commit, so it was run again on it (below) | 124 files green; 1 case red: `linear-items.browser.test.ts`, "linear-initiatives: whole, contained and in view at instrument, light, 360px", a 20 s `waitForSelector` timeout. 4,471 passed, 1 failed, 52 skipped, 1 expected fail |
| `linear-items.browser.test.ts` alone | bc14acde87 | green, 160 of 160. The red is inferred to be the load: one timeout at a phone width, where no rule of this wave applies (every one is a desk rule), and green alone |
| Part 1 again (six files) | bc14acde87 | green, 112 of 112 |
| `pwa/browser/connect-sheet.browser.test.ts`, as the coordinator asked | 9b5c885f1c, and in part 5 on bc14acde87 | green, 20 of 20, both times |
| The growth check, armed (`GROWTH_CHECK=1` inside `ccrc test`) | 9b5c885f1c | green, 100 of 100; `fleet.css` +20 / -4 lines, under its cap, no waiver |
| `ui`'s own typecheck (`tsc --noEmit`) | bc14acde87 | clean |

The memory cap: four browser parts (2, 5, 6 and 9) report that the shared test slice's cap killed a process during their
run, and in each every file still passed (exit 0), so no file of this branch was the one killed; none needed a re-run for
it. No jsdom part reported a kill. No browser install was run. Two hooks spoke during the wave, and neither refused a
command: the workspace's graph gate held a search until one graph query had been asked first (its standing rule, then
met), and the landing hook advised on the one merge of main, which the brief (the second of the two waves to land absorbs
main) and the coordinator's word after #3402's merge licensed (§10).

The pull request's own fast run does not run the browser leg; its result is in the wave-done mail.
