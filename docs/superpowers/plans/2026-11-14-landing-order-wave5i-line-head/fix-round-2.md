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
