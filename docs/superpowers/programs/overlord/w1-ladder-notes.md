# Overlord W1 ladder: build notes

## In short

Build Tasks 1–5 of `docs/superpowers/plans/2026-11-14-overlord-w1/w1-ladder.md`: the ladder's vocabulary and deciders,
its journalled rung and latch rows, the shared live-generation reader, the composed read and the four operator doors.
This is W1's ladder only: no holds, pending acts, queued mail or follow-up effects are armed here.

## Departures and carried rulings

- **`rung-capped-by-server-words` — spec delta.** The brief carries RV8 from
  `docs/superpowers/plans/2026-11-16-overlord-w2/w2-overlord-route-v1.md`: `rung-word-missing` is a second condition in
  `LADDER_CAUSE_MAP`. Table 7.5a does not name it. Its `server-words` effect caps at the highest rung whose `needs`
  word is absent or held by the server; the condition lifts when the server's words return. The input and the effect
  both use `highestHeldRung`, not a second list of rung requirements.
- **`cause-shape-keeps-the-journals-contract`.** The plan proposes a 48-character cause pattern, but the merged
  authority grammar accepts kebab words up to 64 characters. The shared ladder owner retains that existing contract
  and the journal reads it, so the re-point does not invalidate retained records. Unknown causes still cap by their
  stored cap, rather than requiring membership in today's cause table.
- **`sibling-plan-edits-already-folded`.** The authority journal and designation plans already carry X3b, F4, F5 and
  F8. This pull request changes neither sibling plan. The index already carries the ladder's RV8 row too.
- **`live-generation-characterization-extracts-the-closure`.** The old closure was not exported. The characterization
  commit first hoists its body unchanged into exported functions in the routes module, passing the existing gate as
  an argument. Six cases pin the answers left by designation A. The following move commit moves the functions to
  `server/src/continuity/liveGeneration.ts`; the test changes only its import. Both continuity doors still use this
  single reader.
- **`journal-cause-aliases-preserve-the-mutation-site`.** The authority journal's local `CAUSE_RE` and `CAUSE_MAX`
  become aliases of the ladder's shared constants, rather than new definitions. Its existing E8 cause-validation
  mutant still hits the check it measures; no change to another piece's mutation set is needed.
- **`pending-records-state-the-retained-origin` — coordinator ruling.** Q20's catch-up records a narrowing the row
  already holds. Only `journalPendingInTx` may state the retained `recordFrom`, so the fold sees the chain from its
  last recorded value. Catch-up stamps the sequence and clears the pending-origin marker, never changing a rung or
  latch cap. Every ordinary writer keeps the same-transaction current-row `from` duty. The journal's caller-duty
  documentation records this narrow exception.
- **`one-operation-key-covers-pending-records`.** Catch-up reuses the caller's original operation key, rather than
  suffixing a valid 128-character key into an invalid token. The authority entry parser checks its shape only;
  `authorityFold` processes records in sequence; authority coherence compares positions; `chainedJournal.ts`,
  `chainedJournalFile.ts` and `journalKernel.ts` use sequence, journal identity and digest. None de-duplicates or
  looks up records by operation key. The retained records therefore keep one key for the whole write operation.
- **`confirm-keeps-the-stricter-stored-cap`.** Confirm also reconciles an existing latch's cap: a stricter incoming
  cap narrows the row and takes the Confirm sequence. A cap already stricter than Confirm is never raised, and an
  unchanged journalled row keeps its own sequence. Tests cover both row-only and journalled rows and rollback.
- **`rung-step-cell-test-seam`.** `rungStep` accepts an optional cell-table argument, defaulting to `RUNG_CELLS`, so
  tests can exercise refusal cells before W2 adds acts that use them. Production still reads one table.

## Main absorption

Under the coordinator's standing migration/census license, this branch absorbed main after done tests A (#2964)
landed migration 92. The ladder moves positionally to migration 93. The only conflicts were additive: the migration,
its database and run-close pins, and mutation-set imports/spreads. Both sides were retained; the shared
`decision-model-records.test.ts` case is unchanged from main. No unrelated source conflict was resolved.

## Verification so far

| Piece | Evidence |
|---|---|
| Live-generation characterization | Six cases pass before and after the move; 26 continuity note-door cases pass before the move. After the move, the full file timed out on the 201st-note case at 20 seconds (25 other cases passed); that case passed alone in 12.7 seconds with no code or timeout change |
| Ladder vocabulary and deciders | 60 cases pass; the rung-word guard has nine passing cases |
| Task 1 mutation sets | All mutants killed: effectiveRung 21, highestHeldRung 5, rungWordReading 7, rungMoveVerdict 12, offStep 5, rungStep 7, narrowingState 5; score 1 each |
| Authority grammar after the re-point | 39 cases pass; affected authority and ladder mutation-floor cases pass |
| Task 1 rings and type checks | Rings pass; PWA and agent type checks pass. Both server type checks passed after restart; final integrated type checks remain due |
| Ladder store | 108 cases pass after the restore-cap and catch-up-key fixes; writer census has 38 passing cases |
| Task 2 mutation checks | Restored mutants went red for write-before-append, refusing a row-only narrowing, allowing a row-only widening, seeding a row, replacing a standing cap, dropping catch-up and fabricating the default `from`. Pre-implementation red was not measured; a later stub run is not counted as red-first evidence |
| Database and switch migrations | Run-close passes 21 cases alone. Database suite passed 145/146 cases, with an old goals-migration case timing out at 20 seconds; that case passed alone in 14.4 seconds without code or timeout change |
| Growth, Task 2 | Working-tree measurement: schema +25 code lines, store +7, both within 40. The final committed range is still to be measured |

## Where things stand

**Agreed:** narrowing always lands on the journal's `row-only` answer; widening refuses without its authority record.
The brakes read only the rung. A lowering works while sign-in is dark; a raise and a latch clear require the step-up.
The default is `chat` for ordinary reads and an absent side is `off` at Confirm.

**Waiting:** the rung, Pause and latch-clear doors and final integrated verification are still being built. Task 2's
table and writer review is complete after one fix round; its three findings are addressed under the coordinator's
amended requirements. Task 3's composed read and GET passed review; its two minor coverage gaps were closed with
separate helper mutation floors and a real designated-degraded GET case. Read six, route seven and policy 67 cases
pass, as do all ten ladder mutation sets (including helper sets at 3/3 each). The test typecheck was repeatedly killed
by the shared test-slice memory cap, including a run with a 3072 MiB Node heap; these attempts are not green evidence.

**Later:** authority journal B supplies the off-volume witness and its two cause rows; W2 adds `off`'s mail, request
and pending-act effects; W3 adds hold release. No substitute side effects are introduced here.
