# Program: stall-watch-settings

Spec: `docs/superpowers/specs/2026-10-05-stall-watch-settings-design.md` (rev 3.2, approved 2026-10-05 17:46 UTC)
Plans: `docs/superpowers/plans/2026-10-05-stall-watch-settings-w1-server.md` (wave 1),
`docs/superpowers/plans/2026-10-05-stall-watch-settings-w2-pwa.md` (wave 2)
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-harbor`   Workspace: **a fresh child per wave**
Predecessor: `stall-watch`, complete (its ledger's R38).

**What this program is.** The Settings page gains a **Stall watch** section with one arming ladder and one quiet
time.
- **The ladder:** Off, Log only, Check, Alert, Deliver, Everything, or "Follow the fleet box's files".
- **The quiet time:** 30 min to 12 h, in 30-minute steps.
- **Where the choice lives:** on the server, in one row of `coord.db`. It applies to the whole fleet, and the
  browser keeps no copy.
- **What it overrides:** the arming markers, but never `stall-watch-disabled`, `mail-disabled` or
  `mail-gate-strict`. No marker gains a writer.
- **Confirms:** the server decides when a write needs one. That is whenever the write would switch something on,
  shorten the quiet time, or leave Everything.
- **The split:** wave 1 ships the server and changes nothing until a choice is written (the seed is `follow` and the
  built-in quiet time). Wave 2 ships the section.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | server: L0 wire types and texts; L1 `stallsettings.ts` (ladder, resolver, write effect and key, counts, busy clock); `stall.ts` (quiet time, backoff ceiling, busy clock bound); the migration and store methods; both sweeps through one never-throwing resolution; `GET`/`POST /api/coord/stall-watch` and their censuses; README, `CLAUDE.md` and the parent spec | server | — | run 295 dispatched 2026-10-07 to `ccrc-pwa-swift-meadow`; claim overlap per R10 |
| 2 | the Settings section: API client and hook; a multi-line `QuickConfirm`; `StallWatchSection`; the Notifications label rename; README | server (it serves the PWA) | — | planned; dispatched after wave 1 merges |

## Decisions & deviations

- **R1 (2026-10-05 17:46)**, the spec is approved.
  - The operator approved spec rev 3.2 ("Spec is good"), and the §19 defaults stand as written.
  - Before that, the operator asked for an adversarial review (14:48). Three rounds (wf_02c96a48-da4,
    wf_6b6351ad-f06, wf_be296fb4-28c) folded 44, 28 and 7 findings in turn. None was critical. The residue is
    listed in the spec's §20, and the plans settle it.
  - The operator also confirmed that the choice lives on the server, not in a browser (goal 2 reworded, `ae3895a54`).
- **R2 (17:47)**, the numbers.
  - The allocator issued this programme's block of 24 numbers.
  - Wave 1 defines fifteen: D-4022, D-4023, D-4024, D-4025, D-4026, D-4027, D-4028, D-4029, D-4030, D-4031,
    D-4032, D-4033 and D-4034 for the spec's departures, plus D-4037 and D-4038 from the plan review (R3).
  - Wave 2 defines two: D-4035 and D-4036.
  - The coordinator holds the other seven as a reserve. A departure found during a wave is named by slug in the
    wave-done mail and numbered at wave-done, never earlier.
- **R3**, the planning method: prototype, then measure.
  - The plans were written by workflow wf_974eef89-343 (13 Opus agents). Every task was built in a scratch worktree
    of `77f8d63a5` (branches `proto/sws-w1`, 7 commits, and `proto/sws-w2`, 4 commits; local only, never pushed).
    Its red and green counts and mutation tables were measured there, and the plan's code is that code.
  - Plan review wf_0743e79f-902 (26 agents) found 34 findings: 0 critical and 11 important. None changed the
    design. They were plan-text gaps: Task 7's base drift, a mutation-restore rule, an undefined helper, missing
    mutation rows, and one hand-off between the waves.
  - Fix round wf_d76e8253-74a closed all eleven. Its checkers left two items, ruled here:
    - D-4037 `quiet-raise-asks-nothing`: raising the quiet time never asks for a confirm on its own, because it can
      only reduce checks. This settles the spec's §20 title-only-sheet residue.
    - D-4038 `view-reads-stages-with-the-resolution`: the view reads the stages inside the resolution try. A reader
      throw is a bug path in pure, total code, so the section names the fault rather than reading as an unmeasured
      registry. Accepted as residue.
    - A final narrow fix round applied both, and fixed three small text slips.
- **R4**, routing for wave 1.
  - The wave is a dependent chain of seven tasks. Its plan is long because every step carries its full code.
  - Row: "Worker executing a spec'd plan: a dependent chain that fits one context" (`references/routing-matrix.md`):
    Opus · high; Sonnet · high implementers; an Opus · high per-task reviewer; Haiku scouts; workflows off; compact 40.
  - The worker extracts one task brief at a time (subagent-driven development), so a task never needs the whole plan
    in context.
  - Revisit at wave-done if the wave's evidence says the chain outgrew one context.
- **R5 (2026-10-06 11:39)**, run 260's shared claims do not block W1's start.
  - PR #285 merged as `4e7cf095f`; all of its checks passed. Run 295 is open in `planned` state, and the programme's
    deviation block is not allocated again.
  - Run 260 still holds `shared/api.ts`, `server/src/coord/store.ts`, `server/src/watch.ts`,
    `server/src/coord/routes.ts` and related tests for child-reclamation W5. The W1 plan names this exact overlap and
    says it does not block the start: the worker takes the full all-or-nothing claim, reports the expected 409, and
    works only uncontested paths until the coordinator sequences the shared paths after release.
  - Preserve the seven-item wave. The child-reclamation coordinator was notified by mail 3674; no early release was
    asked. Any same-sentence co-edit still stops for a coordinator ruling under the plan's overtaken-PR rule.
- **R6 (2026-10-06 11:47)**, dispatch waits at the measured concurrency cap.
  - The first dispatch of run 295 was refused `cap-concurrency`, with `limit: 7` and `running: 7`. The server spawned
    and held nothing; the run remains planned, with its seven-item brief and route ready to resend unchanged.
  - Wait for one active run to leave `dispatched`, `working` or `unknown`, then retry run 295 once. Do not open a
    replacement run, change routing, split the wave or bypass the cap.
- **R7 (2026-10-06 11:50)**, child-reclamation W6 and this wave proceed without ordering each other.
  - The child-reclamation coordinator's mail 3675 names its planned run 291 and merged plan #293 (`26e3318b`). That
    wave also edits `shared/api.ts` additively and makes a small mirror-clock/frame edit in `server/src/watch.ts`;
    it does not edit `server/src/coord/store.ts` or `server/src/coord/routes.ts`.
  - Once run 260 releases its claims, both waves may proceed. Edits stay in their own regions; whichever PR lands
    second merges current `main` (never rebases), resolves only structural adjacency, and re-runs `single-definition`,
    `typecheck-tests`, the `session-hook` citation cases and `deviation-refs`. A same-sentence edit still returns for
    a coordinator ruling under R5 rather than being resolved mechanically.
- **R8 (2026-10-06 11:54)**, the one cap retry reached the rolling daily gate.
  - The retry first confirmed run 295 was still planned, run 260's overlapping claims were still live, and
    `origin/main` `b3b5a73ed` still carried 16 migrations. Dispatch was then refused `cap-daily`, with `limit: 24`
    and `used: 24`.
  - The server again spawned and held nothing; run 295 remains planned with no workspace, branch or queued brief.
    Do not poll, retry again, open another run or alter routing. Resume from this run after the rolling budget ages out.
- **R9 (2026-10-06 12:37)**, the operator-directed resume still met the rolling daily gate.
  - `ccrc-api whoami` proved this pane is the programme coordinator `ccrc-pwa-calm-harbor`. Run 295 remained planned,
    `origin/main` remained `b3b5a73ed` with 16 migrations, and run 260 still held the expected overlapping claims.
  - The unchanged seven-item brief and R4 route were dispatched once. The server refused `cap-daily` with `limit: 24`
    and `used: 24`, creating no worker, workspace, branch, hold or queued brief. Leave run 295 planned and make no
    replacement, split, routing change or further retry until there is a real indication that the rolling budget cleared.
- **R10 (2026-10-07 09:58)**, wave 1 is dispatched.
  - A complete `runs list --closed 1` snapshot at 09:56 measured 19 of 24 rolling dispatches and 3 active runs. Run 295
    was this programme's only open run, still planned and untouched.
  - `ccrc-api whoami` proved this pane is `ccrc-pwa-calm-harbor`. `origin/main` `58de9f969` still carries 16
    migrations, so slot 17 stays free, and the W1 plan blob is unchanged.
  - Claims: run 260's are gone. Of the W1 claim set, run 291 (child-reclamation W6, claim 1070) holds `shared/api.ts`
    and `server/src/watch.ts`, as R7 foresaw, and run 302 (ccrc-history W2 B1, claim 1072) holds `README.md` and
    `CLAUDE.md`, which only Task 7 edits. The brief's claim rule covers both holders: the worker reports the 409 with
    its holder and paths, works only uncontested paths, and the coordinator sequences each release.
  - The unchanged seven-item brief and R4 route went out once. The server spawned `ccrc-pwa-swift-meadow` (workspace
    `swift-meadow`, branch `ws/swift-meadow`): `adopted` false, `spawnState` null, `skillState` present, brief queued.
    The run reads `dispatched` with 0 of 7 items. The registry shows the route applied as `class=opus effort=high
    subagent=sonnet workflow=off` with compact 40, and the hold `program:stall-watch-settings wave:1/2 run:295`.
- **R11 (2026-10-07 10:03)**, the claim 409: one regioned co-edit is asked for, and everything else waits.
  - The worker's mail 3809: the full 28-path claim was refused, as R10 expected. It holds claim 1074 on the other 24
    paths, keeps the four contested ones declared, and edits nothing contested. Task 1 begins with `shared/api.ts`, so
    the chain cannot start while claim 1070 holds it.
  - Measured: run 291 still needs both paths. Its remaining Tasks 8, 10, 11 and 12 modify `shared/api.ts`, where its
    edits sit at `LifecycleMeas`, mid-file, and its Task 12 modifies `server/src/watch.ts`. Claim 1070 can run to
    16:54 UTC. Run 302's claim 1072 says that wave is down to its confirmation suite and PR, and only W1's Task 7 needs
    `README.md` and `CLAUDE.md`.
  - Ruling: claims stay exclusive by default, and a lapse is not a release. The worker takes a contested path only on
    this coordinator's confirmation. Mail 3813 asks run 291's coordinator to consent to one co-edit: W1 appends its new
    block at the very end of `shared/api.ts`, changes no line above it, and lands under R7's merge rule. On consent,
    Task 1 starts under that limit; on a refusal, it waits for claim 1070's release. `server/src/watch.ts` (Task 5)
    and `README.md`/`CLAUDE.md` (Task 7) are not in the request; they are re-read when W1 reaches them. The worker
    has this as mail 3814.
  - Why: R7 already lets both waves proceed in their own regions, and a block appended at the end of the file cannot
    textually meet 291's mid-file edits. Cost if wrong: one structural merge in `shared/api.ts` at the second landing.

## Carried constraints (reviewers get these)

- Mutation-table discipline: every guard ships with a row measured red when it is removed, before and after.
- The README citation instrument stays at `7 passed | 328 skipped`; README and `CLAUDE.md` edits are made in place.
- `stall.ts` and `stallsettings.ts` stay L1: pure, and spelling no marker name. No marker gains a writer
  (`single-definition.test.ts`).
- The migration slot is measured, never assumed: 17 at `77f8d63a5`. Slots are a cross-branch namespace; whichever
  branch merges second moves up.
- Run suites in the foreground, one file per command, with a timeout of at least 600000 ms.
- macOS CI legs gate nothing.
- `deviation-refs` needs both plans on `main` before dispatch, because the code cites their numbers.
- Arming stays the operator's. The live box has `stall-watch-live` and `mail-gate-busy-shadow`. Wave 1 deploys at
  `follow`, so nothing changes until a level or a quiet time is chosen in Settings.

## Next-wave brief

- **Wave 1:** run 295, `docs/superpowers/plans/2026-10-05-stall-watch-settings-w1-server.md`, all seven tasks,
  on a fresh child of `ccrc-pwa`.
  - Read the plan at merged commit `4e7cf095f` (plan blob `30994b7702d2b8627c2cf9e64bf5b66d94eb50c9`).
  - The docs prerequisite is satisfied: PR #285 merged on 2026-10-06 11:33 UTC with every CI check green.
  - Re-read claims at dispatch. Run 260's known overlap does not block the start: follow R5 and the plan's claim
    precondition, work only uncontested paths after the expected all-or-nothing 409, and sequence the shared paths
    when they release. A different holder gets the same treatment; do not split the seven-task wave.
  - The migration count on `origin/main` at `b3b5a73ed` remains 16, so W1's planned migration is still slot 17;
    re-measure it immediately before dispatch and again before merge.
  - Execution: `superpowers:subagent-driven-development` with `superpowers:test-driven-development`, with routing per
    R4.
- **Wave 2:** `docs/superpowers/plans/2026-10-05-stall-watch-settings-w2-pwa.md`, dispatched after wave 1's PR is
  proven merged.
