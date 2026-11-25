# Wave 5j-b, Task 10: the doors may pause or remove, never choose, reorder or bring forward

Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave5j-doors.md`, Task 10 and section 8's rows B1 to B33, with the
brief's carry row. Base: `origin/main` at `31d5d9ae26`.

## The suite

New `server/test/landing-subtractive.test.ts`, over the real store, journal and server, sign-in dark, in a run-bound and a
run-less form of one fixture line (A the head, B after A, C after B, D with `fixesMain` after B, E ejected, F a
quarantined `unknown` row):

- **Table diff, withdraw:** for each of A to F, every row of the six landing tables before and after the route; the only
  changes are that entry's `state`, `detail` and `quarantineKind`, its subject row (inserted, or its observation
  replaced) and the cursor; the journal grows by exactly one `withdraw` record; the answer names no head, next, order
  or successor.
- **Table diff, pause:** a pause, then a resume; the only changes are that project's `operatorPaused` (its
  `landing_projects` row is inserted by the first pause) and the cursor, one `pause` record each, and the head after the
  resume equals the head before the pause.
- **Nothing brought forward:** B withdrawn, the head stays A and C and D wait on B (`waits`, each naming B by id and PR),
  D's `fixesMain` notwithstanding; A withdrawn, B waits on A and the head is `null` (no independent pinned entry is
  left); D never becomes the head while its edge to the withdrawn B stands, with `mainRedHold` set too. Every order is
  computed with `landingOrder` from the stored rows.
- **The dependants are told:** run-bound, B withdrawn, C gets one `landing-held`, D (its run row's claimant a BLOB) gets
  none and the answer names it `unreadable`, and A withdrawn tells B only (C and D are transitive); run-less, the
  creation claimants of C and D are told.
- **No door names a successor:** a parse-based read of `registerCoordRoutes` (`scan/symbols.ts#sourceOfSymbol`, never a
  literal read of the file, which the advance-switches ratchet refuses): the doors' code builds only `pause` and
  `withdraw` commands and names neither `afterIds` nor `fixesMain`, with a CONTROL that the span reader finds the order
  door.

## The mutation table (Step 2)

Each row was applied as one exact-text change, the named file (filtered by `-t`) was run from `server/`, and the file was
restored from its saved copy and its sha256 checked, all inside one `ccrc test` slot by a small driver in the session's
temp root. Each red below is a real test failure in the vitest tally, not a run that found no test. All 34 were killed and
every file restored equal. The green after: every file named here ran green in the 5j-b gate afterwards.

