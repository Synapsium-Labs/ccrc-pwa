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
// `maxWorkers` is scaled down for the OTHER half of the same problem, and it
// is not a tidiness knob. (`poolOptions.forks.maxForks` is the vitest 3
// spelling of this and no longer type-checks under the vitest 4 this repo
// pins — `typecheck-tests.test.ts` catches that, which is how this comment
// knows.)
//
// It is expressed as a PERCENTAGE (`'40%'`), not a fixed count, and that is
// load-bearing, not stylistic. In vitest 4, `resolveMaxWorkers` returns a
// configured `maxWorkers` VERBATIM — it is an absolute value, not a cap —
// and only falls back to `max(availableParallelism() - 1, 1)` when the
// option is unset. A fixed `maxWorkers: 6` therefore LOWERS the worker count
// on this 16-core dev box (default 15) exactly as intended, but RAISES it on
// `ubuntu-latest` (2 or 4 vCPU, default 1 or 3) — on the very CI runner whose
// required-check stability this setting exists to protect. Measured against
// the vitest 4.1.10 this repo pins, by running its own
// `getWorkersCountByPercentage` under `taskset` to simulate each core count:
// a fixed `6` stays `6` regardless of cores (1 CI worker becomes 6, 3 becomes
// 6), while `'40%'` resolves to 6 workers on 16 cores (unchanged from
// before), 2 workers on 4 cores, and 1 worker on 2 cores — it scales down on
// both the dev box and CI instead of raising CI's count. Every one of those
// forks spawns `bash`/`git`/`tmux` children — on a box that is already
// running the live fleet at a load average near its core count. The suite's
// own width is therefore a measurable share of the contention it then loses
// races to. Scaling it down costs wall time (the run is ~700s of test time
// folded into ~200s on the dev box) and buys a far flatter peak, which is the
// thing the deadlines are actually racing.
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
// raising anything — "at these numbers a shed test is evidence of a real
// hang" used to stand here, and it was wrong, because it wasn't true of the
// last one found. The final re-review root-caused the remaining
// `ccd-ws-gc` flake to a fixture bug, not a hang: `orphanWithIgnored` in
// `test/ccd-ws-gc.test.ts` commits identical `.gitignore` bytes with an
// identical message to both a worktree branch and `main`, and DEPENDS on
// both `git commit` calls landing the same SHA so the branch stays an
// ancestor of `origin/HEAD`. Git commit timestamps have 1-second resolution;
// when the two commits straddled a second boundary the SHAs diverged,
// ancestry broke, and `ccd` correctly reported the branch unmerged — a
// correct answer to a fixture that had quietly stopped meaning what its
// comment said. That fixture now pins `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`
// so the two commits are identical by construction rather than by luck.
// Neither `testTimeout` nor `maxWorkers` touches this class of flake at all
// — a shed test is evidence of whatever it was actually waiting for, timing
// race or hang alike, and this file's numbers narrow the search, not settle it.
// DARWIN GETS A LONGER CLOCK, for the same reason the 20s exists at all: the
// budget races process spawning, and macOS is measurably worse at it — fork
// plus exec on the shared 3-4 vCPU GitHub runner is several times Linux's
// cost, and this suite's heaviest tests each spawn hundreds of bash/git/tmux
// children. The first test-macos run shed 37 ccrc-install tests at exactly
// 20s while their siblings passed — the shape of a slow clock, not a hang
// (the job's own setup and 5,400 other tests were green). 90s keeps the
// hung-child ceiling meaningful while clearing the observed spread.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: process.platform === 'darwin' ? 90_000 : 20_000,
    hookTimeout: process.platform === 'darwin' ? 90_000 : 20_000,
    // See the long comment above: a PERCENTAGE, not a fixed count, because a
    // fixed number is an absolute value under vitest 4's `resolveMaxWorkers`
    // (not a cap) and would raise CI's worker count instead of lowering it.
    maxWorkers: '40%',
  },
});
