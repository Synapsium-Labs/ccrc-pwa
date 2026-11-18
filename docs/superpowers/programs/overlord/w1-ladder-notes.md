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
- **`refused-widening-keeps-successful-catch-up` — implementation ruling.** Ruling: a refused widening changes no
  authority value or clear attribution, but retains Q20's already-successful sequence stamp — Q20 runs before the
  writer's own append, and rolling back its stamp after a durable append would leave the journal ahead of the
  database — if this reading is wrong, the catch-up transaction contract needs revision rather than a rollback
  added to the door. The route test pins the unchanged rung, latch and attribution, catch-up record order and stamp.
- **`brakes-skip-malformed-sqlite-integers`.** Whole-branch review found that an oversized integer in a standing
  latch threw in SQLite's default decoder before validation, blocking a brake. Catch-up now reads BigInts and
  converts only safe values; malformed rows stay distinguishable and are skipped. The held-rung metadata read uses
  the same boundary. Composed reads and widenings remain fail-closed, and no journal or transaction order changes.
- **`brakes-record-console-result-union` — rulings 562/563.** Brakes take the identity port's full console result without asking the account gate: dark records `flag-off`, an unmeasured device records `unmeasured`, and a signed-in actor records its minted subject. Latch raises may also use that result or any minted actor, as authority narrowing; widening a rung or clearing a latch requires a minted account-gate operator at operator strength. The store validates before its transaction where possible and repeats direction-sensitive validation against the held row before catch-up. The existing text columns carry subjects; restore and catch-up attribution are unchanged.
  The plan's string `raisedBy` is dropped; a server lane has no actor to pass on this tip, so authority journal B adds a port mint for the existing server kind before it calls `raiseLatch`.
- **`rung-step-cell-test-seam`.** `rungStep` accepts an optional cell-table argument, defaulting to `RUNG_CELLS`, so
  tests can exercise refusal cells before W2 adds acts that use them. Production still reads one table.

## Main absorption

Under the coordinator's standing migration/census license, this branch absorbed main after done tests A (#2964)
landed migration 92. The ladder moves positionally to migration 93. The only conflicts were additive: the migration,
its database and run-close pins, and mutation-set imports/spreads. Both sides were retained; the shared
`decision-model-records.test.ts` case is unchanged from main. No unrelated source conflict was resolved.

Fix round 1 absorbs main again under the coordinator's explicit new ruling, after #2974 took migration 93. The ladder now occupies 94. The six conflicts are additive migration/census unions only: schema, database rewind/version pins, authentication count comments and mutation floors. Both the phase-ref door and phase mutation floors remain, and the shared decision-model-records case is byte-for-byte main. The merged authentication census passes 348 cases; its 264 scanned registrations comprise 261 HTTP routes and three websocket upgrades.

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
| Tasks 4–5 | Implementer measured route 35, seams 8, read 6, policy 67, auth gate 347 and box-token 60 passing; seven door/helper mutants and a third-writer injection killed |
| Task review fix round 1 | Missing-journal fallback now preserves row-only brakes without changing designation's fallback; quoted SQL census and fake Confirm append ordering covered. Reversed fallback direction and missed quoted rung assignment each killed by a test |
| Integrated guards, first run | 1,911 passed, two failed: a new literal-source pin and the witness name colliding with the claimant census. Parser-based policy tests addressed the first; the initial record-specific rename was superseded in branch review by the planned `heldFor` seam and a receiver-aware claimant census |
| Identity integration | The actor/console regression file was red before integration (13 failed, one passed); the six scoped ladder and door files passed 206 cases after integration. Twelve serial guard mutations were killed, covering provenance, each widening term, in-transaction direction and pre-/in-transaction rejection checks; they did not cover the pre-transaction widening direction. An in-transaction direction mutant survived the first pass and was killed after adding a test. Scoped source and fixture typechecks passed; the parent owns the final integrated checks. |
| Whole-branch review fixes | The restore and origin-race tests were red first (three failures). Scoped review then found that readable `full` and an unknown word shared the normalized origin; a second red-first case now prevents Pause from writing `chat` after that change. Store 114 and route 42 passed, and the scoped recheck accepted F1–F7. Confirm preserves the lower stored rung, and the rung writer checks the verdict's normalized origin before catch-up, returning its own `row-changed` error if it changed. The planned witness method `heldFor` is restored; the syntax-aware claimant census excludes only the ladder's typed witness receivers, while checking every other receiver and bare call. The actor-port guard mutant returned 500 instead of 503; the claimant member-call guard mutant and unknown-condition-cap mutant were killed. Policy 67, read 6, seams 8, claimant census 183, auth gate 347 and all ten selected ladder mutation floors passed; the bounded unknown-cause enumeration samples known-condition combinations to keep the floor practical. Source typecheck passed; final test-typecheck attempts at 3072 and 2048 MiB were killed by the shared memory cap (137), after an earlier test-typecheck passed |

