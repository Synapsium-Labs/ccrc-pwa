# Delegation visibility, first release: the worker's note

The note the plan asks for (`2026-11-02-delegation-visibility.md`, "Ledger route"), for the coordinator to fold into
the ledger. It records the departures fix rounds 1 and 2 made (reviews 1424 and 1431, each ruled in a coordinator's
fix-round mail of 2026-11-04), the minors and advisories taken and left, and what was measured. Round 1 itself departed
from nothing: every Find block matched the base as written. Fix round 2 refines D-7783, D-7784 and D-7785, as the
coordinator ruled, and takes no new number; D-7786 stays spare.

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
  - The mutant VIS-M16 puts back the base's `.proj-work-parts` block without the two new rules. All 16 browser cases go
    red, on the condition word or the last part.
  - **Fix round 2 (review 1431 F2): the name gets a floor.** A basis of 0 let line breaking ignore the name, so at the
    1280 desk sidebar a worktree's admin record was squeezed to 7-12 px. `.proj-work-name` is now `flex: 1 1 8ch`. Its
    hypothetical size is `min(8ch, its own length)`, so the line breaks before the name would get less. Above that it
    grows into what the line leaves, up to its own length, and only then ends in an ellipsis. A name shorter than 8ch is
    drawn at its own width.
    - The floor is a flex basis. W4-U32 does not value-check `flex`, and a count of characters is not a design-scale
      length a token would carry.
    - The guard (`measureParts`) checks every row with a name, at every width and in both skins: the name part keeps
      at least `min(8ch, its own length)`, measured with a probe in the name's own font, from the test's own figure of
      8.
    - VIS-M24 (basis back to 0) reds the 1280 Refined cases, where the name measured 30 px.
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
    - The name part clips with `overflow: clip` and an `overflow-clip-margin` of the gap's width, the clip `.sess-meta`
      and `.proj-pending-meta` already use, so its own middot is not clipped with its text.
    - A one-line row's spacing is the old margins' (a 12 px gap).
    - The guard reads, for every part after the first that starts a line, whether its middot's box lies inside the
      clipping words box. At 390 the region row's `from` part starts a line (asserted), so a real wrapped line is
      measured.
    - VIS-M29 (the middot back in flow) reds 12 cases, `no line starts with a middot`.
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
    gives the `sess-subagents` row's TOKEN claim a real floor in the header, and its text says which floor applies
    where.

## Minors (review 1424)

Taken:
- a: `SessionDetails.tsx`'s comment no longer says the header "calls no hook it did not call". It adds a `useState`
  and no `useId`.
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
  environment, not this change.
- `origin/main` moved by two docs-only commits after round 1. They merge cleanly (merge-tree exit 0). None of the worker
  skill's absorb triggers held, so they were not merged in.
