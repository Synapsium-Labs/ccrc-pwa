# Delegation visibility, first release: the worker's note

The note the plan asks for (`2026-11-02-delegation-visibility.md`, "Ledger route"), for the coordinator to fold into
the ledger. It records the departures fix round 1 made (review 1424, ruled in the coordinator's fix-round mail of
2026-11-04), the minors taken and left, and what was measured. Round 1 itself departed from nothing: every Find block
matched the base as written.

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
- **D-7785** — `the-header-toggles-take-the-tap-floor` (review 1424 F3; the same mail). `.chat-facts .sess-meta >
  *::before { content: none }` removes the card's tap overlay with the middots, so the header's subagent toggle (an
  inherited defect) and the new delegated toggle had their text line as their hit area.
  - `chat.css` adds `.chat-facts .sess-subagents { min-height: var(--tap-min); min-width: var(--tap-min) }`, which is
    header-only.
  - It gives the floor back on a fine pointer, beside the details door, in the existing `@media (pointer: fine)` block,
    which gains this selector and `min-width: 0`. This is the door's own convention, so a desk with a mouse renders as
    before.
  - Pinned by the same header case: at 390 (a touch screen in the harness) both toggles measure at least `--tap-min`
    (44) on each side, and a tap at their centre reaches them.
  - VIS-M20 (the rule's body emptied) reds all four header cases on a height of 18.
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

## Measured

- An Instrument case in `session-header.browser.test.ts` fails on this box: the header at 900 px measures 200.8 px
  against its 188 px bound. It fails the same way at the round-1 tip `865cf8c7d` (sources restored to that tip and
  re-run). That tip's CI browser shards were green, so it is this box's environment, not this change.
- `origin/main` moved by two docs-only commits after round 1. They merge cleanly (merge-tree exit 0). None of the worker
  skill's absorb triggers held, so they were not merged in.
