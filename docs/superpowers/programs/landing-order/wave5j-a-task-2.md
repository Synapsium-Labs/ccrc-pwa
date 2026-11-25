# Wave 5j-a, Task 2: the applier and replay (D-9046)

Run 3759, programme `landing-order`, wave 26. Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave5j-doors.md`,
Task 2 and section 4.2.

## What changed

- New `server/src/coord/landingDoorsTx.ts` (L3, C5), `applyLandingDoorRecordTx(db, r)`: the pause statement, the one
  writer of `operatorPaused` (an upsert of that column alone, never `mainRedHold`), and the withdraw statement, the one
  writer of the word `withdrawn`, with `quarantineKind = NULL` and the section 4.2 `detail` JSON, matched by `id`,
  `project` and `pr` together and guarded to non-terminal rows (the terminal list is built from
  `LANDING_TERMINAL_STATES`). It opens no transaction, reads nothing and decides nothing.
- `server/src/coord/store.ts#applyLandingRecord`: a `pause` calls the companion, then moves the cursor; a `withdraw`
  upserts its subject, writes no `landing_authority` row, calls the companion, then moves the cursor. `entry` and `order`
  are unchanged.
- The comment on `replayLandingJournal` ("It never writes a projection or a witness") now says what replay writes: one
  projection column word, the operator's `withdrawn`, with its `detail` and the cleared marker, and no pin, landed state,
  association or witness; it never notices.
- Store growth on this branch against `origin/main` after Tasks 1 and 2: 23 lines added, 15 removed.

## The census, moved

Each moved case was measured red against Task 1's store with `landingDoorsTx.ts` removed (six cases red), then green
on the new source; the source was restored from saved copies and checked by sha256.

- `landing-entry-census.test.ts`:
  - `landing_projects` writers: `['INSERT landingControlTx.ts']` becomes `['INSERT landingControlTx.ts',
    'INSERT landingDoorsTx.ts']`. A new case pins the pause statement's text, that it names no `mainRedHold`, and that
    `applyLandingDoorRecordTx`'s one caller is `CoordStore.applyLandingRecord`. The `mainRedHold` case still says
    `applyLandingControlTx`'s statement names no `operatorPaused`.
  - "every write of landing_entries": the outside list goes from `['INSERT:true']` to `['UPDATE:false', 'INSERT:true']`
    (sorted path order). The creation INSERT is now found by its verb, not by position, and a second assertion pins the
    withdraw UPDATE's text.
  - `quarantineKind`: three UPDATEs; the one outside the writer is the withdraw statement, which only clears the marker.
  - `detail`: three UPDATEs; the one outside is the withdraw statement.
  - "replay owns neither" is now "replay reaches only the withdrawal": replay's own SQL and the applier's own SQL write
    neither `landing_entries` nor the witness, the applier calls the companion, and the companion's one `landing_entries`
    statement is the withdraw UPDATE.
  - The one-overlay-writer pin is unchanged.
- `single-definition/core-vocab.test.ts` (`HANDLE_HOLDERS` gains `landingDoorsTx.ts`): the file is under a recently
  lapsed claim of another session at this commit, so the line is added last, by claim or by peer packet, as the brief
  says. The case is red on this commit alone.

## Said here

- The frozen migration 39 comment in `schema.ts` says only `advanceLanding` writes or clears `quarantineKind`. Migrations
  are frozen, so it is left as it is; D-9046 records the second writer, and the census now pins it.
- Replay cases (`landing-journal-store.test.ts`) append the door records to the fixture journal by hand, since no route
  writes one in 5j-a, then reboot the fixture store and replay. They cover a pause (with `mainRedHold` 0 and 1) and its
  resume, a pause that creates the flags row, a withdraw over `pinned`, `ejected` and a quarantined `unknown` row, over a
  `landed` row, over no row (subject listed `missing`, authority `not-set`), and over a row whose id names another
  (project, pr). Each checks the ordering columns of every row and every `landing_authority` row byte for byte, and the
  cursor.
