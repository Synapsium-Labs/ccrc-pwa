# Overlord W2 carries, third batch: notes for the ledger

Wave 265, run 4234, ticket `w2-carries-3-key-rotate-flake`. One tests-only fix, one pull request: a server test case that passed
vitest's default 20 s bound on loaded runners (issue #3646, three sightings, the third in a merge-queue run where it cost a slot).
Main at dispatch: `37648b312f`. No deviation number was allocated; departures are recorded by slug below.

This task adds no dependence on the coding harness: it changes one test file, and the product is untouched.

## What was slow, measured

`server/test/testbox-admin-key-rotate.test.ts`, block "a line is removed by the key it holds, not only by its comment (D-8337)",
case "revoke and disconnect remove ccrc's line in every variant, and the operator's other line stays". It looped two verbs over five
paste variants inside one case: a probe fixture plus ten fixtures, each making a key pair and running the real admin verb.

One iteration, timed step by step on this box (load about 6 on 16 cores), with a temporary instrumented copy that was then reverted:

| Step | key-rotate (sibling case) | key-revoke | disconnect |
|---|---|---|---|
| `fixture()` | 0–1 ms | 0–1 ms | 0 ms |
| `connected()` (a key pair, the box line, a pinned host key) | 42–47 ms | 43–54 ms | 42–45 ms |
| the verb | 136–149 ms | 443–468 ms | 410–427 ms |

