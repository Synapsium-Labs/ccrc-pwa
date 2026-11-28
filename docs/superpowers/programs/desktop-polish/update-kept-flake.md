# Wave 196: the slow C27 rollback case of `ccrc-update-kept`, split into one case per arm (run 4165, #3528)

The task note for desktop polish wave 196, written by its worker for the coordinator to fold into the ledger. One test
file changes, `server/test/ccrc-update-kept.test.ts`. No product code, helper, route, wire field or migration moves.
The split was the first round. One bound, for one case, was the fix round, on the coordinator's ruling after review 4176.

## Why

A merge-queue group that is not docs-only runs the whole server suite. One case of this file timed out at its 20000 ms
bound in server shard 7 of 12, again and again, on branches that change no server file. Issue #3528 holds six
sightings: four dispatched full runs (45938472233, 45948661098, 45991360089, 46065441484) and two queue runs in a row
(46081863317 and 46085775537), which removed a reviewed pull request (#3427) from the queue. The case was "ccrc
rollback: by flip when the version is kept (W6 Task 4) > the refusal is only for a DISAGREEMENT, and only for a bare
rollback: an agreeing layout proceeds … (C27)". It made seven runs of the rollback verb plus one real full first move
(the `onKeptV1` helper's update), in a row, against six freshly built fixture boxes. Nothing was wrong with the verb:
the case was too long for one bound.

## What changed

**The split (round 1).** The one case is now six cases, under the same describe, in the same place, in the original
order. Each title starts "the refusal is only for a DISAGREEMENT, and only for a bare rollback:", names its arm and
ends "(C27)", so a search for the old label finds all six.

| # | Arm | Runs of the verb | Assertions |
|---|---|---|---|
| A | an agreeing layout proceeds (the control: stamp v1.0.0 agrees with the pointed-at v1.0.0) | 1 | 3 |
| B | `--to` names its own target: the disagreeing box, told its target, never consults the check | 1 | 2 |
| C | an `untagged-<sha12>` name is compared with the stamp's sha12: agreeing is not a disagreement, disagreeing is refused | 2 (one box) | 3 |
| D | an unreadable stamp is no verdict | 1 | 1 |
| E | the first rollback after a FULL first move onto W6, whose previous names the pre-migration tag, still proceeds | 1, after one real full update | 3 + 3 inside `onKeptV1` |
| F | an unversioned (real-directory) layout keeps wave 4's behaviour, previous trusted | 1 | 2 |

Every assertion of the original is present exactly once, with its matcher and its message, in the arm it belonged to.
None is weakened, dropped or moved across a run it depends on. The untagged name's two runs share one box, so they stay
one case. `let r` became `const r` in the five arms with one run. One comment above the six says why they are split.
The original's comments stay with their arms. The untagged arm's comment now says what that arm runs; it used to name
an `unstamped-*` name, which nothing tests, and the unreadable stamp, which is now its own case. No retry is added.

**One bound, for one case (fix round 1).** Arm E takes `scaled(60_000)`, written as its siblings write it, with a
two-line comment above it. The other five arms keep the file's default bound.

- **Why arm E.** It is nearly the whole old case: 7921 ms in the full run's shard 7 on this head, against 7728, 8023
  and 9562 ms for the whole old case on other green hosted runs. The other five arms were under 300 ms each there.
- **Why the bound, not the split, cures it.** The old case ran 20872, 21006, 22140, 21083, 23770 and 21026 ms on the
  six red runs, and 18713 ms on one green run (job 140768967404), so the slowdown hits whatever is running at the
  moment. Review 4176 applied the slowdown ratios it read (the whole file's, the nearest sibling's, the old case's own)
  to arm E's 7921 ms and got 12.3 to 24.4 s. At every ratio the arm lands above half the default bound. At the old
  case's own ratio it lands at or past the bound. Round 1's projection, 15.6 s, was a floor: 20872 ms is where the old
  case was killed, not where it would have finished.
- **Why 60 s is the siblings' bound, not a stretch.** The file has eight other callers of `onKeptV1`, and every one
  carries a scaled bound: six end `}, scaled(60_000));`, two end `}, scaled(120_000));`. Arm E was the only caller left
  on the default 20 s. That outlier is the root cause the issue never named. The split isolates the arm, and the bound
  cures it.
- **No red first.** No mutant makes a quiet runner slow, so a timeout has no red-then-green proof. The evidence is the
  hosted figures above, the siblings' bound, and the times below: arm E's time on this box, and the other five arms
  staying under the default bound.

## Characterization

Counted with a temporary `expect.getState().assertionCalls` print that was not committed.

| | Result | Assertions |
|---|---|---|
| Original case, on main's code (`f542bd9c8c`) | passed | 17 (14 in its body, 3 in `onKeptV1`) |
| The six new cases, on this branch | 6 passed | 3 + 2 + 3 + 1 + 6 + 2 = 17 |

## Times on this box (the supported runner, local, the whole file alone, five times)

Each round's five runs passed 125 of 125 every time. The box's load moves the file's total a long way, so compare
cases within a round, not file totals across rounds.

| Case | Round 1, slowest (range) | Fix round, slowest (range) |
|---|---|---|
| A agreeing layout | 201 ms (137–201) | 436 ms (159–436) |
| B `--to` | 184 ms (146–184) | 371 ms (149–371) |
| C untagged name | 240 ms (185–240) | 1000 ms (200–1000) |
| D unreadable stamp | 188 ms (144–188) | 398 ms (205–398) |
| E full first move | 3406 ms (3192–3406) | 9606 ms (4454–9606) |
| F real-directory box | 49 ms (46–49) | 129 ms (47–129) |
| File total | 117–123 s | 201–401 s |

The original case on this box, before the split: 4570 ms in a whole-file run (193 s, 120 of 120), and 4903 ms in a run
of that one case alone (the label filter). After the split, in one run of the six cases alone (the label filter), arm E
took 3681 ms. On a busier box (the fix round), arm E reached 9606 ms. The other five stayed at or under 1000 ms, a
twentieth of the default bound.

## Mutants, one per arm (round 1)

Each mutant is one edit to a scratch copy of `ccd/ccrc` (a `git archive` of this branch in the session's temp root, with
the original case's file placed beside the split one). The tree's own file was never touched. For each mutant, the
original case and the six new cases ran together, filtered by the shared label. "Original caught at" is the line of
the original case's first failing assertion, as a line of the ORIGINAL file at `f542bd9c8c`, not of this branch. A
mutant passes this test only if the original fails at its own arm's line and the new case of that arm fails by name.

| Arm | Function in `ccd/ccrc` | Edit (before → after) | Original caught at (`f542bd9c8c`) | New cases that fail |
|---|---|---|---|---|
| A | `_rollback_previous_agrees_with_layout` | `[ "$cur" = "$want" ] && return 0` → `… && :` | line 697 (arm A) | A; also C and E |
| B | `cmd_rollback` (the bare-rollback branch) | `if [ -z "$to" ]; then` → `if :; then` | line 703 (arm B) | B only |
| C | `_rollback_previous_agrees_with_layout` | `want="untagged-${BOX_BUILD[0]:0:12}"` → `…:0:11}"` | line 714 (arm C, first run) | C only |
| D | `_rollback_previous_agrees_with_layout` | `[ "$rc" -eq 0 ] \|\| return 0` → `… \|\| set +u` | line 722 (arm D) | D only |
| E | `_inst_version_name` (rule 3, a source tree's `build.json`) | `n="${BOX_BUILD[4]:-…}"` → `n="${BOX_BUILD[9]:-…}"` | line 726, arm E's call of `onKeptV1` (note below) | E only |
| F | `_rollback_previous_agrees_with_layout` | `case "$VER_LAYOUT" in linked\|migrated)` → `linked\|migrated\|directory)` | line 738 (arm F) | F only |

With no mutant, all seven cases passed in the same scratch tree. Review 4176 replayed all six and added three of its
own (the untagged pair's second run, the real-directory arm, an untagged name returning early), each red in its own
arm only.

**Arm E's first failing assertion is in the shared fixture.** Line 726 is only the call. The assertion that fails is
`onKeptV1`'s own, in `server/test/ccrc-updateFixture.ts` ("the first move did not leave ~/ccrc pointing at v1.0.0").
On the rollback check itself, arm E fails only where arm A already fails (mutant A). What only arm E sees is the full
first move it builds: rule 3 of `_inst_version_name` naming the new version's directory from its stamp.

**Arm D, and what it cannot see.** The smallest edit, removing the "no verdict" return (`|| return 0` → `|| :`), is
caught by neither the original nor the split. With the return gone, the verb dies on `BOX_BUILD[0]: unbound variable`
before it reaches the refusal, at exit 1. The arm asserts only that the refusal sentence is absent, and a crash
satisfies that. The `set +u` mutant in the table is the nearest edit the arm does catch: it lets the run go on with an
unparsed stamp, and that run then refuses. No assertion was added: the brief said to report an arm that catches
nothing, never to invent an assertion for it. The coordinator holds it as a follow-up for the file.

## Other suites, each run alone through the supported runner

- `tmpfixtures`, `spawn-group-pin` (its allow-list names this file), `ci-fast-plan` (names this file) and every file
  under `server/test/single-definition/` (49 files, `vocabularies` among them, which names this file): all green.
- `ccrc-containment` (lists this file): 1 failed, 126 passed. The failure is in "(h) the loopback curl front",
  `--url=: expected 7 to be 2`. It fails the same way on a clean copy of main (`f542bd9c8c`), so it belongs to this
  box, not this branch.
- `typecheck-tests`: 4 failed, 8 passed. Its compiler child came back with no output and code -1, killed. A direct
  compile of `test/tsconfig.tests.json` through the runner was killed twice by the test slice's 6 GiB memory cap
  (exit 137, an OOM kill reported by the runner). Unmeasured on this box. The hosted job `typecheck (server)` covers
  it and is green.
- `.github/ci/`: none of its files names this test file. No guard in the tree counts or pins this file's case bounds
  (the one such pin, in `ccrc-install-tree.test.ts`, reads the install family's files only).

## Open

- Arm D asserts only an absence, so a crash passes it (above). The coordinator's follow-up, not this wave.
