# Overlord W2 row revisions: notes from the build (PR A)

The build notes of the one pull request of `w2-revisions.md` (run 2293). The coordinator folds them into the ledger on its own
ledger pull request; this file edits no ledger and no existing plan.

## What shipped

- **Task 1** (its own commit, green on `main`): `server/test/row-revisions.test.ts` characterizes every writer of `asks` and
  `operator_items`: Table R1's thirteen UPDATE statements and the two inserts, each by what it returns and the row after it,
  with a missed-guard case for each guarded writer.
- **Task 2:** the closed census, `server/test/single-definition/row-revisions.test.ts`, with Table R1 as `REVISION_CLASSES`
  and ten in-memory controls; each behaviour case reads the revision; `asks-store.test.ts`' column pin gains `revision`.
- **Task 3:** one migration (86, the next slot after overlaps A's 85) adds `revision INTEGER NOT NULL DEFAULT 0` to both tables; six
  UPDATE statements raise it; the version pins and the run-close rollback move.
- **Task 4:** `GET /api/asks` and every `ItemView` carry it, the item one optional on the wire.

## Departures, by slug

- **`one-scan-in-a-helper`**: the plan says to extend `writers-map.test.ts#tableWriters`' scan and export it. Importing a
  `*.test.ts` from another test file registers its suite twice, so the scan moved into
  `server/test/single-definition/sqlStatements.ts#sqlWrites`, which answers each statement's writer and joined SQL text;
  `tableWriters` now reads its writers off that one scan, unchanged in what it answers, and the census reads the same scan.
- **`characterization-from-a-template-database`**: each case opens a copy of one migrated database rather than migrating a
  fresh one: on a loaded box a fresh open per case outran vitest's timeout (one case timed out at 20 s under load 20). The
  revision check rides each case's own test rather than a second pass of every case, for the same reason.
- **`migration-renumbers-at-landing`**: portfolio B (#2904) landed 83 while this was built, so the branch merged `main`
  (on the coordinator's word) and took 84; responses B (#2914) and overlaps A (#2949) then landed 84 and 85, so it merged
  `main` a second time (on the coordinator's word again) and the migration took the next slot, 86. Other open pull
  requests hold 86 too; whoever lands second renumbers at landing, on the coordinator's word, never on its own.
