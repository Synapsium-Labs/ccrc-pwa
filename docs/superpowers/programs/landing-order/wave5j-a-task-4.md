# Wave 5j-a, Task 4: an edge to a withdrawn entry holds (D-9047)

Run 3759, programme `landing-order`, wave 26. Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave5j-doors.md`,
Task 4 and section 4.3, with section 11's C1 (the order's side) and C3.

## What changed

- `shared/landingLine.ts`: `LandingWait` (`{entryId, reason: 'withdrawn', on: {entryId, pr}[]}`) and an optional `waits`
  on both arms of `LandingOrder`, present only when non-empty. The `LandingOrder` comment now names a withdrawn target among
  what leaves no head.
- `server/src/coord/landingLine.ts#landingOrder`: the walk, its keys and its other rules are unchanged.
  - A withdrawn target is one whose display state is `withdrawn`, or, with `stateWords` given, one exactly identified (as
    `settled` already demands: a safe positive id, exactly one entry and exactly one record) whose stored word is
    `withdrawn` behind a display `unknown`. It is outstanding.
  - `settled` no longer settles a stored `withdrawn`; `landed` and `closed` still settle and are met.
  - `waits` lists every pinned entry with a direct edge to a withdrawn target, in key order, each target by entry id and
    PR, `on` sorted by entry id and de-duplicated. Ejected and `unknown` dependants are not listed (the plan's "two sets,
    on purpose").
  - `landingBindingOf` selects through the same walk, so a held dependant is never a binding head.

One reading said here: with `stateWords` given, a display `withdrawn` target is also a withdrawn target, whatever its
record says. The display state is either the stored word or `unknown`, so this equals the plan's rule on every row the
reader can produce; on a synthetic disagreement it fails closed (the edge holds).

## The inversions

- `landing-line-order.test.ts` case C10, "an edge to a landed, withdrawn or absent id holds nothing" (afterIds `[105, 106,
  199]`): old, order `[1]`, head 1. New, split in two: C10 keeps a landed and an absent target (order `[1]`, head 1); C10w
  adds an independent entry and expects the dependant to wait last (order `[3, 1]`, head 3).
- The same file's loop "a stored `<w>` behind display unknown settles the edge", over `landed`, `closed`, `withdrawn`:
  old, head 1 for all three. New, the loop keeps `landed` and `closed`; a stored `withdrawn` holds (head `null`) and `waits`
  names it. A stored `withdrawn` that is not exactly identified (a duplicate record) stays outstanding as an `unknown`
  target and is not named in `waits`.
- `landing-terminal-damage.test.ts`'s R4 loop "a dependent head behind a damaged terminal target", over three terminal words
  and five damages: old, H is the ready head with one cue for each. New, its `landed` and `closed` rows are unchanged; its
  five `withdrawn` rows expect H held (`orderHead()` null), `waits` naming T by entry id and PR, the binding `held` and not
  `ready`, no cue queued, and T's bytes unchanged. Its R1 loop has no edge and stays green.

## New cases

- `landing-line-order.test.ts`, describe "an edge to a withdrawn entry holds": nothing brought forward (A head, B after A,
  C after B; withdraw B; C waits with `fixesMain`, and again with C older than A and no `fixesMain`; A stays the head); a
  withdrawn head with one dependant (the next independent entry heads, or none); C re-declared without B, by a session
  other than C's setter and by C's own (C free; the feed's side is 5j-b's, section 11 C1); B re-pinned is outstanding, B
  landed and B closed are met; a display `withdrawn` target holds with `stateWords` omitted; no withdrawn target gives no
  `waits` key (open, operator-paused and main-red lines, and an empty one); two withdrawn targets under one dependant give
  one entry with `on` sorted; the field rides the paused arm and the recovery-held arm; an ejected dependant is not listed.
- `landing-control.test.ts`: `landingBindingOf` never selects a held dependant (alone: `empty-or-blocked`, no entry named;
  beside an independent entry: that entry is selected; a stored `withdrawn` behind display `unknown` holds the same way;
  control: behind a `landed` target the dependant is the ready head).
- `landing-read-route.test.ts`: the read answers `order.waits` for a head held behind a withdrawn row, and no `waits` key
  once that row is `landed`.
