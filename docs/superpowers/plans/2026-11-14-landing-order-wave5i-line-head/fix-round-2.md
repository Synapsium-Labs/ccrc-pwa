# Fix round 2 (review 2152)

## R3

**The defect (F3).** The deadline case in `server/test/radar-lane.test.ts` waited, after proj-b's first answer, in at most 1000
`setImmediate` turns for proj-b to have nothing in flight and both stats done. Fix round 1 called that a bound; it is not a bound on
wall time: 1000 turns are about 2 ms, so a proj-b read that is only slow exhausts the loop. That claim of fix round 1 is withdrawn.

**Mechanism (test only).** The `track` wrapper resolves a `bobSettled` promise when proj-b's in-flight count reaches 0 with both
stats done. The case awaits `Promise.race([bobSettled, cap])`, where the cap is a 10 000 ms timer taken from the real
`setTimeout`/`clearTimeout`, captured before `vi.useFakeTimers` and cleared afterwards. The `[0, 2]` assertion, the fake-clock
advance and the late-project assertions are unchanged; only the message names the cap. Production code is untouched.

**Red first (turn loop, proj-b's io after its first answer delayed 10 ms of real time).**
`timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/radar-lane.test.ts -t 'misses the deadline' --maxWorkers=2`
rc 1: `proj-b's reads never finished: the case would pass or fail on timing alone: expected [ 1, 1 ] to deeply equal [ +0, 2 ]`.

**Green with the same delay, event and cap in place:** same command, rc 0 (2 passed, the case and a sibling the filter matches).

**Delay removed:** the case three times, rc 0 each; the whole file
(`… vitest run test/radar-lane.test.ts --maxWorkers=2`) rc 0, 70 passed of 70.

**A hang still fails.** With the second proj-b stat never resolving, the case failed at the cap after about 10 s (10 021 ms in
the case, 12 s wall), rc 1: `proj-b's reads did not finish within 10000 ms of real time: the case would pass or fail on
timing alone: expected [ 1, 1 ] to deeply equal [ +0, 2 ]`. Restored from a saved copy, `cmp` identical, case green again.
Measured at the test commit of this item.

## R2

**Defect (F2).** `readRadarPass` raced only the whole probe-plus-control bundle against the pass's one deadline, so when the
lander or health read missed it, `failedBundle` replaced a probe that had already answered with `late` and the project's radar
result was dropped. At the merge base the probe raced the deadline alone. Wave 5i's first form regressed that race; it was never
an approved departure.

**Fix** (`server/src/coord/lineageRead.ts#readRadarPass` only). The probe read races the one `late` on its own; then, for a wanted
control, `readLandingControl` races the same `late`. A late probe is `late` in `reads` and `allFailed(late)` in `controls`, as
before. An answered probe with a late control keeps the probe in `reads` and gets `allFailed({ ok: false, reason: 'late' })` in
`controls` (held, no cue, no older green). A throw keeps today's `unreadable` bundle. The outer per-project race is gone (each
stage races itself); the doc comment says so.

**Tests** (`server/test/radar-lane.test.ts`), each red at `dffade1c0` and green after:

