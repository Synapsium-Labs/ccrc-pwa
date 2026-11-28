# Wave 196: the slow C27 rollback case of `ccrc-update-kept`, split into one case per arm (run 4165, #3528)

The task note for desktop polish wave 196, written by its worker for the coordinator to fold into the ledger. One test
file changes, `server/test/ccrc-update-kept.test.ts`. No product code, helper, route, wire field or migration moves.

## Why

A merge-queue group that is not docs-only runs the whole server suite. One case of this file timed out at its 20000 ms
bound in server shard 7 of 12, again and again, on branches that change no server file: issue #3528 holds five hosted
full-run sightings, and two queue runs in a row (46081863317 and 46085775537) removed a reviewed pull request (#3427)
from the queue for it. The case was "ccrc rollback: by flip when the version is kept (W6 Task 4) > the refusal is only
for a DISAGREEMENT, and only for a bare rollback: an agreeing layout proceeds … (C27)". It ran about seven real child
processes of the rollback verb in a row, against six freshly built fixture boxes. Issue #3528 measured it at 20872 ms on
a slow runner. Nothing was wrong with the verb: the case was too long for one bound.

## What changed

The one case is now six cases, under the same describe, in the same place, in the original order. Each title starts
"the refusal is only for a DISAGREEMENT, and only for a bare rollback:", names its arm and ends "(C27)", so a search for
the old label finds all six.

| # | Arm | Runs of the verb | Assertions |
|---|---|---|---|
| A | an agreeing layout proceeds (the control: stamp v1.0.0 agrees with the pointed-at v1.0.0) | 1 | 3 |
| B | `--to` names its own target: the disagreeing box, told its target, never consults the check | 1 | 2 |
| C | an `untagged-<sha12>` name is compared with the stamp's sha12: agreeing is not a disagreement, disagreeing is refused | 2 (one box) | 3 |
| D | an unreadable stamp is no verdict | 1 | 1 |
| E | the first rollback after a FULL first move onto W6, whose previous names the pre-migration tag, still proceeds | 1, after one real full update | 3 + 3 inside `onKeptV1` |
| F | an unversioned (real-directory) layout keeps wave 4's behaviour, previous trusted | 1 | 2 |

Every assertion of the original is present exactly once, with its message, in the arm it belonged to; none is
weakened, dropped or moved across a run it depends on. The untagged name's two runs share one box, so they stay one
case. `let r` became `const r` in the five arms with one run. The original's comments stay with their arms, and one
comment above the six says why they are split. No bound is raised and no retry is added: the six cases take the
file's default bound, as the original did.

## Characterization

Counted with a temporary `expect.getState().assertionCalls` print that was not committed.

| | Result | Assertions |
|---|---|---|
| Original case, on main's code (`f542bd9c8c`) | passed | 17 (14 in its body, 3 in `onKeptV1`) |
| The six new cases, on this branch | 6 passed | 3 + 2 + 3 + 1 + 6 + 2 = 17 |

## Times on this box (the supported runner, local)

The whole file alone, five times: 125 of 125 passed each time, the file at 123, 117, 118, 119 and 123 s. On main's code
the file took 193 s once (120 of 120), the box busier then.

| Case | Slowest of five | Range |
|---|---|---|
| A agreeing layout | 201 ms | 137–201 ms |
| B `--to` | 184 ms | 146–184 ms |
| C untagged name | 240 ms | 185–240 ms |
| D unreadable stamp | 188 ms | 144–188 ms |
| E full first move | 3406 ms | 3192–3406 ms |
| F real-directory box | 49 ms | 46–49 ms |
| The original case, same box | 4570 ms in the whole file; 4903 ms and 4845 ms alone | |

No arm reaches half the bound (10 s) here, so ruling 2's report did not apply.

**The ratio, said plainly.** Arm E is about three quarters of the original: 3406 of 4570 ms (75 %), and 3681 of 4903 ms
(75 %) alone. Its cost is the real full update `onKeptV1` makes before the rollback (migration, placement and spine,
all this tree's code). If the slow runner keeps that share, arm E lands near 15.6 s there (0.75 × 20.9 s), about 78 % of
its 20 s bound. The other five arms together are about 0.7 s here, roughly 3 s on that runner. So the split takes the
other five arms out of reach, but arm E keeps about three quarters of the old case's time. Its margin on the slowest hosted runner is about 4 s, not
the 15 s or more the rest get.

## Mutants, one per arm

Each mutant is one edit to a scratch copy of `ccd/ccrc` (a `git archive` of this branch in the session's temp root, with
the original case's file placed beside the split one). The tree's own file was never touched. For each mutant, the
original case and the six new cases ran together, filtered by the shared label. "Caught at" is the line of the first
failing assertion. A mutant passes this test only if the original fails at its own arm's line and the new case of that
arm fails by name.

| Arm | Function in `ccd/ccrc` | Edit (before → after) | Original caught at | New cases that fail |
|---|---|---|---|---|
| A | `_rollback_previous_agrees_with_layout` | `[ "$cur" = "$want" ] && return 0` → `[ "$cur" = "$want" ] && :` | line 697 (arm A) | A; also C and E |
| B | `cmd_rollback` (the bare-rollback branch) | `if [ -z "$to" ]; then` → `if :; then` | line 703 (arm B) | B only |
| C | `_rollback_previous_agrees_with_layout` | `want="untagged-${BOX_BUILD[0]:0:12}"` → `…:0:11}"` | line 714 (arm C, first run) | C only |
| D | `_rollback_previous_agrees_with_layout` | `[ "$rc" -eq 0 ] \|\| return 0` → `[ "$rc" -eq 0 ] \|\| set +u` | line 722 (arm D) | D only |
| E | `_inst_version_name` (rule 3, a source tree's `build.json`) | `n="${BOX_BUILD[4]:-untagged-…}"` → `n="${BOX_BUILD[9]:-untagged-…}"` | line 726 (arm E, inside `onKeptV1`: "the first move did not leave ~/ccrc pointing at v1.0.0") | E only |
| F | `_rollback_previous_agrees_with_layout` | `case "$VER_LAYOUT" in linked\|migrated)` → `linked\|migrated\|directory)` | line 738 (arm F) | F only |

With no mutant, all seven cases passed in the same scratch tree.

**Arm D, and what it cannot see.** The smallest edit, removing the "no verdict" return (`|| return 0` → `|| :`), is
caught by neither the original nor the split. With the return gone, the verb dies on `BOX_BUILD[0]: unbound variable`
before it reaches the refusal, at exit 1. The arm asserts only that the refusal sentence is absent, and a crash
satisfies that. The `set +u` mutant in the table is the nearest edit the arm does catch: it lets the run go on with an
unparsed stamp, and that run then refuses. No assertion was added (ruling 4). An exit-code assertion in arm D would
close the gap and is the coordinator's to rule on.

**Arm E's distinct catch is in the update, not the check.** On the rollback check itself, arm E fails only where arm A
already fails (mutant A). What only arm E sees is the full first move it builds: rule 3 of `_inst_version_name` naming
the new version's directory from its stamp. A helper assertion inside the arm checks that move.

## Other suites, each run alone through the supported runner

- `tmpfixtures`, `spawn-group-pin` (its allow-list names this file), `ci-fast-plan` (names this file) and every file
  under `server/test/single-definition/` (49 files, `vocabularies` among them, which names this file): all green.
- `ccrc-containment` (lists this file): 1 failed, 126 passed. The failure is in "(h) the loopback curl front",
  `--url=: expected 7 to be 2`. It fails the same way on a clean copy of main (`f542bd9c8c`), so it belongs to this
  box, not this branch.
- `typecheck-tests`: 4 failed, 8 passed. Its compiler child came back with no output and code -1, killed. A direct
  compile of `test/tsconfig.tests.json` through the runner was killed twice by the test slice's 6 GiB memory cap
  (exit 137, an OOM kill reported by the runner). Unmeasured on this box; the PR's fast run, which runs every
  typecheck, is the arbiter.
- `.github/ci/`: none of its files names this test file.

## Open

- Arm E's margin on the slowest hosted runner (about 4 s, above).
- Arm D asserts only an absence, so a crash passes it (above).
