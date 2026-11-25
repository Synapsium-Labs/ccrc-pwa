# Wave 5j-a, Task 3: a withdrawn entry re-pins (D-9047)

Run 3759, programme `landing-order`, wave 26. Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave5j-doors.md`,
Task 3, decision 7.

## What changed

`server/src/coord/landingEntry.ts#decideLandingWrite`: the `closed` branch's condition takes `withdrawn` too, with a
comment naming decision 7 and D-9047, and its else-arm answers `{kind:'kept', state: current.state}`, the row's own word,
in place of the hard-coded `closed`. Nothing else changed. A retreat over a withdrawn row still keeps it (the retreat
branch keeps every row that is not an owned `pinned` one, unchanged).

## The inversion

`landing-entry-store.test.ts`, `it.each(['landed', 'withdrawn'])` "a %s row is kept, and the run still advances":

- old: a readable, unmarked `withdrawn` row at a pin answered `{kind:'kept', state:'withdrawn'}` and stayed withdrawn.
- new: the `it.each` keeps `landed` alone; the `withdrawn` row became the store re-pin case below, where a verified pin
  re-pins it.

## New cases

- Store: a run at `merging` with its row set to `withdrawn` (with a `detail` and no witness): the retreat to `working`
  answers `kept` `withdrawn`; after `awaiting-review`, a verified `advance → merging` re-pins it: the same id, `pinned`, the
  new head, a new `pinnedAt`, `detail` null, one witness at the new head, and the line's order contains it.
- Pure: a pin over a `withdrawn` row re-pins over a readable, unquarantined projection, and answers `kept` `withdrawn`
  over an unreadable one, a missing read and a quarantined one; a retreat over a `withdrawn` row is `kept` `withdrawn`; a
  `landed` row is still `kept` at a pin.

Both new cases were measured red against Task 2's `landingEntry.ts`, then green; the source was restored from a saved
copy and checked by sha256. `landing-land-store`, `landing-facts-scope`, `landing-control`, `landing-terminal-damage`,
`landing-line-order`, `landing-read-route`, `landed-lane` and `landed-decide` stay green.
