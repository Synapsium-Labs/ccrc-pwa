# Program: workspace-lifecycle

Spec: `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`
Plans: `docs/superpowers/plans/2026-09-2?-workspace-lifecycle-wave<N>-*.md` — each written once the waves it depends on
have landed what it reads
Home project: `ccrc-pwa`   Coordinator: assigned at the first run-open   Workspace: **a fresh one per wave**
Companion programme: `docs/superpowers/programs/child-reclamation.md` (CCR-15) — waves 2–4 here build on its waves 3–4

**What this program is.** Released workers littered the fleet board: 29 of 56 registry rows on 2026-09-24 were
workspaces a programme had finished with, loose at the top of their cards under generated names, and the operator
archived them by hand. This programme folds them into a `Released (N)` section per card, makes Stop and Archive one
feature, cleans an archived workspace up losslessly 7 days after its archive, and ends the programme of a coordinator
that crashed and stayed dead for an hour. The operator's rulings are the spec's §2 (L1–L6); both consequences in its
§11 were confirmed on 2026-09-26.

## Waves

| # | spec stage | scope | deploy class | depends on | PRs | state |
|---|---|---|---|---|---|---|
| 1 | 1 | `FleetSession.releasedFrom`; the `Released (N)` fold grouped by programme; "Archive all" (plain archives, children skipped); `deploy/measure-workspace-lifecycle.py` | server + pwa | — | — | planned |
| 2 | 2 | one "Archive"; the busy confirm; the coordinator ask (end programme or cancel); the Archived fold takes stopped main checkouts; "Restore" | server + pwa | wave 1; child-reclamation wave 3 merged | — | to plan |
| 3 | 3 | `ws-expire`: archived workspaces cleaned 7 days after archive, losslessly; `reclaim-paused` becomes the one cleanup switch | **AGENT-FIRST** | child-reclamation waves 3–4 merged and deployed; the archive→return delay measured | — | to plan |
| 4 | 4 | the dead-coordinator lane: crash-only, 1 hour, no successor, circuit breaker | server | waves 2–3; child-reclamation waves 3–4 | — | to plan |

## Decisions & deviations

- **2026-09-24 — the rulings.** L1–L6 in dialogue (spec §2); rev 2 of the spec applies a four-lens review.
- **2026-09-26 — the spec approved, both §11 consequences confirmed.** Archiving a coordinator with open runs offers
  "End programme and archive" or "Cancel" only (mail to an archived session parks, D-1066; pausing is the coordinator
  pause switch). Every workspace archive, a "stop for now" included, starts the 7-day clock; main checkouts are never
  deleted.
- **2026-09-26 — wave 1 planned, measured and reviewed.** The plan's edits were prototyped and measured red-first and
  green task by task; its blocks are generated from the prototype and replay onto a clean base byte for byte. Three
  independent reviewers (spec fidelity, correctness and tests, executability and merges) found no blocker; every
  finding was applied, and the mutation table grew to 72 rows, 71 red and one (a double-tap guard jsdom cannot
  reach) recorded as unpinnable. The spec's §5.1 and §9 were corrected the same day to say what the plan builds
  (`lastRunBySession(sessionIds)`, the `ChildMark` words, the instrument on the server box alone). The operator
  approved the plan on 2026-09-28.
- **Execution: coordinator dispatch** (the operator's 2026-09-24 ruling for these programmes). One coordinator per
  programme, created by the operator from its ticket; each wave goes to a fresh worker workspace running
  subagent-driven development, a review run reads the worker's branch, and the coordinator rules and merges. The
  plans reach a worker only from `main`.
- **2026-09-28 (evening) — wave 1 re-verified against `023fe94d`.** Child-reclamation wave 3 (#187) and
  update-management wave 4 (#181) merged. The plan replays unchanged: every Find occurs once, the fixture sweep still
  touches 31 files, and `readme-reanchor.py` now prints `shared/api.ts:7641-7643, :7683, :7691, :7704` (the plan's own
  numbers are stated on a `df4fe069` base). Typechecks clean; PWA 3041; server six shards green apart from the two known
  reds. The fleet box's root disk sat below `ccd`'s 10G `ws-add` floor while measuring, which reds every `ws-add` test
  on the unedited base too: run the suites with `CCD_DISK_FLOOR_GB=1` when that happens. Wave 2 is unblocked.
- **2026-09-30 — wave 1 re-verified against `c88625aa`, then `5b1c58a8`.** On `c88625aa` the plan replays unchanged
  and its server suites are green. On `5b1c58a8` the worker stall watch (#216) had split the two-line `store.ts`
  import block Task 3 inserts into, so that one Find now anchors on the `placement.js` import line alone; the output
  on `c88625aa` is byte-identical. With that, the plan replays onto `5b1c58a8`, `readme-reanchor.py` prints the same
  `shared/api.ts` lines, and the wave's suites are green there: server `released` 20, `released-store` 7,
  `released-wire` 14, `fleet-released` 7, `measure-workspace-lifecycle` 9, the citation cases; PWA `groupFleet` 50,
  `archiveReleased` 7, `project-card` 105, `fleet-screen` 97, `tap-targets` 40, `fleet-css` 77, `contrast` 256, and
  the design audit.
- **Deviation blocks** are minted per wave, at that wave's run-open, by the coordinator. No `D-` number is defined in
  this file.

## Carried constraints

- **CCR-15 wave 3 (#187) and this wave share README's anchor sentence.** Both re-anchor README's four pointers into
  `shared/api.ts`. Whichever lands second takes either side of that one hunk and runs the plan's `readme-reanchor.py`
  (measured: the citation cases and this wave's server files green on the merged tree).
- **`shared/api.ts` is a cited file**, and waves 1 and 2 both insert into it; each pays S6-R11 in its own commit.
- **Stage 3 changes a human-only contract.** `ws-reap` stays human-only; `ws-expire` is a sibling verb with its own
  vocabulary and is never named in the skills (spec §5.3).
- **Landing-order** keys landing entries to runs, and stage 4 can fail a run with `causedBy:'sweep'`; that programme's
  stage 5 must treat it as an operator abandon (spec §6).
- **SAFETY.** Never a destructive `ccd` verb against the live host; never touch tmux, `~/.cc-sessions`, `~/.cc-limits`
  or `claude-session@*.service` directly; fixture HOMEs only in tests; `gh` stays off the exec whitelist; never print
  secret contents.

## Next-wave brief

Wave 1 is planned; once the docs PR carrying the spec, this ledger and the plan has merged, dispatch it on a fresh
workspace with the plan path and this file. After it deploys, run the instrument on the server box from the
installed tree — `python3 deploy/measure-workspace-lifecycle.py` — and record `released_top_level` (target 0,
baseline 29 of 56 on 2026-09-24), `released_wire_only` (target 0) and the archive→return rows here: the last is what
wave 3 waits on. Wave 2 is to plan: CCR-15 wave 3 merged on 2026-09-28 (#187).
