# Program: workspace-lifecycle

Spec: `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`
Plans: `docs/superpowers/plans/2026-09-2?-workspace-lifecycle-wave<N>-*.md` — each written once the waves it depends on
have landed what it reads
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-quiet-river` (assigned by the operator 2026-10-02)   Workspace: **a fresh one per wave**
Ticket: `CCR-17` (Linear; mirrored as GitHub issue #196) — the coordinator is created from it
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
| 1 | 1 | `FleetSession.releasedFrom`; the `Released (N)` fold grouped by programme; "Archive all" (plain archives, children skipped); `deploy/measure-workspace-lifecycle.py` | server + pwa | — | #229 | fix round done 2026-10-02; in re-review (run 229) |
| 2 | 2 | one "Archive"; the busy confirm; the coordinator ask (end programme or cancel); the Archived fold takes stopped main checkouts; "Restore" | server + pwa | wave 1; child-reclamation wave 3 merged | — | planned; approved 2026-10-01 (#223) |
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
  on `c88625aa` is byte-identical. The same PR added a 33rd `child: { kind: 'none' }` fixture (`stall-sweep.test.ts`),
  so Task 1's sweep now touches 32 files, and the plan says so. With that, the plan replays onto `5b1c58a8` in a git
  checkout (the sweep reads `git grep`), `readme-reanchor.py` prints the same `shared/api.ts` lines, both typechecks
  are clean, and the wave's suites are green there: server `released` 20, `released-store` 7, `released-wire` 14,
  `fleet-released` 7, `measure-workspace-lifecycle` 9, `stall-sweep` 42, `single-definition`, the citation cases; PWA
  `groupFleet`, `archiveReleased`, `project-card`, `fleet-screen`, `tap-targets` and `fleet-css` (376), `contrast`
  256, and the design audit.
- **2026-10-01 — wave 2 planned and approved; both plans re-checked on `e0a52953`.** Wave 2's plan (#223) was
  prototyped on `main` `5b1c58a8` with wave 1 applied and reviewed through three lenses; the operator approved it
  by merging #223. The same day the worker stall watch's wave 2 Part B (#224) landed: it grew
  `single-definition.test.ts` with a second describe whose closing lines match the one wave 2's Task 1 inserts after,
  so that Find now carries the line above it (the output on `5b1c58a8` is byte-identical), and it added a second
  `child: { kind: 'none' }` literal to `stall-sweep.test.ts`, so wave 1's sweep is 32 files and 33 lines. With those,
  both plans replay onto `e0a52953` in a git checkout, both typechecks are clean, and wave 2's server (26 files, 1628
  tests) and PWA (14 files, 641) suites are green. Wave 2's Task 12 skips its `CLAUDE.md` edit there, as its Step 3
  says: `main` already re-measured the README claim (`~3800`). The plan's two open questions stay open.
- **2026-10-02 — the coordinator assigned.** The operator made session `ccrc-pwa-quiet-river` — the planning session
  that wrote this programme's plans — the coordinator of landing-order, session-continuity and workspace-lifecycle
  together. Each wave is its own run under that session id; a fresh coordinator resumes only under the same id
  (the coordinator skill's `references/resume.md`). Wave 1 dispatches now; wave 2 after wave 1 merges.
- **2026-10-02 — wave 1 dispatched as run 220** to a fresh workspace (`ccrc-pwa-calm-prairie`, branch `ws/calm-prairie`),
  executing by subagent-driven development on the matrix's "worker executing a spec'd plan" row (Opus · high,
  Sonnet · high implementers, an Opus · high reviewer per task, workflow off, compact 40). Its deviation
  numbers, issued at run-open and written bare here until a plan on the same ref defines them: 3778 through 3787.
  The brief adds two rules that post-date the plan: the wave stops at the PR (the coordinator merges; the
  fleet moves by ccrc's own update mechanism, operator ruling 2026-09-30), and main is measured fresh.
- **2026-10-02 — wave 1 done, in review.** Run 220's wave-done (PR #229, tip `79812043`) passed the server's
  re-measurement. The run is at `awaiting-review` and its ten items are settled.
  - **Departures.** The worker used six of its issued numbers: 3778 through 3783. Each is defined in the plan on
    the branch. 3784 through 3787 went unused.
  - **Signals.** `suite: red`, `failure: unclear`. The first full local run timed out at load average 40–95: every
    PWA failure was a timeout, and two server cases passed when run alone. No assertion on this wave's code failed,
    and CI's required Linux checks are green.
  - **Routing.** Not escalated. The red measures the box, not the worker's effort, and clause 13 revises routing
    only on evidence about the work.
  - **Review.** Review run 225 went to `ccrc-pwa-swift-river` on Opus · high with workflows on, so it can run the
    held-out panel. Its first dispatch answered a bare 502: the `subagent` route field takes only haiku or sonnet,
    and the panel's Opus lenses ride the Workflow call's own `model:`. Re-dispatched with `sonnet`. No workspace was
    spawned in between.
  - **Deferred, ruled at review.** The final whole-branch review deferred binding the instrument's `RETURN_ACTS` and
    `ENDS_THE_ARCHIVE` to ccd's `_LC_ACTS`; reclaim, gc, rename and rehome are in neither list. That must be fixed
    before wave 3 reads its archive→return delay. Whether it blocks this wave is the review's to report and mine to
    rule.
- **2026-10-02 — review 225 ruled: one fix round.** The held-out panel ran clean: three lenses verified, 30 agents,
  7 findings confirmed, 2 refuted, none unexamined. The reviewer then measured one of the confirmed findings false
  (R1). Six findings remained:
  - spec lens: 1 (F1);
  - correctness lens: 5 (F2–F6);
  - reproduce lens: none, after 36 tool calls.

  Twelve mutation rows were re-measured, all red, P25 and S38 included. The suites reproduced: server 602 passed, PWA
  3141 passed, the census 7 passed. Rulings:
  - **Fix now.**
    - F1: name the final commit's `holdsSelection` widening as a departure. It is right and pinned.
    - F2: the Released toggle must not flip its stored key while the selection forces the fold open.
    - F3: retitle the fleet-screen double-tap case, which cannot red for the guard.
    - F5: released rows must not rank their card below an all-archived card.

    Each takes one of the block's unused numbers, 3784 through 3787, and the worker merges main (cf9e4cc8, no shared
    files).
  - **Accepted, F6.** `single-definition`'s one-reader scan for `releasedFrom` matches dotted access only. A
    destructured or bracketed read would pass it. Named cost: the single-reader rule is pinned against the common
    spelling only.
  - **Deferred to stage 3's plan.** F4, the RETURN_ACTS / ENDS_THE_ARCHIVE binding, and R1's residual. They are
    listed under Carried constraints.
- **2026-10-02 — wave 1's fix round done, in re-review.** The fresh wave-done (tip `56ad0992`) passed the server's
  re-measurement.
  - **Fixes:** F1, F2, F3 and F5, as 3784 through 3787. That uses the whole block, each number defined in the commit
    it records.
  - **Main merged:** `cf9e4cc8`, with no hand resolution (no `--cc` hunk).
  - **CI:** every required Linux leg is green. One server shard needed a re-run, red in two of #222's files that this
    wave does not touch (`update-inventory` "inside the same second" and a `ccrc-update` hook timeout).
  - **Re-review:** review run 229 went to `ccrc-pwa-keen-summit`. The held-out panel reads the fix range
    `79812043..dd34f2a3`.
  - **Open for that review: whether F2 reads clearly.** F2 chose a disabled toggle with no `:disabled` style, so a
    sighted operator sees an unchanged toggle that ignores the tap. The review judges that against the ruling's
    "whichever reads more clearly to the operator".
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
- **Stage 3's plan carries three instrument items** from wave 1's review (run 225). These are owed before wave 3
  reads its archive→return delay:
  1. Bind `deploy/measure-workspace-lifecycle.py`'s `RETURN_ACTS` and `ENDS_THE_ARCHIVE` to ccd's `_LC_ACTS` by a
     test. At the least, `expire` joins `ENDS_THE_ARCHIVE`.
  2. Widen its `closedAt` doubt from NULL-only to the server's rule: a non-positive or non-integer close time is
     doubt too. Do it without dropping mutation row S38's anchor.
  3. Make the read-only pin structural by comparing the `-wal` file as well.
- **SAFETY.** Never a destructive `ccd` verb against the live host; never touch tmux, `~/.cc-sessions`, `~/.cc-limits`
  or `claude-session@*.service` directly; fixture HOMEs only in tests; `gh` stays off the exec whitelist; never print
  secret contents.

## Next-wave brief

Wave 1 is planned; once the docs PR carrying the spec, this ledger and the plan has merged, dispatch it on a fresh
workspace with the plan path and this file. After it deploys, run the instrument on the server box from the
installed tree — `python3 deploy/measure-workspace-lifecycle.py` — and record `released_top_level` (target 0,
baseline 29 of 56 on 2026-09-24), `released_wire_only` (target 0) and the archive→return rows here: the last is what
wave 3 waits on.

Wave 2 is planned (`docs/superpowers/plans/2026-10-01-workspace-lifecycle-wave2-one-archive.md`, 12 tasks). It was
prototyped on `main` `5b1c58a8` with wave 1 applied, reviewed by three lenses (spec fidelity and irreversible-act
safety, tests and mutations, executability and merges), fixed, and verified; it replays onto `cca1b6d7` with wave 1
applied, with both typechecks and its suites green. The spec carries its nine amendments (§5.2's busy rule, the door's
remote-mode worktree check, the Stop-only cases, the refusal codes' count). The operator approved it by merging #223
(2026-10-01); it dispatches once wave 1 has merged; it lands one at a time with wave 1 (shared `groupFleet.ts` and `shared/api.ts`), and either
order with child-reclamation wave 4 (#215), whose hunks it does not overlap. Two questions are the operator's (the
plan's open questions): whether the PR sheet's "Archive now" opens the new archive sheet in a follow-up, and whether
the remote-mode worktree check stays deferred to `ccd` for good.
