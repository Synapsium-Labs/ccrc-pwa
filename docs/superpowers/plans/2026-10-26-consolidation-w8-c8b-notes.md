# W8 Task C8b, working notes (D-7054, D-7062; ARCH-69 (#804), second half)

The per-task note the W8 plan (`2026-10-26-consolidation-w8-journals-spawn-launchd.md`) asks for: Step 0's census on
the tree the task started from, the mutation table as run, and each departure as `D-TBD-<slug>` for the coordinator
to number.

## Step 0: re-ground, measured on `origin/main` `e664a6e11`

**Gates.** C8a is merged (#1657): `ccd/ccrc#_timer_period_s` and `ccd/ccrc#_timer_period_words` exist outside the
platform layer; `server/test/census-w8/cadence.ts`, `cadence.test.ts` and
`server/test/single-definition/kernel-tail-cadence.test.ts` exist and belong to this chain.

**The sites, by census** (`doctorRestatedCadences()` on the base): 14 rows in 7 checks, exactly the plan's table, plus
the kept OnActiveSec note. The structural arm and the named arm agree line for line.

| Check | Site | Derived from |
|---|---|---|
| `pool-sync` | `pool_sync_grace=$((2 * 60))` | 2 x `ccd-pool-sync.timer` (60s) |
| `pool-sync` | "the timer fires every 60s" | 1 x the same |
| `pool-sync` | "(up to ~60s)" | 1 x the same |
| `pool-sync` | the malformed remedy's "(every 60s)" | 1 x the same |
| `update-sync` | `update_sync_grace=$((2 * 60))` | 2 x `ccd-update-sync.timer` (60s) |
| `update-sync` | "the timer fires every 60s" | 1 x the same |
| `update-sync` | "(up to ~60s)" | 1 x the same |
| `graphify` | `[ "$age" -gt 2700 ]` | 3 x `ccd-graph-sweep.timer` (15min) |
| `models` | `[ "$age" -gt 10800 ]` | 3 x `ccrc-models.timer` (60min) |
| `codex` | `_DR_CODEX_USAGE_STALE_S=2700` | 3 x `ccrc-codex-usage@.timer` (15min) |
| `codex` | `_DR_CODEX_USAGE_STALE_DIRECT_S=3600` | that + `ccgpt-usage.py#BRIDGE_FRESH_S` (900) |
| `scope-sweep` | `stale=${CCRC_SCOPE_SWEEP_STALE_S:-300}` | **not derived**: kept, call-bound (below) |
| `scope-sweep` | "the sweep runs every minute" | 1 x `ccd-scope-sweep.timer` (60s) |
| `server-caps` | `writer="ccd-update-sync (it asks the server's /health every minute)"` | 1 x `ccd-update-sync.timer` |

**Kept** (measured, not derived, held exactly by the ratchet): the codex note "the first poll runs five minutes after
enable" (`ccrc-codex-usage@.timer`'s `OnActiveSec=5min`, a first-run delay the reader does not read), and the
scope-sweep default. **Excluded by name**: server-caps' both-arm writer ("it rewrites the file every minute") and its
no-role SKIP ("... write the file every minute"), the server's own beat (`server/src/laneSchedule.ts#SERVER_CAPS_WRITE_MS`).

**The scope-sweep default is call-bound.** `git log -S'SCOPE_SWEEP_STALE_S'` finds its origin in #299 (the
session-continuity wave 4 plan and its merge): the bound was written as a bare "(300 s)" with the check, and nothing in
that plan, its commit or the check's comments derives it from `ccd-scope-sweep.timer`'s 60 s.
`ccrc-settings-census.test.ts` classes `CCRC_SCOPE_SWEEP_STALE_S` `call-bound`. So it is kept and reported by name,
and its override is unchanged.

**`doctorSourceTimeCalls()` at the base: 0.** The two codex globals were literals, and the head's `CCRC_HERE`
resolution calls no `_dr_`/`_box_`/`_timer_` function.

**The fixture's shipped tree.** `ccrc-doctorFixture.ts#installCcrc` built `<home>/ccrc` (the fixture's
`$BOX_TREE_DIR`) with no `deploy/systemd/`; nor did the graphify suite's own `installCcrc` or the codex suite's
`usageBox` (which builds no tree at all). All three now copy `deploy/systemd/*.timer` there (`shippedTimers.ts`, with a
one-file substitution seam).