## Fix round 1: integrated evidence

F1–F7 are addressed and accepted by the scoped recheck. The added origin checks run before catch-up or append; an unknown word still permits only `off`. The complete mail census initially caught the new `row-changed` writer-local word. It now derives from a runtime map in the existing ladder vocabulary owner, shared by its type and census guard; no public or journal refusal vocabulary was extended. The vocabulary case was red before that correction, and the full mail suite then passed all 60 cases.

The review's integrated list passed ladder policy 67, store 114, read six, route 42, seams eight, live-generation six, authority guard 15, authority journal 41, authentication 348, box-token 60, mail 60, switches 20, run-close 21, decision-model records 13 and database 149. All 38 single-definition and 12 ring files passed (1,648 cases), and all mutation floors passed (187). Anchors nine, citations four and deviation references 34 passed. Armed committed growth passed 96 cases against merge-base `44b86c1`: schema +25, store +7, server composition +3, all other checked rows unchanged; no waiver or over-limit row.

Final source, test, PWA and agent typing passed with `GOMAXPROCS=2 GOMEMLIMIT=2GiB`. The installed TypeScript 7 wrapper launches its native compiler, so earlier Node heap limits did not constrain that compiler; the successful final runs bound native concurrency and memory instead. The previous exit-137 attempts remain recorded, not relabelled as passing.

The masking file still has the ordinary-text streaming timeout at 20 seconds: 95 passed and one skipped. Review reproduced the same case at the earlier merge base as well as the reviewed tip; no masker or timeout change belongs to this fix round. Exact-tip CI remains due after the single completed-round push. The first full-run signal stays `suite: red`, `failure: unclear` even if that CI is green.

## Identity fix round 1

The shared account-gate operator predicate extraction and designation test provenance seam are isolated in their own commit, separate from the remaining fixes, under ruling 564. Before extraction the unchanged designation suites passed 69 cases. The moved predicate initially bypassed the old mocked export, so the synthetic positive control failed (93 passed, one failed); the authorized seam adjustment restored the positive control without changing any case, assertion, input or expected outcome. Both designation suites and the ladder actor suite then passed 94 cases.

Each shared predicate term was mutated separately and killed by both actor suites: kind and strength each caused three designation failures and one ladder failure; issuer caused three and two. The newly covered pre-transaction direction mutant went red on the nested-transaction case independently of the earlier twelve; deleting the destination guard also went red, after its initial red-first TypeError. The source bytes were restored from saved copies and their hashes independently matched. The invalid-destination case also checks that neither the journal nor the rung row changes.

Independent final verification passed the coordinator's nine covering files and 571 cases, including the complete mail and writer censuses and mutation floors. The run queued 688 seconds for a test slot, then executed in 292.66 seconds. Full server source and tests-inclusive typing passed with bounded native compiler resources. An implementer covering attempt stopped while queued has no result claimed. Earlier limitations and the first-run `red` / `unclear` signal remain unchanged.

The server mint remains authority journal B's work, as the departure states; console mapping and console-result branding remain carried to gates PR B. No main absorption belongs to this round. The coordinator requires no further review after these fixes; exact-tip CI and actual CodeQL remain due after the single completed-round push.

## Identity integration after gates A

