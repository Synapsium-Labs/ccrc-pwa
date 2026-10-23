# Centralised update management, wave 32: the trickle host's count is read after its stdout closes: Implementation Plan

On 2026-10-23 the row "SHA256SUMS from a release host that trickles above the stall floor forever is ended by its
total bound alone, named in the sentence (F4, review 167; F4b, review 173)" in `server/test/ccrc-update.test.ts`
failed on CI with `sent 0 bytes in about 2075ms: expected 0 to be greater than 1500`. It failed three times in a row on
PR #1228, a text-only pull request that cannot reach it, and once in another pull request's merge group. It passes
locally on `main`. Every assertion before the rate one passed, so the real `curl` did run its 2 s against the host.
The coordinator cut wave 32 as run 892. No deviation numbers are issued; the wave found no departure.

**The reading.** `startHost`'s `stop()` sent SIGTERM, awaited the child's `exit` event, and only then parsed `out`
for `sent N`. The host prints that line in its SIGTERM handler and exits. Node's `child_process` documentation says of
`'exit'`: "When the 'exit' event is triggered, child process stdio streams might still be open." So the last stdout
chunk can arrive after `exit`, `out` then holds only the port line, and `stop()` returns 0. `'close'` fires after the
process has ended and all its stdio streams have closed, so reading `out` there cannot miss the line.

**What this wave does.** `stop()` awaits `close` instead of `exit`, with a one-line comment citing the sentence. It
changes nothing else in the file and no source file.

## Not in this wave

- **The host's script, the row's assertions and every other row.** The row's rate floor (1500 B/s against a held
  2560 B/s) is unchanged.
- **Other users of `child.once('exit')` in the file.** None was seen red; if the worker finds one that loses output the
  same way, it reports it in the wave-done rather than widening this wave.

## Global Constraints

- Edit only the `stop()` block of `startHost` in `server/test/ccrc-update.test.ts` (and its comment). Wave 24 (run 855)
  holds that file under claim 2359; its worker consented to exactly this edit (mails 8831 and 8832) and the
  coordinator forwarded the answer whole (8837, 8840). This wave holds no claim of its own on the file.
- Fixture HOMEs only. Mutation runs on a scratch copy only.

## Review Focus

- That `close`, not `exit`, is awaited, and that the guard on `child.exitCode`/`signalCode` still skips a child that
  was already reaped (the row's `finally` calls `stop()` a second time).
- That the diff is the one block and its comment.

## Mutation table

| Mutant | Expected | Measured |
|---|---|---|
| `stop()` awaits `exit` again | Green locally (the race does not lose on this box); the PR's CI is its test | Green 5 of 5 |

## Deviations found

None. No `D-N` issued, no `D-TBD-` written.

## Tasks

1. **Measure the race on a scratch copy.** A host that prints its line in a SIGTERM handler and exits, the parent
   reading `out` once on `exit` and once on `close`.
2. **Edit `stop()`** to await `close`.
3. **Measure after.** The row alone 10 times; the `fetch + verify` describe 3 times.
4. **Gates and the PR.** From `server/`, one at a time: `ccrc-update.test.ts` by describe, `single-definition`,
   `topology-clean`, `private-names`, `dtbd`, `deviation-refs` and the growth check.

## Brief-facing parts

- **Execution skill:** `superpowers:executing-plans`.
- **Routing:** class sonnet, effort high, subagent sonnet at high, workflow off.
- **Claims:** the plan file only. Wave 24's claim 2359 holds the test file; the edit is beside it under its consent.

## As built

Run 892, on the workspace branch from `main` `eab2deb35`.

- **Edit.** Under run 855's consent (mails 8831 and 8832, forwarded whole as 8837 and 8840) and beside its claim 2359,
  which this wave did not duplicate: `startHost`'s `stop()` awaits `close` instead of `exit`, with a one-line comment
  citing Node's sentence. Two lines of the test file changed, nothing else in it. No source file changed.
- **Measurement 1, before the edit.** A scratch host that prints its line in a SIGTERM handler and exits, the parent
  recording `out` at `exit` and at `close`: 300 runs idle, 300 under six busy loops, and 300 with the parent busy for
  30 ms after the kill. `exit` lost the line 0 times and `close` 0 times. The race could not be made to lose locally,
  so the fix rests on Node's documented order and CI's reds on PR #1228 and the merge group.
- **Mutant** (`close` back to `exit`, on a scratch copy of the file, under `ulimit -u` and `timeout -k`): green 5 of 5,
  as expected. Its test is the pull request's own CI.
- **After the edit.** The row alone 10 of 10 green. The `fetch + verify` describe 3 of 3 green (19 tests each).
- **The whole file, by describe.** 40 top-level describes, 635 passed and 12 skipped (the macOS-only rows) of 647, 0
  failed; the by-describe runs summed to 635 passed, and a JSON run of the whole file gave 635 passed, 12 skipped,
  647 in all.
- **Gates**, from `server/`, one at a time, foreground: `single-definition` 850/850, `topology-clean` 60/60,
  `private-names` 47/47, `dtbd` 1/1, `deviation-refs` 31/31 after `git fetch origin main`, and
  `GROWTH_CHECK=1 growth-check` 45/45. A hand grep of the diff for the repository's forbidden names found none.