**Doctor suites per check.** pool-sync, update-sync: `ccrc-doctor-core`; graphify: `ccrc-doctor-graphify`; models:
`ccrc-doctor-exposure`; codex usage rows and scope-sweep: `ccrc-doctor-codex` (and `scope-sweep.test.ts`'s round
trip, which cuts `_check_scope-sweep` out of the file); server-caps: `ccrc-doctor-codex` and `server-caps.test.ts`; the
install's closing doctor run: `ccrc-install-landing` (D-139). The Step 1 pins live in a new suite,
`doctor-cadence.test.ts`, except graphify's, models' and codex's, which need their suites' own fixtures.

**Tests that source `CHECKS_SRC` without `CCRC_SRC`**, and what each reaches: `ccrc-doctor-core`'s
`_check_update-sync` row (stops in its loaded guard, before any bound); `ccrc-doctor-codex`'s
`_dr_codex_usage_box` row (stops in its guard), its backup-check rows (`_check_snapshot-posture` and its siblings: no
moved site), `_check_history`, `_check_docs-sw` and the fixer listing (no moved site), and the old staleness pin, which
read the two codex globals (replaced in Step 6, below); `ccrc-doctor-exposure`'s `_check_routing` row and
`ccrc-doctor-fleet`'s `_check_fleet` row (no moved site); `ccrc-doctorFixture.ts#tableNames` and
`ccrc-doctor-core`'s table census (declarations only); `scope-sweep.test.ts` (the cut function, a fresh record: the
stale arm, the only one that reads a period, is not reached). The two that reach a check this series touches are
pinned byte for byte in `doctor-cadence.test.ts` and run unchanged at every commit.

**Rule 6** (open PRs holding a file this task edits, measured 2026-10-27): `ccd/ccrc-doctor-checks` is held by #1611
(near the table's head and a new `_check_node` block) and #1578 (`_check_snapshot-posture`, `_check_box-settings`, near
the file's end); `ccrc-doctorFixture.ts` by #1611 (the imports, `installCcrc`'s head, `linkReal`, `stubSystemctl`,
`BT_PY_ARM`, `healthy`, `anyVerdictFor`); `ccrc-doctor-graphify.test.ts` by #1611 (one import, `linkReal`);
`ccrc-doctor-codex.test.ts` by #1578 (its tail). Every hunk here is line-disjoint from theirs: the helpers sit after
`_dr_log_hint`, the moves inside the seven checks, the fixture's lines at `installCcrc`'s tail and after the
`platformFixtures` import, the graphify suite's after the vitest import and at its `installCcrc`'s tail, the codex
suite's rows in its usage-rows describe.

**Growth.** `ccd/ccrc-doctor-checks` is not on the growth check's list. No `ccd/ccrc` or `ccd/ccd` byte changes.

## Step 8: the mutation table, run

| Mutant | Suite | Measured |
|---|---|---|
| `pool_sync_grace` back to `$((2 * 60))` | kernel-tail-cadence | red: "no restated cadence in the doctor" |
| `_dr_cycles_s` multiplies by k - 1 | graphify (Step 1) | red: the **2700 s** PASS row (k - 1 = 2 makes the bound 1800 s, so 2700 s now warns; the 2701 s row still warns) |
| the doctor reads the installed unit for cadence | exposure (Step 1), macOS | red: both models rows (no installed timer on Darwin: unmeasured) |
| a new WARN "the timer fires every 15 min" | kernel-tail-cadence | red: the structural arm (after the widening below) |
| the codex direct bound drops the bridge window | codex (the derived-bound row) | red: "a direct row one missed poll old reads stale" |
| `_DR_CODEX_USAGE_STALE_S=$(_dr_cycles_s …)` at top level | kernel-tail-cadence | red: "nothing runs at source time". The sourced-without-ccrc rows stay **green**: the loaded guard makes a source-time call answer rc 3, silently |
| the loaded guard dropped from `_dr_timer_period_s` | doctor-cadence (Step 2) | red: "BOX_TREE_DIR unset … rc 3 and nothing on stdout" |
| graphify compares before testing `_dr_cycles_s`' rc | graphify (Step 4) | red: the three unreadable rows (after the bash 5.3 fix below) |
| the failure arm falls back to 2700 | graphify (Step 4); kernel-tail-cadence | red: the four Step 4 rows; and the structural arm (a literal assigned to `gfx_bound`) |
| the scope-sweep WARN keeps "every minute" as a literal | kernel-tail-cadence | red: the structural arm's word form |
| a new sentence "the timer fires every five minutes" | kernel-tail-cadence | red: the number-word form |
| `_dr_every_words 60` prints `every 1 minutes` | doctor-cadence (Step 1) | red: the scope-sweep 301 s row, the five server-caps writer rows, and the helper's own row |
| the codex OnActiveSec note removed from the kept set | kernel-tail-cadence | red: "the kept set is held exactly" |