So a revoke or disconnect iteration takes about 0.5 s, and the ten took 5 s on this box. CI runners ran the file about 4 times slower
(the issue's run: 27 cases in 54 s, against 14 s here), which puts the ten at the 20 s bound.

**Where the verb's time goes.** A timestamped trace of one `disconnect` put about 367 ms of its ~410 ms in one step: the best-effort
`( cmd_settings --write )` that Disconnect's body runs after the state write (`ccd/ccrc-testbox-admin`, `_tba_disconnect_body`). It
reads and renders every setting; it holds no `sleep`, retry or wait (checked in `cmd_settings`, `_set_libs`, `_set_reads` and
`_set_spec`). It is computation, so the brief's stop condition (time in a sleep, retry or wait) did not apply, and the verb was not
touched. Recorded as `w2c3-settings-write-cost`: a candidate for a product follow-up if the verb's latency ever matters, not for
this task.

## The fix

- The case is now `it.each` over the (verb, variant) pairs: `['key-revoke', 'disconnect']` crossed with `Object.keys(variants('', ''))`.
  The variants stay one definition (`variants`), the names are read from it with empty arguments, and no names are typed out. Each
  case owns one fixture and one bound, and its name ends with its pair, for example `…: disconnect, a CRLF`.
- The probe fixture is gone from this case: it made a key pair only to enumerate the names, which `variants('', '')` now does.
- Every expectation the loop made per pair is made by that pair's case, with the same message (`${sub}: ${name}`), in the same order.

### Count of expectations

Counted at runtime with a temporary `afterEach` printing `expect.getState().assertionCalls` per case (reverted after), on the old
file and the new:

- old: one case, **63** expectations: 10 pairs × 6 (`connected()`: the one-line answer, `ok`, the host key's `ssh-keygen` status;
  then the one-line answer, the verb's `{ ok: true }`, the box's lines) plus the probe fixture's own 3 setup checks in `connected()`.
- new: ten cases × **6** = **60**. The 3 not made any more are the probe fixture's setup checks, of a fixture that no longer exists;
  each case's own `connected()` makes the same three on its own fixture. Recorded as `w2c3-probe-checks-dropped`.

## Before and after

"Under load" is the brief's: the file run beside `test/session-hook.test.ts` and `test/ccd-ws-gc.test.ts` with
`test/ccd-session-state.test.ts`, each at two workers, all through the fleet test wrapper (`ccrc test --local`). The box's own load
moved through the runs, so the load average is given beside each.

| Run | Load avg | File total | Slowest case | The variant case(s) |
|---|---|---|---|---|
| before, alone | 6–7 | 14.1 s | 4990 ms (the loop) | 4990 ms |
| before, under load (1) | 5–6 | 14.7 s | 5234 ms (the loop) | 5234 ms |
| before, under load (2) | 15–17 | 17.0 s | 5741 ms (the loop) | 5741 ms |
| before, under load (3) | 19–22 | 22.0 s | 6599 ms (the loop) | 6599 ms |
| after, alone, 20 runs | 5–8 | median 16.3 s (14.7–20.6) | rotate's, median 1168 ms | each pair median ~0.55 s, worst 1063 ms |
| after, under load, 7 runs | 4–18 | 14.7–49.1 s | 3474 ms (rotate's, in the 49 s run) | worst 2090 ms (`key-revoke, an edited comment`, same run) |

The slowest case after, under load, is 3474 ms, well under half the bound (10 s). The worst single pair is 2090 ms, in a run whose file
total (49 s) is close to the CI run that failed (54 s).

## The sweep of this file

Rule from the brief: split a case that runs more than three fixtures or real child processes under the default bound if it is
within a factor of three of the bound under load (at or above 6.7 s); otherwise leave it and give the figures. Every case here runs
the real verb as child processes. Figures: median of the 20 runs alone, worst of the 20 alone, worst of the 7 under load.

| Case | Fixtures | Alone median | Alone worst | Load worst | Verdict |
|---|---|---|---|---|---|
| rotate removes the old key's line in every variant, and answers ok | 6 | 1168 ms | 2162 ms | 3474 ms | left |
| a ccrc line … that holds ANOTHER key (an orphan) goes too, on rotate and revoke alike | 2 | 758 | 1394 | 3028 | left |
| a key with no box recorded is deleted … | 1 | 849 | 1281 | 2424 | left |
| a revoked key the box still takes … is revoked-unpair-failed | 1 | 556 | 814 | 2203 | left |
| a sudo login's revoke takes ccrc's line out as the login user itself | 1 | 542 | 4932 | 1830 | left |
| revoke takes the pairing apart as Disconnect does … | 1 | 655 | 892 | 1818 | left |
| after a killed rotate, a revoke that cannot reach the box … | 1 | 618 | 846 | 1693 | left |
| refuses with nothing touched: no connection, no key, … a changed host key | 5 | 357 | 911 | 1189 | left |
| every other case (18) | 1–2 | 47–711 | ≤ 937 | ≤ 1596 | left |

- **The rotate case** (five fixtures plus a probe) is about a fifth of the old revoke and disconnect case, since rotate does not run
  the settings write: 3474 ms at worst under load, about half the factor-of-three line. Left as it is, probe included: the brief
  licenses its probe change only with a split.
- **The orphan case** (two verbs): 3028 ms at worst. Left.
- **"refuses with nothing touched"** makes five fixtures but runs refusals that reach no box: 1189 ms at worst. Left.
- The 4932 ms for the sudo revoke case is one sample in run 1 alone (its median is 542 ms, and 1830 ms at worst under load): box noise,
  not a shape.
- **Scaled bound.** This file has no convention of its own for a scaled bound: no case in it passes a timeout. None was added; a raised
  bound would hide the next slowdown, and the split makes it unnecessary.

## Mutation row

The repository's mutation helper drives Python modules only, so the mutant was applied by hand: a temporary edit of
`ccd/ccrc-testbox-admin`, run against the old file and the new, then restored with `git checkout` (tree checked clean). Recorded as
`w2c3-hand-mutant`.

| Mutant | Old file | New file |
|---|---|---|
| Disconnect alone (no `TBA_DX_VERIFY`) keeps a line ending `ccrc-testbox-admin\r`: the drop's awk program gets a leading `/ccrc-testbox-admin\r$/ { print; next }` | red: the loop case, `disconnect: a CRLF: expected [ …(2) ] to deeply equal [ Array(1) ]` (the loop stops there; the later pairs do not run) | red in one case only, `…: disconnect, a CRLF`, same message; 35 of 36 cases green |

The mutant is conditioned on the verb because the drop takes out any line holding the key whatever its comment (`all` mode with the
key passed), so a variant-only change to the awk program would red both verbs' cases for that variant.

## Proof

- The file alone: 20 runs, 20 green (36 of 36 cases each).
- Under load: 7 runs, 7 green (36 of 36), the two load suites green beside each (740 passed and 6 skipped; 121 passed).
- Server source type check (`tsc --noEmit -p tsconfig.json`): clean.
- The changed test file's type check: clean, through a config that extends `test/tsconfig.tests.json` and lists only this file
  (with the server's node types named). The whole test project's check was killed by the test slice's shared 6 GB memory cap
  (exit 137, an OOM kill counted in the slice); recorded as `w2c3-tests-typecheck-oom`. CI's `typecheck-tests` guard covers the whole
  project on the pull request.
- No full run (the brief's rule); the fast run on the exact tip is the check.
