# W8 Task C8a, working notes (D-7053, D-7062; ARCH-69 (#804), first half)

The per-task note the W8 plan (`2026-10-26-consolidation-w8-journals-spawn-launchd.md`) asks for: Step 0's census on
the tree the task started from, and any departure, each as `D-TBD-<slug>` for the coordinator to number.

## Step 0: re-ground, measured on `origin/main` `fd32f3ecd`

**Gates.** `server/test/census-w8/cadence.ts` is `export {};` under the "never re-exports this module" header (C8-0b);
`server/test/consolidationCensus.ts` names no `census-w8/` module; `.github/ci/testmap.mjs#WALK_FLOOR` already names
`kernel-tail-cadence`; `server/test/single-definition/kernel-tail-cadence.test.ts` does not exist.

**The shipped timers** (`deploy/systemd/*.timer`, 14 files). Each holds exactly one cadence line; every other key it
carries is one the reader ignores.

| File | Cadence line | Other keys |
|---|---|---|
| `ccd-account-health.timer` | `OnUnitActiveSec=15min` | `Description`, `OnBootSec`, `AccuracySec`, `WantedBy` |
| `ccd-cap-scopes.timer` | `OnUnitActiveSec=60s` | `Description`, `OnBootSec`, `AccuracySec`, `WantedBy` |
| `ccd-graph-sweep.timer` | `OnUnitActiveSec=15min` | `Description`, `OnBootSec`, `AccuracySec`, `WantedBy` |
| `ccd-history-sweep.timer` | `OnUnitActiveSec=2min` | `Description`, `OnActiveSec`, `AccuracySec`, `WantedBy` |
| `ccd-pool-sync.timer` | `OnUnitActiveSec=60s` | `Description`, `OnBootSec`, `AccuracySec`, `WantedBy` |
| `ccd-scope-sweep.timer` | `OnUnitActiveSec=60s` | `Description`, `OnActiveSec`, `AccuracySec`, `WantedBy` |
| `ccd-telemetry-keepalive.timer` | `OnUnitActiveSec=15min` | `Description`, `OnActiveSec`, `AccuracySec`, `WantedBy` |
| `ccd-tmp-sweep.timer` | `OnUnitActiveSec=1h` | `Description`, `OnActiveSec`, `AccuracySec`, `WantedBy` |
| `ccd-update-sync.timer` | `OnUnitActiveSec=60s` | `Description`, `OnBootSec`, `AccuracySec`, `WantedBy` |
| `ccd-usage-sweep.timer` | `OnUnitActiveSec=4h` | `Description`, `OnActiveSec`, `AccuracySec`, `WantedBy` |
| `ccrc-codex-usage@.timer` | `OnUnitActiveSec=15min` | `Description`, `OnActiveSec`, `AccuracySec`, `WantedBy` |
| `ccrc-ddns.timer` | `OnCalendar=*:0/5` | `Description`, `Persistent`, `WantedBy` |
| `ccrc-models.timer` | `OnUnitActiveSec=60min` | `Description`, `OnBootSec`, `AccuracySec`, `WantedBy` |
| `ccrc-update-watchdog.timer` | `OnUnitActiveSec=60s` | `Description`, `OnBootSec`, `AccuracySec`, `WantedBy` |

Comment lines and section headers aside, the keys are `Description`, `OnBootSec`, `OnActiveSec`, `AccuracySec`,
`Persistent` and `WantedBy`; the ignore list covers all six. One comment (`ccd-usage-sweep.timer`) spells
`OnUnitActiveSec=30min` mid-sentence: not a line that starts with the key, so not a cadence line. Distinct spellings:
`60s`, `2min`, `15min`, `60min`, `1h`, `4h` and `*:0/5`.

**The launchd jobs.** Three plist writers: the platform layer's session plist (both files, a service: `KeepAlive`),
`ccrc#_inst_plist_server` (a service: `KeepAlive`) and `ccrc#_exp_ddns_units`' Darwin arm, the only one with a
cadence key (`<key>StartInterval</key><integer>300</integer>`). `ccd/ccd` carries no `StartInterval` or
`StartCalendarInterval`. No `_timer_*` function exists in `ccd/ccrc` or `ccd/ccd`. The platform layer's END sentinel
is `# ── END PLATFORM LAYER` in both files.