The coordinator authorized one absorption of main after gates A landed, followed by the ladder's identity conversion.
Main's migrations through 96 are retained and the ladder takes measured positional slot 97. The combined route census
is 269 registrations: 266 HTTP and three websocket upgrades, with 98 exempt HTTP and 167 gated. All additive floor and
writer rows are retained, and the shared decision-model record case is unchanged from main. No further absorption is
part of this integration round; a later landing renumber belongs to its coordinator-authorized round.

The four ladder doors now join `OVERLORD_DOORS`, operator/view for the GET and operator/admin for the three writes.
Raises and clears call `identity.operator`; runtime provenance, operator kind, account-gate issuer and operator strength
are checked before a transaction and again in the in-transaction writer. Brakes keep the console-result union under
rulings 562/563, as the departure above states. The actual rung and classified origin are checked before catch-up, so a
claimed lowering cannot authorize a raise. Invalid actor inputs map to a fixed internal error without echoing them.
The identity port, its vocabulary, restore attribution and authority-journal semantics are unchanged.

Independent integrated verification passed 63 files and 2,466 cases, including all single-definition and ring files,
the full mail/writer censuses, authentication, box-token, run-close, ladder, registry, designation and Settings doors.
The database file ran alone and passed 149/149 in 617.70 seconds. Full server source and tests-inclusive typing both
passed with bounded native compiler resources. The mutation-floor, deviation-reference, anchor and citation checks
passed four files and 246 cases; the run waited 587 seconds for a fleet test slot before executing. The implementer's
12 guard mutants were killed and source hashes independently matched the restored files. These measurements add to,
not replace, the earlier local masking limitation and the first full-run `red` / `unclear` signal.

Committed armed growth and absolute-cap checks passed 108 cases against merge-base `59f68dc`: schema +25 net code
lines, store +16, server composition +3, all other measured rows unchanged, with no waiver or over-limit row.
The ledger guard passed; the complete added-text privacy scan remains a publication gate.

Exact-tip CI and actual CodeQL remain the post-push handoff gate. The coordinator also requires a short review of
this identity integration before landing; the worker does not merge or enqueue its own PR.

## Where things stand

**Agreed:** narrowing always lands on the journal's `row-only` answer; widening refuses without its authority record.
The brakes read only the rung. A lowering works while sign-in is dark; a raise and a latch clear require the step-up.
The default is `chat` for ordinary reads and an absent side is `off` at Confirm.

**Waiting:** the doors are implemented. Task 2's table and writer review passed after one fix round under the
coordinator's amended requirements. Task 3's composed read and GET passed review; its minor coverage gaps closed
with separate helper mutation floors and a real designated-degraded GET case. Tasks 4–5 passed scoped re-review
after the fallback, writer-scan and Confirm-seam fixes. The final integrated guard run passed 57 files and 1,956
cases, including routes 35 and seams eight. The test typecheck first exposed a fixture literal-inference error;
after its typing-only correction, the implementer measured it green. Earlier memory-cap kills are not green
evidence. Whole-branch review's malformed-integer brake finding was fixed and accepted on scoped re-review.
Independent final store/route/seam run passed 156 cases; source and test typechecks both passed, as did PWA and
agent typechecks. The remaining plan suites passed live-generation six, continuity notes 26, database 146,
run-close 21, switches 20, auth gate 347, box-token 60 and mutation floors 184.

The masking suite passed 95 cases with one skipped but timed out on the ordinary-text streaming case at 20 seconds;
that case also timed out alone. An untouched main snapshot attempt was killed by the shared memory cap, so it is
not proof of a baseline failure. No timeout or masker behavior was changed. Exact-tip CI must settle this remaining
local verification gap. Armed committed growth passed 96 cases: schema +25, store +7, server composition +3, all other checked rows
unchanged; no waiver and no over-limit row. The final policy, authority and complete guard lists were then run
one file at a time: 62 files and 2,100 cases passed. Exact-tip CI/CodeQL results are still due.

For this new remote branch there is no PR to label before its initial push. The initial push opens no pull-request
CI run; PR creation carries `full-ci` atomically, so the first PR-triggered run receives it. No preliminary fast
run or additional build-round push is intended.

**Later:** authority journal B supplies the off-volume witness and its two cause rows; W2 adds `off`'s mail, request
and pending-act effects; W3 adds hold release. No substitute side effects are introduced here.
