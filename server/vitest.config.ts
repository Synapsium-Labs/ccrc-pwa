import { defineConfig } from 'vitest/config';

// This suite is not a unit suite that happens to be slow: over a hundred files
// SHELL OUT — real `bash` running `ccd`, real `git` building fixture repos,
// real `tmux` — from fork-parallel workers, on machines (the dev box and the
// CI runner alike) that are doing other work at the same time. Vitest's
// default `testTimeout: 5000` is a budget for an in-process assertion, and
// against `spawnSync('bash', …)` under load it is a COIN FLIP: three separate
// full runs of this suite each shed a DIFFERENT test — `pr-sweep`,
// `ccd-ws-gc`, `session-hook` — every one of which passes in isolation.
//
// That is not a product bug being masked. It is measurement noise, and it is
// expensive noise: `.github/workflows` makes this suite a REQUIRED check on
// protected `main`, so a flake blocks a merge and teaches everyone that a red
// required check means "click re-run" — which is precisely how a real failure
// gets clicked past. 20s is chosen to be far outside the observed spread
// (the shed tests were losing to a ~5s cliff, not to a hang), while still
// failing a genuinely hung child in well under a minute.
//
// `hookTimeout` matches: `beforeAll`/`beforeEach` in these files build git
// repos and tmux sessions, so it is the same wager under the same load, and
// leaving it at its 10s default would just move the flake into setup.
//
// `maxWorkers` is capped for the OTHER half of the same problem, and it is not
// a tidiness knob. (`poolOptions.forks.maxForks` is the vitest 3 spelling of
// this and no longer type-checks under the vitest 4 this repo pins —
// `typecheck-tests.test.ts` catches that, which is how this comment knows.)
// Vitest defaults to one worker per core minus one (15 here), and
// every one of those forks spawns `bash`/`git`/`tmux` children — on a box that
// is already running the live fleet at a load average near its core count. The
// suite's own width is therefore a measurable share of the contention it then
// loses races to. Capping it costs wall time (the run is ~700s of test time
// folded into ~200s) and buys a far flatter peak, which is the thing the
// deadlines are actually racing.
//
// It matters more than the timeouts above, because `vi.waitFor` — 85 call
// sites in this suite — has its OWN 1000ms default that NO config option can
// raise (27 sites already pass `{ timeout: 3000 }` by hand, which is the same
// lesson learned one site at a time). A `testTimeout` of 20s does nothing for
// those: under a load spike a sweep that has not started within one second
// fails the assertion, not the test clock. Less self-inflicted load is the
// only lever this file has over them.
//
// If a future run still sheds a test, look at what it was waiting FOR before
// raising anything: at these numbers a shed test is evidence of a real hang.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    maxWorkers: 6,
  },
});
