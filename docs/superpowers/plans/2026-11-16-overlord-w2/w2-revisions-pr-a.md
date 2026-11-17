# Overlord W2 row revisions: notes from the build (PR A)

The build notes of the one pull request of `w2-revisions.md` (run 2293). The coordinator folds them into the ledger on its own
ledger pull request; this file edits no ledger and no existing plan.

## What shipped

- **Task 1** (its own commit, green on `main`): `server/test/row-revisions.test.ts` characterizes every writer of `asks` and
  `operator_items`: Table R1's thirteen UPDATE statements and the two inserts, each by what it returns and the row after it,
  with a missed-guard case for each guarded writer.
- **Task 2:** the closed census, `server/test/single-definition/row-revisions.test.ts`, with Table R1 as `REVISION_CLASSES`
  and ten in-memory controls; each behaviour case reads the revision; `asks-store.test.ts`' column pin gains `revision`.
- **Task 3:** one migration (87, the next slot after decision model A's 86) adds `revision INTEGER NOT NULL DEFAULT 0` to both tables; six
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
  `main` a second time (on the coordinator's word again) and took 86; decision model A (#2948) then landed 86, so in fix
  round 1 it merged `main` a third time (on the coordinator's word, 22474 and 22512) and the migration took the next
  slot, 87. Other open pull requests hold 87 too; whoever lands second renumbers at landing, on the coordinator's word.
  The third merge moved one pin of main's own as well: `decision-model-records.test.ts` rolled a database back one version
  to replay 86, so with 87 after it that test now undoes 87 first and rolls back to the version before the migration that
  creates the decision tables, found by its text (CI's first run on the merge caught it; the fix round's re-run list did
  not name that file).

## Fix round 1 (review run 2348, the coordinator's rulings)

- **F1:** a statement of either table whose SET list the census cannot read is red as unreadable, never skipped: an
  UPDATE whose table is not followed by `SET` itself (an alias, `INDEXED BY`, a `${…}`), and a SET list holding a
  `${…}`. One control per form, through the scan.
- **F2:** the shared scan's verb pattern reads any letter case, `UPDATE OR <word>`, a schema-qualified name and a quoted
  one. `writers-map` answers exactly as before: the scan's table and writer pairs over every coord.db table are the same
  278 before and after, and the census still sees the thirteen UPDATEs and two INSERTs of Table R1, nothing more.
- **F3:** the scan splits each joined string on its top-level `;` (outside quotes, brackets and SQL comments) and keys
  each write by its statement, so each `UPDATE` of a multi-statement `exec` is judged on its own SET list. Two controls:
  the second of two UPDATEs of different tables, and of the same table, missing its raise.
- **F4:** a `REPLACE INTO` or `INSERT OR REPLACE` of either table is red whatever it names (it deletes and re-inserts
  the row at revision 0). Two controls.
- **F5:** the characterization gains `declineAsk`'s bound in-transaction arm, won and lost, `takeAskForAnswer` from
  `released`, `untakeAsk(…, 'released')`, and the `already-answered`, `unknown-ask` and `not-held` refusals. Run
  green on `main`'s source (41 cases, the revision checks set aside) and at the tip (42).
- **F6:** no change, as ruled.
- **Mutation:** seven mutants of the new arms (each unreadable form, the substitution in a SET list, the REPLACE arm,
  the statement split, the letter case, the `OR` arm, the qualified and quoted name), each killed by exactly its
  controls, each file restored from a saved copy.
