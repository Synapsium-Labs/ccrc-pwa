# PR7c (a slow audit no longer starves the adoption lane): departures and measurements

Run 1631, delegation broker wave 5. PR7b (#2420) landed after three review rounds. Its last review, 1630, found nothing that
blocks landing and one gap that matters for the lane's liveness, not its safety, which PR7 (#2396) had too: a `ws-lease-audit`
slower than what is left of the 45 s pass budget is cut inside its own await on every pass, its ask is neither marked nor
dropped, and the decider, `adoptDecidedAt` and PR6's carrier step stop running for as long as it stays slow. The coordinator's
rulings on that review are the whole scope of this PR: F1, and the text and test items F2, F3, F4 and F7. F5 and F6 are carried
to the Rider. Adoption stays shadow: nothing in the tree writes `$REG/delegation-adopt`, and arming it is the operator's.

**Ledger.** No new number. D-8092 is amended in place (F4, the threshold sentence for a backward clock step). No other D-text
the fix touches became untrue: D-8093 and D-8094 do not describe the audit loop's asks. The ledger learns from this note only
this pointer: PR7c amended D-8092 in place for review 1630 F4, and the rest is lane memory (below).

## The rulings, as built

- **F1, a slow audit is counted.** In the step's audit loop (`delegationAdoptStep.ts`, `runAdoptStep`), each ask is marked
  (`cutInside`) before its await. If the pass is cut inside that await, the mark stays. If the next pass that asks it is cut
  inside the same await too, with no answer between the two cuts, the ask is dropped there, as `keptOnce` drops a non-definite
  answer. An answer that comes back on an uncut pass clears the mark, so the cuts are counted afresh after it (review 1634 F3:
  the rule counts two cuts inside an ask's own await with no answer between them; the "review 1630 F1: an answer on an uncut
  await clears an ask's cut mark …" row pins the clearing). Since fix round 1 the step sees the cut when it happens (below). A dropped ask can only be asked again later, by the
  decider's rule 7, which asks whenever no audit is held; it never permits anything, because a lease with no held audit waits.
  The fix is lane memory only: the mark sits on the ask object in `AdoptLaneMemory.asked`, beside `keptOnce`, and a restart
  empties it with the rest. The step decides nothing the decider decides; like `keptOnce`, the mark only governs which of the
  decider's own asks the step runs again.
- **The bound.** The decider asks at most `DELEGATION_AUDITS_PER_PASS` (4) audits a pass. While every audit stays slower than
  the remaining budget and nothing else cuts the pass, each pass that runs the step is cut inside exactly one ask's await, and each
  ask is cut at most twice before it is dropped. So with K asks outstanding (K at most 4), after at most 2K cut passes the
  `asked` list is empty, and the next pass that runs the step has no audit to run: it reaches the carrier reads, the decider and
  `adoptDecidedAt`, and PR6's carrier step runs on it. In the worst case that is the ninth such pass (2 x 4 + 1). The decider then
  asks again, so while the audits stay slow the decider and PR6's carrier step run once every at most nine passes that run the
  step (one per new census). Each pass that runs the step needs a newer census, so in time the bound is nine census intervals.
  A cut from anything else (the listing, a carrier read) is outside this bound, as it was before. As built in round 0 the bound
  held only when each pass waited for the cut pass's late audit; review 1634 F1 found that overlapping passes could take a third
  cut per ask (3K + 1). Fix round 1 makes the step see the cut when it happens, and the bound above is measured with overlapping
  passes (the "review 1634 F1: overlapping passes …" row: the first decider pass is the ninth).
- **F2, what the rule counts.** The step's header and loop comments, and `pr7b.md`, stop saying "through one cut pass, never
  two": an ask answered non-definite on two passes, or cut inside its own await twice with no answer between, is dropped. `pr7b.md`'s
  "Measured, not departures" names the kept-once ask that a later cut reaches first: it survives that cut and is dropped on the
  next pass that answers it non-definite again (a delay).
- **F3, the memory's bound.** The comment above `watch.ts`'s evidence memory and `pr7b.md` say the true bound: the session ids
  times the incarnations seen alive or retracted in this process. A `lastAliveAt` slot is pruned only by a measured absence the
  step has read, and a restart empties the memory. One line changed, net 0.
- **F4, the clock step's threshold.** `pr7b.md`'s "The read gate is wall clock" and D-8092 say the gap to `terminalAt` is
  sequence (1)'s threshold, and that for sequences (2) to (4), where the read gate compares the stamp with `adoptDecidedAt`, a
  step of about one decider-pass interval is enough. D-8092 amended in place.
- **F7, the F3 row.** (a) The row "review 1627 F3: a non-definite answer keeps its ask once" keeps its third
  audit call armed to cut on its last pass, so the decider assertion is decisive: under FR2-F3-everycut that pass runs three
  audits and is cut at the third (measured alone, with the row's earlier assertions disabled for the measurement: `expected 6 to
  be 7`); with the fix it runs one and reaches the decider. With F1 in place the row's third ask, cut inside its own audit on two
  passes, is dropped too, so the row now expects one ask, the one the cuts never reached, where it expected two. (b) Its first cut
  assertion, which reds under FR1-F4a, is no longer labelled CONTROL. (c) `pr7b.md` quotes the lane row
  `"W5-Q4: mail-disabled standing …"` in full in both tables, where `"W5-Q4"` matched `"W5-Q4b: …"` too.

## Rows, red then green

Run on this PR's base (`b018bd2b1`'s `delegationAdoptStep.ts`) with this PR's tests; green at this tip. All in
`delegation-adoption-lane.test.ts`. Row titles are quoted as they read since fix round 1 (review 1634 F6, F7 retitled two).

| Ruling | Row | On the base |
|---|---|---|
| F1 | "review 1630 F1: an audit slower than the pass budget on every pass: each ask is marked at its first cut inside its own await and dropped at its second, so within 2 x 4 cut passes a pass reaches the decider and PR6's carrier step runs" | red: after the second cut all four asks are kept (`expected … to have a length of 3 but got 4`) |
| F1 (control) | "review 1630 F1: an answer on an uncut await clears an ask's cut mark, so a later cut inside it marks it again and keeps it (a fast audit keeps its ask as today, review 1634 F7)" | green, as today: the ask is kept |
| F1 | "F4: a pass cut inside an awaited audit writes no lane memory but its ask's cut mark (review 1630 F1) and queues nothing" | red: the snapshot has no `cutInside` |
| F1, F7 | "review 1627 F3: a non-definite answer keeps its ask once" | red: after the second cut the third ask is kept (`expected [ …(2) ] to deeply equal [ Array(1) ]`) |

The 1604 F4 row ("a pass cut inside an awaited audit writes no lane memory") is narrowed on purpose: the ruling makes the mark
the one write a cut inside an audit makes, so the row now asserts that the whole lane memory is unchanged but for that one field
on the one ask, which it sets in the expected snapshot. Nothing else in it is loosened: the mail assertion is unchanged.

## The mutation table

Every mutant below was run alone on this PR's tree, from a copy saved before the run and restored after it with its sha256
checked ("sha ok" every time), the tree clean after each. Each run was bounded: `ccrc test -- bash -c 'ulimit -u <threads +
1500>; exec timeout -k 10 900 vitest run test/delegation-adoption.test.ts test/delegation-adoption-lane.test.ts'`, the thread
count measured with `ps -eLf` before each run. The lane suite has 59 tests here and the L1 suite 45 (104 a run). Every mutant is
killed.

| Mutant | The mutation | Red rows (lane) |
|---|---|---|
| PR7c-F1-unmarked (the ruling's) | no mark before the await, so a cut inside it returns leaving the ask unmarked, as at `ad726423c` | "review 1630 F1: an audit slower than the pass budget …", "F4: a pass cut inside an awaited audit writes no lane memory but its ask's cut mark …", "review 1627 F3: a non-definite answer keeps its ask once" |
| PR7c-F1-nodrop | the mark is set but a second cut keeps the ask | "review 1630 F1: an audit slower than the pass budget …", "review 1627 F3: a non-definite answer keeps its ask once" |
| PR7c-F1-noclear | an answer on an uncut pass does not clear the mark | "review 1630 F1: an answer on an uncut await clears an ask's cut mark …" |

### PR7b's mutants, re-measured on the code this PR changes

The four the rulings name, re-run here with the same bound and restore. Each still dies.

| Mutant | The mutation | Red rows (lane) |
|---|---|---|
| FR2-F3-everycut | a non-definite answer keeps its ask through every pass (`&& ask.keptOnce !== true` removed) | "review 1627 F3: a non-definite answer keeps its ask once" (at its `asked` assertion; alone, at its decider assertion, F7 (a)) |
| FR1-F4a | every answered ask dropped (the keep condition `false`) | "review 1622 F4 (a): a cut after answers that are not definite …", "review 1627 F3: a non-definite answer keeps its ask once" (at its first cut assertion, F7 (b)), "review 1630 F1: an answer on an uncut await clears an ask's cut mark …" |
| X-cut132 (PR7b's name, from the line it stood on then) | no cut check after each carrier read (the check below `readDelegationCarrier`) | "F4: a pass cut inside its carrier read writes no lane memory" |
| X-cut169 (PR7b's name, from the line it stood on then) | no cut check after the effects loop (the check above the health and notices) | "F4: a pass cut inside the effects loop keeps the adoption that landed, acts no further, and queues its notice on the next pass" |

## Measured, not departures

- **The bound counts passes that run the step.** A pass with no newer census does not run the step (the census gate), so the
  nine-pass bound is nine censuses, not nine lane passes. A cut that comes from something other than an audit (the listing, a
  carrier read, the effects) is not counted by the mark and keeps its old behaviour; the ruling's gap is the audit's alone, because
  only the audit's bound (60 s, and the runner waits up to 65 s for it) is longer than the pass budget (45 s).
- **The late answer of a cut pass (as built in round 0; replaced in fix round 1).** The audit call takes no abort signal, so a
  cut pass's await returned later, up to 65 s after the audit began (its own 60 s bound and the runner's 5 s slack), and only then
  read the cut and dropped a twice-cut ask. A later pass could start before that and audit the ask a third time (review 1634 F1).
  Since fix round 1 the step races the await against the pass's signal and reads the cut at once; the late answer is consumed and
  ignored (below).
- **The adapter is unchanged.** `RunCcd`'s contract and the audit's 60 s bound are as they were. Bounding the audit under the
  remaining pass budget, so a slow audit answers `unmeasured` and `keptOnce` handles it, was the alternative the rulings named; it
  is a change to the adapter's contract, and the mark was enough, so it was not built.
- **The floor rule.** No transition-table row, no `assertLease` rule or decision, no fold, no journal kind, entry field or
  checkpoint member is added or changed. `store.ts` +0; `watch.ts` one line changed, net 0.
- **A raced audit can outlive `close()` (review 1640, observation).** After a cut the raced `ws-lease-audit` is no longer inside
  the pass's work, so `close()`, which waits for the passes' work, does not wait for it. The audit is read-only, and its late result
  writes nothing and logs nothing, so its child may outlive `close()` with no effect.
- **The bound with mixed latency (review 1640, observation).** The 2K + 1 bound (the ninth pass at K = 4) is the always-slow case,
  and it is the only case a row measures. With mixed latency an ask can take more of its own passes, because an answer clears the
  mark: a definite answer drops it at once; otherwise its events are cuts inside its own await (C) and non-definite answers (N), and
  two C with no answer between drop it (the mark), as does a second N (`keptOnce`, which no answer clears). So the longest run is
  C, N, C and then a C or an N, which drops it on its fourth (for example C, N, C, C). Each pass that is cut only inside an audit
  gives at least one ask one of its events, so while only audits cut the pass the decider comes by pass 4K + 1 (the seventeenth at
  K = 4). That figure is argued from the mark and `keptOnce`, not measured.

## Fix round 1 (review 1634)

The coordinator's rulings on review 1634 (round 1 of at most 3, at `da7e787a1`), taken whole: nothing critical, one important
liveness point, the rest minor. No new number; no D-text changes this round, so D-8092 is not amended again. F4 (a pass cut inside
the carrier-read loop does not advance `lastRead`) and F5 (an always-slow audit is dropped and asked again forever, with nothing
surfaced) are carried to the Rider.

- **F1, the cut is seen when it happens (ruled option (b)).** Each audit's await is raced against the pass's signal
  (`auditOrCut`, in the step): on the abort the step resumes at once, in the microtasks that follow it, and marks or drops the ask
  then, not when the late audit returns. The late answer, or a late rejection, is consumed by the race's handlers and ignored, so
  nothing is written from it and nothing goes unhandled. The change is in the step only: `RunCcd`'s contract and the audit's bound
  are unchanged. With it, a pass that starts before a cut pass's audit returns no longer sees a stale mark, and the bound is 2K + 1
  as stated above, measured with overlapping passes. Row: "review 1634 F1: overlapping passes, each starting while the cut pass's
  audit is still out …": the fixture's audit is held open past its pass (`holdAudit`) and the harness does not wait for it; every
  audit is cut; after the second pass the first ask is dropped while its audit is still out, and the first decider pass is the
  ninth. Mutant PR7c-FR1-norace (the plain await again) reds it at that drop (`expected [ …(4) ] to deeply equal [ …(3) ]`), and,
  measured with that assertion disabled for the one run, at the bound alone (`expected 12 to be 9`: no decider pass within twelve).
- **F2, the `drop` guard.** With the race, `indexOf` cannot answer -1 again. The reasons as corrected in fix round 2 (review 1640
  F2): the lane runs single-flight (`flight: 'skip'`), so a second pass cannot start until `pass()` returns, and `pass()` aborts its
  signal in its `finally`; the step's continuation after a raced abort runs in the same microtask drain, before anything a later
  pass can do. Only the audit's await is raced: a pass cut in the listing, a carrier read or `transitionLease` returns when that
  await settles, and none of those resume paths writes `asked`. The comment says so; the guard stays,
  because a -1 splice would drop the last ask, another lease's. EXTRA-noguard (the guard removed) survives, measured (105 of 105),
  which is what an unreachable guard gives. The comment above `asked.length = 0` now names the drop of an ask cut twice among a cut
  pass's writes.
- **F3, what the rule counts (text).** The step's header and loop comments and this note say: two cuts inside an ask's own await
  with no answer between them drop it, and an answer clears the mark.
- **F6, text.** `pr7b.md`: the heading "F3, one cut only." reads "F3, kept once."; its row sentence says the 1627 F3 row's last
  pass asks one ask and is armed to cut; the round-0 bullet says the mark is written before the await and that a second cut
  removes the ask; its tables quote the retitled row. The 1627 F3 row is retitled "review 1627 F3: a non-definite answer keeps its
  ask once: …". This note says 65 s for the late answer, and names X-cut132 and X-cut169 by what they remove.
- **F7, labels.** The row once titled "review 1630 F1, CONTROL: …" is retitled (it kills PR7c-F1-noclear and FR1-F4a) and now
  asserts the mark after each pass: set by the first cut, cleared by the answer, set again by the last cut. None of the three is
  labelled CONTROL: the first reds under PR7c-F1-unmarked (measured), the second under PR7c-F1-noclear. The F1 row says which
  ask the second cut drops (the first, and only it), not only how many remain.

### Rows, red then green (fix round 1)

Run on round 0's step (`da7e787a1`'s `delegationAdoptStep.ts`) with this round's tests; green at this tip.

| Ruling | Row | On round 0 |
|---|---|---|
| F1 | "review 1634 F1: overlapping passes, each starting while the cut pass's audit is still out …" | red: `the second cut drops the first ask at the cut, its audit still out: expected [ …(4) ] to deeply equal [ …(3) ]` |
| F7 | "review 1630 F1: an answer on an uncut await clears an ask's cut mark …" (its new mark assertions) | green: round 0 already cleared and set the mark; the assertions are its missing guard, red under PR7c-F1-noclear and PR7c-F1-unmarked |
| F7 | "review 1630 F1: an audit slower than the pass budget …" (which ask) | green: round 0 already dropped the first; red under PR7c-F1-unmarked and PR7c-F1-nodrop |

### The mutation table (fix round 1)

Run alone on this round's tree, bounded and restored as above ("sha ok" each time, the tree clean after each). The lane suite has
60 tests here and the L1 suite 45 (105 a run).

| Mutant | The mutation | Red rows (lane) |
|---|---|---|
| PR7c-FR1-norace (new) | the audit awaited plainly again, not raced against the signal | "review 1634 F1: overlapping passes …" |
| EXTRA-noguard (review 1634's) | `drop`'s `at !== -1` guard removed | none: survives (105 of 105), as an unreachable guard does (F2) |
| PR7c-F1-unmarked | no mark before the await | "F4: a pass cut inside an awaited audit writes no lane memory but its ask's cut mark …", "review 1627 F3: a non-definite answer keeps its ask once", "review 1630 F1: an audit slower than the pass budget …", "review 1630 F1: an answer on an uncut await clears an ask's cut mark …", "review 1634 F1: overlapping passes …" |
| PR7c-F1-nodrop | a second cut keeps the ask | "review 1627 F3: a non-definite answer keeps its ask once", "review 1630 F1: an audit slower than the pass budget …", "review 1634 F1: overlapping passes …" |
| PR7c-F1-noclear | an answer does not clear the mark | "review 1630 F1: an answer on an uncut await clears an ask's cut mark …" |
| FR2-F3-everycut | a non-definite answer keeps its ask through every pass | "review 1627 F3: a non-definite answer keeps its ask once" |
| FR1-F4a | every answered ask dropped | "review 1622 F4 (a): a cut after answers that are not definite …", "review 1627 F3: a non-definite answer keeps its ask once", "review 1630 F1: an answer on an uncut await clears an ask's cut mark …" |
| X-cut132 | no cut check after each carrier read | "F4: a pass cut inside its carrier read writes no lane memory" |
| X-cut169 | no cut check after the effects loop | "F4: a pass cut inside the effects loop keeps the adoption that landed, acts no further, and queues its notice on the next pass" |

## Fix round 2 (review 1640)

The coordinator's rulings on review 1640 (round 2 of at most 3, at `166e04e8a`), taken whole: nothing critical, and the production
code reads correct. No new number, and no D-text changes. The step's code is unchanged this round; only its comments change. Review
1634's F4 and F5 stay carried, as does a re-ask while a cut pass's audit is still out (two concurrent read-only audits of one tree),
which predates PR7c.

- **F1, the race's abort listener has its row.** Every earlier row cut the pass synchronously inside the fixture's `runCcd`, so the
  signal was already aborted when the race was set up and its pre-check arm resolved; the listener arm, the one a real timer cut
  takes, had no row. New row "review 1640 F1: a cut that arrives while the audit is already awaiting (a timer's cut) …": `onAudit`
  records that the pass is uncut when its audit is asked, and schedules the cut on a later macrotask (`setImmediate`), so the step is
  already awaiting the race when the abort lands. It asserts the same drop at the second cut while the audit is still out, and that
  the first decider pass is the ninth. The row found no defect, so the step's code is unchanged.
- **F2, the guard's reasons (text).** The comment above `drop` and this note's fix-round-1 F2 bullet keep the conclusion (-1 is
  unreachable) and give the corrected reasons (single-flight, the abort in `pass()`'s `finally`, the same microtask drain; only the
  audit is raced, and no other resume path writes `asked`).
- **F3, a cut pass's writes (text).** The comment at `asked.length = 0` lists every write a cut pass can make: the audits it held
  and their asks' drops, `keptOnce` on a non-definite answer, its asks' marks set or cleared, and the drop of an ask cut twice.
  `pr7b.md`'s F4 bullet says that a cut inside the first audit's own await writes that ask's mark, or drops it on the second cut.
- **F4, the rejection arm (text).** The race's docstring says the rejection arm fires only on a synchronous throw before `runCcd`
  runs (`runLeaseAudit` turns every `runCcd` throw into an `unmeasured` answer), and that no row measures it.
- **F5, the PR body.** PR #2426's body now says what the PR is: the mark and the drop, the race against the pass signal, the
  overlap row and the listener row, and the lane suite's count (61).
- **Observations.** The two are under "Measured, not departures": a raced audit can outlive `close()`, and the bound with mixed
  latency.

### Rows, red then green (fix round 2)

| Ruling | Row | On fix round 1's step |
|---|---|---|
| F1 | "review 1640 F1: a cut that arrives while the audit is already awaiting (a timer's cut) …" | green: fix round 1's code was already right, and the row is its missing guard; red under PR7c-FR1-nolistener (`the second cut drops the first ask at the cut, its audit still out: expected [ …(4) ] to deeply equal [ …(3) ]`) |

### The mutation table (fix round 2)

Run alone on this round's tree, bounded and restored as above ("sha ok" each time, the tree clean after each). The lane suite has
61 tests here and the L1 suite 45 (106 a run).

| Mutant | The mutation | Red rows (lane) |
|---|---|---|
| PR7c-FR1-nolistener (review 1640's) | the race's `else signal.addEventListener('abort', …)` arm deleted | "review 1640 F1: a cut that arrives while the audit is already awaiting …" |
| PR7c-FR1-norace | the audit awaited plainly again | "review 1634 F1: overlapping passes …", "review 1640 F1: a cut that arrives while the audit is already awaiting …" |
| PR7c-F1-unmarked | no mark before the await | "F4: a pass cut inside an awaited audit writes no lane memory but its ask's cut mark …", "review 1627 F3: a non-definite answer keeps its ask once", "review 1630 F1: an audit slower than the pass budget …", "review 1630 F1: an answer on an uncut await clears an ask's cut mark …", "review 1634 F1: overlapping passes …", "review 1640 F1: a cut that arrives while the audit is already awaiting …" |
| PR7c-F1-nodrop | a second cut keeps the ask | "review 1627 F3: a non-definite answer keeps its ask once", "review 1630 F1: an audit slower than the pass budget …", "review 1634 F1: overlapping passes …", "review 1640 F1: a cut that arrives while the audit is already awaiting …" |
| PR7c-F1-noclear | an answer does not clear the mark | "review 1630 F1: an answer on an uncut await clears an ask's cut mark …" |
| FR2-F3-everycut | a non-definite answer keeps its ask through every pass | "review 1627 F3: a non-definite answer keeps its ask once" |
| FR1-F4a | every answered ask dropped | "review 1622 F4 (a): a cut after answers that are not definite …", "review 1627 F3: a non-definite answer keeps its ask once", "review 1630 F1: an answer on an uncut await clears an ask's cut mark …" |
| X-cut132 | no cut check after each carrier read | "F4: a pass cut inside its carrier read writes no lane memory" |
| X-cut169 | no cut check after the effects loop | "F4: a pass cut inside the effects loop keeps the adoption that landed, acts no further, and queues its notice on the next pass" |

## Suites and growth

**Fix round 2.** Run alone at this round's tip through `ccrc test`, each file one run, all green on their first run:
`delegation-adoption` 45, `delegation-adoption-lane` 61, `delegation-adoption-corpus` 23, `delegation-carrier` 25,
`delegation-carrier-lane` 27, `delegation-projection` 44, `delegation-wave3.integration` 36, `delegation-watch` 311,
`hibernate-census` 13, `delegation-pass-timing` 90, `old-dead-reads` 8, `fleet-health` 54, `coord-store` 270, `anchors` 9,
`citations` 4, `topology-clean` 60, `coord-policy-rings` 19, every `single-definition/*` file (24 files, 1097 tests) and every
`rings/*` file (11 files, 125 tests), `typecheck-tests` 12, `GROWTH_CHECK=1` growth-check 54, and `deviation-refs` and `dtbd`
after `git fetch origin` (`cf00d1020`, which merges clean: `git merge-tree` exit 0). The server's `tsc --noEmit` exits 0.
Growth against `main` (`cf00d1020`): `watch.ts` +0, `store.ts` +0; `delegationAdoptStep.ts` 240 to 277 (this round adds comment
lines only).

**Fix round 1.** Run alone at this round's tip through `ccrc test`, each file one run, all green on their first run:
`delegation-adoption` 45, `delegation-adoption-lane` 60, `delegation-adoption-corpus` 23, `delegation-carrier` 25,
`delegation-carrier-lane` 27, `delegation-projection` 44, `delegation-wave3.integration` 36, `delegation-watch` 311,
`hibernate-census` 13, `delegation-pass-timing` 90, `old-dead-reads` 8, `fleet-health` 54, `coord-store` 270, `anchors` 9,
`citations` 4, `topology-clean` 60, `coord-policy-rings` 19, every `single-definition/*` file (24 files, 1097 tests) and every
`rings/*` file (11 files, 125 tests), `typecheck-tests` 12, `GROWTH_CHECK=1` growth-check 54, and `deviation-refs` 31 and
`dtbd` 1 after `git fetch origin` (`cf00d1020`, which merges clean: `git merge-tree` exit 0). The server's `tsc --noEmit` exits 0.
Growth against `main` (`cf00d1020`): `watch.ts` +0, `store.ts` +0; `delegationAdoptStep.ts` 240 to 271.

**Round 0.**

Run alone at this PR's tip through `ccrc test`, in the foreground, each file one run, all green on their first run:
`delegation-adoption` 45, `delegation-adoption-lane` 59, `delegation-adoption-corpus` 23, `delegation-carrier` 25,
`delegation-carrier-lane` 27, `delegation-projection` 44, `delegation-wave3.integration` 36, `delegation-watch` 311,
`hibernate-census` 13, `delegation-pass-timing` 90, `old-dead-reads` 8, `fleet-health` 54, `coord-store` 270, `anchors` 9,
`citations` 4, `topology-clean` 60, `coord-policy-rings` 19, every `single-definition/*` file (24 files, 1097 tests) and every
`rings/*` file (11 files, 125 tests), `typecheck-tests` 12, `GROWTH_CHECK=1` growth-check 54, and `deviation-refs` 31 and
`dtbd` 1 after `git fetch origin main` (`db3241593`). The server's `tsc --noEmit` and the pwa package's typecheck exit 0.
Growth against `main` (`db3241593`): `watch.ts` 12035 to 12035 lines (+0, one line changed); `store.ts` +0;
`delegationAdoptStep.ts` 240 to 251.
