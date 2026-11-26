# Wave 5k, Task 2: the door answers in L0 (D-9107)

- `shared/landingLine.ts`: `LandingPauseAnswer` and `LandingWithdrawAnswer`, beside `LandingNoticeOutcome`, as section 4.1 gives
  them. The file still imports nothing.
- `server/src/coord/landingWrites.ts`: the ok arms are `({ ok: true } & LandingPauseAnswer)` and
  `({ ok: true; coordinator: Coordinator } & LandingWithdrawAnswer)`; the failure arms and the routes are unchanged.
  `LandingNoticeOutcome` left this file's type import, which no longer names it.

## Runs

- The server typecheck: clean.
- The server typecheck that includes the tests, tried once in the local test slice: killed by the slice's memory cap, in the
  wrapper's words "the test slice's memory cap killed a process during this run (MemoryMax=6G, CCRC_TEST_SLICE_MEMORY_MAX;
  1 OOM kill(s) in ccrctests.slice); exit 137". The pull request's run is the arbiter.
- The pwa typecheck: clean.
- `landing-doors-route` (15), `landing-writes-act` (6), `single-definition/` whole (47 files, 1613 cases), `rings/` whole
  (12 files, 134 cases): green.
