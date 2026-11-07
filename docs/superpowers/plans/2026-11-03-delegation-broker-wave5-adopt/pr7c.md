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
  inside the same await too, the ask is dropped there, as `keptOnce` drops a non-definite answer. An answer that comes back on an
  uncut pass clears the mark, so the cuts are counted afresh after it. A dropped ask can only be asked again later, by the
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
  A cut from anything else (the listing, a carrier read) is outside this bound, as it was before.
- **F2, what the rule counts.** The step's header and loop comments, and `pr7b.md`, stop saying "through one cut pass, never
  two": an ask answered non-definite on two passes, or cut inside its own await on two passes, is dropped. `pr7b.md`'s
  "Measured, not departures" names the kept-once ask that a later cut reaches first: it survives that cut and is dropped on the
  next pass that answers it non-definite again (a delay).
- **F3, the memory's bound.** The comment above `watch.ts`'s evidence memory and `pr7b.md` say the true bound: the session ids
  times the incarnations seen alive or retracted in this process. A `lastAliveAt` slot is pruned only by a measured absence the
  step has read, and a restart empties the memory. One line changed, net 0.
- **F4, the clock step's threshold.** `pr7b.md`'s "The read gate is wall clock" and D-8092 say the gap to `terminalAt` is
  sequence (1)'s threshold, and that for sequences (2) to (4), where the read gate compares the stamp with `adoptDecidedAt`, a
  step of about one decider-pass interval is enough. D-8092 amended in place.
