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
