# Wave 4, PR3: journal compaction (task note)

This note is PR3's record for the wave's ledger pull request (Global Constraints, "Ledger edits"). The coordinator folds it into the
plan and the programme ledger. The only authorized top-level plan edits in this PR are D-7869's definition placement and the
pointer clause recording D-7015 and D-7016 as round-1 review departures; this PR does not edit the programme ledger.

## Status

- **Review fix round 1 (2026-11-03), PR #2191:** published head `dbedeb85c` has its original exact-head fast CI GREEN. The
  watcher-port correction and delegation-method census correction are committed and verified; their historical reds remain below.
  The current round addresses F1–F4, A1 and A3–A5 from review 1384. Its 24 required F3 mutants and the separate retainedFrom
  wiring mutant have assertion RED → restored-row GREEN evidence. C19 was GREEN before its mutation. A4's actual-J kill is
  accepted by coordinator ruling 14306; no sibling `held-evidence-missing` refusal is claimed. The new compaction file has 76
  tests. The measurements here distinguish targeted proofs from full-file gates; the new-head handoff records this round's
  fresh named gates and exact-head fast CI separately. This note is not itself a final handoff. The full server suite was not
  run locally, and soaks remain waived, not passed.
- **Production continuation, carried into review:** main is merged through `85270c001`. Tasks 3.6 and 3.7 and the watch re-points
  are present. The earlier final-base gates, exhaustive watch halves and refreshed PWA run below are historical measurements,
  not substitutes for round 1's new-head gates. D-7869's two-member port change, its definition placement and the nine-method
  delegation census are the only subsequent integration corrections carried at `dbedeb85c`.
- **Historical Phase A** (no edit to `watch.ts`, `store.ts`, `mail-routes.test.ts`, `delegation-wave3.integration.test.ts` or
  `delegation-watch.test.ts`): Task 3.2 (the planner), Task 3.3 (`compactJournal`, the carried file, recovery's carried rules),
  Task 3.4's checkpoint half (the delete walk, the repair's step 0, the retained reader in the repair), Task 3.5 (C1) and Task 3.1's
  builder door (`upkeepIntervals`, `DelegationDurability.upkeep`, `rowsChanged`).
- **Historical Phase B** (released by coordinator mail 10575): Task 3.1's unified lane call, Task 3.4's two store methods and required
  projection-port members, Task 3.7's daily trigger and diagnostics, the kebab arm W4-K2 in `mail-routes.test.ts`, and the closed
  retained-set census in `delegation-wave3.integration.test.ts` were committed at `15a4d0246`. The Phase-B measurements below
  predate Task 3.6's release after #1578; they are not final-tip verification.
- The new real-lane rows live in `server/test/delegation-compaction-lane.test.ts`, preserving the original split while PR4 held
  `delegation-watch.test.ts`. The latter's existing assertions are now re-pointed as recorded below.

## Deviations found

- **D-7011** — `k6-keeps-a-whole-call-and-its-ager`: K6 is wider than the plan's "pair" in two ways, both found by reading the fold
  against the plan's text.
  - A call is every record on its key from the first listing-carrying PreToolUse up to and including the first PostToolUse. The plan
    says the next Bash record closes the pair, but the fold folds a second PreToolUse into the first call (it compares the latest
    listing), so a PostToolUse kept with only one of two PreToolUses could open, or compare, differently.
  - A carried call that the fold AGED (no PostToolUse within `DELEGATION_BASH_PENDING_MS`) carries the record that aged it. Without it,
    a recovery over the compacted set ages the call later, and a PostToolUse with no listing that the original fold read as unpaired is
    read as the call's PostToolUse instead, which opens an activity on a covered record and refuses `fold-refused`.
  Rows: `D-7011 (a)` and `D-7011 (b)` in `delegation-compaction.test.ts`; mutants D7011a and D7011b red them.
