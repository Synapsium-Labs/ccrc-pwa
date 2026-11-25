# Wave 5j-a, Task 1: the record vocabulary and the parser (D-9045)

Run 3759, programme `landing-order`, wave 26. Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave5j-doors.md`,
Task 1. Dispatch base: `531bdb86bd`.

## What changed

- `shared/landingLine.ts`: the record union is split as section 4.1 gives it. `LandingJournalSubjectRecord` (entry, order,
  withdraw) and `LandingJournalPauseRecord`; `LandingJournalRecord` is their union. Every record keeps `v: 1`.
- `server/src/coord/landingJournalPolicy.ts#shape`: a table of each kind's exact keys (`FIELDS`) replaces the two-arm
  conditional, and the two door kinds are read. A door record needs `setBy: 'operator'` and an actor in the device
  actor owner's output grammar (`ccdargv.ts#deviceActor`): `flag-off`, `unmeasured`, or `device:` and at most 120 UTF-16
  code units with no `\p{Cc}` character, untrimmed, a blank label included. A `pause` names a project (nonblank,
  trimmed) and a boolean, and no subject. `parseLandingJournal`'s identity loop skips a `pause`; a `withdraw` is a mention
  and may be its subject's first. A later `entry` for an identity a `withdraw` already named answers `identity`, as for
  any earlier mention.
- `server/src/coord/store.ts#applyLandingRecord`: narrowed only. A `withdraw` upserts its subject and writes no
  `landing_authority` row; a `pause` moves only the cursor. Task 2 adds the companion's statements to both arms.
  `landingEntry.ts#landingRecordOf` builds records and reads none, so TypeScript named nothing there.

## Characterization first, and the inversion

The first commit adds the characterization alone, green on the baseline parser: an `entry` and an `order` parse to
exactly today's objects, and the baseline answers a door kind as `kind`:

- old: `withdraw` after an entry answered `{ok:false, reason:'kind', record:2}`; a lone `pause` answered
  `{ok:false, reason:'kind', record:1}`.
- new: both parse (`ok: true`). The case is rewritten to Step 2's valid cases, as Step 3 says; the old answer is kept in
  the test file's comment, because it is what a server older than 5j-a says on such a journal (D-9045).

The unknown-kind case stays refused, with two new kinds that are still unknown (`resume`, `withdrawn`).

## One reading of the grammar, said here

`deviceActor` cuts the label with `slice(0, 120)`, which can split a surrogate pair. The parser counts UTF-16 units
(`length <= 127`, the prefix included) and tests `\p{Cc}` with the `u` flag, so a lone surrogate at the cut is accepted,
as the owner can produce it. A case pins that.
