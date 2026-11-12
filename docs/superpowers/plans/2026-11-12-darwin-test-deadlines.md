# macOS-only test flakes: a Darwin deadline in the test, never a retry

- **D-8398 (2026-11-12)** — Darwin deadlines in the tests themselves: a deadline a server test sets for itself reads
  one shared platform factor (`platformDeadline`, `platformDeadlineSeconds` and `DARWIN_DEADLINE_FACTOR` in
  `server/test/timeScale.ts`, beside D-8277's time scale), 1 on Linux and every other platform and 3 on darwin, so
  Linux deadlines keep their literals. No case gets `retry`. Applied to the operator-choice FIFO cases and to the
  nested-run deadlines that run-tmp's T5d uses.

## Why

The operator ruled on 2026-11-12 that the macOS-only flakes get Darwin-specific deadlines in the tests themselves,
not `retry: 1`. A retry would turn a timing red into a green that says nothing; a deadline that is longer on the slower
platform keeps one meaning on both. The ruling named four cases: the FIFO EOF case, the operator-choice FIFO case, the
SIGHUP in run-tmp's T5d, and ws-rename.

## The four

| Case | What this change does | Why |
|---|---|---|
| FIFO EOF (`platform-hazards.test.ts`, "BSD: after the deadline fires, does the output FIFO reach EOF? — candidate (b)") | Nothing | Already fixed on `main` by D-8344 (#2689): the probe's `read -t` lost a Darwin FIFO's one-shot EOF, and the case now waits with one select-free reader. The same reader shape in the sign-in pump is D-8345 (#2690), also merged. The red was a lost EOF, not a short deadline. |
| operator-choice FIFO (`ccd-operator-choice.test.ts`, "%s never opens a FIFO transcript", and the two FIFO poll cases beside it) | `BOUNDED`'s 5 s and the 15 s outer spawn, and the two 10 s polls, read `platformDeadline` / `platformDeadlineSeconds` | The measured red (daily run of 2026-11-09) was `BOUNDED`'s silent exit 125 at 485 ms, whose inferred cause D-8343 (#2685) already handles. The 5 s bound is the remaining timing exposure on a slow runner: sourcing ccd under load is what a 142 would measure. |
| T5d (`run-tmp.test.ts`, SIGHUP to the group exits 129) | The nested-run describe's deadlines (case 120 s, watchdog 90 s, first record 60 s, state wait 30 s, the fixture's own 60 s clock and its 30 s `sleep` mode) read `platformDeadline` | T5d and its siblings share these helpers, so they scale together and keep their order. The signal-order race behind the earlier 129 red was fixed by the arm exiting inside its handler (#2272, pinned by T5d2). |
| ws-rename (`ccd-ws-rename.test.ts`) | Nothing | The file sets no deadline of its own: its only clocks are the suite's `testTimeout` and `hookTimeout`, already 90 s on darwin against 20 s on Linux (`vitest.config.ts`). Reading 20 s through the factor would shorten darwin's to 60 s. On macOS the file was green in every log read (48 s and 63 s for 39 cases), and the one red found (30 of 39 cases) was ccd's 10 G disk floor, not a clock. |

## Deviations found

- The factor, 3, is a ruling and not a measurement. It sits between session-hook's 2x Darwin bound and the suite
  clock's 4.5x. The suite clock keeps its own literals: it is the suite's ceiling, not a deadline a test sets.
- The run-tmp change covers every T5 case, not T5d alone, because they share the helpers whose deadlines scale. On
  Linux every number is unchanged.

## Verification

- `server/test/time-scale.test.ts`: three new cases pin the factor (1 off darwin, `DARWIN_DEADLINE_FACTOR` on it,
  composed with `CCRC_TIME_SCALE` and rounded up). They were red before the helper existed.
- On macOS, `run-tmp.test.ts` with `time-scale.test.ts` and `ccd-operator-choice.test.ts` each ran green 5 times in a
  row.
