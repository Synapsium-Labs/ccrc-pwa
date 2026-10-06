# Program: delegation-broker

Spec: `docs/superpowers/specs/2026-10-04-delegation-broker-design.md` (approved 2026-10-05, revisions R1–R9 included)
Plans: `docs/superpowers/plans/2026-10-05-delegation-broker-wave1-measurement.md` (wave 1); waves 2–6 are planned one at
a time from wave 1's measured fields, before each wave's run opens
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-soft-basin` (the session that wrote the spec; claimant of run 271)
Workspace: **a fresh child per wave**

**What this program is.** A coordinator that delegates through generic `Agent` / `Workflow` calls or a raw
`git worktree add` leaves nothing ccrc can see: no run edge, no hold, no history, no cleanup owner (spec §1). The
program adds a server-owned delegation broker in six stages, each shipping dark or report-only and enabled
separately: measure what Claude Code actually emits (1), observe it into a journal and a store (2), project it into
the fleet tree (3), adopt provable work and let a coordinator promote it into a real run (4), audit leftover
worktrees in shadow (5), and finally clean them through the existing safety spine (6). It never forbids `Agent` or
`Workflow`, never forces isolation, and never links work by a name, a path, a time or a working directory.

## Waves

| # | spec stage | scope | deploy class | depends on | PRs | state |
|---|---|---|---|---|---|---|
| 1 | 1 Measure | `SessionEnd` registered (captured in a `-hookcap` session, otherwise inert); the capture reducer's delegation block; the mock-API capture rig in the tree; the fixture corpus and its derived matrix; a read-only on-box census | fleet (the hook and installer reach homes through `ccrc update`); tests | — | #284 | **in review (fix round 1)** — wave-done verified 2026-10-06 11:50 UTC at `e47f3689f`; review run 296 dispatched 2026-10-06 12:42 UTC (`ccrc-pwa-soft-prairie`) after the daily cap freed; #284 CI green on every required leg |
| 2 | 2 Observe | hooks append to the spool; ingestion and cursors; the one `delegation_*` migration; census extension; correlation and reconciliation, report-only; the coordinator-intent route; coordinator clause 17 | fleet first, then server; skills | wave 1's matrix and its real-lane cross-check | — | to plan once wave 1's measurement section is complete |
| 3 | 3 Project | the `delegation` frame; activity and lease rows in the PWA | server + pwa | 2 | — | to plan |
| 4 | 4 Adopt | `ws-lease-mark` and carriers; read-only `ws-lease-audit`; adoption; digest mail; retain and resolve; promotion through `ws-add --base` | **AGENT-FIRST**, then server | 3 | — | to plan |
| 5 | 5 Clean (shadow) | audit tokens for due leases; shadow rows; the shadow review | server | 4 | — | to plan |
| 6 | 6 Clean (live) | `ws-lease-clean`; the executor taking a target record | **AGENT-FIRST**, then server | 5; CCR-15 wave 4's sweep (merged #215, live) | — | to plan |

## Measurement matrix (wave 1 fills this section)

Wave 1's Task 9 writes the corpus answers here — per spec §8.1 question and Claude Code version, from the committed
fixture corpus (`server/test/fixtures/delegation/matrix.json`) — plus the on-box census (projects by label, never by
name) and the hook-side costs. After wave 1 merges, the coordinator adds the real-lane cross-check (two lanes) under
its own heading. Until both are here, nothing in waves 2–6 may depend on a hook field (spec §8.1).

## Decisions & deviations

- **2026-10-01 to 2026-10-04 — the operator's rulings during design** (spec §2): route 1 (a delegation broker plus
  reconciliation); ephemeral workers render as activity under their parent; durable work outside `runs dispatch` is
  auto-adopted and guided; coordinator identity is explicit intent plus inferred escalation; nesting lasts until
  the workspace is reclaimed; ephemeral worktrees are cleaned under the CCR-15 / workspace-lifecycle spine; the new
  ccd verbs are workspace-lifecycle verbs, not coordination mutation; four corrections from measurement.
- **2026-10-05 — operator decision: spec approved with revisions R1–R9** (spec §2.1): promotion dispatches a child
  from the lease's tip; only the server journal creates a lease; rungs 3 and 4 narrowed; hour-bucketed spool; a
  separate read-only `ws-lease-audit`; admission rung 6 replaced; a `delegation` frame; carriers and the audit ship
  in stage 4; a worker's leases nest under the top coordinator "via <worker>".
- **2026-10-05 — planning shape.** Wave 1 is planned in full now. Waves 2–6 are planned one at a time, each from the
  fields wave 1 measured, because the spec forbids a contract on an unmeasured field (§8.1). Each wave's plan is
  written and reviewed before its run opens.
- **2026-10-05 — operator decision: the programme runs through ccrc** — wave 1 is dispatched as run 271 to a fresh
  child worker executing subagent-driven, not run in the spec-writing session (§10). The operator approved merging
  this ledger's docs PR once its checks are green. #280 merged 2026-10-05 as `1eda8630a`, every check green.
- **2026-10-05 — wave 1's brief and routing.** The spec'd-plan row: Opus · high main loop, Sonnet · high implementers,
  an Opus · high reviewer per task, Haiku scouts, workflows off, compact 40. Nine items, one per task. The brief
  routes Task 1 around a live peer claim on `ccd/session-hook.sh` (landing-order wave 3's fix round, hard cap 19:04 UTC):
  Tasks 2–5 first, and the peer protocol for the three disjoint lines Task 1 changes.
- **2026-10-05 — overlap rule with child-reclamation wave 5 (run 260), agreed by both coordinators (mail 3563).** Both
  waves edit `server/test/session-hook.test.ts` (ours: one in-place line, the unknown-event row; theirs: the
  citation-debt census's `shared/api.ts` entry) and `README.md` (ours: the registered-events, capture and census
  sentences; theirs: four `shared/api.ts` anchors re-pointed by content). Each edits only its own region; whichever
  PR lands second absorbs main by `git merge` alone and re-runs `session-hook.test.ts` in full plus
  `typecheck-tests`; neither waits. The worker was told (mail 3564).
- **2026-10-05 — wave 1's wave-done verified (mail 3577).** The branch tip, the remote tip and the head of #284 are
  all `347b7b64`, and the server accepted the fingerprint. The worker sent `suite: red`, `failure: unclear`. Its
  first full run was red on four rows: three load rows that pass in isolation, and `tmp-sweep`'s fail-closed row,
  which it reports as also red on a clean `main`; the review brief asks for that to be reproduced. The block 3992
  through 4011 is fully defined. Ruled: the full suite ran as one bounded background job rather than foreground
  shards, which is accepted (the hard timeout and the log kept a hang visible; the gate suites ran in the foreground).
  The raw synthetic capture root stays on the box until #284 merges. Review run 277 runs the held-out panel, plus
  public-content, hook-inertness and measurement-provenance lenses.
- **2026-10-05 — review 277's verdict (`ccrc-pwa-calm-summit`, at `347b7b64`):** 36 findings (0 critical, 11 important,
  25 minor), merged from 59 confirmed. Per lens, confirmed out of raised:
  - Panel: correctness 4/5, spec 5/5, reproduce 6/7.
  - Wave lenses: public-content 0/4, hook-change 1/2, provenance-matrix 6/7, provenance-amendments 9/10,
    deviations 5/7, whole-branch 2/5.
  - Mutation agents: 13 of 126 cells survived.

  No lens came back unverified. The committed corpus is clean; `matrix.json` re-derives byte-identically; `SessionEnd`
  is measured inert outside `-hookcap` (no file written, a median of 32 ms); the `tmp-sweep` main-red claim
  reproduced. The systematic weakness is guard arms added in review and fix rounds that have no row able to go red.
- **2026-10-05 — fix round 1 rulings (mail 3587).** Every finding is fixed except F34, a dated spec anchor that stays
  as it is. The rulings that needed one:
  - F4: re-script interrupt-exit and re-run it on all seven versions (plan Task 6 Step 3), falling back to unmeasured
    after one honest attempt.
  - F6, F22, F23: new or widened amendments.
  - F7: no merge of `main`. Coordinator clause 15 allows asking for an absorb only on a measured conflict, and the
    merge is clean, so the plan's merge-before-handoff constraint is superseded as a planning error.
  - F8, F10, F28: the departures are recorded.
  - F13, F14, F15, F16 are in scope. F16 means Q8 is re-run on the largest repo.
  - F17: SIGKILL and swap-resume are declared as proxies.

  A second block was minted for the round: ten numbers, 4058 through 4067 (4058 F4, 4059 F7, 4060 and 4061 F8,
  4062 F10, 4063 F28, the rest spare).
- **2026-10-05 — routing:** the worker's effort rises from high to xhigh for fix round 1 (`runs route`, kind `shallow`:
  tests missed). The review found guards without a red row; the routing matrix raises effort one rung for that.
- **2026-10-06 — fix round 1's wave-done verified (mail 3681).** The branch, the remote and #284 are all at
  `e47f3689f` (13 commits), and the server accepted the fingerprint. The worker sent `suite: red` (carried from round
  0), `failure: shallow`.
  - F4 is a measured fix (number 4058): the old `/exit` had stopped at Claude Code's unanswered "Background work is
    running" dialog. Re-scripted, every version shows `SessionEnd` `prompt_input_exit`, no `Stop`, and one locked
    tree left.
  - Asked (mail 3642), the worker measured `clear-compact-resume` and `swap-resume`: they launch no background
    work, so they were never blocked.
  - Numbers 4058 through 4065 are defined; 4066 and 4067 are unused.
  - CI reds `server 4/5` on a compaction-card row of `session-hook.test.ts`. The worker reads it as strace
    interleaving, outside this branch's diff, and review 296 is asked to reproduce that.
  - The fleet box's `/tmp` reaper took the raw roots before merge; the committed corpus re-scans clean. A
    protect-list entry is the operator's call.
  - Review run 296's dispatch was refused `cap-daily` (24 of 24, fleet-wide). It retries at each measured age-out,
    the first at 12:41 UTC.
- **2026-10-05 — the parent incarnation field is already in the tree** (spec §5.1, §8.1 item 10): `$REG/<id>.generation`
  (D-2605) is never rewritten once present. The hook also sees it as `CCRC_SESSION_GENERATION`, but ccd does not set
  that on every spawn path, so later waves read the file. Wave 1 records this from source. **Corrected after review
  277 (F27):** the file is not minted at row creation alone — ccd mints it on genuine absence at four sites, and a
  live row can lack it (ccd's own comments quote 31 of 34 rows without it, measured 2026-09-17). The resume retry
  spawn also drops the environment value silently when its re-read fails. So an absent or invalid file is an
  UNMEASURED incarnation, never a changed one.

Deviation numbers: each wave's block is minted at its run-open and recorded here in prose; no number is spelled as
a `D-` token in this file until a plan defines it. **Wave 1 (run 271):** twenty numbers, 3992 through 4011, minted
2026-10-05 15:20 UTC. The plan's ten slugs take the first ten in the order the plan lists them; the rest are for
departures found mid-wave (Tasks 4–6's rig fixes among them). Numbers not used stay unused; nothing re-issues them.

## Carried constraints

- macOS CI legs are flaky by ruling and gate nothing; mutation-table discipline (every guard ships with a red);
  `ccd/ccd` re-stamped after every edit; README citation instruments green; no stage marker gains a writer.
- **ccrc never registers `WorktreeCreate` or `WorktreeRemove`** — either replaces Claude Code's native worktree
  handling (spec §3.1). The installer's event list is pinned.
- `ws-reclaim` stays child-only; `ws-expire` (unbuilt) stays archive-only; no skill names a lease verb.
- **Real-lane captures never leave the fleet box**: only `deploy/hook-capture-reduce.mjs` output is committed.
  **Rig captures are synthetic** (a mock API, a fixture HOME, a fixture repo), so their payloads may be committed
  after the rig's fail-closed allowlist sanitiser, and the public-content guard (`topology-clean.test.ts`) passes on
  them. Project names are operator data: measurement write-ups name projects by label only.
- Nothing new lands above `ccd/session-hook.sh:2900` (README's anchor); edits above it stay line-neutral.
- `CLAUDE.md`'s amendments (spec §13) land with the wave that ships each verb or route, not before.
- The program runs through `runs open` / `runs dispatch`; open wave N+1's run before closing wave N's.

## Next-wave brief

**Wave 1 — measurement.** Plan: `docs/superpowers/plans/2026-10-05-delegation-broker-wave1-measurement.md`, read at
the sha the brief names. A fresh child workspace from `main`. Deploy class: the hook and installer change reach the
fleet through `ccrc update`; everything else is tests and fixtures. One PR. After the merge, the coordinator runs the
plan's real-lane cross-check (two lanes, `-hookcap` sessions) and writes its reduced tables into the measurement
matrix section above, with the corpus's. Dispatch preconditions: the plan is on `main`; one active-run slot; the
daily dispatch cap has room.