| Case | Red at the old code | Green |
|---|---|---|
| fast probe, slow lander (pass level) | `expected { ok: false, reason: 'late' } to deeply equal { ok: true, doc: ... }` | yes |
| fast probe, slow health (pass level) | same assertion | yes |
| genuinely late probe, healthy neighbour | passes at both (pins today's behaviour) | yes |
| sweep: fast probe, slow lander, store attached | `the answered probe was dropped with the late control: expected [] to deeply equal [ 'claude-a-proj-a-alpha' ]` | yes |

Each probe file is still read once (`range` count 1 in the pass cases; `probeReads` 1 in the sweep case). The sweep case also pins
the control as `late` in all three documents and zero new `next-to-land:` mail and zero deliveries. Limit, measured: the unhung
twin of that fixture queues no cue either (one pinned entry, no selectable head), so the zero-cue assertion is the strongest the
fixture allows; the hold is shown by the control being late.

**Mutant.** Old bundling restored in the control step (`if (!('lander' in control)) return failedBundle(n, lateOf);`), measured
at the fix commit. Command: `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/radar-lane.test.ts test/coord-lineage.test.ts test/coord-radar.test.ts --maxWorkers=2 -t R2`.
Result: rc 1, 3 failed (the two pass cases with `expected { ok: false, reason: 'late' } to deeply equal { ok: true, ... }`, the sweep
case with the dropped-probe assertion). Restored from the saved copy, `cmp` identical, the same three files green (298 passed).

**Unchanged:** one pass budget (the one `late` promise and its one timer, a local of the call), `RADAR_PASS_CONCURRENCY` 8, one
probe read per project, the abort signal, generation fencing in the watcher (`watch.ts` untouched), bounded adapters, the
`refused`/`absent`/`unreadable` answers and the listing's handling. No renewed deadline, no second timer, no second probe read.

### R2 addendum: ready-head twin, thrown control, two more mutants

**Sweep fixture is now a ready head.** The sweep cases seed a pinned entry whose run is at `merging` (claimed, episode matching the
entry's PR and sha), a fresh lander, a probe naming that head clean against the health sha, and fresh green health. Its unhung
twin queues exactly one `next-to-land:` mail and one delivery (`R2 twin`), so the zero in the hung cases can fail. The hung cases
(slow lander, slow health, each a fresh store) assert the radar result kept, the control late in all three documents, one probe read,
and zero cue mail and zero deliveries. They replace the earlier single sweep case, whose twin queued no cue.

**Thrown control.** A control read that rejects after the probe answered keeps the probe in `reads`; the control for that project is
`allFailed({ ok: false, reason: 'unreadable' })` (a `.catch` on the control race in `readRadarPass`). A probe that rejects keeps
today's answer (`unreadable` in both maps; pinned by a case that passes before and after). Red first: the lander-rejects case at
the previous commit failed `expected { ok: false, reason: 'unreadable' } to deeply equal { ok: true, doc: ... }`.

**Mutants** (measured at `e72d31a1b`; command `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/radar-lane.test.ts test/coord-lineage.test.ts test/coord-radar.test.ts --maxWorkers=2 -t R2`; each restored from the saved copy, `cmp` identical, the three files green at 302 passed):

| Mutant | Result |
|---|---|
| old bundling: a late control returns `failedBundle(n, late)` | rc 1, 4 failed: both pass cases (`expected { ok: false, reason: 'late' } to deeply equal { ok: true, ... }`) and both sweep cases (`the answered probe was dropped with the late control: expected [] to deeply equal [ 'claude-a-proj-a-alpha' ]`) |
| late control made `{ lander: late, probe: <answered>, health: late }` | rc 1, 4 failed, all at the control-equality assertion (`expected { lander: ..., probe: ..., health: ... } to deeply equal ...`). The zero-cue assertion was NOT reached in this run, so this mutant shows the control equality catches it, not that the cue count would; I did not measure whether the store would queue a cue from that partial bundle. |

Deadline note: the pass-level R2 cases now use a 2000 ms deadline instead of 60 ms (the hung reads never resolve, so they still settle at the deadline; a loaded box cannot make the fast probe miss it).

## R4 (a damaged terminal dependency target is not an outstanding blocker)

**Defect.** `landingOrder` built `outstanding` from the display state, so a target stored `landed`, `closed` or `withdrawn` whose
retained fields were damaged (display `unknown`) held every dependent head `empty-or-blocked` forever. Fix round 1 recorded this as a
limitation; **that limitation is withdrawn** (plan Task 3 Step 5: terminal rows with retained diagnostic damage do not become open
blockers). `fix-round-1.md` is not edited.

**Rule.** A display-`unknown` target is settled (not outstanding) only when all hold: its id is a safe positive integer; exactly one
entry of the project carries that id; exactly one `stateWords` record carries that id; and that record's word has
`LANDING_ENTRY_TERMINAL[word] === true`. A missing or duplicate record, `'unrecognised'`, stored `unknown`, `pinned` and `ejected`
stay outstanding. Display `pinned`, `ejected` and a non-terminal target are unchanged.

**Interface change (departure `order-reads-stored-words`).** `landingOrder(entries, flags, recovery?, stateWords?)` and
`landingViewOf(entries, flags, recovery, pr, stateWords?)` gain the optional `LandingMutationFacts['stateWords']`; omitted is the old
display-only rule exactly. Callers: `landingBindingOf` (passes `facts.stateWords`) and `GET /api/landing` (one argument added to its
`landingViewOf` call; no decision in the route). The walk, `byKey`, line membership and raw bytes are untouched.

**Cases** (`landing-terminal-damage.test.ts`, real store; H is created by the authority writer, ordered behind T while T reads, then T
is damaged): 3 words x 5 damages (afterIds, fixesMain, ejectionKind, pinnedAt, ejections): H is the ready head, its cue queues once,
a second pass answers `duplicate`, T's raw bytes are unchanged. Controls: damaged pinned, ejected, unrecognised and stored-unknown
targets, a quarantined stored-unknown target (order head null, binding held, zero cue); an independent recovery hold answers
`recovery`; a dangling edge (T's id in no entry) answers exactly as before (it was never outstanding, so this is parity, not a new
hold); the entries table keys on `id`, so a duplicate-id fixture cannot be built in the store (the insert throws) and duplicates are
covered purely. `landing-line-order.test.ts`: omitted input equals today's answer; each terminal word settles; pinned, ejected,
unknown, unrecognised, missing record, duplicate record, duplicate entry id and an unsafe id stay outstanding.
`landing-read-route.test.ts`: `order.head` is H behind a damaged landed target and null behind a damaged pinned one.
Pass: 248 tests, 5 files, rc 0 (full selection of the brief, `--maxWorkers=2`), at 8e52241e8.

**Reds.** Tests were written after the fix (a store-level red against the old code is mutant (a), which restores the old rule).

| Mutant (one at a time, saved copy, `cmp` restore, same selection green) | Result at 8e52241e8 |
|---|---|
| (a) terminal test ignores the stored word (`settled` returns false: display-only rule) | 19 failed: the 15 damaged-terminal cases, 3 pure, 1 route (`expected null to be 1`, `expected { mode: 'held' ...} to match object { mode: 'ready' ...}`) |
| (b) stored-word test accepts any word except `pinned`/`ejected` | 5 failed: pure stored `unknown` and `unrecognised`, controls raw `unknown`, raw `parked-v9`, quarantined `unknown` (`expected 7 to be null`, `expected 1 to be null`) |
| (c) exact identity dropped (no one-entry check, any record count >= 1) | 1 failed: "a missing record, a duplicate record and a duplicate entry id stay outstanding" (`expected 1 to be null`); duplicate id is pure-covered only, as the store cannot build it |

Each mutant was restored from the saved copy; `cmp` matched; the unmutated file is the committed one.

A marked terminal target: a stored `landed` target carrying the `stale-episode-head` marker and one damage field settles the edge (H ready, cue queues once, then `duplicate`), consistent with fix round 1's ruling. It was green at the fix, not red-first; 249 tests pass in the 5-file selection.

## R1

**Defect (F1).** In `decideLandingWrite`'s retreat arm, `current.state !== 'pinned'` read the DISPLAY state before the
projection-unreadable refusal. An owned row whose stored word is `pinned` but whose afterIds, fixesMain, ejectionKind,
pinnedAt or ejections do not read displays `unknown`, took the `kept` branch, and the retreat moved the run merging to
working past an entry nobody can read.

**Rule.** For an owned row (`current.runId === runId`) whose STORED word is exactly `pinned`, a projection that is not
`readable` is refused with `landing-projection-unreadable`, recovery `repair`, before any display-state test and before the
equal/stale head comparison: no move, no write, no ejection count, no ask. Any other stored word, no record, or an unowned
row keeps today's answer. Neither terminal repair nor `stateWords` authorizes a retreat through an unreadable owned row.

**Interface (departure `retreat-reads-stored-word`).** `decideLandingWrite` gains the required input
`storedState: LandingEntryState | 'unrecognised' | null` (the stored word of `current`, null when no row or no record).
store.ts hunk: in `CoordStore.advanceLanding`, 1 line added (`const storedState = facts?.stateWords.find(...)`) and the
`decideLandingWrite(...)` call line changed (2 lines touched in all, nothing else).

**Cases.** Pure (`landing-entry-store.test.ts`): owned stored-pinned display-unknown over unreadable/null projection,
bare/named, equal/stale head refuse; unowned, null-runId, and stored landed/closed/withdrawn/ejected/unknown/unrecognised/null
keep; readable owned pinned still ejects/quarantines. HTTP (`landing-advance-route.test.ts`): damaged afterIds, fixesMain,
ejectionKind, pinnedAt, ejections x equal/stale x bare/named = 20 cases, ejections seeded 1 where not the damaged field,
asserting 503 `landing-projection-unreadable` `recovery: repair`, run still merging, raw entry/run/witness rows and mail count
byte-identical, no ask; controls: readable bare/named equal-head eject, stale-head quarantine, owned stored-landed damaged row
kept. The two oversized pinnedAt/ejections store cases (retreat step) now expect the refusal, not `kept`.
Red at ef6611c40 (new cases only): 21 failed (20 HTTP, each 200 with `landing: kept unknown`; 1 pure `kept` instead of
refuse); controls were green. Green at c93a33136: landing-advance-route, landing-entry-store, landing-writes,
landing-terminal-damage, landing-ejection-ask, landing-land-store, landing-entry-census: 7 files, 327 tests passed.

**Mutations** (measured at c93a33136; selection: landing-advance-route + landing-entry-store with `-t "R1|fix round 2"`;
saved copy, `cmp` restore, same selection green after: 27 passed).

| Mutant | Result |
|---|---|
| (a) `ownedPinned = false` (refusal deleted) | 21 failed (the 20 HTTP damaged cases + the pure refuse case) |
| (b) `ownedPinned` reads `current.state === 'pinned'` (display) | 21 failed, same set |
| (c) `ownedPinned = storedState === 'pinned'` and the outer ownership test dropped | 1 failed: the pure "unowned or other word keeps today's answer" case |

## R5 and R6 (code)

Commits: `6ae3f2daa` (A1), `7177edd4c` (A2), `af7410dbc` (A5 and the control body's header), `fd4ec4090` (the handle guard and README).

- **A1, the Date.parse exemption.** `landing-entry-census.test.ts` `clockAndFs` now exempts only the `Date` identifier that is the
  receiver of a `.parse(` call (found on the syntax tree), so a mixed line still counts its other `Date`. Controls added to the
  CONTROL case: `Date.now() - Date.parse(at)` and `new Date(x).getTime() + Date.parse(y)` are flagged, a standalone `Date.parse(at)`
  passes, a standalone `Date.now()` is flagged. Red first: `expected [] to deeply equal [ '1 Date' ]` against the old whole-line
  exemption. Mutant: the exemption count forced to cover the whole line, run with `-t "CONTROL: the policy scan"`: rc 1, the same
  assertion text; `cmp` restore equal; green (1 passed). Measured at `6ae3f2daa`'s parent plus the edit.
- **A2, comments.** `landedLane.ts` header now says L4 acts on L1's answers (`landedProjectStep`, `landedPruneIds`,
  `landedMarkStep`); `landedCandidatesOf`'s doc names the non-landable terminal-repair candidates. Comments only.
- **A5, a missing run answers `run-unreadable`.** `nextLandingNoticeOf` maps `run === 'missing'` and `'unreadable'` to
  `run-unreadable`; `'run-absent'` left `NextLandingNoSendReason` (no other landing code used it). `NextLandingFacts.run` keeps its three
  arms. The `row === null` branch in `landingControlTx.ts` was unreachable (the decider answers no-send for a missing run before any
  `send`, and a run episode is only built from a run object), so it is removed and `queueLandingNoticeTx` takes `row!` with a comment;
  `queued.why === 'run-gone'` still maps to `episode-changed`. Tests: the pure case now expects `run-unreadable`; a real-store case
  deletes the selected head's run row (foreign keys off for the delete) and expects
  `{ kind: 'no-send', reason: 'run-unreadable', holdChanged: false }` with zero mail, deliveries and observations. `mail-routes.test.ts`
  was not read or edited. Red: pure case `expected 'run-absent' to be 'run-unreadable'`; the real-store case first failed on
  `FOREIGN KEY constraint failed` (a defect of the test, fixed with `PRAGMA foreign_keys = OFF`), then reds as
  `expected { kind: 'no-send', …(2) } to deeply equal { kind: 'no-send', …(2) }` under the mutant. Mutant: `'missing'` mapped back to
  `run-absent`: rc 1, 2 failed, 47 passed; `cmp` restore equal; green 49 passed.
- **R5, header and handle guard.** The `landingControlTx.ts` header no longer says the store does not grow. New census test, "the
  transaction body holds the database handle once ...": `coord.db` appears once in the comment-stripped code, inside
  `applyLandingControlTx`; no `async`, `await`, `Promise`, `tx(`, `BEGIN`, `COMMIT`, `ROLLBACK`; the only importer is `store.ts`.
  Mutants: a second `coord.db.prepare('SELECT 1').get()` in the body: rc 1, `the handle is named exactly once: expected [ 'coord.db',
  'coord.db' ] to have a length of 1 but got 2`; a value import of `landingControlTx.js` in `landingNext.ts`: rc 1, `expected [ …(2) ]
  to deeply equal [ 'server/src/coord/store.ts' ]`. Each restored with `cmp` equal.
- **README.** The landing-line paragraph now says the pause is the stored flag and `mainRedHold` / `order.paused` are recomputed on the
  read from the latest control snapshot (the same pure transition, no write), and the opt-out trap sentence says the stored flag stays
  set and the read keeps showing it while the `binding` reads `inert`.
- **Gates.** The brief's 7-file vitest selection: 7 files, 277 tests passed; `tsc --noEmit -p .` rc 0.
- **Review follow-ups.** `row!` in `landingControlTx.ts` is replaced by an explicit invariant: `if (row === null) throw new Error('landing-next: a run episode without a run row …')` before `phase.at = 'apply'`. The branch is unreachable by the decider's contract (`nextLandingNoticeOf` returns no-send for a missing run), so no test drives it; if it ever fires the body throws and the store rolls back and classifies it, never an `episode-changed` no-send. The real-store run-row-gone test now sets `foreign_keys` back to ON in a `finally`. The header's growth clause is split into its own sentence. Re-run: the 7-file selection 277 passed, `tsc --noEmit -p .` rc 0.

## R5 records

**Statement.** The control-tx-module placement (departure `control-tx-module`, `fix-round-1.md#r5`) is permitted by the coordinator only
within the measured boundary: one call from `CoordStore.applyLandingControl` inside its owned synchronous transaction; the guard, the
catch, the rollback/boundary and the fence stay with the store; no async, no wrapper transaction, no extra state or writer, no widened
port. Passing the new-file growth waiver is a measured rule result, not an architecture license. No further decomposition and no
exemption is requested.

**Correction of a stale explanation (A4).** `task-5.md`'s `control-tx-takes-port` bullet and `fix-round-1.md`'s closing note said
the body reads `const { db } = coord` because core-vocab's REACH forbids `coord.db`. The code (`server/src/coord/landingControlTx.ts`)
uses `coord.db`, legal only because that file is in `HANDLE_HOLDERS` (`server/test/single-definition/core-vocab.test.ts`, the set with
the wave 5i comment). Each of those two places now carries one added sentence pointing here; the old text is kept.

**Departure `control-tx-handle-holder`.** `landingControlTx.ts` is a member of core-vocab's `HANDLE_HOLDERS` ONLY because the
`mainRedHold` UPSERT in `applyLandingControlTx` runs inside `CoordStore.applyLandingControl`'s owned synchronous transaction. The
rationale: one store owner (one call site, inside the store's `tx`); no transaction of its own; no async; no state; one `coord.db`
statement. No other port consumer gains handle access: the set gained this one file and no other. The core-vocab file is NOT edited in
this round (it conflicts with main; an absorb needs an operator decision). The next independent review is asked to assess the
membership. The slug is added to `task-5.md`'s `## Departures` and to `task-7.md`'s list.

**The red-able guards that hold it** (`server/test/landing-entry-census.test.ts`, the "wave 5i ownership" block):
- "mainRedHold is written by ONE statement, the UPSERT in landingControlTx.ts, and operatorPaused is not in its SET": one write to
  `landing_projects`, the UPSERT, whose SET is `mainRedHold` only. No mutant of it is recorded in this round's code section.
- "the transaction body is called only by CoordStore.applyLandingControl, inside its tx": one caller, `tx(this.db` precedes the call in
  source order, one INSERT in the body. No mutant of it is recorded in this round's code section.
- "the transaction body holds the database handle once, in applyLandingControlTx, opens no transaction of its own, and only store.ts
  imports it" (added in this round, `fd4ec4090`). Mutants: a second `coord.db.prepare('SELECT 1').get()` in the body, rc 1,
  `the handle is named exactly once: expected [ 'coord.db', 'coord.db' ] to have a length of 1 but got 2`; a value import of
  `landingControlTx.js` in `landingNext.ts`, rc 1, `expected [ …(2) ] to deeply equal [ 'server/src/coord/store.ts' ]`. Each restored
  with `cmp` equal (see "R5 and R6 (code)").
- core-vocab itself: with the file removed from `HANDLE_HOLDERS` the suite is red (`fix-round-1.md`, task-7 F6).

**Growth figures (A6, A7).** Counted with the growth check's own rule: `server/test/growthCheck.ts`'s `netGrowth` (`codeLines` of
`git show <sha>:<file>`, an absent base counting as 0), run through `tsx` from `server/` (a throwaway script outside the tree). The
merge-base of `origin/main` and HEAD as already fetched (no fetch) is `2b082b91f`; `a6b87cf79` is the earlier one.

| File | Base | Reviewed tip `59d3223fa` | Delta | HEAD `03e99c879` | Delta |
|---|---|---|---|---|---|
| `landingControlTx.ts` (new) | absent (0), both bases | 47 | +47 | 47 | +47 |
| `store.ts` vs `2b082b91f` | 5352 | 5401 | +49 | 5402 | +50 |
| `store.ts` vs `a6b87cf79` (a later tip against an older base, not the ruling's figure) | 5341 | 5401 | +60 | 5402 | +61 |
| `store.ts` at `9210e7a37` vs `a6b87cf79` (the figure the review and the ruling quote) | 5341 | 5390 | +49 | n/a | n/a |

`landingControlTx.ts` is +47, not +48. The review's `store.ts` pairing "5341 to 5390 against a6b87cf79" is the figure at `9210e7a37` and
`194f39ed4` (both measured: 5390, +49 vs `a6b87cf79`, +38 vs `2b082b91f`); at the reviewed tip the file stands at 5401, which is +49
against the current merge-base `2b082b91f` (the review's second pair). R1's one added line in `CoordStore.advanceLanding` (`c93a33136`)
makes HEAD 5402, +50 against `2b082b91f`. `store.ts` therefore grows (the header sentence "so the store does not grow" was wrong, A7,
and is corrected in `af7410dbc`); the rule passes only through the new-file waiver. Why that passes at +50, over GROWTH_LIMIT 40,
checked in the code: the header of `server/test/growthCheck.ts` (D-8563) says a new file waives a listed file's growth only when
`rings/ring.ts` gives it the grown file's ring and the spec's context table, read at the merge-base, the grown file's context
(`ringHomes`, used by `growthOver`). Measured with `ringHomes(root, '2b082b91f', 'HEAD')`: `store.ts` and `landingControlTx.ts` both
answer `{ ring: 'L3', context: 'C5' }`, and `landingControlTx.ts` is added in this PR's diff. `store.ts` is listed (not frozen or capped):
it is in neither `server/test/growth-frozen/` (one other file) nor `server/test/growth-caps/`, and no `growth-waivers/` entry names it,
so a waiver does count and the new-file waiver is the only one in play. If `landingControlTx.ts` left this PR, `store.ts` at +50 would be over.
`GROWTH_CHECK=1 timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/growth-check.test.ts --maxWorkers=2` at HEAD: rc 0, 1 file,
95 passed. The test prints neither a merge-base nor a per-file figure, so the figures above are mine, not read from its output.
`fix-round-1.md` R5's table cell for `landingControlTx.ts` is corrected to +47.

## R6 records

**`LandingMutationFacts.stateWords` (A3, departure `facts-state-words`).** Exact shape, `server/src/coord/landingWrites.ts`:
`stateWords: { id: number; value: LandingEntryState | 'unrecognised' }[]`, one record per entry of the project. It is the stored
`state` column as the row holds it, read before the display fold; it never says a row reads.
- **One producer:** the facts fold in `landingEntry.ts` (`mine.map`), from the raw stored `row.state`: the word itself when
  `isLandingEntryState` accepts it, `'unrecognised'` for a word the vocabulary lacks.
- **Consumers at HEAD** (grep of `server/src`): `landingBindingOf` (`landingLine.ts`, openness from the stored word, and its
  `landingOrder(facts.entries, CLEAR, undefined, facts.stateWords)` call); `landingOrder` (optional fourth argument, R4); `landingViewOf`
  (optional fifth argument, passed `read.facts.stateWords` by the landing read route in `routes.ts`); and the landing write path in
  `store.ts` (`CoordStore.advanceLanding`), which finds the stored word of the current entry and passes it to `decideLandingWrite` as
  `storedState` (R1). `landingNext.ts` and `landingReadView.ts` reach it only through `landingBindingOf` (the latter passes `{ ...facts, flags }`). No other reader.
- **Publication** in the central plan and spec interface blocks is the coordinator's, not this PR's. The slug is in `task-7.md`'s list
  with `order-reads-stored-words`, `retreat-reads-stored-word` and `control-tx-handle-holder`.

**A5, the task-7 record.** Departure `run-absent-word` (`task-5.md`) is withdrawn: fix round 2 aligned a missing run to the approved
`run-unreadable` (`fix-round-2.md#r5-and-r6-code`). It is marked so in both `task-5.md` and `task-7.md`'s list, and the F4 text in
`task-7.md` that recorded the unreachable `episode-changed` branch as behaviour has a correcting sentence after it.
