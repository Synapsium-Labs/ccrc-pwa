# Program: session-continuity

Spec: `docs/superpowers/specs/2026-09-23-session-continuity-design.md`
Plans: `docs/superpowers/plans/2026-09-2?-session-continuity-wave<N>-*.md` — each written once the waves it depends on
have measured what it needs (the table's "depends on" column)
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-quiet-river` (assigned by the operator 2026-10-02)   Workspace: **a fresh one per wave**
Ticket: `CCR-18` (Linear; mirrored as GitHub issue #197) — the coordinator is created from it
Companion programme: `docs/superpowers/programs/landing-order.md`

**What this program is.** A restart — limit rescue, auto-home, manual swap, supervisor revival — is today a place
where work is lost: the swap carry skips a session's journals on a return visit, the restarted session is told
nothing specific, a resumed session is rescued again on the limit banner it brought with it, the operator's
`/model` reverts, and Claude Code's pressure reap kills the watchers of idle sessions while real orphans go
uncollected. This programme makes a restart a place where work is handed over. It adds no revival: the swap stays
the one sanctioned restart. The operator's rulings are the spec's §3 (C1–C14); §11 items 1–5 were ruled on
2026-09-23, and item 6, found at plan review, on 2026-09-24.

## Waves

| # | spec stage | scope | deploy class | depends on | PRs | state |
|---|---|---|---|---|---|---|
| 1 | 1 | the carry merges instead of skipping; its slot and byte budget; `(merged +N ~R !D)`; the prerequisite write-model measurement; `deploy/measure-continuity.py` with its carry counter | **AGENT-FIRST** (ccd) | — | #230 | fix round done 2026-10-02; in re-review (run 230) |
| 2 | 4, rules 2–3 (rule 1 shipped in #207) | the dated row the waits read; the rescue wait near a five-hour reset (600 s) with its own grace; the no-room wait; spread, no-bounce, the chain wait; `$REG/<id>.rescuewait`; the stage-4 instrument rows | **AGENT-FIRST** (ccd) | — | — | planned — re-planned 2026-09-30 |
| 3 | 7 | `$REG/<id>.typed`; the operator's own `/model`/`/effort` promoted to the route record before a stop; the alias table and the `familyClassOf` port with its agreement pin | **AGENT-FIRST** (ccd) | — | — | to plan |
| 4 | 6, first part | the reap-class OOM count in the instrument (its baseline week starts at deploy); `ccd-scope-sweep` with its units, verdict record and doctor reader; the limit-banner harness leak | **AGENT-FIRST** (ccd, deploy, doctor) | — | — | to plan |
| 4b | 6, first part | `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` in the spawn environment | **AGENT-FIRST** (ccd) | wave 4 plus its one baseline week | — | to plan |
| 5 | 2 | the spike: native exit handoff under ccd; a paused workflow under a blocked parent; `OOMPolicy=continue` on a scratch pane scope | measurement — needs a scratch account from the operator | wave 1 | — | to plan |
| 6 | 3 | graceful stop; the launch record; the manifest; the composed redrive prompt | **AGENT-FIRST** | waves 1, 5 | — | after wave 5 |
| 7 | 4, the refusal | non-rescue swaps refuse while delegated work is in flight; `--cut-delegated`; its own 409 | **AGENT-FIRST**, then server | wave 6 | — | after wave 6 |
| 8 | 5 | the three skill clauses; review-panel's "resume before re-run"; run signals; `FleetSession.delegations` and its chip | skills, server, pwa | wave 6; landing-order wave 1's clauses | — | after wave 6 |
| 9 | 6, second part | ccd stops a pane's scope when it ends the pane | **AGENT-FIRST** | waves 5, 6 | — | after wave 6 |

Waves 1–4 are independent in function and may be worked in parallel, but each edits `ccd/ccd`, so they land one at
a time: each lands on current `main` by a clean `git merge` (landing-order clause 16's triggers), re-stamps, and
re-measures the citation corpus and the `_reg_get` census on the merged tree before its final gate.

## Decisions & deviations

- **2026-09-23 — the design, its rulings and the written spec.** Approved in the brainstorm (C1–C8); the operator
  ruled every open decision on the written spec the same day (C9–C14). Two adversarial rounds and a numbers and
  consistency pass preceded the rulings; each measurement the spec cites names its instrument.
- **2026-09-23 — stage 4 split at the source.** The spec's §10 said `1 → 2 → 3 → {4, 5}`, but stage 4's rules 1–3
  read only the transcript, the limits files and the swap log. Corrected in the spec before any plan was written,
  so wave 2 ships the rescue policy early and wave 7 carries the refusal that needs stage 3's scan. Not a deviation
  — the spec over-constrained itself and was fixed at the source.
- **Amendment slugs.** Each is minted by the plan that implements it and defined in that plan's
  `## Deviations found` in the same act: `sidecar-carry-merges` (wave 1), `carried-in-banner-is-not-a-block` and
  `rescue-waits-near-reset` (wave 2), `operator-model-survives-restart` (wave 3), `inert-scope-sweep` (wave 4).
- **2026-09-24 — §11 item 6 ruled: leave it and count it.** A stalled session whose own account is the only one with
  room idles as today; no in-place restart is sanctioned. Wave 2's plan gains the count — four `noroom_…` rows in
  `measure-continuity.py --stage 4`, measured red-first and by seven mutations on the plan's prototype — and the
  question returns to the operator with that count in hand.
- **2026-09-24 — execution: coordinator dispatch.** The operator creates one coordinator per programme from its
  ticket. Each wave goes to a fresh worker workspace running subagent-driven development, a review run reads the
  worker's branch, and the coordinator rules and merges; the plans reach a worker only from `main`, so the docs
  PR carrying the specs, the ledgers and the first four plans merges before the first dispatch.
- **2026-09-28 — the plans re-measured against `main` `c62e22b9`.** Nine commits landed after 2026-09-24 (#182–#186,
  #192–#195); three edit `ccd/ccd`. Wave 1 holds: only line hints, README's two anchors and one scan total moved, and
  every count and mutation row reproduced on a copy of `c62e22b9` with its edits applied. **Wave 2 is HELD for a
  re-plan:** #195 (D-3522) made the rescue read a 401 its own process wrote as a block, and the plan as written drops
  that detection (Task 1), rules the 401 `carried-in` on an account rescued onto after a rate limit (Task 2), and lets a
  transcript-only 401 chain-wait (Task 4). The plan's status block names the measured fix; the re-plan is
  prototype-first on current `main`.
- **2026-09-28 (evening) — wave 1 re-measured again; wave 2's Tasks 1–2 superseded.** `main` moved to `023fe94d`
  (child-reclamation wave 3, #187; update-management wave 4, #181). Wave 1 still holds: `_swap_carry_sidecars` is
  byte-identical, 54 lines lower, and only hints, README's anchors and counts moved (restated at `023fe94d`). **Ruled
  by the operator** in the same day's residue batch: stage 4 rule 1 (C12) ships now as its own one-task fix on
  #195's carrier, the pane's process start (`_pane_born`), not on `$REG/<id>.landed`, and a landing whose Claude
  Code never came up (`.spawn` rc 4) is still moved. That fix supersedes wave 2's Tasks 1–2; D-3497 stays rule 1's
  number. Tasks 3–5 are re-planned on its reader once it is on `main`; a draft re-plan against #195 alone is not
  used, and its safety review's two rules carry forward (the plan's status block).
- **2026-09-30 — wave 2 re-planned on the shipped carried-in fix.** Prototype-first on `main` `c88625aa`. The held
  plan's Tasks 3–6 are its Tasks 1–4; Tasks 1–2 are not rebuilt, because #207 shipped rule 1. The waits read the row
  that blocked a session through a new `dated` mode of the transcript reader, cached in `.tdate` beside the carried-in
  fix's own answer, so the 30 s `tscan` cache never hides the reset. Three reviews (rescue-verdict safety at `xhigh`,
  tests and mutations, executability and merges) raised 23 findings: 22 were applied, and one was refused because it
  conflicted with a safer fix, shown by measurement. An independent verification followed; 102 mutation rows, all red.
  The three rules carried from the shelved draft's safety review hold, each pinned: a pane tmux cannot place, or lost
  auth on either surface, takes no wait; a row written at or after its own reset keeps that reset nowhere; and a
  stalled no-room wait moves the moment a target has room. **One default is the planner's, for the operator to
  confirm or reverse** (the plan's open question 4): the hold in place after a reset turned ends `RESCUE_CHAIN_WAIT`
  (30 minutes) past the reset, where the spec held it without end; measured, `main` rescues that input at once. The
  plan's deploy step measures ccrc's own update mechanism and moves nothing by hand (operator ruling 2026-09-30).
  §11 item 6's four `noroom_…` rows ship in its instrument (CCR-20). The spec records rule 1 as shipped and amends
  rules 2–3 to the plan (rev 6). Before the docs PR the plan was replayed onto `main` `5b1c58a8`: every edit applies
  and its suites are green there.
- **2026-10-02 — the coordinator assigned.** The operator made session `ccrc-pwa-quiet-river` — the planning session
  that wrote this programme's plans — the coordinator of landing-order, session-continuity and workspace-lifecycle
  together. Each wave is its own run under that session id; a fresh coordinator resumes only under the same id
  (the coordinator skill's `references/resume.md`).
  **Wave 1 dispatches now; wave 2 waits until wave 1 has landed.** Both edit `ccd/ccd`, and the coordinator does
  not dispatch two of its own workers onto overlapping files (coordinator clause 10) — the ledger's "may be worked
  in parallel" stays true of the plans, which merge either way, but this coordinator serialises them; it also
  keeps one fewer suite-running worker on the memory-bound fleet box.
- **2026-10-02 — wave 1 dispatched as run 219** to a fresh workspace (`ccrc-pwa-swift-ridge`, branch `ws/swift-ridge`),
  executing by subagent-driven development on the matrix's "worker executing a spec'd plan" row (Opus · high,
  Sonnet · high implementers, an Opus · high reviewer per task, workflow off, compact 40). Its deviation
  numbers, issued at run-open and written bare here until a plan on the same ref defines them: 3768 through 3777.
  The brief adds two rules that post-date the plan: the wave stops at the PR (the coordinator merges; the
  fleet moves by ccrc's own update mechanism, operator ruling 2026-09-30), and main is measured fresh.
- **2026-10-02 — Task 1's STOP row ruled a false positive (run 219).** The write-model probe printed one
  `journal: born at its last write (STOP)` row out of 151 finished-here runs. That row was the window's only killed
  run (13 s). Its journal has two rows, written on one inode, and was born 67 ms before its last write. A
  temp-and-rename journal is born at its last write, and a two-row journal cannot pass the probe's three-line
  criterion whatever the write model. Everything that can decide the question agrees with the plan:
  - the other 150 journals are append-in-place;
  - that run's agent log grew on one inode;
  - the live sample grew on one inode;
  - linkmode shows no crossover.

  Ruled: the plan's verdict stands and Task 2 proceeds. The worker records this as a departure from its own block.
  The probe's criterion is not changed in this wave.
- **2026-10-02 — wave 1 done, in review.** Run 219's wave-done (PR #230, tip `48c9156e`) passed the server's
  re-measurement. The run is at `awaiting-review` and its four items are settled.
  - The worker merged main `cf9e4cc8` (#222). The only conflict was `ccd/ccd`'s stamp, which it re-stamped. The
    citation census after the merge reads stated=base=tree, with nothing entering or leaving.
  - Departures: the worker used 3768 through 3771 from its block, each defined in the plan on the branch. 3772
    through 3777 went unused.
  - Task 1's baseline reproduced spec §1.2 exactly.
  - Task 4 Steps 6–7 (rollout and the week-after measurement) were skipped by standing rule. They are owed after
    the merge, through ccrc's own update mechanism.
  - **Signals:** `suite: red`, `failure: unclear`. The reds are boot.test's timing ceiling at load 64 (this wave
    changes no `server/src`), the known tmp-sweep red, two cases that pass when run alone, and PWA timeouts.
    **Routing is not escalated:** the red measures the box.
  - **Review:** review run 227 went to `ccrc-pwa-keen-prairie` on Opus · high with workflows on. It runs the held-out
    panel, plus the plan's own merge-safety lens on Opus · xhigh, because this wave replaces files inside live
    account roots.
- **2026-10-02 — review 227 ruled: one fix round.**
  - **The panel.** Four lenses, the plan's merge-safety lens on Opus · xhigh included, with 52 agents, none
    unverified and nothing unexamined: 14 confirmed and 2 refuted. Ten plan mutation rows re-ran red as stated. The
    citation census is stated=base=tree, and the spec §1.2 baseline reproduced read-only. CI's required checks are
    green.
  - **Two important findings.** Two guards that are correct but pinned by nothing:
    - the same-size, older-record arm of "replace only when strictly newer" (the wave's one irreversible act);
    - "slot taken once".

    Each stayed green under its mutation.
  - **Twelve minor findings:**
    - stale mutation counts;
    - two `(kept: error)` causes without a test;
    - the `!D` row's longer-copy choice;
    - two unpinned dry-pass prices;
    - "nothing waits" pinned only by a hang;
    - two comments that overstate (the slot's scope, the drain);
    - an avoidable compare;
    - a `set -u` exit through `mapfile`;
    - the UTF-8 reconfigure line;
    - the instrument's two TZ conversions.

  **Ruled: everything is fixed in this wave except F10.** The repo's rule is that a guard ships with a test that
  reds, and this wave replaces files inside live account roots. Its six departures take the block's unused 3772
  through 3777, one per group. F10 (a same-size record that is not newer is still compared) is carried forward,
  because deciding it in the dry pass would move F1's effective guard.
- **2026-10-02 — wave 1's fix round done, in re-review.** The fresh wave-done (tip `322298e5`) passed the server's
  re-measurement.
  - **Fixes:** seven commits, numbered 3772 through 3777, which uses up the block.
    - Eighteen new mutation rows (46–63), each green before its case and red after.
    - F11's `set -u` exit is closed in shipped code.
    - The stale counts are restated on the final files.
  - **F10:** untouched, as ruled.
  - **Named costs the departures record:**
    - the python3 and `mapfile` pins work by shadowing, not by a real missing binary;
    - under the blocking-flock mutation, measure-continuity's real-carry case still hangs.
  - **Re-review:** review run 230 went to `ccrc-pwa-amber-basin`. It runs the held-out panel plus the merge-safety lens
    on Opus · xhigh, because the round edits the carry block.
- **Deviation blocks** are minted per wave, at that wave's run-open, by the coordinator. No `D-` token appears in
  this file until a plan on the same ref defines it (`deviation-refs.test.ts`).

## Carried constraints

- **Every wave that edits `ccd/ccd`** re-stamps it (`ownership.test.ts`), pays the citation tax for every cited file
  it moves (`session-hook.test.ts` S6-R11), keeps edits above the frozen corpus anchors length-neutral, and
  re-measures `ccd-reg-get-census.test.ts`'s sentence if it adds a `_reg_get` call.
- **Child-reclamation edits the same `ccd/ccd` lines.** Its wave 3 (run 148, dispatched 2026-09-24) rewrites the
  `_reg_get` census sentence wave 2 also rewrites; wave 2's plan locates those lines by content and derives its
  numbers from whatever the base states, so either may land first (re-measured 2026-09-24 against `main` `b501698a`).
- **The instrument grows with the programme.** `deploy/measure-continuity.py` is read-only and run by hand on the
  fleet box; wave 1 creates it with the carry counter, and every later wave adds the rows of spec §9 it owns in the
  same PR as the mechanism they measure.
- **Claude Code's regime changed on 2026-09-15.** Workflow agents pause at a five-hour limit and re-run after the
  reset. Any delegated-work baseline a plan uses is re-cut at 2026-09-16 (spec §1.1).
- **The fleet box is memory-bound.** A pane scope throttles at 8G and dies at 12G with its session
  (`OOMPolicy=stop`), and the session slice sits near its 24G ceiling. Run suites in the foreground, one at a time,
  sharded; never two full server suites at once from one pane.
- **`deploy/measure-continuity.py` has one shape, whichever wave lands first.** One registry `STAGES = {N: stageN}`,
  each `stageN(ctx)` returning named sections; `ctx` carries the home, the swap log, `since`/`until` as epochs
  (swap-log stamps are local time), `all_copies` and `deployed`; the CLI is `--stage N` (repeatable), `--home`,
  `--swap-log`, `--since`, `--until`, `--deployed`, `--all-copies`, `--json`. A wave that finds the file already
  there keeps its header, helpers and parser and adds only its own stage block and registry entry.
- **A later carry wave owes F10 (review 227).** A same-size record whose source is not newer is still queued as a
  tier-0 compare costing twice its size, ahead of every journal, although its outcome is fixed. Decide it from
  `lstat` in the dry pass, and move F1's pin to that decision in the same commit.
- **SAFETY.** Never a destructive `ccd` verb against the live host; never touch tmux, `~/.cc-sessions`,
  `~/.cc-limits` or `claude-session@*.service` directly; fixture HOMEs only in tests; never print secret contents.

## Next-wave brief

Wave 1 is planned, reviewed and re-measured (2026-09-28); once the docs PR has merged, dispatch it on a fresh
workspace with its plan path and this file. Wave 2 is re-planned (2026-09-30) and ready: dispatch it on a fresh workspace with its plan path and this file. Waves 1
and 2 may be worked in parallel but land one at a time; whichever lands second takes the other's
`deploy/measure-continuity.py` through the plan's gated merge block. Once wave 2 is deployed, its `noroom_…` rows are
the count §11 item 6 returns to the operator with (CCR-20).
Wave 1's first task re-measures the write model the planner measured (journals and agent logs appended in place,
records written whole); if it disagrees, the rules change in the plan before any code. Wave 2 changes a verdict every rescue and strand decision runs on;
its safety lens is `xhigh`.