Which commit these name (review run 3864's F1): every sha256 below, and every suite count in this note, is of commit
`b4ed8c2cb9`, where the table was measured. Since then the two merges of main (`5c6eb61061`, `d0a3e7c0d9`) and the D-9093
comment edit (`511f196a96`) changed four of the mutated files, `store.ts`, `routes.ts`, `landingWrites.ts` and
`auth/gate.ts`, so their hashes no longer describe the tip; `landingDoorsTx.ts`, `landingControlTx.ts` and
`landingEntry.ts` still match. The suites have grown since too (`auth-gate` 399 here, 416 at `511f196a96`). Fix round
1 does not re-hash: a hash at its tip would be stale at the next commit. Rows B34 to B36 are in
`wave5j-b-fix-round-1.md`, with the commit they name.

- **B1**: the withdraw apply arm also clears every other entry's afterIds. `server/src/coord/store.ts`, sha256 `2e5d2c0dc7a6e395d1470f8b89d4078bc95049b1af92a7c3e532e07265e161b9`, restored and equal: yes. Red: `landing-subtractive.test.ts` -t `subtractive only`: 6 failed, 8 passed, 10 skipped (24).
- **B2**: the withdraw answer adds `head: null`. `server/src/coord/routes.ts`, sha256 `4cb68dca22d131259b8099617fdf64a6b47f754d0fc6d687702699eaba8f3f1a`, restored and equal: yes. Red: `landing-doors-route.test.ts` -t `no door answers`: 1 failed, 12 skipped (13); `landing-subtractive.test.ts` -t `subtractive only`: 12 failed, 2 passed, 10 skipped (24).
- **B3**: the control statement also clears operatorPaused on a green transition. `server/src/coord/landingControlTx.ts`, sha256 `ea89666a8b276411a2578533c34a669c3a2f17b056422c09c669cd5a95bb5df4`, restored and equal: yes. Red: `landing-control.test.ts` -t `door-written: a pause placed between`: 1 failed, 60 skipped (61).
- **B4**: the same, on a red transition. `server/src/coord/landingControlTx.ts`, sha256 `ea89666a8b276411a2578533c34a669c3a2f17b056422c09c669cd5a95bb5df4`, restored and equal: yes. Red: `landing-control.test.ts` -t `door-written: a pause set before red`: 1 failed, 60 skipped (61).
- **B5**: the writer applies a withdrawal without appending (`log.append` skipped). `server/src/coord/store.ts`, sha256 `2e5d2c0dc7a6e395d1470f8b89d4078bc95049b1af92a7c3e532e07265e161b9`, restored and equal: yes. Red: `landing-journal-store.test.ts` -t `a withdraw appends exactly one`: 1 failed, 89 skipped (90); `landing-subtractive.test.ts` -t `subtractive only`: 12 failed, 2 passed, 10 skipped (24).
- **B6**: no notice is built for the withdrawn entry. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-journal-store.test.ts` -t `the entry's notice and one landing-held`: 1 failed, 89 skipped (90).
- **B7**: no notice is built for the dependants. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-subtractive.test.ts` -t `the dependants are told`: 2 failed, 22 skipped (24).
- **B8**: the dependants list takes a dependant of a dependant too. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `dependants are the direct ones only`: 1 failed, 104 skipped (105).
- **B9**: replay queues a withdrawal notice. `server/src/coord/store.ts`, sha256 `2e5d2c0dc7a6e395d1470f8b89d4078bc95049b1af92a7c3e532e07265e161b9`, restored and equal: yes. Red: `landing-journal-store.test.ts` -t `queues no mail`: 1 failed, 1 passed, 88 skipped (90).
- **B10**: the parse before the append is skipped. `server/src/coord/store.ts`, sha256 `2e5d2c0dc7a6e395d1470f8b89d4078bc95049b1af92a7c3e532e07265e161b9`, restored and equal: yes. Red: `landing-journal-store.test.ts` -t `parse before append: a withdraw whose actor`: 1 failed, 89 skipped (90).
- **B11**: the route records the raw device label instead of `deviceActor`'s text. `server/src/coord/routes.ts`, sha256 `4cb68dca22d131259b8099617fdf64a6b47f754d0fc6d687702699eaba8f3f1a`, restored and equal: yes. Red: `landing-doors-route.test.ts` -t `a session labelled by a real, long User-Agent`: 1 failed, 12 skipped (13); `landing-writes.test.ts` -t `round-trip through the journal parser`: 5 passed, 100 skipped (105) (the control, expected green: green).
- **B12**: `POST /api/landing/withdraw` joins `auth/gate.ts`'s EXEMPT. `server/src/auth/gate.ts`, sha256 `82c5733d771a7326c0582beb216a78b55566c2565ac047833424349bbb3d527b`, restored and equal: yes. Red: `coord-pause-route.test.ts` -t `(whole file)`: 1 failed, 26 passed (27); `landing-doors-route.test.ts` -t `the box token only`: 1 failed, 12 skipped (13).
- **B13**: the pause handler calls `requireMailToken`. `server/src/coord/routes.ts`, sha256 `4cb68dca22d131259b8099617fdf64a6b47f754d0fc6d687702699eaba8f3f1a`, restored and equal: yes. Red: `coord-pause-route.test.ts` -t `(whole file)`: 1 failed, 26 passed (27).
- **B14**: a dark resume (`flag-off`) is refused. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-doors-route.test.ts` -t `a pause, its resume and a withdraw`: 1 failed, 12 skipped (13).
- **B15**: the terminal refusal is dropped. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `4. a terminal stored word`: 1 failed, 104 skipped (105).
- **B16**: the compare-and-set reads the display pin time. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `damaged row shown with pinnedAt 0`: 1 failed, 104 skipped (105).
- **B17**: the compare-and-set is dropped. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `5. a pin time that moved`: 1 failed, 104 skipped (105).
- **B18**: withdraw skips the identity-conflict refusal. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `1. an identity conflict listed`: 1 failed, 104 skipped (105).
- **B19**: withdraw skips the own-subject recovery refusal. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `3. the entry own listed subject refuses`: 1 failed, 104 skipped (105).
- **B20**: an `unrecognised` stored word passes. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `unrecognised one refuses`: 1 failed, 104 skipped (105).
- **B21**: an unreadable association reads as no run (the entry's and a dependant's). `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `6. the entry own unreadable association`: 1 failed, 104 skipped (105); `landing-writes.test.ts` -t `a dependant whose association does not read keeps`: 1 failed, 104 skipped (105).
- **B22**: a run-bound recipient is the creation claimant first. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `a run-bound entry tells its run claimant`: 1 failed, 104 skipped (105).
- **B23**: a pause is refused under a recovery hold. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `neither a recovery hold nor an identity conflict`: 1 failed, 104 skipped (105).
- **B24**: a pause of an unknown project passes. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `a project the line has never seen`: 1 failed, 104 skipped (105).
- **B25**: an equal pause is not `unchanged` (it appends). `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-journal-store.test.ts` -t `a repeated pause appends nothing`: 1 failed, 89 skipped (90).
- **B26**: `parseLandingDoor` ignores an unknown key. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `refuses each extra key`: 1 failed, 104 skipped (105).
- **B27**: the notices are queued in a microtask, after the commit. `server/src/coord/store.ts`, sha256 `2e5d2c0dc7a6e395d1470f8b89d4078bc95049b1af92a7c3e532e07265e161b9`, restored and equal: yes. Red: `landing-journal-store.test.ts` -t `a fault in the second mail insert`: 1 failed, 89 skipped (90).
- **B28**: the parse check passes every old kind. `server/src/coord/landingDoorsTx.ts`, sha256 `3145f099da08bcae0b35bda2b2ecb74979b673209a98643331161d05de0f004c`, restored and equal: yes. Red: `landing-journal-store.test.ts` -t `parse before append, the pure check`: 1 failed, 89 skipped (90).
- **B29**: the parse check drops `lastSeq === record.seq`. `server/src/coord/landingDoorsTx.ts`, sha256 `3145f099da08bcae0b35bda2b2ecb74979b673209a98643331161d05de0f004c`, restored and equal: yes. Red: `landing-journal-store.test.ts` -t `parse before append, the pure check`: 1 failed, 89 skipped (90).
- **B30**: an unchanged pause owes a feed event. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `an unchanged pause owes nothing`: 1 failed, 104 skipped (105); `landing-writes-act.test.ts` -t `a pause: answers the pause shape`: 1 failed, 4 skipped (5).
- **B31**: the pause event carries the actor as `sessionId`. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `a changed pause and a changed resume`: 1 failed, 104 skipped (105).
- **B32**: a dependant's unreadable association refuses the withdrawal `run-unreadable`. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `a dependant whose association does not read keeps`: 1 failed, 104 skipped (105); `landing-journal-store.test.ts` -t `a dependant whose association does not read gets no mail`: 1 failed, 89 skipped (90); `landing-subtractive.test.ts` -t `the dependants are told`: 1 failed, 1 passed, 22 skipped (24).
- **B33**: a release by the run's own claimant owes no event. `server/src/coord/landingWrites.ts`, sha256 `311bb6d6199cc5d6d1bfda549373753012a8c460382db764c70ac3afabbdabb2`, restored and equal: yes. Red: `landing-writes.test.ts` -t `the run own claimant release owes the event`: 1 failed, 104 skipped (105).
- **CARRY**: the withdrawn re-pin also demands `current.runId === f.runId` (the brief's carry row). `server/src/coord/landingEntry.ts`, sha256 `0071216e0c3e5e13c02bcf1093d1b9f1ce2810e9f960cf19c2fd8ffc52667e1a`, restored and equal: yes. Red: `landing-entry-store.test.ts` -t `wave 5j-b carry`: 1 failed, 64 skipped (65).

Notes on three rows. B11's second run, the `landing-writes` round trip, stays green, as section 8 predicts (it calls
`deviceActor` directly). B27 is measured with the notices moved into a
microtask after the commit: the injected second-insert fault then no longer rolls the write back, and the writer answers
success where the case expects `landing-db-apply`. B9's red is the replay case for a withdrawal (the pause case beside it
has no notice to queue, and stays green).

## The gate (Step 3)

At commit `b4ed8c2cb9`, one file per process, from `server/`, in one slot: `landing-journal` 76, `landing-journal-store` 90, `landing-entry-store`
65, `landing-entry-census` 40, `landing-read-route` 32, `landing-writes-route` 36, `landing-line-order` 68,
`landing-control` 61, `landing-terminal-damage` 64, `auth-gate` 399, `box-token-census` 80, `coord-pause-route` 27,
`coordinator-skill` 290, `refusal-status` 28, `mail-routes` 61, `growth-check` 62 (3 skipped), `citations` 4, `anchors` 9,
`topology-clean` 61, `deviation-refs` 34 (after `git fetch origin`), `single-definition/` 1597, `landing-doors-route` 13,
`landing-subtractive` 24, `landing-writes` 105, `landing-writes-act` 5, `landing-facts-scope` 3, `landed-decide` 34,
`landed-lane` 44, `overlord-other-lanes-census` 56, `coord-token` 43: all green. The server typecheck is clean.

What the first gate run found, and what changed:
- `topology-clean` read the four-part browser version numbers in two User-Agent fixtures as addresses. Its branch
  row reads every blob the range adds, so the earlier local commits carried them too; nothing was pushed yet, so those
  local commits were rewritten by a tree filter that changed only those version strings (to three-part ones),
  before the first push. No published commit ever held them.
- `single-definition/advance-switches` refuses a new literal source read of `routes.ts` (37 to 39): this suite's static
  read first used `readFileSync`; it now uses `sourceOfSymbol`.
- `landing-read-route` timed out once at 20 s under load (a fenced-store case this wave does not touch) and was green
  alone. `secret-mask` timed out at 20 s on two, then three, different cases (keystroke latency and a review-cap read) at
  load 8 to 10; it reads nothing this wave changed. Left to the pull request's run, which is the arbiter.
- `typecheck-tests` (the tests-inclusive typecheck) was not run as a suite: the same typecheck was killed by the test
  slice's memory cap once (`ccrc test --local`, exit 137, `MemoryMax=6G`, Task 7's note). A typecheck of the 27 landing,
  census and gate test files this wave touches, through a scratch project, is clean.

## The landing gate (Step 4)

The client this session holds (`ccrc-api`) has no read of the server box's `/health`, and raw HTTP is not this session's,
so the server box's version was not measured here. The coordinator reads it before enqueueing.