- **D-7012** — `k6-keeps-a-call-split-across-the-previous-cut`: a Bash call with a record in the current carried file and a record in the
  journal is carried whole, even when this cut removes the journal's record. The plan's Task 3.3 argument ("old carried lines that no
  rule selects any more are gone already, which is safe because nothing holds them") misses this case: after a crash between a SECOND
  compaction's two renames, the new carried file sits beside the UNCUT journal, and a PreToolUse carried last time for its straddling
  PostToolUse, dropped now because this cut also removes the PostToolUse, leaves that PostToolUse in the uncut journal without its
  PreToolUse, and recovery refuses `fold-refused`. Found by W4-C13b on the first implementation. Rows: `D-7012` (the planner) and
  W4-C13b; mutant D7012 reds both.
- **D-7013** — `mutation-table-as-measured`: the plan's mutation pins measure differently in the following cases.
  - W4-CM13 (skip the writer reopen) is EQUIVALENT: `writer-close` already drops the descriptor, and the writer reopens lazily by path,
    so it cannot write into the unlinked inode. The variant that also skips the close (W4-CM13v) is killed by W4-C14.
  - W4-CM22 (keep the launch-index entry) is not seen by W4-C22, because `memory-prune` drops a cut launch's entry before the
    retirement runs (and a retired run's launch is always cut). A new builder row, W4-C22b, kills it; CM22 with CM36 together red W4-C22.
  - W4-CM20 (retire an activity a record above S names) reds W4-C21, not W4-C20: in the fixture the record above S is a SubagentStop,
    which recovery reads as a stop-only candidate that ages out, so recovery stays ready.
  - Phase B: W4-CM1 survives W4-C2, because the same-hour pass never enters the upkeep door. Added W4-C2b, a new-hour pass
    that enters the real door with no work due; CM1 reds its `applied: null` assertion. The measured encode/write/revision deltas
    are zero without the mutation. No independent clone counter is claimed.
  - Phase B: startup reconstruction returns before the compaction-local readiness guard. W4-CM28 leaves that startup row green;
    a new real-lane row recovers into reconstruction during upkeep, at the compaction boundary, and reds the forbidden call.
  - Review round 1: W4-C19 was only an assertion label inside `expectRetainedRows`, called by C17 and C30, not a selectable test.
    Coordinator ruling 14306 authorized one independently selectable C19 test, leaving that helper and C17/C30 unchanged. The
    added test checks carried evidence after compaction and after the actual open's step-0 repair. It first passed unchanged;
    CM17's contiguous delete through S then failed its own `carried evidence survives compaction` assertion, and restored C19
    passed. No empty C19 selection ran and no earlier C17 failure was relabeled as C19.
- **D-7014** — `planner-and-applier-interface-details`: small departures from the plan's interface text.
  - The planner imports VALUES from `delegation-model.ts` as well as types (`parseDelegationInstant`, `encodeDelegationNaturalKey`,
    `DELEGATION_BASH_PENDING_MS`, and `isDelegationWorkerIndex`, moved into the model from the checkpoint so the planner's
    run-with-its-workers rule and the fold read one definition). No new outward edge: the checkpoint already imports the model.
  - `compactJournal` answers `{ kind: 'skipped', reason: 'not-ready' }` on an applier that is not ready, instead of throwing through
    `requireReady()`.
  - The builder keeps a private `equalPreSequence` map (the sequence of the PreToolUse behind each 'equal' Bash-call fact), because the
    fact itself carries only the PreToolUse's journalId and `memory-prune` needs its position. The clone census becomes 18 collections.
  - `DelegationDurabilityDeps.eventsDeleteChunk` and `repairDelegationProjection`'s `deleteChunk` are test seams for
    `DELEGATION_EVENTS_DELETE_CHUNK`.
  - Phase A only: the projection port's `countEventsAtOrBelow` and `deleteEventsBetween` are optional, because the production port
    (`watch.ts`) and the store methods are phase B's; phase B makes them required (now implemented).
  - The retained reader supplies validated physical carried-file byte and line totals through an optional callback, and the planner's
    `finish` accepts those totals. Counting only yielded carried records misses journal copies after a crash between the two renames.
    W4-C29's crash-window regression first measured 0 bytes/0 lines instead of 9,270 bytes/12 lines, then passed with the same-stream
    measurement. There is no second file read, no changed retained-set membership, and no weakening of byte-for-byte validation.
- **D-7015** — `recover-after-carried-rename-failure`: review round 1 found that the plan's ready-preserving arm for every
  pre-journal-rename failure is safe only for a first compaction. A later carried rename can drop old carried evidence while the
  live event IDs, evidence index and builder facts still retain it. Once the carried rename is attempted, a failure fails the
  applier and recovery over the files rebuilds those indexes; no parallel memory-prune recovery path is added. Failures before
  the carried rename keep the original cleanup/ready arm. W4-C13c faults both sides of `carried-directory-fsync`, `writer-close`,
  `journal-copy` and `journal-copy-fsync` during a second compaction, proves old evidence was dropped, requires reconstruction,
  then compares the recovered checkpoint and indexes with fresh recovery. RED first: outer exit 1, all eight rows failed at
  `the live indexes are no longer authoritative` (null failure). With the boundary corrected, the full compaction suite exited 0,
  72/72 passed. W4-C11 and W4-C15 retain the unchanged-journal assertions but require recovery after the carried rename.
- **D-7016** — `pruning-preview-keeps-wave3-collector`: `planPruning` continues feeding the logical retained set to the wave-3
  `DelegationRetentionCollector` and `planDelegationPruning`, rather than invoking the compaction planner in dry-run mode as
  Task 3.3 specified. Review round 1 records this departure without a code change; the preview's existing prefix-bound meaning
  stays distinct from the compaction plan's carried-set rewrite. The existing post-compaction pruning row pins retained holds.
D-7869 is defined in the plan's Deviations found, not here: the floor guard reads definitions from top-level plans only (14240).

## Review fix round 1, 2026-11-03

### Conditional rollback (F2)

D-7022's rollback is conditional, not a new record-grammar refusal. An older reader ignores the carried file. If a lease's creating
`lease-created` record was cut, its journal-only recovery refuses `lease-proof` and the lane reconstructs. When no such record was
cut, it can recover ready without carried records, and its repair can wipe and replay only the journal, dropping carried evidence
from SQLite. Returning to this PR's build reads the carried file again and repairs that evidence into SQLite. The pre-compaction
snapshot remains the restore point. The two W4-C30b journal-only stand-ins characterize both outcomes and the return path: outer
exit 0, two passed, 73 skipped. They do not execute an old binary, and are not claimed as a RED-first behavior change.

### Repair, snapshot parity and actual-J oracles (F4, A1, A4)

- C18 and C13b now use a call-through spy to observe the actual open's repair report on the same SQLite, without manual pre-repair
  or a production accessor. They require `wipedAll: false` and the actual cut count as `prunedBelow`. The added throwing-store row
  requires ready state, `projectionStale`, a warning, and deletion completed by the next repair. The targeted baseline passed four
  rows. Dropping `retainedFrom` at the actual-open wiring then failed C18's repair-report assertion; restored C18 passed.
- A1's two differential C23b rows, absent checkpoint and applied-zero checkpoint with carried evidence but no journal, first failed
  because the snapshot helper accepted evidence that recovery refused. The helper now enforces `carried-past-applied` for logical
  carried evidence consistently with recovery. The restored compacted-snapshot selection passed 14 rows, with 1,004 skipped;
  this targeted proof is not the whole-file snapshot gate.
- C13 compares carried sequences against the actual post-fault journal J, not the literal 1. CM10 coherently moves journal close,
  suffix copy and journal rename before the carried rename. It failed `every carried line overlaps the actual journal`; restored
  C13 passed. Coordinator ruling 14306 accepts this direct actual-J kill as A4's proof. The plan's anticipated sibling
  `held-evidence-missing` refusal was not measured and is not claimed.

### Bounded sequential mutation measurements (F3)

The first retainedFrom wiring launch failed before the runner or Vitest: outer exit 125, no JSON report, with
`timeout: fork system call failed: Resource temporarily unavailable`. It is a launch failure, not a mutation verdict. Its process
count omitted threads, which `RLIMIT_NPROC` counts. The saved source was restored with matching SHA; no test ran on that attempt.
Coordinator ruling 14301 authorized the retry with a same-subshell, count-only thread measurement and a cap of that count + 1,500.
The retry failed C18 at its own assertion, then the restored row passed. The initial launch failure remains part of the record.

Every row below ran sequentially in one scratch source tree, on the root filesystem proved by `df`, with fixture HOME and poisoned
`gh`, one worker, a 180 s timeout and 10 s kill-after. Each mutant was made from its saved source, with baseline SHA checked before
and after; finally restoration was byte-identical (`cmp` exit 0). Each RED had outer exit 1 and exactly one failed physical test;
each restored GREEN had outer exit 0 and exactly one passed physical test. No import error, timeout, wrong-row failure or queue/wait
notice occurred. These 24 required F3 measurements are not a fresh full compaction gate.

| Mutant | Physical row | Intended observed RED, followed by restored GREEN |
| --- | --- | --- |
| CM4 | C6 K1 | Open-lease/open-lineage correlation reason absent |
| CM5 | C6 K4 | Active Workflow launch reason absent |
| CM6 | C7 raw-lease window | Inclusive 10:24 boundary absent |
| CM7 | C8 straddling pairs | Both carried Pres absent |
| CM8 | C5 | Reconstructing planner enabled instead of disabled |
| CM9 | C4b | Seven-day floor instead of ten-day floor |
| CM10 | C13 | Actual-J overlap assertion false; no sibling refusal claimed |
| CM11 | C15 | Short copy resolved instead of rejecting |
| CM12 | C11, journal-rename:before | Event IDs 212 instead of unchanged 474 |
| CM14 | C12, journal-rename:after | Applier failure null |
| CM15 | C16, below J past applied | `sequence-gap` instead of `carried-past-applied` |
| CM17 | Added selectable C19 | Carried evidence rows deleted by contiguous delete through S |
| CM18 | C18 | Actual-open step-0 repair report mismatch |
| CM19 | C17 chunks | Deletes lack intervening event-loop turns |
| CM21 | C21 | Activity named by K5-carried evidence retired |
| CM23 | C11, journal-rename:before | Early retirement makes recovery refuse `identity-evidence` |
| CM29 | C5 | Cut through 3 instead of checkpoint-bounded 1 |
| CM30 | C6 K2 | Identity-candidate reason absent |
| CM31 | C6 K3 | Active-identity reason absent |
| CM32 | C7b | Raw lease without activity loses its own window |
| CM33 | C21 | Ended worker retired while its run is kept |
| CM34 | C30 | Journal-only repair has 203 rows instead of retained evidence's 212 |
| CM35 | C16, different overlap bytes | No `carried-past-journal` refusal |
| CM36 | C10 | Live Workflow launch map has two entries versus rebuilt one's one |

The selectable C19 was first GREEN on current code (one passed, 75 skipped). CM17 then failed its own carried-row assertion;
restored C19 was GREEN (one passed, 75 skipped), including the actual-open step-0 branch. Its measured-differently explanation
is under D-7013. The added row does not replace or alter C17, C30 or their retained-row helper.

### Carried integration corrections and verification limits (A5)

The watcher-port correction's isolated census passed 22, the full rings selection passed 138 across 12 files, the server typecheck
exited 0 and tests-inclusive typechecks passed 12. Deviation references passed 31 after D-7869's definition placement; dtbd passed
one. The subsequent delegation-method census correction passed 269 store tests. Original fast CI at `dbedeb85c` completed GREEN:
38 jobs succeeded or skipped; the required build and package summaries succeeded. Its fast planner selected 585 files across 12
shards (361 related, 127 untraced, 193 guards; overlapping reasons). This proves that selection, not the full suite.

The older gates below keep their original bases and failures. Fresh round-1 full gates and exact-head fast CI belong to the
new-head handoff, not to these targeted mutation results. No full local server suite, soak, live-data measurement, enqueue or
merge is claimed.

## Phase B verification

All measurements below are fixture-only. Scratch mutations run sequentially in one root-disk source copy, with a measured process
cap, `timeout -k`, saved-copy restoration and SHA checks; tracked production source is never mutated.

| Measurement | Result |
| --- | --- |
| W4-CM1 against W4-C2 | Survived; same-hour pass never enters the door |
| W4-CM1 against added W4-C2b | Red; a no-op hourly door committed |
| W4-CM2 against W4-C1 | Red; 3 encodes instead of 1, with 1 write and 1 revision |
| W4-CM3 against W4-C3 | Red; the mid-hour interval never entered upkeep |
| W4-CM16 against the closed source census | Red; `removeTemp(this.journalPath)` is an unlisted act |
| W4-CM27 against W4-C28 | Red; two same-day attempts instead of one |
| W4-CM28 against startup and boundary reconstruction rows | Startup passed, new boundary row red |
| N6 hour-spending mutation against new N6/RB22 row | Red; a rejected hourly upkeep retried in the same hour |
| Compaction suite, including the crash-window diagnostic | 64 passed |
| Real-lane compaction/upkeep suite | 12 passed |
| Recovery suite | 448 passed |
| Pass-timing suite | 88 passed |
| Wave-3 integration / closed retained-reader census | 34 passed |
| Kebab / mail-route census | 59 passed |
| Required-port adapters: delta applier / coordinator intent / health | 26 / 64 / 52 passed |
| Update flip / backups | 252 passed |
| Update phases | 246 passed, 6 skipped |
| Single-definition directory | 908 passed across 12 files |
| Full ring directory | 62 passed across 10 files |
| Anchors / citations / coordination-policy rings | 26 passed across 3 files |
| Untouched PWA suite | 10,242 passed, 1 skipped across 314 files; no type errors; jsdom printed its canvas `getContext` not-implemented notices |
| Untouched PR4-held watch suite | 8 failed, 272 passed; exact re-points below, not a green-suite claim |
| Tests-inclusive TypeScript | Passed after installing the declared agent dependencies; the earlier missing-`ws` failure was environmental |
| Armed growth check (`GROWTH_CHECK=1`) | 47 passed on committed implementation `15a4d0246` |
| Full server suite | Unrun while Task 3.6 and the complete deliverable are pending; no final suite claim |

The final pre-commit recheck on 2026-10-27 passed tests-inclusive TypeScript and, each alone, compaction (64), pass timing (88),
wave-3 integration (34) and real-lane compaction/upkeep (12). The complete PR3 deliverable is not done: Task 3.6 remains blocked,
the held watch suite remains red and the full server suite is unrun. The HEAD-based growth check passed all 47 rows after the
phase-B implementation commit. The diff from the branch base touches no reserved #1558 watch hunk. No PR or final wave-done
is issued; the next implementation wake is the coordinator's explicit Task 3.6 release.

The dependency installs reported audit findings: agent 6 (3 moderate, 3 high), UI 9 (5 moderate, 3 high, 1 critical), and PWA 12
(1 low, 4 moderate, 7 high). No dependency versions or lockfiles were changed; no audit repair was attempted in this work.

### Owned timing rows re-pointed or amended

- `D-5835 R1 (ii)`: the same-hour no-write/yield row now spies on `upkeep`, keeps the attempt-collapse
  `applyCheckpointChange` assertion, and measures encode/write/revision at upkeep start through compact start. The earlier flush
  phase is outside the claim and may legitimately write.
- `D-5692 R1`: the exact phase set includes `compact`.
- `D-5832 R1`: blocking CPU includes the compact phase; the fixture's expected sum rises by its 47 ms.
- `RE2`: 117 formatter inputs, 2,038 bytes at seven digits (114 kept, 3 dropped), and 77 kept / 40 dropped at the largest safe
  values. The six compaction sizes survive; the omitted fields are exactly the list's suffix. The 2,048-byte production bound is unchanged.

### Watch re-points, retained and verified on 2026-11-03

Commit `2dc5839a7` applied these re-points after the hold was released. Each row below was read and checked against the current
source; no blanket replacement or additional test edit was needed. The cursor invariant ran in half 1, and every other row in
half 2 of the exhaustive watch measurement below. Both halves exited 0, with no omitted or overlapping passing test:

| Row / group | Required re-point |
| --- | --- |
| Cursors (hand-off 4), checkpoint-only-change invariant | Keep the `applyCheckpointChange` observer for attempt filing and its unchanged-cursor assertions. Observe real `upkeep` separately, forwarding its request, and compare durable cursor rows before/after it. Require interval removal through that door, not an interval decrease in `applyCheckpointChange`; keep nonempty disk cursors and the lane source prohibition on direct cursor assignments |
| N6, failed prune | Spy on `upkeep`; expect `delegation upkeep failed:` once, reconcile continues, and no same-hour retry |
| R58, aged cursor dropped once per hour | Spy on `upkeep`; keep disk cursor and `cursorsPruned` assertions; the later-hour no-op enters the door but must not encode, write or move revision |
| R58, droppable cursor reappears | Spy on `upkeep`; first-hour call count 1, same hour still 1, next hour 2; keep disk cursor assertions |
| R58, young cursors | Hourly upkeep entry is legitimate; assert no cursor drop or durable mutation, not zero door entries |
| R58, source pin | Name `upkeep(` instead of `pruneBucketCursors(`; keep the readable-bucket and cursor-policy pins |
| RB21 / `watchDoor` | Forward `DelegationUpkeepRequest` to real `upkeep`; keep retired-row/mapping and per-hour/revision assertions; account for the expanded outcome shape |
| RB22 | Reject unified `upkeep`; expect its unified warning; keep reconcile continuation and spent-hour assertions |
| RE9 | Inspect `DelegationLane.upkeep`, require its call to `upkeep`, and forbid `applyCheckpointChange` within that method |

Other `applyCheckpointChange` spies retain their real attempt/lease/setup behavior. The cursor invariant still observes attempt
filing separately, forwards the real upkeep request, compares durable cursor rows, requires interval removal and nonempty disk
cursors, and forbids direct lane cursor assignment. R58's real-door observer measures checkpoint bytes, encode/write counts and
revision; the young-cursor and later-hour no-op cases preserve all four no-mutation assertions. `watchDoor` forwards the request
and checks the expanded outcome. N6 and RB22 preserve reconciliation and the spent hour, including interval-only work after a
rejected hourly attempt. RE9 inspects `DelegationLane.upkeep` and forbids `applyCheckpointChange` within that method.

## Production verification, 2026-11-03

Main was absorbed with a merge, not a rebase. The two actual conflicts were additive test censuses: the integration census keeps
both synchronous retention-port methods and main's boolean sweep result; the mail vocabulary keeps both the compaction and
projection guards. Their isolated pre-merge runs exited 0 (34 integration tests and 59 mail-route tests). No non-delegation lane
field or sweep call was changed in `watch.ts`.

### Watch measurement and exact coverage

| Attempt, UTC | Result |
| --- | --- |
| Full file, 07:28:15 | Incomplete: the measurement wrapper's 570 s deadline returned 124; no JSON verdict. The shared test slice reported 4 OOM kills, without attribution to this process |
| Unchanged full file, 07:42:37, one worker and no wrapper deadline | The tool's 600 s bound backgrounded the command and its managed task was stopped. A late Vitest report says 304 passed in 618.98 s; the outer test-runner exit is unmeasured, not green |
| Half 1, 08:01:43 | Outer exit 0; 135 passed, 169 intentionally skipped; 230.30 s |
| Half 2, 08:05:49 | Outer exit 0; 169 passed, 135 intentionally skipped; 270.57 s |

The two patterns partition all 41 top-level describes read from the source: half 1 contains the first 14, from
`the lane is a NON-AWAITED sibling at the census cadence` through
`the lane remembers what it dropped (R65): a link that rests on an event the slice no longer holds is unmeasured, never made`;
half 2 contains the remaining 27, from `fix round 2, minors N4 to N6` through the D-6967 follow-up-10 describe. Comparison of the
actual passing test names with the late full-file report proves a 304-test union, zero overlap and zero omission. Neither half's
saved stderr reports a slice-cap kill. No test-control setting was changed and no killed process was investigated.

### Tasks 3.6 and 3.7

Task 3.6's retained implementation captures the carried member additively under version 1, double-reads it across journal capture,
validates sparse evidence and matching overlap consistently with server recovery, restores old snapshots by preserving foreign
carried bytes, and thins all five member names. The unchanged merged snapshot suite exited 0 with 1,016 tests passed, including
W4-C23–C27 and the counted-schema/compacted thinning composition. `suffixAfter` is documented as reachable.

The mutation helper for Python modules cannot compile the JavaScript or TypeScript modules here. The specifically authorized
scratch-copy method was used instead: one source copy on the measured root filesystem, sequential runs through the test runner,
fixture HOME and poisoned `gh`, one worker, a measured process cap and a 120 s deadline with `--kill-after=5s`. Each original file was saved
before mutation and restored with a SHA-256 check; the tracked sources retained their original hashes throughout.

| Mutant | Expected row that went red | Observed failure |
| --- | --- | --- |
| W4-CM24, only one carried read | W4-C25 | Capture made one attempt instead of two |
| W4-CM25, carried omitted from the restore set | W4-C26 | No foreign directory entry, expected one; recovery alone is not the oracle |
| W4-CM26, feed journal-overlapping carried records | W4-C23 | Helper returned `sequence-descent` instead of the server's accepted verdict and coverage |
| W4-CM27, remove the day gate | W4-C28 | Two compaction calls instead of one |
| W4-CM28, remove readiness at the compaction boundary | W4-C28 boundary-reconstruction row | One forbidden compaction call instead of none |

Each mutant exited 1 with exactly its named assertion failed, not an import error or timeout. The restored snapshot group passed
12/12, and the restored daily-compaction group passed 7/7, both with outer exit 0. The latter covers same-day spending, next-day
retry, rejection, startup and boundary reconstruction, actual compacting-pass sizes and accepted timestamps, and both skip-line
forms. Those measurements precede the final-base campaign below. The full server suite remains unrun; no whole-suite or
wave-done claim is made here. Soaks were waived, not passed.

### Final-base campaign at `85270c001`

The second main merge absorbs #2171's documentation-only ledger fold. Every normal suite ran alone through `ccrc test`, with
one worker, fixture HOME, contained `gh`, resource and claim checks, and no wrapper deadline. After an incomplete sequential
measurement reached the tool's bound, every later gate received its own foreground tool call with the full 600 s allowance.

| Gate | Outer exit | Result |
| --- | --- | --- |
| Delegation compaction | 0 | 64 passed |
| Delegation recovery, standalone rerun | 0 | 448 passed; 08:50:50.274–08:57:36.477 UTC |
| Delegation watch | 0 / 0 | The exhaustive halves measured at `b1ede05b4`, 135 + 169 passed, carried by the documentation-only ruling below |
| Delegation pass timing | 0 | 88 passed |
| Wave-3 integration | 0 | 34 passed |
| Coordination snapshot | 0 | 1,016 passed |
| Delegation delta applier | 0 | 26 passed |
| Update flip / backups | 0 | 334 passed |
| Update phases | 0 | 250 passed, 8 skipped |
| Mail routes | 0 | 59 passed |
| Single-definition selection | 0 | 1,047 passed across 20 files, including its pin |
| Full rings plus coordination-policy rings | 1 | 136 passed, 2 failed across 12 files; missing watcher-port members below |
| Armed growth (`GROWTH_CHECK=1`) | 0 | 47 passed |
| Complete real-lane compaction/upkeep | 0 | 12 passed |
| Refreshed, unfiltered PWA | 0 | 403 files passed; 12,382 tests passed, 3 skipped; no unhandled errors |

The first final-base recovery attempt started at 08:34:59.526 UTC after the 45.21 s compaction command in the same tool call.
The call reached 600 s before recovery produced a verdict; its managed task was stopped, with no JSON or measured outer exit,
and the following timing command never started. This was a measurement error, not a recovery test failure. The coordinator
licensed one standalone rerun, with a finite two-half fallback only if needed. The standalone run above passed, so no recovery
split was made. Its default summary was `Test Files  1 passed (1)` and `Tests  448 passed (448)`.

The coordinator accepted the earlier watch halves at this base only if a whole-tree diff listed documentation alone. The actual
command `git diff --name-only b1ede05b4 85270c001` exited 0 and its complete output was:

```text
docs/superpowers/plans/2026-10-26-delegation-broker-wave4-project.md
docs/superpowers/plans/2026-10-26-delegation-broker-wave4-project/pr3.md
```

No watch rerun was made under that ruling. The earlier late full-file JSON still does not establish an outer exit; the two
exhaustive halves do.

#### PWA: retain the stale-install red, then the authorized remeasurement

The first fresh PWA run at this base, 08:20:04.532–08:27:02.768 UTC, exited 1. Its default summary was:

```text
 Test Files  11 failed | 392 passed (403)
      Tests  4 failed | 12233 passed | 16 skipped (12253)
Type Errors  no errors
     Errors  22 errors
```

The four failed assertions were two highlight-registry mismatches (`highlight-names.test.ts`, including an unresolved `json5`)
and two missing installed package/asset reads (`reader-pin.test.ts`). Nine more suites failed: `fonts-built`,
`markdown-worker-built`, `reader-assets`, `reader-bridge`, `reader-built`, `reader-images`, `reader-policy`, `reader-render-job`
and `w7-storage-keys`; their output reported missing shared-renderer entry points, including both build failures. The 22
unhandled errors were four `vaul` `getTranslate` exceptions in `sheet-desktop-arm` / `sheet-handle-only`, twelve missing-module
source errors and six related source-type errors in the reader bridge. The summary's `Type Errors  no errors` did not erase
those unhandled source errors. No installed launcher or Vitest file was inspected.

The coordinator ruled this a stale install and licensed exactly `npm ci` in `ui`, then `pwa`, followed by one unfiltered
remeasurement. Both dependency directories were real directories, not links; both installs exited 0 and tracked status stayed
empty. Audit output reported UI 31 findings (4 low, 25 moderate, 2 high), PWA 12 (3 low, 8 moderate, 1 high). No audit repair,
lockfile edit, forced install or source repair was attempted.

The authorized remeasurement, 08:46:08.096–08:50:23.580 UTC, exited 0 in 255.48 s. Default summary:

```text
 Test Files  403 passed (403)
      Tests  12382 passed | 3 skipped (12385)
Type Errors  no errors
```

There was no `Errors` line or unhandled block. This is the PWA gate's accepted evidence; the earlier red remains recorded.

#### Watcher-port integration gap

The full rings gate found two failures in `rings/watcher-store-port.test.ts`: its typecheck reports the new
`countDelegationEventsAtOrBelow` and `deleteDelegationEventsBetween` calls missing from `WatcherCoordPort`, and its exact
reach census reports those same two missing members, with no gone members. This is PR3's integration gap with main's narrowed
store port, not a main-red claim. The coordinator authorized exactly those two existing method names, sorted, in the single
`WatcherCoordMember` union in `server/src/coord/ports.ts`, preserving the port and the guard, and issued D-7869. The additional
single-file claim was accepted before editing. The measured census is the RED oracle. This correction and the note are committed
together; the isolated census, full rings selection, server typecheck, tests-inclusive typecheck and deviation references must
then pass. The coordinator carries the already-green base gates only if the whole-tree diff from `85270c001` names these two
files alone; that proof is required with the handoff.

## W3-M38, amended (for the wave-3 plan, plan :991)

W3-M38 is to read: "Add a journal rewrite, truncate, rename or remove caller other than the tail heal and `compactJournal`, or drop a
carry rule", with its rows `delegation-wave3.integration.test.ts`'s closed list and W4-C6..C8.

CI fix (14267): the store's delegation-method census goes from seven to nine with this PR's two retention methods; PR4's run read had made it seven after this plan was written.

## Round 1: terminal delegation shutdown (rulings 14343 and 14346)

D-7878 is defined in the top-level wave 4 plan's deviations section.

The fast CI run 41641540300 on `c63dc457704f2377ca76ab20b96cad9c73859134` is RED. Shard `server 5/12` passed assertions in all 50 files (4,527 passed, 10 skipped), but two unhandled `EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending` rejections attributed to `push-copy.test.ts` failed it; that file passed 85 assertions. The aggregate server check refused the failed prerequisite. Passing assertions do not erase these errors.

Three sequential, isolated tip diagnostics at that commit each passed all 85 push-copy assertions, with outer exit 0, in 114.350 s, 77.405 s and 96.563 s. All logged checkpoint-rename ENOENT details in trailing file contexts; none reproduced the RPC rejection or an unhandled-error block. One baseline at immutable main `ecba5ee6f85b18a4a7d40e9f8f33e1c00b67b9a4` passed 85/85, outer exit 0, in 45.953 s. It too logged checkpoint-rename ENOENT details, but no RPC rejection or unhandled block. All four ran through `ccrc test --local`, alone, with one worker, a fixture HOME and contained `gh`. No queue/wait notice appeared. The borrowed dependency symlink was removed before the detached baseline worktree was removed.

### Log counts and their boundary

These are nonexclusive counts of log lines, not distinct failed operations. The common measurable boundary is the first file-only context after the final named-test context; it is **not** a timestamp of last-test completion.

| File-scope tail | Checkpoint ENOENT detail | Durable application failed | Upkeep failure | Compaction |
|---|---:|---:|---:|---:|
| Main baseline | 2 | 1 | 0 | 0 |
| Tip diagnostic 1 | 3 | 1 | 1 | 0 |

Main's streams were merged: both ENOENT details preceded the file reporter marker, and all four category counts strictly after that marker were zero. Main had no `unknown test` headers. Tip diagnostic 1 had three such headers, but its stdout and stderr were captured separately: their ordering against stdout's file reporter marker is **unmeasured**, not zero. No fourth tip diagnostic was run to repair that capture limitation. These results establish an inherited fixture-ownership gap, not main-red, an exact RPC reproduction, a load-flake classification, or a completed fix.

The accepted correction is terminal awaited close, including budget-cut actual work and finally/log tails, plus explicit teardown ownership in push-copy's two factories. The lane drain retains non-blocking tick delivery, staged flushes, normal logs and crash ordering. Consent covers only the named lifecycle regions of `watch.ts`; the push-copy single-path claim was acquired before editing.

### Repair and RED → GREEN

Before production edits, both deterministic held-producer rows failed: durability closed while real upkeep or daily compaction was still held, and the close boundary did not include the slow-pass diagnostic tail. The selected run exited 1 with two failed rows and twelve intentionally unselected rows. After the repair, all fourteen lane rows passed. The held calls use real files and SQLite, call through to actual upkeep or compaction after release, and observe normal warnings without suppressing them. The compaction-held row exercises the daily call and its `nothing-to-cut` log; the existing compaction suite covers real cuts and crash ordering.

`DelegationLane.close` latches admission before aborting reads, drains actual runs rather than their budgeted races, then closes durability and stops samplers. The watcher owns the outer sweep/emit tail too. Durability's close latches before draining its admitted queue, rejecting later producers so the journal writer cannot reopen. Repeated close is idempotent. Push-copy's two factories register every watcher in a file-local list; teardown calls `stop` and awaits `closeDelegation` before fixture removal. Tick, synchronous stop, staged flushes, warning wording and compaction ordering are unchanged.

Fresh gates through single-definition, each isolated through `ccrc test --local` with one worker, fixture HOME, contained `gh` and a full foreground allowance:

| Gate | Result | Duration |
|---|---|---:|
| Held-upkeep / held-compaction before repair | RED: both failed as intended | 3.820 s |
| Compaction lane, full file | 14/14 passed | 14.468 s |
| Push-copy, three sequential runs | 85/85 each, outer exit 0 each | 57.635 / 46.616 / 48.283 s |
| Compaction | 76/76 passed | 69.452 s |
| Recovery | 448/448 passed | 439.367 s |
| Pass timing | 88/88 passed | 127.293 s |
| Wave-3 integration, first run | RED: 33 passed, one exact-text census failed | 85.059 s |
| Wave-3 integration, full rerun | 34/34 passed | 76.743 s |
| Delegation watch, full file | 304/304 passed | 380.412 s |
| Coordination snapshot | 1,018/1,018 passed | 56.972 s |
| Delta applier | 26/26 passed | 24.912 s |
| Single-definition, 20 files | 1,047/1,047 passed | 27.154 s |

The integration census rejected a combined close-and-store-presence condition. The new close guard was separated from the unchanged store-presence line; the census was not edited, and behavior did not change. Its full rerun passed. Gates earlier in the table preceded that equivalent source-line split; later gates include it.

The complete captures of all three post-fix push-copy runs contain zero checkpoint ENOENT details, durable-application failure lines, upkeep-failure lines, RPC teardown errors, unhandled blocks, `unknown test` headers or file-only stderr contexts after the final named context. Each contains 31 existing budget-cut warnings within named contexts: close aborts active reads through the existing warning path, not a log-suppression change. No queue/wait notice appeared. These are occurrence counts, not distinct-operation counts; stdout/stderr ordering is not inferred.

An armed growth-check run passed 47/47 but measured the preceding committed HEAD, not these uncommitted changes. It is not repair-growth evidence: the scoped repair must be committed and the armed gate rerun before the remaining static gates. Exact-new-head CI is still pending. The full server suite was not run locally; soaks remain waived, not passed.