## Departures

- **D-7130.** The plan says `_dr_timer_period_s` "caches it per doctor run". Each check
  runs inside `$( … )` in `cmd_doctor`, and every `$(_dr_cycles_s …)` is a shell of its own, so a cache in a shell
  variable holds only within the shell that asked: later calls in that shell read no file (the counting-stub row: two
  units, five calls, two reads), and what a `$( … )` call caches goes with it. A check reads a unit at most twice per
  run (pool-sync and update-sync: the grace and the period), a file of a few hundred bytes. A cache that crossed checks
  would need a file, which a read-only doctor should not write.
- **D-7131.** The plan names no file for the Step 1 and Step 2 rows. They are in a new suite,
  `server/test/doctor-cadence.test.ts` (pool-sync, update-sync, scope-sweep, server-caps, the helpers, the
  sourced-alone rows), and, where a check needs its suite's own fixture, in `ccrc-doctor-graphify.test.ts`,
  `ccrc-doctor-exposure.test.ts` and `ccrc-doctor-codex.test.ts`. Two new helpers: `fixedClock.ts` (a `date` that
  answers `+%s` from a file, so a boundary row cannot flake on a tick; it removes a symlinked `date` before writing,
  because the fixtures' `stub` writes through one) and `shippedTimers.ts`. The graphify suite's own `installCcrc` is
  edited as the doctor fixture's is, because it builds its own tree.
- **D-7132.** The plan's structural form `every <n>(s|min|h)` does not see its own
  mutation row, "the timer fires every 15 min" (a space). The form takes an optional space and the spelled-out units
  (`sec`/`seconds`, `min`/`mins`/`minutes`, `h`/`hours`); the real tree's rows are unchanged.
- **D-7133.** The codex move commits switch `_dr_codex_usage` to the computed bounds
  but leave the two globals defined, unused, until Step 6, because the old pin row reads them by sourcing the table:
  removing them in the move would red that row a commit before Step 6 replaces it. Step 6 removes both, replaces the
  pin with the derived-bound row, and pins their absence.
- **D-7134.** Beyond the plan's three helpers, the rc 1 WARN and the rc 3 FAIL are said once
  (`_dr_cadence_unread`, `_dr_cadence_unloaded`, and their `_what`/`_fix` halves for the checks that record findings
  before printing), and the codex rows record theirs through `_dr_codex_usage_unmeasured`. A check whose lines carry a
  suffix (graphify's gate state) or that records findings (models, codex) prints its own line from the halves.
- **D-7135.** The empty-operand assertion matched "integer expression expected" only;
  bash 5.3 says "integer expected", so the compare-before-rc mutant passed until the pattern took both (measured in
  Step 8, fixed in its own commit).

## Notes on the steps (no departure)

- **How an unreadable unit reads, per check** (OA-C8c (a), D-7062). pool-sync, update-sync: the never-written arm
  WARNs naming the unit instead of choosing between the not-yet-synced WARN and the never-synced FAIL. graphify: a
  WARN of its own (its remedy is the shipped tree, not the timer), carrying the gate state. models: each OK catalogue
  that needs the bound is unmeasured, one WARN naming the unit, and no PASS names a lane nobody measured. codex: the
  missing-row and row-age verdicts each record a WARN naming the unit. scope-sweep and server-caps (sentence-only):
  the sentence drops its cadence clause and a WARN names the unit; server-caps' every answer returns at least that
  WARN. rc 3 is a FAIL naming the bug in each, in the file's existing "this is a bug in ccrc" shape.
- **The census lands before the failure arms**, as in C8a, so its real-tree row records the base and each move commit
  removes its own row.
