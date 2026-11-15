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