**Rule 6** (open PRs holding a file this task edits): `ccd/ccrc` is held by #1578 and #1611; no open PR holds
`server/test/ccrc-expose.test.ts`, `census-w8/` or a `kernel-tail-*` file. #1611's hunks sit in `CCRC_INST_SPINE`,
`_inst_step`, `cmd_install`, `_inst_caps`, `cmd_update`, `_ver_flip_back` and `_uninst_units`; #1578's in a heredoc
more than a thousand lines below the END sentinel, `cmd_wrappers`, `_acct_candidates`, `_codex_tier_ok`, `_inst_bins`,
`_upd_*`, `_upd_sweep` and `_uninst_tree_bins`. C8a's hunks are the block after the END sentinel and
`_exp_ddns_units`: line-disjoint from both. #1404 and #1597 have merged.

**Census helpers.** `census-w8/cadence.ts` imports `REPO`, `bashCodeOf`, `CCD_FUNCTION_DEF`, `ccdLauncherIn` and the
type `CensusSite` from `consolidationCensus.ts`. Its queries read bash and `.timer` text, not TypeScript, so they read
lines the way the census module's own ccd queries do (`ccdSourceLines`, `bashCodeOf`); `scan/parse.ts` parses
TypeScript only and has nothing to read here.

**Growth.** The growth check is armed (`GROWTH_ARMED = true`, limit 40 net code lines) and lists `ccd/ccrc`.

## Departures

- **D-7090.** The plan reads `OnCalendar=*:0/<n>` as "every `<n>` minutes". That holds
  only when `<n>` divides 60: `*:0/<n>` fires at `:00` and every `<n>` minutes after it within the hour, so `*:0/7`
  fires at `:49`, `:56`, then `:00`, and has two gaps. `_timer_period_s` therefore reads `*:0/<n>` only for a step
  that divides the hour (`*:0/5` is 300, `*:0/15` is 900) and refuses any other step, as it refuses every spelling it
  cannot turn into one number. It also refuses a zero period and a leading zero (`0s`, `015min`, `*:0/0`): the regex
  takes `[1-9]` first, which also keeps bash arithmetic from reading `015` as octal. `timer-period.test.ts` pins each.

## Notes on the steps (no departure)

- **Census before the failure arm.** The census module and its tests land right after the reader (Step 3), so their
  real-tree rows record the base counts (1 launchd cadence literal, 3 ddns transcript cadences) and each move commit
  updates its own row: the heredoc commit 1 -> 0, the transcript commit 3 -> 1. The ratchet file is the last commit.
- **"Byte for byte", normalised.** The characterization rows compare the whole plist and the whole stdout after
  replacing three fixture-varying tokens with placeholders: the sandbox HOME, the uid (`gui/<uid>`) and the
  generator's pid (`.tmp.<pid>.new`). `ss` is stubbed to answer no listener, so the `:443` sentence is the fixture's
  and not the runner's. A pty merges stdout and stderr, so the transcript is both streams in order.
- **"Unreadable".** The failure-arm rows exercise an absent `ccrc-ddns.timer` and one with its `OnCalendar=` line
  removed (no cadence line), each with `plutil` on `PATH` (a recorder) and off it (every `PATH` directory holding one
  replaced by a farm of links to its other entries). Not `chmod 000`: a root runner reads that file anyway.
- **One more row than the plan lists.** `ccrc-expose.test.ts` also holds a 90-second fixture timer, whose job writes
  `StartInterval` 90 and whose two Darwin sentences say "90-second tick" and "every 90 seconds": the red that proves
  the two sentences read `$period` (Step 5's second commit), beside `_timer_period_words`' own rows.
- **Growth.** `ccd/ccrc` grows by 33 net code lines (12214 -> 12247 against `fd32f3ecd`), under the check's limit of
  40; no waiver file.