- **F7, the F3 row.** (a) The row "review 1627 F3: a non-definite answer keeps its ask through one cut only" keeps its third
  audit call armed to cut on its last pass, so the decider assertion is decisive: under FR2-F3-everycut that pass runs three
  audits and is cut at the third (measured alone, with the row's earlier assertions disabled for the measurement: `expected 6 to
  be 7`); with the fix it runs one and reaches the decider. With F1 in place the row's third ask, cut inside its own audit on two
  passes, is dropped too, so the row now expects one ask, the one the cuts never reached, where it expected two. (b) Its first cut
  assertion, which reds under FR1-F4a, is no longer labelled CONTROL. (c) `pr7b.md` quotes the lane row
  `"W5-Q4: mail-disabled standing …"` in full in both tables, where `"W5-Q4"` matched `"W5-Q4b: …"` too.

## Rows, red then green

Run on this PR's base (`b018bd2b1`'s `delegationAdoptStep.ts`) with this PR's tests; green at this tip. All in
`delegation-adoption-lane.test.ts`.

| Ruling | Row | On the base |
|---|---|---|
| F1 | "review 1630 F1: an audit slower than the pass budget on every pass: each ask is marked at its first cut inside its own await and dropped at its second, so within 2 x 4 cut passes a pass reaches the decider and PR6's carrier step runs" | red: after the second cut all four asks are kept (`expected … to have a length of 3 but got 4`) |
| F1 (control) | "review 1630 F1, CONTROL: a fast audit keeps its ask as today: an answer on an uncut await clears its cut mark, so a later cut inside it marks it again" | green, as today: the ask is kept |
| F1 | "F4: a pass cut inside an awaited audit writes no lane memory but its ask's cut mark (review 1630 F1) and queues nothing" | red: the snapshot has no `cutInside` |
| F1, F7 | "review 1627 F3: a non-definite answer keeps its ask through one cut only" | red: after the second cut the third ask is kept (`expected [ …(2) ] to deeply equal [ Array(1) ]`) |

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
| PR7c-F1-unmarked (the ruling's) | no mark before the await, so a cut inside it returns leaving the ask unmarked, as at `ad726423c` | "review 1630 F1: an audit slower than the pass budget …", "F4: a pass cut inside an awaited audit writes no lane memory but its ask's cut mark …", "review 1627 F3: a non-definite answer keeps its ask through one cut only" |
| PR7c-F1-nodrop | the mark is set but a second cut keeps the ask | "review 1630 F1: an audit slower than the pass budget …", "review 1627 F3: a non-definite answer keeps its ask through one cut only" |
| PR7c-F1-noclear | an answer on an uncut pass does not clear the mark | "review 1630 F1, CONTROL: a fast audit keeps its ask as today …" |

### PR7b's mutants, re-measured on the code this PR changes

The four the rulings name, re-run here with the same bound and restore. Each still dies.

| Mutant | The mutation | Red rows (lane) |
|---|---|---|
| FR2-F3-everycut | a non-definite answer keeps its ask through every pass (`&& ask.keptOnce !== true` removed) | "review 1627 F3: a non-definite answer keeps its ask through one cut only" (at its `asked` assertion; alone, at its decider assertion, F7 (a)) |
| FR1-F4a | every answered ask dropped (the keep condition `false`) | "review 1622 F4 (a): a cut after answers that are not definite …", "review 1627 F3: a non-definite answer keeps its ask through one cut only" (at its first cut assertion, F7 (b)), "review 1630 F1, CONTROL: a fast audit keeps its ask as today …" |
| X-cut132 | no cut check after a carrier read | "F4: a pass cut inside its carrier read writes no lane memory" |
| X-cut169 | no cut check after the effects | "F4: a pass cut inside the effects loop keeps the adoption that landed, acts no further, and queues its notice on the next pass" |

## Measured, not departures

- **The bound counts passes that run the step.** A pass with no newer census does not run the step (the census gate), so the
  nine-pass bound is nine censuses, not nine lane passes. A cut that comes from something other than an audit (the listing, a
  carrier read, the effects) is not counted by the mark and keeps its old behaviour; the ruling's gap is the audit's alone, because
  only the audit's bound (60 s) is longer than the pass budget (45 s).
- **The late answer of a cut pass.** The audit call takes no abort signal, so a cut pass's await returns later, up to the audit's
  own 60 s bound, and its step then reads the cut and returns. If it was that ask's second cut, it drops the ask then. If a later
  pass has already cleared `asked` by then, the drop finds nothing (`indexOf` answers -1, guarded) and changes nothing. A later
  pass that starts while that await is still pending reads the mark, which is right: the pass that set it is already cut.
- **The adapter is unchanged.** `RunCcd`'s contract and the audit's 60 s bound are as they were. Bounding the audit under the
  remaining pass budget, so a slow audit answers `unmeasured` and `keptOnce` handles it, was the alternative the rulings named; it
  is a change to the adapter's contract, and the mark was enough, so it was not built.
- **The floor rule.** No transition-table row, no `assertLease` rule or decision, no fold, no journal kind, entry field or
  checkpoint member is added or changed. `store.ts` +0; `watch.ts` one line changed, net 0.

## Suites and growth

Run alone at this PR's tip through `ccrc test`, in the foreground, each file one run, all green on their first run:
`delegation-adoption` 45, `delegation-adoption-lane` 59, `delegation-adoption-corpus` 23, `delegation-carrier` 25,
`delegation-carrier-lane` 27, `delegation-projection` 44, `delegation-wave3.integration` 36, `delegation-watch` 311,
`hibernate-census` 13, `delegation-pass-timing` 90, `old-dead-reads` 8, `fleet-health` 54, `coord-store` 270, `anchors` 9,
`citations` 4, `topology-clean` 60, `coord-policy-rings` 19, every `single-definition/*` file (24 files, 1097 tests) and every
`rings/*` file (11 files, 125 tests), `typecheck-tests` 12, `GROWTH_CHECK=1` growth-check 54, and `deviation-refs` 31 and
`dtbd` 1 after `git fetch origin main` (`db3241593`). The server's `tsc --noEmit` and the pwa package's typecheck exit 0.
Growth against `main` (`db3241593`): `watch.ts` 12035 to 12035 lines (+0, one line changed); `store.ts` +0;
`delegationAdoptStep.ts` 240 to 251.
