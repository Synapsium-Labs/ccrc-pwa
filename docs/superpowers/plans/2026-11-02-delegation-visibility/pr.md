# Delegation visibility, first release: the worker's note

The note the plan asks for (`2026-11-02-delegation-visibility.md`, "Ledger route"), for the coordinator to fold into
the ledger. It records the departures fix rounds 1, 2 and 3 made (reviews 1424, 1431 and 1435, each ruled in a
coordinator's fix-round mail of 2026-11-04), the minors and advisories taken and left, and what was measured. Round 1
itself departed from nothing: every Find block matched the base as written. Fix rounds 2 and 3 refine D-7783, D-7784
and D-7785, as the coordinator ruled, and take no new number; D-7786 stays spare.

## Deviations found

The coordinator lifted the plan's CSS cap ("two new rules, no existing rule changes") for review 1424's F1, F2 and F3
only, because spec §4 (a phone shows no titles) and spec §1-§3 (every recorded entry is reachable) outrank it. Each fix
below is a departure from the plan's text, and takes one of the plan's spare numbers, in order.

- **D-7783** — `a-narrow-row-cuts-only-its-name` (review 1424 F1; the coordinator's fix-round mail, 2026-11-04). At
  390 px a row with a long name lost its condition word and its `from <…>` part to a hard clip. Now only the row's one
  free-text part (an agent's name, a worktree's admin record) ends in an ellipsis, and every other part is drawn whole.
  - The words module decides which part that is. `activityLine`, `worktreeLine` and `unownedLine` return `nameAt`, the
    index of that part or `null`, in a new `WorkWords` shape, and `EntryRow` extends it. This is a change to the plan's
    Task 1 interfaces.
  - `WorkLine` gives that one part the class `proj-work-name`. `ProjectCard`'s `workLine`, `FleetCards`' region and
    `SessionDetails`' list hand `nameAt` through.
  - `activityLine`'s part order is the base's, unchanged.
  - CSS (`fleet.css`): `.proj-work-parts` gains `flex-wrap: wrap` and loses its `text-overflow`, which never painted on
    its flex items.
  - New rule `.proj-work-part` (`flex: 0 1 auto; min-width: 0; white-space: normal; overflow-wrap: anywhere`): a part
    keeps its width, and moves whole to the next line when the line is full. Only a part wider than a whole line (the
    browser fixture's 66-character raw session id) shrinks, and it then breaks inside itself.
  - New rule `.proj-work-name` (`flex: 1 1 0; min-width: 0; max-width: max-content`, with an ellipsis): its basis of 0
    never pushes a word to the next line, and it grows into what the line leaves, up to its own length, so a short row
    looks as it did.
  - W4-U32 (`fleet-css.test.ts`, "tokens only") gains one exception, written like its existing border-hairline one:
    `max-width: max-content` on `.proj-work-name` alone. That keyword is a layout relation that no token carries.
  - The two false "ends in an ellipsis" comments, `chat.css` (`.sess-entries`) and the older one in `fleet.css`
    (`.proj-nest > .proj-work`), now say what happens.
  - Pinned in `delegation-rows.browser.test.ts`. On every card row and region row, at 390, 1280 and 1920 in both skins
    and both palettes, the condition word and the last part each lie wholly inside `.proj-work-parts`, measured as
    boxes. The header case below checks its own rows too.
  - The mutant VIS-M16 puts back the base's `.proj-work-parts` block without the two new rules. Measured in fix round
    1, when the file had 16 cases: all 16 went red, on the condition word or the last part. The file now has 19 (12
    card cases, 4 header cases at 390, 2 mouse cases at 1280, 1 remount case); fix round 3 added assertions, not
    cases.
  - **Fix round 2 (review 1431 F2): the name gets a floor.** A basis of 0 let line breaking ignore the name, so at the
    1280 desk sidebar a worktree's admin record was squeezed to 7-12 px. `.proj-work-name` is now `flex: 1 1 8ch`. Its
    hypothetical size is `min(8ch, its own length)`, so the line breaks before the name would get less. Above that it
    grows into what the line leaves, up to its own length, and only then ends in an ellipsis. A name shorter than 8ch is
    drawn at its own width.
    - The floor is a flex basis. W4-U32 does not value-check `flex`, and a count of characters is not a design-scale
      length a token would carry.
    - The guard (`measureParts`) checks every card row and region row with a name, at every width and in both skins,
      and since fix round 3 the header's entry rows at 390 (review 1435 G3): the name part keeps at least
      `min(8ch, its own length)`, measured with a probe in the name's own font, from the test's own figure of 8.
    - VIS-M24 (basis back to 0) reds the two Instrument 1280 cases (light and phosphor), where the name measured
      30.47 px against a floor of 42.5 less the tolerance; Refined stays green (corrected in fix round 3, review 1435
      G2a).
  - **Fix round 2 (review 1431 F3): `nameAt` and the ellipsis are pinned.**
    - VIS-W5 (`delegation-words.test.ts`) asserts each line's `nameAt` and that `parts[nameAt]` is the name. That covers
      an activity with and without a name, a worktree, an unowned tree and a header row.
    - The browser file asserts that at 390 the two long-name rows (a card row and the region row) and the header's
      long entry have a name part that is cut (`scrollWidth > clientWidth`) with a computed `text-overflow: ellipsis`.
    - VIS-M25 (`nameAt: null`) and VIS-M26 (an activity's `nameAt` off by one) each red VIS-W5 and 8 browser cases.
      VIS-M27 and VIS-M28 (off by one in `worktreeLine` and `unownedLine`) red VIS-W5.
  - **Fix round 2 (review 1431 D): no wrapped line starts with a lone middot.** The coordination row's remedy (#633)
    drops the glyph for a gap. Here that would run a free-text name into the words beside it, so the glyph stays, moved
    into the gap with CSS only.
    - `.proj-work-parts` takes `column-gap: var(--sp-3)`.
    - Each part after the first draws its middot as an absolutely placed `::before` (`right: 100%`, the gap's width,
      centred) beside its own box. A part that starts a wrapped line has its middot outside `.proj-work-parts`, which
      clips it with its overflow.
    - Round 2 had the name part clip with `overflow: clip` and an `overflow-clip-margin` of the gap's width, so its own
      middot was not clipped with its text. WebKit has no `overflow-clip-margin`, so on Safari and every iOS browser
      that middot was cut away. Fix round 3 moves the clip off the part (below).
    - A one-line row's spacing is exactly the gap, `--sp-3` (12 px). The old margins and glyph drew 10.2 to 10.4 px (8 px
      of margin plus the glyph's advance, 2.41 px at 12 px and 2.21 px at 11 px), so each separator is 1.6 to 1.8 px
      wider, about 8 px on a six-part row, and a row within that of full wraps or cuts its name slightly sooner
      (corrected in fix round 3, review 1435 G2d; the `fleet.css` comment says the same).
    - The guard reads, for every part after the first that starts a line, whether its middot's box lies inside the
      clipping words box. At 390 the region row's `from` part starts a line (asserted), so a real wrapped line is
      measured. At 1280 and 1920 nothing asserts a line start, so there the arm may have nothing to measure; VIS-M29
      nonetheless reds all 12 card cases, so every card case has one (review 1435 G3).
    - VIS-M29 (the middot back in flow) reds 12 cases, `no line starts with a middot`.
  - **Fix round 3 (review 1435 F1): no part that draws a separator is under a clip.** Round 2's name part clipped its
    own text with `overflow: clip` and kept its middot only through `overflow-clip-margin`, which WebKit does not
    support, so on Safari and every iOS browser the middot before the name was cut away. The `.sess-meta` precedent did
    not carry over: there the clip loses a focus ring, here it loses a glyph.
    - `WorkLine` now draws the name's text in a box of its own, `.proj-work-name-text` (`display: block; overflow:
      hidden; white-space: nowrap; text-overflow: ellipsis`). That inner box alone clips and ends in the ellipsis.
      `hidden` alone serves: the box holds nothing focusable and nothing outside it to keep, so no `overflow: clip` and
      no fallback line are needed.
    - `.proj-work-name` keeps only its flex sizing (`flex: 1 1 8ch; min-width: 0; max-width: max-content`) and clips
      nothing. `overflow-clip-margin` is gone from the sheet.
    - Pinned in `delegation-rows.browser.test.ts`: every part that draws a separator computes `overflow-x: visible`, on
      every card and region row at every width, and on the header's entry rows at 390.
    - VIS-M33 (round 2's shape back: `overflow: clip` and `overflow-clip-margin` on `.proj-work-name`) reds 16 cases, on
      `every separator's part computes overflow-x: visible` (`expected [ 'read the plan' ]`). Chromium draws that shape,
      so only this row can see it.
    - VIS-M34 (`overflow: hidden` on `.proj-work-name`, no margin) reds the same 16 cases on the same row.
  - **Fix round 3 (review 1435 F2): the CSS round 2 added is pinned by what it draws.**
    - The name's cut: the ellipsis pin now reads the inner box, and asserts its computed `overflow-x` is not `visible`
      besides `scrollWidth > clientWidth` and `text-overflow: ellipsis`. With `visible` the text paints on over the next
      part. VIS-M35 (the inner box's `overflow` back to `visible`) reds 8 cases, the four card cases at 390 (`map every
      caller: its text's box clips`) and the four header cases (`the long entry is cut: … clips: false`).
    - The separator's place: for every part after the first that shares a line with the part before it, the gap
      between the two is at least 6 px, and a tap at the gap's centre, on the separator's line, reaches the part. Only
      the part's `::before` lies there, so this measures where the glyph's box is drawn. Each page must measure at least
      one mid-line separator.
    - VIS-M36 (`position: relative` dropped from `.proj-work-part`) reds 16 cases, `every mid-line separator is drawn in
      its gap` (`expected [ 'read the plan', 'not confirmed' ]`): the separators' containing block moves to a far
      ancestor and leaves the row.
    - VIS-M37 (`column-gap` dropped from `.proj-work-parts`) reds the same 16 cases on the same row: the gap is 0, so the
      glyph covers the end of the word before it.
    - VIS-M29 (the middot back in flow) now reds 16 cases, first on the same mid-line row, since a card row's in-flow
      glyph leaves the gap empty.
    - A hermetic supplement, VIS-CSS3 (`fleet-css.test.ts`), reads the same declarations from the sheet: `column-gap`,
      `position: relative`, no `overflow` or `overflow-clip-margin` on the part or the name, and the inner box's
      `overflow: hidden`, `text-overflow: ellipsis` and `white-space: nowrap`. VIS-M33 to VIS-M37 each red it too. It is a
      supplement, never instead of the measured rows.
  - **Fix round 3 (review 1435 G1): a name that fits is drawn whole.** At 1280 and 1920, in both skins and palettes,
    the coordinator row's `read the plan` (13 characters, longer than the floor) is not cut. This is asked before the
    floor, so the grow half of `flex: 1 1 8ch` is pinned by more than the floor's sub-pixel margin. VIS-M38
    (`flex: 0 1 8ch`) reds 16 cases: the eight desk card cases on `read the plan: drawn whole`, and the 390 and header
    cases on the floor (58.33 against 58.625, 63.64 against 64).
  - **Fix round 3 (review 1435 G5): only a part draws a separator.** The selector is now `.proj-work-parts >
    .proj-work-part:not(:first-child)::before`, so a child that is not a part, and so not the `::before`'s containing
    block, never takes one.
  - **Fix round 3 (review 1435 G3): the header's entry rows get the card rows' checks.** The header case at 390 now runs
    `measureParts` over its three entry rows: the condition word and the last part whole, the name at its floor, no line
    starting with a middot, and every separator unclipped and in its gap. It is run last, because it scrolls each row
    into view.
- **D-7784** — `the-header-entry-list-takes-its-own-line-in-the-refined-rail` (review 1424 F2; the same mail). In
  Refined below 900 px, `.chat-facts` is `display: contents`, so the opened list was the one shrinkable item of a
  no-wrap sideways rail, and it collapsed to a width of 0.
  - Smallest shape that holds (`refined.css`, phone block): while the list is open, `.chat-head
    .ref-chip-rail:has(.sess-entries) { flex-wrap: wrap }`. The rail wraps as the desk's rail always does, and the
    list's existing `flex-basis: 100%` gives it a line of its own under the chips.
  - A second rule, `.chat-head .ref-chip-rail .sess-entries .chat-fact { white-space: normal }`, lets the list's note
    wrap. The rail's `nowrap` would otherwise run it past the list as one line.
  - Closed, the rail is unchanged.
  - The list then opens at the rail's start, while the rail is still scrolled to where the operator swiped to reach the
    toggle. So `SessionDetails` gives the list a stable callback ref (`showEntries`, module level, adding no hook) that
    calls `scrollIntoView({ block: 'nearest', inline: 'start' })` once, as the list mounts. Where nothing scrolls it
    moves nothing.
  - Rejected while measuring:
    - A width floor alone (`flex: none; width: 100%`) held the words, but the list opened off the screen to the right,
      and the screenshot showed a taller, empty header.
    - Keeping that floor beside the wrap rule was redundant, because the wrap alone holds (mutant measured green), so it
      was dropped.
  - Pinned by a new case in `delegation-rows.browser.test.ts`: the session header at 390 in both skins and both
    palettes, the details door and the list open, with a long-name entry and a rail full of chips. Each row must have a
    width, its condition word must be whole and on screen, the toggle must stay on screen, and the note must wrap
    inside the list.
  - Measured red, Refined's cases each time: VIS-M18 (no wrap) on the row's width 0, VIS-M19 (`showEntries` a no-op)
    on a condition word off the screen, and VIS-M17 (no note rule) on the note.
  - **Fix round 2 (review 1431 F): the list is brought into view only by the tap that opens it.**
    - `SessionDetails` sets `openedByTap` (a `useRef`) in the toggle's handler when it opens the list.
    - `showEntries` (now a `useCallback` with no dependencies) spends the flag on the list's next mount. A remount, such
      as a withdrawn frame coming back while the disclosure stays open, scrolls nothing.
    - The scroll is no longer `scrollIntoView`, which also scrolls `overflow: hidden` ancestors such as the desk's
      pane. `bringIntoRail` moves only the nearest ancestor whose `overflow-x` is `auto` or `scroll` and has something
      to scroll, and only sideways. Where none scrolls, nothing moves.
    - Pinned in Refined at 390. The tap case: the tap brings the list to the rail's start (`scrollLeft` at most 1). The
      remount case: with the list open, the frame is withdrawn, the rail is scrolled to its end and the frame comes
      back, and the rail stays where it was left.
    - VIS-M30 (the flag ignored) reds the remount case. VIS-M18 and VIS-M19 red the tap case too.
    - The header now adds a `useState`, a `useRef` and a `useCallback`, and still no `useId`.
- **D-7785** — `the-header-toggles-take-the-tap-floor` (review 1424 F3; the same mail). `.chat-facts .sess-meta >
  *::before { content: none }` removes the card's tap overlay with the middots, so the header's subagent toggle (an
  inherited defect) and the new delegated toggle had their text line as their hit area.
  - `chat.css` adds `.chat-facts .sess-subagents { min-height: var(--tap-min); min-width: var(--tap-min) }`, which is
    header-only.
  - **Corrected in fix round 2 (review 1431 F1).** Round 1 said the floor was given back on a fine pointer through the
    existing `@media (pointer: fine)` block, so that a desk with a mouse renders as before. That was false. The reset
    and the floor are both unlayered and of equal specificity, so the later floor won on every pointer, and the desk
    header grew 24 to 26 px. The details door's reset works only because its floor is a layered utility.
    - The floor now sits under `@media (pointer: coarse)`, and the `pointer: fine` block is back to main's text. That
      drops round 1's `min-width: 0` on the two doors, review 1431's dropped advisory E.
    - Gated rather than re-ordered: the floor is for a touch screen, and saying so on the rule makes it independent of
      where any reset sits.
    - A desk with a mouse keeps the toggles' base size and the header its base height, which is the operator's ruling
      of 2026-10-15 recorded in `chat.css`.
  - Pinned by the same header case. At 390 (a touch screen in the harness, `(pointer: coarse)` asserted) both toggles
    are at least `--tap-min` (44) tall, and a tap at their centre reaches them.
    - Round 1 also asserted their width. Both texts are wider than 44, so that assertion could never go red (review
      1431). It is replaced by the computed `min-width`, which only the rule sets.
  - A new case at 1280 with a mouse, in both skins, measures each toggle's height and the header's height against the
    same page with every minimum the toggles could take removed. Both must be equal, and each toggle stays under 44.
  - Mutants:
    - VIS-M20 (the rule's body emptied) reds all four header cases on a height of 18.
    - VIS-M32 (`min-width` dropped) reds them on the width floor.
    - VIS-M23 (the floor unconditional) reds both 1280 cases: toggles 44 against a base of 18.
  - The census: `control-census.test.ts`'s `classHasFloor` matches any rule naming the class whose body mentions the
    floor. Making it see that a `::before` floor cannot apply would mean modelling the cascade's specificity. No such
    change keeps every other row's verdict by construction, so the census function is left alone. The new rule now
    gives the `sess-subagents` row's TOKEN claim a real floor in the header on a coarse pointer. Since fix round 3 its
    text says so: the floor applies under `(pointer: coarse)`, and with a mouse the toggles keep their base size
    (review 1435 G2e). Only that entry of `control-census.test.ts` is edited; another programme adds one entry near
    `docs-copy` in that file by agreement.

## Minors (review 1435)

Taken: G1, G2 (a) to (e), G3 and the selector half of G5. Each is under its D-number above, or corrects this note.

Considered and left, as the coordinator ruled:
- G4: a re-opened details door brings round 1's off-screen list back. The list lives inside the details, which unmount
  when the phone door closes while `delegatedOpen` survives, so a re-open mounts the list with `openedByTap` false and
  nothing scrolls. It needs five things together, it meets the ruling's letter ("only on the tap that opens it, never
  on a remount"), and the remount case pins that. A known residual for the rider.
- The rest of G5: `bringIntoRail` walks past a rail with nothing to scroll (the comment and the code agree); touch
  laptops (a fine pointer, any pointer coarse) get the header toggles' base size, as the details door beside them
  does, within round 2's F1 ruling; W4-U32 does not value-check `flex`, `column-gap` or `right`.

## Minors (review 1424)

Taken:
- a: `SessionDetails.tsx`'s comment no longer says the header "calls no hook it did not call". Since fix round 2 it
  adds a `useState`, a `useRef` and a `useCallback`, and no `useId` (corrected in fix round 3, review 1435 G2c).
- c: W4-U33's title says attached entries of any liveness, not live activities.
- d: VIS-C1's header-side count-less case now has a mutant that reds it. VIS-M15 is `holds` written as
  `c.count !== undefined && !(h.count! < c.count)`, and it reds VIS-C1 on that case alone. No test change was needed.
- e: VIS-U3's released row has a name (`released worker`) different from its id, and reads `from released worker`.
  VIS-M22 (`labelOf` returning the raw id) reds it, and VIS-P1 too.
- f: `readDelegation` does NOT guarantee a string `openedAt`, because it spreads the member as it came. `byOpened` now
  reads both keys through a `sortKey` that treats a non-string as `''`, so a malformed member sorts first and never
  throws, in `nestFleet`, `FleetCards` or the session header. New rows: VIS-W4 (`delegation-words.test.ts`) and
  VIS-U5 (`fleet-screen.test.tsx`). VIS-M21 (the raw `localeCompare` back) reds both.

Not taken, left for the rider as the coordinator ruled: b (the closed phone header lifts no `delegated` fact), g, h,
i, j, k, l and m (list semantics for the two new lists).

## Advisories (review 1431)

Taken: D, F and the header case's width assertion. Each is under its D-number above.

Considered and left, as the coordinator ruled:
- G: the Refined rail wraps every chip while the list is open. This is the shape measured and chosen in round 1, and
  the close side needs no extra row.
- `.sess-subagent-list` is another shrinkable item of the Refined rail. That is older than this PR and goes to the
  rider.
- The other single-pass readings (`reached` guards only an overlay; the header case checks the condition word
  horizontally and against the rail's box) and the earlier minors b and g-m go to the rider.

## Measured

- An Instrument case in `session-header.browser.test.ts` fails on this box: the header at 900 px measures 200.8 px
  against its 188 px bound. It fails the same way at the round-1 tip `865cf8c7d` (sources restored to that tip and
  re-run). The CI browser shards were green at both the round-1 tip and the fix round 1 tip, so it is this box's
  environment, not this change. Review 1435 measured the same two cases failing at `origin/main` with the identical
  figure, 200.8125 against 188.
- Fix round 3's mutants were each run from a saved copy with its sha, one edit at a time, the named files alone, then
  restored and checked with `sha256sum -c` (all OK). VIS-M23 to VIS-M30 and VIS-M32 were run again at the fix round 3
  tree: VIS-M23 reds the two 1280 mouse cases, VIS-M24 the two Instrument 1280 cases, VIS-M25 VIS-W5 and 16 browser
  cases, VIS-M26 VIS-W5 and 8, VIS-M27 and VIS-M28 VIS-W5, VIS-M29 16, VIS-M30 the remount case, and VIS-M32 the four
  header cases.
- `origin/main` moved by two docs-only commits after round 1. They merge cleanly (merge-tree exit 0). None of the worker
  skill's absorb triggers held, so they were not merged in.
